import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Sovereignty guarantees, enforced as tests:
 *   • AI gateway FAILS CLOSED when its env is missing (never silently routes to a default endpoint).
 *   • Sovereign search/scrape FAIL CLOSED (return nothing) when the appliance env is missing in prod.
 * The env-reading functions read process.env at call time, so we can toggle env per test.
 */
const SNAPSHOT = { ...process.env };
afterEach(() => { process.env = { ...SNAPSHOT }; });

function clearGatewayEnv() {
  for (const k of ["AI_GATEWAY_BASE_URL", "CEREBRAS_BASE_URL", "CEREBRAS_API_BASE_URL", "AI_GATEWAY_API_KEY", "CEREBRAS_API_KEY"]) delete process.env[k];
}

describe("AI gateway fail-closed", () => {
  it("gatewayEnv() reports no baseURL/apiKey when unset", async () => {
    clearGatewayEnv();
    const { gatewayEnv } = await import("../lib/ai-gateway");
    const env = gatewayEnv();
    expect(env.baseURL).toBeFalsy();
    expect(env.apiKey).toBeFalsy();
  });

  it("aiGatewayToolUse rejects (does NOT hit a default OpenAI endpoint) with no gateway env", async () => {
    clearGatewayEnv();
    const { aiGatewayToolUse } = await import("../lib/ai-gateway");
    await expect(
      aiGatewayToolUse({ toolName: "t", toolDescription: "d", toolSchema: { type: "object", properties: {} }, prompt: "hello" }),
    ).rejects.toThrow(/AI_GATEWAY_BASE_URL/i);
  });
});

describe("Sovereign search/scrape fail-closed", () => {
  it("sovereignSearchUrls returns [] in production when SOVEREIGN_SEARCH_URL is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SOVEREIGN_SEARCH_URL;
    const { sovereignSearchUrls } = await import("../lib/sovereign-search");
    await expect(sovereignSearchUrls("anything")).resolves.toEqual([]);
  });

  it("sovereignScrape returns '' in production when SOVEREIGN_SCRAPE_URL is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SOVEREIGN_SCRAPE_URL;
    const { sovereignScrape } = await import("../lib/sovereign-search");
    await expect(sovereignScrape("https://example.com")).resolves.toBe("");
  });
});

describe("Discovery worker fail-closed (SKIPPED_NOT_CONFIGURED, honest to the user)", () => {
  it("runSocialDiscovery skips with an honest reason and emits an error event when search env is missing in production", async () => {
    // The worker resolves SOVEREIGN_SEARCH_URL at module load, so reset modules to re-read env.
    vi.resetModules();
    process.env.NODE_ENV = "production";
    delete process.env.SOVEREIGN_SEARCH_URL;
    const { runSocialDiscovery, SEARCH_NOT_CONFIGURED_REASON } = await import("../jobs/social-discovery");
    const events: Record<string, unknown>[] = [];
    const result = await runSocialDiscovery(
      { workspaceId: "ws-test", searchType: "INTENT_LEADS", sector: "clinics" },
      (ev) => { events.push(ev); },
    );
    // No fake leads, no fake counts — an explicit skip status with the exact operator-facing reason.
    expect(result.status).toBe("SKIPPED_NOT_CONFIGURED");
    expect(result.reason).toBe(SEARCH_NOT_CONFIGURED_REASON);
    expect(result).not.toHaveProperty("results");
    expect(result).not.toHaveProperty("discovered");
    // The streaming client is told honestly (SSE error event), not left on a spinner.
    expect(events.some((e) => e.type === "error" && e.error === SEARCH_NOT_CONFIGURED_REASON)).toBe(true);
    vi.resetModules();
  });
});

describe("No direct external search/scrape provider paths (source audit)", () => {
  // Any search/scrape traffic must go through the sovereign appliance. This walks the whole API
  // source tree and fails if a third-party search/scrape SaaS endpoint appears outside tests.
  const FORBIDDEN = [
    "api.tavily.com", "serpapi.com", "api.bing.microsoft.com", "customsearch.googleapis.com",
    "api.search.brave.com", "firecrawl.dev", "scrapingbee.com", "outscraper.com", "api.apify.com",
    "serper.dev", "exa.ai", "app.zenrows.com",
  ];
  const SRC = fileURLToPath(new URL("..", import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "__tests__" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
  it("no forbidden provider endpoint is USED anywhere in packages/api/src (comments may name them as anti-examples)", () => {
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8").toLowerCase();
      for (const host of FORBIDDEN) {
        // Usage = the host inside a URL or string literal (fetchable), not a prose mention in a comment.
        const used = new RegExp(`(://|["'\`])${host.replace(/\./g, "\\.")}`).test(src);
        expect(used, `${file} uses ${host}`).toBe(false);
      }
    }
  });
  it("enrichment routes through the SHARED sovereign client (no duplicate fetch client with prod localhost defaults)", () => {
    const src = readFileSync(join(SRC, "jobs/enrich-record.ts"), "utf8");
    expect(src).toMatch(/import \{ sovereignSearchUrls, sovereignScrape \} from "\.\.\/lib\/sovereign-search"/);
    // The old duplicate client hardcoded localhost fallbacks that silently 'ran' in production.
    expect(src).not.toMatch(/const SOVEREIGN_SEARCH_URL\s*=/);
    expect(src).not.toMatch(/const SOVEREIGN_SCRAPE_URL\s*=/);
    expect(src).not.toContain("localhost:3000/v2/scrape");
  });
});

describe("Discovery proof-of-work comes from real counters (source audit)", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
  it("the worker's usage object is built from real accumulators, and skip reasons are real", () => {
    const worker = read("jobs/social-discovery.ts");
    // usage = { tokens, ai_calls, pages_skipped } assembled from counters — never literals.
    expect(worker).toContain("const usage = { tokens: usedTokens, ai_calls: aiCalls, pages_skipped: skipped }");
    expect(worker).toContain("const skipped = allPages.length - pages.length");
    // Zero-result honesty: an explicit reason, not an invented lead list.
    expect(worker).toContain('reason: "no search results"');
  });
  it("appliance readiness surfaces report booleans/status only — never env values or the key", () => {
    const discovery = read("routes/discovery.ts");
    // configured flags are Boolean(...) presence checks; the actual key value is never returned.
    expect(discovery).toMatch(/configured: \{ search_url: Boolean\(process\.env\.SOVEREIGN_SEARCH_URL\), scrape_url: Boolean\(process\.env\.SOVEREIGN_SCRAPE_URL\), search_key: Boolean\(process\.env\.SOVEREIGN_SEARCH_KEY\) \}/);
    expect(discovery).not.toMatch(/json\([^)]*process\.env\.SOVEREIGN_SEARCH_KEY[^)]*\)/);
  });
});
