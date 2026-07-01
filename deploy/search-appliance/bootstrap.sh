#!/usr/bin/env bash
# Mondaily Search Appliance — one-shot installer.
# Run once on a fresh Ubuntu/Debian server (as root):  bash bootstrap.sh
# It installs Docker, writes every file, starts SearXNG + the scraper, and verifies them.
set -euo pipefail

DIR=/opt/mondaily-search
echo "==> Mondaily search appliance installing into $DIR"

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# 2. Files
mkdir -p "$DIR/searxng" "$DIR/scraper"
cd "$DIR"

SECRET=$(openssl rand -hex 32)
cat > searxng/settings.yml <<YML
use_default_settings: true
server:
  secret_key: "$SECRET"
  bind_address: "0.0.0.0"
  limiter: false
  image_proxy: false
search:
  formats:
    - html
    - json
YML

cat > docker-compose.yml <<'YML'
services:
  searxng:
    image: searxng/searxng:latest
    container_name: mondaily-searxng
    ports: ["8080:8080"]
    volumes: ["./searxng:/etc/searxng:rw"]
    environment:
      - SEARXNG_BASE_URL=http://localhost:8080/
    restart: unless-stopped
  scraper:
    build: ./scraper
    container_name: mondaily-scraper
    ports: ["3002:3002"]
    restart: unless-stopped
YML

cat > scraper/package.json <<'JSON'
{
  "name": "mondaily-scraper",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "dependencies": {
    "@mozilla/readability": "^0.5.0",
    "express": "^4.19.2",
    "jsdom": "^24.1.3",
    "playwright": "1.48.0",
    "turndown": "^7.2.0"
  }
}
JSON

cat > scraper/Dockerfile <<'DOCKER'
FROM mcr.microsoft.com/playwright:v1.48.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 3002
CMD ["node", "server.js"]
DOCKER

cat > scraper/server.js <<'JS'
const express = require("express");
const { chromium } = require("playwright");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");
const PORT = process.env.PORT || 3002;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const app = express();
app.use(express.json({ limit: "2mb" }));
let browser;
async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  return browser;
}
app.get("/health", (_q, r) => r.json({ ok: true }));
app.post("/v1/scrape", async (req, res) => {
  const url = req.body && req.body.url;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });
  let ctx;
  try {
    const b = await getBrowser();
    ctx = await b.newContext({ userAgent: "Mozilla/5.0 (compatible; MondailyBot/1.0)" });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(800);
    const html = await page.content();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const markdown = turndown.turndown((article && article.content) || html).slice(0, 100000);
    res.json({ markdown, content: markdown, data: { markdown } });
  } catch (e) {
    res.status(200).json({ markdown: "", error: String(e && e.message ? e.message : e) });
  } finally { if (ctx) await ctx.close().catch(() => {}); }
});
app.listen(PORT, () => console.log("[scraper] listening on :" + PORT));
JS

# 3. Firewall (open the two ports)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 8080/tcp || true
  ufw allow 3002/tcp || true
fi

# 4. Build + start
echo "==> Building and starting (first run pulls images, ~3-5 min)..."
docker compose up -d --build

echo "==> Waiting for services to come up..."
sleep 25

# 5. Verify
IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || echo "YOUR_SERVER_IP")
echo ""
echo "================ VERIFY ================"
echo "-- search --"; curl -fsS "http://localhost:8080/search?q=anthropic&format=json" | head -c 200 || echo "SEARCH NOT READY YET"
echo ""
echo "-- scrape --"; curl -fsS -X POST localhost:3002/v1/scrape -H 'content-type: application/json' -d '{"url":"https://example.com"}' | head -c 200 || echo "SCRAPER NOT READY YET (may still be building)"
echo ""
echo "======================================="
echo ""
echo "DONE. Set these in Vercel (API project → Settings → Environment Variables), then redeploy:"
echo "  SOVEREIGN_SEARCH_URL = http://$IP:8080/search"
echo "  SOVEREIGN_SCRAPE_URL = http://$IP:3002/v1/scrape"
echo ""
echo "If scrape said NOT READY, wait 2 min for the image build, then re-run the two curl lines above."
