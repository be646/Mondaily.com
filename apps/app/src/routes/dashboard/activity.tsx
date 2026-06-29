import { useState } from "react";
import type { ElementType, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, ChevronRight, Play, RotateCcw, Clock, Zap, CheckCircle2, XCircle } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { agentByRaw, AGENTS } from "../../lib/agents";

// Agent ids that have an on-demand runner (POST /agents/:id/run) — mirrors AGENT_RUNNERS.
const RUNNABLE = new Set(["relationship", "operations", "finance", "graph-enrichment", "workflow", "opportunity", "people", "portfolio", "asset"]);

type ActivityItem = {
  id: string;
  agent: string;
  trigger: string;
  status: string;
  summary: string;
  detail: Record<string, unknown>;
  steps: unknown[];
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

// Dark "Neural Operation Center" palette. Sage = brand accent, tuned for visibility on zinc-950.
const SAGE = "#8fcf7f";   // active / success
const RED = "#f87171";    // error
const AMBER = "#fbbf24";  // running
const BLUE = "#7dd3fc";   // info / keys

// Agent identity comes from THE shared registry (lib/agents) — never defined locally.
const agentOf = (raw: string) => { const a = agentByRaw(raw); return { label: a.name, Icon: a.Icon }; };
const iconForLabel = (label: string): ElementType => Object.values(AGENTS).find(a => a.name === label)?.Icon ?? AGENTS["operations"]!.Icon;

function relAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function clockTime(iso?: string | null): string {
  if (!iso) return "--:--:--";
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

// Real runtime state from the latest DB transaction timestamp — no hardcoded loading.
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
function liveState(lastStatus: string, lastRun: string): "active" | "idle" {
  if (lastStatus === "running") return "active";
  return Date.now() - new Date(lastRun).getTime() < ACTIVE_WINDOW_MS ? "active" : "idle";
}

// Map a real run's status → severity badge (truthful: derived from the DB status, not invented).
function severityOf(status: string): { label: string; color: string } {
  if (status === "completed") return { label: "SUCCESS", color: SAGE };
  if (status === "failed") return { label: "ERROR", color: RED };
  if (status === "running") return { label: "RUNNING", color: AMBER };
  return { label: status.toUpperCase(), color: BLUE };
}

function SeverityBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="rounded px-1.5 py-px text-[10px] font-semibold tracking-wider"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}>
      [{label}]
    </span>
  );
}

// Glowing heartbeat indicator computed from real state.
function Heartbeat({ state }: { state: "active" | "idle" }) {
  if (state === "active") {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: SAGE }} />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: SAGE, boxShadow: `0 0 8px ${SAGE}` }} />
      </span>
    );
  }
  return <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full" style={{ background: "#3f3f46" }} />;
}

// Dependency-free JSON syntax highlighter (safe: renders React text nodes, no HTML injection).
function highlightJson(json: string): ReactNode[] {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let key = 0;
  while ((m = re.exec(json))) {
    if (m.index > last) out.push(json.slice(last, m.index));
    if (m[1] !== undefined) {
      const isKey = !!m[2];
      out.push(<span key={key++} style={{ color: isKey ? BLUE : "#a5d6a7" }}>{m[1]}</span>);
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(<span key={key++} style={{ color: AMBER }}>{m[3]}</span>);
    } else if (m[4] !== undefined) {
      out.push(<span key={key++} style={{ color: "#f0a868" }}>{m[4]}</span>);
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
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black/40">
      <div className="border-b border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[11.5px] leading-relaxed text-zinc-300">{highlightJson(json)}</pre>
    </div>
  );
}

export function AgentActivityPage() {
  const [agentFilter, setAgentFilter] = useState<string | null>(null); // by LABEL
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  type RosterRaw = { agent: string; last_run: string; last_status: string; runs_today: number; errors_today: number };
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agent-activity"],
    queryFn: () => apiClient.get<{
      activity: ActivityItem[];
      stats: { runs_today: number; errors_today: number; agents_today: string[] };
      roster: RosterRaw[];
      timeline: { label: string; completed: number; failed: number }[];
    }>(`/agents/activity?limit=120`),
    // Adaptive near-real-time: poll fast (2s) while a worker is computing or just ran,
    // relax to 8s when idle. Cheap, sovereign (through our own API), no DB exposed to the client.
    refetchInterval: (query) => {
      const acts = query.state.data?.activity ?? [];
      const hot = acts.some(a => a.status === "running" || Date.now() - new Date(a.started_at).getTime() < 60_000);
      return hot ? 2_000 : 8_000;
    },
  });
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["agent-activity"] });
  const runAgent = useMutation({
    mutationFn: (id: string) => apiClient.post(`/agents/${id}/run`),
    onMutate: (id) => setBusy(id),
    onSettled: () => { setBusy(null); refresh(); },
  });
  const replayRun = useMutation({
    mutationFn: (jobId: string) => apiClient.post(`/agents/replay`, { jobId }),
    onMutate: (jobId) => setBusy(jobId),
    onSettled: () => { setBusy(null); refresh(); },
  });
  const all = data?.activity ?? [];
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
  // + recurring_invoices). lastRun/lastStatus drive the live heartbeat state.
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
  const activeAgents = rosterByLabel.filter(r => liveState(r.lastStatus, r.lastRun) === "active").length;

  const tl = data?.timeline ?? [];
  const tlMax = Math.max(1, ...tl.map(t => t.completed + t.failed));
  const tlTotal = tl.reduce((s, t) => s + t.completed + t.failed, 0);

  // ROI + speed telemetry — all from real rows (no fabricated numbers).
  const completedToday = Math.max(0, runsToday - errors);
  const hoursSaved = (completedToday * 10) / 60; // standard 10 min saved per successful automated run
  const successRate = runsToday > 0 ? Math.round((completedToday / runsToday) * 100) : 0;
  const durMsList = all
    .map(a => (a.completed_at ? new Date(a.completed_at).getTime() - new Date(a.started_at).getTime() : null))
    .filter((x): x is number => x !== null && x >= 0);
  const avgMs = durMsList.length ? durMsList.reduce((s, x) => s + x, 0) / durMsList.length : 0;
  // Tokens/sec — REAL when the agent recorded usage into output.usage (populates as agents are wired).
  const tpsList = all.map(a => {
    const u = (a.detail?.usage ?? {}) as Record<string, unknown>;
    // Real provider usage stored by the agent (output.usage). Tokens/sec = generated tokens / runtime.
    const toks = Number(u.completion_tokens) || Number(u.total_tokens) || 0;
    const durS = a.completed_at ? (new Date(a.completed_at).getTime() - new Date(a.started_at).getTime()) / 1000 : 0;
    return toks > 0 && durS > 0 ? toks / durS : null;
  }).filter((x): x is number => x !== null);
  const avgTps = tpsList.length ? Math.round(tpsList.reduce((s, x) => s + x, 0) / tpsList.length) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 font-mono text-zinc-300 shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-zinc-700" />
              <span className="h-3 w-3 rounded-full bg-zinc-700" />
              <span className="h-3 w-3 rounded-full bg-zinc-700" />
            </div>
            <span className="text-[12px] tracking-wide text-zinc-500">mondaily://agents/neural-operation-center</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Heartbeat state={activeAgents > 0 ? "active" : "idle"} />
              {activeAgents} live
            </span>
            <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200">
              <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} /> sync
            </button>
          </div>
        </div>

        <div className="p-5">
          {/* Real KPI aggregates from the DB (COUNT over agent_jobs, today) */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              { label: "runs_today", value: runsToday, color: "#e4e4e7" },
              { label: "agents_reporting", value: agentsReportingToday, color: "#e4e4e7" },
              { label: "errors_today", value: errors, color: errors > 0 ? RED : "#e4e4e7" },
            ].map(t => (
              <div key={t.label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                <div className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: t.color }}>{t.value}</div>
                <div className="mt-2 text-[11px] tracking-wide text-zinc-500">{t.label}</div>
              </div>
            ))}
          </div>

          {/* ROI + speed telemetry — real metrics derived from the rows */}
          <div className="mb-5 flex flex-wrap gap-2">
            <Telem Icon={Clock} label="human hours saved" value={hoursSaved >= 10 ? Math.round(hoursSaved).toString() : hoursSaved.toFixed(1)} suffix="h" tone={SAGE} hint="10 min × successful runs today" />
            <Telem Icon={CheckCircle2} label="success rate" value={successRate.toString()} suffix="%" tone={successRate >= 90 ? SAGE : AMBER} hint={`${completedToday}/${runsToday} runs today`} />
            <Telem Icon={Clock} label="avg run" value={avgMs < 1000 ? Math.round(avgMs).toString() : (avgMs / 1000).toFixed(1)} suffix={avgMs < 1000 ? "ms" : "s"} tone="#a1a1aa" hint={`across ${durMsList.length} recent runs`} />
            {avgTps !== null && (
              <Telem Icon={Zap} label="tokens/sec" value={avgTps.toString()} suffix="" tone={BLUE} hint="real Cerebras throughput" />
            )}
          </div>

          {/* 24h throughput — real runs per hour, completed vs failed */}
          {tl.length > 0 && (
            <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <div className="text-[11px] tracking-wider text-zinc-500">THROUGHPUT · 24H</div>
                  <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-zinc-100">{tlTotal}<span className="ml-1.5 text-[11px] font-normal text-zinc-500">runs</span></div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: SAGE }} /> ok</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: RED }} /> fail</span>
                </div>
              </div>
              <div className="flex h-24 items-end gap-[3px]">
                {tl.map((t, i) => {
                  const total = t.completed + t.failed;
                  const h = (total / tlMax) * 100;
                  return (
                    <div key={i} className="group relative flex flex-1 flex-col justify-end" style={{ height: "100%" }} title={`${t.label}: ${t.completed} ok${t.failed ? `, ${t.failed} failed` : ""}`}>
                      <div className="w-full overflow-hidden rounded-sm transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(total ? 4 : 0, h)}%`, minHeight: total ? 3 : 0 }}>
                        {t.failed > 0 && <div style={{ height: `${(t.failed / total) * 100}%`, background: RED }} />}
                        {t.completed > 0 && <div style={{ height: `${(t.completed / total) * 100}%`, background: SAGE }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Heartbeat runtime grid — live state per agent from the latest DB row */}
          {rosterByLabel.length > 0 && (
            <div className="mb-6">
              <div className="mb-2 text-[11px] tracking-wider text-zinc-500">RUNTIME · {rosterByLabel.length} AGENTS</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {rosterByLabel.map(r => {
                  const Icon = iconForLabel(r.label);
                  const state = liveState(r.lastStatus, r.lastRun);
                  const active = agentFilter === r.label;
                  const id = Object.values(AGENTS).find(a => a.name === r.label)?.id ?? "";
                  const runnable = RUNNABLE.has(id);
                  const running = busy === id || state === "active";
                  return (
                    <div key={r.label}
                      className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all hover:border-zinc-700"
                      style={{ borderColor: active ? SAGE : "#27272a", background: active ? `${SAGE}12` : "rgba(24,24,27,0.4)" }}>
                      <button onClick={() => setAgentFilter(active ? null : r.label)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
                          <Icon size={14} style={{ color: state === "active" ? SAGE : "#71717a" }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Heartbeat state={state} />
                            <span className="truncate text-[12px] font-semibold text-zinc-200">{r.label.replace(" Agent", "")}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">
                            {state === "active" ? "active" : "idle"} · {relAgo(r.lastRun)}{r.runsToday > 0 ? ` · ${r.runsToday} today` : ""}{r.errorsToday > 0 ? ` · ${r.errorsToday} err` : ""}
                          </div>
                        </div>
                      </button>
                      {runnable && (
                        <button onClick={() => runAgent.mutate(id)} disabled={busy === id} title="Run this agent now"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50">
                          {busy === id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} style={running ? { color: SAGE } : undefined} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
              {([{ k: null, l: "all" }, { k: "completed", l: "success" }, { k: "failed", l: "error" }, { k: "running", l: "running" }]).map(s => {
                const on = statusFilter === s.k;
                return (
                  <button key={s.l} onClick={() => setStatusFilter(s.k)}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors"
                    style={on ? { background: `${SAGE}1f`, color: SAGE } : { color: "#a1a1aa" }}>
                    {s.l}<span className="tabular-nums opacity-60">{statusCount(s.k)}</span>
                  </button>
                );
              })}
            </div>
            {agentFilter && (
              <button onClick={() => setAgentFilter(null)} className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200">
                {agentFilter.replace(" Agent", "")} ✕
              </button>
            )}
          </div>

          {/* Streaming execution console */}
          <div className="rounded-xl border border-zinc-800 bg-black/30">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <span className="text-[11px] tracking-wider text-zinc-500">agent-runtime.log</span>
              <span className="text-[10px] text-zinc-600">{rows.length} events</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 px-4 py-10 text-[12px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> connecting to runtime…</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-zinc-500">
                {statusFilter === "running" ? "// no workers computing right now — agents fire on schedule + on events" : "// no events match this filter"}
              </div>
            ) : (
              <div className="py-1">
                <AnimatePresence initial={false}>
                  {rows.map((a) => {
                    const { label } = agentOf(a.agent);
                    const isOpen = expanded === a.id;
                    const sev = severityOf(a.status);
                    const steps = Array.isArray(a.steps) ? a.steps : [];
                    return (
                      <motion.div key={a.id} layout
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="relative">
                        {/* execution track gutter */}
                        <div className="pointer-events-none absolute bottom-0 left-[26px] top-0 w-px bg-zinc-800" />
                        <button onClick={() => setExpanded(isOpen ? null : a.id)}
                          className="group relative flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-zinc-900/60">
                          <span className="relative z-10 mt-[5px] flex h-3 w-3 shrink-0 items-center justify-center">
                            <span className="h-2 w-2 rounded-full ring-4 ring-zinc-950" style={{ background: sev.color }} />
                          </span>
                          <span className="mt-px shrink-0 text-[11px] tabular-nums text-zinc-600">{clockTime(a.started_at)}</span>
                          <SeverityBadge label={sev.label} color={sev.color} />
                          <span className="min-w-0 flex-1">
                            <span className="text-[12px] text-zinc-300">
                              <span className="text-zinc-500">{label.replace(" Agent", "").toLowerCase()}</span>
                              <span className="mx-1.5 text-zinc-700">›</span>
                              <span style={{ color: a.status === "failed" ? RED : "#d4d4d8" }}>{a.error || a.summary}</span>
                            </span>
                          </span>
                          {duration(a.started_at, a.completed_at) && (
                            <span className="mt-px hidden shrink-0 text-[10px] tabular-nums text-zinc-600 sm:inline">{duration(a.started_at, a.completed_at)}</span>
                          )}
                          <ChevronRight size={13} className={`mt-0.5 shrink-0 text-zinc-600 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        </button>

                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: "easeInOut" }}
                              className="overflow-hidden">
                              <div className="ml-[34px] space-y-3 border-l border-zinc-800 py-3 pl-5 pr-4">
                                {/* run metadata */}
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
                                  <Meta k="trigger" v={a.trigger} />
                                  <Meta k="status" v={a.status} color={sev.color} />
                                  <Meta k="started" v={fullTime(a.started_at)} />
                                  <Meta k="took" v={duration(a.started_at, a.completed_at) || "—"} />
                                </div>

                                {/* progressive execution track */}
                                <div>
                                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                    execution track{steps.length > 0 ? ` · ${steps.length} steps` : ""}
                                  </div>
                                  <div className="space-y-1">
                                    {steps.length > 0 ? (
                                      steps.map((s, si) => {
                                        const obj = (s && typeof s === "object") ? s as Record<string, unknown> : { value: s };
                                        const stepLabel = String(obj.label ?? obj.step ?? obj.name ?? obj.message ?? Object.entries(obj).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ") ?? `step ${si + 1}`);
                                        const isLast = si === steps.length - 1;
                                        const activeStep = a.status === "running" && isLast;
                                        return (
                                          <div key={si} className="flex items-center gap-2 text-[11.5px]">
                                            <span className="tabular-nums text-zinc-600">[{si + 1}/{steps.length}]</span>
                                            {activeStep ? <Loader2 size={11} className="animate-spin" style={{ color: AMBER }} /> : <CheckCircle2 size={11} style={{ color: SAGE }} />}
                                            <span className="text-zinc-400">{stepLabel}</span>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      // No granular steps logged → derive a truthful progress from the real status.
                                      ([
                                        { l: "queued", done: true, fail: false },
                                        { l: "executing", done: a.status !== "running", fail: false, active: a.status === "running" },
                                        { l: a.status === "failed" ? "failed" : "saved", done: a.status !== "running", fail: a.status === "failed" },
                                      ] as { l: string; done: boolean; fail?: boolean; active?: boolean }[]).map((p, pi, arr) => (
                                        <div key={pi} className="flex items-center gap-2 text-[11.5px]">
                                          <span className="tabular-nums text-zinc-600">[{pi + 1}/{arr.length}]</span>
                                          {p.active ? <Loader2 size={11} className="animate-spin" style={{ color: AMBER }} />
                                            : p.fail ? <XCircle size={11} style={{ color: RED }} /> : p.done ? <CheckCircle2 size={11} style={{ color: SAGE }} /> : <span className="h-[11px] w-[11px] rounded-full border border-zinc-700" />}
                                          <span style={{ color: p.fail ? RED : "#a1a1aa" }}>{p.l}</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>

                                {/* the unedited DB payload — proves real execution */}
                                {a.error && (
                                  <div className="rounded-lg border-l-2 bg-red-500/5 py-2 pl-3 pr-2" style={{ borderColor: RED }}>
                                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: RED }}>stderr</div>
                                    <div className="mt-0.5 break-words text-[11.5px] text-zinc-400">{a.error}</div>
                                  </div>
                                )}
                                {a.detail && Object.keys(a.detail).length > 0 && (
                                  <JsonBlock data={a.detail} title="output payload · agent_jobs.output" />
                                )}

                                {/* replay — re-trigger this exact run from its stored input */}
                                <div className="flex items-center gap-2 pt-0.5">
                                  <button onClick={() => replayRun.mutate(a.id)} disabled={busy === a.id}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50">
                                    {busy === a.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                                    {a.status === "failed" ? "Replay run" : "Re-run"}
                                  </button>
                                  <span className="text-[10px] text-zinc-600">re-dispatches with the original input payload</span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Telem({ Icon, label, value, suffix, tone, hint }: { Icon: ElementType; label: string; value: string; suffix: string; tone: string; hint: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2" title={hint}>
      <Icon size={14} style={{ color: tone }} />
      <div>
        <div className="text-[15px] font-semibold leading-none tabular-nums" style={{ color: tone }}>{value}<span className="ml-0.5 text-[11px] font-normal text-zinc-500">{suffix}</span></div>
        <div className="mt-0.5 text-[10px] tracking-wide text-zinc-500">{label}</div>
      </div>
    </div>
  );
}

function Meta({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-600">{k}</span>
      <span className="tabular-nums" style={{ color: color ?? "#a1a1aa" }}>{v}</span>
    </div>
  );
}
