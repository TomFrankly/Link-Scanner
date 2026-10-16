// Time and quota estimates for the Rescan menu and the scan banner. The per-link and per-page
// timings come from the server (`report.estimates`), measured from recent scans.
import type { Estimates } from './types';

/** A rough, human-friendly duration, e.g. "about a minute", "about 12 min", "about 2 h 5 min". */
export function duration(secs: number): string {
  if (secs < 90) return 'about a minute';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `about ${mins} min`;
  const hours = Math.floor(mins / 60);
  return `about ${hours} h ${mins % 60 ? `${mins % 60} min` : ''}`.trim();
}

/** What each Rescan option would cost: links checked, YouTube units, and wall time. */
export function runEstimates(estimates: Estimates, flaggedCount: number) {
  return {
    // Rechecks only visit links; they never call the YouTube API, so they cost no quota units.
    flagged: { links: flaggedCount, units: 0, secs: flaggedCount * estimates.secsPerLink },
    all: { links: estimates.staleHour, units: 0, secs: estimates.staleHour * estimates.secsPerLink },
    // New videos can add links, so a full scan's link count is a floor.
    full: {
      links: estimates.staleDay,
      units: estimates.fullScanUnits,
      secs: estimates.fullScanPages * estimates.secsPerPage + estimates.staleDay * estimates.secsPerLink,
    },
  };
}
