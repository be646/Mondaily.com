import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/**
 * Regression guard for the wallet-total bug.
 *
 * Five call sites summed ai_credits_ledger in JavaScript via an unbounded
 * `.select("amount, transaction_type").eq("workspace_id", …)`. With no .limit() and no .order(),
 * PostgREST caps the response and returns an arbitrary subset once a workspace outgrows it — so the
 * totals were nondeterministic. Measured against production: eight identical reads of
 * /credits/balance returned `used` values spanning 134,984 credits and `remaining` spanning 315,016,
 * with no AI spend between the calls. Users reported "I have the same tokens even if I use AI",
 * because the displayed number was noise rather than their real consumption.
 *
 * Enforcement was never wrong (creditStatus uses the ai_credit_balance RPC), so this was a
 * display/accounting bug only — but every number the product showed came from the broken path.
 */
describe("credit ledger totals are always computed server-side", () => {
  const LEDGER_CONSUMERS = [
    "lib/credits.ts",
    "routes/credits.ts",
    "routes/usage.ts",
    "routes/support.ts",
  ];

  it("no route or lib selects ledger amounts for summing without a bound", () => {
    const offenders: string[] = [];
    for (const file of LEDGER_CONSUMERS) {
      const src = read(file);
      // The exact shape that truncates: selecting `amount` from the ledger with neither a range/limit
      // nor an explicit order on the same statement.
      const re = /from\("ai_credits_ledger"\)\s*\.select\(\s*"([^"]*amount[^"]*)"\s*\)((?:(?!;)[\s\S])*?);/g;
      for (const m of src.matchAll(re)) {
        const tail = m[2] ?? "";
        if (!/\.(limit|range)\(/.test(tail)) offenders.push(`${file}: .select("${m[1]}")`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exposes one shared aggregate helper the consumers reuse", () => {
    const credits = read("lib/credits.ts");
    expect(credits).toMatch(/export async function ledgerBreakdown/);
    // Prefers the SQL aggregate...
    expect(credits).toMatch(/rpc\("ai_credit_breakdown"/);
    // ...and still totals exactly when the migration hasn't been applied, by paging with a stable
    // order rather than trusting one unbounded read.
    expect(credits).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
    expect(credits).toMatch(/\.order\("id", \{ ascending: true \}\)/);

    for (const file of ["routes/credits.ts", "routes/usage.ts", "routes/support.ts"]) {
      expect(read(file), `${file} should reuse ledgerBreakdown`).toMatch(/ledgerBreakdown\(/);
    }
  });

  it("burst window usage is aggregated in SQL too", () => {
    const credits = read("lib/credits.ts");
    // A truncated burst sum UNDER-counts, which would silently let the rate cap be overrun.
    expect(credits).toMatch(/rpc\("ai_credit_usage_since"/);
  });

  it("the migration defines both aggregates", () => {
    const sql = readFileSync(
      join(SRC, "../../db/migrations/20260729_ai_credit_breakdown.sql"),
      "utf8",
    );
    expect(sql).toMatch(/FUNCTION ai_credit_breakdown\(ws uuid\)/);
    expect(sql).toMatch(/FUNCTION ai_credit_usage_since\(ws uuid, since timestamptz\)/);
    // usage rows are stored negative; the aggregate must return the positive magnitude the UI shows
    expect(sql).toMatch(/ABS\(COALESCE\(SUM\(amount\) FILTER \(WHERE transaction_type = 'usage'\), 0\)\)/);
  });
});

describe("entitlement is resolved through one function", () => {
  it("diagnostics reports the EFFECTIVE tier, not a second derivation", () => {
    const src = read("routes/credits.ts");
    // /credits/diagnostics called resolveEntitlement() directly, which skips the product-owner
    // override — so it reported "scout" for a workspace that every other surface, and enforcement
    // itself, resolved to "sovereign". The debugging tool contradicted the product.
    expect(src).toMatch(/const ent = await getEntitlement\(ws\);/);
    // The stored-field derivation is still surfaced, but clearly labelled as the non-effective one.
    expect(src).toMatch(/stored_tier_would_be/);
  });
});
