export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
    throw new ApiError(0, 'Your session may have expired. Reload the page to sign in again.');
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ApiError(res.status, 'Your session may have expired. Reload the page to sign in again.');
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Request failed');
  return data as T;
}
