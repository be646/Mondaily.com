import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { workspacePeriodConfig } from "../lib/period-close";
import { makeBaseConverter } from "../lib/currency-store";
import { overdueCutoffISO } from "@mondaily/shared/dates";
import {
  pagedNodes, monthToDate, prevMonthSamePoint, deltaPct,
  closedWonIn, pipelineCreatedIn, openPipeline, weightedForecast, closersIn, invoiceMetrics,
} from "../lib/money";

/**
 * GET /api/v1/briefing — the owner's morning brief. Deterministic, no AI, all real data.
 *
 * Rebuilt on lib/money so the numbers here are THE numbers — same definitions the Owner Console
 * and reports use. The old version had volume KPIs with no deltas and an UNBOUNDED invoice read
 * (silently truncated at the row cap, understating revenue for any workspace past ~1000 invoices).
 *
 * Leads with the four numbers an owner actually opens the page for, each with a same-point
 * prior-month comparison (Jul 1–15 vs Jun 1–15, so mid-month never reads as a collapse):
 * closed won, cash collected vs invoiced, pipeline created, weighted forecast. Then WHO closed.
 */
const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

router.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86_400_000;
  // The WORKSPACE's month, not the server's. This surface used to roll over on the process
  // timezone (UTC on Vercel) while Reports rolled over on the workspace's, so the two could
  // disagree for hours on the 1st and both look right.
  const { data: wsRow } = await supabase.from("workspaces").select("settings, timezone").eq("id", ws).maybeSingle();
  const periodCfg = workspacePeriodConfig(wsRow as { timezone?: unknown; settings?: unknown } | null);
  const mtd = monthToDate(periodCfg);
  const prev = prevMonthSamePoint(periodCfg);

  const [pendingR, autoR, overdueTasksR, invoices, deals, conv] = await Promise.all([
    supabase.from("decision_queue").select("id,title,risk_level,agent_name").eq("workspace_id", ws).eq("status", "pending").order("created_at", { ascending: true }).limit(500),
    supabase.from("decision_queue").select("id").eq("workspace_id", ws).eq("resolved_by", "autonomy").gte("resolved_at", startOfToday.toISOString()).limit(500),
    supabase.from("tasks").select("id").eq("workspace_id", ws).eq("completed", false).lt("due_date", overdueCutoffISO()).limit(500),
    pagedNodes(ws, { eq: "invoice" }),
    pagedNodes(ws, { ilike: "%deal%" }),
    makeBaseConverter(ws),
  ]);
  const { base, toBase } = conv;

  const pend = pendingR.data ?? [];
  const highRisk = pend.filter(d => d.risk_level === "high").length;
  const rank = (r: string) => (r === "high" ? 0 : r === "medium" ? 1 : 2);
  const topDecisions = [...pend].sort((a, b) => rank(String(a.risk_level)) - rank(String(b.risk_level)))
    .slice(0, 4).map(d => ({ id: d.id, title: d.title, risk: d.risk_level, agent: d.agent_name }));

  // ── the money block: month-to-date, each with the same-point prior comparison ──
  const inv = invoiceMetrics(invoices, toBase, base, mtd);
  const invPrev = invoiceMetrics(invoices, toBase, base, prev);
  const won = closedWonIn(deals, mtd);
  const wonPrev = closedWonIn(deals, prev);
  const created = pipelineCreatedIn(deals, mtd);
  const createdPrev = pipelineCreatedIn(deals, prev);
  const open = openPipeline(deals);
  const r2 = (x: number) => Math.round(x * 100) / 100;

  const newDealsWeek = deals.filter(d => Date.parse(d.created_at) >= weekAgo).length;

  return c.json({
    base,
    needs_you: {
      pending: pend.length,
      high_risk: highRisk,
      overdue_tasks: (overdueTasksR.data ?? []).length,
      overdue_invoices: { count: inv.overdue.count, total: inv.overdue.total },
    },
    handled: { auto_approved_today: (autoR.data ?? []).length },
    // The four lead numbers. `delta` is % vs the same point last month, null when last month was 0.
    money: {
      closed_won: {
        value: r2(won.value), count: won.count, delta: deltaPct(won.value, wonPrev.value),
        // Wins with no close date are excluded from the window rather than dated by their last
        // edit. Reported so the gap is visible instead of silently missing from the total.
        undated: won.undated ?? 0, undated_value: won.undated_value ?? 0,
      },
      cash: { collected: inv.collected, invoiced: inv.invoiced, delta: deltaPct(inv.collected, invPrev.collected) },
      pipeline_created: { value: r2(created.value), count: created.count, delta: deltaPct(created.value, createdPrev.value) },
      forecast: { value: r2(weightedForecast(deals)), open_count: open.count, open_value: r2(open.value) },
      closers: closersIn(deals, mtd).slice(0, 5).map(x => ({ ...x, value: r2(x.value) })),
      overdue_aging: inv.overdue.aging,
    },
    // Kept for compatibility with older clients; the money block supersedes it.
    pulse: {
      revenue_month: inv.collected,
      outstanding: inv.outstanding,
      open_pipeline: r2(open.value),
      new_deals_week: newDealsWeek,
    },
    top_decisions: topDecisions,
  });
});

export { router as briefingRouter };
