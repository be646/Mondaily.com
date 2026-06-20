import { Link } from "react-router-dom";
import { ShieldAlert, CheckSquare, Activity, Gauge, ArrowUpRight, Sparkles, FileText, UserPlus, Receipt } from "lucide-react";

/**
 * Home "AI Command Center" strip — Risks detected, Decisions waiting, Agent
 * activity, Workspace health. Every number here comes from real data passed
 * in by the caller (tasks + notifications already fetched on the home page)
 * — nothing fabricated, no invented confidence scores.
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
  ai_risk: "Insights Agent",
  agent: "Enrichment Agent",
  task_review: "Task Agent",
  approval: "Approvals",
  assignment: "Task Agent",
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

export function CommandCenterStrip({ tasks, notifications }: { tasks: TaskLite[]; notifications: NotificationLite[] }) {
  const now = Date.now();
  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date).getTime() < now);
  const reviewTasks = tasks.filter(t => !t.completed && t.status === "review");
  const activeTasks = tasks.filter(t => !t.completed);
  const riskAlerts = notifications.filter(n => n.type === "ai_risk").slice(0, 3);
  const decisionsCount = overdueTasks.length + reviewTasks.length;

  // Workspace health: simple, honest ratio — share of active tasks that are NOT overdue.
  const healthPct = activeTasks.length === 0 ? 100 : Math.round(((activeTasks.length - overdueTasks.length) / activeTasks.length) * 100);

  const activity = notifications.slice(0, 6);

  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Risks detected */}
      <div className="surface-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert size={14} className="text-amber-600 dark:text-amber-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Risks detected</span>
        </div>
        {riskAlerts.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No active risk alerts.</p>
        ) : (
          <ul className="space-y-1">
            {riskAlerts.map(r => (
              <li key={r.id} className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>{r.title}</li>
            ))}
          </ul>
        )}
        <Link to="/notifications" className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:opacity-80">
          View all <ArrowUpRight size={11}/>
        </Link>
      </div>

      {/* Decisions waiting */}
      <div className="surface-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <CheckSquare size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Decisions waiting</span>
        </div>
        <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{decisionsCount}</p>
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {overdueTasks.length} overdue · {reviewTasks.length} in review
        </p>
        <Link to="/tasks" className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:opacity-80">
          Review tasks <ArrowUpRight size={11}/>
        </Link>
      </div>

      {/* Workspace health */}
      <div className="surface-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-2">
          <Gauge size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace health</span>
        </div>
        <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{healthPct}%</p>
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {activeTasks.length - overdueTasks.length} of {activeTasks.length} active tasks on track
        </p>
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-hover)" }}>
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${healthPct}%` }}/>
        </div>
      </div>

      {/* Agent activity stream */}
      <div className="surface-card rounded-xl p-4 sm:col-span-2 lg:col-span-1">
        <div className="mb-2 flex items-center gap-2">
          <Activity size={14} className="text-violet-600 dark:text-violet-400 shrink-0"/>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent activity</span>
        </div>
        {activity.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No recent agent activity.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map(n => {
              const Icon = AGENT_ICON[n.type] ?? Receipt;
              return (
                <li key={n.id} className="flex items-start gap-2">
                  <Icon size={12} className="mt-0.5 shrink-0 text-violet-500 dark:text-violet-400"/>
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>{AGENT_LABEL[n.type] ?? "Workspace"}</span> · {n.title}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>{relTime(n.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
