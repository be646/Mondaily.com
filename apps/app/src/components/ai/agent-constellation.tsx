import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Network, ArrowUpRight, Play, Loader2, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import {
  useAgentData, CONSTELLATION_STATE_LABEL,
  type ConstellationAgent, type ConstellationState,
} from "./agent-dock";

/** Agents that expose an on-demand POST /api/v1/agents/:id/run runner. */
const RUNNABLE_AGENTS = new Set(["relationship", "operations", "finance", "graph-enrichment", "workflow", "opportunity", "people", "portfolio", "asset"]);

/** Turn a runner's result payload into one short human line. */
function summarizeRun(result: Record<string, unknown>): string {
  const r = (result?.result ?? result) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.total_scored === "number") parts.push(`scored ${r.total_scored}`);
  if (typeof r.alerts_created === "number" && r.alerts_created > 0) parts.push(`${r.alerts_created} alert(s)`);
  if (typeof r.queued === "number") parts.push(`${r.queued} decision(s) queued`);
  if (typeof r.total_chased === "number") parts.push(`${r.total_chased} chase(s) drafted`);
  if (typeof r.generated === "number" && r.generated > 0) parts.push(`${r.generated} invoice(s)`);
  if (typeof r.enriched_count === "number") parts.push(`enriched ${r.enriched_count}`);
  if (typeof r.records_matched === "number") parts.push(`${r.records_matched} matched`);
  if (typeof r.actions_executed === "number" && r.actions_executed > 0) parts.push(`${r.actions_executed} action(s) run`);
  if (typeof r.actions_queued === "number" && r.actions_queued > 0) parts.push(`${r.actions_queued} queued`);
  if (typeof r.opportunities === "number") parts.push(`${r.opportunities} opportunity(ies)`);
  if (typeof r.incomplete === "number") parts.push(`${r.incomplete} incomplete`);
  if (typeof r.needs_review === "number") parts.push(`${r.needs_review} to review`);
  if (typeof r.assets === "number") parts.push(`${r.assets} asset(s)`);
  if (typeof r.queued === "number" && r.queued > 0 && parts.length === 0) parts.push(`${r.queued} queued`);
  return parts.length ? `Done — ${parts.join(", ")}.` : "Done — nothing new to act on.";
}

function RunAgentButton({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!RUNNABLE_AGENTS.has(agentId)) return null;

  async function run() {
    setRunning(true); setResult(null); setError(null);
    try {
      const res = await apiClient.post<Record<string, unknown>>(`/agents/${agentId}/run`);
      setResult(summarizeRun(res));
      // Refresh the registry + dock data so new state/decisions show up.
      qc.invalidateQueries({ queryKey: ["agent-registry"] });
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["agent-dock"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
        style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }}
      >
        {running ? <Loader2 size={11} className="animate-spin"/> : result ? <Check size={11}/> : <Play size={11}/>}
        {running ? "Running…" : "Run now"}
      </button>
      {result && <span className="text-[10.5px]" style={{ color: "var(--text-secondary)" }}>{result}</span>}
      {error && <span className="text-[10.5px] text-rose-500">{error}</span>}
    </div>
  );
}

/**
 * Agent Constellation — the one honest model of "every agent concept that
 * exists in this codebase", shared by the compact sidebar trigger and the
 * larger Home panel. A node's state is never upgraded for visual effect:
 * `active` only appears when the backend registry (GET /api/v1/agents)
 * is computing it from real data; `monitoring`/`disabled`/`not_configured`
 * make it explicit when something is wired-but-quiet, gated, or a pure
 * code scaffold with no live job at all.
 */

const STATE_RING: Record<ConstellationState, string> = {
  active: "border-stone-500",
  monitoring: "border-[var(--accent)]",
  needs_approval: "border-amber-500",
  issue: "border-rose-500",
  disabled: "border-dashed border-stone-300/40",
  not_configured: "border-dashed border-stone-300/40",
};


function NodeDetail({ agent }: { agent: ConstellationAgent }) {
  return (
    <div className="agent-detail-strip px-1 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${STATE_RING[agent.state]}`} style={{ background: "var(--surface-page)" }}>
            <agent.icon size={13} style={{ color: "var(--text-secondary)" }}/>
          </span>
          <div>
            <p className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{agent.name}</p>
            <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>{CONSTELLATION_STATE_LABEL[agent.state]}</p>
          </div>
        </div>
        {agent.to && (
          <Link to={agent.to} className="inline-flex items-center gap-0.5 text-[11px] font-medium shrink-0" style={{ color: "var(--accent)" }}>
            {agent.state === "disabled" ? "Enable module" : "Inspect"} <ArrowUpRight size={11}/>
          </Link>
        )}
      </div>
      {agent.note && (
        <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--text-secondary)" }}>{agent.note}</p>
      )}
      {agent.suggestedAction && (
        <p className="mt-1.5 text-[11px] font-medium" style={{ color: "var(--accent)" }}>→ {agent.suggestedAction}</p>
      )}
      {RUNNABLE_AGENTS.has(agent.id) && (
        <div className="mt-2.5">
          <RunAgentButton agentId={agent.id}/>
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
        {agent.backedBy && agent.backedBy.length > 0 && <span>Backed by: {agent.backedBy.join(", ")}</span>}
        {agent.lastRunAt && <span>Last run: {new Date(agent.lastRunAt).toLocaleString()}</span>}
        {agent.evidenceCount > 0 && <span>{agent.evidenceCount} evidence record{agent.evidenceCount === 1 ? "" : "s"}</span>}
      </div>
    </div>
  );
}

function isLiveState(state: ConstellationState) {
  return state === "active" || state === "needs_approval" || state === "issue";
}

/** Home panel — the visual heart of Home: every agent as a node connected
 * to a central "Workspace Graph" core by animated lines, not a card grid
 * and not a scrolling row. Falls back to a vertical agent rail on mobile,
 * where a radial layout has no room to breathe. */
export function AgentConstellationPanel() {
  const { constellation, isLoading, isError } = useAgentData();
  const [selected, setSelected] = useState<string | null>(null);
  const active = constellation.find(a => a.id === selected)
    ?? constellation.find(a => a.state === "issue")
    ?? constellation.find(a => a.state === "needs_approval")
    ?? constellation.find(a => a.state === "active")
    ?? constellation[0];

  if (isLoading) {
    return (
      <section className="mb-8">
        <div className="skeleton-shimmer h-72 rounded-sm"/>
      </section>
    );
  }

  if (isError || constellation.length === 0) {
    return (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Network size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent Constellation</h2>
        </div>
        <div className="surface-card rounded-sm px-4 py-8 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Could not load agent status</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {isError ? "Agent telemetry failed to return. Refresh or check the API connection." : "No agents returned for this workspace yet."}
          </p>
        </div>
      </section>
    );
  }

  const liveCount = constellation.filter(a => isLiveState(a.state)).length;

  // Relative "last run" — the real telemetry (already fetched) that the old pill rail hid.
  const ranAgo = (iso?: string | null): string | null => {
    if (!iso) return null;
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(s) || s < 0) return null;
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  // Colour encodes MEANING (state), never an arbitrary per-agent rainbow:
  // working = green · waiting on you = amber · problem = rose · watching/quiet = muted.
  const stateTone = (state: ConstellationState): string =>
    state === "active" ? "#10b981"
    : state === "needs_approval" ? "#d97706"
    : state === "issue" ? "#e11d48"
    : state === "monitoring" ? "var(--text-muted)"
    : "var(--text-faint)";

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent Constellation</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] sm:inline" style={{ color: "var(--text-faint)" }}>
            {liveCount > 0 ? `${liveCount} live right now` : "all quiet"} · {constellation.length} agents
          </span>
          {/* This panel is a preview — the full roster + proof-of-work lives in the Control Room. */}
          <Link to="/activity" className="inline-flex items-center gap-0.5 text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>
            Control Room <ArrowUpRight size={11}/>
          </Link>
        </div>
      </div>

      {/* Premium info-grid: each agent shows its real state, last real run, and evidence count at
          a glance — the telemetry was always in the payload, the old pill rail just hid it. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {constellation.map((agent) => {
          const live = isLiveState(agent.state);
          const isSelected = active?.id === agent.id;
          const tone = stateTone(agent.state);
          const ran = ranAgo(agent.lastRunAt);
          const ghost = agent.state === "disabled" || agent.state === "not_configured";
          return (
            <button
              key={agent.id}
              onClick={() => setSelected(agent.id)}
              className="group flex flex-col gap-1.5 rounded-sm border px-3 py-2.5 text-left transition-colors"
              style={{
                borderColor: isSelected ? "var(--section-accent)" : "var(--border-soft)",
                borderStyle: ghost ? "dashed" : "solid",
                background: isSelected ? "color-mix(in srgb, var(--section-accent) 5%, var(--surface-card))" : "var(--surface-card)",
                opacity: ghost ? 0.65 : 1,
              }}
            >
              <span className="flex w-full items-center gap-2">
                <agent.icon size={13} className="shrink-0" style={{ color: live ? tone : "var(--text-muted)" }}/>
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
                  {agent.name.replace(" Agent", "")}
                </span>
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  {live && <span className="live-ping absolute inline-flex h-full w-full rounded-full" style={{ background: tone }}/>}
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: tone }}/>
                </span>
              </span>
              <span className="flex w-full items-center gap-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
                <span className="truncate" style={{ color: live ? "var(--text-muted)" : "var(--text-faint)" }}>
                  {CONSTELLATION_STATE_LABEL[agent.state]}
                </span>
                {ran && <span className="ml-auto shrink-0 tabular-nums">{ran}</span>}
                {!ran && agent.evidenceCount > 0 && <span className="ml-auto shrink-0 tabular-nums">{agent.evidenceCount} ev.</span>}
              </span>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="mt-3">
          <NodeDetail agent={active}/>
        </div>
      )}
    </section>
  );
}

const AGENT_DOT_PALETTE = ["var(--accent)", "#10b981", "var(--accent)", "#f59e0b", "var(--accent)", "#ec4899", "#3b82f6", "#84cc16"];

/** Sidebar "Agents" section — a flat, always-visible list (colored dot +
 * name, click to inspect), not a popover hidden behind a hover trigger.
 * Live agents get a small breathing ring; everything else just sits there
 * quietly, which is the honest state for monitoring/disabled/not_configured. */
// ─── Hero agent strip ─────────────────────────────────────────────────────────
// A clean, premium summary of the agent fleet for the Home welcome area (replaces
// the old sidebar dock). An overlapping stack of live-pulsing dots + a quiet
// count, in a pill that lifts on hover and scrolls to the full constellation.
export function AgentHeroStrip() {
  const { constellation, isLoading } = useAgentData();

  if (isLoading) return <div className="skeleton-shimmer h-4 w-32 rounded"/>;
  if (!constellation.length) return null;

  const live = constellation.filter(a => isLiveState(a.state));

  // Frameless: a quiet label + active/total count, then one live-pinging dot per
  // ACTIVE agent (so 8 working → 8 dots). The whole row gets a soft transparent
  // hover layer.
  return (
    <a href="#agents" className="agent-hero-row group inline-flex items-center gap-2 rounded-md px-2 py-1">
      <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>AI agents</span>
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{live.length}/{constellation.length} active</span>
      {live.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          {live.map((a) => {
            // Colour by the agent's index in the FULL constellation, so each agent's
            // dot matches its colour in the Live-operations Agent Constellation.
            const idx = constellation.findIndex(c => c.id === a.id);
            return (
              <span key={a.id} title={a.name} className="live-dot"
                style={{ background: AGENT_DOT_PALETTE[(idx < 0 ? 0 : idx) % AGENT_DOT_PALETTE.length] }}/>
            );
          })}
        </span>
      )}
    </a>
  );
}

// ─── Sidebar agents ───────────────────────────────────────────────────────────
// Compact agents line for the workspace header box: same per-agent colours as the
// constellation but more MATTE (blended toward grey), one dot per active agent.
export function SidebarAgents() {
  const { constellation, isLoading } = useAgentData();
  if (isLoading || !constellation.length) return null;
  const live = constellation.filter(a => isLiveState(a.state));
  return (
    <Link to="/activity" className="block rounded-lg px-1.5 py-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-faint)" }}>AI agents</span>
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{live.length}/{constellation.length} active</span>
      </div>
      {live.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {live.map((a) => {
            const idx = constellation.findIndex(c => c.id === a.id);
            const color = AGENT_DOT_PALETTE[(idx < 0 ? 0 : idx) % AGENT_DOT_PALETTE.length];
            return <span key={a.id} title={a.name} className="h-1.5 w-1.5 rounded-full"
              style={{ background: `color-mix(in srgb, ${color} 55%, var(--text-muted))` }}/>;
          })}
        </div>
      )}
    </Link>
  );
}

export function AgentPulse({ collapsed }: { collapsed: boolean }) {
  const { constellation, isLoading } = useAgentData();

  if (isLoading) {
    return <div className="shrink-0"><div className="skeleton-shimmer h-10 rounded-lg"/></div>;
  }

  if (collapsed) {
    const activeAgents = constellation.filter(a => isLiveState(a.state));
    return (
      <Link to="/home" title={`${constellation.length} agents`} className="flex flex-col items-center gap-1.5 rounded-lg py-2 surface-hover">
        <Network size={13} style={{ color: "var(--text-muted)" }}/>
        <div className="flex flex-col items-center gap-1">
          {constellation.slice(0, 4).map(a => (
            <span key={a.id} className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: isLiveState(a.state) ? "var(--text-muted)" : "var(--text-faint)" }}/>
              {isLiveState(a.state) && activeAgents.includes(a) && (
                <motion.span animate={{ opacity: [0.35, 0.75, 0.35] }} transition={{ duration: 1.8, repeat: Infinity }} className="absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px color-mix(in srgb, var(--text-muted) 28%, transparent)" }}/>
              )}
            </span>
          ))}
        </div>
      </Link>
    );
  }

  const activeAgents = constellation.filter(a => isLiveState(a.state));

  return (
    <div className="shrink-0">
      <Link
        to="/home"
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
          <Network size={13} style={{ color: "var(--text-muted)" }}/>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>AI agents</span>
          <span className="block truncate text-[10px]" style={{ color: "var(--text-faint)" }}>
            {constellation.length} agents · {activeAgents.length > 0 ? `${activeAgents.length} active` : "quiet"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {constellation.slice(0, 3).map(agent => (
            <span key={agent.id} className="h-1.5 w-1.5 rounded-full" style={{ background: isLiveState(agent.state) ? "var(--text-muted)" : "var(--text-faint)" }}/>
          ))}
        </span>
      </Link>
    </div>
  );
}
