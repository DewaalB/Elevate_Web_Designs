/* =========================================================
   ELEVATE — Lead Notification Relay (Cloudflare Worker)
   =========================================================
   Free, third-party relay that lets the site push a real
   notification to your device even when the admin dashboard
   tab (or browser) is fully closed — without needing Firebase's
   paid Blaze plan.

   Two endpoints:
     POST /register-token  — the admin dashboard calls this once
                              (per device) to store its push token.
     POST /notify           — the public site calls this every time
                              a lead is created, to trigger the push.

   Secrets (set with `wrangler secret put <NAME>`, never committed):
     FCM_SERVICE_ACCOUNT  — the full JSON key from Firebase Console
                             → Project Settings → Service accounts
                             → Generate new private key.
     SITE_SECRET           — shared with script.js so /notify can't
                             be spammed by randoms (not high-security,
                             just abuse friction — it's in public JS).
     ADMIN_KEY             — a passphrase you type into the admin
                             dashboard once, so /register-token can't
                             be used to hijack whose device gets pushes.

   KV namespace binding `TOKENS` (see wrangler.toml) stores the
   admin's current FCM token and lightweight rate-limit markers.
   ========================================================= */

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const ALLOWED_ORIGINS = [
  'https://elevatewebdesigns-1fc3d.web.app',
  'https://www.elevatewebdesign.co.za',
  'https://elevatewebdesign.co.za',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-site-key, x-admin-key',
  };
}

function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/* Mint a short-lived Google OAuth2 access token from the service account,
   using the standard JWT Bearer flow — this is the one bit of "server"
   work that can't be done from the browser, since it needs the private key. */
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss:   serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res  = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Google token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

/* Cheap per-IP cooldown using KV, so the public /notify endpoint can't be
   hammered into spamming your device with pushes. 60s is KV's own minimum
   TTL — that's still well below any realistic gap between real leads from
   the same visitor. */
async function isRateLimited(env, ip) {
  const key = `rl:${ip}`;
  if (await env.TOKENS.get(key)) return true;
  await env.TOKENS.put(key, '1', { expirationTtl: 60 });
  return false;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    try {
      /* ── Admin dashboard registers/updates its push token ── */
      if (request.method === 'POST' && url.pathname === '/register-token') {
        if (request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
          return json({ ok: false, error: 'Unauthorized' }, origin, 401);
        }
        const { fcmToken } = await request.json();
        if (!fcmToken || typeof fcmToken !== 'string') {
          return json({ ok: false, error: 'Missing fcmToken' }, origin, 400);
        }
        await env.TOKENS.put('admin_fcm_token', fcmToken);
        return json({ ok: true }, origin);
      }

      /* ── Public site triggers a push when a lead comes in ── */
      if (request.method === 'POST' && url.pathname === '/notify') {
        if (request.headers.get('x-site-key') !== env.SITE_SECRET) {
          return json({ ok: false, error: 'Unauthorized' }, origin, 401);
        }
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        if (await isRateLimited(env, ip)) {
          return json({ ok: true, skipped: 'rate-limited' }, origin);
        }

        const fcmToken = await env.TOKENS.get('admin_fcm_token');
        if (!fcmToken) {
          return json({ ok: false, error: 'No admin device registered yet' }, origin);
        }

        const body = await request.json().catch(() => ({}));
        const name = String(body.name || 'Someone').slice(0, 100);
        const pkg  = String(body.package || 'General enquiry').slice(0, 100);

        const serviceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT);
        const accessToken    = await getAccessToken(serviceAccount);

        const sendRes = await fetch(
          `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token: fcmToken,
                notification: {
                  title: 'New lead — Elevate Admin',
                  body:  `${name} · ${pkg}`,
                },
                webpush: {
                  fcm_options: { link: 'https://www.elevatewebdesign.co.za/admin.html' },
                },
              },
            }),
          }
        );
        const sendData = await sendRes.json();
        if (!sendRes.ok) return json({ ok: false, error: sendData }, origin);
        return json({ ok: true }, origin);
      }

      return json({ ok: false, error: 'Not found' }, origin, 404);
    } catch (err) {
      // Never let a relay failure look like a hard error to the caller —
      // the lead is already safely saved in Firestore regardless of this.
      return json({ ok: false, error: String(err) }, origin);
    }
  },
};
