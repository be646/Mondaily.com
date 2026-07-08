import { useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Lock, ArrowLeft, Loader2, User as UserIcon, ShieldCheck, MessageSquare, Users, ChevronRight, History, Sparkles, Send, Phone, Video } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestCall } from "../../lib/call-bus";

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
  good: "#10b981", watch: "#d97706", risk: "#e11d48", insufficient: "var(--text-faint)",
};
const EVAL_TONE: Record<EvalLabel["tone"], string> = {
  good: "#10b981", watch: "#d97706", risk: "#e11d48", neutral: "var(--text-faint)",
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

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  engaged:         { label: "Engaged",        tone: "#10b981" },
  high_complexity: { label: "Deep work",      tone: "#10b981" },
  bot:             { label: "Power user",     tone: "#10b981" },
  low_engagement:  { label: "Low engagement", tone: "#d97706" },
  inactive:        { label: "Inactive",       tone: "#d97706" },
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
      <MetricBars title="Workload" hint="Open tasks assigned" operators={operators} tone="#3b82f6" onSelect={onSelect} value={(o) => (o.open_tasks ?? 0) + (o.overdue_tasks ?? 0)} />
      <MetricBars title="Overdue work" hint="Overdue tasks by member" operators={operators} tone="#e11d48" onSelect={onSelect} value={(o) => o.overdue_tasks ?? 0} />
      <MetricBars title="Decisions resolved" hint="Approvals/rejections (30d)" operators={operators} tone="#10b981" onSelect={onSelect} value={(o) => o.decisions_resolved ?? 0} />
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

/** Team-wide 30-day trends — all from real timestamps (activity, AI usage, decisions). */
function TeamTrends({ trends }: { trends: NonNullable<MatrixResp["trends"]> }) {
  const cards: { title: string; hint: string; tone: string; pts: TrendPoint[] }[] = [
    { title: "Activity", hint: "Recorded actions / day", tone: "var(--section-accent)", pts: trends.activity ?? [] },
    { title: "Tasks completed", hint: "Finished tasks / day", tone: "#10b981", pts: trends.tasks_completed ?? [] },
    { title: "AI usage", hint: "Credits / day", tone: "#3b82f6", pts: trends.ai_usage ?? [] },
    { title: "Decisions resolved", hint: "Approvals & rejections / day", tone: "#8b5cf6", pts: trends.decisions ?? [] },
  ];
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => {
        const total = c.pts.reduce((s, p) => s + p.value, 0);
        return (
          <div key={c.title} className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{c.title}</span>
              <span className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{fmt(total)}</span>
            </div>
            <div className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>{c.hint} · 30d</div>
            {total === 0 ? <div className="py-2 text-[11px]" style={{ color: "var(--text-faint)" }}>No data yet.</div> : <Sparkline points={c.pts} tone={c.tone} />}
          </div>
        );
      })}
    </div>
  );
}

interface AskResp { answer: string; sources: { type: string; title: string }[]; sufficient: boolean }
/** Grounded Ask-AI over real team data. Renders the answer + the exact source lines it used. */
function OversightAsk() {
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: (question: string) => apiClient.post<AskResp>("/activities/oversight-ask", { question }) });
  const suggestions = ["Who has the most overdue work?", "Who is contributing to decisions?", "How is deal ownership spread across the team?"];
  return (
    <div className="mb-6 rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={14} style={{ color: "var(--section-accent)" }} />
        <span className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>Ask about your team</span>
        <span className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>grounded in real data — no guesses</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask.mutate(q.trim()); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Who is at risk of overdue work?"
          className="key-input h-9 flex-1 px-3 text-[13px]" />
        <button type="submit" disabled={ask.isPending || !q.trim()}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {ask.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Ask
        </button>
      </form>
      {!ask.data && !ask.isPending && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => { setQ(s); ask.mutate(s); }}
              className="rounded-full border px-2.5 py-1 text-[10.5px] transition-colors hover:text-[var(--text-primary)]"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{s}</button>
          ))}
        </div>
      )}
      {ask.data && (
        <div className="mt-3">
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
        </div>
      )}
    </div>
  );
}

export function TeamOversightPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("member");

  const { data, isLoading, isError, error } = useQuery<MatrixResp>({
    queryKey: ["oversight-matrix"],
    queryFn: () => apiClient.get<MatrixResp>("/activities/oversight-matrix"),
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
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>Team Intelligence</h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>How each member contributes, behaves, and uses AI — real activity only.</p>
      </div>

      {/* ── Team overview — real aggregates ── */}
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-sm border sm:grid-cols-4" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
        {[
          { label: "Members", value: totals?.operators ?? operators.length },
          { label: "Active today", value: activeTodayCount },
          { label: "Tasks (30d)", value: totalTasks },
          { label: "AI credits (30d)", value: totals ? fmt(totals.tokens) : "—" },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3" style={{ background: "var(--surface-card)" }}>
            <div className="text-[22px] font-semibold leading-none tabular-nums" style={{ color: "var(--text-primary)" }}>{s.value}</div>
            <div className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Team-wide 30-day trends (real timestamps) ── */}
      {data?.trends && <TeamTrends trends={data.trends} />}

      {/* ── Grounded Ask-AI over real team data ── */}
      {operators.length > 0 && <OversightAsk />}

      {/* ── Team charts — real per-member distributions (ledger-style horizontal bars) ── */}
      {operators.length > 0 && <TeamCharts operators={operators} onSelect={select} />}

      {/* ── Master–detail: ledger (left) + dossier (right) ── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ledger */}
        <div>
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
            <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
                {operators.map((op) => {
                  const v = VERDICT[op.verdict];
                  const isSel = op.operator_id === selectedId;
                  return (
                    <button key={op.operator_id} onClick={() => select(op.operator_id)}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ background: isSel ? "var(--surface-selected)" : undefined }}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar op={op} />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{op.name}</div>
                          <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>
                            {activeToday(op.last_active_at) && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "#10b981" }} />}
                            {ago(op.last_active_at)} · {op.task_count} tasks · {fmt(op.tokens)} cr
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="hidden items-center gap-1.5 text-[11.5px] sm:inline-flex" style={{ color: "var(--text-secondary)" }}>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: v.tone }} /> {v.label}
                        </span>
                        <ChevronRight size={14} className="shrink-0" style={{ color: isSel ? "var(--section-accent)" : "var(--text-faint)" }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* dossier */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          {selected ? <MemberDetail op={selected} />
            : <div className="flex items-center justify-center rounded-sm border px-6 py-20 text-center" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", minHeight: 280 }}>
                <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>Select a member to see their activity, AI usage, and behaviour.</p>
              </div>}
        </div>
      </div>
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
      {/* identity */}
      <div className="flex items-center gap-3 border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
        <Avatar op={op} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{op.name}</div>
          <div className="truncate text-[11.5px]" style={{ color: "var(--text-faint)" }}>
            {op.email ?? op.role} · {op.role}
            {op.has_session ? <span style={{ color: "#10b981" }}> · online</span> : <span> · {ago(op.last_active_at)}</span>}
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: v.tone, background: `color-mix(in srgb, ${v.tone} 12%, transparent)` }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.tone }} /> {v.label}
        </span>
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

      {/* tracked metrics */}
      <div className="grid grid-cols-3 gap-px border-b" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
        {[
          { k: "Tasks (30d)", val: String(op.task_count) },
          { k: "AI credits", val: fmt(op.tokens) },
          { k: "Credits / task", val: fmt(op.complexity_delta) },
        ].map((m) => (
          <div key={m.k} className="px-3 py-3" style={{ background: "var(--surface-card)" }}>
            <div className="text-[17px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{m.val}</div>
            <div className="mt-0.5 text-[10.5px]" style={{ color: "var(--text-muted)" }}>{m.k}</div>
          </div>
        ))}
      </div>

      {/* real work rollups — computed server-side from tasks + activity + messages + decisions */}
      <div className="grid grid-cols-3 gap-px border-b" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
        {[
          { k: "Records touched", val: op.records_touched ?? 0 },
          { k: "Open tasks", val: op.open_tasks ?? 0 },
          { k: "Overdue", val: op.overdue_tasks ?? 0, warn: (op.overdue_tasks ?? 0) > 0 },
          { k: "Completed", val: op.completed_tasks ?? 0 },
          { k: "Messages (30d)", val: op.messages_sent ?? 0 },
          { k: "Decisions (30d)", val: op.decisions_resolved ?? 0 },
        ].map((m) => (
          <div key={m.k} className="px-3 py-2.5" style={{ background: "var(--surface-card)" }}>
            <div className="text-[15px] font-semibold tabular-nums" style={{ color: m.warn ? "#d97706" : "var(--text-primary)" }}>{fmt(m.val)}</div>
            <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>{m.k}</div>
          </div>
        ))}
      </div>

      {/* deals / opportunities — real tallies (ownership resolved from node data + created_by) */}
      {((op.deals_owned ?? 0) > 0 || (op.deals_updated ?? 0) > 0) && (
        <div className="grid grid-cols-5 gap-px border-b" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
          {[
            { k: "Deals owned", val: op.deals_owned ?? 0 },
            { k: "Open", val: op.deals_open ?? 0 },
            { k: "Won", val: op.deals_won ?? 0, tone: "#10b981" },
            { k: "Lost", val: op.deals_lost ?? 0, tone: "#e11d48" },
            { k: "Updated", val: op.deals_updated ?? 0 },
          ].map((m) => (
            <div key={m.k} className="px-2.5 py-2.5" style={{ background: "var(--surface-card)" }}>
              <div className="text-[15px] font-semibold tabular-nums" style={{ color: m.tone ?? "var(--text-primary)" }}>{fmt(m.val)}</div>
              <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>{m.k}</div>
            </div>
          ))}
        </div>
      )}

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

      {/* activity over time — real */}
      <Section title="Activity over time · last 14 days">
        <div className="flex items-end gap-[3px]" style={{ height: 48 }}>
          {chart.days.map((d) => (
            <div key={d.key} className="group relative flex-1" title={`${d.key}: ${d.count}`}>
              <div className="w-full rounded-sm" style={{ height: `${Math.max(2, (d.count / chart.max) * 46)}px`, background: d.count ? "var(--section-accent)" : "var(--border-soft)", opacity: d.count ? 1 : 0.6 }} />
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Recorded activity events per day. Hours are not tracked yet.</p>
      </Section>

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
      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        <button onClick={() => navigate(`/messages?to=${encodeURIComponent(op.operator_id)}`)}
          className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <Send size={11} style={{ color: "var(--section-accent)" }} /> Message
        </button>
        {callCap.data?.enabled && (
          <>
            <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "audio", name: op.name })}
              className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <Phone size={11} style={{ color: "var(--section-accent)" }} /> Call
            </button>
            <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "video", name: op.name })}
              className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <Video size={11} style={{ color: "var(--section-accent)" }} /> Video
            </button>
            {callCap.data?.recording && (
              <button onClick={() => requestCall({ inviteeId: op.operator_id, kind: "audio", name: op.name, record: true })}
                title="Records the call and saves a transcript to Meeting Memory (both participants are notified on screen)."
                className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                <Phone size={11} style={{ color: "var(--section-accent)" }} /> Call + record
              </button>
            )}
          </>
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
  const tone = ok ? "#10b981" : neutral ? "var(--text-faint)" : "#d97706";
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="inline-flex items-center gap-1.5" style={{ color: tone }}>
        <ShieldCheck size={12} /> {ok ? okText : offText}
      </span>
    </div>
  );
}
