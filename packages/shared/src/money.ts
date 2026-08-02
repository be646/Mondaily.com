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
