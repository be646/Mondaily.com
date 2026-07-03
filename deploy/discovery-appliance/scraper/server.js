// Sovereign page scraper — renders a URL with headless Chromium and returns clean Markdown.
// Implements exactly the contract the Mondaily API calls (see lib/sovereign-search.ts):
//   POST /v1/scrape   { "url": "...", "formats": ["markdown"] }  ->  { "markdown": "..." }
//   GET  /health      -> 200 "ok"   (used by /discovery/status)
// One shared browser; a small concurrency gate so a burst of scrapes can't exhaust memory.
import express from "express";
import { chromium } from "playwright";
import TurndownService from "turndown";

const PORT = process.env.PORT || 3002;
const NAV_TIMEOUT = 20_000;
const MAX_CONCURRENCY = Number(process.env.SCRAPER_CONCURRENCY || 4);

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const app = express();
app.use(express.json({ limit: "1mb" }));

let browserPromise = null;
const getBrowser = () => (browserPromise ??= chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));

let active = 0;
const waiters = [];
const acquire = () =>
  active < MAX_CONCURRENCY ? Promise.resolve((active++, undefined)) : new Promise((r) => waiters.push(r)).then(() => void active++);
const release = () => { active--; const next = waiters.shift(); if (next) next(); };

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/v1/scrape", async (req, res) => {
  const url = (req.body && req.body.url) || "";
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "valid http(s) url required" });

  await acquire();
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; MondailyDiscovery/1.0)",
      viewport: { width: 1280, height: 900 },
    });
    // Skip images/fonts/media — we only need the text, and it makes scrapes much faster.
    await context.route("**/*", (route) => {
      const t = route.request().resourceType();
      return t === "image" || t === "font" || t === "media" ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(400); // let late text hydrate

    // Deep mode: scroll to the bottom repeatedly to trigger lazy-loaded content (review lists like
    // ZnanyLekarz/GoWork only render more entries as you scroll) and click common "show more /
    // load more / więcej" buttons. This turns "1 review" into "all reviews".
    const deep = !!(req.body && req.body.deep);
    if (deep) {
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(600);
        await page.evaluate(() => {
          const re = /(show more|load more|see more|more reviews|więcej|pokaż|załaduj|voir plus|mehr)/i;
          const btn = Array.from(document.querySelectorAll("button, a, span, div"))
            .find((e) => re.test((e.textContent || "").trim()) && (e.textContent || "").length < 40);
          if (btn) btn.click();
        }).catch(() => {});
      }
      await page.waitForTimeout(500);
    }

    // Strip scripts/styles/chrome AND images/icons/buttons (review lists wrap every entry in ~5
    // icon <img> tags — that noise eats the extraction budget and buries the actual review text).
    const html = await page.evaluate(() => {
      document.querySelectorAll("script,style,noscript,svg,iframe,img,picture,button,header,footer,nav").forEach((el) => el.remove());
      const main = document.querySelector("main,article,[role=main]") || document.body;
      return main ? main.innerHTML : "";
    });
    const cap = deep ? 120_000 : 20_000; // review/listing pages need room for many entries
    const markdown = td.turndown(html || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")   // kill any leftover markdown images
      .replace(/\[\]\([^)]*\)/g, "")          // empty links
      .replace(/^\s*[-*]\s*$/gm, "")          // stray bullet chrome
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, cap);
    res.json({ markdown, url });
  } catch (e) {
    // Never 500 the API's pipeline — return empty so it degrades gracefully.
    res.json({ markdown: "", url, error: String(e && e.message ? e.message : e).slice(0, 200) });
  } finally {
    if (context) await context.close().catch(() => {});
    release();
  }
});

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
