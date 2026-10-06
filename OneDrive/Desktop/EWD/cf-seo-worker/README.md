# Elevate SEO Audit worker

Fetch service behind the SEO Audit dashboard (`elevatewebdesigns/seo.html`).
Browsers can't read other websites (CORS), so the dashboard asks this worker
for one URL at a time; all crawling, parsing and scoring happens in the
dashboard. Free Cloudflare plan is enough: each call is one small fetch.

| Endpoint | Purpose |
|---|---|
| `POST /fetch {url}` | Page with status, redirect chain, headers, timing, body (text only, ≤ 3 MB) |
| `POST /check {url}` | Status-only check for links and images (HEAD, falls back to GET) |
| `POST /ai {summary}` | Claude recommendations (needs `ANTHROPIC_API_KEY`) |
| `POST /measure {url}` | Downloads a page resource to measure its size/time (nothing returned but numbers) |
| `POST /public/growth/session {urls, turnstileToken}` | Starts a visitor Website Growth scan: returns a session id with a request budget |
| `POST /public/quick {url, turnstileToken}` | Public Quick SEO Check (homepage + 4 pages, robots, sitemap, probes) — no sign-in |
| `GET /health` | Liveness, no auth |

**Security:** every POST needs the admin's Firebase sign-in token (verified
against Google's keys and checked against `ADMIN_EMAIL`). URLs pointing at
private networks, localhost, odd ports or non-http schemes are refused, at
every redirect hop. Only the site's own origins get CORS access.

## Deploy

From this folder:

```
npm install
npx wrangler login        # once, opens the browser
npx wrangler deploy
```

It prints `https://elevate-seo-audit.<your-subdomain>.workers.dev`. If the
subdomain isn't `dewaalb3`, update `PROD_WORKER_URL` in
`elevatewebdesigns/seo/api.js`.

## Turn on the public Free SEO Check

`elevatewebdesigns/free-seo-check.html` lets visitors run a quick check and
request the full report (saved as a lead with source `website_seo_check`).
It's protected by Cloudflare Turnstile and daily limits (5 checks per visitor,
300 in total), so public use can't exhaust the free plan.

1. Cloudflare dashboard → **Turnstile** → **Add widget**: domain
   `elevatewebdesign.co.za`, mode **Managed**. Copy the two keys.
2. Put the **site key** in `TURNSTILE_SITE_KEY` in `elevatewebdesigns/seo/public.js`.
3. From this folder:
   ```
   npx wrangler kv namespace create QUICK_LIMITS
   ```
   Paste the printed id into the commented `[[kv_namespaces]]` block in
   `wrangler.toml` and uncomment it.
4. `npx wrangler secret put TURNSTILE_SECRET` (paste the **secret key**), then
   `npx wrangler deploy`, then deploy the site (`firebase deploy`).

Until then the endpoint answers `quick_not_configured` and the page shows a
"being set up" message instead of the form.

## Website Growth (`elevatewebdesigns/website-growth.html`)

Public page with four tools (SEO Auditor, Health Dashboard, Performance
Analyzer, Competitor Analyzer). Visitors pass Turnstile once per scan and get
a session (`x-session` header) that `/fetch`, `/check` and `/measure` accept.
The `Limiter` Durable Object (free plan) enforces, exactly:

- a request budget per session (140 per site scanned; see `src/growth.js`)
- page fetches only from the sites the visitor entered (sitemaps excepted)
- 3 scan sessions per visitor IP per day, 100 per day in total

Change the daily limits without code via `[vars]` in `wrangler.toml`:
`GROWTH_IP_DAILY`, `GROWTH_GLOBAL_DAILY`. When you're signed in with the admin
login, the same page runs full-size scans with your Firebase token instead.

Scoring weights live in `elevatewebdesigns/seo/growth/scoring.js` (documented
at the top of that file).

Known limits (by design, free-first):
- Speed figures are measured from Cloudflare's network, not a visitor's phone.
- Lighthouse / Core Web Vitals need Google PageSpeed Insights. Add a free API
  key (restricted to your domain) as `PAGESPEED_KEY` in `seo/growth/app.js`;
  until then they show "Not available".
- Pages that build their content with JavaScript are read as raw HTML.
- Google Business Profile, Search Console and keyword rankings aren't checked
  (they need Google account access/APIs).

## Turn on AI recommendations (optional)

Create a key at console.anthropic.com, then:

```
npx wrangler secret put ANTHROPIC_API_KEY
```

Each "Generate AI recommendations" click is one Claude Opus 5.5 request
(roughly 10–20k input tokens, a few thousand output).

## Local development

```
cp .dev.vars.example .dev.vars    # DEV_NO_AUTH=1, local only, never deployed
npm run dev                       # worker on http://localhost:8787
```

Serve `elevatewebdesigns/` on localhost and open `/seo.html?dev=1`. Dev mode
skips sign-in and saving. It only works against the local worker.
