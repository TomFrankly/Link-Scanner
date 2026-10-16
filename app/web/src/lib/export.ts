// Report exports. Everything is built in the browser from the rows on screen,
// so an export always matches the current filters and exception lists.
import { CATEGORY } from './categories';
import type { Row } from './types';

const HEADER = ['Status', 'Link', 'Ends up at', 'Details', 'Redirect hops', 'Video count', 'Video titles', 'Video links', 'Studio edit links', 'Channels', 'Last checked'];
const BY_VIDEO_HEADER = ['Video title', 'Video link', 'Studio edit link', 'Channel', 'Status', 'Link', 'Ends up at', 'Details'];
const CELL_LIMIT = 32000; // Excel caps a cell at 32,767 characters

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const studio = (id: string) => `https://studio.youtube.com/video/${id}/edit`;
const clip = (s: string) => (s.length > CELL_LIMIT ? `${s.slice(0, CELL_LIMIT)}…` : s);
/** Spreadsheets run text starting with = + - @ as a formula; video titles are untrusted. */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

type Cell = string | number | null;

function linkRows(rows: Row[], channelTitle: Record<string, string>, join: string): Cell[][] {
  return rows.map((r) => {
    const channels = [...new Set(r.videos.map((v) => channelTitle[v.channelId] ?? v.channelId))];
    return [
      CATEGORY[r.cls.category].label,
      r.url,
      r.result && r.result.finalUrl !== r.url ? r.result.finalUrl : '',
      r.cls.detail ?? (r.cls.accepted ? 'Accepted redirect' : ''),
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

function save(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function downloadCsv(rows: Row[], channelTitle: Record<string, string>, base: string) {
  const esc = (v: Cell) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [HEADER, ...linkRows(rows, channelTitle, '\n')].map((r) => r.map(esc).join(',')).join('\r\n');
  // The byte-order mark makes Excel read the file as UTF-8.
  save(`${base}-${stamp()}.csv`, new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
}

export async function downloadXlsx(rows: Row[], channelTitle: Record<string, string>, base: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const bold = (h: string) => ({ value: h, fontWeight: 'bold' as const });
  const widths = (ws: number[]) => ws.map((width) => ({ width }));
  const blob = await writeXlsxFile([
    {
      sheet: 'Links',
      data: [HEADER.map(bold), ...linkRows(rows, channelTitle, '\n')],
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
  const clean = (v: Cell) => (v === null ? '' : String(v).replace(/[\t\r\n]+/g, ' · '));
  const text = [HEADER, ...linkRows(rows, channelTitle, ' · ')].map((r) => r.map(clean).join('\t')).join('\n');
  await navigator.clipboard.writeText(text);
}
