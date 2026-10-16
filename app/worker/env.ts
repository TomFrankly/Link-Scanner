// Shared types for the Worker: the bindings and settings from wrangler.jsonc (`Env`), the
// queue message shapes (`Job`), and a couple of tiny helpers every module uses.
// Secrets (YOUTUBE_API_KEY) are set with `wrangler secret put` and never sent to the browser.

export interface Env {
  DB: D1Database;
  /** The scan queue. api.ts and scan.ts send to it; index.ts receives from it. */
  JOBS: Queue<Job>;
  /** The built Svelte app in dist/, served for every non-/api path. */
  ASSETS: Fetcher;
  /** Read-only YouTube Data API key: it can only read public data, never change a channel. */
  YOUTUBE_API_KEY?: string;
  /** Can see and manage every workspace, and the admin page. */
  ADMIN_EMAIL: string;
  /** Comma-separated email domains whose users may own a workspace (see allowed_owners too). */
  OWNER_DOMAINS: string;
  /** Cloudflare Access team domain and app audience tag, used to verify the sign-in JWT. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** App-wide YouTube quota ceiling per UTC day, in units (default DEFAULT_DAILY_UNITS). */
  GLOBAL_DAILY_UNITS?: string;
  /** Optional email notifications to the admin (see notify.ts). */
  EMAIL?: SendEmail;
  NOTIFY_FROM?: string;
  APP_URL?: string;
  /** Local development only: act as this email without Cloudflare Access. */
  DEV_AUTH_EMAIL?: string;
}

/** One link waiting to be checked; `tries` counts how often it ran out of request budget. */
export interface CheckItem {
  url: string;
  tries?: number;
}

/**
 * A queue message. `fetch` reads one page of a channel's uploads; `check` checks a handful
 * of links. Both carry the scan id, so a message for a finished or failed scan is a no-op.
 */
export type Job =
  | { t: 'fetch'; scanId: number; channelId: string; pageToken?: string; page?: number }
  | { t: 'check'; scanId: number; items: CheckItem[] };

/** An error whose message is safe to show the user; api.ts turns it into a JSON response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** ISO timestamp. Stored as text in D1, so string comparison orders them correctly. */
export const now = () => new Date().toISOString();
/** Today's date in UTC (YYYY-MM-DD): the key for daily quota and per-workspace limits. */
export const today = () => now().slice(0, 10);
