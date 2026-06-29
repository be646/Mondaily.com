import { useState } from "react";
import type { ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle, RefreshCw, ChevronDown, Bot } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { agentByRaw, AGENTS } from "../../lib/agents";

type ActivityItem = {
  id: string;
  agent: string;
  trigger: string;
  status: string;
  summary: string;
  detail: Record<string, unknown>;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

// Raw agent_jobs.agent_name → real, user-facing agent identity (matches the Agent
// Constellation). Several internal jobs roll up to one real agent (e.g. invoice_chaser
// + recurring_invoices = Finance Agent), so we group by LABEL, never raw job name.
// Agent identity comes from THE shared registry (lib/agents) — never defined locally,
// so the control panel matches Home + everywhere. agentOf returns { label, Icon }.
const agentOf = (raw: string) => { const a = agentByRaw(raw); return { label: a.name, Icon: a.Icon }; };
const iconForLabel = (label: string): ElementType => Object.values(AGENTS).find(a => a.name === label)?.Icon ?? Bot;

function relAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { Icon: ElementType; color: string; label: string }> = {
    completed: { Icon: CheckCircle2, color: "var(--accent)", label: "Completed" },
    failed: { Icon: XCircle, color: "#ef4444", label: "Failed" },
    running: { Icon: Loader2, color: "var(--text-muted)", label: "Running" },
  };
  const s = map[status] ?? map.running!;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: s.color }}>
      <s.Icon size={12} className={status === "running" ? "animate-spin" : ""}/> {s.label}
    </span>
  );
}

export function AgentActivityPage() {
  const [agentFilter, setAgentFilter] = useState<string | null>(null); // by LABEL
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  type RosterRaw = { agent: string; last_run: string; last_status: string; runs_today: number; errors_today: number };
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: () => apiClient.get<{ activity: ActivityItem[]; stats: { runs_today: number; errors_today: number; agents_today: string[] }; roster: RosterRaw[]; timeline: { label: string; completed: number; failed: number }[] }>(`/agents/activity?limit=120`),
    refetchInterval: 30_000,
  });
  const all = data?.activity ?? [];
  // Group by real agent (label) — fixes the inflated count from raw job names.
  const agentLabels = Array.from(new Set(all.map(a => agentOf(a.agent).label))).sort();
  const rows = all
    .filter(a => !statusFilter || a.status === statusFilter)
    .filter(a => !agentFilter || agentOf(a.agent).label === agentFilter);
  const statusCount = (k: string | null) => (k ? all.filter(a => a.status === k).length : all.length);

  // REAL totals from the server (whole table, today) — not the capped feed.
  const runsToday = data?.stats?.runs_today ?? 0;
  const errors = data?.stats?.errors_today ?? 0;
  const agentsReportingToday = Array.from(new Set((data?.stats?.agents_today ?? []).map(raw => agentOf(raw).label))).length;

  // Per-agent roster grouped by REAL agent (merges raw jobs, e.g. Finance = invoice_chaser
  // + recurring_invoices). Concrete proof: last run + today's counts per agent.
  const rosterByLabel = (() => {
    const m: Record<string, { label: string; lastRun: string; lastStatus: string; runsToday: number; errorsToday: number }> = {};
    for (const r of data?.roster ?? []) {
      const label = agentOf(r.agent).label;
      if (!m[label]) m[label] = { label, lastRun: r.last_run, lastStatus: r.last_status, runsToday: 0, errorsToday: 0 };
      if (new Date(r.last_run) > new Date(m[label]!.lastRun)) { m[label]!.lastRun = r.last_run; m[label]!.lastStatus = r.last_status; }
      m[label]!.runsToday += r.runs_today;
      m[label]!.errorsToday += r.errors_today;
    }
    return Object.values(m).sort((a, b) => new Date(b.lastRun).getTime() - new Date(a.lastRun).getTime());
  })();

  const segBox = "flex gap-0.5 rounded-xl border p-0.5";
  const segBoxStyle = { borderColor: "var(--border-soft)", background: "var(--surface-card)" } as const;
  const segBtn = (active: boolean) => `flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors ${active ? "" : "hover:opacity-80"}`;
  const segBtnStyle = (active: boolean) => (active ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" } : { color: "var(--text-muted)" });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header — app heading style */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="home-section-kicker">Live operations</p>
          <h1 className="home-hero-title mt-1">Agent control panel</h1>
          <p className="home-section-copy mt-1.5">Live proof of work — every run your agents perform, with full detail.</p>
        </div>
        <button onClick={() => refetch()} className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""}/> Refresh
        </button>
      </div>

      {/* KPIs — clean metric tiles on the page surface (real totals from the server) */}
      <div className="mb-6 grid grid-cols-3 gap-2.5">
        {[
          { label: "Runs today", value: runsToday },
          { label: "Agents reporting today", value: agentsReportingToday },
          { label: "Errors today", value: errors, danger: errors > 0 },
        ].map(t => (
          <div key={t.label} className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="text-[22px] font-semibold leading-none tabular-nums" style={{ color: t.danger ? "#ef4444" : "var(--text-primary)" }}>{t.value}</div>
            <div className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Live operations graph — real 24h throughput (completed vs failed per hour) */}
      {(() => {
        const tl = data?.timeline ?? [];
        const max = Math.max(1, ...tl.map(t => t.completed + t.failed));
        const totalRuns = tl.reduce((s, t) => s + t.completed + t.failed, 0);
        if (tl.length === 0) return null;
        return (
          <div className="mb-6 rounded-2xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="home-section-kicker">Operations · last 24h</p>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-[20px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{totalRuns}</span>
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>agent runs</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "var(--accent)" }}/> completed</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#ef4444" }}/> failed</span>
              </div>
            </div>
            <div className="flex h-28 items-end gap-[3px]">
              {tl.map((t, i) => {
                const total = t.completed + t.failed;
                const h = (total / max) * 100;
                return (
                  <div key={i} className="group relative flex flex-1 flex-col justify-end" style={{ height: "100%" }} title={`${t.label}: ${t.completed} ok${t.failed ? `, ${t.failed} failed` : ""}`}>
                    <div className="w-full overflow-hidden rounded-sm" style={{ height: `${Math.max(total ? 4 : 0, h)}%`, minHeight: total ? 3 : 0 }}>
                      {t.failed > 0 && <div style={{ height: `${(t.failed / total) * 100}%`, background: "#ef4444" }}/>}
                      {t.completed > 0 && <div style={{ height: `${(t.completed / total) * 100}%`, background: "var(--accent)" }}/>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px]" style={{ color: "var(--text-faint)" }}>
              <span>{tl[0]?.label}</span><span>12h</span><span>now</span>
            </div>
          </div>
        );
      })()}

      {/* Agent roster — concrete proof each agent is running (last run + today's counts) */}
      {rosterByLabel.length > 0 && (
        <div className="mb-6">
          <p className="home-section-kicker mb-2">Your agents</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {rosterByLabel.map(r => {
              const Icon = iconForLabel(r.label);
              const ranToday = r.runsToday > 0;
              return (
                <button key={r.label} onClick={() => setAgentFilter(agentFilter === r.label ? null : r.label)}
                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-px"
                  style={{ borderColor: agentFilter === r.label ? "var(--accent)" : "var(--border-soft)", background: "var(--surface-card)" }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
                    <Icon size={15} style={{ color: "var(--accent)" }}/>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{r.label}</div>
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: r.errorsToday > 0 ? "#ef4444" : ranToday ? "var(--accent)" : "var(--text-faint)" }}/>
                      ran {relAgo(r.lastRun)}{r.runsToday > 0 ? ` · ${r.runsToday} today` : ""}{r.errorsToday > 0 ? ` · ${r.errorsToday} failed` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Status — small segmented control with counts */}
      <div className="mb-3 inline-flex">
        <div className={segBox} style={segBoxStyle}>
          {([{ k: null, l: "All" }, { k: "completed", l: "Completed" }, { k: "failed", l: "Failed" }, { k: "running", l: "Running" }]).map(s => (
            <button key={s.l} onClick={() => setStatusFilter(s.k)} className={segBtn(statusFilter === s.k)} style={segBtnStyle(statusFilter === s.k)}>
              {s.l}<span className="tabular-nums opacity-60">{statusCount(s.k)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Agents — a clean WRAPPING row of icon chips (no horizontal scroll). Click to filter. */}
      {agentLabels.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {agentLabels.map(l => {
            const Icon = iconForLabel(l);
            const active = agentFilter === l;
            return (
              <button key={l} onClick={() => setAgentFilter(active ? null : l)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all hover:-translate-y-px"
                style={active
                  ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }
                  : { borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                <Icon size={13}/> {l.replace(" Agent", "")}
              </button>
            );
          })}
        </div>
      )}

      {/* Feed */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin"/> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          {statusFilter === "running"
            ? "No agents are running right now — they run on a schedule and on events. Completed runs are below."
            : "No runs match this filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {rows.map((a, i) => {
            const { label, Icon } = agentOf(a.agent);
            const isOpen = expanded === a.id;
            const detailEntries = Object.entries(a.detail || {}).filter(([k]) => k !== "summary" && k !== "message");
            return (
              <div key={a.id} style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
                <button onClick={() => setExpanded(isOpen ? null : a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-hover)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
                    <Icon size={15} style={{ color: "var(--accent)" }}/>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
                      <StatusBadge status={a.status}/>
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px]" style={{ color: a.status === "failed" ? "#ef4444" : "var(--text-secondary)" }}>{a.error || a.summary}</p>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                    <span className="text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{fullTime(a.started_at)}</span>
                    {duration(a.started_at, a.completed_at) && <span className="text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}>took {duration(a.started_at, a.completed_at)}</span>}
                  </div>
                  <ChevronDown size={15} className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }}/>
                </button>
                {isOpen && (
                  <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--accent) 3%, var(--surface-card))" }}>
                    <div className="ml-11 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                      <Field label="Trigger" value={a.trigger} />
                      <Field label="Duration" value={duration(a.started_at, a.completed_at) || "—"} />
                      <Field label="Started" value={fullTime(a.started_at)} />
                      <Field label="Finished" value={fullTime(a.completed_at)} />
                    </div>
                    {a.error && (
                      <div className="ml-11 mt-3 rounded-lg border-l-2 bg-red-500/5 py-2 pl-3 pr-2" style={{ borderColor: "#ef4444" }}>
                        <div className="text-[11px] font-semibold" style={{ color: "#ef4444" }}>Why it failed</div>
                        <div className="mt-0.5 break-words text-[12px]" style={{ color: "var(--text-secondary)" }}>{a.error}</div>
                      </div>
                    )}
                    {detailEntries.length > 0 && (
                      <div className="ml-11 mt-3">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>What happened</div>
                        <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                          {detailEntries.map(([k, v]) => (
                            <div key={k} className="flex items-baseline justify-between gap-3 border-b pb-1" style={{ borderColor: "var(--border-soft)" }}>
                              <span className="text-[12px] capitalize" style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</span>
                              <span className="shrink-0 text-[12px] font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}
