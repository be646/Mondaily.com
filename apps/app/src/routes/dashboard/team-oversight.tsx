import { Fragment, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Lock, ArrowLeft, Loader2, User as UserIcon, ShieldCheck, MessageSquare, Users, ChevronRight, History, Sparkles, Send, Phone, Video, Printer } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestCall } from "../../lib/call-bus";
import { FieldSelect, LiveSectionHeader } from "../../components/ui/controls";

/**
 * Team Intelligence — an AI-powered team behaviour & value dashboard for owners/admins.
 * REAL data only:
 *   • /activities/oversight-matrix       — per-operator tokens/runs/tasks/last-active/verdict
 *   • /activities/oversight?actor=        — that member's real activity timeline
 *   • /activities/member-insight (POST)   — grounded, no-tools AI summary (never leaks planning,
 *                                           never invents; honest "not enough activity" when thin)
 * Master–detail IN-PAGE layout (no side drawer): the ledger stays visible on the left, the
 * selected member's dossier fills the right column. Selection is mirrored to `?member=`.
 */
type Verdict = "inactive" | "bot" | "low_engagement" | "high_complexity" | "engaged" | "idle";
type SignalLevel = "good" | "watch" | "risk" | "insufficient";
interface QualitySignal { key: string; label: string; level: SignalLevel; basis: string }
interface EvalLabel { label: string; tone: "good" | "watch" | "risk" | "neutral"; basis: string }
interface TrendPoint { date: string; value: number }
interface Operator {
  operator_id: string; name: string; email: string | null; avatar_url: string | null; role: string;
  tokens: number; runs: number; task_count: number; complexity_delta: number;
  records_touched?: number; open_tasks?: number; overdue_tasks?: number; completed_tasks?: number;
  messages_sent?: number; decisions_resolved?: number; quality?: QualitySignal[];
  deals_owned?: number; deals_won?: number; deals_lost?: number; deals_open?: number; deals_updated?: number;
  evaluation?: EvalLabel;
  last_task_id: string | null; last_action: string | null; last_active_at: string | null;
  has_session: boolean; verified_pow: boolean; verdict: Verdict;
}

const SIGNAL_TONE: Record<SignalLevel, string> = {
  good: "#5f8169", watch: "#97824f", risk: "#9c6b72", insufficient: "var(--text-faint)",
};
const EVAL_TONE: Record<EvalLabel["tone"], string> = {
  good: "#5f8169", watch: "#97824f", risk: "#9c6b72", neutral: "var(--text-faint)",
};
interface MatrixResp { operators: Operator[]; trends?: { activity: TrendPoint[]; ai_usage: TrendPoint[]; decisions: TrendPoint[]; tasks_completed?: TrendPoint[] }; totals: { operators: number; tokens: number; active_sessions: number } }
interface ActivityRow { id: string; action: string; ai_summary: string | null; object: { type: string; name: string | null; node_id?: string | null } | null; changes?: { field: string; value: string }[]; created_at: string }

// Group a member's timeline into the same lenses used across Oversight.
type TimelineGroup = "Tasks" | "Records & deals" | "Decisions" | "Messages" | "AI actions" | "Other";
function timelineGroupOf(a: ActivityRow): TimelineGroup {
  const t = (a.object?.type ?? "").toLowerCase();
  const act = (a.action ?? "").toLowerCase();
  if (t.includes("task") || act.includes("task")) return "Tasks";
  if (t.includes("deal") || t.includes("opportunit") || t.includes("company") || t.includes("contact") || t.includes("lead") || t.includes("person") || t.includes("record")) return "Records & deals";
  if (t.includes("decision") || act.includes("approve") || act.includes("reject") || act.includes("decision")) return "Decisions";
  if (t.includes("message") || act.includes("message")) return "Messages";
  if (act.includes("enrich") || act.includes("ai") || act.includes("summar")) return "AI actions";
  return "Other";
}
const TIMELINE_ORDER: TimelineGroup[] = ["Tasks", "Records & deals", "Decisions", "Messages", "AI actions", "Other"];
interface InsightResp { insight: string; sources: { type: string; title: string; timestamp: string }[]; sufficient: boolean }
type EffRating = "strong" | "steady" | "needs_support" | "insufficient";
interface EfficiencyResp { sufficient: boolean; rating: EffRating; assessment: string; strengths: string[]; improvements: string[]; coaching_message: string; metrics?: { completion_rate: number; completed: number; overdue: number; active_days: number; decisions: number } }
const EFF_LABEL: Record<EffRating, { label: string; tone: string }> = {
  strong:        { label: "Strong",        tone: "#5f8169" },
  steady:        { label: "Steady",        tone: "var(--section-accent)" },
  needs_support: { label: "Needs support", tone: "#97824f" },
  insufficient:  { label: "Not enough data", tone: "var(--text-faint)" },
};

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  engaged:         { label: "Engaged",        tone: "#5f8169" },
  high_complexity: { label: "Deep work",      tone: "#5f8169" },
  bot:             { label: "Power user",     tone: "#5f8169" },
  low_engagement:  { label: "Low engagement", tone: "#97824f" },
  inactive:        { label: "Inactive",       tone: "#97824f" },
  idle:            { label: "Standby",        tone: "var(--text-faint)" },
};

const fmt = (n: number) => n.toLocaleString();
const exactTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
function ago(iso: string | null) {
  if (!iso) return "no activity";
  const d = new Date(iso); if (isNaN(d.getTime())) return "no activity";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const activeToday = (iso: string | null) => !!iso && (Date.now() - new Date(iso).getTime()) < 86_400_000;

/** Honest, data-derived behaviour signals — only shown when the real metrics support them. */
function insights(op: Operator): string[] {
  const out: string[] = [];
  const days = op.last_active_at ? Math.floor((Date.now() - new Date(op.last_active_at).getTime()) / 86_400_000) : null;
  if (op.tokens === 0 && op.task_count === 0) return ["Not enough data yet — no recorded activity or AI usage in the last 30 days."];
  if (days != null && days >= 7) out.push(`Hasn't acted in ${days} days — may be disengaged or away.`);
  if (op.tokens > 50_000 && op.task_count <= 2) out.push("Uses substantial AI credits but has completed few tracked tasks — output-to-compute ratio is low.");
  if (op.complexity_delta > 8_000 && op.task_count > 0) out.push("High compute per task — strategic, deep-work interaction pattern.");
  if (op.task_count >= 5 && op.complexity_delta < 500) out.push("Many tasks with minimal compute each — fast, shallow interaction pattern.");
  if (op.tokens > 0 && op.task_count === 0) out.push("AI usage recorded without completed task rows — check whether work is landing as records.");
  if (op.has_session && op.task_count > 0 && out.length === 0) out.push("Actively transacting at a healthy compute-to-work ratio.");
  if (out.length === 0) out.push("No notable behaviour signals — activity is within normal ranges.");
  return out;
}

function Avatar({ op, size = 30 }: { op: Operator; size?: number }) {
  if (op.avatar_url) return <img src={op.avatar_url} alt={op.name} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />;
  const initial = op.name?.trim()?.[0]?.toUpperCase();
  return (
    <span style={{ width: size, height: size, background: "var(--surface-hover)", color: "var(--text-secondary)" }}
      className="flex shrink-0 items-center justify-center rounded-full text-[12px] font-semibold">
      {initial || <UserIcon size={14} />}
    </span>
  );
}

/** One ledger-style distribution: a labeled horizontal bar per member, sorted desc, real values. */
function MetricBars({ title, hint, operators, value, tone, onSelect }: {
  title: string; hint: string; operators: Operator[]; value: (o: Operator) => number; tone: string; onSelect: (id: string) => void;
}) {
  const rows = operators.map(o => ({ o, v: value(o) })).filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
  const max = rows.reduce((m, r) => Math.max(m, r.v), 0) || 1;
  return (
    <div className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="mb-0.5 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</div>
      <div className="mb-2.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{hint}</div>
      {rows.length === 0 ? (
        <div className="py-3 text-[11.5px]" style={{ color: "var(--text-faint)" }}>No data yet.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map(({ o, v }) => (
            <button key={o.operator_id} onClick={() => onSelect(o.operator_id)} className="group grid w-full grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-left">
              <span className="truncate text-[11.5px]" style={{ color: "var(--text-secondary)" }}>{o.name}</span>
              <span className="h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                <span className="block h-full rounded-full transition-all" style={{ width: `${Math.max(4, (v / max) * 100)}%`, background: tone }} />
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{fmt(v)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Team-level distributions built entirely from the real oversight-matrix operators array. */
function TeamCharts({ operators, onSelect }: { operators: Operator[]; onSelect: (id: string) => void }) {
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricBars title="Workload" hint="Open tasks assigned" operators={operators} tone="var(--section-accent)" onSelect={onSelect} value={(o) => (o.open_tasks ?? 0) + (o.overdue_tasks ?? 0)} />
      <MetricBars title="Overdue work" hint="Overdue tasks by member" operators={operators} tone="#9c6b72" onSelect={onSelect} value={(o) => o.overdue_tasks ?? 0} />
      <MetricBars title="Decisions resolved" hint="Approvals/rejections (30d)" operators={operators} tone="#5f8169" onSelect={onSelect} value={(o) => o.decisions_resolved ?? 0} />
      <MetricBars title="AI usage" hint="Credits spent (30d)" operators={operators} tone="var(--section-accent)" onSelect={onSelect} value={(o) => o.tokens} />
    </div>
  );
}

/** Minimal, dependency-free SVG sparkline for a 30-day trend (premium ledger style). */
function Sparkline({ points, tone }: { points: TrendPoint[]; tone: string }) {
  if (!points || points.length === 0) return null;
  const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1;
  const W = 100, H = 28;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const coords = points.map((p, i) => `${(i * step).toFixed(2)},${(H - (p.value / max) * (H - 2) - 1).toFixed(2)}`);
  const total = points.reduce((s, p) => s + p.value, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label={`trend total ${total}`}>
      <polyline points={coords.join(" ")} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Unified overview tiles — each metric shows its number + an inline sparkline in one seamless
 *  grid (the Home tile+chart pattern), replacing the old separate stat-band + chart-card rows. */
function OverviewTiles({ trends, periodLabel }: { trends: NonNullable<MatrixResp["trends"]>; periodLabel: string }) {
  const tiles: { label: string; tone: string; pts: TrendPoint[] }[] = [
    { label: "Activity", tone: "var(--section-accent)", pts: trends.activity ?? [] },
    { label: "Tasks completed", tone: "#5f8169", pts: trends.tasks_completed ?? [] },
    { label: "AI credits", tone: "#97824f", pts: trends.ai_usage ?? [] },
    { label: "Decisions", tone: "#7b6fb0", pts: trends.decisions ?? [] },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-sm border xl:grid-cols-4" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
      {tiles.map((t) => {
        const total = t.pts.reduce((s, p) => s + p.value, 0);
        return (
          <div key={t.label} className="flex flex-col px-4 py-3.5" style={{ background: "var(--surface-card)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{t.label}</span>
              <span className="text-[9.5px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{periodLabel}</span>
            </div>
            <div className="mt-2 text-[23px] font-semibold leading-none tabular-nums" style={{ color: "var(--text-primary)" }}>{fmt(total)}</div>
            <div className="mt-2.5 h-8">{total === 0 ? <div className="pt-2 text-[10.5px]" style={{ color: "var(--text-faint)" }}>—</div> : <Sparkline points={t.pts} tone={t.tone} />}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Full-width team roster — a real leaderboard table (Member · Tasks · Records · Decisions · AI
 *  credits bar · verdict), sorted, dense, scannable. Click a row to open that member's profile. */
const ROSTER_COLS = "grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.6fr)_4rem_4.5rem_5rem_minmax(96px,1fr)_1.25rem]";
function RosterTable({ operators, selectedId, onSelect, detailFor }: { operators: Operator[]; selectedId: string | null; onSelect: (id: string | null) => void; detailFor: (op: Operator) => React.ReactNode }) {
  const maxTokens = Math.max(1, ...operators.map(o => o.tokens));
  return (
    <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className={`hidden items-center gap-3 border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wide sm:grid ${ROSTER_COLS}`} style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
        <span>Member</span>
        <span className="text-right">Tasks</span>
        <span className="text-right">Records</span>
        <span className="text-right">Decisions</span>
        <span>AI credits</span>
        <span />
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
        {operators.map((op) => {
          const v = VERDICT[op.verdict];
          const isSel = op.operator_id === selectedId;
          return (
            <Fragment key={op.operator_id}>
            <button onClick={() => onSelect(isSel ? null : op.operator_id)}
              className={`grid w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] ${ROSTER_COLS}`}
              style={{ background: isSel ? "var(--surface-selected)" : undefined }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar op={op} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{op.name}</span>
                    {activeToday(op.last_active_at) && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#5f8169" }} title="active today" />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                    <span className="capitalize">{op.role}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-medium" style={{ borderColor: `${v.tone}33`, background: `${v.tone}14`, color: v.tone }}>{v.label}</span>
                  </div>
                </div>
              </div>
              <span className="hidden text-right text-[12.5px] tabular-nums sm:block" style={{ color: "var(--text-secondary)" }}>{fmt(op.task_count)}</span>
              <span className="hidden text-right text-[12.5px] tabular-nums sm:block" style={{ color: "var(--text-secondary)" }}>{fmt(op.records_touched ?? 0)}</span>
              <span className="hidden text-right text-[12.5px] tabular-nums sm:block" style={{ color: "var(--text-secondary)" }}>{fmt(op.decisions_resolved ?? 0)}</span>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (op.tokens / maxTokens) * 100)}%`, background: "var(--section-accent)" }} />
                </span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{fmt(op.tokens)}</span>
              </div>
              <ChevronRight size={14} className="shrink-0 justify-self-end transition-transform" style={{ color: isSel ? "var(--section-accent)" : "var(--text-faint)", transform: isSel ? "rotate(90deg)" : undefined }} />
            </button>
            {isSel && (
              <div className="border-t px-2.5 py-2.5" style={{ borderColor: "var(--section-accent-line)", background: "var(--surface-hover)" }}>
                {detailFor(op)}
              </div>
            )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

interface AskResp { answer: string; sources: { type: string; title: string }[]; sufficient: boolean }
/** Grounded Ask-AI over real team data — a SLIM single-line ask bar (pinned under the header). The
 *  answer + its exact source lines expand below only after you ask. */
function OversightAsk() {
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: (question: string) => apiClient.post<AskResp>("/activities/oversight-ask", { question }) });
  const suggestions = ["Who has the most overdue work?", "Who is contributing to decisions?", "How is deal ownership spread across the team?"];
  return (
    <div className="mb-5">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask.mutate(q.trim()); }}
        className="flex items-center gap-2 rounded-sm border px-3 py-1.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <Sparkles size={14} className="shrink-0" style={{ color: "var(--section-accent)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your team — grounded in real data, no guesses…"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)" }} />
        <button type="submit" disabled={ask.isPending || !q.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
          style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}>
          {ask.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Ask
        </button>
      </form>
      {!ask.data && !ask.isPending && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => { setQ(s); ask.mutate(s); }}
              className="rounded-full border px-2.5 py-0.5 text-[10.5px] transition-colors hover:text-[var(--text-primary)]"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{s}</button>
          ))}
        </div>
      )}
      {(ask.data || ask.isPending) && (
        <div className="mt-2 rounded-sm border px-3.5 py-3" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
          {ask.isPending ? (
            <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Reading real team data…</div>
          ) : ask.data ? (
            <>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{ask.data.answer}</p>
              {ask.data.sufficient && ask.data.sources.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10.5px]" style={{ color: "var(--text-faint)" }}>Based on {ask.data.sources.length} member metric line(s)</summary>
                  <div className="mt-1.5 space-y-1">
                    {ask.data.sources.map((s, i) => <p key={i} className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>• {s.title}</p>)}
                  </div>
                </details>
              )}
              {!ask.data.sufficient && <p className="mt-1 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Not enough tracked data to answer — nothing was invented.</p>}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function TeamOversightPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("member");
  const [days, setDays] = useState(30);   // period filter — every metric recomputes for this window

  const { data, isLoading, isError, error } = useQuery<MatrixResp>({
    queryKey: ["oversight-matrix", days],
    queryFn: () => apiClient.get<MatrixResp>(`/activities/oversight-matrix?days=${days}`),
    refetchInterval: 30_000,
    retry: false,
  });
  const forbidden = isError && /\b403\b|forbidden/i.test(String((error as Error | null)?.message ?? ""));

  const operators = useMemo(() => (Array.isArray(data?.operators) ? data!.operators : []), [data]);
  const totals = data?.totals;
  const activeTodayCount = operators.filter(o => activeToday(o.last_active_at)).length;
  const totalTasks = operators.reduce((s, o) => s + o.task_count, 0);
  const selected = operators.find(o => o.operator_id === selectedId) ?? null;

  const select = (id: string | null) => setParams(id ? { member: id } : {}, { replace: true });

  if (forbidden) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--surface-hover)" }}>
          <Lock size={20} style={{ color: "var(--section-accent)" }} />
        </span>
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Owner access only</h1>
        <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Team Intelligence shows every member's real activity and AI usage. Only owners and admins can view it.
        </p>
        <button onClick={() => navigate("/home")} className="mt-5 inline-flex items-center gap-1.5 rounded-sm border px-3.5 py-2 text-[13px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <ArrowLeft size={14} /> Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* ── Thin, LIVE section header (shared primitive) ── */}
      <LiveSectionHeader icon={ShieldCheck} title="Team Intelligence" kicker="signal engine" liveLabel="Live · real activity" />

      {/* ── Slim AI ask bar, pinned right under the header ── */}
      {operators.length > 0 && <OversightAsk />}

      {/* ── One compact summary line + period filter ── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
          <span className="inline-flex items-center gap-1.5"><Users size={13} style={{ color: "var(--text-faint)" }} /><strong className="tabular-nums" style={{ color: "var(--text-primary)" }}>{totals?.operators ?? operators.length}</strong> member{(totals?.operators ?? operators.length) === 1 ? "" : "s"}</span>
          <span><strong className="tabular-nums" style={{ color: "#5f8169" }}>{activeTodayCount}</strong> active today</span>
          <span><strong className="tabular-nums" style={{ color: "var(--text-primary)" }}>{fmt(totalTasks)}</strong> tasks</span>
          <span><strong className="tabular-nums" style={{ color: "var(--text-primary)" }}>{totals ? fmt(totals.tokens) : "—"}</strong> AI credits</span>
        </div>
        <div className="w-40 shrink-0">
          <FieldSelect value={String(days)} onChange={v => setDays(Number(v) || 30)} ariaLabel="Period"
            options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }]} />
        </div>
      </div>

      {/* ── Unified overview tiles — number + inline sparkline, Home-style ── */}
      {data?.trends && <OverviewTiles trends={data.trends} periodLabel={`${days}d`} />}

      {/* ── Team distributions — only meaningful with 2+ members (hidden for a solo workspace) ── */}
      {operators.length > 1 && <TeamCharts operators={operators} onSelect={select} />}

      {/* ── Full-width roster table ── */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Members</h2>
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{totals?.active_sessions ?? 0} live now</span>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-16 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin" /> Loading team activity…</div>
      ) : operators.length === 0 ? (
        <div className="rounded-sm border px-5 py-14 text-center" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          <Users size={20} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
          <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>No members yet</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Activity and AI usage appear here as members work. <Link to="/settings/members" className="font-medium hover:underline" style={{ color: "var(--section-accent)" }}>Invite members</Link>.</p>
        </div>
      ) : (
        <RosterTable operators={operators} selectedId={selectedId} onSelect={select}
          detailFor={(op) => <MemberDetail op={op} />} />
      )}
    </div>
  );
}


/** In-page member dossier — identity, metrics, AI behaviour, activity chart + timeline, actions. */
function MemberDetail({ op }: { op: Operator }) {
  const navigate = useNavigate();
  const v = VERDICT[op.verdict];
  const scope = `${op.name}${op.email ? ` (${op.email})` : ""}`;

  const timelineQ = useQuery<{ activity: ActivityRow[] }>({
    queryKey: ["oversight-actor", op.operator_id],
    queryFn: () => apiClient.get<{ activity: ActivityRow[] }>(`/activities/oversight?actor=${encodeURIComponent(op.operator_id)}&limit=100`),
    retry: false,
  });
  const timeline = useMemo(() => (Array.isArray(timelineQ.data?.activity) ? timelineQ.data!.activity : []), [timelineQ.data]);

  // Is live calling configured on this deployment? (fail-closed → buttons hidden if not)
  const callCap = useQuery<{ enabled: boolean; recording?: boolean }>({
    queryKey: ["call-capability"],
    queryFn: () => apiClient.get<{ enabled: boolean }>("/live-calls/capability"),
    staleTime: 10 * 60_000,
  });

  // Grounded, no-tools AI coaching summary — auto-runs once per member, cached by React Query.
  const insightQ = useQuery<InsightResp>({
    queryKey: ["member-insight", op.operator_id],
    queryFn: () => apiClient.post<InsightResp>("/activities/member-insight", { actor_id: op.operator_id }),
    retry: false,
    staleTime: 5 * 60_000,
  });

  // On-demand AI work-efficiency review — generated when the manager asks for it (structured,
  // grounded, with strengths / improvements / a coaching message they can send).
  const efficiency = useMutation<EfficiencyResp>({ mutationFn: () => apiClient.post<EfficiencyResp>("/activities/member-efficiency", { actor_id: op.operator_id }) });
  const [copied, setCopied] = useState(false);

  // Activity-over-time — last 14 days bucketed from the REAL timeline (no fabricated hours).
  const chart = useMemo(() => {
    const days: { key: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) days.push({ key: new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), count: 0 });
    const idx = new Map(days.map((d, i) => [d.key, i]));
    for (const a of timeline) { const k = String(a.created_at).slice(0, 10); const i = idx.get(k); if (i != null) days[i]!.count++; }
    const max = Math.max(1, ...days.map(d => d.count));
    return { days, max };
  }, [timeline]);

  return (
    <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      {/* identity + primary actions, all on top */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
        <Avatar op={op} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>{op.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: v.tone, background: `color-mix(in srgb, ${v.tone} 12%, transparent)` }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.tone }} /> {v.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            {op.email ?? op.role} · <span className="capitalize">{op.role}</span>
            {op.has_session ? <span style={{ color: "#5f8169" }}> · online</span> : <span> · {ago(op.last_active_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate(`/messages?to=${encodeURIComponent(op.operator_id)}`)} title="Message"
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <Send size={11} style={{ color: "var(--section-accent)" }} /> Message
          </button>
          {callCap.data?.enabled && (
            <>
              <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "audio", name: op.name })} title="Call" className="btn-icon h-7 w-7"><Phone size={13} /></button>
              <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "video", name: op.name })} title="Video" className="btn-icon h-7 w-7"><Video size={13} /></button>
            </>
          )}
          <button onClick={() => window.print()} title="Print / save this member's report as PDF"
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <Printer size={11} style={{ color: "var(--section-accent)" }} /> Print report
          </button>
        </div>
      </div>

      {/* admin evaluation headline — a source-backed label, not a score */}
      {op.evaluation && (
        <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: EVAL_TONE[op.evaluation.tone], background: `color-mix(in srgb, ${EVAL_TONE[op.evaluation.tone]} 12%, transparent)` }}>
            {op.evaluation.label}
          </span>
          <span className="min-w-0 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{op.evaluation.basis}</span>
        </div>
      )}

      {/* One unified metrics block — soft borderless tiles (no hairline grid) reads calmer + more premium. */}
      <div className="grid grid-cols-3 gap-1.5 border-b px-4 py-3.5 sm:grid-cols-3" style={{ borderColor: "var(--border-soft)" }}>
        {[
          { k: "Tasks", val: fmt(op.task_count) },
          { k: "AI credits", val: fmt(op.tokens) },
          { k: "Credits / task", val: fmt(op.complexity_delta) },
          { k: "Records touched", val: fmt(op.records_touched ?? 0) },
          { k: "Open tasks", val: fmt(op.open_tasks ?? 0) },
          { k: "Overdue", val: fmt(op.overdue_tasks ?? 0), warn: (op.overdue_tasks ?? 0) > 0 },
          { k: "Completed", val: fmt(op.completed_tasks ?? 0) },
          { k: "Messages", val: fmt(op.messages_sent ?? 0) },
          { k: "Decisions", val: fmt(op.decisions_resolved ?? 0) },
        ].map((m) => (
          <div key={m.k} className="rounded-sm px-3 py-2" style={{ background: "var(--surface-hover)" }}>
            <div className="text-[15px] font-semibold tabular-nums" style={{ color: m.warn ? "#97824f" : "var(--text-primary)" }}>{m.val}</div>
            <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>{m.k}</div>
          </div>
        ))}
      </div>

      {/* deals / opportunities — real tallies (ownership resolved from node data + created_by) */}
      {((op.deals_owned ?? 0) > 0 || (op.deals_updated ?? 0) > 0) && (
        <div className="grid grid-cols-5 gap-1.5 border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
          {[
            { k: "Deals owned", val: op.deals_owned ?? 0 },
            { k: "Open", val: op.deals_open ?? 0 },
            { k: "Won", val: op.deals_won ?? 0, tone: "#5f8169" },
            { k: "Lost", val: op.deals_lost ?? 0, tone: "#9c6b72" },
            { k: "Updated", val: op.deals_updated ?? 0 },
          ].map((m) => (
            <div key={m.k} className="rounded-sm px-2.5 py-2" style={{ background: "var(--surface-hover)" }}>
              <div className="text-[15px] font-semibold tabular-nums" style={{ color: m.tone ?? "var(--text-primary)" }}>{fmt(m.val)}</div>
              <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>{m.k}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── AI Work-Efficiency Review — on-demand, grounded, actionable ── */}
      <div className="border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            <Sparkles size={12} style={{ color: "var(--section-accent)" }} /> AI work-efficiency review
          </p>
          {!efficiency.data && (
            <button onClick={() => efficiency.mutate()} disabled={efficiency.isPending}
              className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50" style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}>
              {efficiency.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} style={{ color: "var(--section-accent)" }} />} Generate review
            </button>
          )}
        </div>
        {efficiency.isPending && <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Analyzing real work data…</p>}
        {efficiency.isError && <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>Couldn't generate the review — please try again.</p>}
        {!efficiency.data && !efficiency.isPending && !efficiency.isError && (
          <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-faint)" }}>Generate an AI assessment of this member's work efficiency — strengths, where to improve, and a coaching message you can send them. Grounded strictly in real metrics — nothing invented.</p>
        )}
        {efficiency.data?.sufficient && (() => {
          const e = efficiency.data; const t = EFF_LABEL[e.rating];
          return (
            <div className="space-y-3">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium" style={{ borderColor: `${t.tone}33`, background: `${t.tone}14`, color: t.tone }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.tone }} /> {t.label}
                </span>
                <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{e.assessment}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {e.strengths.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#5f8169" }}>Strengths</p>
                    <ul className="space-y-1">{e.strengths.map((s, i) => <li key={i} className="flex gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "#5f8169" }} />{s}</li>)}</ul>
                  </div>
                )}
                {e.improvements.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#97824f" }}>Where to improve</p>
                    <ul className="space-y-1">{e.improvements.map((s, i) => <li key={i} className="flex gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "#97824f" }} />{s}</li>)}</ul>
                  </div>
                )}
              </div>
              {e.coaching_message && (
                <div className="rounded-sm border p-3" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Coaching message for {op.name.split(" ")[0]}</p>
                    <div className="flex gap-2.5">
                      <button onClick={() => { void navigator.clipboard?.writeText(e.coaching_message); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-[10.5px] font-medium" style={{ color: "var(--section-accent)" }}>{copied ? "Copied" : "Copy"}</button>
                      <button onClick={() => navigate(`/messages?to=${encodeURIComponent(op.operator_id)}`)} className="text-[10.5px] font-medium" style={{ color: "var(--section-accent)" }}>Message</button>
                    </div>
                  </div>
                  <p className="text-[12.5px] italic leading-relaxed" style={{ color: "var(--text-secondary)" }}>“{e.coaching_message}”</p>
                </div>
              )}
              <button onClick={() => efficiency.mutate()} disabled={efficiency.isPending} className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>↻ Regenerate</button>
            </div>
          );
        })()}
        {efficiency.data && !efficiency.data.sufficient && <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>{efficiency.data.assessment}</p>}
      </div>

      {/* Two-column body — Work signals (left) · AI & behaviour (right) — uses the full width. */}
      <div className="grid sm:grid-cols-2">
        <div className="sm:border-r" style={{ borderColor: "var(--border-soft)" }}>
      {/* work quality — source-backed signals computed server-side; every one cites its real basis */}
      {op.quality && op.quality.length > 0 && (
        <Section title="Work quality">
          <div className="space-y-2">
            {op.quality.map((s) => (
              <div key={s.key} className="flex items-start gap-2.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SIGNAL_TONE[s.level] }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{s.label}</span>
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: SIGNAL_TONE[s.level] }}>
                      {s.level === "insufficient" ? "no data" : s.level}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.basis}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px]" style={{ color: "var(--text-faint)" }}>Every signal is derived from real metrics; "no data" means it isn't measurable yet — never guessed.</p>
        </Section>
      )}

      {/* activity over time — real, premium area+line chart */}
      <Section title="Activity over time · last 14 days">
        {(() => {
          const W = 300, H = 54, n = chart.days.length;
          const step = n > 1 ? W / (n - 1) : W;
          const line = chart.days.map((d, i) => `${(i * step).toFixed(1)},${(H - 3 - (d.count / chart.max) * (H - 9)).toFixed(1)}`).join(" ");
          const total = chart.days.reduce((s, d) => s + d.count, 0);
          return (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={`activity trend, ${total} events`}>
              <defs>
                <linearGradient id={`ovArea-${op.operator_id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--section-accent)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--section-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#ovArea-${op.operator_id})`} />
              <polyline points={line} fill="none" stroke="var(--section-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          );
        })()}
        <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Recorded activity events per day. Hours are not tracked yet.</p>
      </Section>
        </div>
        <div>
      {/* AI coaching summary — grounded, source-backed */}
      <Section title="AI coaching summary">
        {insightQ.isLoading ? (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Reading real activity…</div>
        ) : insightQ.isError ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>Couldn't generate a summary right now.</p>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <Sparkles size={13} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{insightQ.data?.insight}</p>
            </div>
            {insightQ.data?.sources && insightQ.data.sources.length > 0 && (
              <div className="mt-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Sources · real activity</p>
                <div className="flex flex-wrap gap-1">
                  {insightQ.data.sources.slice(0, 6).map((s, i) => (
                    <span key={i} className="rounded px-1.5 py-px text-[10px]" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }} title={exactTime(s.timestamp)}>{s.title}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* derived behaviour signals — real, from matrix metrics */}
      <Section title="Behaviour signals">
        <ul className="space-y-1.5">
          {insights(op).map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--text-faint)" }} />{s}
            </li>
          ))}
        </ul>
        <div className="mt-2.5 space-y-1.5 text-[12px]">
          <Signal label="Live native session" ok={op.has_session} okText="Active" offText="Offline" />
          <Signal label="Verified device claim (PoW)" ok={op.verified_pow} okText="Verified" offText="None on record" neutral={!op.verified_pow} />
        </div>
      </Section>
        </div>
      </div>

      {/* activity timeline — real, grouped by lens with source links where a node is known */}
      <Section title="Activity timeline">
        {timelineQ.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Loading…</div>
        ) : timeline.length === 0 ? (
          <p className="py-1 text-[12px]" style={{ color: "var(--text-faint)" }}>No recorded activity in the last 30 days.</p>
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {TIMELINE_ORDER.map((group) => {
              const rows = timeline.slice(0, 80).filter((a) => timelineGroupOf(a) === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{group} · {rows.length}</div>
                  <div className="space-y-2">
                    {rows.slice(0, 20).map((a) => {
                      const link = a.object?.node_id && a.object?.type ? `/objects/${encodeURIComponent(a.object.type)}/${a.object.node_id}` : null;
                      const Row = (
                        <>
                          <History size={12} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                              <span className="font-medium capitalize" style={{ color: "var(--text-primary)" }}>{(a.action || "action").replace(/_/g, " ")}</span>
                              {a.object?.type && <span> · {a.object.type}</span>}
                              {a.object?.name && <span style={{ color: link ? "var(--section-accent)" : "var(--text-muted)" }}> "{a.object.name}"</span>}
                            </p>
                            {a.changes && a.changes.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {a.changes.map((ch, j) => (
                                  <span key={j} className="rounded px-1.5 py-px text-[10px]" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>
                                    <span className="capitalize">{ch.field}</span>: <span style={{ color: "var(--text-secondary)" }}>{ch.value}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="shrink-0 text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}>{exactTime(a.created_at)}</span>
                        </>
                      );
                      return link
                        ? <Link key={a.id} to={link} className="flex items-start gap-2.5 rounded-sm px-1 py-0.5 -mx-1 transition-colors hover:bg-[var(--surface-hover)]">{Row}</Link>
                        : <div key={a.id} className="flex items-start gap-2.5 px-1">{Row}</div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* actions — real destinations only */}
      {/* secondary actions (Message/Call live in the header now) */}
      <div className="flex flex-wrap gap-1.5 border-t px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
        {callCap.data?.enabled && callCap.data?.recording && (
          <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "audio", name: op.name, record: true })}
            title="Records the call and saves a transcript to Meeting Memory (both participants are notified on screen)."
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <Phone size={11} style={{ color: "var(--section-accent)" }} /> Call + record
          </button>
        )}
        <Link to="/settings/members" className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <Users size={11} style={{ color: "var(--section-accent)" }} /> Manage role &amp; access
        </Link>
        <button onClick={() => insightQ.refetch()}
          className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <MessageSquare size={11} style={{ color: "var(--section-accent)" }} /> Regenerate AI summary
        </button>
      </div>
      <span className="sr-only">{scope}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
      <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{title}</p>
      {children}
    </div>
  );
}
function Signal({ label, ok, okText, offText, neutral }: { label: string; ok: boolean; okText: string; offText: string; neutral?: boolean }) {
  const tone = ok ? "#5f8169" : neutral ? "var(--text-faint)" : "#97824f";
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="inline-flex items-center gap-1.5" style={{ color: tone }}>
        <ShieldCheck size={12} /> {ok ? okText : offText}
      </span>
    </div>
  );
}
