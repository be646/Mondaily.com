import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, ArrowLeft, Loader2, User as UserIcon, X, Activity, Cpu, ShieldAlert, Gauge } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { agentByRaw } from "../../lib/agents";

/**
 * ABI — Autonomous Behavioral Intelligence · Team Oversight.
 * A monospace operations-center grid over real per-operator telemetry (/activities/oversight-matrix):
 * compute velocity from ai_usage, task context from activities, behavioral verdict computed server-side.
 */
type Verdict = "inactive" | "bot" | "low_engagement" | "high_complexity" | "engaged" | "idle";
interface Operator {
  operator_id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  role: string;
  tokens: number;
  runs: number;
  task_count: number;
  complexity_delta: number;
  last_task_id: string | null;
  last_action: string | null;
  last_active_at: string | null;
  has_session: boolean;
  verified_pow: boolean;
  verdict: Verdict;
}
interface MatrixResp { operators: Operator[]; totals: { operators: number; tokens: number; active_sessions: number } }

interface ActivityRow { id: string; action: string; ai_summary: string | null; object: { type: string; name: string | null } | null; created_at: string }

const shortHash = (id: string | null) => (id ? id.replace(/-/g, "").slice(0, 8).toUpperCase() : "——————");
const fmt = (n: number) => n.toLocaleString();
function ago(iso: string | null) {
  if (!iso) return "no signal";
  const d = new Date(iso); if (isNaN(d.getTime())) return "no signal";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const VERDICT: Record<Verdict, { label: string; color: string; bg: string }> = {
  inactive: { label: "⚠ INACTIVE OPERATOR", color: "#fb923c", bg: "rgba(251,146,60,0.10)" },
  bot: { label: "⚠ ANOMALOUS AUTOMATION / BOT DETECTED", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  low_engagement: { label: "• LOW ENGAGEMENT", color: "#fbbf24", bg: "rgba(251,191,36,0.10)" },
  high_complexity: { label: "✓ HIGH-COMPLEXITY DEEP-WORK", color: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  engaged: { label: "✓ HIGH-ENGAGEMENT EXECUTION", color: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  idle: { label: "• STANDBY", color: "#71717a", bg: "rgba(113,113,122,0.10)" },
};

/** Structural behavior warnings derived from the operator's live metrics. */
function warnings(op: Operator): string[] {
  const out: string[] = [];
  if (op.verdict === "inactive") out.push("Continuous system idling detected — zero ledger events in the 30-day window.");
  if (op.verdict === "bot") out.push("Unverified automation signature — heavy compute with no native session token claim (botnetting).");
  if (op.verdict === "low_engagement") out.push("Low compute-per-task — shallow / copy-paste interaction pattern detected.");
  if (op.verdict === "high_complexity") out.push("Sustained high compute-per-task — strategic deep-work signature (nominal).");
  if (op.tokens > 0 && op.task_count === 0) out.push("Compute expenditure without completed task rows — output anomaly.");
  if (op.complexity_delta > 25_000) out.push("Disproportionate compute-to-output ratio — efficiency delta degrading.");
  if (!op.has_session && op.tokens > 0) out.push("No live client session bound to active compute stream.");
  if (out.length === 0) out.push("Nominal — no structural behavior warnings on record.");
  return out;
}

function Avatar({ op, size = 28 }: { op: Operator; size?: number }) {
  if (op.avatar_url) return <img src={op.avatar_url} alt={op.name} style={{ width: size, height: size }} className="shrink-0 rounded-md object-cover" />;
  const initial = op.name?.trim()?.[0]?.toUpperCase();
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-[11px] font-semibold text-zinc-300">
      {initial || <UserIcon size={13} />}
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

  if (forbidden) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center font-mono">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900">
          <Lock size={20} style={{ color: "var(--accent)" }} />
        </span>
        <h1 className="text-lg font-semibold text-zinc-100">Manager access only</h1>
        <p className="mt-2 text-[13px] text-zinc-500">
          The ABI Oversight matrix surfaces every operator's behavioral telemetry. Only <strong className="text-zinc-300">Owners</strong> and <strong className="text-zinc-300">Admins</strong> may view it.
        </p>
        <button onClick={() => navigate("/home")} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-[13px] text-zinc-300 transition-colors hover:border-zinc-700">
          <ArrowLeft size={14} /> Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#09090b] font-mono text-zinc-300">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* ── Header / readiness banner ── */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>// ABI · Autonomous Behavioral Intelligence</p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-100">Operational Readiness Matrix</h1>
          </div>
          {totals && (
            <div className="flex gap-2 text-[11px]">
              {[
                ["OPERATORS", String(totals.operators)],
                ["TOKENS · 30D", fmt(totals.tokens)],
                ["LIVE SESSIONS", String(totals.active_sessions)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-zinc-600">{k}</div>
                  <div className="mt-0.5 tabular-nums text-zinc-200">{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-zinc-500"><Loader2 size={15} className="animate-spin" /> Synchronizing operator telemetry…</div>
        ) : operators.length === 0 ? (
          <div className="rounded-xl border border-[#27272a] bg-[#18181b] px-5 py-12 text-center">
            <Activity size={20} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-sm text-zinc-300">No operators registered.</p>
            <p className="mt-1 text-xs text-zinc-600">Behavioral telemetry will populate as members transact.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#27272a] bg-[#18181b]">
            {/* grid header */}
            <div className="grid grid-cols-[1.6fr_1fr_1.2fr_2fr] gap-3 border-b border-[#27272a] px-4 py-2.5 text-[9px] uppercase tracking-widest text-zinc-600">
              <span>Operator</span><span>Task Context</span><span>Compute Velocity</span><span>Behavioral Evaluation</span>
            </div>
            {operators.map((op, i) => {
              const v = VERDICT[op.verdict];
              return (
                <button
                  key={op.operator_id || i}
                  onClick={() => setSelected(op)}
                  className="grid w-full grid-cols-[1.6fr_1fr_1.2fr_2fr] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#202023]"
                  style={i > 0 ? { borderTop: "1px solid #27272a" } : undefined}
                >
                  {/* operator */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar op={op} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-zinc-100">{op.name}</div>
                      <div className="truncate text-[10px] uppercase tracking-wide text-zinc-600">{op.role}</div>
                    </div>
                  </div>
                  {/* task context — short-hash capsule */}
                  <div>
                    <span className="inline-block rounded border border-[#27272a] bg-[#0e0e10] px-2 py-0.5 text-[11px] tabular-nums text-zinc-400">#{shortHash(op.last_task_id)}</span>
                  </div>
                  {/* compute velocity */}
                  <div className="text-[12px] tabular-nums">
                    <span style={{ color: "var(--accent)" }}>{fmt(op.tokens)}</span>
                    <span className="text-zinc-600"> tok · {op.runs} runs</span>
                  </div>
                  {/* behavioral evaluation */}
                  <div>
                    <span className="inline-block rounded px-2 py-1 text-[10.5px] font-semibold tracking-wide" style={{ color: v.color, background: v.bg }}>
                      [{v.label}]
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && <DeepAudit op={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Slide-out individual operator deep-audit viewport. */
function DeepAudit({ op, onClose }: { op: Operator; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ activity: ActivityRow[] }>({
    queryKey: ["oversight-actor", op.operator_id],
    queryFn: () => apiClient.get<{ activity: ActivityRow[] }>(`/activities/oversight?actor=${encodeURIComponent(op.operator_id)}&limit=40`),
    retry: false,
  });
  const v = VERDICT[op.verdict];
  const timeline = Array.isArray(data?.activity) ? data!.activity : [];
  const efficiency = op.complexity_delta;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[#27272a] bg-[#09090b] font-mono shadow-[0_0_64px_rgba(0,0,0,0.8)] animate-[slideIn_.18s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}`}</style>
        {/* header */}
        <div className="flex items-center justify-between border-b border-[#27272a] px-5 py-4">
          <div className="flex items-center gap-3">
            <Avatar op={op} size={36} />
            <div>
              <div className="text-sm text-zinc-100">{op.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-600">{op.email ?? op.role} · {ago(op.last_active_at)}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-[#18181b] hover:text-zinc-200 transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* verdict */}
          <div className="rounded-lg border px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: v.color, background: v.bg, borderColor: "color-mix(in srgb, currentColor 30%, transparent)" }}>
            [{v.label}]
          </div>

          {/* efficiency delta */}
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-600"><Gauge size={11} /> Efficiency delta</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                [<Cpu size={12} key="c" />, "TOKENS", fmt(op.tokens)],
                [<Activity size={12} key="a" />, "TASKS", String(op.task_count)],
                [<Gauge size={12} key="g" />, "TOK / TASK", fmt(efficiency)],
              ].map(([icon, k, val], i) => (
                <div key={i} className="rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-zinc-600">{icon}{k}</div>
                  <div className="mt-1 tabular-nums text-[14px] text-zinc-100">{val}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-0.5 text-[10px] text-zinc-600">
              <div>PoW crypto claim: {op.verified_pow ? <span style={{ color: "var(--accent)" }}>VERIFIED ✓</span> : <span className="text-orange-400">NONE</span>}</div>
              <div>Native session: {op.has_session ? <span style={{ color: "var(--accent)" }}>ACTIVE ✓</span> : <span className="text-zinc-500">offline</span>}</div>
            </div>
          </section>

          {/* warnings log */}
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-600"><ShieldAlert size={11} /> Structural behavior log</div>
            <div className="space-y-1.5">
              {warnings(op).map((w, i) => (
                <div key={i} className="rounded border border-[#27272a] bg-[#0e0e10] px-3 py-2 text-[11px] leading-snug text-zinc-400">
                  <span className="text-zinc-700">›</span> {w}
                </div>
              ))}
            </div>
          </section>

          {/* automated run timeline */}
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-600"><Activity size={11} /> Automated run timeline</div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-4 text-[11px] text-zinc-600"><Loader2 size={12} className="animate-spin" /> Loading run history…</div>
            ) : timeline.length === 0 ? (
              <p className="py-3 text-[11px] text-zinc-600">No recorded agent runs in window.</p>
            ) : (
              <div className="space-y-px overflow-hidden rounded-lg border border-[#27272a]">
                {timeline.slice(0, 20).map((a, i) => (
                  <div key={a.id || i} className="flex items-start gap-2 bg-[#18181b] px-3 py-2">
                    <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-zinc-600">{ago(a.created_at)}</span>
                    <div className="min-w-0">
                      <span className="text-[11.5px] text-zinc-300">{(a.action || "action").replace(/_/g, " ")}</span>
                      {a.object?.name && <span className="text-[11px] text-zinc-600"> · {a.object.name}</span>}
                      {a.ai_summary && <p className="mt-0.5 text-[10.5px] leading-snug text-zinc-600">{a.ai_summary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
