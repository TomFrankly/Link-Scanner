// YouTube Data API v3 client. It uses the server's API key, so it can only read public
// data (public and unlisted videos, channel info). There is no OAuth and no write access:
// this app can never change a video or description; fixes are pasted into Studio by hand.
//
// Every call is metered against a global daily ceiling (GLOBAL_DAILY_UNITS) in the `quota`
// table, shared by all workspaces, so colleagues can't exhaust the key's quota. The calls
// used here (channels.list, playlistItems.list, videos.list) cost 1 unit each.
import { HttpError, today, type Env } from './env.ts';

/** Ceiling when GLOBAL_DAILY_UNITS is unset: below YouTube's default 10,000/day, for headroom. */
export const DEFAULT_DAILY_UNITS = 8000;
/** The most videos playlistItems.list returns per page (and videos.list accepts per call). */
const PAGE_SIZE = 50;

export class QuotaError extends Error {}

/**
 * Records `units` against today's (UTC) total and throws QuotaError if that pushes it over
 * the ceiling. The increment is one atomic upsert, so concurrent queue invocations can't
 * both slip under the limit. Units are counted before the call, so failed calls count too.
 */
async function spendUnits(env: Env, units: number) {
  const limit = Number(env.GLOBAL_DAILY_UNITS ?? DEFAULT_DAILY_UNITS);
  const row = await env.DB.prepare(
    'INSERT INTO quota (day, units) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET units = units + excluded.units RETURNING units',
  )
    .bind(today(), units)
    .first<{ units: number }>();
  if ((row?.units ?? 0) > limit) throw new QuotaError('The app reached its daily YouTube quota. Try again tomorrow (UTC).');
}

/**
 * One GET to the API (1 quota unit, 1 D1 write, 1 subrequest). Errors become HttpError with
 * YouTube's message; the key is only in the request URL and never in an error or log.
 */
async function yt<T>(env: Env, endpoint: string, params: Record<string, string>): Promise<T> {
  if (!env.YOUTUBE_API_KEY) throw new HttpError(500, 'YOUTUBE_API_KEY is not set');
  await spendUnits(env, 1);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: env.YOUTUBE_API_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    if (body.error?.errors?.some((e) => e.reason === 'quotaExceeded')) throw new QuotaError('YouTube API quota exceeded for today.');
    throw new HttpError(res.status === 404 ? 404 : 502, `YouTube API: ${body.error?.message ?? res.status}`);
  }
  return body;
}

export interface ChannelInfo {
  id: string;
  title: string;
  handle: string | null;
  uploads: string;
  videoCount: number;
  thumbnail: string | null;
}

/**
 * Looks up a channel (1 unit). Accepts @handle, a channel ID, or a youtube.com URL
 * (/@handle or /channel/UC…). Throws a 404 HttpError if YouTube doesn't know it.
 */
export async function resolveChannel(env: Env, input: string): Promise<ChannelInfo> {
  let s = input.trim();
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/(@[^/]+)|^\/channel\/(UC[\w-]{22})/);
      if (m) s = m[1] ?? m[2]!;
    }
  } catch {
    /* not a URL */
  }
  const params: Record<string, string> = { part: 'snippet,contentDetails,statistics' };
  if (/^UC[\w-]{22}$/.test(s)) params.id = s;
  else params.forHandle = s.startsWith('@') ? s : `@${s}`;
  const data = await yt<{ items?: any[] }>(env, 'channels', params);
  const c = data.items?.[0];
  if (!c) throw new HttpError(404, `No YouTube channel found for "${input}"`);
  return {
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl ?? null,
    uploads: c.contentDetails.relatedPlaylists.uploads,
    videoCount: Number(c.statistics?.videoCount ?? 0),
    thumbnail: c.snippet.thumbnails?.default?.url ?? c.snippet.thumbnails?.medium?.url ?? null,
  };
}

export interface VideoInfo {
  id: string;
  title: string;
  publishedAt: string;
  description: string;
}

/**
 * One page (up to 50 videos) of a channel's uploads playlist, with full descriptions.
 * Costs 2 units: playlistItems for the IDs, then videos for the snippets. A missing
 * playlist (404) reads as an empty channel. `next` is the token for the following page.
 */
export async function fetchUploadsPage(env: Env, uploads: string, pageToken?: string) {
  let page: { items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string };
  try {
    page = await yt(env, 'playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: String(PAGE_SIZE),
      fields: 'nextPageToken,items/contentDetails/videoId',
      ...(pageToken ? { pageToken } : {}),
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { videos: [] as VideoInfo[], next: undefined };
    throw e;
  }
  const ids = (page.items ?? []).map((i) => i.contentDetails.videoId);
  if (!ids.length) return { videos: [] as VideoInfo[], next: page.nextPageToken };
  const vids = await yt<{ items?: any[] }>(env, 'videos', {
    part: 'snippet',
    id: ids.join(','),
    fields: 'items(id,snippet(title,description,publishedAt))',
  });
  const videos: VideoInfo[] = (vids.items ?? []).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    publishedAt: v.snippet.publishedAt,
    description: v.snippet.description ?? '',
  }));
  return { videos, next: page.nextPageToken };
}

/**
 * A video's current description, fetched on demand (1 unit). Not stored, so it reflects
 * edits made in YouTube Studio since the last scan.
 */
export async function fetchDescription(env: Env, videoId: string): Promise<string> {
  const data = await yt<{ items?: { id: string; snippet?: { description?: string } }[] }>(env, 'videos', {
    part: 'snippet',
    id: videoId,
    fields: 'items(id,snippet(description))',
  });
  const v = data.items?.[0];
  // The API key only sees public and unlisted videos.
  if (!v) throw new HttpError(404, 'YouTube no longer returns this video. It may be private or deleted.');
  return v.snippet?.description ?? '';
}
