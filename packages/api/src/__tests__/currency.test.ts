import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convert, roundMoney, parseEcbXml, SUPPORTED_CURRENCIES } from "../lib/currency";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// ECB quotes "units per 1 EUR": 1 EUR = 1.10 USD = 0.85 GBP = 4.30 PLN.
const RATES = { USD: 1.10, GBP: 0.85, PLN: 4.30, JPY: 160 };

describe("convert — EUR-crossed, honest nulls", () => {
  it("same currency is a no-op", () => {
    expect(convert(100, "USD", "USD", RATES)).toBe(100);
    expect(convert(100, "EUR", "EUR", RATES)).toBe(100);
  });
  it("converts to/from EUR using the per-EUR rate", () => {
    expect(convert(110, "USD", "EUR", RATES)).toBeCloseTo(100, 6);   // 110 USD / 1.10 = 100 EUR
    expect(convert(100, "EUR", "USD", RATES)).toBeCloseTo(110, 6);   // 100 EUR * 1.10 = 110 USD
  });
  it("cross-converts between two non-EUR currencies via EUR", () => {
    // 110 USD → 100 EUR → 85 GBP
    expect(convert(110, "USD", "GBP", RATES)).toBeCloseTo(85, 6);
    // 430 PLN → 100 EUR → 110 USD
    expect(convert(430, "PLN", "USD", RATES)).toBeCloseTo(110, 6);
  });
  it("is case-insensitive on currency codes", () => {
    expect(convert(110, "usd", "eur", RATES)).toBeCloseTo(100, 6);
  });
  it("returns NULL (never a guess) when a rate is missing or amount invalid", () => {
    expect(convert(100, "USD", "XYZ", RATES)).toBeNull();
    expect(convert(100, "XYZ", "USD", RATES)).toBeNull();
    expect(convert(NaN, "USD", "EUR", RATES)).toBeNull();
    expect(convert(100, "USD", "EUR", {})).toBeNull();               // empty rates → fail-closed
  });
});

describe("roundMoney — currency minor units", () => {
  it("2dp for normal currencies, 0dp for zero-decimal ones", () => {
    expect(roundMoney(100.005, "USD")).toBe(100.01);
    expect(roundMoney(1234.5, "JPY")).toBe(1235);
    expect(roundMoney(1234.5, "HUF")).toBe(1235);
  });
});

describe("parseEcbXml — regex, no XML dep", () => {
  const xml = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time="2026-07-09">
    <Cube currency="USD" rate="1.1042"/><Cube currency="GBP" rate="0.8531"/><Cube currency="PLN" rate="4.2960"/>
  </Cube></Cube></gesmes:Envelope>`;
  it("extracts the date and per-EUR rates", () => {
    const fx = parseEcbXml(xml)!;
    expect(fx.base).toBe("EUR");
    expect(fx.date).toBe("2026-07-09");
    expect(fx.rates.USD).toBeCloseTo(1.1042);
    expect(fx.rates.PLN).toBeCloseTo(4.296);
  });
  it("returns null for junk / empty payloads", () => {
    expect(parseEcbXml("")).toBeNull();
    expect(parseEcbXml("<Cube></Cube>")).toBeNull();
  });
  it("a parsed ECB rate round-trips through convert", () => {
    const fx = parseEcbXml(xml)!;
    // 100 USD → GBP using ECB rates: 100/1.1042 * 0.8531
    expect(convert(100, "USD", "GBP", fx.rates)).toBeCloseTo(100 / 1.1042 * 0.8531, 6);
  });
});

describe("currency model wiring", () => {
  const store = read("../lib/currency-store.ts");
  const route = read("../routes/currency.ts");
  const runners = read("../jobs/runners.ts");
  const app = read("../app.ts");
  it("base is workspace-level, display is a per-user override falling back to base", () => {
    expect(store).toMatch(/base_currency/);
    expect(store).toMatch(/user_preferences.*display_currency|display_currency/s);
  });
  it("rates load fail-closed (empty table → {}) and only the cron writes them", () => {
    expect(store).toMatch(/from\("fx_rates"\)\.select/);
    expect(store).toMatch(/\.upsert\(rows, \{ onConflict: "currency" \}\)/);
    expect(runners).toMatch(/results\.fx_rates = await refreshFxRates\(\)/);
  });
  it("route is mounted and setting the base is admin-gated", () => {
    expect(app).toMatch(/app\.route\("\/api\/v1\/currency", currencyRouter\)/);
    expect(route).toMatch(/router\.post\("\/base", requireAdminRole/);
    expect(route).toMatch(/rates_as_of/);   // GET exposes the as-of date for honest labeling
  });
  it("supports the currencies the user mentioned (EUR/USD/PLN) + more", () => {
    for (const c of ["EUR", "USD", "PLN", "GBP"]) expect(SUPPORTED_CURRENCIES).toContain(c);
  });
});
