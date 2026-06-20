import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Workflow, Users, Receipt, ShieldAlert } from "lucide-react";
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

export function useAgentData() {
  const { hasFinance } = useModules();
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

  return {
    agents,
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

const SCOPE_LABEL: Record<AgentSummary["scope"], string> = {
  workspace: "Workspace-wide",
  you: "Assigned to you",
};

export function AgentDock({ collapsed = false }: { collapsed?: boolean }) {
  const { agents, isLoading } = useAgentData();

  if (isLoading) {
    return (
      <div className={`shrink-0 ${collapsed ? "px-2" : "px-2"} pb-2`}>
        {!collapsed && <div className="skeleton-shimmer mb-1.5 h-3 w-20 rounded" />}
        <div className="skeleton-shimmer h-16 rounded-xl" />
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="shrink-0 px-2 pb-2 flex flex-col items-center gap-1.5">
        {agents.map(agent => (
          <Link key={agent.id} to={agent.to}
            title={`${agent.name} · ${STATUS_LABEL[agent.status]} · ${SCOPE_LABEL[agent.scope]} · ${agent.found}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors surface-hover">
            <span className="agent-dot" data-status={agent.status} />
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>
        Agents
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-soft)", background: "var(--surface-card)" }}>
        {agents.map((agent, i) => (
          <Link
            key={agent.id}
            to={agent.to}
            className="group flex items-start gap-2.5 px-2.5 py-2.5 text-left transition-colors surface-hover"
            style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: "var(--surface-hover)" }}>
              <agent.icon size={12} style={{ color: "var(--text-muted)" }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{agent.name}</span>
                <span className="agent-dot shrink-0" data-status={agent.status} title={STATUS_LABEL[agent.status]} />
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: "var(--text-faint)" }}>
                <span>{SCOPE_LABEL[agent.scope]}</span>
                <span>·</span>
                <span className="truncate">{STATUS_LABEL[agent.status]}</span>
              </div>
              <div className="mt-1 leading-snug text-[10.5px]" style={{ color: "var(--text-secondary)" }}>{agent.found}</div>
              {/* Revealed on hover — full context without truncating mid-word */}
              <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-150 group-hover:max-h-16 group-hover:opacity-100">
                <div className="mt-1.5 space-y-0.5 border-t pt-1.5" style={{ borderColor: "var(--border-soft)" }}>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Watching: {agent.watching}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{agent.lastAction}</p>
                  {agent.suggestedAction && (
                    <p className="text-[10px] font-medium" style={{ color: "var(--accent)" }}>→ {agent.suggestedAction}</p>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
