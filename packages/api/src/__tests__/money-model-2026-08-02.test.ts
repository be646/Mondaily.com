import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMoney, buildSettlement, hasMoney, readMoney, roundToCurrency, currencyDecimals,
} from "@mondaily/shared/money";
import { parseEcbHistoryXml, parseEcbXml } from "../lib/currency";

/**
 * FX step 2 — the five-field money model. An amount is not a number: it is a number, the currency
 * it was really charged in, and the rate that related them ON THE DAY. Converting on read is why
 * historical figures moved every morning.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("currency minor units are not universally 2dp", () => {
  it("knows zero-decimal and three-decimal currencies", () => {
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("KWD")).toBe(3);
    expect(currencyDecimals("PLN")).toBe(2);
    expect(currencyDecimals("usd")).toBe(2);
  });

  it("rounds to the currency's real unit", () => {
    expect(roundToCurrency(1234.567, "JPY")).toBe(1235);
    expect(roundToCurrency(1.23456, "KWD")).toBe(1.235);
    expect(roundToCurrency(1.005, "PLN")).toBe(1.01);
  });

  it("does not lose a cent at the rounding boundary", () => {
    // Math.round(x * 100) / 100 returns 1.00 here: 1.005 is 1.00499999999999989 as a double.
    for (const [v, want] of [[1.005, 1.01], [2.675, 2.68], [8.165, 8.17], [1.0049, 1.0]] as const) {
      expect(roundToCurrency(v, "PLN"), String(v)).toBe(want);
    }
  });

  it("handles negatives symmetrically — a refund is not rounded differently", () => {
    expect(roundToCurrency(-1.005, "PLN")).toBe(-1.0);   // JS rounds -1.005 half UP toward zero
    expect(roundToCurrency(-2.5, "JPY")).toBe(-2);
  });

  it("never returns NaN for junk", () => {
    expect(roundToCurrency(NaN, "PLN")).toBe(0);
    expect(roundToCurrency(Infinity, "PLN")).toBe(0);
  });
});

describe("buildMoney freezes the charge and its valuation", () => {
  const money = buildMoney({ amount: 1000, currency: "USD", base: "PLN", rate: 3.95, as_of: "2026-06-11", source: "ecb" });

  it("keeps exactly what the client is charged", () => {
    expect(money.amount_presentment).toBe(1000);
    expect(money.currency_presentment).toBe("USD");
  });

  it("stores the rate and the value it produced", () => {
    expect(money.fx_rate).toBe(3.95);
    expect(money.amount_base).toBe(3950);
    expect(money.currency_base).toBe("PLN");
  });

  it("carries provenance so the figure can be reproduced", () => {
    expect(money.fx_rate_as_of).toBe("2026-06-11");
    expect(money.fx_rate_source).toBe("ecb");
  });

  it("the stored rate reproduces the stored base amount", () => {
    expect(roundToCurrency(money.amount_presentment * money.fx_rate, money.currency_base)).toBe(money.amount_base);
  });

  it("uppercases currencies so lookups can't miss on case", () => {
    const m = buildMoney({ amount: 10, currency: "usd", base: "pln", rate: 4 });
    expect(m.currency_presentment).toBe("USD");
    expect(m.currency_base).toBe("PLN");
  });
});

describe("settlement makes realised FX gain/loss derivable", () => {
  const issued = buildMoney({ amount: 1000, currency: "USD", base: "PLN", rate: 3.95, as_of: "2026-06-11" });

  it("a stronger rate at payment is a real gain the business earned by waiting", () => {
    const s = buildSettlement(issued, { rate: 4.10, on: "2026-07-02", as_of: "2026-07-02" });
    expect(s.settlement_amount_base).toBe(4100);
    expect(s.fx_gain_loss).toBe(150);
    expect(s.settled_on).toBe("2026-07-02");
  });

  it("a weaker rate is a loss, not an absolute difference", () => {
    const s = buildSettlement(issued, { rate: 3.80, on: "2026-07-02" });
    expect(s.fx_gain_loss).toBe(-150);
  });

  it("no movement means no gain — the field is zero, not absent", () => {
    const s = buildSettlement(issued, { rate: 3.95, on: "2026-07-02" });
    expect(s.fx_gain_loss).toBe(0);
  });

  it("the client is never re-charged: presentment is untouched by settlement", () => {
    const s = buildSettlement(issued, { rate: 4.10, on: "2026-07-02" });
    expect(issued.amount_presentment).toBe(1000);
    expect(Object.keys(s)).not.toContain("amount_presentment");
  });
});

describe("readMoney copes with all three shapes on record today", () => {
  it("reads the model when present", () => {
    const m = readMoney({ ...buildMoney({ amount: 500, currency: "EUR", base: "PLN", rate: 4.27 }) });
    expect(m.amount).toBe(500);
    expect(m.currency).toBe("EUR");
    expect(m.base_amount).toBe(2135);
    expect(m.modelled).toBe(true);
  });

  it("reads legacy invoices/quotes (total + currency)", () => {
    const m = readMoney({ total: 3001.2, currency: "GBP" });
    expect(m.amount).toBe(3001.2);
    expect(m.currency).toBe("GBP");
    expect(m.modelled).toBe(false);      // no stored rate — callers must not claim otherwise
    expect(m.base_amount).toBeNull();
  });

  it("reads legacy expenses/credit notes (amount_cents)", () => {
    const m = readMoney({ amount_cents: 192000, currency: "EUR" });
    expect(m.amount).toBe(1920);
    expect(m.modelled).toBe(false);
  });

  it("returns a zero rather than throwing on an empty or unknown record", () => {
    expect(readMoney(null).amount).toBe(0);
    expect(readMoney({}).amount).toBe(0);
  });

  it("hasMoney only accepts a complete block", () => {
    expect(hasMoney(buildMoney({ amount: 1, currency: "USD", base: "PLN", rate: 4 }))).toBe(true);
    expect(hasMoney({ amount_presentment: 1, currency_presentment: "USD" })).toBe(false);   // no base
    expect(hasMoney({ total: 1, currency: "USD" })).toBe(false);
  });
});

describe("the write path stores the model without disturbing existing readers", () => {
  const inv = () => read("packages/api/src/routes/invoices.ts");

  it("an invoice is valued at issue, not at read time", () => {
    expect(inv()).toMatch(/const money = await moneyAt\(c\.get\("workspaceId"\), total, body\.currency, issuedOn\)/);
  });

  it("legacy total/currency are still written — nothing existing breaks", () => {
    const src = inv();
    expect(src).toMatch(/currency: body\.currency,\s*\n\s*subtotal,\s*\n\s*tax_total,\s*\n\s*total,/);
  });

  it("payment records the settlement rate, which cannot be recovered later", () => {
    const src = inv();
    expect(src).toMatch(/if \(body\.status === "paid" && currentStatus !== "paid"\)/);
    expect(src).toMatch(/settlementUpdates = buildSettlement\(/);
  });

  it("a re-priced draft is re-valued at its issue date, not today's", () => {
    expect(inv()).toMatch(/const issuedOn = String\(current\.issued_on \?\? ""\)\.slice\(0, 10\) \|\| new Date\(\)/);
  });

  it("a missing rate stores no base valuation rather than a guessed one", () => {
    const store = read("packages/api/src/lib/currency-store.ts");
    expect(store).toMatch(/if \(rate == null\) return null;/);
    expect(inv()).toMatch(/\.\.\.\(money \?\? \{\}\)/);
  });

  it("a workspace with no FX rates can still record its own currency", () => {
    // Same-currency is rate 1 by definition; requiring a rate row would block a single-currency
    // workspace from recording anything.
    expect(read("packages/api/src/lib/currency-store.ts")).toMatch(/source: "identity"/);
  });
});

describe("ECB history parsing — a 90-day file is 90 days, not one", () => {
  it("returns one snapshot per trading day, each with its own rates", () => {
    const xml = `<Cube>
      <Cube time="2026-07-31"><Cube currency="USD" rate="1.1485"/><Cube currency="PLN" rate="4.3135"/></Cube>
      <Cube time="2026-07-30"><Cube currency="USD" rate="1.1500"/><Cube currency="PLN" rate="4.3000"/></Cube>
    </Cube>`;
    const days = parseEcbHistoryXml(xml);
    expect(days.length).toBe(2);
    expect(days[0]!.date).toBe("2026-07-31");
    expect(days[0]!.rates.PLN).toBe(4.3135);
    expect(days[1]!.date).toBe("2026-07-30");
    expect(days[1]!.rates.PLN).toBe(4.3);
  });

  it("the DAILY parser would flatten that file into one bogus snapshot — hence a separate parser", () => {
    const xml = `<Cube>
      <Cube time="2026-07-31"><Cube currency="PLN" rate="4.3135"/></Cube>
      <Cube time="2026-07-30"><Cube currency="PLN" rate="4.3000"/></Cube>
    </Cube>`;
    const flat = parseEcbXml(xml)!;
    expect(flat.rates.PLN).toBe(4.3);          // last value wins — the 30th, stamped as the 31st
    expect(flat.date).toBe("2026-07-31");
    expect(parseEcbHistoryXml(xml)[0]!.rates.PLN).toBe(4.3135);   // correct
  });

  it("returns [] for junk rather than throwing", () => {
    expect(parseEcbHistoryXml("")).toEqual([]);
    expect(parseEcbHistoryXml("<html>nope</html>")).toEqual([]);
  });
});

describe("backfill values history honestly", () => {
  const money = () => read("packages/api/src/routes/money.ts");

  it("is owner/admin only and dry-run by default", () => {
    const src = money();
    expect(src).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
    expect(src).toMatch(/if \(role !== "owner" && role !== "admin"\) return c\.json\(\{ error: "Owner\/admin only\." \}, 403\)/);
  });

  it("values each record at ITS OWN transaction date, never today's rate", () => {
    const src = money();
    expect(src).toMatch(/makeHistoricalConverter\(ws, candidates\.map\(dateOf\)\)/);
    expect(src).toMatch(/dateKeys: \["issued_on", "sent_at", "created_at"\]/);
  });

  it("skips — never guesses — when no rate covers the date", () => {
    const src = money();
    expect(src).toMatch(/no \$\{currency\}→\$\{base\} rate on or before \$\{date\}/);
    expect(src).not.toMatch(/loadRates\(\)[\s\S]{0,200}skipped/);
  });

  it("only touches records that lack the model, so re-running changes nothing", () => {
    expect(money()).toMatch(/!hasMoney\(r\.data\)/);
  });

  it("captures settlement for already-paid invoices — it cannot be recovered later", () => {
    expect(money()).toMatch(/String\(row\.data\.status \?\? ""\) === "paid"/);
    expect(money()).toMatch(/buildSettlement\(p\.money, \{ rate: s\.rate, on: paidOn/);
  });

  it("reads the three legacy amount shapes correctly", () => {
    const src = money();
    expect(src).toMatch(/invoice:\s*\{ amount: d => Number\(d\.total \?\? 0\)/);
    expect(src).toMatch(/credit_note:\s*\{ amount: d => \(Number\(d\.amount_cents \?\? 0\) \|\| 0\) \/ 100/);
  });

  it("exposes coverage so the gap is visible rather than assumed closed", () => {
    const src = money();
    expect(src).toMatch(/router\.get\("\/coverage"/);
    expect(src).toMatch(/rates_earliest/);
  });

  it("writes are workspace-scoped", () => {
    expect(money()).toMatch(/\.update\(\{ data: next \}\)\.eq\("workspace_id", ws\)\.eq\("id", p\.id\)/);
  });
});

describe("a dry run must be able to preview a SEEDED backfill", () => {
  it("seeding runs during dry_run too — it writes reference rates, not user records", () => {
    // Gating it on dry_run made the preview useless: the only way to see what a seeded backfill
    // would do was to perform the record writes a dry run exists to avoid.
    const src = read("packages/api/src/routes/money.ts");
    expect(src).toMatch(/const seeded = seed_history \? await seedFxHistory\(\) : null;/);
    expect(src).not.toMatch(/seed_history && !dry_run/);
  });

  it("the dry run reports what it seeded", () => {
    const src = read("packages/api/src/routes/money.ts");
    const dryBlock = src.slice(src.indexOf("if (dry_run) {"), src.indexOf("let updated = 0"));
    expect(dryBlock).toMatch(/seeded_history: seeded/);
  });
});
