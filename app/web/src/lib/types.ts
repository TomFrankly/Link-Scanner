import type { Classified, LinkResult } from '$shared/core';
import type { RuleRow } from '$shared/rules';

export type Role = 'owner' | 'member' | 'admin';

export interface Me {
  email: string;
  isAdmin: boolean;
  canOwn: boolean;
  workspaces: { id: string; name: string; role: 'owner' | 'member' }[];
}

export interface Scan {
  id: number;
  kind: 'full' | 'all' | 'urls';
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
  action: 'remove' | 'replace';
  replacement: string | null;
  addedBy: string;
  addedAt: string;
}

export interface Report extends ScanState {
  workspace: { id: string; name: string; owner: string; role: Role };
  channels: Channel[];
  videos: { id: string; t: string; c: string; p: string | null }[];
  videoLinks: { v: string; u: string }[];
  links: ApiLink[];
  rules: RuleRow[];
  fixes: LinkFix[];
  defaults: { accepted: [string, string][]; redirectors: string[] };
  estimates: Estimates;
}

export interface VideoRef {
  id: string;
  title: string;
  channelId: string;
  publishedAt: string | null;
}

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
