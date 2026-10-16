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
import { classify, cleanDomain, hostOf, type LinkResult, type Rules } from '$shared/core';
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
 * Which link's fix dialog is open, and on which scope ('' = every channel). `studioTab` opens
 * the Studio tab extension dialog. `openVideo` asks
 * the report to open a video in its Videos view on a tab (and, with `url`, scroll its description
 * to that link); the report clears it once handled.
 */
export const ui = $state({
  fixLinkUrl: null as string | null,
  fixLinkChannel: '',
  openVideo: null as { id: string; tab: 'links' | 'description'; url?: string } | null,
  /** Whether the Studio tab extension dialog (help/StudioTabDialog.svelte) is open. */
  studioTab: false,
  /** Whether the Help dialog (help/HelpButton.svelte) is open; the sidebar's Help item opens it. */
  help: false,
});

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
  rules: Rules = $derived(app.report ? effectiveRules(app.report.rules, app.report.defaults) : { accepted: [], redirectors: [], ignored: [] });
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

/** Every video's saved description (full scans save them), keyed by video id. Costs no YouTube quota. */
export async function loadDescriptions() {
  const res = await api<{ descriptions: { id: string; d: string | null; at: string | null }[] }>(`/w/${app.wsId}/descriptions`);
  return new Map(res.descriptions.map((x) => [x.id, { d: x.d, at: x.at }]));
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
