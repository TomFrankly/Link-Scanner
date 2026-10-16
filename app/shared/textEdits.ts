// Saved hand edits ("text edits"): find-and-replace rules a workspace keeps for its descriptions.
//
// When someone edits a description by hand in the Fix description drawer and saves,
// editsFromHandEdit works out which lines they changed and turns each change into a rule:
// "these lines become those lines". The drawer then offers to apply the same rule to every
// other video whose description has the same lines, like a footer or sponsor block.
//
// Rules match whole lines, never part of a line, so changing "2025" in one sentence can't
// change every "2025" everywhere. Spacing differences (extra spaces, leading or trailing
// whitespace) don't stop a match. Rules run on the description as YouTube has it, oldest
// rule first, and the planned link fixes (fixes.ts) run after them.
//
// A change that only swaps one link for another is better saved as a planned link fix, which
// replaces the link in every video whatever text surrounds it; splitLinkSwaps finds those.
//
// Pure functions, used by the drawer and the Excel export; shared/textEdits.test.ts covers them.
import { urlsIn } from './fixes.ts';

/** A saved text edit, as the API returns it. */
export interface TextEdit {
  id: number;
  /** One or more whole lines, joined with \n. */
  find: string;
  /** The lines to put in their place, joined with \n. Empty deletes the lines. */
  replace: string;
  /** The videos it applies to, or null for every video where `find` appears (including future ones). */
  videos: string[] | null;
  /** Limits it to one channel's videos; null for every channel. */
  channelId?: string | null;
  addedBy: string;
  addedAt: string;
}

/** A change found in a hand edit, before it's saved. */
export interface FoundEdit {
  find: string;
  replace: string;
}

/** Lines compare equal when they match after trimming and collapsing runs of whitespace. */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
const blank = (s: string) => !s.trim();
/** Splits a rule's text into lines; empty text is no lines (so an empty `replace` deletes). */
const toLines = (s: string) => (s === '' ? [] : s.split('\n'));

type Scope = Pick<TextEdit, 'videos' | 'channelId'>;
export const appliesTo = (e: Scope, videoId: string, channelId: string) =>
  (!e.videos || e.videos.includes(videoId)) && (!e.channelId || e.channelId === channelId);

/** Whether `find` (whole lines) starts at line `i`. */
function matchAt(lines: string[], find: string[], i: number) {
  if (i + find.length > lines.length) return false;
  for (let k = 0; k < find.length; k++) if (norm(lines[i + k]!) !== norm(find[k]!)) return false;
  return true;
}

/** Whether a description contains `find` as whole lines. */
export function contains(desc: string, find: string): boolean {
  const lines = desc.split('\n');
  const f = toLines(find);
  if (!f.length) return false;
  for (let i = 0; i + f.length <= lines.length; i++) if (matchAt(lines, f, i)) return true;
  return false;
}

export interface EditResult {
  text: string;
  /** How many places a rule changed. */
  changed: number;
  /** Non-blank lines the rules wrote, for highlighting them in the drawer. */
  added: string[];
  /** Indexes into `edits` of the rules that changed something. */
  used: number[];
}

/** Applies every rule that covers the video, in order, replacing each place its lines appear. */
export function applyTextEdits(desc: string, edits: (Scope & Pick<TextEdit, 'find' | 'replace'>)[], videoId: string, channelId: string): EditResult {
  const lines = desc.split('\n');
  let changed = 0;
  const added = new Set<string>();
  const used: number[] = [];
  edits.forEach((e, n) => {
    if (!appliesTo(e, videoId, channelId)) return;
    const f = toLines(e.find);
    if (!f.length) return;
    const r = toLines(e.replace);
    const unchanged = new Set(f.map(norm)); // context lines kept from `find` aren't highlighted
    for (let i = 0; i + f.length <= lines.length; ) {
      if (!matchAt(lines, f, i)) {
        i++;
        continue;
      }
      lines.splice(i, f.length, ...r);
      i += r.length; // skip past what was written, so a rule never matches its own output
      changed++;
      if (used.at(-1) !== n) used.push(n);
      for (const l of r) if (!blank(l) && !unchanged.has(norm(l))) added.add(l);
    }
  });
  return { text: lines.join('\n'), changed, added: [...added], used };
}

interface Hunk {
  /** Lines a[a0..a1) became b[b0..b1). */
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** A line-by-line diff (longest common subsequence). Descriptions are at most 5,000 characters. */
function diffLines(a: string[], b: string[]): Hunk[] {
  // Most edits touch a few lines, so skip the shared start and end before the quadratic part.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const w = B.length + 1;
  // L[i*w + j] = length of the longest common subsequence of A[i..] and B[j..].
  const L = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1]! + 1 : Math.max(L[(i + 1) * w + j]!, L[i * w + j + 1]!);

  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < B.length) {
    if (i < n && j < B.length && A[i] === B[j]) {
      if (open) hunks.push({ ...open, a1: i, b1: j });
      open = null;
      i++;
      j++;
      continue;
    }
    open ??= { a0: i, a1: i, b0: j, b1: j };
    if (j < B.length && (i === n || L[i * w + j + 1]! >= L[(i + 1) * w + j]!)) j++;
    else i++;
  }
  if (open) hunks.push({ ...open, a1: i, b1: j });
  return hunks.map((h) => ({ a0: h.a0 + pre, a1: h.a1 + pre, b0: h.b0 + pre, b1: h.b1 + pre }));
}

/** Joins hunks separated only by blank lines, so one edited block becomes one rule. */
function mergeAcrossBlanks(hunks: Hunk[], a: string[]): Hunk[] {
  const out: Hunk[] = [];
  for (const h of hunks) {
    const prev = out.at(-1);
    if (prev && a.slice(prev.a1, h.a0).every(blank)) {
      prev.a1 = h.a1;
      prev.b1 = h.b1;
    } else out.push({ ...h });
  }
  return out;
}

// The drawer marks links without a planned fix as `[FIX THIS: url (reason)]` (fixes.ts). An edit
// near one keeps the marker in the edited line, so it's turned back into the plain link before
// saving: otherwise the marker text would end up in exported descriptions.
const MARKER_RE = /\[FIX THIS: (https?:\/\/\S+?) \([^)]*\)\]/g;
const unmark = (s: string) => s.replace(MARKER_RE, '$1');

/**
 * Turns a hand edit into rules. `source` is the description the rules run on (YouTube's text
 * with earlier rules applied), `shown` is what the drawer generated from it (with link fixes, and
 * `origin` mapping each shown line back to a `source` line), and `edited` is the user's text.
 *
 * Each changed block of lines becomes one rule whose `find` is the matching `source` lines. An
 * added line is anchored to the line above it (or below, at the very top). A rule never matches
 * only blank lines: it's widened to the nearest line with text, or else dropped, since blank
 * lines appear in every description.
 */
export function editsFromHandEdit(source: string, shown: { text: string; origin: number[] }, edited: string): FoundEdit[] {
  const src = source.split('\n');
  const g = shown.text.split('\n');
  const out: FoundEdit[] = [];
  for (const h of mergeAcrossBlanks(diffLines(g, edited.split('\n')), g)) {
    let replace = edited.split('\n').slice(h.b0, h.b1).map(unmark);
    let s: number;
    let e: number; // the source lines [s, e) this change replaces
    if (h.a1 > h.a0) {
      s = shown.origin[h.a0]!;
      e = shown.origin[h.a1 - 1]! + 1;
    } else if (h.a0 > 0) {
      s = shown.origin[h.a0 - 1]!;
      e = s + 1;
      replace = [src[s]!, ...replace];
    } else if (h.a0 < g.length) {
      s = shown.origin[h.a0]!;
      e = s + 1;
      replace = [...replace, src[s]!];
    } else continue;
    while (src.slice(s, e).every(blank)) {
      if (s > 0) replace = [src[--s]!, ...replace];
      else if (e < src.length) replace = [...replace, src[e++]!];
      else break;
    }
    const find = src.slice(s, e);
    if (find.every(blank)) continue;
    if (find.length === replace.length && find.every((l, k) => norm(l) === norm(replace[k]!))) continue;
    out.push({ find: find.join('\n'), replace: replace.join('\n') });
  }
  return out;
}

/** A link changed by hand: `from` became `to` in the line `find`, which now reads `replace`. */
export interface LinkSwap {
  from: string;
  to: string;
  find: string;
  replace: string;
}

/** A line with each URL replaced by a placeholder, so two lines can be compared apart from their links. */
const template = (line: string) => {
  let out = '';
  let at = 0;
  for (const u of urlsIn(line)) {
    out += line.slice(at, u.start) + '\u0000';
    at = u.end;
  }
  return norm(out + line.slice(at));
};

/**
 * Pulls link swaps out of a found edit. A changed line counts as a swap when it has the same
 * links in the same places and only the URLs differ. Those lines are dropped from the edit
 * (`rest`), which keeps any other changed lines, or is null when nothing else changed.
 * Edits that add or remove lines are left whole.
 */
export function splitLinkSwaps(edit: FoundEdit): { swaps: LinkSwap[]; rest: FoundEdit | null } {
  const f = toLines(edit.find);
  const r = toLines(edit.replace);
  if (f.length !== r.length) return { swaps: [], rest: edit };
  const swaps: LinkSwap[] = [];
  const kept = [...r];
  f.forEach((line, k) => {
    const next = r[k]!;
    if (norm(line) === norm(next)) return;
    const before = urlsIn(line);
    const after = urlsIn(next);
    if (!before.length || before.length !== after.length || template(line) !== template(next)) return;
    before.forEach((u, i) => {
      if (u.url !== after[i]!.url) swaps.push({ from: u.url, to: after[i]!.url, find: line, replace: next });
    });
    kept[k] = line; // the swap is saved separately, so this line no longer counts as a text edit
  });
  const changed = kept.some((l, k) => norm(l) !== norm(f[k]!));
  return { swaps, rest: changed ? { find: edit.find, replace: kept.join('\n') } : null };
}
