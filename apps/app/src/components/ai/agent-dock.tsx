import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useModules } from "../../hooks/useModules";
import { agentById } from "../../lib/agents";
import { isOverdue as isPastDue } from "@mondaily/shared/dates";

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

/** `enabled: false` defers every request until the caller opts in — used by surfaces
 *  that render below the fold, so a heavy /nodes scan stays off the critical path.
 *
 *  `pulse` gates the two EXPENSIVE queries (/tasks?filter=all and /nodes?limit=500,
 *  the latter ~3s) plus the notifications feed. They only ever feed the returned
 *  `pulse` object — `constellation` comes purely from /agents. Nearly every caller
 *  reads only `constellation`, so this defaults OFF and the one Workspace-Graph-Pulse
 *  consumer opts in with `{ pulse: true }`. Read `pulse` without opting in and its
 *  counts are zero. */
export function useAgentData({ enabled = true, pulse: wantPulse = false }: { enabled?: boolean; pulse?: boolean } = {}) {
  const { hasFinance } = useModules();

  const registryQ = useQuery({
    queryKey: ["agent-registry"],
    queryFn: () => apiClient.get<{ agents: AgentRegistryEntry[] }>("/agents"),
    staleTime: 60_000,
    enabled,
  });

  // Workspace Graph Pulse needs raw totals (open tasks, relationship/record/
  // workflow counts) that the per-agent registry doesn't carry — kept as a
  // separate lightweight set of real queries, not duplicated agent logic.
  const tasksQ = useQuery({
    queryKey: ["agent-dock", "tasks"],
    queryFn: () => apiClient.get<TaskLite[]>("/tasks?filter=all"),
    staleTime: 60_000,
    enabled: enabled && wantPulse,
  });
  const notificationsQ = useQuery({
    // Shared key with Home's identical /notifications?limit=50 fetch — one request, not two.
    queryKey: ["notifications", "recent-50"],
    queryFn: () => apiClient.get<NotificationLite[]>("/notifications?limit=50"),
    staleTime: 60_000,
    enabled: enabled && wantPulse,
  });
  // EXACT counts from the database. This used to be `/nodes?limit=500` with the returned array's
  // length reported as "total records" — so any workspace past 500 records displayed exactly 500,
  // a page cap presented as the truth. Counting belongs in SQL, never in a truncated page.
  const countsQ = useQuery({
    queryKey: ["agent-dock", "node-counts"],
    queryFn: () => apiClient.get<{ total: number; by_type: Record<string, number> }>("/nodes/counts"),
    staleTime: 60_000,
    enabled: enabled && wantPulse,
  });
  // Workflow automations are identified by a field INSIDE data (data.type), which a type-level
  // count can't see — so fetch just the automation rows (a small set) rather than all records.
  const automationsQ = useQuery({
    queryKey: ["agent-dock", "automations"],
    queryFn: () => apiClient.get<NodeLite[]>("/nodes?object_type=automation&limit=1000"),
    staleTime: 60_000,
    enabled: enabled && wantPulse,
  });

  const tasks = tasksQ.data ?? [];
  const notifications = notificationsQ.data ?? [];
  const byType = countsQ.data?.by_type ?? {};
  const relationshipCount = Object.entries(byType)
    .filter(([type]) => RELATIONSHIP_TYPES.some(t => type.toLowerCase().includes(t)))
    .reduce((sum, [, n]) => sum + n, 0);
  const workflows = (automationsQ.data ?? []).filter(n => n.object_type === "automation" && n.data?.type === "workflow");

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
      tasksOverdue: tasks.filter(t => !t.completed && isPastDue(t.due_date)).length,
      relationships: relationshipCount,
      financeOverdue: hasFinance ? (financeAgent?.evidence_count ?? 0) : null,
      records: countsQ.data?.total ?? 0,
      workflows: workflows.length,
      risks: signalAgent?.evidence_count ?? notifications.filter(n => n.type === "ai_risk" && !n.is_read).length,
      isLoading: registryQ.isLoading || tasksQ.isLoading || countsQ.isLoading,
      isError: registryQ.isError || tasksQ.isError || notificationsQ.isError || countsQ.isError,
    },
  };
}
