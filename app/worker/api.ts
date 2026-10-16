// JSON API for the web app. api.ts answers browser requests quickly; anything slow (fetching
// videos, checking links) is handed to scan.ts through the queue.
//
// Every route needs a signed-in email (auth.ts); workspace routes also need membership.
// Who can do what:
//   admin   ADMIN_EMAIL. Sees the admin page (allowed owners, per-workspace limits) and can
//           open any workspace with the owner's powers, even without being a member.
//   owner   may own a workspace: the admin, an OWNER_DOMAINS email, or one on the
//           allowed_owners list. Gets one workspace on first sign-in. Can rename it and
//           invite or remove members. Losing owner permission means losing access to it.
//   member  invited by an owner. Can view the report, run scans within the daily limits,
//           add/remove channels, and edit rules, link fixes and text edits. Can't manage members.
// Signing in through Access alone grants nothing: someone who is neither an owner nor
// invited only sees an empty /api/me.
//
// Workspace scoping: workspaceFor checks membership once per request, and every query
// after that includes `workspace_id = ?` (directly or via workspace_channels), so an id
// from the URL or body can never reach another workspace's rows. Check results (`links`)
// are per workspace too. Only public YouTube data (channels, videos, their links) is shared.
//
// Cross-site requests: every mutating route is a POST with a JSON body, a PATCH or a DELETE.
// A browser won't send any of those from another site without a CORS preflight, and this
// API never answers one, so another site can't act with a signed-in user's cookie.
import { cleanDomain } from '../shared/core.ts';
import { acceptedKey, appDefaults, type RuleType } from '../shared/rules.ts';
import { currentEmail } from './auth.ts';
import { HttpError, now, today, todayStart, type Env } from './env.ts';
import { createScan, estimates, latestScan, usageToday, type ScanKind, type WorkspaceRow } from './scan.ts';
import { DEFAULT_DAILY_UNITS, fetchDescription, QuotaError, resolveChannel } from './youtube.ts';

const MAX_VIDEOS_PER_CHANNEL = 5000;
// Loose on purpose: Access proves the address at sign-in, this only catches typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_CHARS = 512 * 1024;
const MAX_WORKSPACE_NAME = 80;
const MAX_RULE_NOTE = 500;
const MAX_OWNER_NOTE = 300;
const MAX_REPLACEMENT_URL = 2000;
// Text edits (shared/textEdits.ts). YouTube caps a description at 5,000 characters.
const MAX_EDIT_TEXT = 5000;
const MAX_EDITS_PER_SAVE = 20;
const MAX_EDITS_PER_WORKSPACE = 500;
const MAX_EDIT_VIDEOS = 20000;
const VIDEO_ID_RE = /^[\w-]{11}$/;
// Ceilings for limits the admin sets per workspace.
const MAX_DAILY_FULL_SCANS = 100;
const MAX_DAILY_RECHECKS = 500;
const MAX_CHANNELS = 50;

interface Me {
  email: string;
  isAdmin: boolean;
  canOwn: boolean;
}
/** The caller's role in one workspace. `admin` means the admin, visiting as a non-member. */
type Role = 'owner' | 'member' | 'admin';

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Parses a JSON request body. Only the shape is typed: every route validates the fields itself. */
async function body<T>(req: Request): Promise<T> {
  // Requiring JSON keeps plain cross-site form posts from reaching mutating routes.
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Expected JSON');
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, 'Request too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  // Routes read fields off the body, so null, arrays and bare values are rejected here.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'Expected a JSON object');
  return parsed as T;
}

/** A body field as a string; anything else reads as '', so validation 400s instead of throwing. */
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// ---------- identity and workspaces ----------

/** Works out the caller's app-wide permissions from config and the allowed_owners table. */
async function loadMe(env: Env, email: string): Promise<Me> {
  const isAdmin = email === env.ADMIN_EMAIL.toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const ownerDomains = env.OWNER_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  let canOwn = isAdmin || ownerDomains.includes(domain);
  if (!canOwn) canOwn = !!(await env.DB.prepare('SELECT 1 FROM allowed_owners WHERE email = ?').bind(email).first());
  return { email, isAdmin, canOwn };
}

/** Owners get their workspace on first sign-in. Runs on every request (1 read once it exists). */
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

/** Workspaces the caller belongs to, for the workspace switcher. */
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

/**
 * The access check for every /api/w/:id route: returns the workspace and the caller's role
 * in it, or throws 404/403. Admin status wins over a plain member row, so the admin keeps
 * admin powers (rename, manage members) in a workspace where they're also a member. An owner
 * who lost owner permission falls through to the admin check, then 403.
 */
async function workspaceFor(env: Env, me: Me, id: string): Promise<{ ws: WorkspaceRow; role: Role }> {
  const ws = await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
  if (!ws) throw new HttpError(404, 'Workspace not found');
  const m = await env.DB.prepare('SELECT role FROM members WHERE workspace_id = ? AND email = ?')
    .bind(id, me.email)
    .first<{ role: 'owner' | 'member' }>();
  if (m?.role === 'owner' && me.canOwn) return { ws, role: 'owner' };
  if (me.isAdmin) return { ws, role: 'admin' };
  if (m?.role === 'member') return { ws, role: 'member' };
  throw new HttpError(403, 'You are not a member of this workspace');
}

const canManageMembers = (role: Role) => role === 'owner' || role === 'admin';

// ---------- workspace routes ----------

/**
 * Everything the report page needs in one response: channels, videos, links and their
 * results, rules, link fixes, text edits, estimates and scan state. Classification happens in the browser.
 * Side effect: may spend YouTube units backfilling missing channel thumbnails.
 */
async function report(env: Env, ws: WorkspaceRow, role: Role) {
  // Limits a videos query to this workspace's channels; ?1 is the workspace id.
  const inWs = 'JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ?1';
  const [channels, videos, videoLinks, links, rules, fixes, edits] = await env.DB.batch([
    env.DB.prepare(
      'SELECT c.id, c.title, c.handle, c.thumbnail, c.video_count AS videoCount, c.fetched_at AS fetchedAt FROM channels c JOIN workspace_channels wc ON wc.channel_id = c.id WHERE wc.workspace_id = ?1 ORDER BY c.title',
    ).bind(ws.id),
    env.DB.prepare(`SELECT v.id, v.title AS t, v.channel_id AS c, v.published_at AS p FROM videos v ${inWs}`).bind(ws.id),
    env.DB.prepare(`SELECT vl.video_id AS v, vl.url AS u FROM video_links vl JOIN videos v ON v.id = vl.video_id ${inWs}`).bind(ws.id),
    env.DB.prepare(
      `SELECT url, outcome, status, final_url AS finalUrl, chain, parked, note, prev_final_url AS prevFinalUrl, checked_at AS checkedAt
       FROM links WHERE workspace_id = ?1 AND url IN (SELECT vl.url FROM video_links vl JOIN videos v ON v.id = vl.video_id ${inWs})`,
    ).bind(ws.id),
    env.DB.prepare(
      'SELECT id, type, value, value2, note, added_by AS addedBy, added_at AS addedAt FROM rules WHERE workspace_id = ?1 ORDER BY id',
    ).bind(ws.id),
    fixesQuery(env, ws.id),
    textEditsQuery(env, ws.id),
  ]);
  // Channels added before thumbnails were stored (thumbnail NULL) get theirs once, on the next
  // report load. A channel YouTube has no thumbnail for, or no longer knows, is stored as ''
  // so it isn't looked up (1 unit) again on every load; only a quota error leaves it to retry.
  const chans = channels!.results as { id: string; thumbnail: string | null }[];
  const missing = chans.filter((c) => c.thumbnail === null);
  if (missing.length) {
    const found = await Promise.allSettled(missing.map((c) => resolveChannel(env, c.id)));
    const updates = found.flatMap((f, i) =>
      f.status === 'rejected' && f.reason instanceof QuotaError
        ? []
        : [{ channel: missing[i]!, thumbnail: (f.status === 'fulfilled' && f.value.thumbnail) || '' }],
    );
    if (updates.length) {
      await env.DB.batch(
        updates.map((u) => env.DB.prepare('UPDATE channels SET thumbnail = ? WHERE id = ?').bind(u.thumbnail, u.channel.id)),
      );
      for (const u of updates) u.channel.thumbnail = u.thumbnail;
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
    textEdits: parseEdits(edits!.results as EditRow[]),
    defaults: appDefaults(env.EXTRA_ACCEPTED_REDIRECTS), // built-in plus this deployment's extras
    estimates: await estimates(env, ws.id),
    ...(await scanState(env, ws)),
  };
}

/**
 * The workspace's saved per-link fix decisions (see shared/fixes.ts applyFixes). `channelId` ''
 * applies to every channel; a fix for a specific channel wins over it for that channel's videos.
 */
const fixesQuery = (env: Env, wsId: string) =>
  env.DB.prepare(
    'SELECT url, channel_id AS channelId, action, replacement, added_by AS addedBy, added_at AS addedAt FROM link_fixes WHERE workspace_id = ?1',
  ).bind(wsId);

/** '' (every channel), or a channel id that must belong to the workspace. */
async function channelScope(env: Env, ws: WorkspaceRow, v: unknown): Promise<string> {
  if (v === undefined || v === null || v === '') return '';
  const id = str(v);
  const ok = await env.DB.prepare('SELECT 1 FROM workspace_channels WHERE workspace_id = ? AND channel_id = ?').bind(ws.id, id).first();
  if (!ok) throw new HttpError(400, 'Channel not found in this workspace');
  return id;
}

/**
 * Saves (or with `clear`, forgets) what to do with one of the workspace's links, for every
 * channel or just `channelId`. The link must appear in one of the workspace's videos. A
 * replacement must be one http(s) URL.
 */
async function setFix(
  env: Env,
  ws: WorkspaceRow,
  me: Me,
  b: { url?: string; action?: 'remove' | 'replace' | 'clear'; replacement?: string | null; channelId?: string },
) {
  const url = typeof b.url === 'string' ? b.url : '';
  if (!['remove', 'replace', 'clear'].includes(b.action as string)) throw new HttpError(400, 'Unknown action');
  const channel = await channelScope(env, ws, b.channelId);
  const known = await env.DB.prepare(
    'SELECT 1 FROM video_links vl JOIN videos v ON v.id = vl.video_id JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ? AND vl.url = ? LIMIT 1',
  )
    .bind(ws.id, url)
    .first();
  if (!url || !known) throw new HttpError(404, 'Link not found in this workspace');
  if (b.action === 'clear') {
    await env.DB.prepare('DELETE FROM link_fixes WHERE workspace_id = ? AND url = ? AND channel_id = ?').bind(ws.id, url, channel).run();
  } else {
    let replacement: string | null = null;
    if (b.action === 'replace') {
      replacement = typeof b.replacement === 'string' ? b.replacement.trim() : '';
      // No whitespace, so the link survives being pasted into a description as one URL.
      const ok = /^https?:\/\/\S+$/i.test(replacement) && URL.canParse(replacement);
      if (!ok || replacement.length > MAX_REPLACEMENT_URL) throw new HttpError(400, 'Enter a full http(s) URL to replace it with');
    }
    await env.DB.prepare(
      `INSERT INTO link_fixes (workspace_id, url, channel_id, action, replacement, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, url, channel_id) DO UPDATE SET action = excluded.action, replacement = excluded.replacement,
         added_by = excluded.added_by, added_at = excluded.added_at`,
    )
      .bind(ws.id, url, channel, b.action, replacement, me.email, now())
      .run();
  }
  return { fixes: (await fixesQuery(env, ws.id).all()).results };
}

/** The workspace's saved hand edits to descriptions, oldest first (the order they apply in). */
const textEditsQuery = (env: Env, wsId: string) =>
  env.DB.prepare(
    'SELECT id, find, replace, videos, channel_id AS channelId, kind, added_by AS addedBy, added_at AS addedAt FROM text_edits WHERE workspace_id = ?1 ORDER BY id',
  ).bind(wsId);
type EditRow = { id: number; find: string; replace: string; videos: string | null; channelId: string | null; kind: string; addedBy: string; addedAt: string };
/** `videos` is stored as JSON text. */
const parseEdits = (rows: EditRow[]) => rows.map((r) => ({ ...r, videos: r.videos === null ? null : (JSON.parse(r.videos) as string[]) }));
const listEdits = async (env: Env, wsId: string) => ({ textEdits: parseEdits((await textEditsQuery(env, wsId).all<EditRow>()).results) });

/**
 * Saves the rules found in one hand edit (see shared/textEdits.ts editsFromHandEdit), or one
 * quick edit. Each needs `find` with some text, a `replace` (empty deletes it), and `videos`:
 * a list of video ids, or null for every video where `find` appears. `channelId` limits a
 * rule to one channel's videos; `kind` is 'lines' (the default, whole lines) or 'text' (exact
 * text, matched anywhere).
 */
async function addTextEdits(env: Env, ws: WorkspaceRow, me: Me, b: { edits?: unknown }) {
  if (!Array.isArray(b.edits) || !b.edits.length || b.edits.length > MAX_EDITS_PER_SAVE) throw new HttpError(400, 'Nothing to save');
  const edits = (b.edits as { find?: unknown; replace?: unknown; videos?: unknown; channelId?: unknown; kind?: unknown }[]).map((e) => {
    const find = str(e.find);
    const replace = str(e.replace);
    if (!find.trim() || find.length > MAX_EDIT_TEXT || replace.length > MAX_EDIT_TEXT) throw new HttpError(400, 'Each change needs some text, up to 5,000 characters');
    let videos: string | null = null;
    if (e.videos !== null) {
      const ok = Array.isArray(e.videos) && e.videos.length > 0 && e.videos.length <= MAX_EDIT_VIDEOS && e.videos.every((v) => typeof v === 'string' && VIDEO_ID_RE.test(v));
      if (!ok) throw new HttpError(400, 'Choose at least one video');
      videos = JSON.stringify([...new Set(e.videos as string[])]);
    }
    if (e.kind !== undefined && e.kind !== 'lines' && e.kind !== 'text') throw new HttpError(400, 'Unknown kind of edit');
    return { find, replace, videos, channelId: e.channelId, kind: e.kind === 'text' ? 'text' : 'lines' };
  });
  const channels = await Promise.all(edits.map((e) => channelScope(env, ws, e.channelId)));
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM text_edits WHERE workspace_id = ?').bind(ws.id).first<number>('n');
  if ((count ?? 0) + edits.length > MAX_EDITS_PER_WORKSPACE) throw new HttpError(400, `A workspace can keep up to ${MAX_EDITS_PER_WORKSPACE} saved edits. Remove some first.`);
  const at = now();
  await env.DB.batch(
    edits.map((e, i) =>
      env.DB.prepare(
        'INSERT INTO text_edits (workspace_id, find, replace, videos, channel_id, kind, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(ws.id, e.find, e.replace, e.videos, channels[i] || null, e.kind, me.email, at),
    ),
  );
  return listEdits(env, ws.id);
}

/** The latest scan plus today's usage against the workspace's limits. */
async function scanState(env: Env, ws: WorkspaceRow) {
  const [scan, used] = await Promise.all([latestScan(env, ws.id), usageToday(env, ws.id)]);
  return {
    scan,
    limits: { fullScans: ws.daily_full_scans, rechecks: ws.daily_rechecks, maxChannels: ws.max_channels },
    usedToday: used,
  };
}

/**
 * Adds a YouTube channel to the workspace (1 YouTube unit). Enforces the workspace's
 * channel limit and MAX_VIDEOS_PER_CHANNEL. Channel rows are shared between workspaces;
 * the workspace_channels row is what links one to this workspace.
 */
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
    ).bind(c.id, c.title, c.handle, c.uploads, c.videoCount, c.thumbnail ?? ''), // '' = looked up, none
    env.DB.prepare('INSERT OR IGNORE INTO workspace_channels (workspace_id, channel_id, added_by, added_at) VALUES (?, ?, ?, ?)').bind(
      ws.id,
      c.id,
      me.email,
      now(),
    ),
  ]);
  return { id: c.id, title: c.title };
}

/**
 * Validates and saves a workspace rule (see shared/rules.ts). Returns `{ id }`, or the
 * existing rule's id if an identical one is already saved.
 */
async function addRule(env: Env, ws: WorkspaceRow, me: Me, r: { type: RuleType; value: string; value2?: string; note?: string }) {
  // Untrusted JSON: non-string fields read as '' (see str), so they fail validation with a 400.
  r = { type: r.type, value: str(r.value), value2: str(r.value2), note: str(r.note) };
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
    const defaults = appDefaults(env.EXTRA_ACCEPTED_REDIRECTS);
    const known =
      (value === 'accepted' && defaults.accepted.some((p) => acceptedKey(p) === value2)) ||
      (value === 'redirector' && defaults.redirectors.includes(value2));
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
    .bind(ws.id, r.type, value, value2, str(r.note).trim().slice(0, MAX_RULE_NOTE) || null, me.email, now())
    .first();
}

/** The workspace's member list; visible to every member. */
/**
 * Every saved description for this workspace's videos, for the Excel export's Descriptions sheet.
 * Read only from the database (saved by full scans and the Fix drawer), so it spends no quota.
 * Kept out of the report payload because descriptions are large and only exports need them.
 */
async function descriptions(env: Env, ws: WorkspaceRow) {
  const rows = (
    await env.DB.prepare(
      `SELECT v.id, v.description AS d, v.description_at AS at FROM videos v
       JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ?`,
    )
      .bind(ws.id)
      .all<{ id: string; d: string | null; at: string | null }>()
  ).results;
  return { descriptions: rows };
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

/** The admin page: allowed owners, every workspace with its limits and usage, and today's quota. */
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
    ).bind(todayStart()),
    env.DB.prepare('SELECT units FROM quota WHERE day = ?').bind(today()),
  ]);
  return {
    allowedOwners: owners!.results,
    ownerDomains: env.OWNER_DOMAINS.split(',').map((d) => d.trim()).filter(Boolean),
    workspaces: workspaces!.results,
    quota: { usedToday: (quota!.results[0] as { units?: number } | undefined)?.units ?? 0, limit: Number(env.GLOBAL_DAILY_UNITS ?? DEFAULT_DAILY_UNITS) },
  };
}

// ---------- router ----------

/**
 * Routes one /api request. Order matters for security: authenticate (currentEmail), load
 * app-wide permissions, then for /api/w/:id check membership (workspaceFor) before any
 * route runs, and for /api/admin check isAdmin. HttpErrors become JSON with their status;
 * anything else is logged and returned as a generic 500, so internals don't leak.
 */
export async function handleApi(req: Request, env: Env): Promise<Response> {
  try {
    const email = await currentEmail(req, env);
    const me = await loadMe(env, email);
    await ensureOwnWorkspace(env, me);
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const method = req.method;
    let seg: string[]; // path segments after /api
    try {
      seg = path.split('/').slice(2).map(decodeURIComponent);
    } catch {
      throw new HttpError(400, 'Bad URL'); // a malformed % escape
    }

    if (path === '/api/me' && method === 'GET') {
      return json({ email: me.email, isAdmin: me.isAdmin, canOwn: me.canOwn, workspaces: await myWorkspaces(env, me) });
    }

    if (seg[0] === 'w' && seg[1]) {
      const { ws, role } = await workspaceFor(env, me, seg[1]);
      const sub = seg[2];
      if (!sub && method === 'GET') return json(await report(env, ws, role));
      if (!sub && method === 'PATCH') {
        if (!canManageMembers(role)) throw new HttpError(403, 'Only the owner can rename the workspace');
        const b = await body<{ name?: string }>(req);
        const name = str(b.name).trim().slice(0, MAX_WORKSPACE_NAME);
        if (!name) throw new HttpError(400, 'Enter a name');
        await env.DB.prepare('UPDATE workspaces SET name = ? WHERE id = ?').bind(name, ws.id).run();
        return json({ ok: true });
      }
      if (sub === 'scan' && method === 'GET') return json(await scanState(env, ws));
      if (sub === 'scans' && method === 'POST') {
        const b = await body<{ kind: ScanKind; urls?: string[]; channels?: string[] }>(req);
        if (!['full', 'all', 'urls'].includes(b.kind)) throw new HttpError(400, 'Unknown scan type');
        const id = await createScan(env, ws, b.kind, me.email, { urls: b.urls, channels: b.kind === 'full' ? b.channels : undefined });
        return json({ id, ...(await scanState(env, ws)), estimates: await estimates(env, ws.id) });
      }
      if (sub === 'channels' && method === 'POST') {
        const b = await body<{ input: string }>(req);
        return json(await addChannel(env, ws, me, str(b.input)));
      }
      if (sub === 'channels' && seg[3] && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM workspace_channels WHERE workspace_id = ? AND channel_id = ?').bind(ws.id, seg[3]).run();
        return json({ ok: true });
      }
      if (sub === 'videos' && seg[3] && seg[4] === 'description' && !seg[5] && method === 'GET') {
        const owned = await env.DB.prepare(
          'SELECT 1 FROM videos v JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ? AND v.id = ?',
        )
          .bind(ws.id, seg[3])
          .first();
        // Only videos of this workspace's channels, so the route can't be used to spend quota on anything else.
        if (!owned) throw new HttpError(404, 'Video not found in this workspace');
        try {
          const description = await fetchDescription(env, seg[3]);
          // Keep the saved copy (used by exports) as fresh as what the drawer just showed.
          await env.DB.prepare('UPDATE videos SET description = ?, description_at = ? WHERE id = ?').bind(description, now(), seg[3]).run();
          return json({ description });
        } catch (e) {
          if (e instanceof QuotaError) throw new HttpError(429, e.message);
          throw e;
        }
      }
      if (sub === 'descriptions' && method === 'GET') return json(await descriptions(env, ws));
      if (sub === 'fixes' && method === 'POST') return json(await setFix(env, ws, me, await body(req)));
      if (sub === 'text-edits' && !seg[3] && method === 'POST') return json(await addTextEdits(env, ws, me, await body(req)));
      if (sub === 'text-edits' && seg[3] && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM text_edits WHERE workspace_id = ? AND id = ?').bind(ws.id, Number(seg[3])).run();
        return json(await listEdits(env, ws.id));
      }
      if (sub === 'rules' && method === 'POST') return json(await addRule(env, ws, me, await body(req)));
      if (sub === 'rules' && seg[3] && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM rules WHERE workspace_id = ? AND id = ?').bind(ws.id, Number(seg[3])).run();
        return json({ ok: true });
      }
      if (sub === 'members' && method === 'GET') return json(await members(env, ws));
      if (sub === 'members' && method === 'POST') {
        if (!canManageMembers(role)) throw new HttpError(403, 'Only the owner can invite people');
        const b = await body<{ email: string }>(req);
        const invite = str(b.email).trim().toLowerCase();
        if (!invite || !EMAIL_RE.test(invite)) throw new HttpError(400, 'Enter a valid email');
        await env.DB.prepare(
          "INSERT OR IGNORE INTO members (workspace_id, email, role, added_by, added_at) VALUES (?, ?, 'member', ?, ?)",
        )
          .bind(ws.id, invite, me.email, now())
          .run();
        return json(await members(env, ws));
      }
      if (sub === 'members' && seg[3] && method === 'DELETE') {
        if (!canManageMembers(role)) throw new HttpError(403, 'Only the owner can remove people');
        await env.DB.prepare("DELETE FROM members WHERE workspace_id = ? AND email = ? AND role = 'member'").bind(ws.id, seg[3].toLowerCase()).run();
        return json(await members(env, ws));
      }
      throw new HttpError(404, 'Not found');
    }

    if (seg[0] === 'admin') {
      if (!me.isAdmin) throw new HttpError(403, 'Admins only');
      if (!seg[1] && method === 'GET') return json(await adminOverview(env));
      if (seg[1] === 'owners' && method === 'POST') {
        const b = await body<{ email: string; note?: string }>(req);
        const e = str(b.email).trim().toLowerCase();
        if (!e || !EMAIL_RE.test(e)) throw new HttpError(400, 'Enter a valid email');
        await env.DB.prepare('INSERT OR REPLACE INTO allowed_owners (email, note, added_by, added_at) VALUES (?, ?, ?, ?)')
          .bind(e, str(b.note).trim().slice(0, MAX_OWNER_NOTE) || null, me.email, now())
          .run();
        return json(await adminOverview(env));
      }
      if (seg[1] === 'owners' && seg[2] && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM allowed_owners WHERE email = ?').bind(seg[2].toLowerCase()).run();
        return json(await adminOverview(env));
      }
      if (seg[1] === 'workspaces' && seg[2] && method === 'PATCH') {
        const b = await body<{ dailyFullScans?: number; dailyRechecks?: number; maxChannels?: number }>(req);
        // A whole number from 0 to max, or null to keep the current value (via COALESCE).
        const intOrKeep = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
        await env.DB.prepare(
          `UPDATE workspaces SET daily_full_scans = COALESCE(?, daily_full_scans), daily_rechecks = COALESCE(?, daily_rechecks),
           max_channels = COALESCE(?, max_channels) WHERE id = ?`,
        )
          .bind(
            intOrKeep(b.dailyFullScans, MAX_DAILY_FULL_SCANS),
            intOrKeep(b.dailyRechecks, MAX_DAILY_RECHECKS),
            intOrKeep(b.maxChannels, MAX_CHANNELS),
            seg[2],
          )
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
