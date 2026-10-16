// Report exports, offered by the Export menu on the Report page. Everything is built in the
// browser from the rows on screen, so an export always matches the current filters and
// exception lists, and nothing is sent anywhere.
//
// Three formats:
// - CSV: one row per link; a link's videos are joined with line breaks inside one cell.
// - Excel: the same "Links" sheet plus a "By video" sheet with one row per video and link.
// - Copy for Google Sheets: tab-separated text on the clipboard, one line per link.
import { CATEGORY } from './categories';
import type { Row } from './types';

/** Columns for the one-row-per-link layout (CSV, Sheets, and the Excel "Links" sheet). */
const HEADER = ['Status', 'Link', 'Ends up at', 'Details', 'Redirect hops', 'Video count', 'Video titles', 'Video links', 'Studio edit links', 'Channels', 'Last checked'];
/** Columns for the Excel "By video" sheet. */
const BY_VIDEO_HEADER = ['Video title', 'Video link', 'Studio edit link', 'Channel', 'Status', 'Link', 'Ends up at', 'Details'];
const CELL_LIMIT = 32000; // Excel caps a cell at 32,767 characters

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const studio = (id: string) => `https://studio.youtube.com/video/${id}/edit`;
const clip = (s: string) => (s.length > CELL_LIMIT ? `${s.slice(0, CELL_LIMIT)}…` : s);
/** Spreadsheets run text starting with = + - @ as a formula; video titles are untrusted. */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

type Cell = string | number | null;

/** One row per link, matching HEADER. `join` separates the per-video values packed into one cell. */
function linkRows(rows: Row[], channelTitle: Record<string, string>, join: string): Cell[][] {
  return rows.map((r) => {
    const channels = [...new Set(r.videos.map((v) => channelTitle[v.channelId] ?? v.channelId))];
    return [
      CATEGORY[r.cls.category].label,
      r.url,
      r.result && r.result.finalUrl !== r.url ? r.result.finalUrl : '',
      r.cls.detail ?? (r.cls.accepted ? 'Accepted redirect' : ''),
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
function videoRows(rows: Row[], channelTitle: Record<string, string>): Cell[][] {
  return rows.flatMap((r) =>
    r.videos.map((v) => [
      safe(v.title),
      watch(v.id),
      studio(v.id),
      safe(channelTitle[v.channelId] ?? v.channelId),
      CATEGORY[r.cls.category].label,
      r.url,
      r.result && r.result.finalUrl !== r.url ? r.result.finalUrl : '',
      r.cls.detail ?? '',
    ]),
  );
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
export function downloadCsv(rows: Row[], channelTitle: Record<string, string>, base: string) {
  // RFC 4180 quoting: wrap cells holding quotes, commas or line breaks, and double any quotes.
  const esc = (v: Cell) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [HEADER, ...linkRows(rows, channelTitle, '\n')].map((row) => row.map(esc).join(',')).join('\r\n');
  // The byte-order mark makes Excel read the file as UTF-8.
  save(`${base}-${stamp()}.csv`, new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
}

/** Saves the rows as `${base}-YYYY-MM-DD.xlsx` with a "Links" sheet and a "By video" sheet. */
export async function downloadXlsx(rows: Row[], channelTitle: Record<string, string>, base: string) {
  // Loaded on demand so the spreadsheet library isn't in the main bundle.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const bold = (h: string) => ({ value: h, fontWeight: 'bold' as const });
  const widths = (ws: number[]) => ws.map((width) => ({ width }));
  const blob = await writeXlsxFile([
    {
      sheet: 'Links',
      data: [HEADER.map(bold), ...linkRows(rows, channelTitle, '\n')],
      // Column widths in characters, one per HEADER column.
      columns: widths([18, 50, 50, 36, 8, 8, 50, 44, 44, 24, 20]),
      stickyRowsCount: 1,
    },
    {
      sheet: 'By video',
      data: [BY_VIDEO_HEADER.map(bold), ...videoRows(rows, channelTitle)],
      columns: widths([50, 44, 44, 24, 18, 50, 50, 36]),
      stickyRowsCount: 1,
    },
  ]).toBlob();
  save(`${base}-${stamp()}.xlsx`, blob);
}

/** Tab-separated text pastes straight into Google Sheets (click cell A1, then paste). */
export async function copyForSheets(rows: Row[], channelTitle: Record<string, string>) {
  // A tab or line break inside a cell would start a new column or row when pasted.
  const clean = (v: Cell) => (v === null ? '' : String(v).replace(/[\t\r\n]+/g, ' · '));
  const text = [HEADER, ...linkRows(rows, channelTitle, ' · ')].map((row) => row.map(clean).join('\t')).join('\n');
  await navigator.clipboard.writeText(text);
}
