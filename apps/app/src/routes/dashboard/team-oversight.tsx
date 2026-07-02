import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, ArrowLeft, Loader2, User as UserIcon, X, ShieldCheck, MessageSquare, Users, ChevronRight, History } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestAsk } from "../../lib/ask-bus";

/**
 * Team Intelligence — an AI-powered team behaviour & value dashboard for owners/admins.
 * REAL data only: /activities/oversight-matrix (per-operator tokens/runs/tasks/last-active/verdict,
 * from ai_usage + activities + live sessions) and /activities/oversight?actor= (activity timeline).
 * Premium ledger rows + a dossier drawer — no terminal gimmicks, no fabricated scores.
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

// Plain, calm verdict language + a single status-dot tone (green = healthy, amber = attention, muted = quiet).
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

/** Honest, data-derived behaviour insights — only shown when the real metrics support them. */
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
  const [selected, setSelected] = useState<Operator | null>(null);

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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>Team Intelligence</h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>How each member contributes, behaves, and uses AI — real activity only.</p>
      </div>

      {/* ── Team overview — real aggregates ── */}
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-sm border sm:grid-cols-4" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
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

      {/* ── Member ledger ── */}
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
          {/* column header (desktop) */}
          <div className="hidden grid-cols-[1.8fr_1fr_1fr_1.1fr] gap-3 border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wider sm:grid" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>
            <span>Member</span><span>Last active</span><span className="tabular-nums">Tasks · AI</span><span>Behaviour</span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {operators.map((op) => {
              const v = VERDICT[op.verdict];
              return (
                <button key={op.operator_id} onClick={() => setSelected(op)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] sm:grid-cols-[1.8fr_1fr_1fr_1.1fr]">
                  {/* member */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar op={op} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{op.name}</div>
                      <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>{op.email ?? op.role}</div>
                    </div>
                  </div>
                  {/* last active */}
                  <div className="hidden items-center gap-1.5 text-[11.5px] sm:flex" style={{ color: "var(--text-muted)" }}>
                    {activeToday(op.last_active_at) && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#10b981" }} />}
                    {ago(op.last_active_at)}
                  </div>
                  {/* tasks · AI */}
                  <div className="hidden text-[12px] tabular-nums sm:block" style={{ color: "var(--text-secondary)" }}>
                    {op.task_count} · <span style={{ color: "var(--text-muted)" }}>{fmt(op.tokens)} cr</span>
                  </div>
                  {/* behaviour + chevron */}
                  <div className="flex items-center justify-end gap-2 sm:justify-between">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: v.tone }} /> {v.label}
                    </span>
                    <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-faint)" }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && <MemberDossier op={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Member detail drawer — an intelligence dossier: metrics, AI behaviour analysis, activity, actions. */
function MemberDossier({ op, onClose }: { op: Operator; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ activity: ActivityRow[] }>({
    queryKey: ["oversight-actor", op.operator_id],
    queryFn: () => apiClient.get<{ activity: ActivityRow[] }>(`/activities/oversight?actor=${encodeURIComponent(op.operator_id)}&limit=100`),
    retry: false,
  });
  const v = VERDICT[op.verdict];
  const timeline = Array.isArray(data?.activity) ? data!.activity : [];
  const scope = `${op.name}${op.email ? ` (${op.email})` : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label={`${op.name} dossier`}>
      <div className="flex-1 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col border-l shadow-2xl" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar op={op} size={34} />
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{op.name}</div>
              <div className="truncate text-[11px]" style={{ color: "var(--text-faint)" }}>
                {op.role} · {ago(op.last_active_at)}
                {op.has_session && <span style={{ color: "#10b981" }}> · online</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* metrics */}
          <div className="grid grid-cols-3 gap-px border-b" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
            {[
              { k: "Tasks", val: String(op.task_count) },
              { k: "AI credits", val: fmt(op.tokens) },
              { k: "Cr / task", val: fmt(op.complexity_delta) },
            ].map((m) => (
              <div key={m.k} className="px-3 py-3" style={{ background: "var(--surface-card)" }}>
                <div className="text-[16px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{m.val}</div>
                <div className="mt-0.5 text-[10.5px]" style={{ color: "var(--text-muted)" }}>{m.k}</div>
              </div>
            ))}
          </div>

          {/* behaviour verdict + AI analysis */}
          <Section title="AI behaviour analysis">
            <span className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: v.tone, background: `color-mix(in srgb, ${v.tone} 12%, transparent)` }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.tone }} /> {v.label}
            </span>
            <ul className="space-y-1.5">
              {insights(op).map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--text-faint)" }} />
                  {s}
                </li>
              ))}
            </ul>
          </Section>

          {/* verification signals — real */}
          <Section title="Signals">
            <div className="space-y-1.5 text-[12px]">
              <Signal label="Live native session" ok={op.has_session} okText="Active" offText="Offline" />
              <Signal label="Verified device claim (PoW)" ok={op.verified_pow} okText="Verified" offText="None on record" neutral={!op.verified_pow} />
            </div>
          </Section>

          {/* activity timeline — real */}
          <Section title="Activity timeline">
            {isLoading ? (
              <div className="flex items-center gap-2 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : timeline.length === 0 ? (
              <p className="py-1 text-[12px]" style={{ color: "var(--text-faint)" }}>No recorded activity in the last 30 days.</p>
            ) : (
              <div className="space-y-2.5">
                {timeline.slice(0, 40).map((a) => (
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
        </div>

        {/* admin actions — real destinations only */}
        <div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
          <Action icon={MessageSquare} label="Ask AI about this member" onClick={() => { requestAsk(`Summarise ${scope}'s recent activity, workload, and AI usage from real workspace data, and suggest one coaching action.`); onClose(); }} />
          <Link to="/settings/members" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <Users size={11} style={{ color: "var(--section-accent)" }} /> Manage role & access
          </Link>
          {op.email && (
            <a href={`mailto:${op.email}`} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <MessageSquare size={11} style={{ color: "var(--section-accent)" }} /> Message
            </a>
          )}
        </div>
      </aside>
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
function Action({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
      <Icon size={11} style={{ color: "var(--section-accent)" }} /> {label}
    </button>
  );
}
