import { useState } from "react";
import type { ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Loader2, XCircle, RefreshCw, ChevronDown,
  Sparkles, Receipt, Users, ShieldAlert, ListChecks, Search, Box, TrendingUp, Target, GitBranch, Bot,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";

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
const AGENTS: Record<string, { label: string; Icon: ElementType }> = {
  crm_enricher:        { label: "Graph Enrichment Agent", Icon: Sparkles },
  invoice_chaser:      { label: "Finance Agent",          Icon: Receipt },
  recurring_invoices:  { label: "Finance Agent",          Icon: Receipt },
  credit_note_dispute_handler: { label: "Finance Agent",  Icon: Receipt },
  relationship_health: { label: "Relationship Agent",     Icon: Users },
  deal_alerts:         { label: "Signal Agent",           Icon: ShieldAlert },
  lead_scoring:        { label: "Operations Agent",       Icon: ListChecks },
  operations:          { label: "Operations Agent",       Icon: ListChecks },
  overdue_task_decisions: { label: "Operations Agent",    Icon: ListChecks },
  prospecting:         { label: "Prospecting Agent",      Icon: Search },
  people:              { label: "People Agent",           Icon: Users },
  asset:               { label: "Asset Agent",            Icon: Box },
  portfolio:           { label: "Portfolio Agent",        Icon: TrendingUp },
  opportunity:         { label: "Opportunity Agent",      Icon: Target },
  workflow:            { label: "Workflow Agent",         Icon: GitBranch },
};
const agentOf = (raw: string) => AGENTS[raw] ?? { label: raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), Icon: Bot };

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

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: () => apiClient.get<{ activity: ActivityItem[] }>(`/agents/activity?limit=120`),
    refetchInterval: 30_000,
  });
  const all = data?.activity ?? [];
  // Group by real agent (label) — fixes the inflated count from raw job names.
  const agentLabels = Array.from(new Set(all.map(a => agentOf(a.agent).label))).sort();
  const rows = all
    .filter(a => !statusFilter || a.status === statusFilter)
    .filter(a => !agentFilter || agentOf(a.agent).label === agentFilter);
  const errors = all.filter(a => a.status === "failed").length;
  const runsToday = all.filter(a => new Date(a.started_at).toDateString() === new Date().toDateString()).length;

  const segBox = "flex gap-0.5 rounded-xl border p-0.5";
  const segBoxStyle = { borderColor: "var(--border-soft)", background: "var(--surface-hover)" } as const;
  const segBtn = (active: boolean) => `flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors ${active ? "" : "hover:opacity-80"}`;
  const segBtnStyle = (active: boolean) => (active ? { background: "var(--surface-card)", color: "var(--text-primary)", boxShadow: "0 1px 2px rgba(15,23,42,0.06)" } : { color: "var(--text-muted)" });

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

      {/* KPIs — clean inline metric strip */}
      <div className="mb-6 flex flex-wrap items-stretch gap-2.5">
        {[
          { label: "Runs today", value: runsToday },
          { label: "Active agents", value: agentLabels.length },
          { label: "Errors", value: errors, danger: errors > 0 },
        ].map(t => (
          <div key={t.label} className="flex-1 rounded-xl px-4 py-2.5" style={{ background: "var(--surface-hover)" }}>
            <div className="text-[20px] font-semibold leading-none tabular-nums" style={{ color: t.danger ? "#ef4444" : "var(--text-primary)" }}>{t.value}</div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Filters — segmented controls, matching the sheets */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className={segBox} style={segBoxStyle}>
          {([{ k: null, l: "All" }, { k: "completed", l: "Completed" }, { k: "failed", l: "Failed" }, { k: "running", l: "Running" }]).map(s => (
            <button key={s.l} onClick={() => setStatusFilter(s.k)} className={segBtn(statusFilter === s.k)} style={segBtnStyle(statusFilter === s.k)}>{s.l}</button>
          ))}
        </div>
        {agentLabels.length > 0 && (
          <div className={`${segBox} overflow-x-auto`} style={segBoxStyle}>
            <button onClick={() => setAgentFilter(null)} className={segBtn(agentFilter === null)} style={segBtnStyle(agentFilter === null)}>All agents</button>
            {agentLabels.map(l => (
              <button key={l} onClick={() => setAgentFilter(l)} className={`${segBtn(agentFilter === l)} whitespace-nowrap`} style={segBtnStyle(agentFilter === l)}>{l.replace(" Agent", "")}</button>
            ))}
          </div>
        )}
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin"/> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>No runs match this filter.</div>
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
                  <div className="px-4 pb-4 pt-0.5" style={{ background: "var(--surface-hover)" }}>
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
