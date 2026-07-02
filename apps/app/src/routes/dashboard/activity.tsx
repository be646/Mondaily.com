import { useState } from "react";
import type { ElementType, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, ChevronDown, Play, RotateCcw, ArrowUpRight, ArrowRight, ShieldCheck } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { agentByRaw, AGENTS } from "../../lib/agents";
import { useAgentJobsRealtime } from "../../hooks/useAgentJobsRealtime";
import { useAgentData, CONSTELLATION_STATE_LABEL, type ConstellationState } from "../../components/ai/agent-dock";
import { useDecisionQueue } from "../../components/ai/decision-queue";

/**
 * Agent Control Room (route /activity) — the canonical, honest surface for every workspace agent:
 * a live roster (GET /agents) + proof-of-work timeline (GET /agents/activity), with run-now
 * (POST /agents/:id/run) and replay (POST /agents/replay). No new route, no duplicated agent
 * logic — it composes the SAME shared registry + activity APIs the Home constellation previews.
 * Design mirrors Finance Reports: flat surfaces, thin dividers, ledger rows, calm status dots.
 */

// Agent ids with an on-demand runner (POST /agents/:id/run) — mirrors the backend AGENT_RUNNERS.
const RUNNABLE = new Set(["relationship", "operations", "finance", "graph-enrichment", "workflow", "opportunity", "people", "portfolio", "asset"]);

type ActivityItem = {
  id: string; agent: string; trigger: string; status: string; summary: string;
  detail: Record<string, unknown>; steps: unknown[]; error: string | null;
  started_at: string; completed_at: string | null;
};

const agentOf = (raw: string) => { const a = agentByRaw(raw); return { label: a.name, Icon: a.Icon }; };

// Calm, meaning-based status dot — never a decorative rainbow. Green = working, amber = waiting
// on you, rose = problem, muted = watching, faint = disabled/not configured.
function stateTone(state: ConstellationState): string {
  return state === "active" ? "#10b981"
    : state === "needs_approval" ? "#d97706"
    : state === "issue" ? "#e11d48"
    : state === "monitoring" ? "var(--text-muted)"
    : "var(--text-faint)";
}
// Timeline run status → tone (derived from the DB status, never invented).
function runTone(status: string): string {
  return status === "completed" ? "#10b981" : status === "failed" ? "#e11d48" : status === "running" ? "#d97706" : "var(--text-muted)";
}
function runLabel(status: string): string {
  return status === "completed" ? "Success" : status === "failed" ? "Failed" : status === "running" ? "Running" : status;
}

function relAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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
      out.push(<span key={key++} style={{ color: "#d97706" }}>{m[3]}</span>);
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
  const [agentFilter, setAgentFilter] = useState<string | null>(null); // by LABEL
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const qc = useQueryClient();
  const live = useAgentJobsRealtime(() => qc.invalidateQueries({ queryKey: ["agent-activity"] }));

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
      {/* ── 1. Header + status strip ── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent Control Room</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>Live proof-of-work for every workspace agent.</p>
        </div>
        <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} /> Sync
        </button>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-sm border sm:grid-cols-4" style={{ borderColor: "var(--border-soft)", background: "var(--border-soft)" }}>
        {STATS.map(s => (
          <div key={s.label} className="px-4 py-3" style={{ background: "var(--surface-card)" }}>
            <div className="text-[22px] font-semibold leading-none tabular-nums" style={{ color: s.alert ? "#e11d48" : s.accent ? "var(--section-accent)" : "var(--text-primary)" }}>{s.value}</div>
            <div className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── 2. Agent roster (GET /agents) ── */}
      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Agents</h2>
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{constellation.length} in this workspace</span>
        </div>
        <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {rosterLoading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading agents…</div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {constellation.map(agent => {
                const tone = stateTone(agent.state);
                const runnable = RUNNABLE.has(agent.id);
                const ghost = agent.state === "disabled" || agent.state === "not_configured";
                const filtered = agentFilter === agent.name;
                return (
                  <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5" style={{ opacity: ghost ? 0.6 : 1, background: filtered ? "var(--surface-hover)" : undefined }}>
                    <agent.icon size={14} className="shrink-0" style={{ color: agent.state === "active" ? tone : "var(--text-muted)" }} />
                    <button onClick={() => setAgentFilter(filtered ? null : agent.name)} className="min-w-0 flex-1 text-left" title="Filter the timeline to this agent">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{agent.name.replace(" Agent", "")}</span>
                        <StatusDot color={tone} />
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{CONSTELLATION_STATE_LABEL[agent.state]}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                        <span>Last run {relAgo(agent.lastRunAt)}</span>
                        {agent.evidenceCount > 0 && <><span aria-hidden>·</span><span>{agent.evidenceCount} evidence</span></>}
                        {agent.backedBy && agent.backedBy.length > 0 && <><span aria-hidden>·</span><span className="truncate">backed by {agent.backedBy.join(", ")}</span></>}
                      </div>
                    </button>
                    {runnable && (
                      <button onClick={() => runAgent.mutate(agent.id)} disabled={busy === agent.id} title="Run this agent now"
                        className="inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                        {busy === agent.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run now
                      </button>
                    )}
                    {agent.to && (
                      <Link to={agent.to} className="inline-flex shrink-0 items-center text-[11px] font-medium" style={{ color: "var(--section-accent)" }} title="Open related page">
                        <ArrowUpRight size={13} />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 4. Decision queue bridge (placed high — it's the action that matters) ── */}
      <Link to="/decisions" className="mb-8 flex items-center justify-between gap-3 rounded-sm border px-4 py-3 transition-colors hover:border-[color:var(--section-accent)]"
        style={{ borderColor: pendingCount > 0 ? "var(--section-accent-line)" : "var(--border-soft)", background: pendingCount > 0 ? "var(--section-accent-soft)" : "var(--surface-card)" }}>
        <div>
          <div className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {pendingCount > 0 ? `${pendingCount} awaiting your approval` : "Nothing awaiting approval"}
          </div>
          <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>Agents prepare, you approve — every action is queued for your sign-off in the Decision Deck.</div>
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
                          <span style={{ color: a.status === "failed" ? "#e11d48" : "var(--text-secondary)" }}>{a.error || a.summary}</span>
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
                          <div className="space-y-1">
                            {steps.length > 0 ? (
                              steps.map((s, si) => {
                                const obj = (s && typeof s === "object") ? s as Record<string, unknown> : { value: s };
                                const stepLabel = String(obj.label ?? obj.step ?? obj.name ?? obj.message ?? Object.entries(obj).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ") ?? `step ${si + 1}`);
                                return (
                                  <div key={si} className="flex items-center gap-2 text-[11.5px]">
                                    <span className="tabular-nums" style={{ color: "var(--text-faint)" }}>[{si + 1}/{steps.length}]</span>
                                    <span style={{ color: "var(--text-secondary)" }}>{stepLabel}</span>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                                {a.status === "running" ? "Executing…" : a.status === "failed" ? "Queued → executing → failed" : "Queued → executing → saved"}
                              </div>
                            )}
                          </div>
                        </div>

                        {a.error && (
                          <div className="rounded-sm border-l-2 py-2 pl-3 pr-2" style={{ borderColor: "#e11d48", background: "color-mix(in srgb, #e11d48 6%, transparent)" }}>
                            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#e11d48" }}>Error</div>
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
