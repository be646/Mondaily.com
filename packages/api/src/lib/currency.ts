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

/**
 * The direct rate between two currencies: how many units of `to` one unit of `from` buys.
 * Exposed separately because a stored money record must keep the rate it was converted at — the
 * amount alone cannot be re-derived or audited later.
 */
export function rateBetween(from: CurrencyCode, to: CurrencyCode, rates: Record<string, number>): number | null {
  const f = (from || "").toUpperCase();
  const t = (to || "").toUpperCase();
  if (f === t) return 1;
  const r = withEur(rates);
  const rf = r[f], rt = r[t];
  if (!rf || !rt) return null;
  return rt / rf;
}

export interface Conversion {
  /** Converted amount, rounded to the target currency's minor units. */
  amount: number;
  /** Units of `to` per 1 unit of `from` — the rate to STORE on the record. */
  rate: number;
  from: CurrencyCode;
  to: CurrencyCode;
  /** The date the rates were quoted for, so the figure can be reproduced exactly. */
  as_of: string | null;
  /** Where the rate came from, so it can be defended in an audit. */
  source: string;
}

/**
 * Convert money and return the rate that did it, plus its provenance.
 *
 * `convert()` returns only a number, which is why nothing in the product could store an fx_rate:
 * the rate was computed, used and discarded on every read. That is also why historical figures
 * moved every morning — each render re-converted at that day's rate. This is the primitive the
 * five-field money model is built on.
 *
 * Returns null rather than a guess when either currency has no rate (fail-closed, as before).
 */
export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: Record<string, number>,
  meta?: { as_of?: string | null; source?: string },
): Conversion | null {
  if (!Number.isFinite(amount)) return null;
  const rate = rateBetween(from, to, rates);
  if (rate == null) return null;
  return {
    amount: roundMoney(amount * rate, to),
    rate,
    from: (from || "").toUpperCase(),
    to: (to || "").toUpperCase(),
    as_of: meta?.as_of ?? null,
    source: meta?.source ?? "ecb",
  };
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

/** ECB's 90-day history feed — the same reference series, one Cube per trading day. */
export const DEFAULT_FX_HISTORY_SOURCE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

/**
 * Parse the ECB multi-day history XML into one FxRates per trading day.
 *
 * The daily parser can't be reused: it regex-scans the WHOLE document for currency/rate pairs, so
 * on a history file it would flatten ninety days into a single bogus snapshot (last value wins).
 * Each `<Cube time="…">` block is its own day; inner cubes are self-closing, so a block ends at the
 * first closing tag.
 */
export function parseEcbHistoryXml(xml: string): FxRates[] {
  if (!xml || typeof xml !== "string") return [];
  const days: FxRates[] = [];
  const dayRe = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g;
  let d: RegExpExecArray | null;
  while ((d = dayRe.exec(xml)) !== null) {
    const date = d[1]!;
    const body = d[2]!;
    const rates: Record<string, number> = {};
    const re = /currency=["']([A-Za-z]{3})["']\s+rate=["']([\d.]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const rate = Number(m[2]);
      if (Number.isFinite(rate) && rate > 0) rates[m[1]!.toUpperCase()] = rate;
    }
    if (Object.keys(rates).length > 0) days.push({ base: "EUR", date, rates });
  }
  return days;
}

/**
 * Fetch the rate history. Used to seed `fx_rates` so records written before the table kept history
 * can still be valued at the rate that actually applied on their transaction date — otherwise the
 * only options are "no value" or today's rate, and the second one is a lie.
 */
export async function fetchFxHistory(): Promise<FxRates[]> {
  const url = process.env.FX_HISTORY_URL || DEFAULT_FX_HISTORY_SOURCE;
  try {
    const res = await fetch(url, { headers: { Accept: "application/xml,text/xml" } });
    if (!res.ok) return [];
    return parseEcbHistoryXml(await res.text());
  } catch {
    return [];
  }
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
