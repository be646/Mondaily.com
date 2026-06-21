import { Link } from "react-router-dom";
import {
  ShieldAlert, CheckSquare, Activity, Gauge, ArrowUpRight, Sparkles, FileText,
  UserPlus, Receipt, TrendingUp, Users, Database, Workflow, GitBranch,
} from "lucide-react";
import { useAgentData } from "./agent-dock";

/**
 * Home "AI Command Center" — five real-data panels: what changed, what
 * needs approval, what Mondaily recommends, agent activity, and workspace
 * graph health. Every number comes from data already fetched on the home
 * page or from useAgentData — nothing fabricated, no invented confidence
 * scores or fake trend lines.
 */

interface NotificationLite { id: string; type: string; is_read: boolean; title: string; body?: string; created_at?: string; }
interface TaskLite { id: string; completed: boolean; due_date?: string; status?: string; priority?: string; }

const AGENT_ICON: Record<string, React.ElementType> = {
  ai_risk: ShieldAlert,
  agent: Sparkles,
  task_review: CheckSquare,
  approval: FileText,
  assignment: UserPlus,
  system: Activity,
};

const AGENT_LABEL: Record<string, string> = {
  ai_risk: "Signal Agent",
  agent: "Research Agent",
  task_review: "Operations Agent",
  approval: "Approvals",
  assignment: "Operations Agent",
  system: "Workspace",
  mention: "Mentions",
  comment: "Comments",
};

function relTime(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function CommandCenterStrip({ tasks, notifications, onAskMondaily, checkedAreas }: {
  tasks: TaskLite[]; notifications: NotificationLite[];
  /** Called when the user wants to jump to Ask Mondaily — optional prefill text. */
  onAskMondaily?: (prefill?: string) => void;
  /** What this card's "checked just now" empty state honestly covers — passed
   * by the caller since this component only receives task/notification data. */
  checkedAreas?: string[];
}) {
  const now = Date.now();
  // NOTE: `tasks` here is "assigned to you" scoped (same query as the Home
  // hero pills) — every label below says "assigned to you", never
  // "workspace" or "across workspace", so it can't silently disagree with
  // the workspace-wide numbers shown on the Operations Agent card.
  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date).getTime() < now);
  const reviewTasks = tasks.filter(t => !t.completed && t.status === "review");
  const activeTasks = tasks.filter(t => !t.completed);
  const riskAlerts = notifications.filter(n => n.type === "ai_risk").slice(0, 3);
  const decisionsCount = overdueTasks.length + reviewTasks.length;

  // Health: simple, honest ratio — share of YOUR active tasks that are NOT overdue.
  const healthPct = activeTasks.length === 0 ? 100 : Math.round(((activeTasks.length - overdueTasks.length) / activeTasks.length) * 100);

  // Agent activity blends real registry run history (GET /api/v1/agents —
  // agent_jobs-backed agents like Relationship/Finance/Graph Enrichment)
  // with notification-derived events, instead of reading notifications
  // alone. Anything without a real timestamp is excluded rather than
  // backfilled with "just now".
  const { constellation } = useAgentData();
  const registryActivity = constellation
    .filter(a => a.lastRunAt)
    .map(a => ({ id: `agent-${a.id}`, agentName: a.name, title: a.note, created_at: a.lastRunAt as string, fromRegistry: true as const }));
  const notificationActivity = notifications.slice(0, 5).map(n => ({ id: n.id, agentName: AGENT_LABEL[n.type] ?? "Workspace", title: n.title, created_at: n.created_at, fromRegistry: false as const, type: n.type }));
  const activity = [...registryActivity, ...notificationActivity]
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 6);

  const changed = notifications.slice(0, 4); // "what changed" — most recent workspace events
  const areasLabel = (checkedAreas?.length ? checkedAreas : ["tasks"]).join(", ");

  // "What Mondaily recommends" — concrete, never invented. Built only from
  // real signals already computed above; empty when there's truly nothing.
  const recommendations: { label: string; to: string }[] = [
    ...(overdueTasks.length > 0 ? [{ label: `Review ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} assigned to you`, to: "/tasks" }] : []),
    ...(reviewTasks.length > 0 ? [{ label: `Approve ${reviewTasks.length} drafted task${reviewTasks.length === 1 ? "" : "s"}`, to: "/tasks" }] : []),
    ...(riskAlerts.length > 0 ? [{ label: `Inspect ${riskAlerts.length} risk signal${riskAlerts.length === 1 ? "" : "s"}`, to: "/notifications" }] : []),
  ].slice(0, 3);

  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* What changed */}
      <div className="surface-card rounded-2xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <TrendingUp size={14} className="text-blue-600 dark:text-blue-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>What changed</span>
        </div>
        {changed.length === 0 ? (
          <div>
            <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No graph changes since last visit.</p>
            <p className="mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>Checked: {areasLabel} · just now</p>
            {onAskMondaily && (
              <button onClick={() => onAskMondaily("What changed in the workspace graph since I last checked?")} className="btn-suggested mt-2 !px-2.5 !py-1 !text-[11px]">
                Ask what changed
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {changed.map(n => (
              <li key={n.id} className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {n.title} <span style={{ color: "var(--text-faint)" }}>· {relTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {changed.length > 0 && (
          <Link to="/notifications" className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium" style={{ color: "var(--accent)" }}>
            View activity <ArrowUpRight size={11}/>
          </Link>
        )}
      </div>

      {/* What needs approval */}
      <div className="surface-card rounded-2xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <CheckSquare size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>What needs approval</span>
        </div>
        <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{decisionsCount}</p>
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {overdueTasks.length} overdue assigned to you · {reviewTasks.length} in review
        </p>
        <Link to="/tasks" className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium" style={{ color: "var(--accent)" }}>
          Approve / dismiss <ArrowUpRight size={11}/>
        </Link>
      </div>

      {/* What Mondaily recommends */}
      <div className="surface-card rounded-2xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={14} className="text-violet-600 dark:text-violet-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Mondaily recommends</span>
        </div>
        {recommendations.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No findings yet — nothing needs your attention.</p>
        ) : (
          <ul className="space-y-1.5">
            {recommendations.map(r => (
              <li key={r.label}>
                <Link to={r.to} className="text-[12px] hover:underline" style={{ color: "var(--text-secondary)" }}>{r.label}</Link>
              </li>
            ))}
          </ul>
        )}
        {onAskMondaily && (
          <button onClick={() => onAskMondaily()} className="btn-ai mt-2.5 !px-2.5 !py-1 !text-[11px]">
            <Sparkles size={10}/> Ask Mondaily
          </button>
        )}
      </div>

      {/* Agent activity */}
      <div className="surface-card rounded-2xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <Activity size={14} className="text-rose-600 dark:text-rose-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent activity</span>
        </div>
        {activity.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No recent agent activity.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map(n => {
              const Icon = n.fromRegistry ? Workflow : (AGENT_ICON[n.type] ?? Receipt);
              return (
                <li key={n.id} className="flex items-start gap-2">
                  <Icon size={12} className="mt-0.5 shrink-0 text-rose-500 dark:text-rose-400"/>
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>{n.agentName}</span> · {n.title}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>{relTime(n.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Workspace graph health */}
      <div className="surface-card rounded-2xl p-4 sm:col-span-2 lg:col-span-1">
        <div className="mb-2 flex items-center gap-2">
          <Gauge size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace graph health</span>
        </div>
        <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{healthPct}%</p>
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {activeTasks.length - overdueTasks.length} of your {activeTasks.length} active tasks are on track
        </p>
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-hover)" }}>
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${healthPct}%` }}/>
        </div>
      </div>
    </div>
  );
}

// Labels say exactly what the number counts — never a bare category name —
// so this panel's numbers can't be confused with the differently-scoped
// numbers in the hero pills or agent cards (e.g. "active tasks" here is
// workspace-wide, the hero pill's "open tasks" is assigned-to-you).
const PULSE_CATEGORIES: { key: "tasksOpen" | "relationships" | "financeOverdue" | "records" | "workflows" | "risks"; label: string; icon: React.ElementType }[] = [
  { key: "tasksOpen",      label: "active tasks",       icon: CheckSquare },
  { key: "relationships",  label: "relationship records", icon: Users },
  { key: "financeOverdue", label: "overdue invoices",   icon: Receipt },
  { key: "records",        label: "total records",      icon: Database },
  { key: "workflows",      label: "workflow records",   icon: Workflow },
  { key: "risks",          label: "open risk signals",  icon: ShieldAlert },
];

/**
 * Workspace Graph Pulse — compact real-count strip across the categories
 * that make Mondaily an asset-graph engine, not just a task list. Pulled
 * straight from useAgentData()'s shared queries (same numbers as the agent
 * cards). A category with no connected data source (e.g. finance on a
 * workspace without the finance module) shows a tasteful "—" rather than 0,
 * so an honest "not connected" never reads like "zero risk."
 */
export function WorkspaceGraphPulse() {
  const { pulse } = useAgentData();

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <GitBranch size={13} style={{ color: "var(--text-muted)" }}/>
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace Graph Pulse</h2>
      </div>
      {pulse.isLoading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton-shimmer h-20 rounded-xl"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          {PULSE_CATEGORIES.map(({ key, label, icon: Icon }) => {
            const value = pulse[key];
            const connected = value !== null;
            return (
              <div key={key} className="surface-card flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center">
                <Icon size={14} style={{ color: connected ? "var(--text-muted)" : "var(--text-faint)" }}/>
                <span className="text-lg font-semibold" style={{ color: connected ? "var(--text-primary)" : "var(--text-faint)" }}>
                  {connected ? value : "—"}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{label}</span>
                {!connected && <span className="text-[9px]" style={{ color: "var(--text-faint)" }}>Not connected</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
