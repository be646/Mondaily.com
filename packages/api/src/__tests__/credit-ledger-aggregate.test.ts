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

/**
 * Monthly included allowance. The catalog sells "N credits / month" and /credits/balance returns a
 * `reset_at`, but nothing ever reset anything — a Scout who spent their 100k never got more, and an
 * ANNUAL subscriber got one grant per YEAR (activateTier fires per invoice) against a per-month
 * promise. Model: `grant` = included/promotional (resets monthly), `purchase` = paid (never expires),
 * usage consumes grants first.
 */
describe("monthly included allowance", () => {
  const credits = read("lib/credits.ts");

  it("is applied lazily on read, not by a cron", () => {
    expect(credits).toMatch(/export async function ensurePeriodAllowance/);
    // A scheduled job that mutates every wallet monthly can fail silently, double-run or drift —
    // the exact failure mode that minted 48,915,590 in duplicate credits on this table.
    const vercelJson = readFileSync(join(SRC, "../vercel.json"), "utf8");
    expect(vercelJson).not.toMatch(/credit|allowance|wallet/i);
  });

  it("is idempotent per period via a marker row", () => {
    // Check-then-insert; without the marker it would re-apply on every single read.
    expect(credits).toMatch(/period reset \$\{periodKey/);
    expect(credits).toMatch(/\.eq\("description", marker\)/);
    // The row is written even when delta is 0 — it is the marker that stops recomputation
    // mid-month, so it must NOT be skipped for being a no-op.
    expect(credits).not.toMatch(/if \(delta === 0\) return/);
  });

  it("expires unused included credits but never purchased ones", () => {
    // delta is allotment − includedRemaining, so it goes NEGATIVE to claw back unused allowance
    // (no rollover). It is computed only from `granted`/`used`, never from `purchased`.
    expect(credits).toMatch(/const includedRemaining = Math\.max\(0, b\.granted - b\.used\)/);
    expect(credits).toMatch(/const delta = Math\.round\(allotment - includedRemaining\)/);
    // grantCredits() ignores non-positive amounts, so the reset must insert directly.
    expect(credits).toMatch(/transaction_type: "grant", description: marker/);
  });

  it("never enrolls a workspace just by reading it", () => {
    const fn = credits.slice(credits.indexOf("export async function ensurePeriodAllowance"));
    expect(fn).toMatch(/if \(!b\.enrolled\) return;/);
  });

  it("concurrent requests cannot double-apply", () => {
    // Idempotency is enforced in the DB, because check-then-act is a race between requests.
    const sql = readFileSync(join(SRC, "../../db/migrations/20260729_monthly_allowance.sql"), "utf8");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ai_credits_ledger_period_reset_uniq/);
    expect(sql).toMatch(/WHERE transaction_type = 'grant' AND description LIKE 'period reset %'/);
  });

  it("applies on AI usage too, not only when the billing UI is opened", () => {
    // A workspace that never loads /credits/balance must still receive its monthly credits.
    const gate = credits.slice(credits.indexOf("export async function assertCreditsOk"));
    expect(gate).toMatch(/await ensurePeriodAllowance\(workspaceId\)/);
  });

  it("the balance route no longer uses the cumulative reconcile on the read path", () => {
    // reconcileIncludedCredits compares TOTAL grants to the allotment, so once a workspace had ever
    // been granted its allotment it could never receive another month's worth.
    const route = read("routes/credits.ts");
    // Scoped to the /balance handler: the manual admin POST /credits/reconcile still uses it
    // deliberately, as an operator backstop.
    const balanceHandler = route.slice(route.indexOf('router.get("/balance"'), route.indexOf('router.get("/packs"'));
    expect(balanceHandler).toMatch(/await ensurePeriodAllowance\(ws\)/);
    expect(balanceHandler).not.toMatch(/reconcileIncludedCredits/);
    expect(route).toMatch(/router\.post\("\/reconcile", requireAdminRole/);
  });
});

/**
 * Ask AI honesty. The product's core promise is that answers come from the user's real workspace.
 * Each guard below corresponds to a path that could return a confident answer built on nothing.
 */
describe("Ask never answers from model priors", () => {
  const ask = readFileSync(join(SRC, "routes/ask.ts"), "utf8");
  const gw = readFileSync(join(SRC, "lib/ai-gateway.ts"), "utf8");

  it("an empty agent reply does not trigger an ungrounded re-ask", () => {
    // Was: aiGateway({ system: "…helpful business workspace assistant", prompt: message }) — no
    // tools, no tool results, no workspace data, rendered identically to a grounded answer.
    expect(ask).not.toMatch(/helpful business workspace assistant/);
    expect(ask).toMatch(/refusing to answer from model priors/);
  });

  it("the empty-reply guard does not claim work was done", () => {
    // Match the ASSIGNMENT, not any occurrence — the comment explaining the fix necessarily quotes
    // the old string, and a bare substring check fails on the explanation of its own fix. (Third
    // time this session; the lesson is to anchor on code shape, not prose.)
    expect(gw).not.toMatch(/const FRIENDLY = "Done — I've processed/);
    expect(gw).toMatch(/const FRIENDLY = "I ran the lookups but couldn't put an answer together/);
  });

  it("finance totals are per-currency, never a mixed face-value sum", () => {
    // Measured in production: EUR 9,814.16 + USD 92,686.84 + GBP 0 was reported by Ask as
    // "£102,501 paid" — three currencies added at face value and labelled as pounds, while the real
    // GBP total was zero. The old sum() returned a bare number with no currency code, so the model
    // attached whichever symbol the conversation implied.
    expect(ask).toMatch(/const byCur = new Map<string, number>\(\)/);
    expect(ask).toMatch(/\$\{v\.toFixed\(2\)\} \$\{c\}/);
    // no call site may re-format the (now string) total as a bare number
    expect(ask).not.toMatch(/sum\((overdue|draft|sent|paid)\)\.toFixed/);
  });

  it("finance totals are paged, and say so when they hit the ceiling", () => {
    // An unbounded select is capped at ~1000 rows with no error, so every figure was silently
    // understated while the output called itself "real data" — the same truncation that made the
    // credit wallet report noise.
    expect(ask).toMatch(/async function pagedNodes/);
    expect(ask).toMatch(/pagedNodes\(workspaceId, "finance", "invoice"\)/);
    expect(ask).toMatch(/pagedNodes\(workspaceId, "finance", "credit_note"/);
    expect(ask).toMatch(/LOWER BOUND, not the full picture/);
    // no unbounded invoice scan left
    expect(ask).not.toMatch(/\.eq\("object_type", "invoice"\);\s*\n\s*if \(invErr\)/);
  });
});
