# Mondaily Search Appliance (SearXNG + scraper)

Self-hosted metasearch (SearXNG, JSON API) + a JS-rendering Markdown scraper that powers
Discovery + record enrichment. Deploy on your Hetzner box, then point the app at it with two
env vars in Vercel.

## Contract (what the app calls)
- Search: `GET  $SOVEREIGN_SEARCH_URL?q=...&format=json` (no `engines=` param — the engine list is
  fixed server-side in `searxng/settings.yml`) → `{ results: [{ url }] }`
- Scrape: `POST $SOVEREIGN_SCRAPE_URL` with `{ url, formats: ["markdown"] }` → `{ markdown }`

## Engine health (check this if Discovery goes thin)
SearXNG's stock defaults (brave/duckduckgo/startpage) get CAPTCHA'd/rate-limited from most
datacenter IPs — confirmed live on this box 2026-07-01 (`unresponsive_engines` showed all three
blocked, meaning searches were silently returning ~0 results). `searxng/settings.yml` now pins
explicit working engines (bing, qwant, wikipedia) verified live from this exact IP, with the
blocked ones disabled. If results go thin again (a provider can start blocking any IP over time),
re-run this probe from your machine to find what still works:
```
for eng in bing qwant google mojeek yahoo brave duckduckgo startpage; do
  echo "=== $eng ==="
  curl -s --max-time 8 "$SOVEREIGN_SEARCH_URL?q=test&format=json&engines=$eng" \
    -H "Authorization: Bearer $SOVEREIGN_SEARCH_KEY" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('results:', len(d.get('results',[])), 'unresponsive:', d.get('unresponsive_engines',[]))"
done
```
Then update the `engines:` list in `searxng/settings.yml`, `scp` it to the box, and
`docker compose restart searxng`.

## Deploy
1. Install Docker + compose (Ubuntu): `curl -fsSL https://get.docker.com | sh`
2. Copy this folder to the server: `scp -r deploy/search-appliance root@HETZNER_IP:/opt/mondaily-search`
3. `cd /opt/mondaily-search`
4. Set a real SearXNG secret: `sed -i "s/CHANGE_ME_TO_A_RANDOM_64_CHAR_HEX/$(openssl rand -hex 32)/" searxng/settings.yml`
5. (optional) `export SCRAPER_API_KEY=$(openssl rand -hex 16)` for a shared secret
6. `docker compose up -d --build`
7. Verify: `curl "http://localhost:8080/search?q=test&format=json" | head` and `curl -X POST localhost:3002/v1/scrape -H 'content-type: application/json' -d '{"url":"https://example.com"}'`

## Firewall
Only expose to your API. Simplest: keep ports closed publicly and use a reverse proxy/VPN, or
`ufw allow from <trusted> to any port 8080` / `3002`. SearXNG has no auth — do NOT leave 8080
open to the whole internet long-term.

## Vercel env
- `SOVEREIGN_SEARCH_URL = http://HETZNER_IP:8080/search`
- `SOVEREIGN_SCRAPE_URL = http://HETZNER_IP:3002/v1/scrape`

Redeploy the API and Discovery/enrichment go live (code already reads these + degrades when unset).
