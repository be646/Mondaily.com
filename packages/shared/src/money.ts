/**
 * THE shape of money on a financial record.
 *
 * A money amount is not a number — it is a number, the currency it was actually charged in, and the
 * rate that related the two AT THE MOMENT IT HAPPENED. Storing only the number and converting on
 * read is why historical figures moved every morning: each render re-converted at that day's rate.
 *
 * Five fields, per the architecture:
 *   amount_presentment   — exactly what the client is charged / pays. NEVER recomputed.
 *   currency_presentment — the currency they see on the document. NEVER rewritten.
 *   fx_rate              — presentment → base, quoted at the transaction date.
 *   amount_base          — the converted value, frozen at that rate.
 *   currency_base        — the workspace reporting currency at the time.
 *
 * Plus provenance (`fx_rate_as_of`, `fx_rate_source`) so a figure can be reproduced and defended,
 * and a second rate at settlement so realised FX gain/loss is derivable rather than lost.
 *
 * CHANGING THE WORKSPACE CURRENCY MUST NEVER TOUCH amount_presentment. It re-derives amount_base,
 * and it must do so at each record's OWN transaction-date rate — re-deriving history at today's
 * rate throws away the entire reason these fields exist.
 */

export interface MoneyFields {
  amount_presentment: number;
  currency_presentment: string;
  fx_rate: number;
  amount_base: number;
  currency_base: string;
  fx_rate_as_of: string | null;
  fx_rate_source: string;
}

/** Recorded when the money actually settles — the rate then is rarely the rate at issue. */
export interface SettlementFields {
  settlement_fx_rate: number;
  settlement_amount_base: number;
  settlement_fx_rate_as_of: string | null;
  settled_on: string;
  /** settlement_amount_base − amount_base. Positive = the delay earned money. */
  fx_gain_loss: number;
}

/** Currencies with no minor unit, plus the three-decimal ones. Assuming 2dp everywhere is wrong. */
const ZERO_DECIMAL = new Set(["JPY", "HUF", "KRW", "CLP", "ISK", "VND", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** How many decimal places a currency actually has. */
export function currencyDecimals(currency: string): number {
  const c = (currency || "").toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/**
 * Round to a currency's real minor unit — JPY has none, KWD has three.
 *
 * `Math.round(amount * 100) / 100` LOSES A CENT at the boundary: 1.005 is 1.00499999999999989 as a
 * double, so multiplying gives 100.49999999999999 and it rounds DOWN to 1.00. Shifting the exponent
 * through the decimal string representation rounds on the number as written, which is what an
 * invoice means. (The real cure is integer minor units end to end; this keeps the boundary honest
 * until then.)
 */
export function roundToCurrency(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  const dp = currencyDecimals(currency);
  const shifted = Math.round(Number(`${amount}e${dp}`));
  const out = Number(`${shifted}e-${dp}`);
  return Number.isFinite(out) ? out : 0;
}

/**
 * Money as an integer count of the currency's smallest unit — 12.34 USD is 1234, 100 JPY is 100,
 * 1.234 KWD is 1234.
 *
 * Money arithmetic belongs in integers. A float cannot hold 0.1 exactly, so every add carries a
 * little error that compounds over a list: this codebase already stored `9814.1577 EUR` and summed
 * a month's revenue to `95800.9977`. Neither is a payable amount. Integers cannot drift, so a total
 * is exact no matter how many rows it crossed.
 */
export function toMinor(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  const dp = currencyDecimals(currency);
  // Via the decimal string, for the same reason roundToCurrency does: amount * 100 is already
  // wrong for 1.005 before Math.round ever sees it.
  return Math.round(Number(`${amount}e${dp}`));
}

/** Back to major units for display. */
export function fromMinor(minor: number, currency: string): number {
  if (!Number.isFinite(minor)) return 0;
  const out = Number(`${Math.round(minor)}e-${currencyDecimals(currency)}`);
  return Number.isFinite(out) ? out : 0;
}

/**
 * Build the money block for a record. `rate` is presentment → base and must be the rate quoted for
 * the transaction date, not today's.
 */
export function buildMoney(input: {
  amount: number;
  currency: string;
  base: string;
  rate: number;
  as_of?: string | null;
  source?: string;
}): MoneyFields {
  const currency_presentment = (input.currency || "").toUpperCase();
  const currency_base = (input.base || "").toUpperCase();
  const amount_presentment = roundToCurrency(input.amount, currency_presentment);
  return {
    amount_presentment,
    currency_presentment,
    fx_rate: input.rate,
    amount_base: roundToCurrency(amount_presentment * input.rate, currency_base),
    currency_base,
    fx_rate_as_of: input.as_of ?? null,
    fx_rate_source: input.source ?? "ecb",
  };
}

/**
 * Build the settlement block. The gain/loss is the whole point: invoice $1,000 when the rate is
 * 3.95 and get paid when it is 4.10, and the business really did earn 150 PLN it never invoiced.
 */
export function buildSettlement(money: MoneyFields, input: {
  rate: number;
  on: string;
  as_of?: string | null;
}): SettlementFields {
  const settlement_amount_base = roundToCurrency(money.amount_presentment * input.rate, money.currency_base);
  return {
    settlement_fx_rate: input.rate,
    settlement_amount_base,
    settlement_fx_rate_as_of: input.as_of ?? null,
    settled_on: input.on,
    fx_gain_loss: roundToCurrency(settlement_amount_base - money.amount_base, money.currency_base),
  };
}

/** True when a record already carries the model (so a backfill can skip it). */
export function hasMoney(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return typeof data.amount_presentment === "number"
    && typeof data.currency_presentment === "string"
    && typeof data.amount_base === "number";
}

/**
 * Read money off a record, falling back to the legacy shape.
 *
 * Records written before this model exist in three shapes: `total` + `currency` (invoices, quotes),
 * `amount_cents` + `currency` (expenses, credit notes), and the model itself. A reader that knows
 * only one of them silently reports zero for the others, so every surface must come through here.
 */
export function readMoney(data: Record<string, unknown> | null | undefined): {
  amount: number;
  currency: string;
  base_amount: number | null;
  base_currency: string | null;
  rate: number | null;
  /** false when the figure came from the legacy shape and has no stored rate. */
  modelled: boolean;
} {
  const d = data ?? {};
  if (hasMoney(d)) {
    return {
      amount: Number(d.amount_presentment),
      currency: String(d.currency_presentment),
      base_amount: typeof d.amount_base === "number" ? d.amount_base : null,
      base_currency: typeof d.currency_base === "string" ? d.currency_base : null,
      rate: typeof d.fx_rate === "number" ? d.fx_rate : null,
      modelled: true,
    };
  }
  const currency = String(d.currency ?? "");
  const amount = typeof d.total === "number" ? d.total
    : typeof d.amount_cents === "number" ? d.amount_cents / 100
    : 0;
  return { amount, currency, base_amount: null, base_currency: null, rate: null, modelled: false };
}

export interface FxExposure {
  /** What the open invoices were worth when issued, at the rates then. */
  at_issue: number;
  /** What the same invoices are worth at today's rate. */
  at_today: number;
  /** at_today − at_issue. Positive = the currency has moved in your favour SO FAR. */
  unrealised: number;
  currency: string;
  /** Open invoices actually exposed (foreign currency, with a stored valuation). */
  count: number;
  /** Open invoices skipped: no stored valuation or no current rate. */
  unmeasured: number;
}

/**
 * Unrealised FX on money you are owed but have not been paid.
 *
 * Realised gain/loss is settled history — it needs the rate on the day the cash arrived. An invoice
 * still OPEN has no such day yet, so its exposure is live: it was booked at the rate on the day it
 * was issued, and every day since, the currency has moved. A business invoicing in a currency it
 * does not report in is carrying that movement whether or not anyone measures it.
 *
 * This is explicitly NOT a gain. Nothing has been earned or lost until the invoice settles, and the
 * number moves daily — callers must present it as exposure, not income.
 *
 * Same-currency invoices carry no exposure by definition and are excluded from `count`.
 */
export function unrealisedFx(
  rows: Array<Record<string, unknown> | null | undefined>,
  opts: { base: string; rateNow: (from: string, to: string) => number | null },
): FxExposure {
  const base = (opts.base || "").toUpperCase();
  let issueMinor = 0, todayMinor = 0, count = 0, unmeasured = 0;

  for (const row of rows) {
    const m = readMoney(row);
    if (!m.amount) continue;
    const cur = (m.currency || "").toUpperCase();
    if (!cur || cur === base) continue;                       // no exposure in your own currency
    // Needs BOTH a frozen valuation to compare against and a rate to compare with. Missing either
    // means the exposure is unknown, which is reported — never estimated.
    if (!m.modelled || m.base_amount == null || (m.base_currency ?? "").toUpperCase() !== base) { unmeasured += 1; continue; }
    const rate = opts.rateNow(cur, base);
    if (rate == null) { unmeasured += 1; continue; }
    issueMinor += toMinor(m.base_amount, base);
    todayMinor += toMinor(m.amount * rate, base);
    count += 1;
  }

  return {
    at_issue: fromMinor(issueMinor, base),
    at_today: fromMinor(todayMinor, base),
    unrealised: fromMinor(todayMinor - issueMinor, base),
    currency: base,
    count,
    unmeasured,
  };
}

export interface BaseSum {
  /** Total in the base currency. */
  value: number;
  /** Rows whose value was FROZEN at their transaction date — the trustworthy part. */
  modelled: number;
  /** Rows with no stored valuation, converted at TODAY's rate to avoid dropping them. */
  live: number;
  /** Rows that could not be converted at all; excluded from `value` rather than added raw. */
  unconvertible: number;
}

/**
 * Sum a set of records in the base currency.
 *
 * The rule this enforces: never add 1,000 USD to 1,000 PLN. A modelled record contributes its
 * FROZEN `amount_base` — the value on its own transaction date — so the total does not drift as
 * rates move. Records that predate the model have no frozen value, so they are converted at today's
 * rate and COUNTED SEPARATELY: a total mixing frozen and live figures is not wrong, but the caller
 * must be able to say so.
 *
 * A row that cannot be converted is excluded, never added at face value — adding a raw foreign
 * amount to a base-currency total is the exact bug this replaces.
 */
export function sumInBase(
  rows: Array<Record<string, unknown> | null | undefined>,
  opts: { base: string; convertNow: (amount: number, from: string) => number | null },
): BaseSum {
  const base = (opts.base || "").toUpperCase();
  // Accumulate in MINOR UNITS. Adding floats across a list compounds the representation error —
  // this is where 95,800.9977 came from. Each row is rounded to a real payable amount once, then
  // the integers add exactly, and the result is converted back a single time at the end.
  let minor = 0;
  let modelled = 0, live = 0, unconvertible = 0;
  const add = (amount: number) => { minor += toMinor(amount, base); };
  for (const row of rows) {
    const m = readMoney(row);
    if (!m.amount) continue;
    if (m.modelled && m.base_amount != null) {
      const stored = (m.base_currency ?? "").toUpperCase();
      if (stored === base) { add(m.base_amount); modelled += 1; continue; }
      // Viewing in a currency other than the one the value was frozen in. Re-express the FROZEN
      // figure rather than re-deriving from the presentment amount: the historical valuation is
      // preserved and only the final display hop uses today's rate. Re-deriving would throw the
      // freeze away entirely — which is what this did at first, so a workspace based in USD viewed
      // in PLN reported "0 fixed" even though every record was modelled.
      const reexpressed = opts.convertNow(m.base_amount, stored);
      if (reexpressed != null) { add(reexpressed); modelled += 1; continue; }
    }
    if ((m.currency || "").toUpperCase() === base) { add(m.amount); live += 1; continue; }
    const converted = opts.convertNow(m.amount, m.currency);
    if (converted == null) { unconvertible += 1; continue; }
    add(converted); live += 1;
  }
  // One conversion back to major units, from an exact integer.
  return { value: fromMinor(minor, base), modelled, live, unconvertible };
}

export interface CurrencyShare {
  currency: string;
  /** Value in the BASE currency — shares must be comparable, so they cannot be raw amounts. */
  base_value: number;
  /** Percentage of the total, rounded to a whole number. */
  pct: number;
  count: number;
}

/**
 * What share of the money was actually charged in each currency.
 *
 * Shares are computed on BASE value, not on the raw presentment amounts: 1,000 JPY and 1,000 GBP
 * are not the same size, and ranking them by the number printed on the document would put the yen
 * first. Currencies are ordered largest first, and the percentages are adjusted so they total 100
 * — six 16.67% slices rendering as 100.02% reads as a bug.
 */
export function currencyBreakdown(
  rows: Array<Record<string, unknown> | null | undefined>,
  opts: { base: string; convertNow: (amount: number, from: string) => number | null },
): { shares: CurrencyShare[]; total: number; unconvertible: number } {
  const byCurrency = new Map<string, { base_value: number; count: number }>();
  let total = 0, unconvertible = 0;
  for (const row of rows) {
    const m = readMoney(row);
    if (!m.amount) continue;
    const cur = (m.currency || "").toUpperCase();
    if (!cur) continue;
    const one = sumInBase([row], opts);
    if (one.unconvertible) { unconvertible += 1; continue; }
    const e = byCurrency.get(cur) ?? { base_value: 0, count: 0 };
    e.base_value += one.value; e.count += 1;
    byCurrency.set(cur, e);
    total += one.value;
  }
  const shares = [...byCurrency.entries()]
    .map(([currency, v]) => ({ currency, base_value: roundToCurrency(v.base_value, opts.base), pct: 0, count: v.count }))
    .sort((a, b) => b.base_value - a.base_value);

  if (total > 0 && shares.length) {
    let assigned = 0;
    shares.forEach((s, i) => {
      // Largest-remainder: give the last (smallest) slice whatever is left, so the row totals 100.
      s.pct = i === shares.length - 1 ? Math.max(0, 100 - assigned) : Math.round((s.base_value / total) * 100);
      assigned += s.pct;
    });
  }
  return { shares, total: roundToCurrency(total, opts.base), unconvertible };
}
