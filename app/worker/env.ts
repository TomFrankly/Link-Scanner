export interface Env {
  DB: D1Database;
  JOBS: Queue<Job>;
  ASSETS: Fetcher;
  YOUTUBE_API_KEY?: string;
  ADMIN_EMAIL: string;
  OWNER_DOMAINS: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  GLOBAL_DAILY_UNITS?: string;
  /** Optional email notifications to the admin (see notify.ts). */
  EMAIL?: SendEmail;
  NOTIFY_FROM?: string;
  APP_URL?: string;
  /** Local development only: act as this email without Cloudflare Access. */
  DEV_AUTH_EMAIL?: string;
}

export interface CheckItem {
  url: string;
  tries?: number;
}

export type Job =
  | { t: 'fetch'; scanId: number; channelId: string; pageToken?: string; page?: number }
  | { t: 'check'; scanId: number; items: CheckItem[] };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);
