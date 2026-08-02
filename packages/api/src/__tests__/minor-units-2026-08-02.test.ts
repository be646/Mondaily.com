import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toMinor, fromMinor, sumInBase, buildMoney } from "@mondaily/shared/money";

/**
 * Money arithmetic in integers.
 *
 * A float cannot hold 0.1 exactly, so every add carries error that compounds over a list. Measured
 * in this workspace: an invoice stored `9814.1577 EUR` (with `tax_total` 1835.1677), and a month of
 * revenue summed to `95800.9977`. None of those is a payable amount.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("minor-unit conversion", () => {
  it("counts the currency's real smallest unit", () => {
    expect(toMinor(12.34, "USD")).toBe(1234);
    expect(toMinor(100, "JPY")).toBe(100);      // no minor unit
    expect(toMinor(1.234, "KWD")).toBe(1234);   // three
  });

  it("does not lose the half-cent that float multiplication eats", () => {
    expect(toMinor(1.005, "USD")).toBe(101);    // 1.005 * 100 is 100.49999999999999
    expect(toMinor(8.165, "USD")).toBe(817);
  });

  it("round-trips", () => {
    for (const [v, c] of [[12.34, "USD"], [100, "JPY"], [1.234, "KWD"], [0, "USD"], [-5.5, "EUR"]] as const) {
      expect(fromMinor(toMinor(v, c), c), `${v} ${c}`).toBe(v);
    }
  });

  it("survives junk", () => {
    expect(toMinor(NaN, "USD")).toBe(0);
    expect(fromMinor(Infinity, "USD")).toBe(0);
  });
});

describe("totals no longer drift across a list", () => {
  const convertNow = () => null;

  it("the measured case: a month of revenue sums exactly", () => {
    // Floats gave 95800.99769999999 for this set.
    const rows = [
      buildMoney({ amount: 6700, currency: "USD", base: "USD", rate: 1 }),
      buildMoney({ amount: 89100.9977, currency: "USD", base: "USD", rate: 1 }),
    ];
    const s = sumInBase(rows, { base: "USD", convertNow });
    expect(s.value).toBe(95801);                       // exact, and a payable amount
    expect(String(s.value)).not.toMatch(/\.\d{3,}$/);   // no float tail past the minor unit
  });

  it("a hundred repeating thirds add without accumulating error", () => {
    const rows = Array.from({ length: 100 }, () => buildMoney({ amount: 0.1, currency: "USD", base: "USD", rate: 1 }));
    expect(sumInBase(rows, { base: "USD", convertNow }).value).toBe(10);   // floats give 9.99999999999998
  });

  it("respects zero-decimal currencies when summing", () => {
    const rows = [buildMoney({ amount: 150, currency: "JPY", base: "JPY", rate: 1 }),
                  buildMoney({ amount: 250, currency: "JPY", base: "JPY", rate: 1 })];
    expect(sumInBase(rows, { base: "JPY", convertNow }).value).toBe(400);
  });
});

describe("no new float artifact can be stored", () => {
  it("both document writers compute in minor units", () => {
    for (const f of ["invoices", "quotes"]) {
      const src = read(`packages/api/src/routes/${f}.ts`);
      expect(src, f).toMatch(/const line = toMinor\(i\.quantity \* i\.unit_price, currency\)/);
      expect(src, f).toMatch(/total: fromMinor\(subtotalMinor \+ taxMinor, currency\)/);
      // the old float-then-round approach is gone
      expect(src, f).not.toMatch(/const round2 = \(n: number\) => Math\.round\(n \* 100\) \/ 100/);
    }
  });

  it("totals are computed in the document's OWN currency, not assumed 2dp", () => {
    expect(read("packages/api/src/routes/invoices.ts")).toMatch(/calcTotals\(body\.line_items, body\.currency\)/);
  });

  it("the sum accumulates integers and converts back exactly once", () => {
    const m = read("packages/shared/src/money.ts");
    expect(m).toMatch(/const add = \(amount: number\) => \{ minor \+= toMinor\(amount, base\); \}/);
    expect(m).toMatch(/return \{ value: fromMinor\(minor, base\), modelled, live, unconvertible \}/);
  });
});
