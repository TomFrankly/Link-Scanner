// Shapes of the JSON the Worker's /api returns, plus `Row`, the per-link record the report
// screens work with (built in store.svelte.ts). Types shared with the Worker live in shared/.
import type { Classified, LinkResult } from '$shared/core';
import type { RuleRow } from '$shared/rules';
import type { TextEdit } from '$shared/textEdits';

export type Role = 'owner' | 'member' | 'admin';

/** The signed-in user and the workspaces they can open (GET /api/me). */
export interface Me {
  email: string;
  isAdmin: boolean;
  canOwn: boolean;
  workspaces: { id: string; name: string; role: 'owner' | 'member' }[];
}

/** One scan's progress row, as the server stores it. */
export interface Scan {
  id: number;
  kind: 'full' | 'all' | 'urls';
  /** A full scan fetches video descriptions first, then checks links; rechecks skip to checking. */
  status: 'fetching' | 'checking' | 'done' | 'failed';
  pending_fetch: number;
  total: number;
  done: number;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  expected_pages: number;
  pages_fetched: number;
  videos_fetched: number;
  checking_started_at: string | null;
  /** JSON: [{ u: url, o: outcome, s: status }] for the latest checked batch */
  recent: string | null;
}

/** Server-side numbers behind the Rescan menu's costs and the scan banner's time left. */
export interface Estimates {
  links: number;
  staleDay: number;
  staleHour: number;
  fullScanUnits: number;
  fullScanPages: number;
  quotaLeft: number;
  quotaLimit: number;
  secsPerLink: number;
  secsPerPage: number;
}

/** The latest scan plus today's usage against the workspace's daily limits. */
export interface ScanState {
  scan: Scan | null;
  limits: { fullScans: number; rechecks: number; maxChannels: number };
  usedToday: { full: number; rechecks: number };
}

export interface Channel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  videoCount: number;
  fetchedAt: string | null;
}

/** Link row as the API sends it (chain still JSON text, parked as 0/1). */
export interface ApiLink extends Omit<LinkResult, 'chain' | 'parked'> {
  chain: string;
  parked: number;
}

/** A workspace's decision for one link, applied when generating a fixed description. */
export interface LinkFix {
  url: string;
  /** '' for every channel, or the one channel whose videos it applies to (that wins over ''). */
  channelId: string;
  action: 'remove' | 'replace';
  replacement: string | null;
  addedBy: string;
  addedAt: string;
}

/**
 * Everything one workspace's screens need, loaded once from GET /api/w/:id. Videos and
 * video-link pairs use one-letter keys to keep the payload small on big channels.
 */
export interface Report extends ScanState {
  workspace: { id: string; name: string; owner: string; role: Role };
  channels: Channel[];
  /** t: title, c: channel id, p: published date */
  videos: { id: string; t: string; c: string; p: string | null }[];
  /** v: video id, u: link URL found in that video's description */
  videoLinks: { v: string; u: string }[];
  links: ApiLink[];
  rules: RuleRow[];
  fixes: LinkFix[];
  /** Saved hand edits to descriptions, oldest first. */
  textEdits: TextEdit[];
  /** The app-wide default rules, listed on the Exceptions page so they can be turned off. */
  defaults: { accepted: [string, string][]; redirectors: string[] };
  estimates: Estimates;
}

/** A video, expanded from the report's compact form. */
export interface VideoRef {
  id: string;
  title: string;
  channelId: string;
  publishedAt: string | null;
}

/** One unique link: its latest check, every video that uses it, and how this workspace's rules classify it. */
export interface Row {
  url: string;
  host: string;
  result: LinkResult | null;
  videos: VideoRef[];
  cls: Classified;
}

export interface Member {
  email: string;
  role: 'owner' | 'member';
  addedBy: string | null;
  addedAt: string;
}
