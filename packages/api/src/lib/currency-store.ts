import { supabase } from "@mondaily/db/client";
import { fetchFxRates, DEFAULT_BASE_CURRENCY, type FxRates } from "./currency";

/** Load the stored reference rates (per 1 EUR) + the date they're as-of. Empty ⇒ {} (fail-closed). */
export async function loadRates(): Promise<{ rates: Record<string, number>; as_of: string | null }> {
  const { data } = await supabase.from("fx_rates").select("currency, rate, as_of");
  const rates: Record<string, number> = {};
  let as_of: string | null = null;
  for (const r of data ?? []) {
    const cur = String(r.currency).toUpperCase();
    const rate = Number(r.rate);
    if (Number.isFinite(rate) && rate > 0) rates[cur] = rate;
    if (!as_of || String(r.as_of) > as_of) as_of = String(r.as_of);
  }
  return { rates, as_of };
}

/** Upsert a fresh rates snapshot. Called by the daily cron only. */
export async function storeRates(fx: FxRates): Promise<number> {
  const rows = Object.entries(fx.rates).map(([currency, rate]) => ({ currency, rate, as_of: fx.date, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("fx_rates").upsert(rows, { onConflict: "currency" });
  return error ? 0 : rows.length;
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
