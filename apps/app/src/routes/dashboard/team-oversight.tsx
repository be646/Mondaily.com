import { useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, ArrowLeft, Loader2, User as UserIcon, ShieldCheck, MessageSquare, Users, ChevronRight, History, Sparkles, Send } from "lucide-react";
import { apiClient } from "../../lib/api-client";

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
interface Operator {
  operator_id: string; name: string; email: string | null; avatar_url: string | null; role: string;
  tokens: number; runs: number; task_count: number; complexity_delta: number;
  last_task_id: string | null; last_action: string | null; last_active_at: string | null;
  has_session: boolean; verified_pow: boolean; verdict: Verdict;
}
interface MatrixResp { operators: Operator[]; totals: { operators: number; tokens: number; active_sessions: number } }
interface ActivityRow { id: string; action: string; ai_summary: string | null; object: { type: string; name: string | null } | null; changes?: { field: string; value: string }[]; created_at: string }
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

/** Metrics that the platform does NOT yet track per-member — shown honestly as "Not tracked yet". */
const UNTRACKED = ["Overdue tasks", "Follow-ups", "Deals closed", "Records touched", "Approvals", "Comments"];

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

      {/* untracked metrics — honest placeholders, never fake values */}
      <div className="grid grid-cols-3 gap-px border-b" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
        {UNTRACKED.map((k) => (
          <div key={k} className="px-3 py-2.5" style={{ background: "var(--surface-card)" }}>
            <div className="text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>Not tracked yet</div>
            <div className="mt-0.5 text-[10.5px]" style={{ color: "var(--text-muted)" }}>{k}</div>
          </div>
        ))}
      </div>

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

      {/* activity timeline — real */}
      <Section title="Activity timeline">
        {timelineQ.isLoading ? (
          <div className="flex items-center gap-2 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Loading…</div>
        ) : timeline.length === 0 ? (
          <p className="py-1 text-[12px]" style={{ color: "var(--text-faint)" }}>No recorded activity in the last 30 days.</p>
        ) : (
          <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
            {timeline.slice(0, 50).map((a) => (
              <div key={a.id} className="flex items-start gap-2.5">
                <History size={12} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                    <span className="font-medium capitalize" style={{ color: "var(--text-primary)" }}>{(a.action || "action").replace(/_/g, " ")}</span>
                    {a.object?.type && <span> · {a.object.type}</span>}
                    {a.object?.name && <span style={{ color: "var(--text-muted)" }}> "{a.object.name}"</span>}
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
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* actions — real destinations only */}
      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        <button onClick={() => navigate(`/messages?to=${encodeURIComponent(op.operator_id)}`)}
          className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <Send size={11} style={{ color: "var(--section-accent)" }} /> Message
        </button>
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
