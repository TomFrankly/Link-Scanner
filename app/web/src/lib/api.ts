// The one place the browser talks to the Worker. Every request goes to /api on the same
// origin; sign-in is handled by Cloudflare Access cookies, so no token is stored or sent here.

/** A failed API call. `status` is the HTTP status, or 0 when the request never got a response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_EXPIRED = 'Your session may have expired. Reload the page to sign in again.';

/**
 * Calls the Worker's JSON API at `/api${path}` and returns the parsed body. Sends `body` as
 * JSON when given. Throws ApiError with the server's `error` message on a non-2xx reply.
 */
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    // An expired Cloudflare Access session redirects to its login page, which fetch can't follow.
    throw new ApiError(0, SESSION_EXPIRED);
  }
  // Same story when the redirect is followed: Access answers with its HTML login page, not JSON.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ApiError(res.status, SESSION_EXPIRED);
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Request failed');
  return data as T;
}
