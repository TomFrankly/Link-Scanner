// App-wide default rules. Changed with a deploy; every workspace gets them unless it
// turns one off. Workspace-specific entries live in the `rules` table.
// Used by both sides: api.ts validates new rules against these defaults, and the web UI
// combines them with the workspace's own rules (effectiveRules) before classifying links.
import type { Rules } from './core.ts';

/** Domain moves that are known and fine: a link from the first that lands on the second is OK. */
export const DEFAULT_ACCEPTED: [string, string][] = [
  ['twitter.com', 'x.com'],
];

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

/** Defaults minus the ones this workspace turned off, plus its own rules. Pure. */
export function effectiveRules(own: RuleRow[]): Rules {
  const disabled = new Set(own.filter((r) => r.type === 'disabled').map((r) => `${r.value}:${r.value2}`));
  return {
    accepted: [
      ...DEFAULT_ACCEPTED.filter((p) => !disabled.has(`accepted:${acceptedKey(p)}`)),
      ...own.filter((r) => r.type === 'accepted').map((r) => [r.value, r.value2 ?? ''] as [string, string]),
    ],
    redirectors: [
      ...DEFAULT_REDIRECTORS.filter((d) => !disabled.has(`redirector:${d}`)),
      ...own.filter((r) => r.type === 'redirector').map((r) => r.value),
    ],
    ignored: own.filter((r) => r.type === 'ignored').map((r) => r.value),
  };
}
