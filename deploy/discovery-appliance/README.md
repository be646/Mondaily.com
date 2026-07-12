# Mondaily Discovery appliance

Self-hosted sovereign web search + scraper that powers Discovery (leads + reviews).
Fully in-house — SearXNG (private metasearch) + a small Playwright scraper + Caddy for a
bearer token. No third-party search SaaS.

```
Mondaily API (Vercel)  ──Bearer──►  Caddy :8080 ─► SearXNG   (search, JSON)
                       ──Bearer──►  Caddy :3002 ─► Scraper   (page → Markdown)
```

## 1. Prerequisites on the box (Hetzner, Ubuntu)

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo apt-get install -y docker-compose-plugin
```

Open the two ports in the firewall (Hetzner Cloud firewall UI, or ufw):

```bash
sudo ufw allow 8080/tcp
sudo ufw allow 3002/tcp
```

## 2. Copy this folder to the box

```bash
# from your machine, in the repo root
scp -r deploy/discovery-appliance root@<BOX_IP>:/opt/discovery-appliance
```

## 3. Configure secrets

```bash
cd /opt/discovery-appliance
cp .env.example .env
sed -i "s/replace_with_a_long_random_token/$(openssl rand -hex 32)/" .env
# set SearXNG's own secret too
sed -i "s/CHANGE_ME_secret_key/$(openssl rand -hex 32)/" searxng/settings.yml

cat .env    # <-- copy the APPLIANCE_TOKEN value; you need it for Vercel in step 5
```

## 4. Launch

```bash
docker compose up -d --build
docker compose ps          # all three should be "running"
```

Smoke-test locally on the box (replace <TOKEN> with APPLIANCE_TOKEN):

```bash
# search — should return JSON with a "results" array
curl -s -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:8080/search?q=coffee+shops+london&format=json" | head -c 400

# scrape — should return {"markdown":"...", ...}
curl -s -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","formats":["markdown"]}' \
  http://localhost:3002/v1/scrape | head -c 400

# no token → 401 (proves the edge is locked)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080/search?q=x&format=json"
```

## 5. Point Mondaily at it (Vercel → the **API/backend** project, not the frontend)

Set these three env vars, then redeploy the API project:

| Variable | Value |
|---|---|
| `SOVEREIGN_SEARCH_URL` | `http://<BOX_IP>:8080/search` |
| `SOVEREIGN_SCRAPE_URL` | `http://<BOX_IP>:3002/v1/scrape` |
| `SOVEREIGN_SEARCH_KEY` | the `APPLIANCE_TOKEN` from step 3 |

## 6. Verify from the app

- Open Discovery — the header dot should turn green ("Sovereign web search online").
- Or hit `GET https://<your-api-host>/api/v1/discovery/status` → `{"status":"HEALTHY"}`.
- Run a search ("aesthetic clinics in London") and a review search ("reviews about Trustpilot").

If status is `DEGRADED`, the `diagnostic` field tells you the exact cause (wrong Vercel
project, box unreachable, or 401 = token mismatch between `.env` and `SOVEREIGN_SEARCH_KEY`).

## Operations

```bash
docker compose logs -f scraper     # or searxng / caddy
docker compose restart
docker compose pull && docker compose up -d   # update images
```

## Hardening (recommended once it works)

Plain HTTP means the token crosses the internet unencrypted. Point a subdomain at the box
(e.g. `search.mondaily.com`), then in `Caddyfile` change `:8080 {` → `search.mondaily.com {`
and `:3002 {` → `scrape.mondaily.com {`, drop `auto_https off`, and Caddy auto-provisions TLS.
Then use `https://…` URLs (no port) in the Vercel vars.

## API contract (what the Mondaily API expects from this appliance)

Everything in `packages/api` reaches the appliance through `lib/sovereign-search.ts` — this is
the single client. Any replacement appliance must honor this contract.

### Auth
Every request carries `Authorization: Bearer <SOVEREIGN_SEARCH_KEY>` when the key is set.
The appliance MUST reject unauthenticated requests (Caddy enforces this) so it is never an
open proxy. The token is only ever read from env — it is never logged, stored, or shown in
any UI (readiness surfaces report booleans/status only).

### Search — `GET {SOVEREIGN_SEARCH_URL}?q=<query>&format=json&language=en-US&engines=<list>`
SearXNG JSON shape. Required response:

```json
{ "results": [ { "url": "https://…", "title": "…", "content": "snippet…" } ] }
```

- `url` is required per result; `title`/`content` feed candidate ranking and lead snippets.
- Engine list comes from `SOVEREIGN_SEARCH_ENGINES` (default `qwant,yahoo` — datacenter-reliable).
- Non-200 / malformed JSON / connection error ⇒ the client returns `[]` (fail-closed, never throws).
- The discovery worker staggers queries (batches of 2, 1.2s apart) — the appliance should expect
  low, bursty QPS, not sustained load. No server-side rate limiting is required beyond that.

### Scrape — `POST {SOVEREIGN_SCRAPE_URL}` with `{"url": "...", "formats": ["markdown"], "deep": bool}`
Required response (either nesting accepted):

```json
{ "markdown": "# page as markdown…" }        // or { "data": { "markdown": "…" } }
```

- `deep: true` ⇒ scroll the page to load lazy content (review/listing pages) before extracting.
- Non-200 / error ⇒ client returns `""`; the lead is NOT fabricated and the page counts as skipped.
- Successful scrapes are cached 24h client-side (`discovery-cache`), so re-runs don't re-fetch.

### Health
- Search: `GET {origin}/healthz` (SearXNG) — 200 when up.
- Scraper: `GET {origin}/health` — 200 when up.
- `GET /api/v1/discovery/status` on the Mondaily API probes both (8s timeout each) and returns
  `HEALTHY | DEGRADED` + a precise `diagnostic` string; env presence is reported as booleans only.

### Privacy / sovereignty invariants
- Queries and scraped pages go ONLY to this appliance — no third-party search/scrape SaaS
  (no Tavily/SerpAPI/Firecrawl/etc.); enforced by `sovereignty.test.ts`.
- The appliance must not log request bodies/queries beyond transient operational logs.
- Missing env ⇒ every caller fails closed (empty results + an honest "not configured" reason
  surfaced to the user); nothing silently falls back to an external provider.
