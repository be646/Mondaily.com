import { Link } from "react-router-dom";
import {
  ShieldAlert, CheckSquare, Activity, ArrowUpRight, Sparkles, FileText,
  UserPlus, Receipt, TrendingUp, Users, Database, Workflow, GitBranch, Layers, Clock,
} from "lucide-react";
import { useAgentData } from "./agent-dock";

/**
 * Home "What needs attention" stream — one connected feed (real
 * recommendations, approvals, risk signals, and recent graph changes),
 * each row tagged with the agent that produced it. Every number comes
 * from data already fetched on the home page or from useAgentData —
 * nothing fabricated, no invented confidence scores or fake trend lines.
 * Deliberately a stream of rows, not a grid of separate dashboard cards.
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
  agent: "Insights Agent",
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

interface StreamItem {
  id: string;
  icon: React.ElementType;
  agentLabel: string;
  title: string;
  meta?: string;
  to: string;
  tone: "violet" | "amber" | "rose" | "blue" | "default";
}

export function CommandCenterStrip({ tasks, notifications, onAskMondaily, checkedAreas }: {
  tasks: TaskLite[]; notifications: NotificationLite[];
  /** Called when the user wants to jump to Ask Mondaily — optional prefill text. */
  onAskMondaily?: (prefill?: string) => void;
  /** What this stream's "checked just now" empty state honestly covers — passed
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
  const riskAlerts = notifications.filter(n => n.type === "ai_risk").slice(0, 3);

  // Agent activity blends real registry run history (GET /api/v1/agents —
  // agent_jobs-backed agents like Relationship/Finance/Graph Enrichment)
  // with notification-derived events, instead of reading notifications
  // alone. Anything without a real timestamp is excluded rather than
  // backfilled with "just now".
  const { constellation } = useAgentData();
  const registryActivity = constellation
    .filter(a => a.lastRunAt)
    .map(a => ({ id: `agent-${a.id}`, agentName: a.name, title: a.note, created_at: a.lastRunAt as string, fromRegistry: true as const, type: "" }));
  const notificationActivity = notifications.slice(0, 5).map(n => ({ id: n.id, agentName: AGENT_LABEL[n.type] ?? "Workspace", title: n.title, created_at: n.created_at, fromRegistry: false as const, type: n.type }));
  const recentActivity = [...registryActivity, ...notificationActivity]
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 5);

  const areasLabel = (checkedAreas?.length ? checkedAreas : ["tasks"]).join(", ");

  // One unified stream, most-actionable first: approvals → risk → recent
  // agent activity. Nothing here is invented — every row maps to a real
  // overdue task, a real notification, or a real agent_jobs run.
  const stream: StreamItem[] = [
    ...(overdueTasks.length > 0 ? [{
      id: "overdue", icon: CheckSquare, agentLabel: "Operations Agent",
      title: `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} assigned to you`,
      meta: "needs approval or reassignment", to: "/tasks", tone: "amber" as const,
    }] : []),
    ...(reviewTasks.length > 0 ? [{
      id: "review", icon: FileText, agentLabel: "Operations Agent",
      title: `${reviewTasks.length} drafted task${reviewTasks.length === 1 ? "" : "s"} waiting on approval`,
      to: "/tasks", tone: "amber" as const,
    }] : []),
    ...riskAlerts.map(n => ({
      id: n.id, icon: ShieldAlert, agentLabel: "Signal Agent",
      title: n.title, meta: relTime(n.created_at), to: "/notifications", tone: "rose" as const,
    })),
    ...recentActivity.map(a => ({
      id: a.id, icon: a.fromRegistry ? Workflow : (AGENT_ICON[a.type] ?? Receipt), agentLabel: a.agentName,
      title: a.title, meta: relTime(a.created_at), to: "/notifications", tone: "default" as const,
    })),
  ].slice(0, 8);

  const TONE_COLOR: Record<StreamItem["tone"], string> = {
    violet: "#8b5cf6", amber: "#d97706", rose: "#dc2626", blue: "#3b82f6", default: "var(--text-muted)",
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>What needs attention</h2>
        </div>
        {onAskMondaily && (
          <button onClick={() => onAskMondaily()} className="btn-ai !px-2.5 !py-1 !text-[11px]">
            <Sparkles size={10}/> Ask Mondaily
          </button>
        )}
      </div>

      <div className="surface-card rounded-2xl">
        {stream.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12.5px]" style={{ color: "var(--text-faint)" }}>Nothing needs your attention — checked {areasLabel} just now.</p>
            {onAskMondaily && (
              <button onClick={() => onAskMondaily("What changed in the workspace graph since I last checked?")} className="btn-suggested mt-2.5 !px-2.5 !py-1 !text-[11px]">
                Ask what changed
              </button>
            )}
          </div>
        ) : (
          stream.map(item => (
            <Link key={item.id} to={item.to} className="stream-row" style={{ borderLeft: `2px solid ${TONE_COLOR[item.tone]}` }}>
              <item.icon size={13} className="mt-0.5 shrink-0" style={{ color: TONE_COLOR[item.tone] }}/>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>{item.agentLabel}</span> · {item.title}
                </p>
                {item.meta && <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>{item.meta}</p>}
              </div>
              <ArrowUpRight size={11} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }}/>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

// Labels say exactly what the number counts — never a bare category name —
// so this strip's numbers can't be confused with the differently-scoped
// numbers in the hero pills or agent cards (e.g. "active tasks" here is
// workspace-wide, the hero pill's "open tasks" is assigned-to-you).
const PULSE_CATEGORIES: { key: "tasksOpen" | "tasksOverdue" | "relationships" | "financeOverdue" | "records" | "workflows" | "risks"; label: string; icon: React.ElementType; color: string }[] = [
  { key: "tasksOpen",      label: "active tasks",        icon: CheckSquare, color: "#6366f1" },
  { key: "tasksOverdue",   label: "overdue tasks",        icon: Clock,       color: "#dc2626" },
  { key: "relationships",  label: "relationship records", icon: Users,       color: "#d97706" },
  { key: "financeOverdue", label: "overdue invoices",     icon: Receipt,     color: "#0891b2" },
  { key: "records",        label: "total records",        icon: Database,   color: "#059669" },
  { key: "workflows",      label: "workflow records",      icon: Workflow,   color: "#7c3aed" },
  { key: "risks",          label: "open risk signals",     icon: ShieldAlert, color: "#e11d48" },
];

/**
 * Workspace Graph Pulse — a grid of real-count tiles, each with a small
 * colored ring (decorative scale indicator, not a fabricated trend line —
 * no historical data is invented). Pulled straight from useAgentData()'s
 * shared queries (same numbers as the agent cards). A category with no
 * connected data source (e.g. finance on a workspace without the finance
 * module) shows a tasteful "—" rather than 0, so an honest "not connected"
 * never reads like "zero risk."
 */
export function WorkspaceGraphPulse() {
  const { pulse } = useAgentData();
  // Workspace-wide health ratio — share of all active tasks (not just
  // yours) that are NOT overdue. Kept distinct from the hero pills'
  // "assigned to you" counts so the two numbers never silently disagree.
  const healthPct = pulse.tasksOpen === 0 ? 100 : Math.round(((pulse.tasksOpen - pulse.tasksOverdue) / pulse.tasksOpen) * 100);
  // Scale each tile's ring relative to the largest connected value on the
  // board right now — a real relative-size cue, never a fake trend.
  const maxValue = Math.max(1, ...PULSE_CATEGORIES.map(c => pulse[c.key] ?? 0));

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace Graph Pulse</h2>
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>real-time, not historical</span>
      </div>
      {pulse.isLoading ? (
        <div className="skeleton-shimmer h-[140px] rounded-2xl"/>
      ) : (
        <div className="relative">
          {(() => {
            const tiles = [
              ...PULSE_CATEGORIES.map(({ key, label, icon, color }) => ({ label, icon, color, value: pulse[key] })),
              { label: "graph health", icon: CheckSquare, color: "#10b981", value: healthPct },
            ];
            const points = tiles.map((t, i) => {
              const pct = t.value != null ? Math.max(4, Math.round((t.value / maxValue) * 100)) : 0;
              return { x: (i / (tiles.length - 1)) * 100, y: 100 - pct, ...t };
            });
            const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            return (
              <>
                {/* Colorful connecting line across every metric's relative
                    value right now — a real snapshot profile across
                    categories, not a fabricated historical trend (no
                    time-series data exists yet to chart honestly). */}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-[70px] w-full">
                  <defs>
                    <linearGradient id="pulseLine" x1="0" y1="0" x2="100%" y2="0">
                      {points.map((p, i) => <stop key={i} offset={`${(i / (points.length - 1)) * 100}%`} stopColor={p.value != null ? p.color : "var(--text-faint)"}/>)}
                    </linearGradient>
                  </defs>
                  <path d={linePath} fill="none" stroke="url(#pulseLine)" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
                  {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={1.6} fill={p.value != null ? p.color : "var(--text-faint)"}/>
                  ))}
                </svg>

                <div className="grid grid-cols-4 gap-3 pt-[78px] sm:grid-cols-8">
                  {tiles.map((t, i) => {
                    const connected = t.value != null;
                    const tone = connected ? t.color : "var(--text-faint)";
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 text-center">
                        <t.icon size={14} style={{ color: tone }}/>
                        <p className="text-[18px] font-semibold leading-none" style={{ color: connected ? "var(--text-primary)" : "var(--text-faint)" }}>
                          {connected ? t.value : "—"}{t.label === "graph health" ? "%" : ""}
                        </p>
                        <p className="truncate text-[10px] leading-tight" style={{ color: "var(--text-faint)" }}>{t.label}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </section>
  );
}
