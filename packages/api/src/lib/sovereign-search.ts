// Sovereign search + scrape appliance (self-hosted SearXNG + Playwright scraper on your own
// box). Everything routes here — no Tavily, no third-party search. When SOVEREIGN_SEARCH_KEY is
// set, calls carry a bearer token the appliance's proxy requires.
export function sovereignHeaders(): Record<string, string> {
  const key = process.env.SOVEREIGN_SEARCH_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

const SEARCH_URL = () => process.env.SOVEREIGN_SEARCH_URL || "http://localhost:8080/search";
const SCRAPE_URL = () => process.env.SOVEREIGN_SCRAPE_URL || "http://localhost:3002/v1/scrape";

/** SearXNG JSON search → result URLs (empty on any failure — never throws). */
export async function sovereignSearchUrls(query: string, limit = 4): Promise<string[]> {
  try {
    const url = `${SEARCH_URL()}?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, { headers: { Accept: "application/json", ...sovereignHeaders() } });
    if (!res.ok) return [];
    const data = await res.json() as { results?: { url?: string }[] };
    return (data.results ?? []).map(r => r.url).filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, limit);
  } catch { return []; }
}

/** Render one page to clean Markdown via the self-hosted scraper ("" on failure). */
export async function sovereignScrape(targetUrl: string): Promise<string> {
  try {
    const res = await fetch(SCRAPE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sovereignHeaders() },
      body: JSON.stringify({ url: targetUrl, formats: ["markdown"] }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { markdown?: string; content?: string; data?: { markdown?: string; content?: string } };
    return data.markdown ?? data.data?.markdown ?? data.content ?? data.data?.content ?? "";
  } catch { return ""; }
}

/** Search + scrape the top pages into a compact web-context string for LLM enrichment. */
export async function sovereignWebContext(query: string, maxPages = 2): Promise<string> {
  const urls = await sovereignSearchUrls(query, maxPages);
  if (!urls.length) return "";
  const pages = await Promise.all(urls.map(u => sovereignScrape(u)));
  return pages.filter(Boolean).map(p => p.slice(0, 2200)).join("\n\n---\n\n");
}
