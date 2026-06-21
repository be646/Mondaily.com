import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

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

type AgentState = "active" | "monitoring" | "disabled" | "not_configured";

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

  const [tasksRes, notificationsRes, nodesRes, jobsRes, workspaceRes] = await Promise.all([
    supabase.from("tasks").select("id,completed,due_date,status").eq("workspace_id", workspaceId),
    supabase.from("notifications").select("id,type,is_read").eq("workspace_id", workspaceId).limit(100),
    supabase.from("nodes").select("id,object_type,data,updated_at").eq("workspace_id", workspaceId).limit(500),
    supabase.from("agent_jobs").select("agent_name,status,started_at,completed_at,output,error").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(200),
    supabase.from("workspaces").select("settings").eq("id", workspaceId).single(),
  ]);

  const tasks = tasksRes.data ?? [];
  const notifications = notificationsRes.data ?? [];
  const nodes = nodesRes.data ?? [];
  const jobs = (jobsRes.data ?? []) as AgentJobRow[];
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

  // Ask Mondaily — always real, request-driven rather than background-job-driven.
  agents.push({
    id: "ask-mondaily", name: "Ask Mondaily", category: "core",
    status: "Answering questions across the workspace graph",
    state: "active", backed_by: [], last_run_at: null, last_action: "Available now",
    evidence_count: 0, suggested_action: null, destination: "/ask/new",
  });

  agents.push({
    id: "operations", name: "Operations Agent", category: "operations",
    status: overdueTasks.length > 0 ? `${overdueTasks.length} overdue task(s)` : "No findings",
    state: overdueTasks.length > 0 || reviewTasks.length > 0 ? "active" : "monitoring",
    backed_by: [], last_run_at: null,
    last_action: overdueTasks.length > 0 ? `Found ${overdueTasks.length} overdue task(s)` : "Checked workspace tasks just now",
    evidence_count: overdueTasks.length + reviewTasks.length,
    suggested_action: overdueTasks.length > 0 ? "Review and reassign overdue tasks" : null,
    destination: "/tasks",
  });

  const relationshipJob = jobSummary(
    latestJob(jobs, "deal_alerts") ?? latestJob(jobs, "relationship_health"),
    "No automation run yet for this workspace"
  );
  agents.push({
    id: "relationship", name: "Relationship Agent", category: "relationship",
    status: staleDeals.length > 0 ? `${staleDeals.length} relationship(s) gone quiet` : "No findings",
    state: staleDeals.length > 0 ? "active" : "monitoring",
    backed_by: ["deal_alerts", "relationship_health"],
    last_run_at: relationshipJob.lastRunAt, last_action: relationshipJob.lastAction,
    evidence_count: staleDeals.length,
    suggested_action: staleDeals.length > 0 ? `Reach out to ${staleDeals.length} stalled relationship(s)` : null,
    destination: "/pipeline",
  });

  if (hasFinance) {
    const financeJob = jobSummary(
      latestJob(jobs, "invoice_chaser") ?? latestJob(jobs, "recurring_invoices"),
      "No automation run yet for this workspace"
    );
    agents.push({
      id: "finance", name: "Finance Agent", category: "finance",
      status: overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue invoice(s)` : "No findings",
      state: overdueInvoices.length > 0 ? "active" : "monitoring",
      backed_by: ["invoice_chaser", "recurring_invoices", "credit_note_dispute_handler"],
      last_run_at: financeJob.lastRunAt, last_action: financeJob.lastAction,
      evidence_count: overdueInvoices.length,
      suggested_action: overdueInvoices.length > 0 ? "Chase overdue invoices" : null,
      destination: "/finance/invoices",
    });
  } else {
    agents.push({
      id: "finance", name: "Finance Agent", category: "finance",
      status: "Module disabled", state: "disabled", backed_by: ["invoice_chaser", "recurring_invoices", "credit_note_dispute_handler"],
      last_run_at: null, last_action: "Enable the Finance module to turn this on.",
      evidence_count: 0, suggested_action: null, destination: "/settings/workspace",
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
      evidence_count: enrichedCount, suggested_action: null, destination: "/objects",
    });
  } else {
    agents.push({
      id: "graph-enrichment", name: "Graph Enrichment Agent", category: "graph",
      status: "Not yet run for this workspace", state: "not_configured",
      backed_by: ["crm_enricher"], last_run_at: null,
      last_action: "Runs automatically as records are created — none triggered yet.",
      evidence_count: 0, suggested_action: null, destination: "/objects",
    });
  }

  // Scaffold-only vertical agents — code exists under packages/agents/src
  // but no live job/route surfaces them yet. Never shown as active.
  agents.push({
    id: "opportunity", name: "Opportunity Agent", category: "relationship",
    status: "Scaffold only — no live job wired up", state: "not_configured",
    backed_by: [], last_run_at: null, last_action: "Relationship signals currently surfaced via Relationship Agent.",
    evidence_count: 0, suggested_action: null, destination: "/settings/workspace",
  });
  agents.push({
    id: "people", name: "People Agent", category: "hr",
    status: hasHR ? "Module enabled — no live job wired up yet" : "Module disabled",
    state: hasHR ? "not_configured" : "disabled",
    backed_by: [], last_run_at: null,
    last_action: hasHR ? "No automation exists yet for this module." : "Enable the HR module to turn this on.",
    evidence_count: 0, suggested_action: null, destination: "/settings/workspace",
  });
  agents.push({
    id: "portfolio", name: "Portfolio Agent", category: "investments",
    status: hasInvestments ? "Module enabled — no live job wired up yet" : "Module disabled",
    state: hasInvestments ? "not_configured" : "disabled",
    backed_by: [], last_run_at: null,
    last_action: hasInvestments ? "No automation exists yet for this module." : "Enable the Investments module to turn this on.",
    evidence_count: 0, suggested_action: null, destination: "/settings/workspace",
  });
  agents.push({
    id: "asset", name: "Asset Agent", category: "realestate",
    status: "Not yet enableable in this workspace", state: "not_configured",
    backed_by: [], last_run_at: null, last_action: "Code scaffold exists — no module toggle exists yet.",
    evidence_count: 0, suggested_action: null, destination: "/settings/workspace",
  });

  return c.json({ agents });
});

export { router as agentsRouter };
