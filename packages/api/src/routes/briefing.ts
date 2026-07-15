import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { makeBaseConverter } from "../lib/currency-store";

/**
 * GET /api/v1/briefing — the "chief of staff" morning brief. Composes what needs you, what the
 * agents handled autonomously, and the workspace pulse — ALL from real data, deterministic (no AI,
 * no fabrication). One fetch powers the Briefing surface.
 */
const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

router.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).getTime();

  const [pendingR, autoR, overdueTasksR, financeR, dealsR, conv] = await Promise.all([
    supabase.from("decision_queue").select("id,title,risk_level,agent_name").eq("workspace_id", ws).eq("status", "pending").order("created_at", { ascending: true }).limit(500),
    supabase.from("decision_queue").select("id").eq("workspace_id", ws).eq("resolved_by", "autonomy").gte("resolved_at", startOfToday.toISOString()).limit(500),
    supabase.from("tasks").select("id").eq("workspace_id", ws).eq("completed", false).lt("due_date", new Date().toISOString()).limit(500),
    supabase.from("nodes").select("data").eq("workspace_id", ws).eq("vertical", "finance").eq("object_type", "invoice"),
    supabase.from("nodes").select("data,created_at").eq("workspace_id", ws).ilike("object_type", "%deal%").limit(2000),
    makeBaseConverter(ws),
  ]);
  const { base, toBase } = conv;

  const pend = pendingR.data ?? [];
  const highRisk = pend.filter(d => d.risk_level === "high").length;
  const rank = (r: string) => (r === "high" ? 0 : r === "medium" ? 1 : 2);
  const topDecisions = [...pend].sort((a, b) => rank(String(a.risk_level)) - rank(String(b.risk_level)))
    .slice(0, 4).map(d => ({ id: d.id, title: d.title, risk: d.risk_level, agent: d.agent_name }));

  const OUT = new Set(["sent", "viewed", "overdue"]);
  let overdueCount = 0, overdueTotal = 0, revenueMonth = 0, outstanding = 0;
  for (const row of financeR.data ?? []) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    const amt = toBase(Number(d.total ?? 0), String(d.currency ?? base));
    const st = String(d.status ?? "draft");
    if (st === "overdue") { overdueCount++; overdueTotal += amt; }
    if (OUT.has(st)) outstanding += amt;
    if (st === "paid") {
      const paid = (d.paid_at ?? d.created_at) as string | undefined;
      if (paid && Date.parse(paid) >= monthStart.getTime()) revenueMonth += amt;
    }
  }

  const deals = dealsR.data ?? [];
  const openPipeline = deals.filter(d => !/won|lost|closed/i.test(String((d.data as Record<string, unknown>).deal_stage ?? "")))
    .reduce((s, d) => s + num((d.data as Record<string, unknown>).deal_value), 0);
  const newDealsWeek = deals.filter(d => Date.parse(d.created_at) >= weekAgo).length;

  return c.json({
    base,
    needs_you: {
      pending: pend.length,
      high_risk: highRisk,
      overdue_tasks: (overdueTasksR.data ?? []).length,
      overdue_invoices: { count: overdueCount, total: Math.round(overdueTotal * 100) / 100 },
    },
    handled: { auto_approved_today: (autoR.data ?? []).length },
    pulse: {
      revenue_month: Math.round(revenueMonth * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
      open_pipeline: Math.round(openPipeline * 100) / 100,
      new_deals_week: newDealsWeek,
    },
    top_decisions: topDecisions,
  });
});

export { router as briefingRouter };
