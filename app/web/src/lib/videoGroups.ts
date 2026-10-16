// The report's Videos view: the filtered links grouped by the video that uses them, most
// problems first, each with every one of its links and the summary chips shown in the list.
import { CATEGORY } from '$lib/categories';
import { FIXABLE, type Problem } from '$shared/fixes';
import type { Category } from '$shared/core';
import type { Row, VideoRef } from '$lib/types';

// Order inside a video, and the chip groups that summarize it.
const ORDER: Category[] = ['broken', 'parked', 'domain-changed', 'destination-changed', 'homepage', 'unverifiable', 'pending', 'ignored', 'ok'];
const GROUPS: { label: string; tint: Category; match: Category[] }[] = [
  { label: 'broken', tint: 'broken', match: ['broken', 'parked'] },
  { label: 'redirected', tint: 'domain-changed', match: ['domain-changed', 'destination-changed', 'homepage'] },
  { label: 'unverified', tint: 'unverifiable', match: ['unverifiable'] },
  { label: 'not checked', tint: 'pending', match: ['pending'] },
  { label: 'ignored', tint: 'ignored', match: ['ignored'] },
  { label: 'OK', tint: 'ok', match: ['ok'] },
];

export interface VideoGroup {
  video: VideoRef;
  links: Row[];
  problems: Problem[];
  chips: { label: string; n: number; cls: string }[];
}

/**
 * Videos with at least one link in `rows` (filtered), each holding every one of its links from
 * `allRows`, so a video's fixes cover all of its problem links, not just the ones in the current
 * filter. Links are sorted by severity; videos by most problem links, then title.
 */
export function groupVideos(rows: Row[], allRows: Row[]): VideoGroup[] {
  const shown = new Set(rows.flatMap((r) => r.videos.map((v) => v.id)));
  const byId = new Map<string, { video: VideoRef; links: Row[] }>();
  for (const r of allRows) {
    for (const v of r.videos) {
      if (!shown.has(v.id)) continue;
      let entry = byId.get(v.id);
      if (!entry) byId.set(v.id, (entry = { video: v, links: [] }));
      entry.links.push(r);
    }
  }
  return [...byId.values()]
    .map(({ video, links }) => {
      links.sort((a, b) => ORDER.indexOf(a.cls.category) - ORDER.indexOf(b.cls.category) || a.url.localeCompare(b.url));
      const problems = links
        .filter((r) => FIXABLE.includes(r.cls.category))
        .map((r) => ({ url: r.url, category: r.cls.category, finalUrl: r.result?.finalUrl ?? null, detail: r.cls.detail ?? null }));
      const chips = GROUPS.map((g) => ({
        label: g.label,
        n: links.filter((r) => g.match.includes(r.cls.category)).length,
        cls: CATEGORY[g.tint].cls,
      })).filter((c) => c.n);
      return { video, links, problems, chips };
    })
    .sort((a, b) => b.problems.length - a.problems.length || a.video.title.localeCompare(b.video.title));
}

/** Where a link ends up, if that's really somewhere else (a trailing slash alone doesn't count). */
export function movedTo(r: Row): string | null {
  const final = r.result?.finalUrl;
  return final && final.replace(/\/$/, '') !== r.url.replace(/\/$/, '') ? final : null;
}

export const shortDate = (s: string | null) => (s ? new Date(s).toLocaleDateString([], { dateStyle: 'medium' }) : null);
