// JSON API. Every route needs a signed-in email; workspace routes also need membership.
import { cleanDomain } from '../shared/core.ts';
import { acceptedKey, DEFAULT_ACCEPTED, DEFAULT_REDIRECTORS, type RuleType } from '../shared/rules.ts';
import { currentEmail } from './auth.ts';
import { HttpError, now, today, type Env } from './env.ts';
import { createScan, estimates, latestScan, usageToday, type ScanKind, type WorkspaceRow } from './scan.ts';
import { fetchDescription, QuotaError, resolveChannel } from './youtube.ts';

const MAX_VIDEOS_PER_CHANNEL = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Me {
  email: string;
  isAdmin: boolean;
  canOwn: boolean;
}
type Role = 'owner' | 'member' | 'admin';

const json = (data: unknown, status = 200) => Response.json(data, { status });

async function body<T>(req: Request): Promise<T> {
  // Requiring JSON keeps plain cross-site form posts from reaching mutating routes.
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Expected JSON');
  const text = await req.text();
  if (text.length > 512 * 1024) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

// ---------- identity and workspaces ----------

async function loadMe(env: Env, email: string): Promise<Me> {
  const isAdmin = email === env.ADMIN_EMAIL.toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const ownerDomains = env.OWNER_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  let canOwn = isAdmin || ownerDomains.includes(domain);
  if (!canOwn) canOwn = !!(await env.DB.prepare('SELECT 1 FROM allowed_owners WHERE email = ?').bind(email).first());
  return { email, isAdmin, canOwn };
}

/** Owners get their workspace on first sign-in. */
async function ensureOwnWorkspace(env: Env, me: Me) {
  if (!me.canOwn) return;
  const existing = await env.DB.prepare('SELECT id FROM workspaces WHERE owner_email = ?').bind(me.email).first();
  if (existing) return;
  const id = crypto.randomUUID();
  const t = now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name, owner_email, created_at) VALUES (?, ?, ?, ?)').bind(
      id,
      `${me.email.split('@')[0]}'s workspace`,
      me.email,
      t,
    ),
    env.DB.prepare("INSERT OR IGNORE INTO members (workspace_id, email, role, added_by, added_at) VALUES (?, ?, 'owner', ?, ?)").bind(
      id,
      me.email,
      me.email,
      t,
    ),
  ]);
}

async function myWorkspaces(env: Env, me: Me) {
  const rows = (
    await env.DB.prepare(
      'SELECT w.id, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.email = ? ORDER BY m.role DESC, w.name',
    )
      .bind(me.email)
      .all<{ id: string; name: string; role: 'owner' | 'member' }>()
  ).results;
  // An owner who is no longer allowed to own (removed from the allow list) loses access.
  return rows.filter((r) => r.role !== 'owner' || me.canOwn);
}

async function workspaceFor(env: Env, me: Me, id: string): Promise<{ ws: WorkspaceRow; role: Role }> {
  const ws = await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
  if (!ws) throw new HttpError(404, 'Workspace not found');
  const m = await env.DB.prepare('SELECT role FROM members WHERE workspace_id = ? AND email = ?')
    .bind(id, me.email)
    .first<{ role: 'owner' | 'member' }>();
  if (m && (m.role !== 'owner' || me.canOwn)) return { ws, role: m.role };
  if (me.isAdmin) return { ws, role: 'admin' };
  throw new HttpError(403, 'You are not a member of this workspace');
}

const canManageMembers = (role: Role) => role === 'owner' || role === 'admin';

// ---------- workspace routes ----------

async function report(env: Env, ws: WorkspaceRow, role: Role) {
  const inWs = 'JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ?1';
  const [channels, videos, videoLinks, links, rules, fixes] = await env.DB.batch([
    env.DB.prepare(
      'SELECT c.id, c.title, c.handle, c.thumbnail, c.video_count AS videoCount, c.fetched_at AS fetchedAt FROM channels c JOIN workspace_channels wc ON wc.channel_id = c.id WHERE wc.workspace_id = ?1 ORDER BY c.title',
    ).bind(ws.id),
    env.DB.prepare(`SELECT v.id, v.title AS t, v.channel_id AS c, v.published_at AS p FROM videos v ${inWs}`).bind(ws.id),
    env.DB.prepare(`SELECT vl.video_id AS v, vl.url AS u FROM video_links vl JOIN videos v ON v.id = vl.video_id ${inWs}`).bind(ws.id),
    env.DB.prepare(
      `SELECT url, outcome, status, final_url AS finalUrl, chain, parked, note, prev_final_url AS prevFinalUrl, checked_at AS checkedAt
       FROM links WHERE url IN (SELECT vl.url FROM video_links vl JOIN videos v ON v.id = vl.video_id ${inWs})`,
    ).bind(ws.id),
    env.DB.prepare(
      'SELECT id, type, value, value2, note, added_by AS addedBy, added_at AS addedAt FROM rules WHERE workspace_id = ?1 ORDER BY id',
    ).bind(ws.id),
    fixesQuery(env, ws.id),
  ]);
  // Channels added before thumbnails were stored get theirs once, on the next report load.
  const chans = channels!.results as { id: string; thumbnail: string | null }[];
  const missing = chans.filter((c) => !c.thumbnail);
  if (missing.length) {
    const found = await Promise.allSettled(missing.map((c) => resolveChannel(env, c.id)));
    const updates = found.flatMap((f, i) => (f.status === 'fulfilled' && f.value.thumbnail ? [{ c: missing[i]!, t: f.value.thumbnail }] : []));
    if (updates.length) {
      await env.DB.batch(updates.map((u) => env.DB.prepare('UPDATE channels SET thumbnail = ? WHERE id = ?').bind(u.t, u.c.id)));
      for (const u of updates) u.c.thumbnail = u.t;
    }
  }
  return {
    workspace: { id: ws.id, name: ws.name, owner: ws.owner_email, role },
    channels: chans,
    videos: videos!.results,
    videoLinks: videoLinks!.results,
    links: links!.results, // `chain` stays a JSON string; the browser parses it
    rules: rules!.results,
    fixes: fixes!.results,
    defaults: { accepted: DEFAULT_ACCEPTED, redirectors: DEFAULT_REDIRECTORS },
    estimates: await estimates(env, ws.id),
    ...(await scanState(env, ws)),
  };
}

const fixesQuery = (env: Env, wsId: string) =>
  env.DB.prepare('SELECT url, action, replacement, added_by AS addedBy, added_at AS addedAt FROM link_fixes WHERE workspace_id = ?1').bind(wsId);

/** Saves (or with `clear`, forgets) what to do with one of the workspace's links. */
async function setFix(
  env: Env,
  ws: WorkspaceRow,
  me: Me,
  b: { url?: string; action?: 'remove' | 'replace' | 'clear'; replacement?: string | null },
) {
  const url = typeof b.url === 'string' ? b.url : '';
  if (!['remove', 'replace', 'clear'].includes(b.action as string)) throw new HttpError(400, 'Unknown action');
  const known = await env.DB.prepare(
    'SELECT 1 FROM video_links vl JOIN videos v ON v.id = vl.video_id JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ? AND vl.url = ? LIMIT 1',
  )
    .bind(ws.id, url)
    .first();
  if (!url || !known) throw new HttpError(404, 'Link not found in this workspace');
  if (b.action === 'clear') {
    await env.DB.prepare('DELETE FROM link_fixes WHERE workspace_id = ? AND url = ?').bind(ws.id, url).run();
  } else {
    let replacement: string | null = null;
    if (b.action === 'replace') {
      replacement = typeof b.replacement === 'string' ? b.replacement.trim() : '';
      // No whitespace, so the link survives being pasted into a description as one URL.
      const ok = /^https?:\/\/\S+$/i.test(replacement) && URL.canParse(replacement);
      if (!ok || replacement.length > 2000) throw new HttpError(400, 'Enter a full http(s) URL to replace it with');
    }
    await env.DB.prepare(
      `INSERT INTO link_fixes (workspace_id, url, action, replacement, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, url) DO UPDATE SET action = excluded.action, replacement = excluded.replacement,
         added_by = excluded.added_by, added_at = excluded.added_at`,
    )
      .bind(ws.id, url, b.action, replacement, me.email, now())
      .run();
  }
  return { fixes: (await fixesQuery(env, ws.id).all()).results };
}

async function scanState(env: Env, ws: WorkspaceRow) {
  const [scan, used] = await Promise.all([latestScan(env, ws.id), usageToday(env, ws.id)]);
  return {
    scan,
    limits: { fullScans: ws.daily_full_scans, rechecks: ws.daily_rechecks, maxChannels: ws.max_channels },
    usedToday: used,
  };
}

async function addChannel(env: Env, ws: WorkspaceRow, me: Me, input: string) {
  if (!input?.trim()) throw new HttpError(400, 'Enter a channel handle or URL');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_channels WHERE workspace_id = ?').bind(ws.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= ws.max_channels) throw new HttpError(400, `This workspace can have up to ${ws.max_channels} channels.`);
  const c = await resolveChannel(env, input);
  if (c.videoCount > MAX_VIDEOS_PER_CHANNEL)
    throw new HttpError(400, `${c.title} has ${c.videoCount.toLocaleString()} videos; the limit is ${MAX_VIDEOS_PER_CHANNEL.toLocaleString()}.`);
  await env.DB.batch([
    env.DB.prepare(
      // video_count starts as YouTube's own count, for estimates; a full scan replaces it.
      `INSERT INTO channels (id, title, handle, uploads_playlist, video_count, thumbnail) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, handle = excluded.handle, uploads_playlist = excluded.uploads_playlist,
         thumbnail = excluded.thumbnail, video_count = CASE WHEN channels.fetched_at IS NULL THEN excluded.video_count ELSE channels.video_count END`,
    ).bind(c.id, c.title, c.handle, c.uploads, c.videoCount, c.thumbnail),
    env.DB.prepare('INSERT OR IGNORE INTO workspace_channels (workspace_id, channel_id, added_by, added_at) VALUES (?, ?, ?, ?)').bind(
      ws.id,
      c.id,
      me.email,
      now(),
    ),
  ]);
  return { id: c.id, title: c.title };
}

async function addRule(env: Env, ws: WorkspaceRow, me: Me, r: { type: RuleType; value: string; value2?: string; note?: string }) {
  let value = '';
  let value2: string | null = null;
  if (r.type === 'accepted') {
    value = cleanDomain(r.value ?? '');
    value2 = cleanDomain(r.value2 ?? '');
    if (!value || !value2) throw new HttpError(400, 'Enter both domains');
  } else if (r.type === 'redirector') {
    value = cleanDomain(r.value ?? '');
    if (!value) throw new HttpError(400, 'Enter a domain');
  } else if (r.type === 'ignored') {
    const raw = (r.value ?? '').trim();
    if (/^https?:\/\/[^/]+\/./.test(raw)) value = raw; // an exact URL
    else value = cleanDomain(raw);
    if (!value) throw new HttpError(400, 'Enter a domain or URL');
  } else if (r.type === 'disabled') {
    value = r.value;
    value2 = r.value2 ?? '';
    const known =
      (value === 'accepted' && DEFAULT_ACCEPTED.some((p) => acceptedKey(p) === value2)) ||
      (value === 'redirector' && DEFAULT_REDIRECTORS.includes(value2));
    if (!known) throw new HttpError(400, 'Unknown default rule');
  } else {
    throw new HttpError(400, 'Unknown rule type');
  }
  const dup = await env.DB.prepare('SELECT id FROM rules WHERE workspace_id = ? AND type = ? AND value = ? AND COALESCE(value2, \'\') = ?')
    .bind(ws.id, r.type, value, value2 ?? '')
    .first();
  if (dup) return dup;
  return env.DB.prepare(
    'INSERT INTO rules (workspace_id, type, value, value2, note, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(ws.id, r.type, value, value2, r.note?.trim().slice(0, 500) || null, me.email, now())
    .first();
}

async function members(env: Env, ws: WorkspaceRow) {
  return (
    await env.DB.prepare(
      'SELECT email, role, added_by AS addedBy, added_at AS addedAt FROM members WHERE workspace_id = ? ORDER BY role DESC, email',
    )
      .bind(ws.id)
      .all()
  ).results;
}

// ---------- admin ----------

async function adminOverview(env: Env) {
  const [owners, workspaces, quota] = await env.DB.batch([
    env.DB.prepare('SELECT email, note, added_by AS addedBy, added_at AS addedAt FROM allowed_owners ORDER BY email'),
    env.DB.prepare(
      `SELECT w.id, w.name, w.owner_email AS owner, w.daily_full_scans AS dailyFullScans, w.daily_rechecks AS dailyRechecks,
              w.max_channels AS maxChannels, w.created_at AS createdAt,
              (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS members,
              (SELECT COUNT(*) FROM workspace_channels wc WHERE wc.workspace_id = w.id) AS channels,
              (SELECT COUNT(*) FROM scans s WHERE s.workspace_id = w.id AND s.created_at >= ?1) AS scansToday
       FROM workspaces w ORDER BY w.created_at`,
    ).bind(today()),
    env.DB.prepare('SELECT units FROM quota WHERE day = ?').bind(today()),
  ]);
  return {
    allowedOwners: owners!.results,
    ownerDomains: env.OWNER_DOMAINS.split(',').map((d) => d.trim()).filter(Boolean),
    workspaces: workspaces!.results,
    quota: { usedToday: (quota!.results[0] as { units?: number } | undefined)?.units ?? 0, limit: Number(env.GLOBAL_DAILY_UNITS ?? 8000) },
  };
}

// ---------- router ----------

export async function handleApi(req: Request, env: Env): Promise<Response> {
  try {
    const email = await currentEmail(req, env);
    const me = await loadMe(env, email);
    await ensureOwnWorkspace(env, me);
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const m = req.method;
    const seg = path.split('/').slice(2).map(decodeURIComponent); // after /api

    if (path === '/api/me' && m === 'GET') {
      return json({ email: me.email, isAdmin: me.isAdmin, canOwn: me.canOwn, workspaces: await myWorkspaces(env, me) });
    }

    if (seg[0] === 'w' && seg[1]) {
      const { ws, role } = await workspaceFor(env, me, seg[1]);
      const sub = seg[2];
      if (!sub && m === 'GET') return json(await report(env, ws, role));
      if (!sub && m === 'PATCH') {
        if (!canManageMembers(role)) throw new HttpError(403, 'Only the owner can rename the workspace');
        const b = await body<{ name?: string }>(req);
        const name = b.name?.trim().slice(0, 80);
        if (!name) throw new HttpError(400, 'Enter a name');
        await env.DB.prepare('UPDATE workspaces SET name = ? WHERE id = ?').bind(name, ws.id).run();
        return json({ ok: true });
      }
      if (sub === 'scan' && m === 'GET') return json(await scanState(env, ws));
      if (sub === 'scans' && m === 'POST') {
        const b = await body<{ kind: ScanKind; urls?: string[]; channels?: string[] }>(req);
        if (!['full', 'all', 'urls'].includes(b.kind)) throw new HttpError(400, 'Unknown scan type');
        const id = await createScan(env, ws, b.kind, me.email, { urls: b.urls, channels: b.kind === 'full' ? b.channels : undefined });
        return json({ id, ...(await scanState(env, ws)), estimates: await estimates(env, ws.id) });
      }
      if (sub === 'channels' && m === 'POST') {
        const b = await body<{ input: string }>(req);
        return json(await addChannel(env, ws, me, b.input));
      }
      if (sub === 'channels' && seg[3] && m === 'DELETE') {
        await env.DB.prepare('DELETE FROM workspace_channels WHERE workspace_id = ? AND channel_id = ?').bind(ws.id, seg[3]).run();
        return json({ ok: true });
      }
      if (sub === 'videos' && seg[3] && seg[4] === 'description' && !seg[5] && m === 'GET') {
        const owned = await env.DB.prepare(
          'SELECT 1 FROM videos v JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ? AND v.id = ?',
        )
          .bind(ws.id, seg[3])
          .first();
        if (!owned) throw new HttpError(404, 'Video not found in this workspace');
        try {
          return json({ description: await fetchDescription(env, seg[3]) });
        } catch (e) {
          if (e instanceof QuotaError) throw new HttpError(429, e.message);
          throw e;
        }
      }
      if (sub === 'fixes' && m === 'POST') return json(await setFix(env, ws, me, await body(req)));
      if (sub === 'rules' && m === 'POST') return json(await addRule(env, ws, me, await body(req)));
      if (sub === 'rules' && seg[3] && m === 'DELETE') {
        await env.DB.prepare('DELETE FROM rules WHERE workspace_id = ? AND id = ?').bind(ws.id, Number(seg[3])).run();
        return json({ ok: true });
      }
      if (sub === 'members' && m === 'GET') return json(await members(env, ws));
      if (sub === 'members' && m === 'POST') {
        if (!canManageMembers(role)) throw new HttpError(403, 'Only the owner can invite people');
        const b = await body<{ email: string }>(req);
        const invite = b.email?.trim().toLowerCase();
        if (!invite || !EMAIL_RE.test(invite)) throw new HttpError(400, 'Enter a valid email');
        await env.DB.prepare(
          "INSERT OR IGNORE INTO members (workspace_id, email, role, added_by, added_at) VALUES (?, ?, 'member', ?, ?)",
        )
          .bind(ws.id, invite, me.email, now())
          .run();
        return json(await members(env, ws));
      }
      if (sub === 'members' && seg[3] && m === 'DELETE') {
        if (!canManageMembers(role)) throw new HttpError(403, 'Only the owner can remove people');
        await env.DB.prepare("DELETE FROM members WHERE workspace_id = ? AND email = ? AND role = 'member'").bind(ws.id, seg[3].toLowerCase()).run();
        return json(await members(env, ws));
      }
      throw new HttpError(404, 'Not found');
    }

    if (seg[0] === 'admin') {
      if (!me.isAdmin) throw new HttpError(403, 'Admins only');
      if (!seg[1] && m === 'GET') return json(await adminOverview(env));
      if (seg[1] === 'owners' && m === 'POST') {
        const b = await body<{ email: string; note?: string }>(req);
        const e = b.email?.trim().toLowerCase();
        if (!e || !EMAIL_RE.test(e)) throw new HttpError(400, 'Enter a valid email');
        await env.DB.prepare('INSERT OR REPLACE INTO allowed_owners (email, note, added_by, added_at) VALUES (?, ?, ?, ?)')
          .bind(e, b.note?.trim().slice(0, 300) || null, me.email, now())
          .run();
        return json(await adminOverview(env));
      }
      if (seg[1] === 'owners' && seg[2] && m === 'DELETE') {
        await env.DB.prepare('DELETE FROM allowed_owners WHERE email = ?').bind(seg[2].toLowerCase()).run();
        return json(await adminOverview(env));
      }
      if (seg[1] === 'workspaces' && seg[2] && m === 'PATCH') {
        const b = await body<{ dailyFullScans?: number; dailyRechecks?: number; maxChannels?: number }>(req);
        const n = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
        await env.DB.prepare(
          `UPDATE workspaces SET daily_full_scans = COALESCE(?, daily_full_scans), daily_rechecks = COALESCE(?, daily_rechecks),
           max_channels = COALESCE(?, max_channels) WHERE id = ?`,
        )
          .bind(n(b.dailyFullScans, 100), n(b.dailyRechecks, 500), n(b.maxChannels, 50), seg[2])
          .run();
        return json(await adminOverview(env));
      }
      throw new HttpError(404, 'Not found');
    }

    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong' }, 500);
  }
}
