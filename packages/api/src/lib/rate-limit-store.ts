import { supabase } from "@mondaily/db/client";

/**
 * Durable counters for rate limiting and login lockout.
 *
 * The in-memory Map versions were honest about being per-instance, but on Vercel that means they
 * effectively do not exist: measured against production on 2026-08-04, fifteen rapid requests to a
 * 12-per-minute endpoint all returned 200 because each landed on a different instance.
 *
 * This counts in Postgres — our own, so nothing about it is outsourced — via a single atomic
 * statement, because two concurrent requests must not both read "1 hit" and both proceed.
 *
 * FAIL-SOFT, deliberately. If the migration has not been run, or the database is briefly
 * unreachable, `hit()` returns null and the caller falls back to the in-memory layer rather than
 * locking every user out of the product. A limiter that takes the whole app down when its table is
 * missing is a worse outage than the abuse it prevents.
 */

export interface RateState {
  hits: number;
  lockedForSecs: number;
}

let tableMissing = false;   // latched after the first "relation does not exist" — stop retrying

export async function hit(key: string, windowMs: number): Promise<RateState | null> {
  if (tableMissing) return null;
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", { p_key: key, p_window_ms: windowMs });
    if (error) {
      // 42P01 undefined_table / 42883 undefined_function → the migration has not been applied.
      if (/does not exist|undefined_table|undefined_function|42P01|42883/i.test(error.message)) tableMissing = true;
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const locked = (row as { locked_until?: string | null }).locked_until;
    const lockedForSecs = locked
      ? Math.max(0, Math.ceil((new Date(locked).getTime() - Date.now()) / 1000))
      : 0;
    return { hits: Number((row as { hits?: number }).hits ?? 0), lockedForSecs };
  } catch {
    return null;
  }
}

export async function lock(key: string, ms: number): Promise<void> {
  if (tableMissing) return;
  try { await supabase.rpc("rate_limit_lock", { p_key: key, p_ms: ms }); } catch { /* fail-soft */ }
}

export async function clear(key: string): Promise<void> {
  if (tableMissing) return;
  try { await supabase.rpc("rate_limit_clear", { p_key: key }); } catch { /* fail-soft */ }
}

/** True once a call has proven the migration is absent — surfaced by /admin/readiness. */
export const isDurableRateLimitAvailable = () => !tableMissing;
