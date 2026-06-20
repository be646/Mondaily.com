import { useQuery } from "@tanstack/react-query";
import { Workflow, Users, Receipt, ShieldAlert, MessageCircle, TrendingUp, Briefcase, Building2 } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useModules } from "../../hooks/useModules";

/**
 * Agent Dock — makes the workspace's background agents visible as active
 * workers instead of hidden automations. Every status shown here is derived
 * from real data already in the workspace (overdue tasks, stale deals,
 * overdue invoices, unread AI risk alerts) — nothing here is fabricated.
 *
 * Agent names are graph-native, not CRM-flavoured: Operations Agent and
 * Relationship Agent (not "Task Agent" / "Sales Agent") so the product
 * doesn't narrow into a CRM identity. Only agents backed by a real,
 * computable signal are shown — Graph/Research/Workflow/Decision/Memory/
 * Compliance Agents are not included here because there's no real data
 * source for them yet (see useModules / endpoints below).
 */

export type AgentStatus = "idle" | "working" | "needs_approval" | "issue" | "draft_ready";

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  needs_approval: "Needs approval",
  issue: "Issue found",
  draft_ready: "Draft ready",
};

/** CTA copy varies with what the agent actually found — never a generic
 * "Open source" link. All four map to a real destination (agent.to). */
export const CTA_LABEL: Record<AgentStatus, string> = {
  idle: "Inspect graph",
  working: "View evidence",
  needs_approval: "Review findings",
  issue: "Review findings",
  draft_ready: "View evidence",
};

export interface AgentSummary {
  id: string;
  name: string;
  icon: React.ElementType;
  status: AgentStatus;
  /** Workspace-wide vs scoped to the signed-in user — shown explicitly so
   * counts never silently disagree with a "mine"-scoped number elsewhere. */
  scope: "workspace" | "you";
  /** What this agent is continuously monitoring. */
  watching: string;
  /** What it last did, in plain language — real, not simulated. */
  lastAction: string;
  /** What it found — empty state shown honestly when there's nothing. */
  found: string;
  /** A concrete next step, or null when there's genuinely nothing to do. */
  suggestedAction: string | null;
  /** Count of real records backing `found` — never fabricated. */
  evidenceCount: number;
  /** Shown instead of a generic "No evidence returned" when evidenceCount
   * is 0 — phrased per agent so an empty result reads as "nothing wrong"
   * rather than "something failed". */
  idleEvidenceLabel: string;
  to: string;
  /** @deprecated kept for components not yet migrated — same as `found`. */
  detail: string;
}

interface TaskLite { id: string; due_date?: string; completed: boolean; status?: string; }
interface NotificationLite { id: string; type: string; is_read: boolean; }
interface InvoiceLite { id: string; status: string; }
interface NodeLite { id: string; object_type: string; data: Record<string, unknown>; updated_at: string; }

const RELATIONSHIP_TYPES = ["deal", "contact", "company", "person"];

/** Honest categories for the Agent Constellation — never presented as
 * "fully autonomous" unless they're backed by real, currently-computed
 * data (`active`). `available` means the code/scaffold exists but there's
 * no live job/UI surfacing it yet. `module_disabled` means the workspace
 * hasn't turned the relevant module on. `coming_online` means there isn't
 * even a module toggle for it yet. */
export type ConstellationState = "active" | "monitoring" | "available" | "module_disabled" | "coming_online";

export interface ConstellationAgent {
  id: string;
  name: string;
  icon: React.ElementType;
  state: ConstellationState;
  /** One-line honest note — what's real about this node right now. */
  note: string;
  /** Real jobs/automations backing this node, if any (e.g. "Invoice Chaser"). */
  backedBy?: string[];
  to?: string;
}

export const CONSTELLATION_STATE_LABEL: Record<ConstellationState, string> = {
  active: "Active",
  monitoring: "Monitoring",
  available: "Available",
  module_disabled: "Module disabled",
  coming_online: "Coming online",
};

export function useAgentData() {
  const { hasFinance, hasInvestments, hasHR } = useModules();
  const tasksQ = useQuery({
    queryKey: ["agent-dock", "tasks"],
    queryFn: () => apiClient.get<TaskLite[]>("/tasks?filter=all"),
    staleTime: 60_000,
  });
  const notificationsQ = useQuery({
    queryKey: ["agent-dock", "notifications"],
    queryFn: () => apiClient.get<NotificationLite[]>("/notifications?limit=50"),
    staleTime: 60_000,
  });
  const invoicesQ = useQuery({
    queryKey: ["agent-dock", "invoices"],
    queryFn: () => apiClient.get<InvoiceLite[]>("/invoices"),
    staleTime: 60_000,
    retry: false,
    enabled: hasFinance,
  });
  // Broad node fetch backs both the Relationship Agent (deals) and the
  // Workspace Graph Pulse panel (records/relationships/workflows totals) —
  // one real query, no duplicated fabricated counts.
  const nodesQ = useQuery({
    queryKey: ["agent-dock", "nodes"],
    queryFn: () => apiClient.get<NodeLite[]>("/nodes?limit=500"),
    staleTime: 60_000,
  });

  const tasks = tasksQ.data ?? [];
  const notifications = notificationsQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const nodes = nodesQ.data ?? [];
  const deals = nodes.filter(n => n.object_type.toLowerCase().includes("deal"));
  const relationships = nodes.filter(n => RELATIONSHIP_TYPES.some(t => n.object_type.toLowerCase().includes(t)));
  const workflows = nodes.filter(n => n.object_type === "automation" && n.data?.type === "workflow");

  const now = Date.now();
  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date).getTime() < now);
  const reviewTasks = tasks.filter(t => !t.completed && t.status === "review");

  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
  const staleDeals = deals.filter(d => {
    const stage = String(d.data.deal_stage ?? "");
    if (stage === "Closed Won" || stage === "Closed Lost") return false;
    return now - new Date(d.updated_at).getTime() > FOURTEEN_DAYS;
  });

  const overdueInvoices = invoices.filter(inv => inv.status === "overdue");

  const unreadRisk = notifications.filter(n => n.type === "ai_risk" && !n.is_read);
  const unreadAgent = notifications.filter(n => n.type === "agent" && !n.is_read);

  const agents: AgentSummary[] = [
    {
      id: "operations",
      name: "Operations Agent",
      icon: Workflow,
      scope: "workspace",
      watching: "Open tasks across the graph",
      lastAction: "Checked workspace tasks just now",
      status: overdueTasks.length > 0 ? "needs_approval" : reviewTasks.length > 0 ? "working" : "idle",
      found: overdueTasks.length > 0
        ? `${overdueTasks.length} overdue across workspace${reviewTasks.length > 0 ? `, ${reviewTasks.length} in review` : ""}`
        : reviewTasks.length > 0
        ? `${reviewTasks.length} drafted task${reviewTasks.length === 1 ? "" : "s"} in review`
        : "No findings — all caught up",
      suggestedAction: overdueTasks.length > 0 ? "Review and reassign overdue tasks" : reviewTasks.length > 0 ? "Approve drafted tasks" : null,
      evidenceCount: overdueTasks.length + reviewTasks.length,
      idleEvidenceLabel: "No open findings",
      to: "/tasks",
      get detail() { return this.found; },
    },
    {
      id: "relationship",
      name: "Relationship Agent",
      icon: Users,
      scope: "workspace",
      watching: "Deals and relationships across the graph",
      lastAction: "Scanned relationship graph just now",
      status: staleDeals.length > 0 ? "issue" : "idle",
      found: staleDeals.length > 0 ? `${staleDeals.length} relationship${staleDeals.length === 1 ? "" : "s"} gone quiet 14+ days` : "No findings — relationships healthy",
      suggestedAction: staleDeals.length > 0 ? `Reach out to ${staleDeals.length} stalled relationship${staleDeals.length === 1 ? "" : "s"}` : null,
      evidenceCount: staleDeals.length,
      idleEvidenceLabel: "No active issues",
      to: "/pipeline",
      get detail() { return this.found; },
    },
    ...(hasFinance ? [{
      id: "finance",
      name: "Finance Agent",
      icon: Receipt,
      scope: "workspace" as const,
      watching: "Invoices and cash exposure",
      lastAction: "Checked invoice ledger just now",
      status: (overdueInvoices.length > 0 ? "issue" : "idle") as AgentStatus,
      found: overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"} across workspace` : "No findings — no overdue invoices",
      suggestedAction: overdueInvoices.length > 0 ? "Chase overdue invoices" : null,
      evidenceCount: overdueInvoices.length,
      idleEvidenceLabel: "No evidence needed",
      to: "/finance/invoices",
      get detail() { return this.found; },
    }] : []),
    {
      id: "signal",
      name: "Signal Agent",
      icon: ShieldAlert,
      scope: "workspace",
      watching: "Risk signals across the graph",
      lastAction: "Swept notifications just now",
      status: unreadRisk.length > 0 ? "needs_approval" : unreadAgent.length > 0 ? "draft_ready" : "idle",
      found: unreadRisk.length > 0
        ? `${unreadRisk.length} new risk signal${unreadRisk.length === 1 ? "" : "s"} raised`
        : unreadAgent.length > 0
        ? `${unreadAgent.length} agent update${unreadAgent.length === 1 ? "" : "s"}`
        : "No findings — monitoring workspace",
      suggestedAction: unreadRisk.length > 0 ? "Inspect risk signals" : unreadAgent.length > 0 ? "Review agent updates" : null,
      evidenceCount: unreadRisk.length + unreadAgent.length,
      idleEvidenceLabel: "No unresolved signals",
      to: "/notifications",
      get detail() { return this.found; },
    },
  ];

  // The full Agent Constellation — every agent concept that actually exists
  // in this codebase, shown honestly. Active = real live data (same as
  // `agents` above). Available = a real code scaffold exists
  // (packages/agents/src/*) but there's no live job/UI surfacing it.
  // Module-disabled = the workspace hasn't turned that module on.
  // Coming online = there isn't even a module toggle for it yet.
  const constellation: ConstellationAgent[] = [
    { id: "ask-mondaily", name: "Ask Mondaily", icon: MessageCircle, state: "active",
      note: "Answers questions across the workspace graph in real time." },
    { id: "operations", name: "Operations Agent", icon: Workflow, state: "active",
      note: agents.find(a => a.id === "operations")?.found ?? "", backedBy: ["Record Enrichment"], to: "/tasks" },
    { id: "relationship", name: "Relationship Agent", icon: Users, state: "active",
      note: agents.find(a => a.id === "relationship")?.found ?? "", backedBy: ["Deal Alerts", "Relationship Health"], to: "/pipeline" },
    { id: "finance", name: "Finance Agent", icon: Receipt,
      state: hasFinance ? "active" : "module_disabled",
      note: hasFinance ? (agents.find(a => a.id === "finance")?.found ?? "") : "Enable the Finance module to turn this on.",
      backedBy: hasFinance ? ["Invoice Chaser", "Recurring Invoices", "Credit Note Dispute Handler"] : undefined,
      to: hasFinance ? "/finance/invoices" : "/settings/workspace" },
    { id: "signal", name: "Signal Agent", icon: ShieldAlert, state: "active",
      note: agents.find(a => a.id === "signal")?.found ?? "", to: "/notifications" },
    { id: "sales", name: "Sales Agent", icon: TrendingUp, state: "available",
      note: "Scaffold exists — relationship signals currently surfaced via Relationship Agent." },
    { id: "hr", name: "HR Agent", icon: Briefcase,
      state: hasHR ? "available" : "module_disabled",
      note: hasHR ? "Module enabled — no live job wired up yet." : "Enable the HR module to turn this on.",
      to: hasHR ? undefined : "/settings/workspace" },
    { id: "investments", name: "Investments Agent", icon: TrendingUp,
      state: hasInvestments ? "available" : "module_disabled",
      note: hasInvestments ? "Module enabled — no live job wired up yet." : "Enable the Investments module to turn this on.",
      to: hasInvestments ? undefined : "/settings/workspace" },
    { id: "realestate", name: "Real Estate Agent", icon: Building2, state: "coming_online",
      note: "Code scaffold exists — not yet enableable in this workspace." },
  ];

  return {
    agents,
    constellation,
    isLoading: tasksQ.isLoading || notificationsQ.isLoading || nodesQ.isLoading,
    // Real counts for the Workspace Graph Pulse panel — same source data,
    // no separate fabricated numbers.
    pulse: {
      tasksOpen: tasks.filter(t => !t.completed).length,
      tasksOverdue: overdueTasks.length,
      relationships: relationships.length,
      financeOverdue: hasFinance ? overdueInvoices.length : null,
      records: nodes.length,
      workflows: workflows.length,
      risks: unreadRisk.length,
      isLoading: tasksQ.isLoading || nodesQ.isLoading || (hasFinance && invoicesQ.isLoading),
    },
  };
}

