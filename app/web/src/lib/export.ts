// Report exports, offered by the Export menu on the Report page. Everything is built in the
// browser from the rows on screen, so an export always matches the current filters and
// exception lists, and nothing is sent anywhere.
//
// Three formats:
// - CSV: one row per link; a link's videos are joined with line breaks inside one cell.
// - Excel: the same "Links" sheet, a "By video" sheet with one row per video and link, and a
//   "Descriptions" sheet with each video's description, with saved text edits and planned link
//   fixes applied, ready to paste.
// - Copy for Google Sheets: tab-separated text on the clipboard, one line per link.
// Every format has a "Planned fix" column with the remove/replace decision for each link.
import { applyFixes, type Decision, type Problem } from '$shared/fixes';
import { applyTextEdits, type TextEdit } from '$shared/textEdits';
import { CATEGORY } from './categories';
import type { FixBook } from './fixbook';
import type { LinkFix, Row } from './types';

/** Columns for the one-row-per-link layout (CSV, Sheets, and the Excel "Links" sheet). */
const HEADER = ['Status', 'Link', 'Ends up at', 'Details', 'Planned fix', 'Redirect hops', 'Video count', 'Video titles', 'Video links', 'Studio edit links', 'Channels', 'Last checked'];
/** Columns for the Excel "By video" sheet. */
const BY_VIDEO_HEADER = ['Video title', 'Video link', 'Studio edit link', 'Channel', 'Status', 'Link', 'Ends up at', 'Details', 'Planned fix'];
/** Columns for the Excel "Descriptions" sheet. */
const DESCRIPTIONS_HEADER = ['Video title', 'Video link', 'Studio edit link', 'Channel', 'Description', 'Fixes applied', 'Description saved'];
const CELL_LIMIT = 32000; // Excel caps a cell at 32,767 characters

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const studio = (id: string) => `https://studio.youtube.com/video/${id}/edit`;
const clip = (s: string) => (s.length > CELL_LIMIT ? `${s.slice(0, CELL_LIMIT)}…` : s);
/** Spreadsheets run text starting with = + - @ as a formula; video titles are untrusted. */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

type Cell = string | number | null;

/** The Details cell: the classifier's note, or "Accepted redirect" for one a rule accepted. */
const detailText = (r: Row) => r.cls.detail ?? (r.cls.accepted ? 'Accepted redirect' : '');

/** Planned fixes, looked up by link and channel (data.fixes in the store). */
export type Fixes = FixBook;

const describe = (fix: LinkFix) => (fix.action === 'remove' ? 'Remove from descriptions' : `Replace with ${fix.replacement ?? ''}`);

/**
 * The Planned fix cell: what will happen to this link when descriptions are fixed. On the
 * per-link sheets a fix limited to one channel names it; per video, it's the fix for that
 * video's channel.
 */
const fixText = (r: Row, fixes: Fixes, channelTitle: Record<string, string>) =>
  fixes
    .all(r.url)
    .map((f) => (f.channelId ? `${describe(f)} (${channelTitle[f.channelId] ?? f.channelId} only)` : describe(f)))
    .join('; ');

/** One row per link, matching HEADER. `join` separates the per-video values packed into one cell. */
function linkRows(rows: Row[], channelTitle: Record<string, string>, fixes: Fixes, join: string): Cell[][] {
  return rows.map((r) => {
    const channels = [...new Set(r.videos.map((v) => channelTitle[v.channelId] ?? v.channelId))];
    return [
      CATEGORY[r.cls.category].label,
      r.url,
      r.result && r.result.finalUrl !== r.url ? r.result.finalUrl : '',
      detailText(r),
      fixText(r, fixes, channelTitle),
      // The chain lists every URL visited, starting with the link itself.
      r.result ? Math.max(0, r.result.chain.length - 1) : null,
      r.videos.length,
      clip(r.videos.map((v) => safe(v.title)).join(join)),
      clip(r.videos.map((v) => watch(v.id)).join(join)),
      clip(r.videos.map((v) => studio(v.id)).join(join)),
      safe(channels.join(', ')),
      r.result ? new Date(r.result.checkedAt).toLocaleString() : 'Not checked yet',
    ];
  });
}

/** One row per (video, link) pair, matching BY_VIDEO_HEADER. */
function videoRows(rows: Row[], channelTitle: Record<string, string>, fixes: Fixes): Cell[][] {
  return rows.flatMap((r) =>
    r.videos.map((v) => [
      safe(v.title),
      watch(v.id),
      studio(v.id),
      safe(channelTitle[v.channelId] ?? v.channelId),
      CATEGORY[r.cls.category].label,
      r.url,
      r.result && r.result.finalUrl !== r.url ? r.result.finalUrl : '',
      detailText(r),
      (() => { const f = fixes.for(r.url, v.channelId); return f ? describe(f) : ''; })(),
    ]),
  );
}

/** A video's saved description and when it was saved (from GET /api/w/:id/descriptions). */
export type SavedDescriptions = Map<string, { d: string | null; at: string | null }>;

/**
 * One row per video in the export, matching DESCRIPTIONS_HEADER, newest video first. The
 * description has this workspace's saved text edits and planned link fixes applied, in that
 * order (the same code as the Fix description drawer); links without a planned fix are left as
 * they are, so the text is safe to paste.
 * `allRows` is every link in the workspace, so a video's fixes apply even to links the current
 * filter hides.
 */
function descriptionRows(
  rows: Row[],
  allRows: Row[],
  channelTitle: Record<string, string>,
  fixes: Fixes,
  saved: SavedDescriptions,
  textEdits: TextEdit[],
) {
  const videos = new Map<string, Row['videos'][number]>();
  for (const r of rows) for (const v of r.videos) videos.set(v.id, v);
  const newestFirst = [...videos.values()].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return newestFirst.map((v) => {
    const desc = saved.get(v.id);
    const planned = allRows.filter((r) => fixes.for(r.url, v.channelId) && r.videos.some((x) => x.id === v.id));
    const problems: Problem[] = planned.map((r) => ({ url: r.url, category: r.cls.category, finalUrl: r.result?.finalUrl ?? null, detail: r.cls.detail ?? null }));
    const decisions: Record<string, Decision> = Object.fromEntries(
      planned.map((r) => {
        const f = fixes.for(r.url, v.channelId)!;
        return [r.url, { action: f.action, replacement: f.replacement }];
      }),
    );
    const edited = desc?.d != null ? applyTextEdits(desc.d, textEdits, v.id, v.channelId) : null;
    const fixed = edited && problems.length ? applyFixes(edited.text, problems, decisions) : null;
    const text = edited === null ? 'Not saved yet. Run a full scan to fetch descriptions.' : (fixed?.text ?? edited.text);
    return [
      safe(v.title),
      watch(v.id),
      studio(v.id),
      safe(channelTitle[v.channelId] ?? v.channelId),
      { value: clip(safe(text)), wrap: true },
      (edited?.changed ?? 0) + (fixed?.changed ?? 0),
      desc?.at ? new Date(desc.at).toLocaleString() : '',
    ];
  });
}

/** Downloads a blob through a temporary link, then frees its object URL. */
function save(name: string, blob: Blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  // Revoke a moment later; revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Today's date as YYYY-MM-DD, for file names. */
const stamp = () => new Date().toISOString().slice(0, 10);

/** Saves the rows as `${base}-YYYY-MM-DD.csv`. */
export function downloadCsv(rows: Row[], channelTitle: Record<string, string>, fixes: Fixes, base: string) {
  // RFC 4180 quoting: wrap cells holding quotes, commas or line breaks, and double any quotes.
  const esc = (v: Cell) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [HEADER, ...linkRows(rows, channelTitle, fixes, '\n')].map((row) => row.map(esc).join(',')).join('\r\n');
  // The byte-order mark makes Excel read the file as UTF-8.
  save(`${base}-${stamp()}.csv`, new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
}

/** Saves the rows as `${base}-YYYY-MM-DD.xlsx` with "Links", "By video" and "Descriptions" sheets. */
export async function downloadXlsx(
  rows: Row[],
  channelTitle: Record<string, string>,
  fixes: Fixes,
  base: string,
  { allRows, descriptions, textEdits }: { allRows: Row[]; descriptions: SavedDescriptions; textEdits: TextEdit[] },
) {
  // Loaded on demand so the spreadsheet library isn't in the main bundle.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const bold = (h: string) => ({ value: h, fontWeight: 'bold' as const });
  const widths = (ws: number[]) => ws.map((width) => ({ width }));
  const blob = await writeXlsxFile([
    {
      sheet: 'Links',
      data: [HEADER.map(bold), ...linkRows(rows, channelTitle, fixes, '\n')],
      // Column widths in characters, one per HEADER column.
      columns: widths([18, 50, 50, 36, 40, 8, 8, 50, 44, 44, 24, 20]),
      stickyRowsCount: 1,
    },
    {
      sheet: 'By video',
      data: [BY_VIDEO_HEADER.map(bold), ...videoRows(rows, channelTitle, fixes)],
      columns: widths([50, 44, 44, 24, 18, 50, 50, 36, 40]),
      stickyRowsCount: 1,
    },
    {
      sheet: 'Descriptions',
      data: [DESCRIPTIONS_HEADER.map(bold), ...descriptionRows(rows, allRows, channelTitle, fixes, descriptions, textEdits)],
      columns: widths([44, 44, 44, 24, 90, 10, 20]),
      stickyRowsCount: 1,
    },
  ]).toBlob();
  save(`${base}-${stamp()}.xlsx`, blob);
}

/** Tab-separated text pastes straight into Google Sheets (click cell A1, then paste). */
export async function copyForSheets(rows: Row[], channelTitle: Record<string, string>, fixes: Fixes) {
  // A tab or line break inside a cell would start a new column or row when pasted.
  const clean = (v: Cell) => (v === null ? '' : String(v).replace(/[\t\r\n]+/g, ' · '));
  const text = [HEADER, ...linkRows(rows, channelTitle, fixes, ' · ')].map((row) => row.map(clean).join('\t')).join('\n');
  await navigator.clipboard.writeText(text);
}
