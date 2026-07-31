// Sovereign search + scrape appliance (self-hosted SearXNG + Playwright scraper on your own
// box). Everything routes here — no Tavily, no third-party search. When SOVEREIGN_SEARCH_KEY is
// set, calls carry a bearer token the appliance's proxy requires.
export function sovereignHeaders(): Record<string, string> {
  const key = process.env.SOVEREIGN_SEARCH_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// In production we FAIL LOUD (empty URL → the call logs "appliance not configured" and returns
// nothing) rather than silently defaulting to a localhost that will never exist on Vercel. The
// localhost default is a dev-only convenience.
const DEV = () => process.env.NODE_ENV !== "production";
const SEARCH_URL = () => process.env.SOVEREIGN_SEARCH_URL || (DEV() ? "http://localhost:8080/search" : "");
const SCRAPE_URL = () => process.env.SOVEREIGN_SCRAPE_URL || (DEV() ? "http://localhost:3002/v1/scrape" : "");
// Datacenter-reliable engine set (see social-discovery): CAPTCHA'd engines in the default mix
// zero out otherwise-good results, so pin to the ones that respond. Overridable via env.
// 2026-08-01: qwant + yahoo BOTH went dead upstream (access denied / protocol error), which
// silently zeroed every AI-generate and enrichment query while the health probe stayed green
// (healthz doesn't exercise engines). duckduckgo + bing verified live from the appliance.
const SEARCH_ENGINES = () => process.env.SOVEREIGN_SEARCH_ENGINES || "duckduckgo,bing";

/** SearXNG JSON search → result URLs (empty on any failure — never throws). */
export async function sovereignSearchUrls(query: string, limit = 4): Promise<string[]> {
  if (!SEARCH_URL()) { console.error("[sovereign-search] search appliance not configured — SOVEREIGN_SEARCH_URL is missing"); return []; }
  try {
    // language=en-US — the appliance's German Hetzner IP makes engines geo-localize results to
    // Germany otherwise (verified live). All enrichment/web-search queries are English.
    const url = `${SEARCH_URL()}?q=${encodeURIComponent(query)}&format=json&language=en-US&engines=${encodeURIComponent(SEARCH_ENGINES())}`;
    const res = await fetch(url, { headers: { Accept: "application/json", ...sovereignHeaders() } });
    if (!res.ok) return [];
    const data = await res.json() as { results?: { url?: string }[] };
    return (data.results ?? []).map(r => r.url).filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, limit);
  } catch { return []; }
}

/** Render one page to clean Markdown via the self-hosted scraper ("" on failure).
 *  Pass { deep:true } for review/listing pages so the scraper scrolls to load lazy content
 *  (e.g. ZnanyLekarz/GoWork load reviews on scroll) and returns much more text.
 *  Result is cached 24h (fail-open) so repeat runs/monitors don't re-scrape. */
export async function sovereignScrape(targetUrl: string, opts?: { deep?: boolean }): Promise<string> {
  if (!SCRAPE_URL()) { console.error("[sovereign-search] scraper appliance not configured — SOVEREIGN_SCRAPE_URL is missing"); return ""; }
  const { cacheGet, cacheSet, cacheKey } = await import("./discovery-cache");
  const ck = cacheKey("scrape", `${opts?.deep ? "d" : "s"}:${targetUrl}`);
  const cached = await cacheGet<string>(ck);
  if (cached != null) return cached;
  try {
    const res = await fetch(SCRAPE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sovereignHeaders() },
      body: JSON.stringify({ url: targetUrl, formats: ["markdown"], deep: !!opts?.deep }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { markdown?: string; content?: string; data?: { markdown?: string; content?: string } };
    const md = data.markdown ?? data.data?.markdown ?? data.content ?? data.data?.content ?? "";
    if (md && md.length > 100) void cacheSet(ck, "scrape", md, 86_400); // cache real content 24h
    return md;
  } catch { return ""; }
}

/** Search + scrape the top pages into a compact web-context string for LLM enrichment. */
export async function sovereignWebContext(query: string, maxPages = 2): Promise<string> {
  const urls = await sovereignSearchUrls(query, maxPages);
  if (!urls.length) return "";
  const pages = await Promise.all(urls.map(u => sovereignScrape(u)));
  return pages.filter(Boolean).map(p => p.slice(0, 2200)).join("\n\n---\n\n");
}
