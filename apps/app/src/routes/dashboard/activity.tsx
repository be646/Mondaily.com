import { useState } from "react";
import type { ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Loader2, XCircle, Activity as ActivityIcon, RefreshCw, ChevronDown,
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

// Raw agent_jobs.agent_name → the real, user-facing agent identity (matches the
// Agent Constellation), so the panel never shows confusing internal names.
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
      <s.Icon size={13} className={status === "running" ? "animate-spin" : ""}/> {s.label}
    </span>
  );
}

export function AgentActivityPage() {
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agent-activity", agentFilter],
    queryFn: () => apiClient.get<{ activity: ActivityItem[] }>(`/agents/activity${agentFilter ? `?agent=${encodeURIComponent(agentFilter)}` : ""}`),
    refetchInterval: 30_000,
  });
  const all = data?.activity ?? [];
  const rows = statusFilter ? all.filter(a => a.status === statusFilter) : all;
  const agents = Array.from(new Set(all.map(a => a.agent))).sort();
  const errors = all.filter(a => a.status === "failed").length;
  const runsToday = all.filter(a => new Date(a.started_at).toDateString() === new Date().toDateString()).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>
            <ActivityIcon size={18} style={{ color: "var(--accent)" }}/>
          </span>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Agent control panel</h1>
            <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>Live proof of work — every run your agents perform.</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""}/> Refresh
        </button>
      </div>

      {/* Stat tiles */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: "Runs today", value: runsToday, color: "var(--text-primary)" },
          { label: "Active agents", value: agents.length, color: "var(--text-primary)" },
          { label: "Errors", value: errors, color: errors > 0 ? "#ef4444" : "var(--text-primary)" },
        ].map(t => (
          <div key={t.label} className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{t.label}</div>
            <div className="mt-0.5 text-[22px] font-semibold tabular-nums" style={{ color: t.color }}>{t.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {([{ k: null, l: "All status" }, { k: "completed", l: "Completed" }, { k: "failed", l: "Failed" }, { k: "running", l: "Running" }]).map(s => (
          <button key={s.l} onClick={() => setStatusFilter(s.k)} className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors" style={{ borderColor: statusFilter === s.k ? "var(--accent)" : "var(--border-soft)", background: "var(--surface-card)", color: statusFilter === s.k ? "var(--accent)" : "var(--text-secondary)" }}>{s.l}</button>
        ))}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--border-soft)" }}/>
        <button onClick={() => setAgentFilter(null)} className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors" style={{ borderColor: agentFilter === null ? "var(--accent)" : "var(--border-soft)", background: "var(--surface-card)", color: agentFilter === null ? "var(--accent)" : "var(--text-secondary)" }}>All agents</button>
        {agents.map(a => (
          <button key={a} onClick={() => setAgentFilter(a)} className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors" style={{ borderColor: agentFilter === a ? "var(--accent)" : "var(--border-soft)", background: "var(--surface-card)", color: agentFilter === a ? "var(--accent)" : "var(--text-secondary)" }}>{agentOf(a).label}</button>
        ))}
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin"/> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>No runs match this filter.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {rows.map((a, i) => {
            const { label, Icon } = agentOf(a.agent);
            const isOpen = expanded === a.id;
            const detailEntries = Object.entries(a.detail || {}).filter(([k]) => k !== "summary" && k !== "message");
            return (
              <div key={a.id} style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
                <button onClick={() => setExpanded(isOpen ? null : a.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-hover)]">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
                    <Icon size={14} style={{ color: "var(--accent)" }}/>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
                      <StatusBadge status={a.status}/>
                      <span className="rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wide" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>{a.trigger}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] break-words" style={{ color: a.status === "failed" ? "#ef4444" : "var(--text-secondary)" }}>{a.error || a.summary}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{fullTime(a.started_at)}</span>
                    {duration(a.started_at, a.completed_at) && <span className="text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}>took {duration(a.started_at, a.completed_at)}</span>}
                  </div>
                  <ChevronDown size={14} className={`mt-1 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }}/>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 pl-14">
                    <div className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card-2, var(--surface-hover))" }}>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <div><span style={{ color: "var(--text-faint)" }}>Started</span><div style={{ color: "var(--text-secondary)" }}>{fullTime(a.started_at)}</div></div>
                        <div><span style={{ color: "var(--text-faint)" }}>Finished</span><div style={{ color: "var(--text-secondary)" }}>{fullTime(a.completed_at)}</div></div>
                      </div>
                      {a.error && (
                        <div className="mt-2 rounded border-l-2 pl-2" style={{ borderColor: "#ef4444" }}>
                          <span className="text-[11px] font-medium" style={{ color: "#ef4444" }}>Error</span>
                          <div className="break-words text-[12px]" style={{ color: "var(--text-secondary)" }}>{a.error}</div>
                        </div>
                      )}
                      {detailEntries.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>What happened</span>
                          <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1">
                            {detailEntries.map(([k, v]) => (
                              <div key={k} className="flex items-baseline justify-between gap-2">
                                <span className="truncate" style={{ color: "var(--text-faint)" }}>{k.replace(/_/g, " ")}</span>
                                <span className="shrink-0 tabular-nums" style={{ color: "var(--text-secondary)" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
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
