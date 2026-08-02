import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertCurrency, rateBetween, convert, roundMoney } from "../lib/currency";

/**
 * FX step 1. fx_rates was keyed on `currency` alone and the daily cron upserted onConflict
 * "currency", so every morning overwrote the previous day: no historical rate could ever be read.
 * Money was therefore converted at READ time with TODAY's rate, and historical reports silently
 * changed every morning.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ECB convention: units per 1 EUR.
const RATES = { USD: 1.08, PLN: 4.27, GBP: 0.85 };

describe("rateBetween — the number a record must store", () => {
  it("crosses through EUR", () => {
    // 1 USD = (4.27 PLN/EUR) / (1.08 USD/EUR) PLN
    expect(rateBetween("USD", "PLN", RATES)).toBeCloseTo(4.27 / 1.08, 10);
  });

  it("is exactly 1 for the same currency, without consulting any rate", () => {
    expect(rateBetween("PLN", "PLN", {})).toBe(1);
  });

  it("inverts cleanly", () => {
    const a = rateBetween("USD", "PLN", RATES)!;
    const b = rateBetween("PLN", "USD", RATES)!;
    expect(a * b).toBeCloseTo(1, 10);
  });

  it("returns null rather than guessing when a currency has no rate", () => {
    expect(rateBetween("USD", "XYZ", RATES)).toBeNull();
    expect(rateBetween("XYZ", "PLN", RATES)).toBeNull();
  });

  it("treats EUR as the implicit unit", () => {
    expect(rateBetween("EUR", "PLN", RATES)).toBeCloseTo(4.27, 10);
  });
});

describe("convertCurrency — amount AND the rate that produced it", () => {
  it("returns the same amount as convert(), plus provenance", () => {
    const c = convertCurrency(1000, "USD", "PLN", RATES, { as_of: "2026-06-12", source: "ecb" })!;
    expect(c.amount).toBe(roundMoney(convert(1000, "USD", "PLN", RATES)!, "PLN"));
    expect(c.rate).toBeCloseTo(4.27 / 1.08, 10);
    expect(c.as_of).toBe("2026-06-12");
    expect(c.source).toBe("ecb");
    expect(c.from).toBe("USD");
    expect(c.to).toBe("PLN");
  });

  it("the stored rate reproduces the stored amount — the point of keeping it", () => {
    const c = convertCurrency(1000, "USD", "PLN", RATES)!;
    expect(roundMoney(1000 * c.rate, "PLN")).toBe(c.amount);
  });

  it("rounds to the target currency's minor units, not the source's", () => {
    expect(convertCurrency(100, "EUR", "JPY", { JPY: 168.42 })!.amount % 1).toBe(0);   // zero-decimal
    expect(convertCurrency(100, "EUR", "PLN", RATES)!.amount).toBe(427);
  });

  it("normalises currency case", () => {
    expect(convertCurrency(10, "usd", "pln", RATES)!.to).toBe("PLN");
  });

  it("fails closed on a missing rate and on junk amounts", () => {
    expect(convertCurrency(100, "USD", "XYZ", RATES)).toBeNull();
    expect(convertCurrency(NaN, "USD", "PLN", RATES)).toBeNull();
    expect(convertCurrency(Infinity, "USD", "PLN", RATES)).toBeNull();
  });

  it("a same-currency conversion is lossless and rate 1", () => {
    const c = convertCurrency(1234.56, "PLN", "PLN", {})!;
    expect(c.amount).toBe(1234.56);
    expect(c.rate).toBe(1);
  });
});

describe("the migration keeps history instead of overwriting it", () => {
  const sql = () => read("packages/db/migrations/20260802_fx_rates_history.sql");

  it("re-keys on (currency, as_of) — a rate is a fact about a DAY", () => {
    expect(sql()).toMatch(/primary key \(currency, as_of\)/);
  });

  it("is idempotent — a second run detects the two-column key and stops", () => {
    expect(sql()).toMatch(/already keyed on \(currency, as_of\)/);
  });

  it("deletes no rate data: existing rows become the first day of history", () => {
    const s = sql();
    expect(s).not.toMatch(/drop table|truncate/i);
    // the only delete is the defensive duplicate-pair collapse required to add the key
    const deletes = s.match(/delete from/gi) ?? [];
    expect(deletes.length).toBe(1);
    expect(s).toMatch(/a\.ctid < b\.ctid/);
  });

  it("indexes the two real queries: latest, and effective-on-a-date", () => {
    expect(sql()).toMatch(/create index if not exists fx_rates_currency_as_of_idx on fx_rates \(currency, as_of desc\)/);
  });

  it("carries a rate forward over weekends but never invents one", () => {
    const s = sql();
    expect(s).toMatch(/as_of <= p_as_of/);
    expect(s).toMatch(/order by as_of desc/);
    expect(s).toMatch(/NULL when the date predates stored history/);
  });

  it("records provenance so a figure can be defended later", () => {
    expect(sql()).toMatch(/add column if not exists source text not null default 'ecb'/);
  });

  it("is service-role only, like every other money function", () => {
    expect(sql()).toMatch(/revoke execute on function fx_rate_on\(text, date\) from public/);
    expect(sql()).toMatch(/grant execute on function fx_rate_on\(text, date\) to service_role/);
  });
});

describe("the store reads and writes history correctly", () => {
  const store = () => read("packages/api/src/lib/currency-store.ts");

  it("the daily cron no longer destroys yesterday", () => {
    expect(store()).toMatch(/onConflict: "currency,as_of"/);
  });

  it("an un-migrated environment keeps refreshing rather than storing nothing", () => {
    const s = store();
    expect(s).toMatch(/onConflict: "currency" \}\)/);
    expect(s).toMatch(/apply 20260802_fx_rates_history\.sql/);
  });

  it("current rates take the NEWEST quote per currency, not an arbitrary row", () => {
    const s = store();
    expect(s).toMatch(/function newestPerCurrency/);
    expect(s).toMatch(/\.order\("as_of", \{ ascending: false \}\)/);
  });

  it("historical conversion values money on its own transaction date", () => {
    const s = store();
    expect(s).toMatch(/export async function makeHistoricalConverter/);
    expect(s).toMatch(/function effectiveOn/);
    expect(s).toMatch(/if \(r\.as_of > day\) continue;/);
  });

  it("looks back far enough to find the quote a weekend date actually uses", () => {
    expect(store()).toMatch(/LOOKBACK_DAYS = 14/);
  });
});
