// App state, shared by every screen. Three exports hold it:
// - `app`: what the server sent (signed-in user, current workspace, its report) and the route.
// - `data`: rows derived from the report, classified with this workspace's rules.
// - `ui`: which dialog is open, and requests to open a video in the Videos view.
// The functions below are the only places that change server data; they call the Worker
// through api.ts and then patch `app.report` so the screens update without a full reload.
//
// Rules are applied in the browser, so editing an exception list
// reclassifies every link instantly without asking the server to recheck anything.
import { toast } from 'svelte-sonner';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { classify, cleanDomain, hostOf, type LinkResult, type Rules } from '$shared/core';
import { FIXABLE } from '$shared/fixes';
import { effectiveRules, type RuleRow, type RuleType } from '$shared/rules';
import type { FoundEdit, TextEdit } from '$shared/textEdits';
import { api } from './api';
import { FixBook } from './fixbook';
import type { LinkFix, Me, Report, Row, ScanState, VideoRef } from './types';

export type Route = 'report' | 'exceptions' | 'channels' | 'members' | 'admin';
// Pages live in the URL hash (#/exceptions), so reloads and the back button keep your place.
const ROUTES: Route[] = ['report', 'exceptions', 'channels', 'members', 'admin'];

const routeFromHash = (): Route => {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'report';
};

/** Server data and the current page. `report` is null while it loads or after a workspace switch. */
export const app = $state({
  me: null as Me | null,
  bootError: null as string | null,
  wsId: null as string | null,
  report: null as Report | null,
  loadingReport: false,
  route: routeFromHash(),
});

/**
 * Which link's fix dialog is open, and on which scope ('' = every channel). `openVideo` asks
 * the report to open a video in its Videos view on a tab (and, with `url`, scroll its description
 * to that link); the report clears it once handled.
 */
export const ui = $state({
  fixLinkUrl: null as string | null,
  fixLinkChannel: '',
  openVideo: null as { id: string; tab: 'links' | 'description'; url?: string } | null,
  /** Whether the Help dialog (help/HelpDialog.svelte) is open; the sidebar's Help item opens it. */
  help: false,
  /** The Help page to show; null shows the page list (the start screen on phones). */
  helpPage: null as HelpPage | null,
  /** The Wayback Machine link shown in the preview lightbox (ArchivePreview.svelte), or null. */
  archivePreview: null as string | null,
});

/** The pages of the Help dialog (help/HelpDialog.svelte). */
export type HelpPage = 'tour' | 'scan' | 'runs' | 'privacy' | 'verify' | 'studio';

/** Opens Help on one page, e.g. the Studio tab page from the button beside "Copy & open Studio". */
export function openHelp(page: HelpPage) {
  ui.helpPage = page;
  ui.help = true;
}

/** A value kept in localStorage (per browser), e.g. a pane width. Falls back quietly when storage is blocked. */
export function stored<T>(key: string, fallback: T): { value: T } {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(`lc:${key}`);
    if (raw !== null) initial = JSON.parse(raw) as T;
  } catch {}
  const box = $state({ value: initial });
  $effect.root(() => {
    $effect(() => {
      const v = JSON.stringify(box.value);
      try {
        localStorage.setItem(`lc:${key}`, v);
      } catch {}
    });
  });
  return box;
}

/**
 * The app layout the user has set, remembered per browser: the sidebar ('auto' is a rail in
 * narrow windows and full width otherwise), the widths (px) of the report's list pane and of the
 * links list beside a description, and whether the list pane is collapsed (focus mode). Widths
 * are clamped to fit wherever they're used.
 */
export const layout = {
  sidebar: stored<'auto' | 'open' | 'rail'>('sidebar', 'auto'),
  listWidth: stored('listWidth', 340),
  listCollapsed: stored('listCollapsed', false),
  linksWidth: stored('linksWidth', 256),
};

window.addEventListener('hashchange', () => (app.route = routeFromHash()));
/** Navigates to a page; the hashchange listener above updates `app.route`. */
export const go = (route: Route) => (location.hash = `/${route}`);

/** A link's redirect chain arrives as JSON text; a bad value just means "no hops known". */
const parseChain = (json: string): LinkResult['chain'] => {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
};

/**
 * Expands the report's compact lists into one entry per unique link, with its check result
 * (null if never checked) and every video that uses it. Classification happens separately,
 * so changing a rule doesn't redo this work.
 */
function buildBase(report: Report | null): Omit<Row, 'cls'>[] {
  if (!report) return [];
  const videos = new Map<string, VideoRef>(report.videos.map((v) => [v.id, { id: v.id, title: v.t, channelId: v.c, publishedAt: v.p ?? null }]));
  const byUrl = new Map<string, VideoRef[]>();
  for (const { v, u } of report.videoLinks) {
    const ref = videos.get(v);
    if (!ref) continue;
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u)!.push(ref);
  }
  const results = new Map<string, LinkResult>(
    report.links.map((l) => [
      l.url,
      { ...l, parked: !!l.parked, chain: parseChain(l.chain) },
    ]),
  );
  return [...byUrl].map(([url, vids]) => ({ url, host: hostOf(url), result: results.get(url) ?? null, videos: vids }));
}

// A class because Svelte 5 can't export a bare `$derived` from a module; its fields can be.
// Each layer recomputes only when its inputs change:
// - `base` only when a new report arrives,
// - `rules` and `rows` whenever a rule is added or removed (this is the instant reclassify),
// - `fixes` when a planned fix changes.
class Derived {
  base = $derived(buildBase(app.report));
  rules: Rules = $derived(app.report ? effectiveRules(app.report.rules, app.report.defaults) : { accepted: [], redirectors: [], ignored: [], working: [] });
  rows: Row[] = $derived(this.base.map((r) => ({ ...r, cls: classify(r.result, r.url, this.rules) })));
  fixes = $derived(new FixBook(app.report?.fixes ?? []));
  /** Each video's channel id, for channel-scoped fixes and edits. */
  channelOf = $derived(new Map((app.report?.videos ?? []).map((v) => [v.id, v.c])));
  /** Channel names by id. */
  channelTitle = $derived(Object.fromEntries((app.report?.channels ?? []).map((c) => [c.id, c.title])) as Record<string, string>);
}
/** Report rows and planned fixes, derived from `app.report`. Read-only: change `app.report` instead. */
export const data = new Derived();

const fail = (e: unknown) => toast.error((e as Error).message);

// Remembers the last workspace you opened, per browser.
const WORKSPACE_KEY = 'ytlinks-ws';

/** Loads the signed-in user, picks a workspace (the last one used, else the first) and loads its report. */
export async function boot() {
  try {
    app.me = await api<Me>('/me');
    const saved = (() => { try { return localStorage.getItem(WORKSPACE_KEY); } catch { return null; } })();
    const ids = app.me.workspaces.map((w) => w.id);
    app.wsId = saved && ids.includes(saved) ? saved : (ids[0] ?? null);
    if (app.wsId) await loadReport();
  } catch (e) {
    app.bootError = (e as Error).message;
  }
}

/** Switches to another workspace and remembers the choice. */
export async function switchWorkspace(id: string) {
  app.wsId = id;
  try { localStorage.setItem(WORKSPACE_KEY, id); } catch { /* private mode */ }
  app.report = null;
  await loadReport();
}

/** Fetches the current workspace's whole report again, e.g. after a scan finishes or a channel changes. */
export async function loadReport() {
  if (!app.wsId) return;
  app.loadingReport = true;
  descriptionCache = null; // a scan may have changed them
  try {
    app.report = await api<Report>(`/w/${app.wsId}`);
  } catch (e) {
    fail(e);
  } finally {
    app.loadingReport = false;
  }
}

/** Merges a scan status reply (from starting a scan or the banner's polling) into the loaded report. */
export function applyScanState(s: ScanState & { estimates?: Report['estimates'] }) {
  if (!app.report) return;
  if (s.estimates) app.report.estimates = s.estimates;
  app.report.scan = s.scan;
  app.report.usedToday = s.usedToday;
  app.report.limits = s.limits;
}

/**
 * Starts a scan: `full` fetches descriptions then checks links, `all` rechecks every link not
 * checked in the last hour, `urls` rechecks just `urls`. `channels` limits a full scan to those
 * channels, e.g. one that was just added. The ScanBanner notices the running scan and polls it.
 */
export async function startScan(kind: 'full' | 'all' | 'urls', urls?: string[], channels?: string[]) {
  try {
    const s = await api<ScanState>(`/w/${app.wsId}/scans`, { method: 'POST', body: { kind, urls, channels } });
    applyScanState(s);
    // The server finishes at once when every link was checked recently.
    if (s.scan?.status === 'done') {
      toast.success('Everything was checked recently, so nothing needed fetching.');
      await loadReport();
    }
  } catch (e) {
    fail(e);
  }
}

/**
 * Saves an exception rule, then adds it to the local report so `data.rows` reclassifies at once.
 * `value2` is the destination domain of an accepted redirect, or the rule key for a `disabled`
 * default. Returns whether it saved, so forms know when to clear.
 */
export async function addRule(type: RuleType, value: string, value2?: string, note?: string) {
  if (!app.report || !app.me) return false;
  // Same normalization as the server, so the local copy matches what was stored.
  if (type === 'accepted' || type === 'redirector') {
    value = cleanDomain(value);
    value2 = type === 'accepted' ? cleanDomain(value2 ?? '') : undefined;
  } else if (type === 'ignored') {
    // A full link with a path ignores just that link; anything else ignores the whole domain.
    value = /^https?:\/\/[^/]+\/./.test(value.trim()) ? value.trim() : cleanDomain(value);
  }
  try {
    const saved = await api<{ id: number }>(`/w/${app.wsId}/rules`, { method: 'POST', body: { type, value, value2, note } });
    // The server returns the existing id for a duplicate, so don't list it twice.
    if (!app.report.rules.some((x) => x.id === saved.id)) {
      const row: RuleRow = { id: saved.id, type, value, value2: value2 ?? null, note: note?.trim() || null, addedBy: app.me.email, addedAt: new Date().toISOString() };
      app.report.rules = [...app.report.rules, row];
    }
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

/** Deletes a rule. Removed locally first so the report updates at once; put back if the server refuses. */
export async function removeRule(id: number) {
  if (!app.report) return;
  const before = app.report.rules;
  app.report.rules = before.filter((r) => r.id !== id);
  try {
    await api(`/w/${app.wsId}/rules/${id}`, { method: 'DELETE' });
  } catch (e) {
    app.report.rules = before;
    fail(e);
  }
}

/**
 * The Wayback Machine copy of a link nearest to `at` (a date, e.g. when the first video using it
 * was published), or null if the archive has none. Errors show a toast and return undefined.
 */
export async function findArchivedCopy(url: string, at: string | null) {
  try {
    const stamp = at ? at.slice(0, 10).replaceAll('-', '') : undefined;
    const res = await api<{ snapshot: { url: string; timestamp: string } | null }>(`/w/${app.wsId}/wayback`, { method: 'POST', body: { url, at: stamp } });
    return res.snapshot;
  } catch (e) {
    fail(e);
    return undefined;
  }
}

/**
 * Descriptions fetched from YouTube this session, by video id, so switching tabs or reopening a
 * video doesn't spend another quota unit. A page reload fetches fresh copies. Reactive, so a
 * check (checkVideo) updates any editor showing that video.
 */
export const fetchedDescriptions = new SvelteMap<string, string>();
/** Videos being checked on YouTube (checkVideo), for the button's spinner. */
export const videoChecks = new SvelteSet<string>();

/**
 * After a description was fixed in YouTube Studio: reads it from YouTube again (1 unit) and
 * updates the report as a scan would (worker scan.ts refreshVideo). If no problem link is left,
 * the video drops out of "Needs attention". Says which links are left otherwise, or that YouTube
 * still has the old text (a save in Studio can take a moment to reach the API).
 */
export async function checkVideo(video: VideoRef) {
  if (videoChecks.has(video.id)) return;
  videoChecks.add(video.id);
  try {
    const res = await api<{ description: string; changed: boolean }>(`/w/${app.wsId}/videos/${encodeURIComponent(video.id)}/refresh`, { method: 'POST', body: {} });
    fetchedDescriptions.set(video.id, res.description);
    await loadReport();
    const left = data.rows.filter((r) => FIXABLE.includes(r.cls.category) && r.videos.some((v) => v.id === video.id));
    const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '');
    if (!left.length) toast.success('Fixed. YouTube has no problem links left in this video.', { description: video.title });
    else if (!res.changed)
      toast.info('YouTube still has the description from before.', { description: 'If you just saved it in Studio, give it a minute and check again.', duration: 8000 });
    else
      toast.warning(`${left.length} problem link${left.length === 1 ? ' is' : 's are'} still in this video on YouTube`, {
        description: left.slice(0, 3).map((r) => short(r.url)).join(', ') + (left.length > 3 ? `, and ${left.length - 3} more` : ''),
        duration: 8000,
      });
  } catch (e) {
    fail(e);
  } finally {
    videoChecks.delete(video.id);
  }
}

/** Links whose Wayback Machine lookup is running, for the spinners in the Links list and the link pane. */
export const archiveLookups = new SvelteSet<string>();

/**
 * Looks up the archived copy of `url` nearest to `at` and plans it as the replacement. The lookup
 * takes 10–20 seconds, so it runs here rather than in a menu, and the list shows it's running: you
 * can carry on with other links. The toast at the end names the link and opens a preview.
 */
export async function planArchivedCopy(url: string, at: string | null) {
  if (archiveLookups.has(url)) return;
  archiveLookups.add(url);
  try {
    const snap = await findArchivedCopy(url, at);
    if (snap === undefined) return;
    const short = url.replace(/^https?:\/\/(www\.)?/, '');
    if (!snap) return void toast.info(`The Wayback Machine has no saved copy of ${short}.`);
    if (!(await setFix(url, 'replace', snap.url, { quiet: true }))) return;
    toast.success(`Planned the Wayback Machine copy from ${waybackDate(snap.timestamp)}`, {
      description: short,
      action: { label: 'Preview', onClick: () => (ui.archivePreview = snap.url) },
      duration: 10_000,
    });
  } finally {
    archiveLookups.delete(url);
  }
}

/** A Wayback Machine link's parts: when it was saved (YYYYMMDDhhmmss) and the page it saved. */
export function waybackParts(url: string) {
  const m = /^https?:\/\/web\.archive\.org\/web\/(\d{8,14})[a-z_]*\/(.+)$/.exec(url);
  return m ? { timestamp: m[1], original: m[2] } : null;
}
/** "Nov 27, 2022" from a Wayback timestamp. */
export function waybackDate(t: string) {
  return new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8))).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Every video's saved description (full scans save them), keyed by video id. Costs no YouTube
 * quota. Kept for a few minutes per workspace, since the quick edit asks on every selection and
 * descriptions only change when a scan runs.
 */
let descriptionCache: { ws: string | null; at: number; map: Promise<Map<string, { d: string | null; at: string | null }>> } | null = null;
const DESCRIPTION_CACHE_MS = 5 * 60_000;
export function loadDescriptions() {
  if (descriptionCache?.ws === app.wsId && Date.now() - descriptionCache.at < DESCRIPTION_CACHE_MS) return descriptionCache.map;
  const map = api<{ descriptions: { id: string; d: string | null; at: string | null }[] }>(`/w/${app.wsId}/descriptions`).then(
    (res) => new Map(res.descriptions.map((x) => [x.id, { d: x.d, at: x.at }])),
  );
  descriptionCache = { ws: app.wsId, at: Date.now(), map };
  map.catch(() => (descriptionCache = null));
  return map;
}

/** Saves hand edits as text edits; `videos` null applies one to every video with its text. */
export async function saveTextEdits(edits: (FoundEdit & { videos: string[] | null; channelId?: string | null })[]) {
  if (!app.report) return false;
  try {
    const res = await api<{ textEdits: TextEdit[] }>(`/w/${app.wsId}/text-edits`, { method: 'POST', body: { edits } });
    app.report.textEdits = res.textEdits;
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

/** Deletes a saved text edit, from every video it applied to. */
export async function removeTextEdit(id: number) {
  if (!app.report) return;
  try {
    const res = await api<{ textEdits: TextEdit[] }>(`/w/${app.wsId}/text-edits/${id}`, { method: 'DELETE' });
    app.report.textEdits = res.textEdits;
    toast.success('Saved edit removed');
  } catch (e) {
    fail(e);
  }
}

/**
 * Plans a fix for a link (used when generating corrected descriptions), or clears it, for every
 * channel or just `channelId`. `quiet` skips the toast.
 */
export async function setFix(
  url: string,
  action: 'remove' | 'replace' | 'clear',
  replacement?: string,
  { quiet = false, channelId = '' }: { quiet?: boolean; channelId?: string } = {},
) {
  if (!app.report) return false;
  try {
    const res = await api<{ fixes: LinkFix[] }>(`/w/${app.wsId}/fixes`, { method: 'POST', body: { url, action, replacement, channelId } });
    app.report.fixes = res.fixes;
    if (!quiet) toast.success(action === 'clear' ? 'Planned fix cleared' : action === 'remove' ? 'Marked for removal' : 'Replacement saved');
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
