// Scans run as a chain of queue messages so each invocation stays inside Workers Free
// limits (50 subrequests, 50 D1 queries, 10 ms CPU):
//   full scan:  one `fetch` message per uploads page (50 videos), then `check` messages
//   rechecks:   `check` messages only, a few links each, grouped by host
import { checkUrl, extractUrls, hostOf, type LinkResult } from '../shared/core.ts';
import { SKIP_DOMAINS } from '../shared/rules.ts';
import { HttpError, now, today, type CheckItem, type Env, type Job } from './env.ts';
import { BudgetExceeded, makeFetcher, SUBREQUEST_BUDGET } from './fetcher.ts';
import { notifyScanEnded } from './notify.ts';
import { fetchUploadsPage, QuotaError, resolveChannel } from './youtube.ts';

const ITEMS_PER_MESSAGE = 6;
const MIN_BUDGET_TO_START = 4;
const MAX_TRIES = 3;
const MAX_PAGES_PER_CHANNEL = 100; // 5,000 videos
const STALE_SCAN_MS = 2 * 3600_000;
const FRESH = { full: 24 * 3600_000, all: 3600_000, urls: 5 * 60_000 };

export type ScanKind = 'full' | 'all' | 'urls';

export interface ScanRow {
  id: number;
  workspace_id: string;
  kind: ScanKind;
  status: 'fetching' | 'checking' | 'done' | 'failed';
  pending_fetch: number;
  total: number;
  done: number;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  expected_pages: number;
  pages_fetched: number;
  videos_fetched: number;
  checking_started_at: string | null;
  recent: string | null;
  urls: string | null;
  resumes: number;
  channels: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  owner_email: string;
  daily_full_scans: number;
  daily_rechecks: number;
  max_channels: number;
  created_at: string;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function fail(env: Env, scanId: number, message: string) {
  const r = await env.DB.prepare(
    "UPDATE scans SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('fetching', 'checking')",
  )
    .bind(message, now(), now(), scanId)
    .run();
  if (r.meta.changes) await notifyScanEnded(env, scanId);
}

/** Marks a running scan done exactly once (several paths can get here) and notifies. */
async function finish(env: Env, scanId: number) {
  const r = await env.DB.prepare(
    "UPDATE scans SET status = 'done', done = total, finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('fetching', 'checking')",
  )
    .bind(now(), now(), scanId)
    .run();
  if (r.meta.changes) await notifyScanEnded(env, scanId);
}

export async function latestScan(env: Env, workspaceId: string): Promise<ScanRow | null> {
  const s = await env.DB.prepare('SELECT * FROM scans WHERE workspace_id = ? ORDER BY id DESC LIMIT 1')
    .bind(workspaceId)
    .first<ScanRow>();
  if (s && (s.status === 'fetching' || s.status === 'checking') && Date.now() - Date.parse(s.updated_at) > STALE_SCAN_MS) {
    await fail(env, s.id, 'Stopped: no progress for 2 hours');
    return { ...s, status: 'failed', error: 'Stopped: no progress for 2 hours' };
  }
  return s;
}

export async function usageToday(env: Env, workspaceId: string) {
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(kind = 'full'), 0) AS full, COALESCE(SUM(kind != 'full'), 0) AS rechecks FROM scans WHERE workspace_id = ? AND created_at >= ?",
  )
    .bind(workspaceId, today())
    .first<{ full: number; rechecks: number }>();
  return { full: r?.full ?? 0, rechecks: r?.rechecks ?? 0 };
}

/**
 * URLs in this workspace's videos whose shared result is missing or older than `staleBefore`,
 * optionally limited to some links (`only`) or some channels (`channels`).
 */
async function workspaceUrls(
  env: Env,
  workspaceId: string,
  staleBefore: string,
  { only, channels }: { only?: string[]; channels?: string[] } = {},
): Promise<string[]> {
  const sql = `SELECT DISTINCT vl.url AS url FROM video_links vl
    JOIN videos v ON v.id = vl.video_id
    JOIN workspace_channels wc ON wc.channel_id = v.channel_id
    LEFT JOIN links l ON l.url = vl.url
    WHERE wc.workspace_id = ?1 AND (l.url IS NULL OR l.checked_at < ?2)
      AND (?3 IS NULL OR vl.url IN (SELECT value FROM json_each(?3)))
      AND (?4 IS NULL OR v.channel_id IN (SELECT value FROM json_each(?4)))`;
  const json = (a?: string[]) => (a ? JSON.stringify(a) : null);
  const stmt = env.DB.prepare(sql).bind(workspaceId, staleBefore, json(only), json(channels));
  return (await stmt.all<{ url: string }>()).results.map((r) => r.url);
}

async function startChecks(env: Env, scanId: number, urls: string[]) {
  if (!urls.length) {
    await env.DB.prepare('UPDATE scans SET total = 0 WHERE id = ?').bind(scanId).run();
    await finish(env, scanId);
    return;
  }
  await env.DB.prepare("UPDATE scans SET status = 'checking', total = ?, urls = ?, checking_started_at = ?, updated_at = ? WHERE id = ?")
    .bind(urls.length, JSON.stringify(urls), now(), now(), scanId)
    .run();
  await enqueueChecks(env, scanId, urls);
}

async function enqueueChecks(env: Env, scanId: number, urls: string[]) {
  // Group by host so one message mostly talks to one site, spaced by the per-host delay.
  const sorted = [...urls].sort((a, b) => hostOf(a).localeCompare(hostOf(b)));
  const jobs: { body: Job }[] = [];
  for (let i = 0; i < sorted.length; i += ITEMS_PER_MESSAGE) {
    jobs.push({ body: { t: 'check', scanId, items: sorted.slice(i, i + ITEMS_PER_MESSAGE).map((url) => ({ url })) } });
  }
  for (let i = 0; i < jobs.length; i += 100) await env.JOBS.sendBatch(jobs.slice(i, i + 100));
}

/**
 * Picks up renamed channels and new avatars (1 unit each). YouTube's video count only stands
 * in until a fetch has finished, since that sets the real count. A failed refresh keeps the
 * stored data rather than blocking the scan.
 */
async function refreshChannels(env: Env, ids: string[]) {
  const results = await Promise.allSettled(ids.map((id) => resolveChannel(env, id)));
  const updates = results.flatMap((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`Channel refresh failed for ${ids[i]}:`, r.reason);
      return [];
    }
    const c = r.value;
    return [
      env.DB.prepare(
        'UPDATE channels SET title = ?, handle = ?, thumbnail = ?, video_count = CASE WHEN fetched_at IS NULL THEN ? ELSE video_count END WHERE id = ?',
      ).bind(c.title, c.handle, c.thumbnail, c.videoCount, c.id),
    ];
  });
  if (updates.length) await env.DB.batch(updates);
}

/** `channels` limits a full scan to those channels (e.g. one just added); omit it for all of them. */
export async function createScan(
  env: Env,
  ws: WorkspaceRow,
  kind: ScanKind,
  email: string,
  { urls, channels }: { urls?: string[]; channels?: string[] } = {},
): Promise<number> {
  const current = await latestScan(env, ws.id);
  if (current && (current.status === 'fetching' || current.status === 'checking'))
    throw new HttpError(409, 'A scan is already running for this workspace.');
  const used = await usageToday(env, ws.id);
  if (kind === 'full' && used.full >= ws.daily_full_scans)
    throw new HttpError(429, `Daily limit reached: ${ws.daily_full_scans} full scans per day.`);
  if (kind !== 'full' && used.rechecks >= ws.daily_rechecks)
    throw new HttpError(429, `Daily limit reached: ${ws.daily_rechecks} rechecks per day.`);

  const t = now();
  if (kind === 'full') {
    if (channels && (!channels.length || channels.length > ws.max_channels)) throw new HttpError(400, 'Choose which channels to scan.');
    const only = channels ? JSON.stringify(channels) : null;
    const chans = (
      await env.DB.prepare('SELECT channel_id FROM workspace_channels WHERE workspace_id = ?1 AND (?2 IS NULL OR channel_id IN (SELECT value FROM json_each(?2)))')
        .bind(ws.id, only)
        .all<{ channel_id: string }>()
    ).results;
    if (!chans.length) throw new HttpError(400, channels ? 'That channel isn’t in this workspace.' : 'Add a channel before scanning.');
    const ids = chans.map((c) => c.channel_id);
    await refreshChannels(env, ids);
    const pages = await env.DB.prepare('SELECT COALESCE(SUM(MAX(1, (video_count + 49) / 50)), 0) AS n FROM channels WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(ids))
      .first<{ n: number }>();
    const scan = await env.DB.prepare(
      "INSERT INTO scans (workspace_id, kind, status, pending_fetch, expected_pages, channels, created_by, created_at, updated_at) VALUES (?, 'full', 'fetching', ?, ?, ?, ?, ?, ?) RETURNING id",
    )
      .bind(ws.id, chans.length, pages?.n ?? 0, channels ? JSON.stringify(ids) : null, email, t, t)
      .first<{ id: number }>();
    await env.JOBS.sendBatch(chans.map((c) => ({ body: { t: 'fetch', scanId: scan!.id, channelId: c.channel_id } as Job })));
    return scan!.id;
  }

  if (kind === 'urls' && (!urls?.length || urls.length > 5000)) throw new HttpError(400, 'Choose between 1 and 5,000 links.');
  const list = await workspaceUrls(env, ws.id, ago(FRESH[kind]), { only: kind === 'urls' ? urls : undefined });
  const scan = await env.DB.prepare(
    "INSERT INTO scans (workspace_id, kind, status, created_by, created_at, updated_at) VALUES (?, ?, 'checking', ?, ?, ?) RETURNING id",
  )
    .bind(ws.id, kind, email, t, t)
    .first<{ id: number }>();
  await startChecks(env, scan!.id, list);
  return scan!.id;
}

// ---------- queue handlers ----------

async function getScan(env: Env, id: number) {
  return env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(id).first<ScanRow>();
}

async function handleFetch(env: Env, job: Extract<Job, { t: 'fetch' }>) {
  const page = job.page ?? 1;
  const scan = await getScan(env, job.scanId);
  if (!scan || scan.status !== 'fetching') return;
  const ch = await env.DB.prepare('SELECT id, uploads_playlist FROM channels WHERE id = ?')
    .bind(job.channelId)
    .first<{ id: string; uploads_playlist: string }>();

  let next: string | undefined;
  if (ch) {
    const res = await fetchUploadsPage(env, ch.uploads_playlist, job.pageToken);
    next = page < MAX_PAGES_PER_CHANNEL ? res.next : undefined;
    const seen = now();
    const vids = res.videos.map((v) => ({ id: v.id, t: v.title, p: v.publishedAt }));
    const links = res.videos.flatMap((v) => extractUrls(v.description, SKIP_DOMAINS).map((u) => ({ v: v.id, u })));
    // json_each keeps each write to one statement and one bound parameter (D1 allows 100).
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO videos (id, channel_id, title, published_at, last_seen)
         SELECT value->>'id', ?1, value->>'t', value->>'p', ?2 FROM json_each(?3) WHERE true
         ON CONFLICT (id) DO UPDATE SET channel_id = excluded.channel_id, title = excluded.title,
           published_at = excluded.published_at, last_seen = excluded.last_seen`,
      ).bind(ch.id, seen, JSON.stringify(vids)),
      env.DB.prepare("DELETE FROM video_links WHERE video_id IN (SELECT value->>'id' FROM json_each(?))").bind(JSON.stringify(vids)),
      env.DB.prepare("INSERT OR IGNORE INTO video_links (video_id, url) SELECT value->>'v', value->>'u' FROM json_each(?)").bind(
        JSON.stringify(links),
      ),
      env.DB.prepare('UPDATE scans SET pages_fetched = pages_fetched + 1, videos_fetched = videos_fetched + ?, updated_at = ? WHERE id = ?').bind(
        vids.length,
        now(),
        scan.id,
      ),
    ]);
  }

  if (next) {
    await env.JOBS.send({ t: 'fetch', scanId: scan.id, channelId: job.channelId, pageToken: next, page: page + 1 });
    return;
  }
  if (ch) {
    // Channel finished: drop videos deleted on YouTube since this scan started.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM video_links WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ? AND last_seen < ?)').bind(
        ch.id,
        scan.created_at,
      ),
      env.DB.prepare('DELETE FROM videos WHERE channel_id = ? AND last_seen < ?').bind(ch.id, scan.created_at),
      env.DB.prepare('UPDATE channels SET fetched_at = ?, video_count = (SELECT COUNT(*) FROM videos WHERE channel_id = ?) WHERE id = ?').bind(
        now(),
        ch.id,
        ch.id,
      ),
    ]);
  }
  const r = await env.DB.prepare('UPDATE scans SET pending_fetch = pending_fetch - 1, updated_at = ? WHERE id = ? RETURNING pending_fetch')
    .bind(now(), scan.id)
    .first<{ pending_fetch: number }>();
  if ((r?.pending_fetch ?? 0) <= 0) {
    const channels = scan.channels ? (JSON.parse(scan.channels) as string[]) : undefined;
    await startChecks(env, scan.id, await workspaceUrls(env, scan.workspace_id, ago(FRESH.full), { channels }));
  }
}

type Checked = Omit<LinkResult, 'prevFinalUrl' | 'checkedAt'>;

async function saveResults(env: Env, scanId: number, results: Checked[]) {
  const stmts = [];
  if (results.length) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO links (url, outcome, status, final_url, chain, parked, note, first_seen, checked_at)
         SELECT value->>'url', value->>'outcome', value->>'status', value->>'finalUrl', value->>'chain',
                COALESCE(value->>'parked', 0), value->>'note', ?1, ?1
         FROM json_each(?2) WHERE true
         ON CONFLICT (url) DO UPDATE SET
           prev_final_url = CASE WHEN excluded.outcome = 'final' AND links.outcome = 'final' AND links.final_url != excluded.final_url
                                 THEN links.final_url ELSE links.prev_final_url END,
           outcome = excluded.outcome, status = excluded.status, final_url = excluded.final_url,
           chain = excluded.chain, parked = excluded.parked, note = excluded.note, checked_at = excluded.checked_at`,
      ).bind(now(), JSON.stringify(results)),
    );
  }
  stmts.push(
    env.DB.prepare(
      'UPDATE scans SET done = done + ?1, recent = COALESCE(?2, recent), updated_at = ?3 WHERE id = ?4 RETURNING done, total',
    ).bind(
      results.length,
      results.length ? JSON.stringify(results.map((r) => ({ u: r.url, o: r.outcome, s: r.status }))) : null,
      now(),
      scanId,
    ),
  );
  const out = await env.DB.batch<{ done: number; total: number }>(stmts);
  const prog = out[out.length - 1]?.results[0];
  if (prog && prog.done >= prog.total) await finish(env, scanId);
}

async function handleCheck(env: Env, job: Extract<Job, { t: 'check' }>) {
  const scan = await getScan(env, job.scanId);
  if (!scan || scan.status !== 'checking') return;
  const { io, budget } = makeFetcher();
  const results: Checked[] = [];
  const deferred: CheckItem[] = [];
  const giveUp = (url: string, note: string): Checked => ({
    url,
    outcome: 'unverifiable',
    status: null,
    finalUrl: url,
    chain: [],
    parked: false,
    note,
  });

  for (const item of job.items) {
    if (SUBREQUEST_BUDGET - budget.used < MIN_BUDGET_TO_START) {
      deferred.push(item);
      continue;
    }
    try {
      results.push(await checkUrl(item.url, io));
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) {
        results.push(giveUp(item.url, 'internal error while checking'));
        console.error('check failed', item.url, e);
        continue;
      }
      const tries = (item.tries ?? 0) + 1;
      if (tries >= MAX_TRIES) results.push(giveUp(item.url, 'needed too many requests to verify'));
      else deferred.push({ url: item.url, tries });
    }
  }
  if (deferred.length) await env.JOBS.send({ t: 'check', scanId: scan.id, items: deferred });
  await saveResults(env, scan.id, results);
}

export async function handleJob(env: Env, job: Job) {
  try {
    if (job.t === 'fetch') await handleFetch(env, job);
    else await handleCheck(env, job);
  } catch (e) {
    if (e instanceof QuotaError || e instanceof HttpError) {
      await fail(env, job.scanId, e.message);
      return;
    }
    throw e;
  }
}

// ---------- estimates shown before a run ----------

const DEFAULT_SECS_PER_LINK = 2;
const SECS_PER_PAGE = 3;

/** Inputs for the Rescan menu: how many links each run would check, quota cost, and timing. */
export async function estimates(env: Env, workspaceId: string) {
  const [counts, units, quota, speed] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS links,
              COALESCE(SUM(l.url IS NULL OR l.checked_at < ?2), 0) AS staleDay,
              COALESCE(SUM(l.url IS NULL OR l.checked_at < ?3), 0) AS staleHour
       FROM (SELECT DISTINCT vl.url AS url FROM video_links vl JOIN videos v ON v.id = vl.video_id
             JOIN workspace_channels wc ON wc.channel_id = v.channel_id WHERE wc.workspace_id = ?1) w
       LEFT JOIN links l ON l.url = w.url`,
    ).bind(workspaceId, ago(FRESH.full), ago(FRESH.all)),
    env.DB.prepare(
      `SELECT COALESCE(SUM(MAX(1, (c.video_count + 49) / 50)), 0) AS pages FROM channels c
       JOIN workspace_channels wc ON wc.channel_id = c.id WHERE wc.workspace_id = ?`,
    ).bind(workspaceId),
    env.DB.prepare('SELECT units FROM quota WHERE day = ?').bind(today()),
    // Measured speed of recent finished scans (all workspaces share one queue).
    env.DB.prepare(
      `SELECT AVG((julianday(finished_at) - julianday(checking_started_at)) * 86400.0 / total) AS spl
       FROM (SELECT * FROM scans WHERE status = 'done' AND total >= 20 AND checking_started_at IS NOT NULL ORDER BY id DESC LIMIT 10)`,
    ),
  ]);
  const c = counts!.results[0] as { links: number; staleDay: number; staleHour: number };
  const pages = (units!.results[0] as { pages: number }).pages;
  const used = (quota!.results[0] as { units?: number } | undefined)?.units ?? 0;
  const limit = Number(env.GLOBAL_DAILY_UNITS ?? 8000);
  const spl = (speed!.results[0] as { spl: number | null }).spl;
  return {
    links: c.links,
    staleDay: c.staleDay,
    staleHour: c.staleHour,
    fullScanUnits: pages * 2, // playlistItems + videos per page of 50
    fullScanPages: pages,
    quotaLeft: Math.max(0, limit - used),
    quotaLimit: limit,
    secsPerLink: spl && spl > 0.2 && spl < 60 ? spl : DEFAULT_SECS_PER_LINK,
    secsPerPage: SECS_PER_PAGE,
  };
}

// ---------- recovery sweep (cron) ----------

const STALL_MS = 10 * 60_000;
const FETCH_STALL_MS = 20 * 60_000;
const MAX_RESUMES = 3;

/**
 * Queue messages can be lost (a message that fails every retry is dropped), which would
 * leave a scan stuck. Every few minutes, re-queue whatever a stalled scan hasn't checked.
 */
export async function sweepStalledScans(env: Env) {
  const stalled = (
    await env.DB.prepare("SELECT * FROM scans WHERE status IN ('fetching', 'checking') AND updated_at < ? ORDER BY id LIMIT 5")
      .bind(ago(STALL_MS))
      .all<ScanRow>()
  ).results;
  for (const scan of stalled) {
    if (scan.status === 'fetching') {
      if (scan.updated_at < ago(FETCH_STALL_MS)) await fail(env, scan.id, 'Fetching videos stalled. Please start the scan again.');
      continue;
    }
    if (scan.resumes >= MAX_RESUMES) {
      await fail(env, scan.id, 'The scan stopped making progress. Please try again.');
      continue;
    }
    const remaining = (
      await env.DB.prepare(
        `SELECT t.value AS url FROM json_each(?1) t LEFT JOIN links l ON l.url = t.value
         WHERE l.url IS NULL OR l.checked_at < ?2`,
      )
        .bind(scan.urls ?? '[]', scan.checking_started_at ?? scan.created_at)
        .all<{ url: string }>()
    ).results.map((r) => r.url);
    if (!remaining.length) {
      await finish(env, scan.id);
      continue;
    }
    console.log(`resuming scan ${scan.id}: ${remaining.length} links left`);
    await env.DB.prepare('UPDATE scans SET done = total - ?, resumes = resumes + 1, updated_at = ? WHERE id = ?')
      .bind(remaining.length, now(), scan.id)
      .run();
    await enqueueChecks(env, scan.id, remaining);
  }
}
