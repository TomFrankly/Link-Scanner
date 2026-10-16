// Identity comes from Cloudflare Access: it proves the email with a one-time code and
// passes a signed JWT. Authorization (who may own or join a workspace) happens in the app.
import { HttpError, type Env } from './env.ts';

interface Jwk extends JsonWebKey {
  kid: string;
}
let keyCache: { team: string; keys: Jwk[]; at: number } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function accessKeys(team: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && keyCache?.team === team && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, 'Could not load Cloudflare Access keys');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  keyCache = { team, keys, at: Date.now() };
  return keys;
}

async function verifyAccessJwt(token: string, env: Env): Promise<string> {
  const team = env.ACCESS_TEAM_DOMAIN!;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) throw new HttpError(401, 'Malformed Access token');
  const header = b64json(h) as { kid: string; alg: string };
  if (header.alg !== 'RS256') throw new HttpError(401, 'Unexpected token algorithm');
  let jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Unknown Access signing key');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new HttpError(401, 'Invalid Access token signature');

  const claims = b64json(p) as { aud: string | string[]; exp: number; iss: string; email?: string };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD!)) throw new HttpError(401, 'Access token is for another application');
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, 'Access token expired');
  if (claims.iss !== `https://${team}`) throw new HttpError(401, 'Access token from another team');
  if (!claims.email) throw new HttpError(401, 'Access token has no email');
  return claims.email.toLowerCase();
}

/** The signed-in email. Fails closed: production without Access configured rejects everything. */
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
