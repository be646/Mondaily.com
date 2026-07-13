import { describe, it, expect } from "vitest";
// The FRONTEND conversion helper (apps/app) — the one the sales report, board view, pipeline,
// and every finance page actually call. It's a pure, dependency-free module, so we exercise its
// real behavior here (the backend lib/currency.convert has its own suite in currency.test.ts).
import { convertAmount, formatMoney, currencyOptions, CURRENCY_SYMBOL } from "../../../../apps/app/src/lib/currency-format";

// ECB "units per 1 EUR": 1 EUR = 1.10 USD = 0.85 GBP = 4.30 PLN.
const RATES: Record<string, number> = { USD: 1.1, GBP: 0.85, PLN: 4.3 };

describe("convertAmount (frontend) — EUR-crossed, honest nulls", () => {
  it("same currency is a no-op (and needs no rate)", () => {
    expect(convertAmount(100, "USD", "USD", {})).toBe(100);
    expect(convertAmount(100, "EUR", "EUR", {})).toBe(100);
  });
  it("converts to/from EUR using the per-EUR rate", () => {
    expect(convertAmount(110, "USD", "EUR", RATES)).toBeCloseTo(100, 6);
    expect(convertAmount(100, "EUR", "USD", RATES)).toBeCloseTo(110, 6);
  });
  it("cross-converts between two non-EUR currencies via EUR", () => {
    expect(convertAmount(110, "USD", "GBP", RATES)).toBeCloseTo(85, 6);   // 110 USD → 100 EUR → 85 GBP
    expect(convertAmount(430, "PLN", "USD", RATES)).toBeCloseTo(110, 6);  // 430 PLN → 100 EUR → 110 USD
  });
  it("is case-insensitive (a lowercase code never silently misses its rate)", () => {
    expect(convertAmount(110, "usd", "eur", RATES)).toBeCloseTo(100, 6);
    expect(convertAmount(110, "Usd", "gbp", RATES)).toBeCloseTo(85, 6);
  });
  it("returns NULL — never a guess — when a rate is missing or the amount is invalid", () => {
    expect(convertAmount(100, "USD", "XYZ", RATES)).toBeNull();
    expect(convertAmount(100, "XYZ", "USD", RATES)).toBeNull();
    expect(convertAmount(100, "USD", "EUR", {})).toBeNull();      // empty rates → fail-closed
    expect(convertAmount(NaN, "USD", "EUR", RATES)).toBeNull();   // invalid amount → null, not NaN
    expect(convertAmount(Infinity, "USD", "EUR", RATES)).toBeNull();
  });
  it("a zero rate is treated as missing (never divides by zero into Infinity)", () => {
    expect(convertAmount(100, "USD", "EUR", { USD: 0 })).toBeNull();
  });
});

describe("formatMoney / currencyOptions / CURRENCY_SYMBOL", () => {
  it("formatMoney renders the currency and 2dp", () => {
    expect(formatMoney(1234.5, "USD")).toMatch(/1,234\.50/);
    expect(formatMoney(1000, "EUR")).toMatch(/1,000\.00/);
  });
  it("formatMoney always shows the amount + currency code, and never throws", () => {
    // Intl renders any well-formed 3-letter code (uppercasing it); the try/catch guards the rest,
    // so the guarantee we care about is: the amount and code always appear, and it never throws.
    for (const code of ["ZZZ", "bad", "X", "US1"]) {
      const out = formatMoney(10, code);
      expect(out).toMatch(/10\.00/);
      expect(out.toUpperCase()).toContain(code.toUpperCase());
    }
  });
  it("currencyOptions labels a known symbol and passes unknowns through", () => {
    expect(currencyOptions(["USD"])[0]).toEqual({ value: "USD", label: "USD — $" });
    expect(currencyOptions(["ZZZ"])[0]).toEqual({ value: "ZZZ", label: "ZZZ" });
  });
  it("CURRENCY_SYMBOL covers the common set", () => {
    expect(CURRENCY_SYMBOL.EUR).toBe("€");
    expect(CURRENCY_SYMBOL.GBP).toBe("£");
    expect(CURRENCY_SYMBOL.PLN).toBe("zł");
  });
});
