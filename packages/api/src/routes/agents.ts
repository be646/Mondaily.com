import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import {
  runDealAlerts, runRelationshipHealth, runOverdueTaskDecisions,
  runInvoiceChaser, runRecurringInvoices, runEnrichWorkspace, runLeadScoring,
} from "../jobs/runners";
import { runWorkflowsForWorkspace } from "../jobs/workflow-engine";
import { runOpportunityScan, runPeopleScan, runPortfolioScan, runAssetScan } from "../jobs/vertical-agents";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

/**
 * On-demand "Run now" — executes an agent's real job for THIS workspace
 * immediately, instead of waiting for the daily Vercel Cron. Same runner
 * functions the cron uses, scoped to the caller's workspace. Lets the app
 * surface a "Run" action and show results in real time.
 */
const AGENT_RUNNERS: Record<string, (workspaceId: string) => Promise<Record<string, unknown>>> = {
  relationship: async (ws) => ({ ...(await runDealAlerts(ws)), ...(await runRelationshipHealth(ws)) }),
  "lead-scoring": async (ws) => runLeadScoring(ws),
  operations: async (ws) => runOverdueTaskDecisions(ws),
  finance: async (ws) => ({ ...(await runInvoiceChaser(ws)), ...(await runRecurringInvoices(ws)) }),
  "graph-enrichment": async (ws) => runEnrichWorkspace(ws),
  workflow: async (ws) => ({ ...(await runWorkflowsForWorkspace(ws)) }),
  opportunity: async (ws) => ({ ...(await runOpportunityScan(ws)), ...(await runLeadScoring(ws)) }),
  people: async (ws) => runPeopleScan(ws),
  portfolio: async (ws) => runPortfolioScan(ws),
  asset: async (ws) => runAssetScan(ws),
};

router.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  const runner = AGENT_RUNNERS[id];
  if (!runner) {
    return c.json({ error: `Agent "${id}" has no on-demand run action.`, runnable: Object.keys(AGENT_RUNNERS) }, 400);
  }
  try {
    const result = await runner(c.get("workspaceId"));
    return c.json({ ran: true, agent: id, result });
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/**
 * Real Agent Registry — every agent concept that actually exists in this
 * codebase, with status derived from real data (tasks, notifications,
 * nodes, invoices) and real run history (agent_jobs, written by the
 * Inngest jobs under packages/api/src/jobs). Nothing here is fabricated:
 * an agent is only "active" when there's a real signal behind it right
 * now, "monitoring" when it's wired but quiet, "disabled" when the
 * workspace's module setting turns it off, and "not_configured" when no
 * job has ever run for this workspace (or, for the four vertical scaffold
 * agents, no live job exists at all yet).
 */

type AgentState = "active" | "monitoring" | "needs_approval" | "issue" | "disabled" | "not_configured";

interface AgentStatusEntry {
  id: string;
  name: string;
  category: string;
  status: string;
  state: AgentState;
  backed_by: string[];
  last_run_at: string | null;
  last_action: string;
  evidence_count: number;
  suggested_action: string | null;
  destination: string;
}

interface AgentJobRow {
  agent_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

function latestJob(jobs: AgentJobRow[], agentName: string): AgentJobRow | null {
  const matches = jobs.filter(j => j.agent_name === agentName);
  if (!matches.length) return null;
  return matches.reduce((latest, j) => {
    const jt = new Date(j.completed_at ?? j.started_at ?? 0).getTime();
    const lt = new Date(latest.completed_at ?? latest.started_at ?? 0).getTime();
    return jt > lt ? j : latest;
  });
}

function jobSummary(job: AgentJobRow | null, idleLabel: string): { lastAction: string; lastRunAt: string | null } {
  if (!job) return { lastAction: idleLabel, lastRunAt: null };
  const when = job.completed_at ?? job.started_at;
  if (job.status === "failed") return { lastAction: `Last run failed: ${job.error ?? "unknown error"}`, lastRunAt: when };
  if (job.status === "running") return { lastAction: "Running now", lastRunAt: when };
  const out = job.output as Record<string, unknown> | null;
  const summary = typeof out?.summary === "string" ? out.summary : "Completed last run";
  return { lastAction: summary, lastRunAt: when };
}

router.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");

  const [tasksRes, notificationsRes, nodesRes, jobsRes, workspaceRes, decisionsRes] = await Promise.all([
    supabase.from("tasks").select("id,completed,due_date,status").eq("workspace_id", workspaceId),
    supabase.from("notifications").select("id,type,is_read").eq("workspace_id", workspaceId).limit(100),
    supabase.from("nodes").select("id,object_type,data,updated_at").eq("workspace_id", workspaceId).limit(500),
    supabase.from("agent_jobs").select("agent_name,status,started_at,completed_at,output,error").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(200),
    supabase.from("workspaces").select("settings").eq("id", workspaceId).single(),
    supabase.from("decision_queue").select("agent_name,risk_level").eq("workspace_id", workspaceId).eq("status", "pending"),
  ]);

  const tasks = tasksRes.data ?? [];
  const notifications = notificationsRes.data ?? [];
  const nodes = nodesRes.data ?? [];
  const jobs = (jobsRes.data ?? []) as AgentJobRow[];
  // decision_queue may not exist yet if the migration hasn't been applied —
  // treat that as "no pending decisions" rather than failing the whole route.
  const pendingDecisions = decisionsRes.data ?? [];
  const pendingFor = (...agentNames: string[]) => pendingDecisions.filter(d => agentNames.includes(d.agent_name));
  /** A pending Decision Queue item outranks a plain "active" finding —
   * "needs_approval" (or "issue" for high-risk items) means a human must
   * act, not just that the agent noticed something. */
  function withDecisions(state: AgentState, agentNames: string[]): { state: AgentState; pendingCount: number } {
    const pending = pendingFor(...agentNames);
    if (pending.some(d => d.risk_level === "high")) return { state: "issue", pendingCount: pending.length };
    if (pending.length > 0) return { state: "needs_approval", pendingCount: pending.length };
    return { state, pendingCount: 0 };
  }
  const modules = ((workspaceRes.data?.settings as Record<string, unknown> | null)?.modules as string[] | undefined) ?? ["crm"];
  const hasFinance = modules.includes("finance");
  const hasHR = modules.includes("hr");
  const hasInvestments = modules.includes("investments");

  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date).getTime() < now);
  const reviewTasks = tasks.filter(t => !t.completed && t.status === "review");

  const deals = nodes.filter(n => n.object_type.toLowerCase().includes("deal"));
  const staleDeals = deals.filter(d => {
    const stage = String((d.data as Record<string, unknown>)?.deal_stage ?? "");
    if (stage === "Closed Won" || stage === "Closed Lost") return false;
    return now - new Date(d.updated_at).getTime() > FOURTEEN_DAYS;
  });

  const invoices = nodes.filter(n => n.object_type === "invoice");
  const overdueInvoices = invoices.filter(n => String((n.data as Record<string, unknown>)?.status ?? "") === "overdue");

  const unreadRisk = notifications.filter(n => n.type === "ai_risk" && !n.is_read);

  const agents: AgentStatusEntry[] = [];

  // Graph Agent — the conversational interface to the workspace graph
  // (Ask Mondaily). Always real, request-driven rather than
  // background-job-driven, so it has no "pending decisions" of its own.
  agents.push({
    id: "ask-mondaily", name: "Graph Agent", category: "core",
    status: "Answering questions across the workspace graph",
    state: "active", backed_by: [], last_run_at: null, last_action: "Available now",
    evidence_count: 0, suggested_action: null, destination: "/ask/new",
  });

  {
    const { state, pendingCount } = withDecisions(
      overdueTasks.length > 0 || reviewTasks.length > 0 ? "active" : "monitoring",
      ["operations"]
    );
    agents.push({
      id: "operations", name: "Operations Agent", category: "operations",
      status: overdueTasks.length > 0 ? `${overdueTasks.length} overdue task(s)` : "No findings",
      state,
      backed_by: [], last_run_at: null,
      last_action: overdueTasks.length > 0 ? `Found ${overdueTasks.length} overdue task(s)` : "Checked workspace tasks just now",
      evidence_count: overdueTasks.length + reviewTasks.length + pendingCount,
      suggested_action: overdueTasks.length > 0 ? "Review and reassign overdue tasks" : null,
      destination: "/tasks",
    });
  }

  {
    const relationshipJob = jobSummary(
      latestJob(jobs, "deal_alerts") ?? latestJob(jobs, "relationship_health"),
      "No automation run yet for this workspace"
    );
    const { state, pendingCount } = withDecisions(staleDeals.length > 0 ? "active" : "monitoring", ["relationship"]);
    agents.push({
      id: "relationship", name: "Relationship Agent", category: "relationship",
      status: staleDeals.length > 0 ? `${staleDeals.length} relationship(s) gone quiet` : "No findings",
      state,
      backed_by: ["deal_alerts", "relationship_health"],
      last_run_at: relationshipJob.lastRunAt, last_action: relationshipJob.lastAction,
      evidence_count: staleDeals.length + pendingCount,
      suggested_action: staleDeals.length > 0 ? `Reach out to ${staleDeals.length} stalled relationship(s)` : null,
      destination: "/pipeline",
    });
  }

  if (hasFinance) {
    const financeJob = jobSummary(
      latestJob(jobs, "invoice_chaser") ?? latestJob(jobs, "recurring_invoices"),
      "No automation run yet for this workspace"
    );
    const { state, pendingCount } = withDecisions(
      overdueInvoices.length > 0 ? "active" : "monitoring",
      ["finance", "invoice_chaser"]
    );
    agents.push({
      id: "finance", name: "Finance Agent", category: "finance",
      status: pendingCount > 0 ? `${pendingCount} decision(s) awaiting approval` : overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue invoice(s)` : "No findings",
      state,
      backed_by: ["invoice_chaser", "recurring_invoices", "credit_note_dispute_handler"],
      last_run_at: financeJob.lastRunAt, last_action: financeJob.lastAction,
      evidence_count: overdueInvoices.length + pendingCount,
      suggested_action: pendingCount > 0 ? "Review pending finance decisions" : overdueInvoices.length > 0 ? "Chase overdue invoices" : null,
      destination: pendingCount > 0 ? "/home" : "/finance/invoices",
    });
  } else {
    agents.push({
      id: "finance", name: "Finance Agent", category: "finance",
      status: "Module disabled", state: "disabled", backed_by: ["invoice_chaser", "recurring_invoices", "credit_note_dispute_handler"],
      last_run_at: null, last_action: "Enable the Finance module to turn this on.",
      evidence_count: 0, suggested_action: null, destination: "/settings/workspace",
    });
  }

  // Prospecting Agent — searches the web (Tavily) for candidate records of
  // any object type, real run history in agent_jobs (agent_name
  // "prospecting"). Conceptually it moves through idle → searching →
  // review_needed → completed/failed; mapped onto the shared AgentState
  // enum (already used by every other agent) so every surface — landing,
  // Home, sidebar, Ask — reads one consistent state vocabulary:
  //   idle          → "monitoring"      (no search running, nothing pending)
  //   searching      → "active"          (a run is in progress right now)
  //   review_needed  → "needs_approval"  (candidates queued in the Decision Queue)
  //   completed      → "monitoring"      (last run finished, nothing pending)
  //   failed         → "issue"           (last run failed)
  {
    const prospectingJob = latestJob(jobs, "prospecting");
    const prospectingSummary = jobSummary(prospectingJob, "No search run yet");
    const pendingProspecting = pendingFor("prospecting");
    let state: AgentState = "monitoring";
    if (prospectingJob?.status === "running") state = "active";
    else if (pendingProspecting.length > 0) state = "needs_approval";
    else if (prospectingJob?.status === "failed") state = "issue";
    agents.push({
      id: "prospecting", name: "Prospecting Agent", category: "graph",
      status: pendingProspecting.length > 0
        ? `${pendingProspecting.length} candidate(s) awaiting approval`
        : prospectingSummary.lastAction,
      state,
      backed_by: ["prospecting"],
      last_run_at: prospectingSummary.lastRunAt,
      last_action: prospectingSummary.lastAction,
      evidence_count: pendingProspecting.length,
      suggested_action: pendingProspecting.length > 0 ? "Review prospecting candidates" : null,
      destination: pendingProspecting.length > 0 ? "/home" : "/ask/new",
    });
  }

  agents.push({
    id: "signal", name: "Signal Agent", category: "signal",
    status: unreadRisk.length > 0 ? `${unreadRisk.length} new risk signal(s)` : "No findings",
    state: unreadRisk.length > 0 ? "active" : "monitoring",
    backed_by: [], last_run_at: null,
    last_action: unreadRisk.length > 0 ? `Raised ${unreadRisk.length} new risk signal(s)` : "Swept notifications just now",
    evidence_count: unreadRisk.length,
    suggested_action: unreadRisk.length > 0 ? "Inspect risk signals" : null,
    destination: "/notifications",
  });

  // Graph Enrichment Agent (backend agent_name "crm_enricher" — internal
  // identifier kept for data continuity, display name updated). Only
  // "active"/"monitoring" once it has actually run for this workspace —
  // it's registered as an Inngest function but workspace-level state
  // depends on whether it's ever been triggered here.
  const enrichJob = latestJob(jobs, "crm_enricher");
  if (enrichJob) {
    const summary = jobSummary(enrichJob, "");
    const enrichedCount = Number((enrichJob.output as Record<string, unknown> | null)?.enriched_count ?? 0);
    agents.push({
      id: "graph-enrichment", name: "Graph Enrichment Agent", category: "graph",
      status: enrichedCount > 0 ? `Enriched ${enrichedCount} record(s)` : "No findings",
      state: enrichedCount > 0 ? "active" : "monitoring",
      backed_by: ["crm_enricher"], last_run_at: summary.lastRunAt, last_action: summary.lastAction,
      evidence_count: enrichedCount, suggested_action: null, destination: "/search",
    });
  } else {
    agents.push({
      id: "graph-enrichment", name: "Graph Enrichment Agent", category: "graph",
      status: "Not yet run for this workspace", state: "not_configured",
      backed_by: ["crm_enricher"], last_run_at: null,
      last_action: "Runs automatically as records are created — none triggered yet.",
      evidence_count: 0, suggested_action: null, destination: "/search",
    });
  }

  // Workflow Agent — now backed by a real execution engine
  // (packages/api/src/jobs/workflow-engine.ts): active workflows run
  // trigger -> condition -> action against current records, executing safe
  // actions and queuing risky ones for approval. State derives from how many
  // workflows are active and any pending workflow decisions.
  {
    const workflowNodes = nodes.filter(n => n.object_type === "automation" && (n.data as Record<string, unknown>)?.type === "workflow");
    const activeWorkflows = workflowNodes.filter(n => String((n.data as Record<string, unknown>)?.status ?? "") === "active");
    const workflowJob = jobSummary(latestJob(jobs, "workflow"), "No workflow run yet");
    const { state, pendingCount } = withDecisions(activeWorkflows.length > 0 ? "active" : "monitoring", ["workflow"]);
    agents.push({
      id: "workflow", name: "Workflow Agent", category: "automation",
      status: pendingCount > 0
        ? `${pendingCount} workflow action(s) awaiting approval`
        : activeWorkflows.length > 0
          ? `${activeWorkflows.length} active workflow(s) executing`
          : `${workflowNodes.length} workflow(s) — none active yet`,
      state,
      backed_by: ["workflow_engine"],
      last_run_at: workflowJob.lastRunAt,
      last_action: workflowJob.lastAction,
      evidence_count: activeWorkflows.length + pendingCount,
      suggested_action: pendingCount > 0 ? "Review workflow actions in the Decision Queue" : activeWorkflows.length === 0 ? "Activate a workflow to start automating" : null,
      destination: "/automations",
    });
  }

  // Vertical agents — now backed by real scan jobs (packages/api/src/jobs/
  // vertical-agents.ts). Each runs daily via cron and on demand, derives
  // findings from real records, and queues the top items for approval.
  {
    const j = jobSummary(latestJob(jobs, "opportunity"), "No scan run yet");
    const { state, pendingCount } = withDecisions("monitoring", ["opportunity"]);
    agents.push({
      id: "opportunity", name: "Opportunity Agent", category: "relationship",
      status: pendingCount > 0 ? `${pendingCount} opportunity(ies) to review` : j.lastAction,
      state: pendingCount > 0 ? state : (latestJob(jobs, "opportunity") ? "active" : "monitoring"),
      backed_by: ["opportunity_scan"], last_run_at: j.lastRunAt, last_action: j.lastAction,
      evidence_count: pendingCount, suggested_action: pendingCount > 0 ? "Review conversion opportunities" : null,
      destination: "/pipeline",
    });
  }
  {
    const j = jobSummary(latestJob(jobs, "people"), "No scan run yet");
    const { state, pendingCount } = withDecisions("monitoring", ["people"]);
    agents.push({
      id: "people", name: "People Agent", category: "hr",
      status: pendingCount > 0 ? `${pendingCount} people record(s) to complete` : j.lastAction,
      state: pendingCount > 0 ? state : (latestJob(jobs, "people") ? "active" : "monitoring"),
      backed_by: ["people_scan"], last_run_at: j.lastRunAt, last_action: j.lastAction,
      evidence_count: pendingCount, suggested_action: pendingCount > 0 ? "Complete flagged people records" : null,
      destination: "/search",
    });
  }
  {
    const j = jobSummary(latestJob(jobs, "portfolio"), "No scan run yet");
    const { state, pendingCount } = withDecisions("monitoring", ["portfolio"]);
    agents.push({
      id: "portfolio", name: "Portfolio Agent", category: "investments",
      status: pendingCount > 0 ? `${pendingCount} holding(s) need review` : j.lastAction,
      state: pendingCount > 0 ? state : (latestJob(jobs, "portfolio") ? "active" : "monitoring"),
      backed_by: ["portfolio_scan"], last_run_at: j.lastRunAt, last_action: j.lastAction,
      evidence_count: pendingCount, suggested_action: pendingCount > 0 ? "Review flagged holdings" : null,
      destination: "/search",
    });
  }
  {
    const j = jobSummary(latestJob(jobs, "asset"), "No scan run yet");
    const { state, pendingCount } = withDecisions("monitoring", ["asset"]);
    agents.push({
      id: "asset", name: "Asset Agent", category: "realestate",
      status: pendingCount > 0 ? `${pendingCount} asset(s) need attention` : j.lastAction,
      state: pendingCount > 0 ? state : (latestJob(jobs, "asset") ? "active" : "monitoring"),
      backed_by: ["asset_scan"], last_run_at: j.lastRunAt, last_action: j.lastAction,
      evidence_count: pendingCount, suggested_action: pendingCount > 0 ? "Review flagged assets" : null,
      destination: "/search",
    });
  }

  return c.json({ agents });
});

/**
 * GET /api/v1/agents/activity — the agent PROOF-OF-WORK feed. Surfaces the
 * agent_jobs log (every background run: what ran, when, and its outcome) so the
 * app visibly shows the agents working instead of being silent. Optional
 * ?agent=<name> for a single agent's log; ?limit=N (default 80).
 */
router.get("/activity", async (c) => {
  const workspaceId = c.get("workspaceId");
  const agent = c.req.query("agent");
  const limit = Math.min(Number(c.req.query("limit")) || 80, 200);
  let q = supabase
    .from("agent_jobs")
    .select("id, agent_name, trigger_type, status, output, error, started_at, completed_at")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (agent) q = q.eq("agent_name", agent);
  const { data, error } = await q;
  if (error) return c.json({ activity: [] });

  const rows = (data ?? []).map((j) => {
    const out = (j.output ?? {}) as Record<string, unknown>;
    // Prefer the agent's own summary; else build one from the numeric output keys.
    let summary = (out.summary ?? out.message) as string | undefined;
    if (!summary) {
      const nums = Object.entries(out).filter(([, v]) => typeof v === "number" && (v as number) !== 0);
      summary = nums.length ? nums.map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ") : "ran — no changes needed";
    }
    return {
      id: j.id,
      agent: j.agent_name,
      trigger: j.trigger_type,
      status: j.status,
      summary,
      detail: out,                 // full structured output for the expanded view
      error: j.error ?? null,
      started_at: j.started_at,
      completed_at: j.completed_at,
    };
  });

  // REAL stats from the full table (not the capped list) so the KPIs are accurate.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const since = todayStart.toISOString();
  const [runsToday, errorsToday, todayNames] = await Promise.all([
    supabase.from("agent_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("started_at", since),
    supabase.from("agent_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "failed").gte("started_at", since),
    supabase.from("agent_jobs").select("agent_name").eq("workspace_id", workspaceId).gte("started_at", since),
  ]);
  const stats = {
    runs_today: runsToday.count ?? 0,
    errors_today: errorsToday.count ?? 0,
    agents_today: Array.from(new Set((todayNames.data ?? []).map(r => r.agent_name))), // raw names; UI maps to real agents
  };

  // Per-agent ROSTER (real proof of work): each agent's last run, last outcome, and
  // today's run/error counts — computed from a recent window (covers all that ran).
  const { data: rosterRows } = await supabase
    .from("agent_jobs").select("agent_name, status, started_at")
    .eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(500);
  const byAgent: Record<string, { agent: string; last_run: string; last_status: string; runs_today: number; errors_today: number }> = {};
  for (const r of rosterRows ?? []) {
    const a = r.agent_name as string;
    if (!byAgent[a]) byAgent[a] = { agent: a, last_run: r.started_at, last_status: r.status, runs_today: 0, errors_today: 0 };
    if (new Date(r.started_at) >= todayStart) { byAgent[a]!.runs_today++; if (r.status === "failed") byAgent[a]!.errors_today++; }
  }
  const roster = Object.values(byAgent);

  // Real 24h throughput timeline — runs bucketed per hour (completed vs failed),
  // so the UI can draw a live operations graph from genuine data.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { data: tl } = await supabase
    .from("agent_jobs").select("status, started_at")
    .eq("workspace_id", workspaceId).gte("started_at", dayAgo.toISOString()).limit(4000);
  const nowMs = Date.now();
  const timeline = Array.from({ length: 24 }, (_, i) => {
    const end = nowMs - i * 3_600_000;
    const start = end - 3_600_000;
    const label = new Date(end).toLocaleTimeString(undefined, { hour: "2-digit" });
    let completed = 0, failed = 0;
    for (const r of tl ?? []) {
      const t = new Date(r.started_at).getTime();
      if (t > start && t <= end) { if (r.status === "failed") failed++; else completed++; }
    }
    return { label, completed, failed };
  }).reverse(); // oldest → newest

  return c.json({ activity: rows, stats, roster, timeline });
});

export { router as agentsRouter };
