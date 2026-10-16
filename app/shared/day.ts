// The app's "day" for daily limits: it runs midnight to midnight Pacific time, because that's
// when YouTube resets its API quota. Used for the YouTube quota ledger and for each workspace's
// daily scan limits, so everything resets together. Intl handles daylight saving; it works the
// same in Node (tests) and the Workers runtime. shared/day.test.ts covers it.

const ZONE = 'America/Los_Angeles';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Pacific wall-clock fields for an instant. */
function wallClock(at: Date) {
  const f = Object.fromEntries(parts.formatToParts(at).map((p) => [p.type, p.value]));
  return { y: Number(f.year), m: Number(f.month), d: Number(f.day), h: Number(f.hour), min: Number(f.minute), s: Number(f.second) };
}

/** Milliseconds Pacific time is ahead of UTC at this instant (negative: -7h or -8h). */
function offsetAt(ms: number) {
  const w = wallClock(new Date(ms));
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}

/** The Pacific date (YYYY-MM-DD) at this instant: the key for the daily quota ledger. */
export function pacificDay(at = new Date()): string {
  const w = wallClock(at);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** The UTC ISO timestamp of the midnight Pacific that began this instant's Pacific day. */
export function pacificDayStart(at = new Date()): string {
  const w = wallClock(at);
  const midnightAsUtc = Date.UTC(w.y, w.m - 1, w.d);
  // Guess with the current offset, then correct with the offset at midnight itself, which
  // differs on a daylight-saving switch day (the switch happens at 2am).
  const guess = midnightAsUtc - offsetAt(at.getTime());
  return new Date(midnightAsUtc - offsetAt(guess)).toISOString();
}
