// Display text and badge colors for each link category, and the report's status filters.
// The categories themselves are decided by classify() in shared/core.ts.
import type { Category } from '$shared/core';

// Badge tints follow the chart's status palette: critical, warning, good, and neutral gray.
const red = 'border-[#d03b3b]/25 bg-[#d03b3b]/10 text-[#b42d2d] dark:text-[#f07070]';
const amber = 'border-[#fab219]/40 bg-[#fab219]/15 text-[#8a5a00] dark:text-[#fac34d]';
const green = 'border-[#0ca30c]/25 bg-[#0ca30c]/10 text-[#086b08] dark:text-[#4fd14f]';
const gray = 'border-border bg-muted text-muted-foreground';

/** Label, badge classes and tooltip text for each category. */
export const CATEGORY: Record<Category, { label: string; cls: string; help: string }> = {
  broken: { label: 'Broken', cls: red, help: "The link fails: the page is gone, the server errors, or the site can't be reached." },
  parked: { label: 'Parked domain', cls: red, help: 'The domain now shows a parking or for-sale page instead of the original site.' },
  'destination-changed': {
    label: 'Destination changed',
    cls: amber,
    help: 'This short link now points to a different site than it did on an earlier check.',
  },
  'domain-changed': {
    label: 'Domain changed',
    cls: amber,
    help: "The link now redirects to a different website. Accept it if that's where it should go.",
  },
  homepage: { label: 'Homepage redirect', cls: amber, help: "The specific page is gone, so the link now lands on the site's homepage." },
  unverifiable: {
    label: 'Could not verify',
    cls: gray,
    help: "The site blocked the check (bot protection, a login wall or rate limiting) or didn't answer in time. It may be fine: open it, and if it works, mark it as working.",
  },
  ok: { label: 'OK', cls: green, help: 'The link works and lands where expected.' },
  ignored: { label: 'Ignored', cls: gray, help: 'Hidden by one of your ignore rules on the Exceptions page.' },
  pending: { label: 'Not checked yet', cls: gray, help: 'This link was found but not checked yet. Run a scan to check it.' },
};

/** Categories the default "Needs attention" filter shows. */
const ATTENTION: Category[] = ['broken', 'parked', 'destination-changed', 'domain-changed', 'homepage'];

/** The report's status filters, in menu order. `key` is shared with BreakdownChart's segment keys. */
export const FILTERS: { key: string; label: string; match: (c: Category) => boolean }[] = [
  { key: 'attention', label: 'Needs attention', match: (c) => ATTENTION.includes(c) },
  { key: 'broken', label: 'Broken', match: (c) => c === 'broken' || c === 'parked' },
  { key: 'redirects', label: 'Redirected', match: (c) => c === 'domain-changed' || c === 'destination-changed' || c === 'homepage' },
  { key: 'unverifiable', label: 'Could not verify', match: (c) => c === 'unverifiable' },
  { key: 'pending', label: 'Not checked', match: (c) => c === 'pending' },
  { key: 'ok', label: 'OK', match: (c) => c === 'ok' },
  { key: 'ignored', label: 'Ignored', match: (c) => c === 'ignored' },
  { key: 'all', label: 'All', match: () => true },
];

/** Links worth rechecking: anything not confirmed fine and not ignored. */
export const isFlagged = (c: Category) => c !== 'ok' && c !== 'ignored';
