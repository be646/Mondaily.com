import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useModules } from "../../hooks/useModules";
import { agentById } from "../../lib/agents";

/**
 * Agent Dock / Constellation data — backed by the real Agent Registry at
 * GET /api/v1/agents (see packages/api/src/routes/agents.ts), which
 * derives status from real data (tasks, notifications, nodes, invoices)
 * and real run history (agent_jobs, written by the Inngest jobs under
 * packages/api/src/jobs). Nothing here is fabricated or upgraded for
 * visual effect — the frontend only maps each registry entry to an icon.
 */

export type ConstellationState = "active" | "monitoring" | "needs_approval" | "issue" | "disabled" | "not_configured";

export interface ConstellationAgent {
  id: string;
  name: string;
  icon: React.ElementType;
  category: string;
  state: ConstellationState;
  /** One-line honest note — what's real about this node right now. */
  note: string;
  /** Real jobs/automations backing this node, if any. */
  backedBy?: string[];
  lastRunAt: string | null;
  evidenceCount: number;
  suggestedAction: string | null;
  to?: string;
}

export const CONSTELLATION_STATE_LABEL: Record<ConstellationState, string> = {
  active: "Active",
  monitoring: "Monitoring",
  needs_approval: "Needs approval",
  issue: "Issue found",
  disabled: "Module disabled",
  not_configured: "Not configured",
};

interface TaskLite { id: string; due_date?: string; completed: boolean; status?: string; }
interface NotificationLite { id: string; type: string; is_read: boolean; }
interface NodeLite { id: string; object_type: string; data: Record<string, unknown>; updated_at: string; }

interface AgentRegistryEntry {
  id: string; name: string; category: string; status: string;
  state: ConstellationState; backed_by: string[]; last_run_at: string | null;
  last_action: string; evidence_count: number; suggested_action: string | null;
  destination: string;
}

const RELATIONSHIP_TYPES = ["deal", "contact", "company", "person"];

export function useAgentData() {
  const { hasFinance } = useModules();

  const registryQ = useQuery({
    queryKey: ["agent-registry"],
    queryFn: () => apiClient.get<{ agents: AgentRegistryEntry[] }>("/agents"),
    staleTime: 60_000,
  });

  // Workspace Graph Pulse needs raw totals (open tasks, relationship/record/
  // workflow counts) that the per-agent registry doesn't carry — kept as a
  // separate lightweight set of real queries, not duplicated agent logic.
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
  const nodesQ = useQuery({
    queryKey: ["agent-dock", "nodes"],
    queryFn: () => apiClient.get<NodeLite[]>("/nodes?limit=500"),
    staleTime: 60_000,
  });

  const tasks = tasksQ.data ?? [];
  const notifications = notificationsQ.data ?? [];
  const nodes = nodesQ.data ?? [];
  const relationships = nodes.filter(n => RELATIONSHIP_TYPES.some(t => n.object_type.toLowerCase().includes(t)));
  const workflows = nodes.filter(n => n.object_type === "automation" && n.data?.type === "workflow");

  const registryAgents = registryQ.data?.agents ?? [];
  const financeAgent = registryAgents.find(a => a.id === "finance");
  const signalAgent = registryAgents.find(a => a.id === "signal");

  const constellation: ConstellationAgent[] = registryAgents.map(a => ({
    id: a.id,
    name: agentById(a.id).name,
    icon: agentById(a.id).Icon,
    category: a.category,
    state: a.state,
    note: a.last_action || a.status,
    backedBy: a.backed_by.length ? a.backed_by : undefined,
    lastRunAt: a.last_run_at,
    evidenceCount: a.evidence_count,
    suggestedAction: a.suggested_action,
    to: a.destination,
  }));

  return {
    constellation,
    isLoading: registryQ.isLoading,
    isError: registryQ.isError,
    // Real counts for the Workspace Graph Pulse panel. Overdue-invoice and
    // risk counts are read straight from the registry (same numbers the
    // Finance/Signal agent cards show) instead of being recomputed here.
    pulse: {
      tasksOpen: tasks.filter(t => !t.completed).length,
      tasksOverdue: tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date).getTime() < Date.now()).length,
      relationships: relationships.length,
      financeOverdue: hasFinance ? (financeAgent?.evidence_count ?? 0) : null,
      records: nodes.length,
      workflows: workflows.length,
      risks: signalAgent?.evidence_count ?? notifications.filter(n => n.type === "ai_risk" && !n.is_read).length,
      isLoading: registryQ.isLoading || tasksQ.isLoading || nodesQ.isLoading,
      isError: registryQ.isError || tasksQ.isError || notificationsQ.isError || nodesQ.isError,
    },
  };
}
