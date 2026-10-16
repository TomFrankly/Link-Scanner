// YouTube Data API v3 with the server's API key (public data only). Every call is metered
// against a global daily ceiling so colleagues can't exhaust the key's quota.
import { HttpError, today, type Env } from './env.ts';

export class QuotaError extends Error {}

async function spendUnits(env: Env, units: number) {
  const limit = Number(env.GLOBAL_DAILY_UNITS ?? 8000);
  const row = await env.DB.prepare(
    'INSERT INTO quota (day, units) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET units = units + excluded.units RETURNING units',
  )
    .bind(today(), units)
    .first<{ units: number }>();
  if ((row?.units ?? 0) > limit) throw new QuotaError('The app reached its daily YouTube quota. Try again tomorrow (UTC).');
}

async function yt<T>(env: Env, endpoint: string, params: Record<string, string>): Promise<T> {
  if (!env.YOUTUBE_API_KEY) throw new HttpError(500, 'YOUTUBE_API_KEY is not set');
  await spendUnits(env, 1);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: env.YOUTUBE_API_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    if (body.error?.errors?.some((e) => e.reason === 'quotaExceeded')) throw new QuotaError('YouTube API quota exceeded for today.');
    const err = new HttpError(res.status === 404 ? 404 : 502, `YouTube API: ${body.error?.message ?? res.status}`);
    throw err;
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

/** Accepts @handle, a channel ID, or a youtube.com URL (/@handle or /channel/UC…). */
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

/** One page (up to 50 videos) of a channel's uploads, with full descriptions. Costs 2 units. */
export async function fetchUploadsPage(env: Env, uploads: string, pageToken?: string) {
  let page: { items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string };
  try {
    page = await yt(env, 'playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: '50',
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
