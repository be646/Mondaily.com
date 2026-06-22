import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert, CheckSquare, Activity, ArrowUpRight, Sparkles, FileText,
  UserPlus, Receipt, TrendingUp, Users, Database, Workflow, GitBranch, Layers, Clock,
  CheckCircle2, XCircle, ChevronDown,
} from "lucide-react";
import { useAgentData } from "./agent-dock";
import { useDecisionQueue, mapEvidence, RISK_STYLE } from "./decision-queue";
import { apiClient } from "../../lib/api-client";
import { SourceCard } from "./ask-shared";

/**
 * Home "What needs attention" stream — one connected feed (real
 * recommendations, approvals, risk signals, and recent graph changes),
 * each row tagged with the agent that produced it. Every number comes
 * from data already fetched on the home page or from useAgentData —
 * nothing fabricated, no invented confidence scores or fake trend lines.
 * Deliberately a stream of rows, not a grid of separate dashboard cards.
 */

interface NotificationLite { id: string; type: string; is_read: boolean; title: string; body?: string; created_at?: string; }

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

/**
 * NeedsYouPanel — the merged "what needs you" zone: real Decision Queue
 * items (with the real approve/reject/snooze actions) plus risk signals
 * and recent agent activity, as one ranked list instead of two separate
 * sections doing overlapping jobs. Decisions already cover overdue/review
 * tasks (the Operations Agent writes a real decision_queue row for those),
 * so this no longer duplicates that as a second synthetic summary row.
 */
export function NeedsYouPanel({ notifications, onAskMondaily }: {
  notifications: NotificationLite[];
  /** Called when the user wants to jump to Ask Mondaily — optional prefill text. */
  onAskMondaily?: (prefill?: string) => void;
}) {
  const { data: decisionsData, isLoading: decisionsLoading, isError: decisionsError } = useDecisionQueue();
  const decisions = decisionsData ?? [];
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) =>
      apiClient.post(`/decisions/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions"] }),
  });

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
    .slice(0, 4);

  const stream: StreamItem[] = [
    ...riskAlerts.map(n => ({
      id: n.id, icon: ShieldAlert, agentLabel: "Signal Agent",
      title: n.title, meta: relTime(n.created_at), to: "/notifications", tone: "rose" as const,
    })),
    ...recentActivity.map(a => ({
      id: a.id, icon: a.fromRegistry ? Workflow : (AGENT_ICON[a.type] ?? Receipt), agentLabel: a.agentName,
      title: a.title, meta: relTime(a.created_at), to: "/notifications", tone: "default" as const,
    })),
  ].slice(0, 6);

  const TONE_COLOR: Record<StreamItem["tone"], string> = {
    violet: "#8b5cf6", amber: "#d97706", rose: "#dc2626", blue: "#3b82f6", default: "var(--text-muted)",
  };

  const isLoading = decisionsLoading;
  const isEmpty = !isLoading && decisions.length === 0 && stream.length === 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Needs you</h2>
          {decisions.length > 0 && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{decisions.length} awaiting approval</span>}
        </div>
        {onAskMondaily && (
          <button onClick={() => onAskMondaily()} className="btn-ai !px-2.5 !py-1 !text-[11px]">
            <Sparkles size={10}/> Ask Mondaily
          </button>
        )}
      </div>

      <div className="surface-card rounded-2xl">
        {isLoading ? (
          <div className="p-3"><div className="skeleton-shimmer h-12 rounded-xl"/></div>
        ) : isEmpty ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12.5px]" style={{ color: "var(--text-faint)" }}>Nothing needs you right now — agents will queue a recommendation here when they find something.</p>
            {onAskMondaily && (
              <button onClick={() => onAskMondaily("What changed in the workspace graph since I last checked?")} className="btn-suggested mt-2.5 !px-2.5 !py-1 !text-[11px]">
                Ask what changed
              </button>
            )}
          </div>
        ) : (
          <>
            {!decisionsError && decisions.map(d => {
              const open = openId === d.id;
              const sources = mapEvidence(d.evidence ?? []);
              return (
                <div key={d.id} className="border-b" style={{ borderColor: "var(--border-soft)" }}>
                  <button onClick={() => setOpenId(open ? null : d.id)} className="stream-row w-full text-left" style={{ borderLeft: `2px solid ${d.risk_level === "high" ? "#dc2626" : "#d97706"}` }}>
                    {d.risk_level === "high" ? <ShieldAlert size={13} className="mt-0.5 shrink-0 text-rose-500"/> : <Clock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }}/>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{d.agent_name.replace(/_/g, " ")}</span> · {d.title}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-faint)" }}><span className={RISK_STYLE[d.risk_level]}>{d.risk_level} risk</span> · awaiting approval</p>
                    </div>
                    <ChevronDown size={12} className={`mt-0.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }}/>
                  </button>
                  {open && (
                    <div className="px-3.5 pb-3 pl-9 space-y-2">
                      {d.summary && <p className="text-[12px] leading-snug" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>}
                      {d.recommended_action && <p className="text-[11.5px] font-medium" style={{ color: "var(--accent)" }}>→ {d.recommended_action}</p>}
                      <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>{d.confidence != null ? `${d.confidence}% confidence` : "Source-backed"}</p>
                      {sources.length > 0 && <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s}/>)}</div>}
                      <div className="flex items-center gap-1.5 pt-1">
                        <button onClick={() => act.mutate({ id: d.id, action: "approve" })} disabled={act.isPending}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white transition-colors disabled:opacity-50" style={{ background: "#10b981" }}>
                          <CheckCircle2 size={11}/> Approve
                        </button>
                        <button onClick={() => act.mutate({ id: d.id, action: "reject" })} disabled={act.isPending}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                          <XCircle size={11}/> Reject
                        </button>
                        <button onClick={() => act.mutate({ id: d.id, action: "snooze" })} disabled={act.isPending}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ color: "var(--text-faint)" }}>
                          <Clock size={11}/> Snooze
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {stream.map(item => (
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
            ))}
          </>
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
