# Elevate lead-notify relay

This is the free Cloudflare Worker that lets your admin dashboard receive a
real push notification for a new lead — even when the dashboard tab and
browser are completely closed. It avoids Firebase's paid Blaze plan by
running the "send the push" step here instead of in a Firebase Cloud
Function.

## One-time setup

1. **Sign up for Cloudflare** (free, no card required): https://dash.cloudflare.com/sign-up
2. From this folder, log in and deploy:
   ```
   npx wrangler login
   npx wrangler kv namespace create TOKENS
   ```
   Copy the `id` it prints into `wrangler.toml` in place of
   `REPLACE_WITH_KV_NAMESPACE_ID`.
3. Get a Firebase service account key: Firebase Console → ⚙️ Project
   Settings → **Service accounts** tab → **Generate new private key**. It
   downloads a `.json` file — keep it private, never commit it.
4. Set the three secrets (never stored in this repo):
   ```
   npx wrangler secret put FCM_SERVICE_ACCOUNT
   ```
   (paste the *entire contents* of the downloaded JSON file, then Enter)
   ```
   npx wrangler secret put SITE_SECRET
   ```
   (paste the SITE_SECRET value you were given — must match `NOTIFY_SITE_KEY` in `elevatewebdesigns/script.js`)
   ```
   npx wrangler secret put ADMIN_KEY
   ```
   (choose a passphrase — you'll type this once into the admin dashboard when enabling push)
5. Deploy:
   ```
   npx wrangler deploy
   ```
   It prints a URL like `https://elevate-lead-notify.<your-subdomain>.workers.dev`.
   Put that URL into `NOTIFY_WORKER_URL` in both `elevatewebdesigns/script.js`
   and `elevatewebdesigns/admin.js`, then redeploy Firebase hosting.

## After that

- On the admin dashboard, click **"Enable Push (works when closed)"** once
  per device, enter the `ADMIN_KEY` passphrase when prompted, and allow the
  notification permission prompt. That device is now registered.
- Every new lead (contact form or estimator) triggers a push to whichever
  device most recently registered.
- To switch which device gets pushes, just click "Enable Push" again on the
  new device — it overwrites the stored token.

## Ongoing cost

$0. Cloudflare Workers' free plan (100,000 requests/day) and Cloudflare KV's
free tier are both far beyond what a small business site's lead volume needs.
Firebase Cloud Messaging itself is free with no usage cap for this use case.
