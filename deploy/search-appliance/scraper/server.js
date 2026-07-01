// Minimal JS-rendering scraper that matches the exact contract Mondaily's enrichment expects:
//   POST /v1/scrape   { url, formats: ["markdown"] }  ->  { markdown, data: { markdown } }
// Renders the page in Chromium, extracts the main article (Readability), converts to Markdown.
const express = require("express");
const { chromium } = require("playwright");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const TurndownService = require("turndown");

const PORT = process.env.PORT || 3002;
const API_KEY = process.env.SCRAPER_API_KEY || "";
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const app = express();
app.use(express.json({ limit: "2mb" }));

let browser;
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  return browser;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/v1/scrape", async (req, res) => {
  if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const url = req.body && req.body.url;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });

  let ctx;
  try {
    const b = await getBrowser();
    ctx = await b.newContext({ userAgent: "Mozilla/5.0 (compatible; MondailyBot/1.0)" });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(800); // let late JS settle
    const html = await page.content();

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const markdown = turndown.turndown((article && article.content) || html).slice(0, 100_000);

    res.json({ markdown, content: markdown, data: { markdown } });
  } catch (e) {
    // Return 200 with empty markdown so the caller degrades gracefully (it checks for "").
    res.status(200).json({ markdown: "", error: String(e && e.message ? e.message : e) });
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
});

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}`));
