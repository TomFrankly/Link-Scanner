// App-wide default rules. Changed with a deploy; every workspace gets them unless it
// turns one off. Workspace-specific entries live in the `rules` table.
// A deployment can add accepted redirects of its own with the EXTRA_ACCEPTED_REDIRECTS var
// (parsed by parseAcceptedList). api.ts merges them in (appDefaults), validates new rules
// against the result and sends it with the report; the web UI combines those defaults with
// the workspace's own rules (effectiveRules) before classifying links.
import { cleanDomain, type Rules } from './core.ts';

/** Domain moves that are known and fine: a link from the first that lands on the second is OK. */
export const DEFAULT_ACCEPTED: [string, string][] = [['twitter.com', 'x.com']];

/** Link shorteners: landing on another domain is their job, so only a changed destination is flagged. */
export const DEFAULT_REDIRECTORS = [
  'bit.ly', 'amzn.to', 'amzn.com', 'ow.ly', 't.co', 'goo.gl', 'tinyurl.com', 'rebrand.ly', 'buff.ly',
  'lnkd.in', 'is.gd', 'cutt.ly', 'shorturl.at', 'geni.us', 'tidd.ly', 'rb.gy', 't.ly',
];

/** Links to these are never checked (YouTube itself is covered by the API, not fetched). */
export const SKIP_DOMAINS = ['youtube.com', 'youtu.be'];

export type RuleType = 'accepted' | 'redirector' | 'ignored' | 'disabled';

/** A workspace rule as stored. `disabled` turns off a default: value is its kind, value2 its key. */
export interface RuleRow {
  id: number;
  type: RuleType;
  value: string;
  value2: string | null;
  note: string | null;
  addedBy: string;
  addedAt: string;
}

/** The key that identifies an accepted pair in a `disabled` rule, e.g. "twitter.com>x.com". */
export const acceptedKey = ([from, to]: [string, string]) => `${from}>${to}`;

/** The app-wide defaults, as the report sends them to the browser. */
export interface Defaults {
  accepted: [string, string][];
  redirectors: string[];
}

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Parses a list of accepted redirects like "old.com>new.com, other.com>new.com" (commas or
 * newlines between pairs). Each side goes through cleanDomain; malformed entries are skipped.
 */
export function parseAcceptedList(list: string | undefined): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of (list ?? '').split(/[,\n]/)) {
    const sides = entry.split('>');
    if (sides.length !== 2) continue;
    const from = cleanDomain(sides[0]!);
    const to = cleanDomain(sides[1]!);
    if (DOMAIN_RE.test(from) && DOMAIN_RE.test(to) && from !== to) out.push([from, to]);
  }
  return out;
}

/** The built-in defaults plus a deployment's extra accepted redirects, without duplicates. */
export function appDefaults(extraAccepted?: string): Defaults {
  const accepted = new Map(DEFAULT_ACCEPTED.map((p) => [acceptedKey(p), p] as const));
  for (const p of parseAcceptedList(extraAccepted)) if (!accepted.has(acceptedKey(p))) accepted.set(acceptedKey(p), p);
  return { accepted: [...accepted.values()], redirectors: DEFAULT_REDIRECTORS };
}

/**
 * Defaults minus the ones this workspace turned off, plus its own rules. Pure. Pass the
 * defaults the server sent (report.defaults), which include the deployment's extras;
 * without them only the built-in defaults apply.
 */
export function effectiveRules(own: RuleRow[], defaults: Defaults = appDefaults()): Rules {
  const disabled = new Set(own.filter((r) => r.type === 'disabled').map((r) => `${r.value}:${r.value2}`));
  return {
    accepted: [
      ...defaults.accepted.filter((p) => !disabled.has(`accepted:${acceptedKey(p)}`)),
      ...own.filter((r) => r.type === 'accepted').map((r) => [r.value, r.value2 ?? ''] as [string, string]),
    ],
    redirectors: [
      ...defaults.redirectors.filter((d) => !disabled.has(`redirector:${d}`)),
      ...own.filter((r) => r.type === 'redirector').map((r) => r.value),
    ],
    ignored: own.filter((r) => r.type === 'ignored').map((r) => r.value),
  };
}
