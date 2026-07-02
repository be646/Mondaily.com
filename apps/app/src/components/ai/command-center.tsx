import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert, CheckSquare, Activity, ArrowUpRight, Sparkles, FileText,
  UserPlus, Receipt, TrendingUp, Users, Database, Workflow, GitBranch, Layers, Clock,
  CheckCircle2, XCircle, ChevronDown, Loader2, Check, X, Radar,
} from "lucide-react";
import { useAgentData } from "./agent-dock";
import { agentById } from "../../lib/agents";
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
export function NeedsYouPanel({ notifications, notificationsError, onAskMondaily }: {
  notifications: NotificationLite[];
  notificationsError?: boolean;
  /** Called when the user wants to jump to Ask Mondaily — optional prefill text. */
  onAskMondaily?: (prefill?: string) => void;
}) {
  const { data: decisionsData, isLoading: decisionsLoading, isError: decisionsError } = useDecisionQueue();
  const decisions = decisionsData ?? [];
  // Home is a TRIAGE glance, not the full queue — show only the top few highest-risk decisions
  // inline; the complete list lives on the Decision Deck. (Expanding used to dump the whole queue.)
  const HOME_DECISION_CAP = 5;
  const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const topDecisions = [...decisions].sort((a, b) => (RISK_ORDER[a.risk_level] ?? 3) - (RISK_ORDER[b.risk_level] ?? 3)).slice(0, HOME_DECISION_CAP);
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) =>
      apiClient.post(`/decisions/${id}/${action}`, {}),
  });
  // Mission Deck verification loop, ported to Home: spinner in the clicked button →
  // glowing badge over the row → 600ms pause → cache invalidation slides it out.
  const [acting, setActing] = useState<{ id: string; action: string } | null>(null);
  const [banner, setBanner] = useState<{ id: string; kind: "approved" | "rejected" | "snoozed" } | null>(null);
  async function resolveDecision(id: string, action: "approve" | "reject" | "snooze") {
    if (acting) return;
    setActing({ id, action });
    try {
      await act.mutateAsync({ id, action });
      setBanner({ id, kind: action === "approve" ? "approved" : action === "reject" ? "rejected" : "snoozed" });
      await new Promise<void>(r => setTimeout(r, 600));
    } finally {
      setBanner(null);
      setActing(null);
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["agent-registry"] });
    }
  }

  const riskAlerts = notifications.filter(n => n.type === "ai_risk").slice(0, 3);

  // Agent activity blends real registry run history (GET /api/v1/agents —
  // agent_jobs-backed agents like Relationship/Finance/Graph Enrichment)
  // with notification-derived events, instead of reading notifications
  // alone. Anything without a real timestamp is excluded rather than
  // backfilled with "just now".
  const { constellation, isError: agentError } = useAgentData();
  const registryActivity = constellation
    .filter(a => a.lastRunAt)
    .map(a => ({ id: `agent-${a.id}`, agentName: agentById(a.id).name, icon: agentById(a.id).Icon, title: a.note, created_at: a.lastRunAt as string, type: "" }));
  const notificationActivity = notifications.slice(0, 5).map(n => ({ id: n.id, agentName: AGENT_LABEL[n.type] ?? "Workspace", icon: AGENT_ICON[n.type] ?? Receipt, title: n.title, created_at: n.created_at, type: n.type }));
  const recentActivity = [...registryActivity, ...notificationActivity]
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 4);

  // Discovery monitors — surface NEW leads found by the user's watched searches (re-run daily by
  // the agent) as an actionable line, tying the Discovery engine into Home. Real data: last_new is
  // the delta from each monitor's most recent run.
  const monitorsQ = useQuery({
    queryKey: ["discovery-monitors"],
    queryFn: () => apiClient.get<{ id: string; query: string; last_new?: number }[]>("/discovery/monitors"),
    staleTime: 120_000,
  });
  const monitorsWithNew = (monitorsQ.data ?? []).filter(m => (m.last_new ?? 0) > 0);
  const discoveryNew = monitorsWithNew.reduce((s, m) => s + (m.last_new ?? 0), 0);

  const stream: StreamItem[] = [
    ...riskAlerts.map(n => ({
      id: n.id, icon: ShieldAlert, agentLabel: "Signal Agent",
      title: n.title, meta: relTime(n.created_at), to: "/notifications", tone: "rose" as const,
    })),
    ...(discoveryNew > 0 ? [{
      id: "discovery-new", icon: Radar, agentLabel: "Discovery Agent",
      title: `${discoveryNew} new lead${discoveryNew === 1 ? "" : "s"} from ${monitorsWithNew.length === 1 ? `"${monitorsWithNew[0]!.query}"` : `${monitorsWithNew.length} watched searches`}`,
      meta: "since last run", to: "/discovery", tone: "violet" as const,
    }] : []),
    ...recentActivity.map(a => ({
      id: a.id, icon: a.icon, agentLabel: a.agentName,
      title: a.title, meta: relTime(a.created_at), to: "/notifications", tone: "default" as const,
    })),
  ].slice(0, 6);

  const TONE_COLOR: Record<StreamItem["tone"], string> = {
    violet: "var(--accent)", amber: "#d97706", rose: "#dc2626", blue: "#3b82f6", default: "var(--text-muted)",
  };

  const isLoading = decisionsLoading;
  const isEmpty = !isLoading && !decisionsError && decisions.length === 0 && stream.length === 0;
  const hasActivityError = decisionsError || notificationsError || agentError;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={13} style={{ color: "var(--text-muted)" }}/>
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Attention stream</h2>
          </div>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>Approvals and live agent findings.</p>
        </div>
        <div className="attention-count-strip">
          <strong>{decisions.length}</strong>
          <span>awaiting approval</span>
        </div>
      </div>

      <div className="attention-stream-shell">
        {isLoading ? (
          <div className="p-3"><div className="skeleton-shimmer h-12 rounded-sm"/></div>
        ) : hasActivityError ? (
          <div className="px-4 py-5">
            <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>Could not load activity</p>
            <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              {decisionsError ? "Decision Queue is unavailable. " : ""}
              {notificationsError ? "Recent notifications are unavailable. " : ""}
              {agentError ? "Agent status is unavailable." : ""}
            </p>
            {onAskMondaily && (
              <button onClick={() => onAskMondaily("Check what workspace activity is currently unavailable and what I can still act on.")} className="btn-suggested mt-3 !px-2.5 !py-1 !text-[11px]">
                Ask what still works
              </button>
            )}
          </div>
        ) : isEmpty ? (
          <div className="px-4 py-8 text-center">
            <div className="mx-auto mb-2.5 flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--surface-selected)" }}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: "var(--accent)" }}/>
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "var(--accent)" }}/>
              </span>
            </div>
            <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>Watching — nothing needs you right now</p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>Agents will queue a recommendation here the moment something does.</p>
            {onAskMondaily && (
              <button onClick={() => onAskMondaily("What changed in the workspace graph since I last checked?")} className="btn-suggested mt-2.5 !px-2.5 !py-1 !text-[11px]">
                Ask what changed
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Decisions — shown INLINE with actions always visible. No outer collapse toggle:
                an approvals inbox should never hide its approvals behind two clicks. The row's
                primary actions (Approve / Dismiss) act in one place; the chevron only reveals the
                supporting evidence, which is secondary. */}
            {!decisionsError && topDecisions.map(d => {
              const open = openId === d.id;
              const sources = mapEvidence(d.evidence ?? []);
              const act = acting?.id === d.id ? acting.action : null;
              const bnr = banner?.id === d.id ? banner.kind : null;
              const accent = d.risk_level === "high" ? "#dc2626" : d.risk_level === "medium" ? "#d97706" : "var(--text-muted)";
              return (
                <div key={d.id} className="relative border-b" style={{ borderColor: "var(--border-soft)" }}>
                  {bnr && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--surface-card) 72%, transparent)" }}>
                      <span className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold tracking-wide"
                        style={bnr === "approved"
                          ? { borderColor: "#10b981", color: "#10b981", background: "color-mix(in srgb, #10b981 12%, var(--surface-card))" }
                          : { borderColor: bnr === "rejected" ? "#ef4444" : "var(--text-faint)", color: bnr === "rejected" ? "#ef4444" : "var(--text-muted)", background: "var(--surface-card)" }}>
                        {bnr === "approved" ? <><CheckCircle2 size={12} /> Approved</> : bnr === "rejected" ? <><XCircle size={12} /> Dismissed</> : <><Clock size={12} /> Snoozed</>}
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-3 px-1 py-3 sm:px-2" style={{ borderLeft: `2px solid ${accent}` }}>
                    {d.risk_level === "high" ? <ShieldAlert size={14} className="mt-0.5 shrink-0 text-rose-500"/> : <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }}/>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{d.agent_name.replace(/_/g, " ")}</span> · {d.title}
                      </p>
                      {/* One-line summary is now visible immediately — no expand needed to read it */}
                      {d.summary && <p className="mt-0.5 line-clamp-1 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{d.summary}</p>}
                      <div className="mt-1 flex items-center gap-2 text-[10px]" style={{ color: "var(--text-faint)" }}>
                        <span className={RISK_STYLE[d.risk_level]}>{d.risk_level} risk</span>
                        {d.confidence != null && <><span aria-hidden>·</span><span>{d.confidence}% confidence</span></>}
                        {sources.length > 0 && (
                          <button onClick={() => setOpenId(open ? null : d.id)} className="inline-flex items-center gap-0.5 transition-colors hover:text-[var(--text-secondary)]">
                            <span aria-hidden>·</span> {sources.length} source{sources.length === 1 ? "" : "s"}
                            <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
                          </button>
                        )}
                      </div>
                      {open && sources.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {d.recommended_action && <p className="text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>→ {d.recommended_action}</p>}
                          <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s}/>)}</div>
                        </div>
                      )}
                    </div>
                    {/* Actions — ALWAYS visible; act in one click */}
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => resolveDecision(d.id, "approve")} disabled={!!act} title="Approve"
                        className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: "#10b981" }}>
                        {act === "approve" ? <Loader2 size={11} className="animate-spin"/> : <Check size={11}/>}<span className="hidden sm:inline">Approve</span>
                      </button>
                      <button onClick={() => resolveDecision(d.id, "reject")} disabled={!!act} title="Dismiss"
                        className="flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50" style={{ border: "1px solid var(--border-soft)", color: "var(--text-muted)" }}>
                        {act === "reject" ? <Loader2 size={11} className="animate-spin"/> : <X size={12}/>}
                      </button>
                      <button onClick={() => resolveDecision(d.id, "snooze")} disabled={!!act} title="Snooze"
                        className="flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50" style={{ color: "var(--text-faint)" }}>
                        {act === "snooze" ? <Loader2 size={11} className="animate-spin"/> : <Clock size={12}/>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {decisions.length > HOME_DECISION_CAP && (
              <Link to="/decisions" className="flex items-center justify-center gap-1 px-3 py-2.5 text-[11.5px] font-medium transition-colors hover:opacity-80" style={{ color: "var(--section-accent)" }}>
                View all {decisions.length} in the Decision Deck <ArrowUpRight size={12} />
              </Link>
            )}
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
          </div>
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
  { key: "tasksOpen",      label: "active tasks",        icon: CheckSquare, color: "var(--accent)" },
  { key: "tasksOverdue",   label: "overdue tasks",        icon: Clock,       color: "#dc2626" },
  { key: "relationships",  label: "relationship records", icon: Users,       color: "#d97706" },
  { key: "financeOverdue", label: "overdue invoices",     icon: Receipt,     color: "#0891b2" },
  { key: "records",        label: "total records",        icon: Database,   color: "#059669" },
  { key: "workflows",      label: "workflow records",      icon: Workflow,   color: "var(--accent)" },
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
  // REAL 14-day trends (daily creation counts from actual created_at data) — replaces the old
  // decorative "curve rising to current level" with genuine history per tile where one exists.
  const trendsQ = useQuery({
    queryKey: ["pulse-trends"],
    queryFn: () => apiClient.get<{ days: string[]; series: Record<string, number[]> }>("/activities/trends"),
    staleTime: 120_000,
  });
  const series = trendsQ.data?.series ?? {};
  // Workspace-wide health ratio — share of all active tasks (not just
  // yours) that are NOT overdue. Kept distinct from the hero pills'
  // "assigned to you" counts so the two numbers never silently disagree.
  const healthPct = pulse.tasksOpen === 0 ? 100 : Math.round(((pulse.tasksOpen - pulse.tasksOverdue) / pulse.tasksOpen) * 100);
  // Scale each tile's ring relative to the largest connected value on the
  // board right now — a real relative-size cue, never a fake trend.
  const maxValue = Math.max(1, ...PULSE_CATEGORIES.map(c => pulse[c.key] ?? 0));
  // Build a REAL polyline from a tile's 14-day series. Returns null when no series exists for the
  // tile (state-like metrics such as "overdue right now" have no creation history).
  const trendPath = (key: string): string | null => {
    const s = series[key];
    if (!s || s.length < 2) return null;
    const max = Math.max(...s, 1);
    return s.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (s.length - 1)) * 100).toFixed(1)},${(26 - (v / max) * 20).toFixed(1)}`).join(" ");
  };

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
        <div className="skeleton-shimmer h-[140px] rounded-sm"/>
      ) : pulse.isError ? (
        <div className="surface-card rounded-sm px-4 py-8 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Could not load agent status</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>Workspace graph counts did not return from the API.</p>
        </div>
      ) : (
        <div className="workspace-pulse-grid grid grid-cols-2 sm:grid-cols-4">
          {[
            { key: "", label: "graph health", icon: CheckSquare, color: "#10b981", value: healthPct, suffix: "%" },
            ...PULSE_CATEGORIES.map(({ key, label, icon, color }) => ({ key: key as string, label, icon, color, value: pulse[key], suffix: "" })),
          ].map((t, i) => {
            const connected = t.value != null;
            const pct = connected ? Math.max(6, Math.round((t.value! / (t.label === "graph health" ? 100 : maxValue)) * 100)) : 0;
            const tone = connected ? t.color : "var(--text-faint)";
            // Prefer the REAL 14-day trend (daily creation counts from created_at) when this metric
            // has one; state-only metrics (e.g. "overdue right now") fall back to a level indicator.
            const real = connected ? trendPath(t.key) : null;
            const endY = 26 - (pct / 100) * 20;
            return (
              <div key={i} className="pulse-tile flex flex-col gap-1.5 px-3 py-3">
                <div className="flex items-center gap-1.5">
                  <t.icon size={12} style={{ color: tone }}/>
                  <span className="truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>{t.label}</span>
                  {real && <span className="ml-auto text-[8.5px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>14d</span>}
                </div>
                <p className="text-[20px] font-semibold leading-none" style={{ color: connected ? "var(--text-primary)" : "var(--text-faint)" }}>
                  {connected ? t.value : "—"}{t.suffix}
                </p>
                <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-[18px] w-full">
                  {real ? (
                    <path d={real} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
                  ) : (
                    <>
                      <path d={`M0,26 C30,26 50,${endY} 100,${endY}`} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={connected ? 1 : 0.4}/>
                      <circle cx={100} cy={endY} r={2.2} fill={tone} opacity={connected ? 1 : 0.4}/>
                    </>
                  )}
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
