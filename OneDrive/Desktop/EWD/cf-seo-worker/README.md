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
