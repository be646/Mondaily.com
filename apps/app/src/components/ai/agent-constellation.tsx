import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Network, ArrowUpRight, GitBranch } from "lucide-react";
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

  const liveCount = constellation.filter(a => isLiveState(a.state)).length;
  const n = constellation.length || 1;
  // Radial positions (percent of container), starting at 12 o'clock.
  const positions = constellation.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
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

      {/* ── Radial map — desktop/tablet ── */}
      <div className="surface-card relative hidden rounded-2xl sm:block" style={{ height: 380 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {positions.map((p, i) => (
            <line key={constellation[i]!.id} x1={50} y1={50} x2={p.x} y2={p.y} className="graph-line" data-live={isLiveState(constellation[i]!.state)}/>
          ))}
        </svg>

        {/* Central graph core */}
        <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: "50%", top: "50%" }}>
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--surface-selected)" }}>
            <span className="absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)" }}/>
            <Network size={20} style={{ color: "var(--accent)" }}/>
          </span>
          <span className="text-[10px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace graph</span>
        </div>

        {/* Agent nodes */}
        {constellation.map((agent, i) => {
          const p = positions[i]!;
          const live = isLiveState(agent.state);
          const isSelected = active?.id === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => setSelected(agent.id)}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-transform hover:scale-105"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <span
                className={`relative flex h-11 w-11 items-center justify-center rounded-full border-2 ${STATE_RING[agent.state]} ${isSelected ? "ring-2 ring-offset-1" : ""}`}
                style={{ background: "var(--surface-card)", borderColor: isSelected ? "var(--accent)" : undefined }}
              >
                <agent.icon size={15} style={{ color: live ? "var(--text-primary)" : "var(--text-faint)" }}/>
                {live && <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${STATE_DOT[agent.state]}`}/>}
              </span>
              <span className="max-w-[88px] truncate text-[9.5px] font-medium" style={{ color: "var(--text-secondary)" }}>{agent.name.replace(" Agent", "")}</span>
              <span className="text-[8.5px]" style={{ color: live ? "var(--accent)" : "var(--text-faint)" }}>{CONSTELLATION_STATE_LABEL[agent.state]}</span>
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

/** Sidebar trigger — icons/dots only, opens a popover with the same data
 * (no long descriptions ever shown inline in the sidebar itself). */
export function AgentPulse({ collapsed }: { collapsed: boolean }) {
  const { constellation, isLoading } = useAgentData();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  if (isLoading) {
    return <div className="shrink-0 px-2 pb-2"><div className="skeleton-shimmer h-8 rounded-lg"/></div>;
  }

  const activeAgents = constellation.filter(a => a.state === "active" || a.state === "needs_approval" || a.state === "issue");

  return (
    <div className="relative shrink-0 px-2 pb-2" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Agent Constellation"
        className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 transition-colors surface-hover ${collapsed ? "justify-center px-0" : "px-2"}`}
      >
        <GitBranch size={12} style={{ color: "var(--text-faint)" }}/>
        {!collapsed && <span className="text-[10px] font-medium" style={{ color: "var(--text-faint)" }}>Agents</span>}
        <span className="flex items-center -space-x-1 ml-auto">
          {activeAgents.slice(0, 4).map(a => (
            <span key={a.id} className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[a.state]} ring-2`} style={{ boxShadow: "0 0 0 2px var(--surface-card)" }}/>
          ))}
        </span>
      </button>

      {open && (
        <div className="absolute left-2 top-full z-50 mt-1 w-64 max-h-[70vh] overflow-y-auto rounded-xl p-2 space-y-1.5" style={{ background: "var(--surface-modal)", border: "1px solid var(--border-strong)", boxShadow: "0 12px 32px rgba(0,0,0,0.25)" }}>
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Agent Constellation</p>
          {constellation.map(agent => (
            <div key={agent.id} className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 surface-hover">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${STATE_RING[agent.state]}`}>
                <agent.icon size={10} style={{ color: "var(--text-secondary)" }}/>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="truncate text-[11.5px] font-medium" style={{ color: "var(--text-primary)" }}>{agent.name}</span>
                  <span className="shrink-0 text-[9px]" style={{ color: "var(--text-faint)" }}>{CONSTELLATION_STATE_LABEL[agent.state]}</span>
                </div>
                {agent.note && <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--text-faint)" }}>{agent.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
