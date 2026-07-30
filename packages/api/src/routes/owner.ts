import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { makeBaseConverter } from "../lib/currency-store";
import { AUTONOMY_HOURLY_CAP, autonomyUsageLastHour, readAutonomy } from "../lib/autonomy";
import {
  pagedNodes, monthToDate, prevMonthSamePoint, deltaPct,
  closedWonIn, pipelineCreatedIn, openPipeline, weightedForecast, closersIn, invoiceMetrics,
  dealStage, dealValue, dealOwner, isOpen, type NodeRow,
} from "../lib/money";

/**
 * GET /api/v1/owner/console — the owner's operating view. Admin/owner only.
 *
 * One payload, six sections, ranked by how often an owner looks: Money → People → Agents →
 * Pipeline health → (System reads /admin/readiness client-side) → Audit. Every money number comes
 * from lib/money — the SAME functions the Brief uses, which is the whole point: this page and the
 * brief can never disagree.
 *
 * Deterministic, no AI, paged reads only.
 */
const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

/** Open deals nobody has touched in 30 days — the money quietly going cold. */
export function stalledDeals(rows: NodeRow[], now = Date.now()): { count: number; value: number; top: { name: string; value: number; stage: string; days_stale: number }[] } {
  const cutoff = now - 30 * 86_400_000;
  const stalled = rows.filter(r => {
    const stage = dealStage(r.data);
    return isOpen(stage) && Date.parse(r.updated_at) < cutoff;
  });
  const top = stalled
    .map(r => ({
      name: String((r.data ?? {}).name ?? "Untitled"),
      value: dealValue(r.data),
      stage: dealStage(r.data),
      days_stale: Math.floor((now - Date.parse(r.updated_at)) / 86_400_000),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  return { count: stalled.length, value: stalled.reduce((s, r) => s + dealValue(r.data), 0), top };
}

router.get("/console", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const mtd = monthToDate();
  const prev = prevMonthSamePoint();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [invoices, deals, conv, members, decisions7d, pending, level, hourUsed, recentActs] = await Promise.all([
    pagedNodes(ws, { eq: "invoice" }),
    pagedNodes(ws, { ilike: "%deal%" }),
    makeBaseConverter(ws),
    supabase.from("workspace_members").select("user_id, name, email, role").eq("workspace_id", ws).limit(200),
    supabase.from("decision_queue").select("agent_name, status, resolved_by").eq("workspace_id", ws).gte("created_at", weekAgo).limit(1000),
    supabase.from("decision_queue").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "pending"),
    readAutonomy(ws),
    autonomyUsageLastHour(ws),
    supabase.from("activities").select("action, actor_id, diff, created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(200),
  ]);
  const { base, toBase } = conv;
  const r2 = (x: number) => Math.round(x * 100) / 100;

  // ── 1. Money — identical definitions to the Brief ──
  const inv = invoiceMetrics(invoices, toBase, base, mtd);
  const invPrev = invoiceMetrics(invoices, toBase, base, prev);
  const won = closedWonIn(deals, mtd);
  const wonPrev = closedWonIn(deals, prev);
  const created = pipelineCreatedIn(deals, mtd);
  const createdPrev = pipelineCreatedIn(deals, prev);
  const open = openPipeline(deals);

  // ── 2. People — deals per member. Money facts only; no invented "activity scores". ──
  const byOwner = new Map<string, { closed_count: number; closed_value: number; created_count: number; created_value: number; open_value: number }>();
  const bucket = (owner: string) => {
    const b = byOwner.get(owner) ?? { closed_count: 0, closed_value: 0, created_count: 0, created_value: 0, open_value: 0 };
    byOwner.set(owner, b); return b;
  };
  for (const cl of closersIn(deals, mtd)) { const b = bucket(cl.owner); b.closed_count = cl.count; b.closed_value = cl.value; }
  for (const r of deals) {
    const owner = dealOwner(r.data) || "Unassigned";
    if (Date.parse(r.created_at) >= mtd.start && Date.parse(r.created_at) <= mtd.end) {
      const b = bucket(owner); b.created_count++; b.created_value += dealValue(r.data);
    }
    if (isOpen(dealStage(r.data))) bucket(owner).open_value += dealValue(r.data);
  }
  const people = [...byOwner]
    .map(([owner, b]) => ({ owner, ...b, closed_value: r2(b.closed_value), created_value: r2(b.created_value), open_value: r2(b.open_value) }))
    .sort((a, b) => b.closed_value - a.closed_value || b.open_value - a.open_value);

  // ── 3. Agents — what ran unattended this week, per agent, plus the breaker's live state ──
  const agentRows = new Map<string, { auto: number; human: number; pending: number }>();
  for (const d of decisions7d.data ?? []) {
    const a = String(d.agent_name ?? "agent");
    const b = agentRows.get(a) ?? { auto: 0, human: 0, pending: 0 };
    if (d.status === "pending") b.pending++;
    else if (d.resolved_by === "autonomy") b.auto++;
    else b.human++;
    agentRows.set(a, b);
  }
  const agents = [...agentRows].map(([agent, b]) => ({ agent, ...b })).sort((a, b) => (b.auto + b.human + b.pending) - (a.auto + a.human + a.pending));

  // ── 4. Pipeline health — stalled + on-hold, the money going cold ──
  const stalled = stalledDeals(deals);
  const onHold = deals.filter(r => /hold/i.test(dealStage(r.data)));

  // ── 6. Audit — the recent consequential events, not a raw feed ──
  const audit = (recentActs.data ?? [])
    .filter(a => a.action === "decision_auto_approved" || (a.diff as Record<string, unknown> | null)?.data_cleaning)
    .slice(0, 10)
    .map(a => ({
      when: a.created_at,
      what: a.action === "decision_auto_approved"
        ? `Agent ${String(a.actor_id)} auto-approved: ${String((a.diff as Record<string, unknown>)?.title ?? "decision")}`
        : `Data cleaning: ${String((a.diff as Record<string, unknown>)?.data_cleaning)}`,
    }));

  return c.json({
    base,
    money: {
      closed_won: { value: r2(won.value), count: won.count, delta: deltaPct(won.value, wonPrev.value) },
      cash: { collected: inv.collected, invoiced: inv.invoiced, outstanding: inv.outstanding, delta: deltaPct(inv.collected, invPrev.collected) },
      pipeline_created: { value: r2(created.value), count: created.count, delta: deltaPct(created.value, createdPrev.value) },
      forecast: { value: r2(weightedForecast(deals)), open_count: open.count, open_value: r2(open.value) },
      overdue: inv.overdue,
    },
    people,
    members: (members.data ?? []).map(m => ({ name: m.name, email: m.email, role: m.role })),
    agents: {
      rows: agents,
      autonomy_level: level,
      breaker: { used_last_hour: hourUsed, cap: AUTONOMY_HOURLY_CAP },
    },
    pipeline_health: {
      stalled,
      on_hold: { count: onHold.length, value: r2(onHold.reduce((s, r) => s + dealValue(r.data), 0)) },
    },
    audit,
  });
});

export { router as ownerRouter };
