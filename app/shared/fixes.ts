// Rewrites a video description to deal with its problem links. Pure functions, used by the
// "Fix description" panel; the result is copied into YouTube Studio by hand (the app
// has no write access to YouTube). No I/O here, and shared/fixes.test.ts covers it.
import { hostOf, type Category } from './core.ts';

/** A link the report flagged, as the fix functions need it. */
export interface Problem {
  url: string;
  category: Category;
  finalUrl?: string | null;
  detail?: string | null;
}

/** A run of output text; `hl` marks text the fix changed, for the preview. */
export interface Part {
  text: string;
  hl?: boolean;
}

/** The rewritten description, how many links changed, and the same text split for highlighting. */
export interface FixResult {
  text: string;
  changed: number;
  parts: Part[];
  /**
   * For each line of `text`, the index of the input line it came from. Removing a link can drop
   * a line, so this lets a hand edit of the output be traced back to the input (textEdits.ts).
   */
  origin: number[];
}

/** Categories the Fix description panel offers to fix. */
export const FIXABLE: Category[] = ['broken', 'parked', 'domain-changed', 'destination-changed', 'homepage'];
/** Fixable categories where the link still works but lands somewhere new. */
export const REDIRECTS: Category[] = ['domain-changed', 'destination-changed', 'homepage'];

/** Short reason for a problem link, e.g. "redirects to notion.com": the editor's flag, the export's FIX THIS marker. */
export function reasonFor(p: Problem): string {
  if (p.category === 'parked') return 'parked domain';
  if (p.category === 'homepage') return 'goes to homepage';
  if (p.category === 'domain-changed' || p.category === 'destination-changed') {
    const host = p.finalUrl ? hostOf(p.finalUrl) : '';
    return host ? `redirects to ${host}` : 'redirects elsewhere';
  }
  return 'broken';
}

// Same tokenizing as extractUrls in core.ts, so a URL only matches where the extractor saw
// exactly that URL: never inside a longer URL it's a prefix of, and trailing punctuation stays.
const URL_RE = /https?:\/\/[^\s<>"'\u200B]+/gi;
function trimUrl(u: string) {
  while (/[.,;:!?'"\])}>]$/.test(u)) {
    if (u.endsWith(')') && (u.match(/\(/g) || []).length >= (u.match(/\)/g) || []).length) break;
    u = u.slice(0, -1);
  }
  return u;
}

/** Every URL in a piece of text, tokenized like the extractor, with where it starts and ends. */
export function urlsIn(text: string): { url: string; start: number; end: number }[] {
  return [...text.matchAll(URL_RE)].map((m) => {
    const url = trimUrl(m[0]);
    return { url, start: m.index, end: m.index + url.length };
  });
}

interface Line {
  parts: Part[];
  hits: number;
  /** Hits replaced with nothing, which make the line need tidying. */
  removed: number;
}

/** Splits into lines, swapping each problem URL for `pick(problem)` (null leaves it alone). */
function rewriteLines(desc: string, problems: Problem[], pick: (p: Problem) => string | null): Line[] {
  const byUrl = new Map(problems.map((p) => [p.url, p]));
  return desc.split('\n').map((line) => {
    const parts: Part[] = [];
    let hits = 0;
    let removed = 0;
    let last = 0;
    for (const m of line.matchAll(URL_RE)) {
      const u = trimUrl(m[0]);
      const p = byUrl.get(u);
      const replacement = p ? pick(p) : null;
      if (replacement === null) continue;
      if (m.index > last) parts.push({ text: line.slice(last, m.index) });
      parts.push({ text: replacement, hl: true });
      last = m.index + u.length; // only the trimmed URL is replaced; trailing punctuation stays
      hits++;
      if (!replacement) removed++;
    }
    if (last < line.length) parts.push({ text: line.slice(last) });
    return { parts, hits, removed };
  });
}

/** Joins lines back with newlines, dropping empty parts. `origin` is each line's input line index. */
function join(lines: Part[][], origin: number[]): Omit<FixResult, 'changed'> {
  const parts: Part[] = [];
  lines.forEach((l, i) => {
    if (i) parts.push({ text: '\n' });
    parts.push(...l.filter((p) => p.text));
  });
  return { text: parts.map((p) => p.text).join(''), parts, origin };
}

/** rewriteLines without any tidying: every swap is a plain substitution. */
function replaceWith(desc: string, problems: Problem[], pick: (p: Problem) => string | null): FixResult {
  const lines = rewriteLines(desc, problems, pick);
  return { ...join(lines.map((l) => l.parts), lines.map((_, i) => i)), changed: lines.reduce((n, l) => n + l.hits, 0) };
}

const marker = (p: Problem) => `[FIX THIS: ${p.url} (${reasonFor(p)})]`;

/** Swaps each problem URL for a `[FIX THIS: url (reason)]` marker. */
export function markForFixing(desc: string, problems: Problem[]): FixResult {
  return replaceWith(desc, problems, marker);
}

/** Points redirected links straight at where they end up now. Other problems are left alone. */
export function updateRedirects(desc: string, problems: Problem[]): FixResult {
  return replaceWith(desc, problems, (p) =>
    REDIRECTS.includes(p.category) && p.finalUrl && p.finalUrl !== p.url ? p.finalUrl : null,
  );
}

const blank = (s: string) => !s.trim();
const onlyPunctuation = (s: string) => /^[\s\p{P}\p{S}]*$/u.test(s);

/**
 * Deletes each problem URL. Lines left with nothing but punctuation (bullets, arrows, emoji)
 * are dropped; leftover labels like "Gear:" stay, which is why the marker option exists.
 * Only touched lines are tidied, so the rest of the description keeps its spacing.
 */
export function removeLinks(desc: string, problems: Problem[]): FixResult {
  return tidy(desc, rewriteLines(desc, problems, () => ''));
}

export interface Decision {
  action: 'remove' | 'replace';
  replacement?: string | null;
}

/**
 * Applies the workspace's per-link decisions: `replace` swaps in the new URL, and `remove`
 * deletes the link (tidied like removeLinks). Links nobody has decided on stay as they are (the
 * editor flags them without changing the text), or with `mark` get the FIX THIS marker, as in
 * the Excel export, where there's no other way to flag them.
 */
export function applyFixes(desc: string, problems: Problem[], decisions: Record<string, Decision>, { mark = false } = {}): FixResult {
  const lines = rewriteLines(desc, problems, (p) => {
    const d = Object.hasOwn(decisions, p.url) ? decisions[p.url] : undefined;
    if (d?.action === 'remove') return '';
    if (d?.action === 'replace' && d.replacement) return d.replacement;
    return mark ? marker(p) : null;
  });
  return tidy(desc, lines);
}

/** Joins rewritten lines, cleaning up only the lines a removal touched. */
function tidy(desc: string, lines: Line[]): FixResult {
  const originals = desc.split('\n');
  const out: { parts: Part[]; at: number; dropped?: boolean }[] = lines.map((l, i) => {
    const original = originals[i]!;
    if (!l.removed) return { parts: l.parts, at: i };
    let s = l.parts
      .map((p) => p.text)
      .join('')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .trimEnd();
    if (!/^\s/.test(original)) s = s.trimStart();
    return onlyPunctuation(s) ? { parts: [], at: i, dropped: true } : { parts: [{ text: s, hl: true }], at: i };
  });
  const textOf = (x: { parts: Part[] }) => x.parts.map((p) => p.text).join('');
  // Dropping a line that sat between two blank lines would leave a double gap.
  for (let i = 0; i < out.length; i++) {
    if (!out[i]!.dropped) continue;
    let j = i;
    while (j < out.length && out[j]!.dropped) j++;
    const before = out.slice(0, i).reverse().find((x) => !x.dropped);
    if (j < out.length && blank(textOf(out[j]!)) && (!before || blank(textOf(before)))) out[j]!.dropped = true;
    i = j;
  }
  const kept = out.filter((x) => !x.dropped);
  return { ...join(kept.map((x) => x.parts), kept.map((x) => x.at)), changed: lines.reduce((n, l) => n + l.hits, 0) };
}

/**
 * Where each needle occurs in `text`, for highlighting changes in a description the user has
 * since edited by hand. Sorted and non-overlapping; on overlap the longer needle wins.
 */
export function highlightRanges(text: string, needles: string[]): { start: number; end: number }[] {
  const taken: { start: number; end: number }[] = [];
  const sorted = [...new Set(needles.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const n of sorted) {
    for (let i = text.indexOf(n); i !== -1; i = text.indexOf(n, i + 1)) {
      const end = i + n.length;
      if (taken.some((r) => i < r.end && end > r.start)) continue;
      taken.push({ start: i, end });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}
