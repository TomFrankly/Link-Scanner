// Authentication: who is making this request?
//
// Identity comes from Cloudflare Access: it proves the email with a one-time code and
// passes a signed JWT in the `cf-access-jwt-assertion` header. This file checks that JWT
// itself rather than trusting that Access sits in front, so a request that reaches the
// Worker some other way (e.g. a workers.dev URL with no Access policy) still has no identity.
// Authorization (who may own or join a workspace) happens in api.ts.
import { HttpError, type Env } from './env.ts';

interface Jwk extends JsonWebKey {
  kid: string;
}

// Access rotates its signing keys rarely; caching them saves a subrequest on most calls.
const KEY_CACHE_MS = 3600_000;
let keyCache: { team: string; keys: Jwk[]; at: number } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

/** The team's public signing keys, from cache unless stale or `refresh` is set (1 subrequest). */
async function accessKeys(team: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && keyCache?.team === team && Date.now() - keyCache.at < KEY_CACHE_MS) return keyCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, 'Could not load Cloudflare Access keys');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  keyCache = { team, keys, at: Date.now() };
  return keys;
}

/**
 * Verifies an Access JWT and returns its lowercased email. Throws a 401 for anything off:
 * wrong algorithm, unknown key, bad signature, another app's audience, expired, another
 * team's issuer, or no email. Only RS256 is accepted, so "alg: none" or HMAC tricks fail.
 */
async function verifyAccessJwt(token: string, env: Env): Promise<string> {
  const team = env.ACCESS_TEAM_DOMAIN!;
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) throw new HttpError(401, 'Malformed Access token');
  const header = b64json(headerB64) as { kid: string; alg: string };
  if (header.alg !== 'RS256') throw new HttpError(401, 'Unexpected token algorithm');
  // An unknown key id may mean Access rotated keys since we cached them: refetch once.
  let jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Unknown Access signing key');

  // The signature is checked before any claim is trusted.
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signedPart = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(signatureB64), signedPart);
  if (!ok) throw new HttpError(401, 'Invalid Access token signature');

  const claims = b64json(payloadB64) as { aud: string | string[]; exp: number; iss: string; email?: string };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD!)) throw new HttpError(401, 'Access token is for another application');
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, 'Access token expired');
  if (claims.iss !== `https://${team}`) throw new HttpError(401, 'Access token from another team');
  if (!claims.email) throw new HttpError(401, 'Access token has no email');
  return claims.email.toLowerCase();
}

/**
 * The signed-in email (lowercased), or throws an HttpError. Fails closed: if Access isn't
 * configured, every request is rejected rather than treated as anonymous or trusted.
 *
 * Dev bypass: when DEV_AUTH_EMAIL is set AND the request's own URL is localhost/127.0.0.1,
 * the JWT check is skipped. DEV_AUTH_EMAIL belongs in .dev.vars only, never in production
 * config. The host check is a second guard: Cloudflare routes deployed traffic by hostname,
 * so a deployed Worker never sees a localhost URL even if the variable were set by mistake.
 */
export async function currentEmail(req: Request, env: Env): Promise<string> {
  const host = new URL(req.url).hostname;
  if (env.DEV_AUTH_EMAIL && (host === 'localhost' || host === '127.0.0.1')) {
    // Local testing can impersonate another user with this header.
    return (req.headers.get('x-dev-email') || env.DEV_AUTH_EMAIL).toLowerCase();
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(500, 'Cloudflare Access is not configured');
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token) throw new HttpError(401, 'Not signed in');
  return verifyAccessJwt(token, env);
}
