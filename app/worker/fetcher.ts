// Outbound link requests for one queue invocation: a subrequest budget (Workers Free allows
// 50, redirects included), per-host spacing, and a cap on how much of each body is read.
// scan.ts makes one fetcher per `check` message and hands its `io` to checkUrl in core.ts,
// which follows redirects one hop at a time through it.
//
// SSRF: the URLs come from video descriptions, which are untrusted input. Every hop
// (including each redirect and meta refresh) passes through `once`, so each one is checked
// by `forbidden` before it is fetched. Redirects are never followed by fetch itself
// (`redirect: 'manual'`), and core.ts stops after 10 hops. A public name that resolves to a
// private or loopback IP isn't caught here (Workers can't do DNS lookups); Cloudflare itself
// refuses those requests from a Worker, and a Worker has no private network to reach anyway.
import { hostOf, type Io, type Resp } from '../shared/core.ts';

export const SUBREQUEST_BUDGET = 40; // leaves headroom for D1, queue and Access calls
const BODY_LIMIT = 16 * 1024; // enough to see a meta refresh or a parked-domain page
const TIMEOUT_MS = 15_000;
const DEFAULT_HOST_DELAY_MS = 1000;
// Sites known to rate-limit bots get more spacing between requests.
const HOST_DELAY_MS: Record<string, number> = {
  'amazon.com': 4000,
  'amzn.to': 3000,
  'linkedin.com': 5000,
  'instagram.com': 5000,
  'facebook.com': 5000,
};
// A browser user agent: many sites answer a bot UA with 403, which would read as broken.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Thrown when this invocation has no subrequests left; scan.ts re-queues the link. */
export class BudgetExceeded extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostDelay = (host: string) => {
  for (const [domain, ms] of Object.entries(HOST_DELAY_MS)) if (host === domain || host.endsWith(`.${domain}`)) return ms;
  return DEFAULT_HOST_DELAY_MS;
};

/**
 * Why a URL must not be fetched, or null if it may be. Only http(s); no localhost or
 * internal-looking names; no literal IPs. The URL parser has already normalized forms like
 * `http://2130706433/` or `http://0x7f.1/` to dotted IPv4, so the regex catches them too.
 */
function forbidden(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unsupported scheme';
  const h = url.hostname;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return 'local address';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return 'IP address';
  return null;
}

/** Reads at most about BODY_LIMIT bytes of a response body, then cancels the rest. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
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
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

/**
 * A fresh fetcher for one queue invocation. Returns `io` for checkUrl and the shared
 * `budget` counter, which scan.ts reads to decide when to stop starting new links.
 * A host that answers 429 is skipped for the rest of this invocation.
 */
export function makeFetcher() {
  const budget = { used: 0 };
  const lastRequestAt = new Map<string, number>();
  const blocked = new Set<string>();

  /** One request, no redirects followed. Never throws except BudgetExceeded. */
  async function once(url: string): Promise<Resp> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: 'invalid URL' };
    }
    const reason = forbidden(parsed);
    if (reason) return { error: `not fetched (${reason})` };
    const host = hostOf(url);
    if (blocked.has(host)) return { blocked: true };
    // Waiting doesn't count toward the CPU limit, only wall time.
    const wait = (lastRequestAt.get(host) ?? 0) + hostDelay(host) - Date.now();
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
      lastRequestAt.set(host, Date.now());
      if (res.status === 429) {
        res.body?.cancel().catch(() => {});
        blocked.add(host);
        return { status: 429, blocked: true };
      }
      let body = '';
      // Only text bodies are read (for meta refresh and parked-page detection).
      const isText = /text\/html|xml|text\/plain/.test(res.headers.get('content-type') ?? '');
      if (res.status === 200 && isText && res.body) {
        body = await readCapped(res.body);
      } else {
        res.body?.cancel().catch(() => {});
      }
      return { status: res.status, location: res.headers.get('location'), body };
    } catch (e) {
      lastRequestAt.set(host, Date.now());
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
