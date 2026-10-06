/* Firebase ID-token verification (RS256) without the Admin SDK.
   The admin dashboard sends `Authorization: Bearer <idToken>`; we check the
   signature against Google's published keys, then the claims, then that the
   email is the single admin account (same rule as firestore.rules). */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwksCache = { keys: null, expires: 0 };

async function getJwks() {
  if (jwksCache.keys && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Could not load Google signing keys');
  const { keys } = await res.json();
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys, expires: Date.now() + maxAge * 1000 };
  return keys;
}

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
const b64urlToJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

export class AuthError extends Error {}

/** Resolves to the token's claims, or throws AuthError. */
export async function verifyAdmin(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) throw new AuthError('Missing sign-in token');
  const parts = m[1].split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');

  let header, claims;
  try { header = b64urlToJson(parts[0]); claims = b64urlToJson(parts[1]); }
  catch { throw new AuthError('Malformed token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('Unsupported token');

  let jwk = (await getJwks()).find(k => k.kid === header.kid);
  if (!jwk) { jwksCache.expires = 0; jwk = (await getJwks()).find(k => k.kid === header.kid); }
  if (!jwk) throw new AuthError('Unknown signing key');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AuthError('Invalid token signature');

  const now = Math.floor(Date.now() / 1000);
  const project = env.FIREBASE_PROJECT_ID;
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) throw new AuthError('Token is for a different project');
  if (!(claims.exp > now) || claims.iat > now + 300 || !claims.sub) throw new AuthError('Sign-in expired — reload the page');
  if (String(claims.email || '').toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) throw new AuthError('This account is not allowed');
  return claims;
}
