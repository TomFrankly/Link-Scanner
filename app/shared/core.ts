// Link-checking logic shared by the Worker (checking) and the web UI (classifying).
// Checking stores a raw, rule-free result per URL. Classification applies a workspace's
// rules to that raw result, so rule changes never need a refetch.

export interface Hop {
  u: string;
  s?: number | string; // HTTP status, or an error label
}

export type Outcome = 'final' | 'error' | 'unverifiable' | 'redirect-loop' | 'too-many-redirects';

/** What the checker stores per URL. Shared across workspaces. */
export interface LinkResult {
  url: string;
  outcome: Outcome;
  status: number | null;
  finalUrl: string;
  chain: Hop[];
  parked: boolean;
  note: string | null;
  prevFinalUrl: string | null;
  checkedAt: string;
}

export interface Rules {
  accepted: [string, string][];
  redirectors: string[];
  ignored: string[];
}

export type Category =
  | 'broken'
  | 'parked'
  | 'destination-changed'
  | 'domain-changed'
  | 'homepage'
  | 'unverifiable'
  | 'ok'
  | 'ignored'
  | 'pending';

export interface Classified {
  category: Category;
  detail?: string;
  accepted?: boolean;
}

// ---------- domains ----------
export const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};
export const matchesDomain = (host: string, list: string[]) =>
  list.some((d) => host === d || host.endsWith(`.${d}`));

export function baseDomain(host: string): string {
  const parts = host.split('.');
  const twoPart =
    /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2] ?? '') && (parts[parts.length - 1] ?? '').length === 2;
  return parts.slice(twoPart ? -3 : -2).join('.');
}

/** Normalizes user input like "https://www.Example.com/" to "example.com". */
export const cleanDomain = (s: string) =>
  s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

// ---------- extraction ----------
export function extractUrls(text: string, skipDomains: string[] = []): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'​]+/gi)) {
    let u = m[0];
    while (/[.,;:!?'"\])}>]$/.test(u)) {
      if (u.endsWith(')') && (u.match(/\(/g) || []).length >= (u.match(/\)/g) || []).length) break;
      u = u.slice(0, -1);
    }
    try {
      new URL(u);
    } catch {
      continue;
    }
    if (u.length > 2000 || matchesDomain(hostOf(u), skipDomains)) continue;
    out.add(u);
  }
  return [...out];
}

// ---------- classification ----------
const isIgnored = (url: string, rules: Rules) => {
  const h = hostOf(url);
  return rules.ignored.some((x) => (x.includes('/') ? x === url : matchesDomain(h, [x])));
};

export function classify(r: LinkResult | null, url: string, rules: Rules): Classified {
  if (isIgnored(url, rules)) return { category: 'ignored' };
  if (!r) return { category: 'pending' };

  if (r.outcome === 'error') return { category: 'broken', detail: r.note ?? 'request failed' };
  if (r.outcome === 'redirect-loop') return { category: 'broken', detail: 'redirect loop' };
  if (r.outcome === 'too-many-redirects') return { category: 'broken', detail: 'too many redirects' };
  if (r.outcome === 'unverifiable') return { category: 'unverifiable', detail: r.note ?? 'rate-limited' };

  const s = r.status ?? 0;
  if ([401, 403, 405, 429, 999].includes(s))
    return { category: 'unverifiable', detail: `HTTP ${s} (likely bot protection or a login wall)` };
  if (s >= 400) return { category: 'broken', detail: `HTTP ${s}` };
  if (r.parked) return { category: 'parked', detail: 'looks like a parked or for-sale domain' };

  const startHost = hostOf(url);
  const finalHost = hostOf(r.finalUrl);
  const fu = new URL(r.finalUrl);
  const su = new URL(url);
  const landsOnHome = (fu.pathname === '/' || fu.pathname === '') && !fu.search;
  const startedDeep = su.pathname.length > 1;

  if (matchesDomain(startHost, rules.redirectors)) {
    if (r.prevFinalUrl && hostOf(r.prevFinalUrl) !== finalHost)
      return { category: 'destination-changed', detail: `was ${hostOf(r.prevFinalUrl)}, now ${finalHost}` };
    if (landsOnHome && r.chain.length > 1) return { category: 'homepage', detail: 'short link lands on a homepage' };
    return { category: 'ok' };
  }
  if (baseDomain(startHost) !== baseDomain(finalHost)) {
    const accepted = rules.accepted.some(
      ([from, to]) => baseDomain(startHost) === baseDomain(from) && baseDomain(finalHost) === baseDomain(to),
    );
    if (accepted) return { category: 'ok', accepted: true };
    return { category: 'domain-changed', detail: `${startHost} → ${finalHost}` };
  }
  if (startedDeep && landsOnHome) return { category: 'homepage', detail: 'deep link now redirects to the homepage' };
  return { category: 'ok' };
}

// ---------- checking (I/O supplied by the caller) ----------
export interface Resp {
  status?: number;
  location?: string | null;
  body?: string;
  error?: string;
  blocked?: boolean;
}
export interface Io {
  request(url: string): Promise<Resp>;
}

export const PARKED =
  /(this domain (name )?(is|may be) for sale|domain is for sale|buy this domain|hugedomains|sedo\.com|afternic|parked (free|domain)|domain parking|is available for purchase|dan\.com)/i;

export async function checkUrl(startUrl: string, io: Io, maxHops = 10): Promise<Omit<LinkResult, 'prevFinalUrl' | 'checkedAt'>> {
  const chain: Hop[] = [];
  const seen = new Set<string>();
  let url = startUrl;
  const done = (outcome: Outcome, extra: Partial<LinkResult> = {}) => ({
    url: startUrl,
    outcome,
    status: null,
    finalUrl: chain[chain.length - 1]?.u ?? startUrl,
    chain,
    parked: false,
    note: null,
    ...extra,
  });
  for (let hop = 0; hop <= maxHops; hop++) {
    if (seen.has(url)) return done('redirect-loop');
    seen.add(url);
    const r = await io.request(url);
    if (r.blocked) {
      chain.push({ u: url, s: r.status ?? 429 });
      return done('unverifiable', { status: r.status ?? 429, note: 'rate-limited, host paused for this batch' });
    }
    if (r.error) {
      chain.push({ u: url, s: r.error });
      return done('error', { note: r.error });
    }
    const status = r.status ?? 0;
    chain.push({ u: url, s: status });
    let next: string | null = null;
    if (status >= 300 && status < 400 && r.location) {
      try {
        next = new URL(r.location, url).toString();
      } catch {
        /* bad Location header */
      }
    } else if (status === 200 && r.body) {
      const m = r.body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i);
      if (m) {
        try {
          next = new URL(m[1]!, url).toString();
        } catch {
          /* bad meta refresh */
        }
      }
    }
    if (!next) return done('final', { status, parked: status === 200 && PARKED.test(r.body ?? '') });
    url = next;
  }
  return done('too-many-redirects');
}
