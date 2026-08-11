import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { denyViewerWrites } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { seedFxHistory, makeHistoricalConverter, workspaceBaseCurrency, loadRates } from "../lib/currency-store";
import { buildMoney, buildSettlement, hasMoney, type MoneyFields } from "@mondaily/shared/money";

type Variables = { userId: string; workspaceId: string; role: string };

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

/**
 * Money model backfill.
 *
 * Records written before the five-field model carry only an amount and a currency, so their value
 * in the reporting currency is recomputed on every read at whatever today's rate is — which is why
 * historical totals moved every morning. This stamps each one with the rate that ACTUALLY applied
 * on its own transaction date.
 *
 * A record whose date predates stored rate history is NOT valued. Reaching for today's rate to fill
 * the gap would reintroduce precisely the bug being fixed, so those are reported as skipped and the
 * operator can seed more history first.
 */

/** Where each finance type keeps its amount, currency and the date the money is dated by. */
const SHAPES: Record<string, { amount: (d: Record<string, unknown>) => number; dateKeys: string[] }> = {
  invoice:     { amount: d => Number(d.total ?? 0) || 0,              dateKeys: ["issued_on", "sent_at", "created_at"] },
  quote:       { amount: d => Number(d.total ?? 0) || 0,              dateKeys: ["created_at"] },
  credit_note: { amount: d => (Number(d.amount_cents ?? 0) || 0) / 100, dateKeys: ["date", "created_at"] },
  expense:     { amount: d => (Number(d.amount_cents ?? 0) || 0) / 100, dateKeys: ["date", "created_at"] },
};

const day = (v: unknown): string => String(v ?? "").slice(0, 10);

router.post("/backfill", denyViewerWrites, zValidator("json", z.object({
  dry_run: z.boolean().default(true),
  object_types: z.array(z.enum(["invoice", "quote", "credit_note", "expense"])).optional(),
  seed_history: z.boolean().default(false),
})), async (c) => {
  const ws = c.get("workspaceId");
  const role = c.get("role") || "member";
  if (role !== "owner" && role !== "admin") return c.json({ error: "Owner/admin only." }, 403);
  const { dry_run, object_types, seed_history } = c.req.valid("json");

  // Pull ECB's 90-day history first, so dates before the table started keeping history can be
  // valued honestly instead of skipped.
  //
  // This runs during a DRY RUN too, deliberately: it writes reference rates, not the caller's
  // financial records. Gating it on dry_run made the preview useless — the only way to see what a
  // seeded backfill would do was to perform the record writes, which is exactly the thing a dry run
  // exists to avoid. Rates are public reference data and the daily cron writes the same rows.
  const seeded = seed_history ? await seedFxHistory() : null;

  const types = object_types ?? Object.keys(SHAPES);
  const { data: rows, error } = await supabase
    .from("nodes").select("id, object_type, data, created_at")
    .eq("workspace_id", ws).eq("vertical", "finance").in("object_type", types)
    .limit(5000);
  if (error) return c.json({ error: error.message }, 500);

  const candidates = (rows ?? [])
    .map(r => ({ ...r, data: (r.data ?? {}) as Record<string, unknown> }))
    .filter(r => SHAPES[r.object_type] && !hasMoney(r.data));

  const dateOf = (r: { object_type: string; data: Record<string, unknown>; created_at: string }): string => {
    const shape = SHAPES[r.object_type]!;
    for (const k of shape.dateKeys) {
      const v = day(r.data[k]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    }
    return day(r.created_at);
  };

  const base = await workspaceBaseCurrency(ws);
  const { at } = await makeHistoricalConverter(ws, candidates.map(dateOf));

  const planned: { id: string; object_type: string; date: string; amount: number; currency: string; money: MoneyFields }[] = [];
  const skipped: { id: string; object_type: string; date: string; currency: string; reason: string }[] = [];

  for (const r of candidates) {
    const shape = SHAPES[r.object_type]!;
    const amount = shape.amount(r.data);
    const currency = String(r.data.currency ?? "").toUpperCase();
    const date = dateOf(r);
    if (!currency) { skipped.push({ id: r.id, object_type: r.object_type, date, currency, reason: "no currency on the record" }); continue; }
    const conv = at(amount, currency, date);
    if (!conv) { skipped.push({ id: r.id, object_type: r.object_type, date, currency, reason: `no ${currency}→${base} rate on or before ${date}` }); continue; }
    planned.push({
      id: r.id, object_type: r.object_type, date, amount, currency,
      money: buildMoney({ amount, currency, base, rate: conv.rate, as_of: conv.as_of, source: conv.source }),
    });
  }

  if (dry_run) {
    return c.json({
      dry_run: true, base,
      candidates: candidates.length,
      would_value: planned.length,
      skipped: skipped.length,
      skipped_reasons: [...new Set(skipped.map(s => s.reason))].slice(0, 10),
      sample: planned.slice(0, 5).map(p => ({
        object_type: p.object_type, date: p.date,
        from: `${p.amount} ${p.currency}`, to: `${p.money.amount_base} ${base}`,
        rate: p.money.fx_rate, rate_as_of: p.money.fx_rate_as_of,
      })),
      seeded_history: seeded,
    });
  }

  let updated = 0;
  const failed: string[] = [];
  for (const p of planned) {
    const row = candidates.find(x => x.id === p.id)!;
    const next: Record<string, unknown> = { ...row.data, ...p.money, issued_on: p.date };

    // A paid invoice also has a settlement moment. Valuing it at the payment-date rate is what
    // makes realised FX gain/loss real rather than an estimate — and it can only be captured from
    // the stored history, never recovered later.
    if (row.object_type === "invoice" && String(row.data.status ?? "") === "paid") {
      const paidOn = day(row.data.paid_at) || p.date;
      const s = at(p.money.amount_presentment, p.money.currency_presentment, paidOn);
      if (s) Object.assign(next, buildSettlement(p.money, { rate: s.rate, on: paidOn, as_of: s.as_of }));
    }

    const { error: upErr } = await supabase.from("nodes")
      .update({ data: next }).eq("workspace_id", ws).eq("id", p.id);
    if (upErr) failed.push(p.id); else updated += 1;
  }

  return c.json({
    ok: true, base,
    seeded_history: seeded,
    candidates: candidates.length,
    updated,
    skipped: skipped.length,
    skipped_reasons: [...new Set(skipped.map(s => s.reason))].slice(0, 10),
    failed: failed.length,
  });
});

/** What the model covers right now — so the gap is visible instead of assumed closed. */
router.get("/coverage", async (c) => {
  const ws = c.get("workspaceId");
  const [{ data: rows }, base, { as_of }] = await Promise.all([
    supabase.from("nodes").select("object_type, data")
      .eq("workspace_id", ws).eq("vertical", "finance")
      .in("object_type", Object.keys(SHAPES)).limit(5000),
    workspaceBaseCurrency(ws),
    loadRates(),
  ]);
  const by: Record<string, { total: number; modelled: number }> = {};
  for (const r of rows ?? []) {
    const t = String(r.object_type);
    const b = (by[t] ??= { total: 0, modelled: 0 });
    b.total += 1;
    if (hasMoney((r.data ?? {}) as Record<string, unknown>)) b.modelled += 1;
  }
  const { data: oldest } = await supabase.from("fx_rates").select("as_of").order("as_of", { ascending: true }).limit(1);
  return c.json({
    base,
    rates_latest: as_of,
    rates_earliest: oldest?.[0]?.as_of ?? null,
    by_type: by,
    total: Object.values(by).reduce((s, v) => s + v.total, 0),
    modelled: Object.values(by).reduce((s, v) => s + v.modelled, 0),
  });
});

export const moneyRouter = router;
