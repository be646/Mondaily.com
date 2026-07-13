/**
 * Pure currency helpers — no React, no network, no imports — so they're unit-testable directly
 * and safe to import anywhere. The useCurrency hook re-exports all of these for back-compat, so
 * existing `from "hooks/useCurrency"` imports are unchanged. Conversion mirrors the server's
 * lib/currency.convert: EUR-crossed, case-insensitive, and returns null (never a guess) when a
 * required rate is missing or the amount is invalid.
 */
export interface CurrencyState {
  base: string;
  display: string;
  default_base: string;
  currencies: string[];
  rates: Record<string, number>; // per 1 EUR (EUR implicit 1)
  rates_as_of: string | null;
}

// The full supported set (mirrors server SUPPORTED_CURRENCIES) — used as a fallback so forms
// show every currency even before the /currency query resolves.
export const FALLBACK_CURRENCIES = [
  "EUR", "USD", "GBP", "PLN", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "CZK",
  "HUF", "RON", "BGN", "TRY", "ZAR", "INR", "BRL", "MXN", "SGD", "HKD", "NZD", "AED", "SAR",
];

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€", USD: "$", GBP: "£", PLN: "zł", CAD: "C$", AUD: "A$", CHF: "Fr", JPY: "¥",
  SEK: "kr", NOK: "kr", DKK: "kr", CZK: "Kč", HUF: "Ft", RON: "lei", BGN: "лв", TRY: "₺",
  ZAR: "R", INR: "₹", BRL: "R$", MXN: "Mex$", SGD: "S$", HKD: "HK$", NZD: "NZ$", AED: "د.إ", SAR: "﷼",
};

export function currencyOptions(list: string[]): { value: string; label: string }[] {
  return list.map(c => ({ value: c, label: CURRENCY_SYMBOL[c] ? `${c} — ${CURRENCY_SYMBOL[c]}` : c }));
}

/**
 * EUR-crossed conversion. Rates are "units per 1 EUR" (ECB convention). Returns null — never a
 * guess — when the amount is invalid or a required rate is missing (fail-closed, so callers show
 * "rate unavailable" rather than a wrong number). Case-insensitive on the currency codes to match
 * the server, so a lowercase `usd` never silently misses its rate.
 */
export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (!Number.isFinite(amount)) return null;
  const f = String(from ?? "").toUpperCase();
  const t = String(to ?? "").toUpperCase();
  if (f === t) return amount;
  const rFrom = f === "EUR" ? 1 : rates[f];
  const rTo = t === "EUR" ? 1 : rates[t];
  if (!rFrom || !rTo) return null;
  return (amount / rFrom) * rTo;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return amount.toLocaleString(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
