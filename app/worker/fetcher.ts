// Outbound link requests for one queue invocation: a subrequest budget (Workers Free allows
// 50, redirects included), per-host spacing, and a cap on how much of each body is read.
import { hostOf, type Io, type Resp } from '../shared/core.ts';

export const SUBREQUEST_BUDGET = 40; // leaves headroom for D1, queue and Access calls
const BODY_LIMIT = 16 * 1024;
const TIMEOUT_MS = 15_000;
const DEFAULT_HOST_DELAY_MS = 1000;
const HOST_DELAY_MS: Record<string, number> = {
  'amazon.com': 4000,
  'amzn.to': 3000,
  'linkedin.com': 5000,
  'instagram.com': 5000,
  'facebook.com': 5000,
};
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export class BudgetExceeded extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostDelay = (host: string) => {
  for (const [d, ms] of Object.entries(HOST_DELAY_MS)) if (host === d || host.endsWith(`.${d}`)) return ms;
  return DEFAULT_HOST_DELAY_MS;
};

/** Literal IPs and local names are never fetched (descriptions are untrusted input). */
function forbidden(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unsupported scheme';
  const h = url.hostname;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return 'local address';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return 'IP address';
  return null;
}

export function makeFetcher() {
  const budget = { used: 0 };
  const lastAt = new Map<string, number>();
  const blocked = new Set<string>();

  async function once(url: string): Promise<Resp> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: 'invalid URL' };
    }
    const bad = forbidden(parsed);
    if (bad) return { error: `not fetched (${bad})` };
    const host = hostOf(url);
    if (blocked.has(host)) return { blocked: true };
    const wait = (lastAt.get(host) ?? 0) + hostDelay(host) - Date.now();
    if (wait > 0) await sleep(wait);
    if (budget.used >= SUBREQUEST_BUDGET) throw new BudgetExceeded();
    budget.used++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      lastAt.set(host, Date.now());
      if (res.status === 429) {
        res.body?.cancel().catch(() => {});
        blocked.add(host);
        return { status: 429, blocked: true };
      }
      let body = '';
      const isText = /text\/html|xml|text\/plain/.test(res.headers.get('content-type') ?? '');
      if (res.status === 200 && isText && res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (bytes < BODY_LIMIT) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          bytes += value.length;
        }
        reader.cancel().catch(() => {});
        const all = new Uint8Array(bytes);
        let off = 0;
        for (const c of chunks) {
          all.set(c, off);
          off += c.length;
        }
        body = new TextDecoder().decode(all);
      } else {
        res.body?.cancel().catch(() => {});
      }
      return { status: res.status, location: res.headers.get('location'), body };
    } catch (e) {
      lastAt.set(host, Date.now());
      const err = e as Error;
      return { error: err.name === 'AbortError' ? 'timeout' : `network error (${err.message})` };
    } finally {
      clearTimeout(timer);
    }
  }

  const io: Io = {
    async request(url) {
      const r = await once(url);
      if (r.error && !r.error.startsWith('not fetched')) return once(url); // one retry
      return r;
    },
  };
  return { io, budget };
}
