import { supabase } from "@mondaily/db/client";
import { loadRatesAsOf } from "./currency-store";
import { readMoney } from "@mondaily/shared/money";

/**
 * Re-deriving `amount_base` when the workspace changes its reporting currency.
 *
 * The rule the money model exists to protect: `amount_presentment` and `currency_presentment` are
 * what the client was actually charged, and they are NEVER touched. Only the base side moves.
 *
 * And it must move at each record's OWN transaction-date rate, not today's. Re-deriving a year of
 * history at this morning's rate would hand every past month a new set of numbers that depend on
 * when the migration happened to be run — the exact failure the frozen fields were introduced to
 * end. A June invoice's base value is a fact about June.
 *
 * `sumInBase` already re-expresses stored base values on READ so reports never break mid-migration.
 * This is the durable half: it rewrites the stored base so the frozen figures agree with the new
 * reporting currency and reports stop paying the conversion cost on every render.
 *
 * Nothing here is destructive in the sense that matters — presentment is untouched, so the original
 * charge survives verbatim and a re-run against the old currency reproduces the old figures.
 */

export interface RebaseRow {
  id: string;
  object_type: string;
  presentment: number;
  currency_presentment: string;
  /** The date whose rate applies — the record's own transaction date. */
  as_of: string;
  old_base: number | null;
  old_currency_base: string | null;
  new_base: number | null;
  new_rate: number | null;
  /** Why a row could not be converted. Null when it was. */
  blocked: string | null;
}

export interface RebasePlan {
  from_currency: string | null;
  to_currency: string;
  rows: RebaseRow[];
  summary: {
    scanned: number;
    convertible: number;
    blocked: number;
    already_in_target: number;
  };
}

const FINANCE_TYPES = ["invoice", "quote", "credit_note", "expense"] as const;

/** The transaction date a record's rate should be quoted at — its own, never today's. */
function transactionDate(data: Record<string, unknown>, createdAt: string): string {
  const candidates = [data.issued_on, data.date, data.paid_at, data.created_at, createdAt];
  for (const c of candidates) {
    const s = String(c ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return String(createdAt).slice(0, 10);
}

/**
 * Build the plan without writing anything.
 *
 * A row is BLOCKED rather than approximated when no rate exists for its date — a missing rate is a
 * fact worth reporting, and inventing one by reaching for the nearest available day would put a
 * number in the ledger that no source supports.
 */
export async function planRebase(workspaceId: string, toCurrency: string): Promise<RebasePlan> {
  const target = toCurrency.toUpperCase();
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings = ((wsRow?.settings ?? {}) as Record<string, unknown>);
  const from = typeof settings.base_currency === "string" ? String(settings.base_currency).toUpperCase() : null;

  const { data } = await supabase
    .from("nodes").select("id, object_type, data, created_at")
    .eq("workspace_id", workspaceId).eq("vertical", "finance")
    .in("object_type", FINANCE_TYPES as unknown as string[]);

  const rows: RebaseRow[] = [];
  // Rates are looked up per DATE, and many records share a date — cache so a thousand invoices in
  // one month cost one lookup rather than a thousand.
  const rateCache = new Map<string, Record<string, number>>();

  for (const r of data ?? []) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const m = readMoney(d);
    const presentmentCurrency = (m.currency || "").toUpperCase();
    const as_of = transactionDate(d, String(r.created_at));

    const base: RebaseRow = {
      id: String(r.id), object_type: String(r.object_type),
      presentment: m.amount, currency_presentment: presentmentCurrency,
      as_of, old_base: m.base_amount ?? null, old_currency_base: (m.base_currency ?? null),
      new_base: null, new_rate: null, blocked: null,
    };

    if ((m.base_currency ?? "").toUpperCase() === target) {
      base.blocked = null; base.new_base = m.base_amount ?? null; base.new_rate = m.rate ?? null;
      rows.push(base); continue;
    }
    if (!presentmentCurrency) { base.blocked = "no presentment currency recorded"; rows.push(base); continue; }

    if (!rateCache.has(as_of)) rateCache.set(as_of, (await loadRatesAsOf(as_of)).rates);
    const rates = rateCache.get(as_of)!;

    // Rates are quoted against a single pivot; a cross rate is target/presentment on the same day,
    // which keeps the arithmetic consistent with how the rest of the FX layer converts.
    const pFrom = presentmentCurrency === "EUR" ? 1 : rates[presentmentCurrency];
    const pTo = target === "EUR" ? 1 : rates[target];
    if (!pFrom || !pTo) {
      base.blocked = `no stored rate for ${!pFrom ? presentmentCurrency : target} on ${as_of}`;
      rows.push(base); continue;
    }
    const rate = pTo / pFrom;
    base.new_rate = Math.round(rate * 1e8) / 1e8;
    base.new_base = Math.round(m.amount * rate * 100) / 100;
    rows.push(base);
  }

  const alreadyTarget = rows.filter(r => (r.old_currency_base ?? "").toUpperCase() === target).length;
  return {
    from_currency: from, to_currency: target, rows,
    summary: {
      scanned: rows.length,
      convertible: rows.filter(r => !r.blocked && (r.old_currency_base ?? "").toUpperCase() !== target).length,
      blocked: rows.filter(r => r.blocked).length,
      already_in_target: alreadyTarget,
    },
  };
}

/**
 * Apply a plan.
 *
 * Writes only the base side and the provenance. `amount_presentment` / `currency_presentment` are
 * read-merge-written untouched, so the client's original charge is byte-identical afterwards — the
 * property that makes this reversible by simply rebasing back.
 */
export async function applyRebase(workspaceId: string, plan: RebasePlan): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0, skipped = 0;

  for (const row of plan.rows) {
    if (row.blocked || row.new_base == null || row.new_rate == null) { skipped++; continue; }
    if ((row.old_currency_base ?? "").toUpperCase() === plan.to_currency) { skipped++; continue; }

    const { data: current } = await supabase.from("nodes").select("data")
      .eq("workspace_id", workspaceId).eq("id", row.id).maybeSingle();
    if (!current) { errors.push(`${row.id}: not found`); continue; }
    const d = (current.data ?? {}) as Record<string, unknown>;

    const { error } = await supabase.from("nodes").update({
      data: {
        ...d,                                   // presentment survives verbatim
        amount_base: row.new_base,
        currency_base: plan.to_currency,
        fx_rate: row.new_rate,
        fx_rate_as_of: row.as_of,
        fx_rate_source: "ecb",
        // So a rebased figure can always be told from one frozen at the original transaction.
        rebased_from: row.old_currency_base ?? null,
        rebased_at: new Date().toISOString(),
      },
    }).eq("workspace_id", workspaceId).eq("id", row.id);
    if (error) errors.push(`${row.id}: ${error.message}`); else updated++;
  }
  return { updated, skipped, errors };
}
