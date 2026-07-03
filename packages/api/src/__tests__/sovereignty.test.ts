import { describe, it, expect, afterEach } from "vitest";

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
