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
 * `active` only appears when useAgentData() is computing it from real
 * data; `available`/`module_disabled`/`coming_online` make it explicit
 * when something is a scaffold, gated, or not yet reachable at all.
 */

const STATE_RING: Record<ConstellationState, string> = {
  active: "border-violet-500",
  monitoring: "border-cyan-500",
  available: "border-zinc-400/50",
  module_disabled: "border-dashed border-zinc-300/40",
  coming_online: "border-dashed border-zinc-300/40",
};

const STATE_DOT: Record<ConstellationState, string> = {
  active: "bg-violet-500",
  monitoring: "bg-cyan-500",
  available: "bg-zinc-400",
  module_disabled: "bg-zinc-300",
  coming_online: "bg-zinc-300",
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
            {agent.state === "module_disabled" ? "Enable module" : "Inspect"} <ArrowUpRight size={11}/>
          </Link>
        )}
      </div>
      {agent.note && (
        <p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--text-secondary)" }}>{agent.note}</p>
      )}
      {agent.backedBy && agent.backedBy.length > 0 && (
        <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
          Backed by: {agent.backedBy.join(", ")}
        </p>
      )}
    </div>
  );
}

/** Home panel — central "Graph Brain" + a row of agent nodes, click to inspect. */
export function AgentConstellationPanel() {
  const { constellation, isLoading } = useAgentData();
  const [selected, setSelected] = useState<string | null>(null);
  const active = constellation.find(a => a.id === selected) ?? constellation.find(a => a.state === "active") ?? constellation[0];

  if (isLoading) {
    return (
      <section className="mb-6">
        <div className="skeleton-shimmer h-24 rounded-xl"/>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <div className="surface-card rounded-2xl p-4">
        <div className="flex items-center gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {/* Central brain node — represents the graph itself, not a separate agent */}
          <div className="flex shrink-0 flex-col items-center gap-1 pr-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--surface-selected)" }}>
              <Network size={15} style={{ color: "var(--accent)" }}/>
            </span>
            <span className="text-[9px] font-medium" style={{ color: "var(--text-faint)" }}>Graph</span>
          </div>
          <div className="h-px w-3 shrink-0" style={{ background: "var(--border-strong)" }}/>

          {constellation.map((agent, i) => (
            <div key={agent.id} className="flex shrink-0 items-center gap-3">
              <button onClick={() => setSelected(agent.id)} className="flex flex-col items-center gap-1 transition-opacity hover:opacity-80">
                <span className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 ${STATE_RING[agent.state]} ${active?.id === agent.id ? "ring-2 ring-offset-1" : ""}`}
                  style={{ background: "var(--surface-card)" }}>
                  <agent.icon size={13} style={{ color: agent.state === "active" ? "var(--text-primary)" : "var(--text-faint)" }}/>
                  {agent.state === "active" && (
                    <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${STATE_DOT[agent.state]}`}/>
                  )}
                </span>
                <span className="max-w-[64px] truncate text-[9px]" style={{ color: "var(--text-faint)" }}>{agent.name.replace(" Agent", "")}</span>
              </button>
              {i < constellation.length - 1 && <div className="h-px w-3 shrink-0" style={{ background: "var(--border-soft)" }}/>}
            </div>
          ))}
        </div>

        {active && (
          <div className="mt-3">
            <NodeDetail agent={active}/>
          </div>
        )}
      </div>
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

  const activeAgents = constellation.filter(a => a.state === "active");

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
