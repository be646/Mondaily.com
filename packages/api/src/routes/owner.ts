import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { makeBaseConverter } from "../lib/currency-store";
import { aiGatewayComplete } from "../lib/ai-gateway";
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

/** AI spend per feature over a window — PAGED, because a busy workspace exceeds the row cap. */
async function aiSpendByFeature(ws: string, days: number): Promise<{ feature: string; total_tokens: number; calls: number }[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const by = new Map<string, { total_tokens: number; calls: number }>();
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase.from("ai_usage")
      .select("feature, total_tokens").eq("workspace_id", ws).gte("created_at", since)
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) break;   // spend is informational — a read error degrades to what was aggregated so far
    const rows = data ?? [];
    for (const r of rows) {
      const f = String((r as { feature?: string }).feature ?? "other");
      const b = by.get(f) ?? { total_tokens: 0, calls: 0 };
      b.total_tokens += Number((r as { total_tokens?: number }).total_tokens ?? 0);
      b.calls++;
      by.set(f, b);
    }
    if (rows.length < PAGE) break;
  }
  return [...by].map(([feature, b]) => ({ feature, ...b })).sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 10);
}

/**
 * The console payload builder — shared by GET /console and the Owner Memo, so the memo is
 * grounded in EXACTLY what the console shows and can never narrate different numbers.
 */
async function buildConsolePayload(ws: string) {
  const mtd = monthToDate();
  const prev = prevMonthSamePoint();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [invoices, deals, conv, members, decisions7d, pendingR, level, hourUsed, recentActs, aiSpend] = await Promise.all([
    pagedNodes(ws, { eq: "invoice" }),
    pagedNodes(ws, { ilike: "%deal%" }),
    makeBaseConverter(ws),
    supabase.from("workspace_members").select("user_id, name, email, role").eq("workspace_id", ws).limit(200),
    supabase.from("decision_queue").select("agent_name, status, resolved_by").eq("workspace_id", ws).gte("created_at", weekAgo).limit(1000),
    supabase.from("decision_queue").select("id,title,risk_level,agent_name").eq("workspace_id", ws).eq("status", "pending").order("created_at", { ascending: true }).limit(500),
    readAutonomy(ws),
    autonomyUsageLastHour(ws),
    supabase.from("activities").select("action, actor_id, diff, created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(200),
    aiSpendByFeature(ws, 30),
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

  // ── 4b. Actions — the cross-app pending-work queue, each row carrying its verb ──
  // Unassigned OPEN deals ranked by value: ownership gaps are where money quietly stalls (the
  // duplicate-records saga started as an ownership gap). Assign happens through /owner/assign-deal
  // below — NEVER a raw PATCH /nodes, which replaces `data` wholesale and would destroy the deal.
  const unassigned = deals
    .filter(r => isOpen(dealStage(r.data)) && !dealOwner(r.data))
    .map(r => ({ id: r.id, name: String((r.data ?? {}).name ?? "Untitled"), value: dealValue(r.data), stage: dealStage(r.data) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

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

  return {
    base,
    money: {
      closed_won: { value: r2(won.value), count: won.count, delta: deltaPct(won.value, wonPrev.value) },
      cash: { collected: inv.collected, invoiced: inv.invoiced, outstanding: inv.outstanding, delta: deltaPct(inv.collected, invPrev.collected) },
      pipeline_created: { value: r2(created.value), count: created.count, delta: deltaPct(created.value, createdPrev.value) },
      forecast: { value: r2(weightedForecast(deals)), open_count: open.count, open_value: r2(open.value) },
      overdue: inv.overdue,
    },
    people,
    members: (members.data ?? []).map(m => ({ user_id: m.user_id, name: m.name, email: m.email, role: m.role })),
    agents: {
      rows: agents,
      autonomy_level: level,
      breaker: { used_last_hour: hourUsed, cap: AUTONOMY_HOURLY_CAP },
      // Real tokens from ai_usage (30d), grouped by feature — the closest honest proxy for
      // per-agent cost until jobs tag a dedicated agent column.
      spend_30d: aiSpend,
    },
    actions: {
      unassigned_deals: unassigned.map(d => ({ ...d, value: r2(d.value) })),
      pending_decisions: {
        count: (pendingR.data ?? []).length,
        // Highest-risk first — the ones a human must actually look at.
        top: [...(pendingR.data ?? [])]
          .sort((a, b) => (a.risk_level === "high" ? 0 : a.risk_level === "medium" ? 1 : 2) - (b.risk_level === "high" ? 0 : b.risk_level === "medium" ? 1 : 2))
          .slice(0, 6)
          .map(d => ({ id: d.id, title: d.title, risk: d.risk_level, agent: d.agent_name })),
      },
    },
    pipeline_health: {
      stalled,
      on_hold: { count: onHold.length, value: r2(onHold.reduce((s, r) => s + dealValue(r.data), 0)) },
    },
    audit,
  };
}

router.get("/console", requireAdminRole, async (c) => {
  return c.json(await buildConsolePayload(c.get("workspaceId")));
});

/**
 * Deterministic memo — the fallback when the gateway is down or unconfigured, and the PROOF that
 * every sentence the AI writes could have been written without it. Same payload, plain templates.
 */
export function deterministicMemo(p: Awaited<ReturnType<typeof buildConsolePayload>>): string {
  const cur = (v: number) => `${v.toLocaleString()} ${p.base}`;
  const m = p.money;
  const lines: string[] = [];
  lines.push(`Closed won this month: ${cur(m.closed_won.value)} across ${m.closed_won.count} deal(s)${m.closed_won.delta !== null ? ` (${m.closed_won.delta >= 0 ? "+" : ""}${m.closed_won.delta}% vs the same point last month)` : ""}.`);
  lines.push(`Cash collected: ${cur(m.cash.collected)}${m.cash.delta !== null ? ` (${m.cash.delta >= 0 ? "+" : ""}${m.cash.delta}%)` : ""}; ${cur(m.cash.invoiced)} invoiced, ${cur(m.cash.outstanding)} outstanding.`);
  lines.push(`Pipeline: ${cur(m.pipeline_created.value)} created this month; weighted forecast ${cur(m.forecast.value)} over ${m.forecast.open_count} open deals worth ${cur(m.forecast.open_value)}.`);
  if (m.overdue.count > 0) lines.push(`Overdue AR: ${m.overdue.count} invoice(s), ${cur(m.overdue.total)}.`);
  const top = p.people[0];
  if (top) lines.push(`${top.owner} leads the team: ${cur(top.closed_value)} closed, ${cur(top.open_value)} open pipeline.`);
  if (p.pipeline_health.stalled.count > 0) lines.push(`${p.pipeline_health.stalled.count} open deal(s) worth ${cur(p.pipeline_health.stalled.value)} untouched for 30+ days — the largest is ${p.pipeline_health.stalled.top[0]?.name ?? "unknown"}.`);
  const autoTotal = p.agents.rows.reduce((s2, a) => s2 + a.auto, 0);
  if (autoTotal > 0) lines.push(`Agents auto-approved ${autoTotal} decision(s) this week at autonomy level "${p.agents.autonomy_level}".`);
  if (p.actions.pending_decisions.count > 0) lines.push(`${p.actions.pending_decisions.count} decision(s) are waiting for a human.`);
  if (p.actions.unassigned_deals.length > 0) lines.push(`${p.actions.unassigned_deals.length} open deal(s) have no owner.`);
  return lines.join("\n");
}

/**
 * POST /owner/memo — the Owner Memo. CODE COUNTS, AI NARRATES.
 *
 * The model receives the console payload — the numbers the console itself renders, from the same
 * builder — and writes prose. It is instructed to use ONLY those figures, and the grounding is
 * structural, not just prompted: the payload is the only context it gets, so there is nothing else
 * to leak in. If the gateway is down/unconfigured, the deterministic template memo ships instead,
 * flagged ai:false — degraded wording, identical facts.
 *
 * POST (not GET) because it spends tokens; the console has a button, nothing auto-fires.
 */
router.post("/memo", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const payload = await buildConsolePayload(ws);
  const fallback = deterministicMemo(payload);

  try {
    const text = await aiGatewayComplete({
      system: [
        "You write a concise operating memo for the OWNER of this workspace, from the JSON metrics provided.",
        "HARD RULES:",
        "- Use ONLY numbers present in the JSON. Never compute, extrapolate, or invent a figure. If a number is not in the JSON, do not mention it.",
        "- Money values are in the `base` currency; write them like '48,000 PLN'.",
        "- 3 short paragraphs, no headings, no bullet lists: (1) money this month and how it compares, (2) people and pipeline — who is closing, what is stalling, (3) agents and what needs the owner today.",
        "- Plain, direct, no praise, no filler, no advice beyond what the numbers state.",
      ].join("\n"),
      prompt: JSON.stringify(payload),
      maxTokens: 600,
      workspaceId: ws, userId: c.get("userId"), feature: "owner_memo",
    });
    const memo = String(text ?? "").trim();
    if (!memo) throw new Error("empty completion");
    return c.json({ memo, ai: true, generated_at: new Date().toISOString() });
  } catch (e) {
    console.warn("[owner/memo] gateway unavailable — deterministic memo served:", e instanceof Error ? e.message : String(e));
    return c.json({ memo: fallback, ai: false, generated_at: new Date().toISOString() });
  }
});

/**
 * POST /owner/assign-deal — set a deal's owner, safely.
 *
 * Exists because PATCH /nodes/:id REPLACES `data` wholesale: assigning an owner through it with a
 * partial body would silently erase every other field on the deal. This endpoint does the
 * read-merge-write on the server, only touches deal_owner, verifies the node is actually a deal in
 * this workspace, and writes an audit activity naming who assigned whom.
 */
router.post("/assign-deal", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json().catch(() => ({})) as { node_id?: string; owner?: string };
  const nodeId = String(body.node_id ?? "");
  const ownerName = String(body.owner ?? "").trim().slice(0, 120);
  if (!nodeId || !ownerName) return c.json({ error: "node_id and owner are required." }, 400);

  const { data: node } = await supabase.from("nodes").select("id, object_type, data").eq("workspace_id", ws).eq("id", nodeId).maybeSingle();
  if (!node) return c.json({ error: "Deal not found." }, 404);
  if (!String(node.object_type ?? "").toLowerCase().includes("deal")) return c.json({ error: "Not a deal." }, 400);

  const merged = { ...((node.data as Record<string, unknown>) ?? {}), deal_owner: ownerName };
  const { error } = await supabase.from("nodes").update({ data: merged, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("id", nodeId);
  if (error) return c.json({ error: error.message }, 500);

  const { error: auditErr } = await supabase.from("activities").insert({
    node_id: nodeId, workspace_id: ws, actor_type: "human", actor_id: c.get("userId"), action: "updated",
    diff: { assigned_owner: ownerName, via: "owner_console" },
  });
  if (auditErr) console.warn("[owner] assign audit failed:", auditErr.message);
  return c.json({ ok: true, owner: ownerName });
});

export { router as ownerRouter };
