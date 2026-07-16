import { useState } from "react";
import type { ElementType, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, ChevronDown, Play, RotateCcw, ArrowUpRight, ArrowRight, ShieldCheck } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader, MetricGrid } from "../../components/ui/controls";
import { agentByRaw, AGENTS } from "../../lib/agents";
import { useLanguage } from "../../hooks/useLanguage";
import { useAgentJobsRealtime } from "../../hooks/useAgentJobsRealtime";
import { useAgentData } from "../../components/ai/agent-dock";
import { AgentCard } from "../../components/ai/agent-constellation";
import { useDecisionQueue } from "../../components/ai/decision-queue";

/**
 * Agent Control Room (route /activity) — the canonical, honest surface for every workspace agent:
 * a live roster (GET /agents) + proof-of-work timeline (GET /agents/activity), with run-now
 * (POST /agents/:id/run) and replay (POST /agents/replay). No new route, no duplicated agent
 * logic — it composes the SAME shared registry + activity APIs the Home constellation previews.
 * Design mirrors Finance Reports: flat surfaces, thin dividers, ledger rows, calm status dots.
 */

// Agent ids with an on-demand runner (POST /agents/:id/run) — mirrors the backend AGENT_RUNNERS.
const RUNNABLE = new Set(["relationship", "operations", "finance", "graph-enrichment", "workflow", "opportunity", "people", "portfolio", "asset", "meeting"]);

// Roster ordering by REAL registry state — attention first, ghosts last. Pure view-sort; the
// state itself comes untouched from GET /agents (never upgraded for effect).
const STATE_ORDER: Record<string, number> = { issue: 0, needs_approval: 1, active: 2, monitoring: 3, disabled: 4, not_configured: 5 };

// The roster is GROUPED by real state into three honest clusters so the control room reads like one
// (agents needing you → agents working → dormant), not an undifferentiated wall of equal cards. The
// grouping is purely a view of the untouched registry states.
const ROSTER_GROUPS: { key: string; label: string; hint: string; states: string[]; quiet?: boolean }[] = [
  { key: "attention", label: "Needs you", hint: "blocked or awaiting your approval", states: ["issue", "needs_approval"] },
  { key: "working", label: "Working", hint: "active or monitoring your workspace", states: ["active", "monitoring"] },
  { key: "quiet", label: "Quiet", hint: "not configured or disabled", states: ["disabled", "not_configured"], quiet: true },
];

// Canonical proof-of-work step (matches the API's normalizeStep output).
type Step = {
  label: string;
  status?: "ok" | "warn" | "error" | "info";
  at?: string;
  detail?: string;
  sources?: { title: string; url?: string; node_id?: string }[];
};
type ActivityItem = {
  id: string; agent: string; trigger: string; status: string; summary: string;
  detail: Record<string, unknown>; steps: Step[]; error: string | null;
  duration_ms?: number | null;
  started_at: string; completed_at: string | null;
};

// Per-step status dot tone — mirrors the run tones (green ok, amber warn, rose error, muted info).
function stepTone(status?: string): string {
  return status === "ok" ? "#2f9e6b" : status === "warn" ? "#c6892e" : status === "error" ? "#d1524a" : "var(--text-muted)";
}

const agentOf = (raw: string) => { const a = agentByRaw(raw); return { label: a.name, Icon: a.Icon }; };

// Timeline run status → tone (derived from the DB status, never invented).
function runTone(status: string): string {
  return status === "completed" ? "#2f9e6b" : status === "failed" ? "#d1524a" : status === "running" ? "#c6892e" : "var(--text-muted)";
}
function runLabel(status: string): string {
  return status === "completed" ? "Success" : status === "failed" ? "Failed" : status === "running" ? "Running" : status;
}

function clockTime(iso?: string | null): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fullTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function duration(start?: string, end?: string | null): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

// Dependency-free JSON highlighter (renders React text nodes — no HTML injection).
function highlightJson(json: string): ReactNode[] {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let key = 0;
  while ((m = re.exec(json))) {
    if (m.index > last) out.push(json.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<span key={key++} style={{ color: m[2] ? "var(--text-primary)" : "var(--text-secondary)" }}>{m[1]}</span>);
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(<span key={key++} style={{ color: "#c6892e" }}>{m[3]}</span>);
    } else if (m[4] !== undefined) {
      out.push(<span key={key++} style={{ color: "var(--section-accent)" }}>{m[4]}</span>);
    }
    last = re.lastIndex;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}
function JsonBlock({ data, title }: { data: unknown; title: string }) {
  let json = "";
  try { json = JSON.stringify(data, null, 2); } catch { json = String(data); }
  return (
    <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
      <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{title}</div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{highlightJson(json)}</pre>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span className="inline-flex h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function AgentActivityPage() {
  const { t } = useLanguage();
  const [agentFilter, setAgentFilter] = useState<string | null>(null); // by LABEL
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showQuiet, setShowQuiet] = useState(false); // dormant agents collapse into a dense count by default

  const qc = useQueryClient();
  const live = useAgentJobsRealtime(() => qc.invalidateQueries({ queryKey: ["agent-activity"] }));

  // Agent scorecard — the trust surface for autonomy: per-agent approval rate + auto-approvals.
  const learnedQ = useQuery({
    queryKey: ["learned-preferences"],
    queryFn: () => apiClient.get<{ preferences: { agent_name: string; source_type: string; approved: number; rejected: number; resolved: number; approval_rate: number | null; verdict: "favored" | "neutral" | "disfavored" | "learning" }[]; summary: { favored: number; disfavored: number; patterns: number } }>("/decisions/learned-preferences"),
    staleTime: 60_000,
  });
  const scorecardQ = useQuery({
    queryKey: ["agent-scorecard"],
    queryFn: () => apiClient.get<{ days: number; agents: { agent: string; raised: number; approved: number; rejected: number; auto_approved: number; pending: number; resolved: number; approval_rate: number | null; autonomy_ready: boolean }[] }>("/decisions/agent-scorecard?days=30"),
    retry: false, staleTime: 60_000,
  });

  // Roster — the SAME shared registry the Home constellation uses (GET /agents).
  const { constellation, isLoading: rosterLoading } = useAgentData();
  // Pending approvals — the decision-queue bridge count.
  const { data: pendingDecisions } = useDecisionQueue();
  const pendingCount = pendingDecisions?.length ?? 0;

  // Proof-of-work timeline + today's real aggregates (GET /agents/activity).
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: () => apiClient.get<{
      activity: ActivityItem[];
      stats: { runs_today: number; errors_today: number; agents_today: string[] };
    }>(`/agents/activity?limit=120`),
    refetchInterval: (query) => {
      if (live.current) return 30_000;
      const acts = query.state.data?.activity ?? [];
      const hot = acts.some(a => a.status === "running" || Date.now() - new Date(a.started_at).getTime() < 60_000);
      return hot ? 2_000 : 8_000;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["agent-activity"] });
  const runAgent = useMutation({
    mutationFn: (id: string) => apiClient.post(`/agents/${id}/run`),
    onMutate: (id) => setBusy(id),
    onSettled: () => { setBusy(null); refresh(); qc.invalidateQueries({ queryKey: ["agent-registry"] }); },
  });
  const replayRun = useMutation({
    mutationFn: (jobId: string) => apiClient.post(`/agents/replay`, { jobId }),
    onMutate: (jobId) => setBusy(jobId),
    onSettled: () => { setBusy(null); refresh(); },
  });

  const all = data?.activity ?? [];
  const rows = all
    .filter(a => !statusFilter || a.status === statusFilter)
    .filter(a => !agentFilter || agentOf(a.agent).label === agentFilter);
  const statusCount = (k: string | null) => (k ? all.filter(a => a.status === k).length : all.length);

  const runsToday = data?.stats?.runs_today ?? 0;
  const errorsToday = data?.stats?.errors_today ?? 0;
  const activeAgents = constellation.filter(a => a.state === "active").length;

  const STATS = [
    { label: "Active agents", value: activeAgents },
    { label: "Runs today", value: runsToday },
    { label: "Errors today", value: errorsToday, alert: errorsToday > 0 },
    { label: "Pending approvals", value: pendingCount, accent: pendingCount > 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* ── 1. Shared command header — same pattern as Decisions. HONEST state (no fake 'Live'
             ping): 'working now' only when the backend reports agents actually active. ── */}
      <CommandPageHeader
        icon={ShieldCheck}
        callsign="CONTROL ROOM"
        title="Agent Control Room"
        subtitle="Proof-of-work for every workspace agent — real runs, real evidence."
        status={[{ label: activeAgents > 0 ? `${activeAgents} working now` : "all agents monitoring", kind: activeAgents > 0 ? "running" : "monitoring" }]}
        primaryAction={
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} /> Sync
          </button>
        }
      />
      {/* Shared MetricGrid — same primitive as Team Oversight/Credit Notes (was a third hand-rolled
          stat pattern). All four values are real: registry states, today's run/error aggregates,
          and the live decision-queue count. */}
      <MetricGrid className="mb-8" cols={4} items={STATS.map(s => ({
        label: s.label,
        value: s.value,
        tone: s.alert ? "#d1524a" : s.accent ? "var(--section-accent)" : undefined,
      }))} />

      {/* ── Trust & autonomy scorecard — per-agent approval rate + auto-approvals (last 30d). The
             trust surface that makes turning the autonomy dial up a confident, evidenced choice. ── */}
      {(scorecardQ.data?.agents.length ?? 0) > 0 && (
        <section className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Trust &amp; autonomy</h2>
            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>approval rate &amp; auto-approvals · last 30d</span>
          </div>
          <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border-soft)" }}>
                  {["Agent", "Raised", "Approval rate", "Auto-approved", "Pending"].map((h, i) => (
                    <th key={h} className={`px-4 py-2 text-[10px] font-medium uppercase tracking-wider ${i === 0 ? "text-left" : "text-right"}`} style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scorecardQ.data!.agents.map(a => {
                  const rate = a.approval_rate;
                  const tone = rate == null ? "var(--text-faint)" : rate >= 80 ? "#2f9e6b" : rate >= 50 ? "#c6892e" : "#d1524a";
                  return (
                    <tr key={a.agent} className="border-b last:border-0" style={{ borderColor: "var(--border-soft)" }}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{agentByRaw(a.agent).name}</span>
                          {a.autonomy_ready && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: "color-mix(in srgb, #2f9e6b 14%, transparent)", color: "#2f9e6b" }} title="High approval rate over a meaningful sample — a safe candidate to let self-approve">autonomy-ready</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>{a.raised}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                            <div className="h-full rounded-full" style={{ width: `${rate ?? 0}%`, background: tone }} />
                          </div>
                          <span className="w-9 text-right text-[12px] tabular-nums font-semibold" style={{ color: tone }}>{rate == null ? "—" : `${rate}%`}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12px] tabular-nums" style={{ color: a.auto_approved ? "var(--section-accent)" : "var(--text-faint)" }}>{a.auto_approved || "—"}</td>
                      <td className="px-4 py-2.5 text-right text-[12px] tabular-nums" style={{ color: a.pending ? "#c6892e" : "var(--text-faint)" }}>{a.pending || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Learned from you — deterministic learning loop. Aggregates the decisions YOU resolved by
             hand (autonomy auto-actions excluded) per agent + type, so the app shows what your agents
             have learned you want vs. don't. The honest, evidence-first half of "agents adapt to me". ── */}
      {(() => {
        const learned = (learnedQ.data?.preferences ?? []).filter(p => p.verdict === "favored" || p.verdict === "disfavored");
        if (learned.length === 0) return null;
        const V: Record<string, { label: string; tone: string }> = {
          favored: { label: "You approve", tone: "#2f9e6b" },
          disfavored: { label: "You reject", tone: "#d1524a" },
        };
        return (
          <section className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Learned from you</h2>
              <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>patterns from your own approvals &amp; rejections</span>
            </div>
            <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
              {learned.map((p, i) => {
                const v = V[p.verdict]!;
                return (
                  <div key={`${p.agent_name}-${p.source_type}-${i}`} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-0" style={{ borderColor: "var(--border-soft)" }}>
                    <span className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide" style={{ background: `color-mix(in srgb, ${v.tone} 14%, transparent)`, color: v.tone }}>{v.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--text-primary)" }}>
                      <span className="font-medium">{agentByRaw(p.agent_name).name}</span>
                      <span style={{ color: "var(--text-faint)" }}> · {p.source_type.replace(/_/g, " ")}</span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{p.approval_rate}% of {p.resolved}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 px-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
              Computed from your real decisions — the more you approve and reject, the sharper this gets.
            </p>
          </section>
        );
      })()}

      {/* ── 2. Agent roster (GET /agents) ── */}
      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{t("nav.agents")}</h2>
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{constellation.length} in this workspace</span>
        </div>
        {rosterLoading ? (
          <div className="flex items-center gap-2 rounded-sm border px-4 py-8 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading agents…</div>
        ) : (() => {
          // Shared AgentCard — the SAME card Home's constellation uses, now GROUPED by real state so
          // the control room reads like a triage board. One card-renderer, three honest clusters.
          const sorted = [...constellation].sort((x, y) => (STATE_ORDER[x.state] ?? 9) - (STATE_ORDER[y.state] ?? 9));
          const cardFor = (agent: typeof sorted[number]) => {
            const filtered = agentFilter === agent.name;
            const runnable = RUNNABLE.has(agent.id);
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={filtered}
                onSelect={() => setAgentFilter(filtered ? null : agent.name)}
                footer={(runnable || agent.to || (agent.backedBy && agent.backedBy.length > 0)) ? (
                  <div className="mt-1 flex items-center gap-2 border-t pt-2" style={{ borderColor: "var(--border-soft)" }}>
                    {/* Proof line — the REAL data sources this agent reads, as a quiet glyph + names. */}
                    {agent.backedBy && agent.backedBy.length > 0 && (
                      <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px]" style={{ color: "var(--text-faint)" }} title={`Reads from ${agent.backedBy.join(", ")}`}>
                        <ShieldCheck size={10} className="shrink-0" /> <span className="truncate">{agent.backedBy.join(" · ")}</span>
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {runnable && (
                        <button onClick={() => runAgent.mutate(agent.id)} disabled={busy === agent.id} title="Run this agent now"
                          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--section-accent)] disabled:opacity-50" style={{ color: "var(--text-muted)" }}>
                          {busy === agent.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run
                        </button>
                      )}
                      {agent.to && (
                        <Link to={agent.to} className="inline-flex items-center text-[11px] font-medium" style={{ color: "var(--section-accent)" }} title="Open related page">
                          <ArrowUpRight size={13} />
                        </Link>
                      )}
                    </div>
                  </div>
                ) : undefined}
              />
            );
          };
          return (
            <div className="space-y-4">
              {ROSTER_GROUPS.map(g => {
                const members = sorted.filter(a => g.states.includes(a.state));
                if (members.length === 0) return null;
                const collapsed = g.quiet && !showQuiet;
                return (
                  <div key={g.key}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: g.key === "attention" ? "#d1524a" : "var(--text-muted)" }}>{g.label}</span>
                      <span className="text-[10.5px] tabular-nums" style={{ color: "var(--text-faint)" }}>{members.length}</span>
                      <span className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>· {g.hint}</span>
                      {g.quiet && (
                        <button onClick={() => setShowQuiet(v => !v)} className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-medium transition-colors hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }}>
                          {collapsed ? "Show" : "Hide"} <ChevronDown size={11} style={{ transform: collapsed ? undefined : "rotate(180deg)" }} />
                        </button>
                      )}
                    </div>
                    {collapsed ? (
                      // Dense dormant row — names only, so quiet agents don't cost a grid of empty cards.
                      <button onClick={() => setShowQuiet(true)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border px-3 py-2 text-left text-[11px] transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-faint)" }}>
                        {members.map((a, i) => <span key={a.id}>{a.name.replace(" Agent", "")}{i < members.length - 1 ? " ·" : ""}</span>)}
                      </button>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{members.map(cardFor)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      {/* ── 4. Decision queue bridge (placed high — it's the action that matters) ── */}
      <Link to="/decisions" className="mb-8 flex items-center justify-between gap-3 rounded-sm border px-4 py-3 transition-colors hover:border-[color:var(--section-accent)]"
        style={{ borderColor: pendingCount > 0 ? "var(--section-accent-line)" : "var(--border-soft)", background: pendingCount > 0 ? "var(--section-accent-soft)" : "var(--surface-card)" }}>
        <div>
          <div className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {pendingCount > 0 ? `${pendingCount} awaiting your approval` : "Nothing awaiting approval"}
          </div>
          <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>{t("agents.subtitle")}</div>
        </div>
        <ArrowRight size={15} className="shrink-0" style={{ color: pendingCount > 0 ? "var(--section-accent)" : "var(--text-faint)" }} />
      </Link>

      {/* ── 3. Proof-of-work timeline (GET /agents/activity) ── */}
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Proof-of-work</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {([{ k: null, l: "All" }, { k: "completed", l: "Success" }, { k: "failed", l: "Errors" }, { k: "running", l: "Running" }]).map(s => {
              const on = statusFilter === s.k;
              return (
                <button key={s.l} onClick={() => setStatusFilter(s.k)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                  style={on ? { background: "var(--surface-selected)", color: "var(--section-accent)" } : { color: "var(--text-muted)" }}>
                  {s.l}<span className="tabular-nums opacity-60">{statusCount(s.k)}</span>
                </button>
              );
            })}
            {agentFilter && (
              <button onClick={() => setAgentFilter(null)} className="rounded-md border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                {agentFilter.replace(" Agent", "")} ✕
              </button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-10 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading activity…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
              {statusFilter === "running" ? "No agents computing right now — they fire on schedule and on events." : "No activity matches this filter."}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {rows.map((a) => {
                const { label } = agentOf(a.agent);
                const isOpen = expanded === a.id;
                const tone = runTone(a.status);
                const steps = Array.isArray(a.steps) ? a.steps : [];
                return (
                  <div key={a.id}>
                    <button onClick={() => setExpanded(isOpen ? null : a.id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]">
                      <span className="mt-[5px]"><StatusDot color={tone} /></span>
                      <span className="mt-px shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{clockTime(a.started_at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                          <span className="font-medium" style={{ color: "var(--text-primary)" }}>{label.replace(" Agent", "")}</span>
                          <span className="mx-1.5" style={{ color: "var(--text-faint)" }}>·</span>
                          <span style={{ color: a.status === "failed" ? "#d1524a" : "var(--text-secondary)" }}>{a.error || a.summary}</span>
                        </span>
                      </span>
                      <span className="mt-px hidden shrink-0 text-[10.5px] font-medium sm:inline" style={{ color: tone }}>{runLabel(a.status)}</span>
                      {duration(a.started_at, a.completed_at) && (
                        <span className="mt-px hidden shrink-0 text-[10px] tabular-nums md:inline" style={{ color: "var(--text-faint)" }}>{duration(a.started_at, a.completed_at)}</span>
                      )}
                      <ChevronDown size={13} className="mt-0.5 shrink-0 transition-transform" style={{ color: "var(--text-faint)", transform: isOpen ? "rotate(180deg)" : undefined }} />
                    </button>

                    {isOpen && (
                      <div className="space-y-3 border-t px-4 pb-3.5 pt-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
                          <Meta k="Trigger" v={a.trigger} />
                          <Meta k="Status" v={runLabel(a.status)} color={tone} />
                          <Meta k="Started" v={fullTime(a.started_at)} />
                          <Meta k="Took" v={duration(a.started_at, a.completed_at) || "—"} />
                        </div>

                        {/* Execution steps — real logged steps, else a truthful status-derived track */}
                        <div>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                            Execution{steps.length > 0 ? ` · ${steps.length} steps` : ""}
                          </div>
                          <div className="space-y-1.5">
                            {steps.length > 0 ? (
                              steps.map((s, si) => (
                                <div key={si} className="flex items-start gap-2 text-[11.5px]">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: stepTone(s.status) }} />
                                  <span className="shrink-0 tabular-nums" style={{ color: "var(--text-faint)" }}>{si + 1}.</span>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-2">
                                      <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
                                      {s.at && <span className="tabular-nums text-[10px]" style={{ color: "var(--text-faint)" }}>{clockTime(s.at)}</span>}
                                    </div>
                                    {s.detail && <div className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>{s.detail}</div>}
                                    {Array.isArray(s.sources) && s.sources.length > 0 && (
                                      <div className="mt-0.5 flex flex-wrap gap-1">
                                        {s.sources.map((src, xi) => src.url ? (
                                          <a key={xi} href={src.url} target="_blank" rel="noreferrer"
                                            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] hover:underline"
                                            style={{ background: "var(--surface-hover)", color: "var(--section-accent)" }}>
                                            {src.title}<ArrowUpRight size={9} />
                                          </a>
                                        ) : (
                                          <span key={xi} className="rounded-full px-1.5 py-px text-[10px]" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>{src.title}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                                {a.status === "running" ? "Executing…" : a.status === "failed" ? "Queued → executing → failed" : "Queued → executing → saved"}
                              </div>
                            )}
                          </div>
                        </div>

                        {a.error && (
                          <div className="rounded-sm border-l-2 py-2 pl-3 pr-2" style={{ borderColor: "#d1524a", background: "color-mix(in srgb, #d1524a 6%, transparent)" }}>
                            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#d1524a" }}>Error</div>
                            <div className="mt-0.5 break-words text-[11.5px]" style={{ color: "var(--text-secondary)" }}>{a.error}</div>
                          </div>
                        )}
                        {a.detail && Object.keys(a.detail).length > 0 && (
                          <JsonBlock data={a.detail} title="Output payload · agent_jobs.output" />
                        )}

                        <div className="flex items-center gap-2 pt-0.5">
                          <button onClick={() => replayRun.mutate(a.id)} disabled={busy === a.id}
                            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                            {busy === a.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                            {a.status === "failed" ? "Replay run" : "Re-run"}
                          </button>
                          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>re-dispatches with the original input payload</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 5. Sovereignty / observability note ── */}
      <div className="flex items-start gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
        <ShieldCheck size={13} className="mt-px shrink-0" />
        <p className="leading-relaxed">
          Every run above is scoped to this workspace and read straight from the agent job log — real triggers, real timings, real output payloads. No fabricated activity, no invented scores, no simulated states.
        </p>
      </div>
    </div>
  );
}

function Meta({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{k}</span>
      <span className="tabular-nums" style={{ color: color ?? "var(--text-secondary)" }}>{v}</span>
    </div>
  );
}

// Kept for any external importers of the icon-by-label helper (no behavior change).
export const iconForLabel = (label: string): ElementType => Object.values(AGENTS).find(a => a.name === label)?.Icon ?? AGENTS["operations"]!.Icon;
