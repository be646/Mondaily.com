# Live Environment Checklist (Vercel)

Source code is sovereign and fails closed; this checklist verifies the **deployed**
environment matches. Do this in the Vercel dashboard for each project. Nothing here
removes Stripe / Google / Microsoft — those are allowed optional customer connectors.

## `mondaily-com-api` (backend, `@mondaily/api`)

### Must NOT be present (unless explicitly legacy-disabled)
These indicate a non-sovereign path. If any exists, delete it (or confirm it is inert
and documented as legacy-disabled):

- [ ] `OPENAI_API_KEY` — none (inference goes through `AI_GATEWAY_*` only)
- [ ] `ANTHROPIC_API_KEY` — none
- [ ] `TAVILY_API_KEY` — none (search goes through `SOVEREIGN_SEARCH_URL` only)
- [ ] `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_*`, `VITE_CLERK_*` — none (auth is native)
- [ ] `NYLAS_API_KEY`, `NYLAS_CLIENT_ID`, `NYLAS_CLIENT_SECRET` — none (Gmail is direct OAuth)
- [ ] `NYLAS_WEBHOOK_SECRET` — only if you intentionally keep the legacy webhook; otherwise remove (the route returns 410 without it)
- [ ] `CEREBRAS_BASE_URL` / `CEREBRAS_API_KEY` / `CEREBRAS_API_BASE_URL` — **rename to `AI_GATEWAY_BASE_URL` / `AI_GATEWAY_API_KEY`** (the code no longer reads the Cerebras-named vars)

### Must be present (core sovereign infra)
- [ ] `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` — the sole inference endpoint
- [ ] `AUTH_JWT_SECRET` — native session signing
- [ ] `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — database
- [ ] `SOVEREIGN_SEARCH_URL` (+ `SOVEREIGN_SEARCH_KEY`) + `SOVEREIGN_SCRAPE_URL` — Discovery/enrichment
- [ ] `CRON_SECRET` — locks `/api/cron/*`
- [ ] `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — background jobs

### Allowed optional connectors (keep as needed — NOT flagged)
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PLACES_API_KEY`
- Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
- LiveKit (calls): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Reddit (Discovery signal): `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`
- Transactional email: `RESEND_API_KEY`

## `mondaily-com-web` (marketing, Next.js)

- [ ] `NEXT_PUBLIC_API_URL` — present (the only thing it needs; proxies to the backend public ask route)
- [ ] **No** AI/DB/search secrets: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `AI_GATEWAY_*`, `SOVEREIGN_*`, `SUPABASE_SERVICE_KEY`, `CLERK_*`, `STRIPE_SECRET_KEY` — none
  (`scripts/audit/sovereignty-audit.sh` §2 proves the source reads none; this confirms the deploy env matches.)

## `mondaily-app` (SPA, `@mondaily/app`)

Frontend-safe env only (Vite exposes `VITE_*` to the browser — never put a secret here):
- [ ] `VITE_API_URL` — backend base URL
- [ ] `VITE_APP_URL` — app base URL
- [ ] **No** `VITE_CLERK_PUBLISHABLE_KEY` (removed) and **no** secret keys of any kind

## Quick verify

After changes, redeploy and hit the status endpoint (authenticated):

```
GET /api/v1/status
```

Every pillar (auth, database, AI gateway, sovereign search, scraper, jobs,
messaging, calls, Stripe, Google/Microsoft, training) reports live state with a
plain-language "Do this" for anything not operational. Nothing is marked
operational unless it was actually probed.
