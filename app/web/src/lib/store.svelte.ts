// App state. Rules are applied in the browser, so editing an exception list
// reclassifies every link instantly without asking the server to recheck anything.
import { toast } from 'svelte-sonner';
import { classify, cleanDomain, hostOf, type LinkResult, type Rules } from '$shared/core';
import { effectiveRules, type RuleRow, type RuleType } from '$shared/rules';
import { api } from './api';
import type { LinkFix, Me, Report, Row, ScanState, VideoRef } from './types';

export type Route = 'report' | 'exceptions' | 'channels' | 'members' | 'admin';
const ROUTES: Route[] = ['report', 'exceptions', 'channels', 'members', 'admin'];

const routeFromHash = (): Route => {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'report';
};

export const app = $state({
  me: null as Me | null,
  bootError: null as string | null,
  wsId: null as string | null,
  report: null as Report | null,
  loadingReport: false,
  route: routeFromHash(),
});

/** Which link's fix dialog and which video's description drawer are open. */
export const ui = $state({ fixLinkUrl: null as string | null, drawerVideoId: null as string | null, drawerHeight: 0 });

window.addEventListener('hashchange', () => (app.route = routeFromHash()));
export const go = (r: Route) => (location.hash = `/${r}`);

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
      { ...l, parked: !!l.parked, chain: (() => { try { return JSON.parse(l.chain); } catch { return []; } })() },
    ]),
  );
  return [...byUrl].map(([url, vids]) => ({ url, host: hostOf(url), result: results.get(url) ?? null, videos: vids }));
}

class Derived {
  base = $derived(buildBase(app.report));
  rules: Rules = $derived(app.report ? effectiveRules(app.report.rules) : { accepted: [], redirectors: [], ignored: [] });
  rows: Row[] = $derived(this.base.map((r) => ({ ...r, cls: classify(r.result, r.url, this.rules) })));
  fixes = $derived(new Map<string, LinkFix>((app.report?.fixes ?? []).map((f) => [f.url, f])));
}
export const data = new Derived();

const fail = (e: unknown) => toast.error((e as Error).message);

export async function boot() {
  try {
    app.me = await api<Me>('/me');
    const saved = (() => { try { return localStorage.getItem('ytlinks-ws'); } catch { return null; } })();
    const ids = app.me.workspaces.map((w) => w.id);
    app.wsId = saved && ids.includes(saved) ? saved : (ids[0] ?? null);
    if (app.wsId) await loadReport();
  } catch (e) {
    app.bootError = (e as Error).message;
  }
}

export async function switchWorkspace(id: string) {
  app.wsId = id;
  try { localStorage.setItem('ytlinks-ws', id); } catch { /* private mode */ }
  app.report = null;
  await loadReport();
}

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

export function applyScanState(s: ScanState & { estimates?: Report['estimates'] }) {
  if (!app.report) return;
  if (s.estimates) app.report.estimates = s.estimates;
  app.report.scan = s.scan;
  app.report.usedToday = s.usedToday;
  app.report.limits = s.limits;
}

/** `channels` limits a full scan to those channels, e.g. one that was just added. */
export async function startScan(kind: 'full' | 'all' | 'urls', urls?: string[], channels?: string[]) {
  try {
    const s = await api<ScanState>(`/w/${app.wsId}/scans`, { method: 'POST', body: { kind, urls, channels } });
    applyScanState(s);
    if (s.scan?.status === 'done') {
      toast.success('Everything was checked recently, so nothing needed fetching.');
      await loadReport();
    }
  } catch (e) {
    fail(e);
  }
}

export async function addRule(type: RuleType, value: string, value2?: string, note?: string) {
  if (!app.report || !app.me) return false;
  // Same normalization as the server, so the local copy matches what was stored.
  if (type === 'accepted' || type === 'redirector') {
    value = cleanDomain(value);
    value2 = type === 'accepted' ? cleanDomain(value2 ?? '') : undefined;
  } else if (type === 'ignored') {
    value = /^https?:\/\/[^/]+\/./.test(value.trim()) ? value.trim() : cleanDomain(value);
  }
  try {
    const r = await api<{ id: number }>(`/w/${app.wsId}/rules`, { method: 'POST', body: { type, value, value2, note } });
    if (!app.report.rules.some((x) => x.id === r.id)) {
      const row: RuleRow = { id: r.id, type, value, value2: value2 ?? null, note: note?.trim() || null, addedBy: app.me.email, addedAt: new Date().toISOString() };
      app.report.rules = [...app.report.rules, row];
    }
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

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

/** Plans a fix for a link (used when generating corrected descriptions), or clears it. */
export async function setFix(url: string, action: 'remove' | 'replace' | 'clear', replacement?: string) {
  if (!app.report) return false;
  try {
    const r = await api<{ fixes: LinkFix[] }>(`/w/${app.wsId}/fixes`, { method: 'POST', body: { url, action, replacement } });
    app.report.fixes = r.fixes;
    toast.success(action === 'clear' ? 'Planned fix cleared' : action === 'remove' ? 'Marked for removal' : 'Replacement saved');
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
