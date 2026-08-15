import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const vercel = JSON.parse(readFileSync(join(__dirname, "../../vercel.json"), "utf8")) as {
  regions?: string[];
  functions?: Record<string, unknown>;
};

/**
 * THE FUNCTION MUST SIT NEXT TO THE DATABASE.
 *
 * MEASURED 2026-08-15, and this was the single largest source of latency in the product:
 *
 *   Supabase DB host   resolves into 2a05:d014::/36 — AWS eu-central-1, Frankfurt
 *   Vercel function    x-vercel-id said `fra1::iad1::` — the EDGE was Frankfurt, the FUNCTION
 *                      was iad1, Washington DC
 *   eu-central-1 → eu-central-1   ~7ms
 *   eu-central-1 → us-east-1      ~103ms
 *
 * No region was pinned, so Vercel defaulted to iad1 and every database round trip crossed the
 * Atlantic twice. A request making four queries paid roughly 800ms in pure network time before any
 * work happened — which is why authenticated endpoints measured 0.85-2.5s in the browser while
 * /api/health, which touches no database, answered in 0.3s.
 *
 * This is also closer for the user: Cairo reaches Frankfurt far faster than Washington.
 */
describe("the API runs in the same region as its database", () => {
  it("pins the function to fra1, next to Supabase in eu-central-1", () => {
    expect(vercel.regions, "an unpinned function defaults to iad1, an ocean away from the data")
      .toEqual(["fra1"]);
  });

  it("keeps the long-running function budget", () => {
    // Region pinning must not quietly drop the maxDuration that agent runs depend on.
    expect(vercel.functions?.["api/handler.js"]).toMatchObject({ maxDuration: 300 });
  });
});
