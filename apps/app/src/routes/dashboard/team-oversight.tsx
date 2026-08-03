import { Fragment, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, ArrowLeft, Loader2, User as UserIcon, ShieldCheck, MessageSquare, Users, ChevronRight, History, Sparkles, Send, Phone, Video, Printer, Target, Plus, Trash2 } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestCall } from "../../lib/call-bus";
import { FieldSelect, CommandPageHeader, MetricGrid, DossierSection, ActionMenu } from "../../components/ui/controls";
import { ErrorState } from "../../components/ui/page-state";
import { SuggestionHints } from "../../components/ui/ai-button";
import { compareWindows } from "@mondaily/shared/baseline";
import { KPIGrid, KPITile } from "../../components/ui/kpi";
import { PeriodSelector } from "../../components/ui/period-selector";
import { usePeriod, periodRange, previousRange, periodLabel, type Period } from "../../lib/period";
import { useResolvedPeriod } from "../../lib/period-bounds";

// CALENDAR-TRUE windows (2026-07-30): the backend measures "days back from now", so we derive the
// day count from the CALENDAR period start (1st of the month, Sunday, Jan 1) — "Month" genuinely
// restarts from zero on the 1st, exactly like Finance. The backend's previous-equal-window compare
// then reads as "same point last period". History is untouched — this only scopes the window.
// Takes the RESOLVED window rather than recomputing one: a day count derived from the browser's
// calendar while the window came from the workspace's would shape the comparison against a
// different span than the one being displayed.
function calendarDays(start: Date): number {
  return Math.max(1, Math.ceil((Date.now() - start.getTime()) / 86_400_000));
}

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
  good: "var(--status-ok)", watch: "var(--status-warn)", risk: "var(--status-error)", insufficient: "var(--text-faint)",
};
const EVAL_TONE: Record<EvalLabel["tone"], string> = {
  good: "var(--status-ok)", watch: "var(--status-warn)", risk: "var(--status-error)", neutral: "var(--text-faint)",
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
  strong:        { label: "Strong",        tone: "var(--status-ok)" },
  steady:        { label: "Steady",        tone: "var(--section-accent)" },
  needs_support: { label: "Needs support", tone: "var(--status-warn)" },
  insufficient:  { label: "Not enough data", tone: "var(--text-faint)" },
};

// ── Advanced intelligence (GET /activities/oversight-advanced) ──
interface LeadTime { avg_days: number | null; on_time_rate: number | null; sample: number }
interface CycleTime { avg_hours: number | null; sample: number }
interface CompareRow { operator_id: string; activity_now: number; activity_prev: number; ai_now: number; ai_prev: number }
interface AdvancedResp {
  days: number;
  comparison: CompareRow[];
  velocity: { team: { task_lead: LeadTime; decision_cycle: CycleTime }; per_member: { operator_id: string; task_lead: LeadTime; decision_cycle: CycleTime }[] };
  collaboration: { from: string; to: string; count: number }[];
}
// ── Goals (GET/POST/DELETE /activities/goals) ──
type GoalMetric = "tasks_completed" | "decisions_resolved" | "deals_won" | "records_touched" | "ai_credits";
const GOAL_METRIC_LABEL: Record<GoalMetric, string> = {
  tasks_completed: "Tasks completed", decisions_resolved: "Decisions resolved", deals_won: "Deals won", records_touched: "Records touched", ai_credits: "AI credits",
};
interface Goal { id: string; scope: "member" | "team"; target_user_id: string | null; metric: GoalMetric; target_value: number; window_days: number; label: string | null; actual: number; attainment_pct: number }
interface GoalsResp { goals: Goal[]; available: boolean }

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  engaged:         { label: "Engaged",        tone: "var(--status-ok)" },
  high_complexity: { label: "Deep work",      tone: "var(--status-ok)" },
  bot:             { label: "Power user",     tone: "var(--status-ok)" },
  low_engagement:  { label: "Low engagement", tone: "var(--status-warn)" },
  inactive:        { label: "Inactive",       tone: "var(--status-warn)" },
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
    <div className="border-t pt-4" style={{ borderColor: "var(--border-soft)" }}>
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
function TeamCharts({ operators, onSelect, windowLabel }: { operators: Operator[]; onSelect: (id: string) => void; windowLabel: string }) {
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricBars title="Workload" hint="Open tasks assigned" operators={operators} tone="var(--section-accent)" onSelect={onSelect} value={(o) => (o.open_tasks ?? 0) + (o.overdue_tasks ?? 0)} />
      <MetricBars title="Overdue work" hint="Overdue tasks by member" operators={operators} tone="var(--status-error)" onSelect={onSelect} value={(o) => o.overdue_tasks ?? 0} />
      <MetricBars title="Decisions resolved" hint={`Approvals/rejections (${windowLabel})`} operators={operators} tone="var(--status-ok)" onSelect={onSelect} value={(o) => o.decisions_resolved ?? 0} />
      <MetricBars title="AI usage" hint={`Credits spent (${windowLabel})`} operators={operators} tone="var(--section-accent)" onSelect={onSelect} value={(o) => o.tokens} />
    </div>
  );
}

/** Minimal, dependency-free SVG sparkline for a 30-day trend (premium ledger style). */
function Sparkline({ points, tone }: { points: TrendPoint[]; tone: string }) {
  if (!points || points.length === 0) return null;
  const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1;
  const W = 100, H = 48;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const coords = points.map((p, i) => `${(i * step).toFixed(2)},${(H - (p.value / max) * (H - 2) - 1).toFixed(2)}`);
  const total = points.reduce((s, p) => s + p.value, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label={`trend total ${total}`}>
      <polyline points={coords.join(" ")} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Unified overview tiles — each metric shows its number + an inline sparkline in one seamless
 *  grid (the Home tile+chart pattern), replacing the old separate stat-band + chart-card rows. */
function OverviewTiles({ trends, periodLabel }: { trends: NonNullable<MatrixResp["trends"]>; periodLabel: string }) {
  const tiles: { label: string; tone: string; pts: TrendPoint[] }[] = [
    { label: "Activity", tone: "var(--section-accent)", pts: trends.activity ?? [] },
    { label: "Tasks completed", tone: "var(--status-ok)", pts: trends.tasks_completed ?? [] },
    { label: "AI credits", tone: "var(--status-warn)", pts: trends.ai_usage ?? [] },
    { label: "Decisions", tone: "var(--status-neutral)", pts: trends.decisions ?? [] },
  ];
  return (
    <div className="telemetry-strip mb-6">
      {tiles.map((t) => {
        const total = t.pts.reduce((s, p) => s + p.value, 0);
        return (
          <div key={t.label} className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{t.label}</span>
              <span className="text-[9.5px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{periodLabel}</span>
            </div>
            <div className="mt-2 text-[23px] font-semibold leading-none tabular-nums" style={{ color: "var(--text-primary)" }}>{fmt(total)}</div>
            <div className="mt-2.5 h-16">{total === 0 ? <div className="pt-2 text-[10.5px]" style={{ color: "var(--text-faint)" }}>—</div> : <Sparkline points={t.pts} tone={t.tone} />}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Full-width team roster — a real leaderboard table (Member · Tasks · Records · Decisions · AI
 *  credits bar · verdict), sorted, dense, scannable. Click a row to open that member's profile. */
const ROSTER_COLS = "grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.6fr)_3.5rem_4rem_4.5rem_5rem_minmax(96px,1fr)_1.25rem]";
function RosterTable({ operators, selectedId, onSelect, detailFor, compareBy }: { operators: Operator[]; selectedId: string | null; onSelect: (id: string | null) => void; detailFor: (op: Operator) => React.ReactNode; compareBy?: Map<string, CompareRow> }) {
  const maxTokens = Math.max(1, ...operators.map(o => o.tokens));
  return (
    <div className="overflow-hidden border-y" style={{ borderColor: "var(--border-soft)" }}>
      <div className={`hidden items-center gap-3 border-b px-4 py-2 text-[10.5px] font-medium sm:grid ${ROSTER_COLS}`} style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
        <span>Member</span>
        <span className="text-right">Trend</span>
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
              aria-expanded={isSel} aria-label={`${isSel ? "Collapse" : "Expand"} ${op.name}'s dossier`}
              className={`grid w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--section-accent)] ${ROSTER_COLS}`}
              style={{ background: isSel ? "var(--surface-selected)" : undefined }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar op={op} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{op.name}</span>
                    {activeToday(op.last_active_at) && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--status-ok)" }} title="active today" />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                    <span className="capitalize">{op.role}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-medium" style={{ borderColor: `${v.tone}33`, background: `${v.tone}14`, color: v.tone }}>{v.label}</span>
                  </div>
                </div>
              </div>
              <span className="hidden justify-self-end sm:block">{(() => { const c = compareBy?.get(op.operator_id); return c ? <Trend now={c.activity_now} prev={c.activity_prev} /> : <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>—</span>; })()}</span>
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
              <div className="border-t px-2.5 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
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
      {/* The Home ai-composer idiom, compact: one-line box, same focus ring family. */}
      {/* Hairline composer — no box: one underline, sparkle left, quiet Ask right. */}
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask.mutate(q.trim()); }}
        className="flex items-center gap-2 border-b px-1 pb-2" style={{ borderColor: "var(--border-soft)" }}>
        <Sparkles size={14} className="shrink-0" style={{ color: "var(--section-accent)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your team — grounded in real data, no guesses…" aria-label="Ask about your team, grounded in recorded data"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: "var(--text-primary)" }} />
        {/* Accent AI-action style — same recognizable primary treatment as .btn-primary across the app. */}
        <button type="submit" disabled={ask.isPending || !q.trim()} aria-label="Ask about your team"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
          style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 14%, transparent)", color: "var(--section-accent-text)" }}>
          {ask.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Ask
        </button>
      </form>
      {!ask.data && !ask.isPending && (
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {suggestions.map((sg) => (
            <button key={sg} onClick={() => { setQ(sg); ask.mutate(sg); }}
              className="flex w-full items-center gap-2 px-1 py-2 text-left text-[12.5px] transition-colors hover:text-[var(--text-primary)]"
              style={{ color: "var(--text-muted)", borderColor: "var(--border-soft)" }}>
              <span className="text-[var(--text-faint)]">↳</span> {sg}
            </button>
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

// ── Business outcomes (Sales) — THE money layer: value won/lost, pipeline, win rate ──────────
interface OutcomesResp {
  base_currency: string;
  team: { value_won: number; deals_won: number; value_lost: number; deals_lost: number; pipeline_value: number; pipeline_deals: number; projected_amount: number; close_rate_pct: number | null; avg_open_deal_age_days: number | null; stages: { stage: string; deals: number; value: number }[]; lost_reasons: { reason: string; deals: number; value: number }[]; win_rate_pct: number | null; avg_deal_size: number | null; avg_cycle_days: number | null; unconverted: number; pipeline_unconverted: number;
    undated_wins?: number; undated_lost?: number;
    deltas: null | { value_won: { kind: string; label: string; direction: number; detail: string } } };
  members: { user_id: string; value_won: number; deals_won: number; value_lost: number; deals_lost: number; win_rate_pct: number | null; pipeline_value: number; pipeline_deals: number; undated_wins?: number; undated_lost?: number }[];
}
function useOutcomes(period: Period) {
  // Both windows from the WORKSPACE. Resolving the current window on the server and the comparison
  // window in the browser would make every delta wrong by the timezone offset.
  const { range: r, previous: pr, timeZone } = useResolvedPeriod(period);
  const qs = new URLSearchParams({ start: r.start.toISOString(), end: r.end.toISOString() });
  if (pr) { qs.set("prev_start", pr.start.toISOString()); qs.set("prev_end", pr.end.toISOString()); }
  const q = useQuery<OutcomesResp>({ queryKey: ["outcomes", period, r.start.toISOString(), r.end.toISOString()], queryFn: () => apiClient.get(`/activities/outcomes?${qs}`), staleTime: 60_000, retry: false });
  return { ...q, range: r, timeZone };
}

/**
 * The window a FLOW tile covers, named rather than described: "August 2026", not "this month".
 * On the 3rd of a month a tile reading 0.00 is correct and looks broken; naming the period is what
 * tells a reader the number is new rather than missing.
 */
function windowName(period: Period, range: { start: Date }): string {
  const d = range.start;
  switch (period) {
    case "month":   return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    case "quarter": return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    case "year":    return String(d.getFullYear());
    case "today":   return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    case "week":    return `week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    default:        return periodLabel(period).toLowerCase();
  }
}
const fmtMoney0 = (v: number, cur: string) => `${cur} ${Math.round(v).toLocaleString()}`;
function SalesStrip({ period }: { period: Period }) {
  const q = useOutcomes(period);
  const t = q.data?.team; if (!t) return null;
  const cur = q.data!.base_currency;
  const d = t.deltas?.value_won;
  const win = windowName(period, q.range);
  const undated = t.undated_wins ?? 0;
  return (
    <div className="mb-6">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Sales · {win}{q.timeZone ? ` · ${q.timeZone}` : ""}</p>
      <KPIGrid>
        <KPITile label="Value won" accent value={fmtMoney0(t.value_won, cur)}
          delta={d && d.label ? <span className="text-[10px] font-semibold tabular-nums" title={d.detail} style={{ color: d.direction >= 0 ? "var(--status-ok)" : "var(--status-error)" }}>{d.direction >= 0 ? "▲" : "▼"} {d.label}</span> : undefined}
          sub={<>{t.deals_won} deal{t.deals_won === 1 ? "" : "s"} won · {win}
            {t.unconverted > 0 ? ` · ${t.unconverted} unconverted` : ""}
            {/* Wins with no close date are excluded from the window rather than dated by their last
                edit, so the tile says how many are unaccounted for instead of quietly omitting them. */}
            {undated > 0 ? ` · ${undated} without a close date` : ""}</>} />
        <KPITile label="Value lost" valueColor={t.value_lost > 0 ? "var(--status-error)" : undefined} value={fmtMoney0(t.value_lost, cur)}
          sub={<>{t.deals_lost} lost · {win}{(t.undated_lost ?? 0) > 0 ? ` · ${t.undated_lost} dated by last edit` : ""}</>} />
        <KPITile label="Open pipeline" value={fmtMoney0(t.pipeline_value, cur)} sub={<>{t.pipeline_deals} open · as of today{t.pipeline_unconverted > 0 ? ` · ${t.pipeline_unconverted} unconverted` : ""}</>} />
        <KPITile label="Win rate" value={t.win_rate_pct != null ? `${t.win_rate_pct}%` : "—"} sub={t.win_rate_pct != null ? "of closed deals" : "no closed deals yet"} />
        <KPITile label="Avg deal" value={t.avg_deal_size != null ? fmtMoney0(t.avg_deal_size, cur) : "—"} sub={t.avg_cycle_days != null ? `${t.avg_cycle_days}d avg cycle` : "won deals only"} />
        <KPITile label="Projected" value={fmtMoney0(t.projected_amount, cur)} sub="stage-weighted open pipeline" />
        <KPITile label="Close rate" value={t.close_rate_pct != null ? `${t.close_rate_pct}%` : "—"} sub="of all opportunities" />
        <KPITile label="Open deal age" value={t.avg_open_deal_age_days != null ? `${t.avg_open_deal_age_days}d` : "—"} sub="average · stall signal" />
      </KPIGrid>
      {/* Pipeline by stage — hairline value bars (top stages by open value). */}
      {t.stages.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Pipeline by stage</p>
          <div className="space-y-1">
            {t.stages.map((st) => {
              const max = t.stages[0]!.value || 1;
              return (
                <div key={st.stage} className="flex items-center gap-2 text-[11px]">
                  <span className="w-36 truncate capitalize" style={{ color: "var(--text-muted)" }}>{st.stage}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round((st.value / max) * 100))}%`, background: "var(--section-accent)" }} />
                  </span>
                  <span className="w-32 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtMoney0(st.value, cur)} · {st.deals}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Lost by reason — renders only when the window has losses; skipped reasons show honestly. */}
      {t.lost_reasons.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Lost by reason</p>
          <div className="space-y-1">
            {t.lost_reasons.map((lr) => {
              const max = t.lost_reasons[0]!.value || 1;
              return (
                <div key={lr.reason} className="flex items-center gap-2 text-[11px]">
                  <span className="w-36 truncate" style={{ color: "var(--text-muted)" }}>{lr.reason}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round((lr.value / max) * 100))}%`, background: "var(--status-error)" }} />
                  </span>
                  <span className="w-32 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{fmtMoney0(lr.value, cur)} · {lr.deals}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Leaderboard — top members by value won (only meaningful with 2+ sellers). */}
      {(q.data?.members.length ?? 0) > 1 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Top by value won · {win}</p>
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {q.data!.members.slice(0, 5).map((m, i) => {
              const gap = m.undated_wins ?? 0;
              return (
              <div key={m.user_id} className="flex items-center gap-3 py-1.5 text-[12px]" style={{ borderColor: "var(--border-soft)" }}>
                <span className="w-4 tabular-nums" style={{ color: "var(--text-faint)" }}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-primary)" }}><MemberName userId={m.user_id} /></span>
                {/* A member whose wins are all undated reads 0.00 here. Without saying so, the row
                    looks like they sold nothing this period rather than like the close dates are
                    missing — the difference between a performance signal and a data gap. */}
                {gap > 0 && (
                  <span className="shrink-0 rounded-full border px-1.5 py-px text-[9.5px]"
                    title={`${gap} win${gap === 1 ? "" : "s"} excluded — no close date recorded, so they cannot be placed in ${win}`}
                    style={{ borderColor: "var(--status-warn)", color: "var(--status-warn)" }}>
                    {gap} undated
                  </span>
                )}
                <span className="tabular-nums" style={{ color: m.value_won > 0 ? "var(--status-ok)" : "var(--text-muted)" }}>{fmtMoney0(m.value_won, cur)}</span>
                <span className="w-20 text-right tabular-nums" style={{ color: "var(--text-muted)" }}>{m.win_rate_pct != null ? `${m.win_rate_pct}% win` : "—"}</span>
              </div>
            );})}
          </div>
        </div>
      )}
    </div>
  );
}

/** Resolve a member id to their display name from the already-loaded matrix (no extra fetch). */
function MemberName({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const cached = qc.getQueriesData<MatrixResp>({ queryKey: ["oversight-matrix"] });
  for (const [, d] of cached) { const hit = d?.operators?.find((o: Operator) => o.operator_id === userId); if (hit) return <>{hit.name}</>; }
  return <>{userId.slice(0, 8)}…</>;
}

// A small up/down/flat trend chip from two real counts (this window vs. the previous equal window).
function Trend({ now, prev }: { now: number; prev: number }) {
  // Delegates to THE shared baseline engine — the honesty rules live in @mondaily/shared/baseline
  // (both-zero dash, "new" at zero baseline, raw counts below MIN_BASE, capped %).
  const c = compareWindows(now, prev);
  if (c.kind === "none") return <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>—</span>;
  const tone = c.direction === 0 ? "var(--text-faint)" : c.direction > 0 ? "var(--status-ok)" : "var(--status-error)";
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums" style={{ color: tone }} title={c.detail}>
      {c.direction === 0 ? "→" : c.direction > 0 ? "↑" : "↓"}{c.label}
    </span>
  );
}

/** Team-health read — a synthesized, source-backed headline from the real matrix (never a fake score). */
function teamHealth(operators: Operator[]) {
  const completed = operators.reduce((s, o) => s + (o.completed_tasks ?? 0), 0);
  const open = operators.reduce((s, o) => s + (o.open_tasks ?? 0), 0);
  const overdue = operators.reduce((s, o) => s + (o.overdue_tasks ?? 0), 0);
  const decisions = operators.reduce((s, o) => s + (o.decisions_resolved ?? 0), 0);
  const activeToday7 = operators.filter(o => activeToday(o.last_active_at)).length;
  const completionRate = completed + open > 0 ? Math.round((completed / (completed + open)) * 100) : null;
  const activeRatio = operators.length ? Math.round((activeToday7 / operators.length) * 100) : 0;
  // Qualitative read from real signals — concentration of overdue + completion + engagement.
  const risk = overdue >= 5 || (completionRate != null && completionRate < 40);
  const strong = (completionRate ?? 0) >= 70 && overdue <= 1 && activeRatio >= 50;
  const tone = risk ? "var(--status-error)" : strong ? "var(--status-ok)" : "var(--status-warn)";
  const read = risk ? "Attention needed" : strong ? "Healthy" : "Steady";
  return { read, tone, completionRate, open, overdue, decisions, activeRatio, activeToday7 };
}

/** Zone 1 — Team Health hero: one synthesized read + the real inputs + the evaluation distribution. */
function TeamHealthHero({ operators, adv }: { operators: Operator[]; adv?: AdvancedResp }) {
  const h = teamHealth(operators);
  // Evaluation distribution across the team (from the source-backed per-member evaluation labels).
  const dist = useMemo(() => {
    const m = new Map<string, { label: string; tone: EvalLabel["tone"]; count: number }>();
    for (const o of operators) { if (!o.evaluation) continue; const k = o.evaluation.label; const e = m.get(k) ?? { label: k, tone: o.evaluation.tone, count: 0 }; e.count++; m.set(k, e); }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [operators]);
  // Period-over-period team activity direction (real, from the advanced comparison).
  const dir = useMemo(() => {
    if (!adv) return null;
    const now = adv.comparison.reduce((s, c) => s + c.activity_now, 0);
    const prev = adv.comparison.reduce((s, c) => s + c.activity_prev, 0);
    return { now, prev };
  }, [adv]);
  const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div><div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{label}</div><div className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color: tone ?? "var(--text-primary)" }}>{value}</div></div>
  );
  return (
    <div className="mb-4 border-y px-1 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-sm" style={{ background: `color-mix(in srgb, ${h.tone} 14%, transparent)` }}><ShieldCheck size={17} style={{ color: h.tone }} /></span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold" style={{ color: h.tone }}>{h.read}</span>
              {dir && <Trend now={dir.now} prev={dir.prev} />}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>team health · this period</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat label="Completion" value={h.completionRate != null ? `${h.completionRate}%` : "—"} />
          <Stat label="Overdue" value={String(h.overdue)} tone={h.overdue > 0 ? "var(--status-warn)" : undefined} />
          <Stat label="Active today" value={`${h.activeToday7}/${operators.length}`} tone="var(--status-ok)" />
          <Stat label="Decisions" value={String(h.decisions)} />
        </div>
      </div>
      {dist.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Evaluation</span>
          {dist.map(d => (
            <span key={d.label} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: EVAL_TONE[d.tone], background: `color-mix(in srgb, ${EVAL_TONE[d.tone]} 12%, transparent)` }}>
              {d.count} {d.label.toLowerCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Real cycle-time velocity (team) — task lead time + on-time rate, decision cycle time. Honest nulls. */
function VelocityStrip({ adv }: { adv: AdvancedResp }) {
  const v = adv.velocity.team;
  const tiles = [
    { label: "Avg task lead time", value: v.task_lead.avg_days != null ? `${v.task_lead.avg_days}d` : "—", sub: v.task_lead.sample ? `${v.task_lead.sample} completed` : "no completed tasks yet" },
    { label: "On-time completion", value: v.task_lead.on_time_rate != null ? `${v.task_lead.on_time_rate}%` : "—", sub: v.task_lead.on_time_rate != null ? "of tasks with a due date" : "no due dates set" },
    { label: "Avg decision cycle", value: v.decision_cycle.avg_hours != null ? `${v.decision_cycle.avg_hours}h` : "—", sub: v.decision_cycle.sample ? `${v.decision_cycle.sample} resolved` : "none resolved yet" },
  ];
  return (
    <div className="telemetry-strip mb-6">
      {tiles.map(t => (
        <div key={t.label} className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{t.label}</div>
          <div className="mt-1 text-[20px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{t.value}</div>
          <div className="mt-0.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Workload balance + attention: who's overloaded, and who's going quiet — real derived signals. */
function WorkloadAttention({ operators, onSelect }: { operators: Operator[]; onSelect: (id: string) => void }) {
  const overloaded = operators.map(o => ({ o, load: (o.open_tasks ?? 0) + (o.overdue_tasks ?? 0) })).filter(r => r.load >= 5).sort((a, b) => b.load - a.load).slice(0, 5);
  const inactive = operators.filter(o => { const d = o.last_active_at ? Math.floor((Date.now() - new Date(o.last_active_at).getTime()) / 86_400_000) : null; return d != null && d >= 7; })
    .map(o => ({ o, days: Math.floor((Date.now() - new Date(o.last_active_at!).getTime()) / 86_400_000) })).sort((a, b) => b.days - a.days).slice(0, 5);
  if (overloaded.length === 0 && inactive.length === 0) return null;
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2">
      <div className="border-t pt-4" style={{ borderColor: "var(--border-soft)" }}>
        <div className="mb-2 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Heaviest workload</div>
        {overloaded.length === 0 ? <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>No one is carrying an unusually heavy load.</p> : overloaded.map(({ o, load }) => (
          <button key={o.operator_id} onClick={() => onSelect(o.operator_id)} className="flex w-full items-center justify-between gap-2 py-1 text-left transition-colors hover:opacity-80">
            <span className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>{o.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: (o.overdue_tasks ?? 0) > 0 ? "var(--status-warn)" : "var(--text-faint)" }}>{load} open{(o.overdue_tasks ?? 0) > 0 ? ` · ${o.overdue_tasks} overdue` : ""}</span>
          </button>
        ))}
      </div>
      <div className="border-t pt-4" style={{ borderColor: "var(--border-soft)" }}>
        <div className="mb-2 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Going quiet <span className="font-normal" style={{ color: "var(--text-faint)" }}>· 7+ days idle</span></div>
        {inactive.length === 0 ? <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>Everyone has been active in the last week.</p> : inactive.map(({ o, days }) => (
          <button key={o.operator_id} onClick={() => onSelect(o.operator_id)} className="flex w-full items-center justify-between gap-2 py-1 text-left transition-colors hover:opacity-80">
            <span className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>{o.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--status-warn)" }}>{days}d idle</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Zone 2 — Goals: owner-set targets against REAL metrics, with live attainment. Fail-closed when the
 *  goals table isn't enabled yet (pending migration) — the feature is discoverable but honest. */
function GoalsPanel({ operators }: { operators: Operator[] }) {
  const goalsQ = useQuery<GoalsResp>({ queryKey: ["oversight-goals"], queryFn: () => apiClient.get<GoalsResp>("/activities/goals"), retry: false });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ scope: "member" | "team"; target_user_id: string; metric: GoalMetric; target_value: string; window_days: string }>(
    { scope: "member", target_user_id: operators[0]?.operator_id ?? "", metric: "tasks_completed", target_value: "", window_days: "30" });
  const create = useMutation({
    mutationFn: () => apiClient.post("/activities/goals", { scope: form.scope, target_user_id: form.scope === "team" ? null : form.target_user_id, metric: form.metric, target_value: Number(form.target_value), window_days: Number(form.window_days) }),
    onSuccess: () => { setOpen(false); setForm(f => ({ ...f, target_value: "" })); goalsQ.refetch(); },
  });
  const del = useMutation({ mutationFn: (id: string) => apiClient.delete(`/activities/goals/${id}`), onSuccess: () => goalsQ.refetch() });
  const goals = goalsQ.data?.goals ?? [];
  const nameOf = (id: string | null) => id ? (operators.find(o => o.operator_id === id)?.name ?? "Member") : "Whole team";
  const available = goalsQ.data?.available !== false;
  const canSubmit = Number(form.target_value) > 0 && (form.scope === "team" || !!form.target_user_id);

  return (
    <div className="mb-6 border-y" style={{ borderColor: "var(--border-soft)" }}>
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}><Target size={13} style={{ color: "var(--section-accent)" }} /> Goals &amp; targets</span>
        {available && <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><Plus size={11} /> {open ? "Cancel" : "Add goal"}</button>}
      </div>
      {!available ? (
        <p className="px-4 py-3 text-[11.5px]" style={{ color: "var(--text-faint)" }}>Team goals activate once the goals table is enabled on this deployment (a pending migration). Every target tracks a real metric — nothing is fabricated.</p>
      ) : (
        <>
          <p className="border-b px-4 py-2 text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
            Set a target for one member or the whole team on a real metric (e.g. 20 tasks completed in 30 days). Attainment updates live from actual recorded activity — never estimated.
          </p>
          {open && (
            <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
              <label className="flex flex-col gap-1"><span className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>Scope</span>
                <div className="w-28"><FieldSelect value={form.scope} onChange={v => setForm(f => ({ ...f, scope: v as "member" | "team" }))} ariaLabel="Scope" options={[{ value: "member", label: "Member" }, { value: "team", label: "Whole team" }]} /></div>
              </label>
              {form.scope === "member" && (
                <label className="flex flex-col gap-1"><span className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>Member</span>
                  <div className="w-40"><FieldSelect value={form.target_user_id} onChange={v => setForm(f => ({ ...f, target_user_id: v }))} ariaLabel="Member" options={operators.map(o => ({ value: o.operator_id, label: o.name }))} /></div>
                </label>
              )}
              <label className="flex flex-col gap-1"><span className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>Metric</span>
                <div className="w-44"><FieldSelect value={form.metric} onChange={v => setForm(f => ({ ...f, metric: v as GoalMetric }))} ariaLabel="Metric" options={(Object.keys(GOAL_METRIC_LABEL) as GoalMetric[]).map(m => ({ value: m, label: GOAL_METRIC_LABEL[m] }))} /></div>
              </label>
              <label className="flex flex-col gap-1"><span className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>Target</span>
                <input value={form.target_value} onChange={e => setForm(f => ({ ...f, target_value: e.target.value.replace(/[^0-9]/g, "") }))} inputMode="numeric" placeholder="0" className="h-8 w-20 rounded-sm border bg-transparent px-2 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
              </label>
              <label className="flex flex-col gap-1"><span className="text-[10.5px] font-medium" style={{ color: "var(--text-muted)" }}>Window</span>
                <div className="w-24"><FieldSelect value={form.window_days} onChange={v => setForm(f => ({ ...f, window_days: v }))} ariaLabel="Window" options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} /></div>
              </label>
              <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending} className="btn-primary h-8 px-3 text-[11.5px] font-semibold disabled:opacity-50">{create.isPending ? <Loader2 size={12} className="animate-spin" /> : "Set goal"}</button>
              {create.isError && <span className="text-[10.5px]" style={{ color: "var(--status-error)" }}>Couldn't save — check the target.</span>}
            </div>
          )}
          {goals.length === 0 ? (
            <p className="px-4 py-3 text-[11.5px]" style={{ color: "var(--text-faint)" }}>No targets set yet. Add a goal to track real attainment (tasks completed, decisions, deals won, records, or AI credits) per member or for the whole team.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {goals.map(g => {
                const pct = g.attainment_pct; const tone = pct >= 100 ? "var(--status-ok)" : pct >= 60 ? "var(--section-accent)" : pct >= 30 ? "var(--status-warn)" : "var(--status-error)";
                return (
                  <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{nameOf(g.target_user_id)}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{GOAL_METRIC_LABEL[g.metric]} · {g.window_days}d</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="h-1.5 w-40 max-w-full overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}><span className="block h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: tone }} /></span>
                        <span className="text-[11px] tabular-nums" style={{ color: tone }}>{g.actual}/{g.target_value} · {pct}%</span>
                      </div>
                    </div>
                    <button onClick={() => del.mutate(g.id)} title="Remove goal" className="btn-icon h-7 w-7" style={{ color: "var(--text-faint)" }}><Trash2 size={12} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Zone 2 — Collaboration graph: real directed message edges between members (sender → recipient),
 *  rendered as a compact node-link diagram for small teams + a ranked edge list. Empty → hidden. */
function CollaborationGraph({ edges, operators, onSelect }: { edges: AdvancedResp["collaboration"]; operators: Operator[]; onSelect: (id: string) => void }) {
  const nameOf = (id: string) => operators.find(o => o.operator_id === id)?.name ?? "Member";
  // Only edges between people we can name (real members); collapse A→B & B→A for the node ring weight.
  const known = edges.filter(e => operators.some(o => o.operator_id === e.from) && operators.some(o => o.operator_id === e.to));
  if (known.length === 0) return null;
  const nodeIds = [...new Set(known.flatMap(e => [e.from, e.to]))];
  const maxCount = known.reduce((m, e) => Math.max(m, e.count), 1);
  // Lay the involved members on a circle; draw a line per directed edge, thickness ∝ real count.
  const W = 320, H = 220, cx = W / 2, cy = H / 2, R = 78;
  const pos = new Map(nodeIds.map((id, i) => {
    const a = (i / nodeIds.length) * Math.PI * 2 - Math.PI / 2;
    return [id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }];
  }));
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-[320px_1fr]">
      <div className="border-t pt-3" style={{ borderColor: "var(--border-soft)" }}>
        <div className="mb-1 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Collaboration</div>
        <div className="mb-1.5 text-[10.5px]" style={{ color: "var(--text-muted)" }}>Real internal messages between members</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="collaboration graph">
          {known.map((e, i) => { const a = pos.get(e.from)!, b = pos.get(e.to)!; return (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--section-accent)" strokeOpacity={0.15 + 0.5 * (e.count / maxCount)} strokeWidth={0.75 + 2.5 * (e.count / maxCount)} vectorEffect="non-scaling-stroke" />
          ); })}
          {nodeIds.map(id => { const p = pos.get(id)!; return (
            <g key={id} style={{ cursor: "pointer" }} onClick={() => onSelect(id)}>
              <circle cx={p.x} cy={p.y} r={5} fill="var(--section-accent)" />
              <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize="8.5" fill="var(--text-muted)">{nameOf(id).split(" ")[0]}</text>
            </g>
          ); })}
        </svg>
      </div>
      <div className="border-t pt-4" style={{ borderColor: "var(--border-soft)" }}>
        <div className="mb-2 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Busiest channels</div>
        <div className="space-y-1.5">
          {known.slice(0, 8).map((e, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <span className="truncate text-[11.5px]" style={{ color: "var(--text-secondary)" }}>{nameOf(e.from)} <span style={{ color: "var(--text-faint)" }}>→</span> {nameOf(e.to)}</span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}><span className="block h-full rounded-full" style={{ width: `${Math.max(6, (e.count / maxCount) * 100)}%`, background: "var(--section-accent)" }} /></span>
                <span className="w-8 text-right text-[10.5px] tabular-nums" style={{ color: "var(--text-faint)" }}>{e.count}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TeamOversightPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("member");
  // Shared reporting-period lens (same control as Finance) — every metric + trend recomputes.
  const [period, setPeriod] = usePeriod("mondaily_oversight_period");
  const { range: oversightRange } = useResolvedPeriod(period);
  const days = period === "all" ? 365 : calendarDays(oversightRange.start);
  const { data, isLoading, isError, error, refetch } = useQuery<MatrixResp>({
    queryKey: ["oversight-matrix", days, period, oversightRange.start.toISOString()],
    // Calendar-true: send the EXACT window start (midnight today / Sunday / the 1st…) so "Today"
    // really means since midnight, not a rolling 24h. `days` still shapes the comparison window.
    queryFn: () => apiClient.get<MatrixResp>(`/activities/oversight-matrix?days=${days}&since=${encodeURIComponent(oversightRange.start.toISOString())}`),
    refetchInterval: 30_000,
    retry: false,
  });
  // Advanced intelligence (velocity / collaboration / comparison) — lazy, admin-only, real.
  const advancedQ = useQuery<AdvancedResp>({
    queryKey: ["oversight-advanced", days],
    queryFn: () => apiClient.get<AdvancedResp>(`/activities/oversight-advanced?days=${days}`),
    retry: false,
  });
  const compareBy = useMemo(() => {
    const m = new Map<string, CompareRow>();
    for (const c of advancedQ.data?.comparison ?? []) m.set(c.operator_id, c);
    return m;
  }, [advancedQ.data]);
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
    <div className="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:px-6">
      {/* Shared command header — same pattern as Decisions / Discovery / Home cockpit. */}
      <CommandPageHeader
        variant="bar"
        icon={ShieldCheck}
        callsign="ORG"
        title="Team Intelligence"
        subtitle="Signal engine — real activity only, never invented."
        status={[{ label: "recorded activity only", kind: "complete" }]}
        primaryAction={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {/* ── ZONE 1 · Team Health hero — one synthesized read + inputs + evaluation distribution ── */}
      {operators.length > 0 && <div className="mt-3"><TeamHealthHero operators={operators} adv={advancedQ.data} /></div>}

      {/* ── One compact summary line (real counts) ── */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1.5"><Users size={13} style={{ color: "var(--text-faint)" }} /><strong className="tabular-nums" style={{ color: "var(--text-primary)" }}>{totals?.operators ?? operators.length}</strong> member{(totals?.operators ?? operators.length) === 1 ? "" : "s"}</span>
        <span><strong className="tabular-nums" style={{ color: "var(--status-ok)" }}>{activeTodayCount}</strong> active today</span>
        <span><strong className="tabular-nums" style={{ color: "var(--text-primary)" }}>{fmt(totalTasks)}</strong> tasks</span>
        <span><strong className="tabular-nums" style={{ color: "var(--text-primary)" }}>{totals ? fmt(totals.tokens) : "—"}</strong> AI credits</span>
      </div>

      {/* ── Unified overview tiles — number + inline sparkline, Home-style ── */}
      {data?.trends && <OverviewTiles trends={data.trends} periodLabel={`${days}d`} />}

      {/* ── Sales — the business-outcomes layer (deal VALUES, from /activities/outcomes) ── */}
      {operators.length > 0 && <SalesStrip period={period} />}

      {/* ── ZONE 2 · Velocity (real cycle times) + workload balance + goals ── */}
      {advancedQ.data && operators.length > 0 && <VelocityStrip adv={advancedQ.data} />}
      {operators.length > 1 && <WorkloadAttention operators={operators} onSelect={select} />}
      {advancedQ.data && operators.length > 1 && <CollaborationGraph edges={advancedQ.data.collaboration} operators={operators} onSelect={select} />}

      {/* ── Team distributions — only meaningful with 2+ members (hidden for a solo workspace) ── */}
      {operators.length > 1 && <TeamCharts operators={operators} onSelect={select} windowLabel={`${days}d`} />}

      {/* ── Ask — after every KPI zone, before the roster (user-ordered 2026-07-30) ── */}
      {operators.length > 0 && <OversightAsk />}

      {/* ── Full-width roster table ── */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Members</h2>
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{totals?.active_sessions ?? 0} active session{(totals?.active_sessions ?? 0) === 1 ? "" : "s"}</span>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-16 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin" /> Loading team activity…</div>
      ) : isError ? (
        // A non-403 failure previously fell through to "No members yet" (misleading). Show an honest
        // retryable error instead — shared primitive, no internals exposed.
        <ErrorState error={new Error("Couldn't load Team Intelligence right now.")} onRetry={() => refetch()} />
      ) : operators.length === 0 ? (
        <div className="border-y px-5 py-14 text-center" style={{ borderColor: "var(--border-soft)" }}>
          <Users size={20} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
          <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>No members yet</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Activity and AI usage appear here as members work. <Link to="/settings/members" className="font-medium hover:underline" style={{ color: "var(--section-accent)" }}>Invite members</Link>.</p>
        </div>
      ) : (
        <RosterTable operators={operators} selectedId={selectedId} onSelect={select} compareBy={compareBy}
          detailFor={(op) => <MemberDetail op={op} adv={advancedQ.data} />} />
      )}

      {/* ── Goals & targets — below the members roster (user-ordered 2026-07-30) ── */}
      {operators.length > 0 && <div className="mt-6"><GoalsPanel operators={operators} /></div>}
    </div>
  );
}


/** In-page member dossier — identity, metrics, AI behaviour, activity chart + timeline, actions. */
function MemberDetail({ op, adv }: { op: Operator; adv?: AdvancedResp }) {
  const navigate = useNavigate();
  const v = VERDICT[op.verdict];
  const scope = `${op.name}${op.email ? ` (${op.email})` : ""}`;
  // This member's real velocity (task lead / decision cycle) from the advanced payload, if present.
  const myVel = adv?.velocity.per_member.find(m => m.operator_id === op.operator_id) ?? null;
  // This member's goals (shares the GoalsPanel query cache) — live attainment against real targets.
  const goalsQ = useQuery<GoalsResp>({ queryKey: ["oversight-goals"], queryFn: () => apiClient.get<GoalsResp>("/activities/goals"), retry: false });
  const myGoals = (goalsQ.data?.goals ?? []).filter(g => g.target_user_id === op.operator_id);

  const timelineQ = useQuery<{ activity: ActivityRow[] }>({
    queryKey: ["oversight-actor", op.operator_id],
    queryFn: () => apiClient.get<{ activity: ActivityRow[] }>(`/activities/oversight?actor=${encodeURIComponent(op.operator_id)}&limit=100`),
    retry: false,
  });
  const timeline = useMemo(() => (Array.isArray(timelineQ.data?.activity) ? timelineQ.data!.activity : []), [timelineQ.data]);

  // This member's VALUE outcomes (same engine as the team Sales strip — one source of truth).
  const [period] = usePeriod("mondaily_oversight_period");
  const outcomesQ = useOutcomes(period);
  const myOutcome = outcomesQ.data?.members.find((m) => m.user_id === op.operator_id) ?? null;
  const outcomesCur = outcomesQ.data?.base_currency ?? "";

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
  // Clean tabbed profile (was one long inline document). Tabs only gate visibility — every
  // query still auto-runs and every handler is preserved.
  type MemberTab = "overview" | "quality" | "ai" | "activity" | "timeline";
  const [tab, setTab] = useState<MemberTab>("overview");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  async function runReport(mode: "download" | "email") {
    setReportBusy(true);
    try {
      const r = await apiClient.post<{ ok: boolean; html: string; emailed: boolean; reason?: string }>("/activities/member-report", { actor_id: op.operator_id, days: 30, email: mode === "email" });
      if (mode === "email") {
        setReportMsg(r.emailed ? `Report emailed to ${op.name}.` : "Couldn't send — mail isn't configured or the send failed.");
      } else {
        const url = URL.createObjectURL(new Blob([r.html], { type: "text/html" }));
        const a = document.createElement("a"); a.href = url; a.download = `${op.name.replace(/\s+/g, "-").toLowerCase()}-report.html`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch { setReportMsg("Couldn't build the report right now."); }
    finally { setReportBusy(false); }
  }
  const TABS: { id: MemberTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "quality", label: "Work quality" },
    { id: "ai", label: "AI review" },
    { id: "activity", label: "Activity" },
    { id: "timeline", label: "Timeline" },
  ];

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
    <div className="overflow-hidden border-y" style={{ borderColor: "var(--border-soft)" }}>
      {/* Identity zone — a recessed profile header: avatar, name + status/evaluation pills, the honest
          role/session line and (when present) the source-backed evaluation basis, with the primary
          contact/report actions on the right. One cohesive block instead of two stacked border rows. */}
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--surface-hover) 45%, transparent)" }}>
        <Avatar op={op} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>{op.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: v.tone, background: `color-mix(in srgb, ${v.tone} 12%, transparent)` }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.tone }} /> {v.label}
            </span>
            {op.evaluation && (
              <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: EVAL_TONE[op.evaluation.tone], background: `color-mix(in srgb, ${EVAL_TONE[op.evaluation.tone]} 12%, transparent)` }}>
                {op.evaluation.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            {op.email ?? op.role} · <span className="capitalize">{op.role}</span>
            {op.has_session ? <span style={{ color: "var(--status-ok)" }}> · active session</span> : <span> · {ago(op.last_active_at)}</span>}
          </div>
          {op.evaluation && <p className="mt-1 line-clamp-2 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>{op.evaluation.basis}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => navigate(`/messages?to=${encodeURIComponent(op.operator_id)}`)} title="Message" aria-label={`Message ${op.name}`}
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <Send size={11} style={{ color: "var(--section-accent)" }} /> Message
          </button>
          {callCap.data?.enabled && (
            <>
              <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "audio", name: op.name })} title="Call" aria-label={`Call ${op.name}`} className="btn-icon h-7 w-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"><Phone size={13} /></button>
              <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "video", name: op.name })} title="Video" aria-label={`Video call ${op.name}`} className="btn-icon h-7 w-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"><Video size={13} /></button>
            </>
          )}
          {/* Report menu — a REAL composed report (KPIs, bar charts, grounded AI paragraph) from
              POST /activities/member-report. Download exports the HTML; Email sends it to the
              member's address (server resolves the recipient — never client-supplied). */}
          <ActionMenu triggerLabel={reportBusy ? "Report…" : "Report"} align="right" ariaLabel={`Report actions for ${op.name}`} items={[
            { key: "download", label: "Download report", icon: Printer, disabled: reportBusy, onClick: () => void runReport("download") },
            { key: "email", label: `Email report to ${op.name.split(" ")[0]}`, icon: Send, disabled: reportBusy, onClick: () => void runReport("email") },
            { key: "print", label: "Print this page", icon: Printer, onClick: () => window.print() },
          ]} />
          {reportMsg && <span className="text-[10.5px]" style={{ color: "var(--text-muted)" }} role="status">{reportMsg}</span>}
        </div>
      </div>

      {/* Tab bar — one clean profile surface. Tabs only gate visibility; every query still runs. */}
      <div role="tablist" aria-label={`${op.name} dossier sections`} className="flex items-center gap-1 overflow-x-auto border-b px-3 pt-2" style={{ borderColor: "var(--border-soft)" }}>
        {TABS.map((tb) => (
          <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}
            className="shrink-0 rounded-t-sm px-2.5 py-1.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
            style={{ color: tab === tb.id ? "var(--text-primary)" : "var(--text-muted)", borderBottom: `2px solid ${tab === tb.id ? "var(--section-accent)" : "transparent"}` }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Member metrics — the SHARED MetricGrid (same tile look everywhere). Real values only.
          Flat padded blocks, not border-ruled slabs — the panel is one composed dossier. */}
      {tab === "overview" && (<>
      {/* Overview as a dashboard — the same real numbers, grouped into meaningful sections (workload
          in flight · delivered · AI & comms) instead of one 9-tile wall. Each is the shared MetricGrid. */}
      <div className="py-1">
        {/* Dense overview — full-width hairline strips instead of five sparse 3-col sections
            (the "empty layer" complaint: each old row used a third of the width). Same numbers. */}
        <div className="px-4 pt-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Work · delivered</p>
          <MetricGrid cols={6} items={[
            { label: "Tasks", value: fmt(op.task_count) },
            { label: "Open", value: fmt(op.open_tasks ?? 0) },
            { label: "Overdue", value: fmt(op.overdue_tasks ?? 0), tone: (op.overdue_tasks ?? 0) > 0 ? "var(--status-warn)" : undefined },
            { label: "Completed", value: fmt(op.completed_tasks ?? 0) },
            { label: "Records touched", value: fmt(op.records_touched ?? 0) },
            { label: "Decisions", value: fmt(op.decisions_resolved ?? 0) },
          ]} />
        </div>
        <div className="px-4 pt-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>AI · comms{myVel && (myVel.task_lead.sample > 0 || myVel.decision_cycle.sample > 0) ? " · velocity" : ""}</p>
          <MetricGrid cols={6} items={[
            { label: "AI credits", value: fmt(op.tokens) },
            { label: "Credits / task", value: fmt(op.complexity_delta) },
            { label: "Messages", value: fmt(op.messages_sent ?? 0) },
            ...(myVel && (myVel.task_lead.sample > 0 || myVel.decision_cycle.sample > 0) ? [
              { label: "Task lead time", value: myVel.task_lead.avg_days != null ? `${myVel.task_lead.avg_days}d` : "—" },
              { label: "On-time", value: myVel.task_lead.on_time_rate != null ? `${myVel.task_lead.on_time_rate}%` : "—" },
              { label: "Decision cycle", value: myVel.decision_cycle.avg_hours != null ? `${myVel.decision_cycle.avg_hours}h` : "—" },
            ] : []),
          ]} />
        </div>
        {((op.deals_owned ?? 0) > 0 || (op.deals_updated ?? 0) > 0) && (
          <div className="px-4 pt-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Deals</p>
            <MetricGrid cols={5} items={[
              { label: "Deals owned", value: fmt(op.deals_owned ?? 0) },
              { label: "Open", value: fmt(op.deals_open ?? 0) },
              { label: "Won", value: fmt(op.deals_won ?? 0), tone: "var(--status-ok)" },
              { label: "Lost", value: fmt(op.deals_lost ?? 0), tone: "var(--status-error)" },
              { label: "Updated", value: fmt(op.deals_updated ?? 0) },
            ]} />
            {myOutcome && (
              <div className="mt-3">
                <MetricGrid cols={4} items={[
                  { label: "Value won", value: fmtMoney0(myOutcome.value_won, outcomesCur), tone: myOutcome.value_won > 0 ? "var(--status-ok)" : undefined },
                  { label: "Value lost", value: fmtMoney0(myOutcome.value_lost, outcomesCur), tone: myOutcome.value_lost > 0 ? "var(--status-error)" : undefined },
                  { label: "Pipeline", value: fmtMoney0(myOutcome.pipeline_value, outcomesCur) },
                  { label: "Win rate", value: myOutcome.win_rate_pct != null ? `${myOutcome.win_rate_pct}%` : "—" },
                ]} />
              </div>
            )}
          </div>
        )}
        {/* This member's goals — live attainment against real targets (only their own goals). */}
        {myGoals.length > 0 && (
          <Section title="Goals">
            <div className="space-y-2">
              {myGoals.map(g => {
                const pct = g.attainment_pct; const tone = pct >= 100 ? "var(--status-ok)" : pct >= 60 ? "var(--section-accent)" : pct >= 30 ? "var(--status-warn)" : "var(--status-error)";
                return (
                  <div key={g.id}>
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span style={{ color: "var(--text-secondary)" }}>{GOAL_METRIC_LABEL[g.metric]} <span style={{ color: "var(--text-faint)" }}>· {g.window_days}d</span></span>
                      <span className="tabular-nums" style={{ color: tone }}>{g.actual}/{g.target_value} · {pct}%</span>
                    </div>
                    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}><span className="block h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: tone }} /></span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>
      </>)}

      {/* ── AI Work-Efficiency Review — on-demand, grounded, actionable (AI review tab) ── */}
      {tab === "ai" && (
      <div className="px-4 py-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-faint)" }}>
            <Sparkles size={12} style={{ color: "var(--section-accent)" }} /> AI work-efficiency review
          </p>
          {!efficiency.data && (
            <button onClick={() => efficiency.mutate()} disabled={efficiency.isPending} aria-label={`Generate AI work-efficiency review for ${op.name}`}
              className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}>
              {efficiency.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} style={{ color: "var(--section-accent)" }} />} Generate review
            </button>
          )}
        </div>
        {/* What the Signal Agent reads + its advisory nature — honest scope, no productivity fiction. */}
        <p className="mb-2.5 text-[10.5px] leading-snug" style={{ color: "var(--text-faint)" }}>
          Reads recorded activity only — tasks, records, decisions, AI usage &amp; messages. Advisory: it summarizes and suggests; you decide.
        </p>
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
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--status-ok)" }}>Strengths</p>
                    <ul className="space-y-1">{e.strengths.map((s, i) => <li key={i} className="flex gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--status-ok)" }} />{s}</li>)}</ul>
                  </div>
                )}
                {e.improvements.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--status-warn)" }}>Where to improve</p>
                    <ul className="space-y-1">{e.improvements.map((s, i) => <li key={i} className="flex gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--status-warn)" }} />{s}</li>)}</ul>
                  </div>
                )}
              </div>
              {e.coaching_message && (
                <div className="rounded-sm border p-3" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Coaching message for {op.name.split(" ")[0]}</p>
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
      )}

      {/* Work quality tab — source-backed signals computed server-side; every one cites its real basis */}
      {tab === "quality" && op.quality && op.quality.length > 0 && (
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

      {/* Activity tab — real, premium area+line chart */}
      {tab === "activity" && (
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
      )}

      {/* AI coaching summary — grounded, source-backed (AI review tab) */}
      {tab === "ai" && (
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
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Sources · real activity</p>
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
      )}

      {/* derived behaviour signals — real, from matrix metrics (Work quality tab) */}
      {tab === "quality" && (
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
      )}

      {/* activity timeline — real, grouped by lens with source links where a node is known (Timeline tab) */}
      {tab === "timeline" && (
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
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{group} · {rows.length}</div>
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
      )}

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

/** Flat dossier section — the SAME shared header style as the Decisions dossier (mono uppercase
 *  tick, no full-width border slab), so the member panel reads as one composed document instead
 *  of a stack of ruled boxes. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4">
      <DossierSection title={title}>{children}</DossierSection>
    </div>
  );
}
function Signal({ label, ok, okText, offText, neutral }: { label: string; ok: boolean; okText: string; offText: string; neutral?: boolean }) {
  const tone = ok ? "var(--status-ok)" : neutral ? "var(--text-faint)" : "var(--status-warn)";
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="inline-flex items-center gap-1.5" style={{ color: tone }}>
        <ShieldCheck size={12} /> {ok ? okText : offText}
      </span>
    </div>
  );
}
