import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Network, ArrowUpRight } from "lucide-react";
import {
  useAgentData, CONSTELLATION_STATE_LABEL,
  type ConstellationAgent, type ConstellationState,
} from "./agent-dock";

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
  active: "border-violet-500",
  monitoring: "border-cyan-500",
  needs_approval: "border-amber-500",
  issue: "border-rose-500",
  disabled: "border-dashed border-zinc-300/40",
  not_configured: "border-dashed border-zinc-300/40",
};

const STATE_DOT: Record<ConstellationState, string> = {
  active: "bg-violet-500",
  monitoring: "bg-cyan-500",
  needs_approval: "bg-amber-500",
  issue: "bg-rose-500",
  disabled: "bg-zinc-300",
  not_configured: "bg-zinc-400",
};

function NodeDetail({ agent }: { agent: ConstellationAgent }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface-hover)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${STATE_RING[agent.state]}`} style={{ background: "var(--surface-card)" }}>
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
  const { constellation, isLoading } = useAgentData();
  const [selected, setSelected] = useState<string | null>(null);
  const active = constellation.find(a => a.id === selected)
    ?? constellation.find(a => a.state === "issue")
    ?? constellation.find(a => a.state === "needs_approval")
    ?? constellation.find(a => a.state === "active")
    ?? constellation[0];

  if (isLoading) {
    return (
      <section className="mb-8">
        <div className="skeleton-shimmer h-72 rounded-2xl"/>
      </section>
    );
  }

  if (constellation.length === 0) {
    return (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Network size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent Constellation</h2>
        </div>
        <div className="surface-card rounded-2xl px-4 py-8 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Could not load agent status</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>The workspace is reachable, but agent telemetry did not return.</p>
        </div>
      </section>
    );
  }

  const liveCount = constellation.filter(a => isLiveState(a.state)).length;
  const n = constellation.length || 1;
  // Radial positions (percent of container), starting at 12 o'clock. Radius
  // kept well inside the box (34%, not 40%) plus generous container padding
  // so nodes and their labels never clip against the edges.
  const positions = constellation.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + 34 * Math.cos(angle), y: 50 + 34 * Math.sin(angle) };
  });

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent Constellation</h2>
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {liveCount > 0 ? `${liveCount} live right now` : "all quiet"} · {constellation.length} agents
        </span>
      </div>

      {/* ── Radial map — desktop/tablet. No frame/card — nodes float
          directly on the page; overflow is visible so nothing clips. ── */}
      <div className="agent-map-surface relative hidden sm:block" style={{ height: 440 }}>
        {/* Faint orbit ring connecting all agents — gives the layout a
            "constellation" read even before you look at any one node. */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          <circle cx={50} cy={50} r={34} fill="none" stroke="var(--border-soft)" strokeWidth={0.4}/>
          {positions.map((p, i) => {
            const mx = 50 + (p.x - 50) * 0.55, my = 50 + (p.y - 50) * 0.55;
            return (
              <path key={constellation[i]!.id} d={`M50,50 Q${mx},${my} ${p.x},${p.y}`} className="graph-line" data-live={isLiveState(constellation[i]!.state)}/>
            );
          })}
        </svg>

        {/* Central graph core — rotating dashed ring for "always processing" feel */}
        <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: "50%", top: "50%" }}>
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--surface-card)), var(--surface-card))", boxShadow: "0 4px 20px color-mix(in srgb, var(--accent) 25%, transparent)" }}>
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
              className="absolute inset-[-5px] rounded-full"
              style={{ border: "1.5px dashed color-mix(in srgb, var(--accent) 40%, transparent)" }}
            />
            <Network size={22} style={{ color: "var(--accent)" }}/>
          </span>
          <span className="text-[10.5px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace graph</span>
        </div>

        {/* Agent nodes */}
        {constellation.map((agent, i) => {
          const p = positions[i]!;
          const live = isLiveState(agent.state);
          const isSelected = active?.id === agent.id;
          const dotColor = AGENT_DOT_PALETTE[i % AGENT_DOT_PALETTE.length]!;
          return (
            <button
              key={agent.id}
              onClick={() => setSelected(agent.id)}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-transform hover:scale-110"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <span
                className="relative flex h-12 w-12 items-center justify-center rounded-full transition-shadow"
                style={{
                  background: live
                    ? `linear-gradient(135deg, ${dotColor}30, ${dotColor}10)`
                    : "var(--surface-card)",
                  border: `2px solid ${live ? dotColor : "var(--border-strong)"}`,
                  boxShadow: isSelected ? `0 0 0 3px ${dotColor}25` : live ? `0 2px 12px ${dotColor}35` : "none",
                }}
              >
                <agent.icon size={16} style={{ color: live ? dotColor : "var(--text-faint)" }}/>
                {live && (
                  <motion.span
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2"
                    style={{ background: dotColor, boxShadow: "0 0 0 2px var(--surface-card)" }}
                  />
                )}
              </span>
              <span className="rounded-full px-2 py-0.5 max-w-[100px] truncate text-[9.5px] font-semibold" style={{ color: "var(--text-primary)", background: "var(--surface-card)", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>{agent.name.replace(" Agent", "")}</span>
              <span className="text-[8.5px] font-medium" style={{ color: live ? dotColor : "var(--text-faint)" }}>{CONSTELLATION_STATE_LABEL[agent.state]}</span>
            </button>
          );
        })}
      </div>

      {/* ── Vertical agent rail — mobile ── */}
      <div className="surface-card flex flex-col rounded-2xl sm:hidden">
        {constellation.map(agent => {
          const live = isLiveState(agent.state);
          const isSelected = active?.id === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => setSelected(agent.id)}
              className={`stream-row text-left ${isSelected ? "surface-selected" : ""}`}
            >
              <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${STATE_RING[agent.state]}`} style={{ background: "var(--surface-card)" }}>
                <agent.icon size={14} style={{ color: live ? "var(--text-primary)" : "var(--text-faint)" }}/>
                {live && <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${STATE_DOT[agent.state]}`}/>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <p className="truncate text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{agent.name}</p>
                  <span className="shrink-0 text-[9.5px] font-medium" style={{ color: live ? "var(--accent)" : "var(--text-faint)" }}>{CONSTELLATION_STATE_LABEL[agent.state]}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-secondary)" }}>{agent.note}</p>
              </div>
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

const AGENT_DOT_PALETTE = ["#6366f1", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#3b82f6", "#84cc16"];

/** Sidebar "Agents" section — a flat, always-visible list (colored dot +
 * name, click to inspect), not a popover hidden behind a hover trigger.
 * Live agents get a small breathing ring; everything else just sits there
 * quietly, which is the honest state for monitoring/disabled/not_configured. */
export function AgentPulse({ collapsed }: { collapsed: boolean }) {
  const { constellation, isLoading } = useAgentData();

  if (isLoading) {
    return <div className="shrink-0 px-2 pb-2"><div className="skeleton-shimmer h-20 rounded-lg"/></div>;
  }

  if (collapsed) {
    const activeAgents = constellation.filter(a => isLiveState(a.state));
    return (
      <div className="flex flex-col items-center gap-1.5 px-2 pb-2">
        {constellation.slice(0, 6).map((a, i) => (
          <Link key={a.id} to={a.to ?? "/home"} title={a.name} className="relative flex h-2 w-2 shrink-0 items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: AGENT_DOT_PALETTE[i % AGENT_DOT_PALETTE.length] }}/>
            {isLiveState(a.state) && activeAgents.includes(a) && (
              <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.8, repeat: Infinity }} className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${AGENT_DOT_PALETTE[i % AGENT_DOT_PALETTE.length]}40` }}/>
            )}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="shrink-0 px-2 pb-2">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Agents</p>
      <div className="space-y-0.5">
        {constellation.map((agent, i) => {
          const live = isLiveState(agent.state);
          const dotColor = AGENT_DOT_PALETTE[i % AGENT_DOT_PALETTE.length]!;
          return (
            <Link
              key={agent.id}
              to={agent.to ?? "/home"}
              title={agent.note}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] transition-colors surface-hover"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="relative flex h-1.5 w-1.5 shrink-0 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }}/>
                {live && (
                  <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.8, repeat: Infinity }} className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${dotColor}33` }}/>
                )}
              </span>
              <span className="flex-1 truncate">{agent.name}</span>
              <span className="shrink-0 text-[9.5px] font-medium" style={{ color: live ? dotColor : "var(--text-faint)" }}>
                {CONSTELLATION_STATE_LABEL[agent.state]}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
