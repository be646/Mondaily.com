import { supabase } from "@mondaily/db/client";
import { fetchFxRates, fetchFxHistory, convert, convertCurrency, rateBetween, DEFAULT_BASE_CURRENCY, type FxRates, type Conversion } from "./currency";
import { buildMoney, type MoneyFields } from "@mondaily/shared/money";

/** Collapse rate rows to the newest quote per currency. */
function newestPerCurrency(rows: { currency: unknown; rate: unknown; as_of: unknown }[]): { rates: Record<string, number>; as_of: string | null } {
  const best = new Map<string, { rate: number; as_of: string }>();
  let as_of: string | null = null;
  for (const r of rows) {
    const cur = String(r.currency).toUpperCase();
    const rate = Number(r.rate);
    const day = String(r.as_of);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const prev = best.get(cur);
    if (!prev || day > prev.as_of) best.set(cur, { rate, as_of: day });
    if (!as_of || day > as_of) as_of = day;
  }
  const rates: Record<string, number> = {};
  for (const [cur, v] of best) rates[cur] = v.rate;
  return { rates, as_of };
}

/**
 * The CURRENT reference rates (per 1 EUR) + the date they're as-of. Empty ⇒ {} (fail-closed).
 *
 * The table now holds history — many rows per currency — so this must take the NEWEST quote per
 * currency rather than whichever row the database returned last. Ordered + capped so a long
 * history can't be truncated into a wrong "latest".
 */
export async function loadRates(): Promise<{ rates: Record<string, number>; as_of: string | null }> {
  const { data } = await supabase
    .from("fx_rates").select("currency, rate, as_of")
    .order("as_of", { ascending: false })
    .limit(2000);
  return newestPerCurrency(data ?? []);
}

/**
 * Rates effective ON a given date: the most recent quote on or before it, per currency.
 *
 * Rates are not published at weekends or holidays, so Sunday's rate is Friday's — carrying forward
 * is correct; inventing one is not. A currency with no quote at or before the date is simply
 * absent, so conversion fails closed instead of silently borrowing today's rate.
 */
export async function loadRatesAsOf(date: string): Promise<{ rates: Record<string, number>; as_of: string | null }> {
  const day = String(date).slice(0, 10);
  const { data } = await supabase
    .from("fx_rates").select("currency, rate, as_of")
    .lte("as_of", day)
    .order("as_of", { ascending: false })
    .limit(5000);
  return newestPerCurrency(data ?? []);
}

/**
 * Upsert a rates snapshot. Called by the daily cron only.
 *
 * Conflict target is (currency, as_of) so each day is its own row and history accumulates; the
 * previous key was `currency` alone, which meant every refresh DESTROYED the prior day. Falls back
 * to the old target when 20260802_fx_rates_history.sql has not been applied yet, so an
 * un-migrated environment keeps refreshing instead of silently storing nothing.
 */
export async function storeRates(fx: FxRates): Promise<number> {
  const rows = Object.entries(fx.rates).map(([currency, rate]) => ({ currency, rate, as_of: fx.date, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("fx_rates").upsert(rows, { onConflict: "currency,as_of" });
  if (!error) return rows.length;
  const { error: legacyErr } = await supabase.from("fx_rates").upsert(rows, { onConflict: "currency" });
  if (legacyErr) return 0;
  console.warn("[fx] stored without history — apply 20260802_fx_rates_history.sql to keep historical rates.");
  return rows.length;
}

/**
 * Seed `fx_rates` with the ECB history feed (90 trading days).
 *
 * Needed because the table only started keeping history on 2026-08-02: every record written before
 * that has a transaction date with no rate behind it, so it can only be valued at today's rate —
 * which is exactly the lie this whole model removes. Idempotent: days already stored are upserted
 * to the same values.
 */
export async function seedFxHistory(): Promise<{ days: number; rows: number; earliest: string | null; latest: string | null }> {
  const history = await fetchFxHistory();
  if (history.length === 0) return { days: 0, rows: 0, earliest: null, latest: null };
  const rows = history.flatMap(day =>
    Object.entries(day.rates).map(([currency, rate]) => ({
      currency, rate, as_of: day.date, source: "ecb", updated_at: new Date().toISOString(),
    })),
  );
  // Chunked: ~30 currencies × 90 days is ~2,700 rows, past a comfortable single-statement size.
  let stored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("fx_rates").upsert(rows.slice(i, i + 500), { onConflict: "currency,as_of" });
    if (!error) stored += rows.slice(i, i + 500).length;
  }
  const dates = history.map(h => h.date).sort();
  return { days: history.length, rows: stored, earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null };
}

/** Refresh rates from the configured source (daily cron entry). Returns how many currencies stored. */
export async function refreshFxRates(): Promise<{ stored: number; as_of: string | null }> {
  const fx = await fetchFxRates();
  if (!fx) return { stored: 0, as_of: null };
  return { stored: await storeRates(fx), as_of: fx.date };
}

/** The workspace's base (reporting) currency — one per workspace, from settings. */
export async function workspaceBaseCurrency(workspaceId: string): Promise<string> {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const base = (data?.settings as { base_currency?: string } | null)?.base_currency;
  return (base && String(base).toUpperCase()) || DEFAULT_BASE_CURRENCY;
}

/** A user's display currency preference (view-only override of the base); falls back to the base. */
export async function userDisplayCurrency(workspaceId: string, userId: string): Promise<string> {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const prefs = (settings.user_preferences as Record<string, { display_currency?: string }> | undefined)?.[userId];
  const disp = prefs?.display_currency;
  if (disp && String(disp).toUpperCase()) return String(disp).toUpperCase();
  return ((settings as { base_currency?: string }).base_currency && String((settings as { base_currency?: string }).base_currency).toUpperCase()) || DEFAULT_BASE_CURRENCY;
}

/**
 * Build a per-workspace money converter for server-side aggregations (reports, digests).
 * Returns { base, toBase } where toBase(amount, from) converts into the workspace base currency
 * via the stored ECB rates — FAIL-CLOSED: an unknown/missing rate returns the face value untouched
 * (never a guessed rate), matching the frontend sumInDisplay behaviour.
 */
export async function makeBaseConverter(workspaceId: string): Promise<{ base: string; toBase: (amount: number, from?: string | null) => number }> {
  const [base, { rates }] = await Promise.all([workspaceBaseCurrency(workspaceId), loadRates()]);
  const toBase = (amount: number, from?: string | null): number => {
    const cur = (from ?? "").toUpperCase();
    if (!cur || cur === base) return amount;
    const converted = convert(amount, cur, base, rates);
    return converted ?? amount; // fail-closed: face value when a rate is missing
  };
  return { base, toBase };
}

/**
 * Value money AT THE DATE IT MOVED, not at today's rate.
 *
 * Converting historical amounts with the current rate is why reports move overnight: a June invoice
 * is worth a different number of PLN every morning. This resolves each amount against the rates
 * effective on its own transaction date, so a figure computed today and the same figure computed
 * next year agree — and it returns the rate used, which is what the record must store.
 *
 * Rates for every date needed are loaded once (bounded), not per row.
 */
export async function makeHistoricalConverter(
  workspaceId: string,
  dates: string[],
): Promise<{
  base: string;
  at: (amount: number, from: string | null | undefined, date: string) => Conversion | null;
}> {
  const days = [...new Set(dates.map(d => String(d).slice(0, 10)).filter(Boolean))].sort();
  const earliest = days[0];
  const [base, history] = await Promise.all([
    workspaceBaseCurrency(workspaceId),
    // One read covering the whole span; each date then picks its own effective quote.
    earliest ? loadAllRatesFrom(earliest) : Promise.resolve([]),
  ]);

  const at = (amount: number, from: string | null | undefined, date: string): Conversion | null => {
    const cur = (from ?? "").toUpperCase();
    if (!cur) return null;
    const { rates, as_of } = effectiveOn(history, String(date).slice(0, 10));
    return convertCurrency(amount, cur, base, rates, { as_of, source: "ecb" });
  };
  return { base, at };
}

/**
 * Build the stored money block for ONE amount, valued at its own transaction date.
 *
 * This is what every financial write should call: it resolves the rate quoted for that date (not
 * today's), and returns the five fields plus provenance. Returns null when no rate exists for the
 * pair — fail-closed, so a record is never stamped with a rate that was guessed. Callers store the
 * presentment amount regardless; only the base valuation is withheld.
 */
export async function moneyAt(
  workspaceId: string,
  amount: number,
  currency: string,
  date: string,
): Promise<MoneyFields | null> {
  const base = await workspaceBaseCurrency(workspaceId);
  const cur = (currency || "").toUpperCase();
  const day = String(date).slice(0, 10);
  if (!cur) return null;
  if (cur === base) {
    // Same currency: rate is exactly 1, no lookup needed and none should be required — a workspace
    // with no FX rates at all must still be able to record its own currency.
    return buildMoney({ amount, currency: cur, base, rate: 1, as_of: day, source: "identity" });
  }
  const { rates, as_of } = await loadRatesAsOf(day);
  const rate = rateBetween(cur, base, rates);
  if (rate == null) return null;
  return buildMoney({ amount, currency: cur, base, rate, as_of, source: "ecb" });
}

/** The rate for a settlement event, so realised FX gain/loss can be recorded. */
export async function settlementRateAt(
  workspaceId: string,
  currency: string,
  date: string,
): Promise<{ rate: number; as_of: string | null } | null> {
  const base = await workspaceBaseCurrency(workspaceId);
  const cur = (currency || "").toUpperCase();
  if (!cur) return null;
  if (cur === base) return { rate: 1, as_of: String(date).slice(0, 10) };
  const { rates, as_of } = await loadRatesAsOf(String(date).slice(0, 10));
  const rate = rateBetween(cur, base, rates);
  return rate == null ? null : { rate, as_of };
}

type RateRow = { currency: string; rate: number; as_of: string };

/**
 * Quotes from shortly before `from` onwards, oldest first.
 *
 * The lookback matters: the quote in force on the earliest date may itself be OLDER than that date
 * (rates aren't published at weekends or over holidays), so starting exactly at `from` would drop
 * the row that date actually needs and make conversion fail closed for no reason.
 */
async function loadAllRatesFrom(from: string): Promise<RateRow[]> {
  const LOOKBACK_DAYS = 14;                       // comfortably covers any weekend or holiday run
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS);
  const since = start.toISOString().slice(0, 10);

  const rows: RateRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data, error } = await supabase
      .from("fx_rates").select("currency, rate, as_of")
      .gte("as_of", since)
      .order("as_of", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const page = data ?? [];
    for (const r of page) {
      const rate = Number(r.rate);
      if (Number.isFinite(rate) && rate > 0) {
        rows.push({ currency: String(r.currency).toUpperCase(), rate, as_of: String(r.as_of) });
      }
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Rates in force on a day: the newest quote per currency at or before it. */
function effectiveOn(rows: RateRow[], day: string): { rates: Record<string, number>; as_of: string | null } {
  const rates: Record<string, number> = {};
  const picked: Record<string, string> = {};
  let as_of: string | null = null;
  for (const r of rows) {
    if (r.as_of > day) continue;                  // ascending — everything after this is in the future
    if (!picked[r.currency] || r.as_of >= picked[r.currency]!) {
      rates[r.currency] = r.rate;
      picked[r.currency] = r.as_of;
      if (!as_of || r.as_of > as_of) as_of = r.as_of;
    }
  }
  return { rates, as_of };
}
