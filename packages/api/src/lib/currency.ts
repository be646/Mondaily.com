/**
 * Currency + FX — the single source for multi-currency normalization.
 *
 * The workspace has ONE base (reporting) currency; every total across mixed-currency records is
 * converted to it (or to a per-user display currency) before summing. FX rates are stored locally
 * in `fx_rates` and refreshed by a daily cron from a configurable public source (ECB reference
 * rates by default) — so at request time we only ever read our OWN data, never call a paid FX API.
 * FAIL-CLOSED: no rates ⇒ convert() returns null and the UI shows "rate unavailable" (never a
 * fabricated number). Every converted figure is labeled with the rate date.
 *
 * ECB reference rates are quoted as "units of <currency> per 1 EUR", so all conversion crosses
 * through EUR. EUR itself has an implicit rate of 1.
 */

export const SUPPORTED_CURRENCIES = [
  "EUR", "USD", "GBP", "PLN", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "CZK",
  "HUF", "RON", "BGN", "TRY", "ZAR", "INR", "BRL", "MXN", "SGD", "HKD", "NZD", "AED", "SAR",
] as const;
export type CurrencyCode = string;

export const DEFAULT_BASE_CURRENCY = "USD";
/** ECB's free daily reference feed. Overridable so an operator can point at their own rates source. */
export const DEFAULT_FX_SOURCE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface FxRates {
  base: "EUR";
  date: string;                       // YYYY-MM-DD the rates are "as of"
  rates: Record<string, number>;      // units of <currency> per 1 EUR (EUR omitted / implicitly 1)
}

/** Rates keyed as "per 1 EUR", with EUR forced to 1 for uniform lookups. */
function withEur(rates: Record<string, number>): Record<string, number> {
  return { EUR: 1, ...rates };
}

/**
 * Convert `amount` from one currency to another using EUR-crossed rates. Returns null (never a
 * guess) when either currency has no rate. Same-currency is a no-op.
 */
export function convert(amount: number, from: CurrencyCode, to: CurrencyCode, rates: Record<string, number>): number | null {
  if (!Number.isFinite(amount)) return null;
  const f = (from || "").toUpperCase();
  const t = (to || "").toUpperCase();
  if (f === t) return amount;
  const r = withEur(rates);
  const rf = r[f];
  const rt = r[t];
  if (!rf || !rt) return null;         // missing rate → honest null
  const inEur = amount / rf;           // ECB: amount(f) / (f per EUR) = EUR
  return inEur * rt;                   // EUR * (t per EUR) = amount(t)
}

/** Round to a currency's typical minor units (2 dp; 0 for JPY/HUF-style zero-decimal currencies). */
export function roundMoney(amount: number, currency: CurrencyCode): number {
  const zeroDecimal = new Set(["JPY", "HUF", "KRW", "CLP", "ISK", "VND"]);
  const dp = zeroDecimal.has((currency || "").toUpperCase()) ? 0 : 2;
  const m = Math.pow(10, dp);
  return Math.round(amount * m) / m;
}

/**
 * Parse the ECB daily reference XML into FxRates. Pure + regex-based (no XML dep). Returns null if
 * the payload has no recognizable rate cubes.
 */
export function parseEcbXml(xml: string): FxRates | null {
  if (!xml || typeof xml !== "string") return null;
  const dateMatch = xml.match(/time=["'](\d{4}-\d{2}-\d{2})["']/);
  const rates: Record<string, number> = {};
  const re = /currency=["']([A-Za-z]{3})["']\s+rate=["']([\d.]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const cur = m[1]!.toUpperCase();
    const rate = Number(m[2]);
    if (Number.isFinite(rate) && rate > 0) rates[cur] = rate;
  }
  if (Object.keys(rates).length === 0) return null;
  return { base: "EUR", date: dateMatch?.[1] ?? new Date().toISOString().slice(0, 10), rates };
}

/**
 * Fetch fresh reference rates from the configured source (default ECB). Returns null on any failure
 * — the caller keeps the last stored rates rather than wiping them. No third-party call at request
 * time; this runs only from the daily cron.
 */
export async function fetchFxRates(): Promise<FxRates | null> {
  const url = process.env.FX_RATES_URL || DEFAULT_FX_SOURCE;
  try {
    const res = await fetch(url, { headers: { Accept: "application/xml,text/xml" } });
    if (!res.ok) return null;
    return parseEcbXml(await res.text());
  } catch {
    return null;
  }
}
