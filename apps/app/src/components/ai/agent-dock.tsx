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

export interface AgentSummary {
  id: string;
  name: string;
  icon: React.ElementType;
  status: AgentStatus;
  watching: string;
  detail: string;
  to: string;
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  needs_approval: "Needs approval",
  issue: "Issue found",
  draft_ready: "Draft ready",
};

interface TaskLite { id: string; due_date?: string; completed: boolean; status?: string; }
interface NotificationLite { id: string; type: string; is_read: boolean; }
interface InvoiceLite { id: string; status: string; }
interface DealLite { id: string; object_type: string; data: Record<string, unknown>; updated_at: string; }

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
  const dealsQ = useQuery({
    queryKey: ["agent-dock", "deals"],
    queryFn: async () => {
      const all = await apiClient.get<DealLite[]>("/nodes?limit=200");
      return all.filter(n => n.object_type.toLowerCase().includes("deal"));
    },
    staleTime: 60_000,
  });

  const tasks = tasksQ.data ?? [];
  const notifications = notificationsQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const deals = dealsQ.data ?? [];

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
      watching: "Open tasks across the graph",
      status: overdueTasks.length > 0 ? "needs_approval" : reviewTasks.length > 0 ? "working" : "idle",
      detail: overdueTasks.length > 0
        ? `Found ${overdueTasks.length} overdue — review and reassign`
        : reviewTasks.length > 0
        ? `${reviewTasks.length} drafted task${reviewTasks.length === 1 ? "" : "s"} in review`
        : "All caught up",
      to: "/tasks",
    },
    {
      id: "relationship",
      name: "Relationship Agent",
      icon: Users,
      watching: "Deals and relationships",
      status: staleDeals.length > 0 ? "issue" : "idle",
      detail: staleDeals.length > 0 ? `${staleDeals.length} gone quiet 14+ days — needs a touch` : "Relationships healthy",
      to: "/pipeline",
    },
    ...(hasFinance ? [{
      id: "finance",
      name: "Finance Agent",
      icon: Receipt,
      watching: "Invoices and cash exposure",
      status: (overdueInvoices.length > 0 ? "issue" : "idle") as AgentStatus,
      detail: overdueInvoices.length > 0 ? `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"}` : "No overdue invoices",
      to: "/finance/invoices",
    }] : []),
    {
      id: "signal",
      name: "Signal Agent",
      icon: ShieldAlert,
      watching: "Risk signals across the graph",
      status: unreadRisk.length > 0 ? "needs_approval" : unreadAgent.length > 0 ? "draft_ready" : "idle",
      detail: unreadRisk.length > 0
        ? `${unreadRisk.length} new signal${unreadRisk.length === 1 ? "" : "s"} raised`
        : unreadAgent.length > 0
        ? `${unreadAgent.length} update${unreadAgent.length === 1 ? "" : "s"}`
        : "Monitoring workspace",
      to: "/notifications",
    },
  ];

  return { agents, isLoading: tasksQ.isLoading || notificationsQ.isLoading || dealsQ.isLoading };
}

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
          <Link key={agent.id} to={agent.to} title={`${agent.name} · ${STATUS_LABEL[agent.status]} · ${agent.detail}`}
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
            className="flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors surface-hover"
            style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}
          >
            <agent.icon size={13} style={{ color: "var(--text-muted)" }} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{agent.name}</div>
              <div className="truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>{agent.detail}</div>
            </div>
            <span className="agent-dot shrink-0" data-status={agent.status} title={STATUS_LABEL[agent.status]} />
          </Link>
        ))}
      </div>
    </div>
  );
}
