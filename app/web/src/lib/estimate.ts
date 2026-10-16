import type { Estimates } from './types';

export function duration(secs: number): string {
  if (secs < 90) return 'about a minute';
  const m = Math.round(secs / 60);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  return `about ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

/** What each Rescan option would cost: links checked, YouTube units, and wall time. */
export function runEstimates(e: Estimates, flaggedCount: number) {
  return {
    flagged: { links: flaggedCount, units: 0, secs: flaggedCount * e.secsPerLink },
    all: { links: e.staleHour, units: 0, secs: e.staleHour * e.secsPerLink },
    // New videos can add links, so a full scan's link count is a floor.
    full: { links: e.staleDay, units: e.fullScanUnits, secs: e.fullScanPages * e.secsPerPage + e.staleDay * e.secsPerLink },
  };
}
