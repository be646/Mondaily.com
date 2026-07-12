import { useCallback, useState } from "react";
import { LogoMark } from "@/components/logo";
import {
  ReactFlow, Background, Controls,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
  type NodeProps, Panel, MarkerType, BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  StickyNote, Circle, Type, LayoutGrid, GitBranch,
  ChevronDown, Trash2,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────────────────
   STICKY NODE
───────────────────────────────────────────────────────────────────────────── */
const STICKY_PALETTES: Record<string, { bg: string; accent: string; text: string; muted: string }> = {
  lemon:  { bg: "#1e1c0a", accent: "#e8d44d", text: "#fef9c3", muted: "#a89e4a" },
  rose:   { bg: "#1e0a0a", accent: "#e8504d", text: "#ffe4e4", muted: "#a84a4a" },
  sky:    { bg: "#0a1320", accent: "#4d9ce8", text: "#dbeafe", muted: "#4a72a8" },
  mint:   { bg: "#0a1a0f", accent: "#4de87a", text: "#dcfce7", muted: "#4aa860" },
  violet: { bg: "#120a1e", accent: "#9c4de8", text: "#f3e8ff", muted: "#724aa8" },
  ember:  { bg: "#1a0f0a", accent: "#e8844d", text: "#ffedd5", muted: "#a86a4a" },
};

function StickyNode({ data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const p = STICKY_PALETTES[(data.color as string) || "lemon"] ?? STICKY_PALETTES["lemon"]!;

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{
        background: p.bg,
        borderColor: selected ? p.accent : `${p.accent}28`,
        boxShadow: selected
          ? `0 0 0 1px ${p.accent}60, 0 8px 32px rgba(0,0,0,0.6)`
          : "0 4px 24px rgba(0,0,0,0.5)",
      }}
      className="relative w-52 min-h-[130px] rounded-sm border transition-all duration-150 cursor-default select-none overflow-hidden"
    >
      {/* top accent bar */}
      <div style={{ background: `${p.accent}22`, borderBottomColor: `${p.accent}20` }}
        className="flex items-center justify-between px-3 py-2 border-b">
        <div style={{ background: p.accent }} className="h-1.5 w-5 rounded-full opacity-80" />
        {/* colour swatches */}
        <div className="flex gap-1">
          {Object.entries(STICKY_PALETTES).map(([key, val]) => (
            <button
              key={key}
              style={{ background: val.accent }}
              className={`h-2 w-2 rounded-full transition-transform hover:scale-125 ${(data.color as string || "lemon") === key ? "ring-1 ring-white/40 ring-offset-1 ring-offset-transparent scale-110" : "opacity-50 hover:opacity-100"}`}
              onMouseDown={e => { e.stopPropagation(); (data.onColorChange as (c: string) => void)?.(key); }}
            />
          ))}
        </div>
      </div>

      <div className="p-3">
        {editing ? (
          <textarea
            autoFocus
            defaultValue={data.label as string}
            onBlur={e => { (data.onLabelChange as (v: string) => void)?.(e.target.value); setEditing(false); }}
            className="w-full h-20 bg-transparent text-sm font-medium resize-none outline-none leading-relaxed"
            style={{ color: p.text }}
          />
        ) : (
          <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: (data.label as string) ? p.text : p.muted }}>
            {(data.label as string) || "Double-click to write…"}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MIND NODE
───────────────────────────────────────────────────────────────────────────── */
function MindNode({ data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const accent = (data.color as string) || "var(--section-accent)";

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{
        borderColor: selected ? accent : `${accent}50`,
        boxShadow: selected
          ? `0 0 0 1px ${accent}60, 0 0 20px ${accent}20`
          : `0 0 12px ${accent}15`,
        background: `radial-gradient(ellipse at top left, ${accent}12, var(--surface-card))`,
      }}
      className="min-w-[110px] max-w-[200px] rounded-full border-2 px-5 py-2.5 text-center cursor-default select-none transition-all"
    >
      {editing ? (
        <input autoFocus defaultValue={data.label as string}
          onBlur={e => { (data.onLabelChange as (v: string) => void)?.(e.target.value); setEditing(false); }}
          className="bg-transparent text-sm text-[var(--text-primary)] text-center outline-none w-full font-medium"
        />
      ) : (
        <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
          {(data.label as string) || "Idea"}
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TEXT NODE
───────────────────────────────────────────────────────────────────────────── */
function TextNode({ data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={`min-w-[120px] cursor-default transition-all ${selected ? "ring-1 ring-white/20 ring-offset-2 ring-offset-[var(--surface-card)] rounded-lg" : ""}`}
    >
      {editing ? (
        <textarea autoFocus defaultValue={data.label as string}
          onBlur={e => { (data.onLabelChange as (v: string) => void)?.(e.target.value); setEditing(false); }}
          className="bg-transparent text-[var(--text-secondary)] outline-none resize-none text-sm w-44 h-16 leading-relaxed"
        />
      ) : (
        <p className="text-[var(--text-secondary)] text-sm font-medium whitespace-pre-wrap leading-relaxed">
          {(data.label as string) || <span className="text-[var(--text-secondary)] italic">Text…</span>}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   QUADRANT NODE
───────────────────────────────────────────────────────────────────────────── */
function QuadrantNode({ data }: NodeProps) {
  const labels = [
    (data as Record<string, unknown>).q0 as string || "Top Left",
    (data as Record<string, unknown>).q1 as string || "Top Right",
    (data as Record<string, unknown>).q2 as string || "Bottom Left",
    (data as Record<string, unknown>).q3 as string || "Bottom Right",
  ];
  return (
    <div
      className="w-[520px] h-[420px] rounded-sm overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "var(--surface-card)" }}
    >
      <div className="flex items-center justify-center py-2 border-b border-[var(--border-soft)]">
        <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--text-secondary)]">
          {data.label as string}
        </span>
      </div>
      <div className="grid grid-cols-2 grid-rows-2 h-[calc(100%-36px)]">
        {labels.map((q, i) => (
          <div
            key={i}
            className={`flex items-center justify-center text-xs text-[var(--text-secondary)] font-medium
              ${i % 2 === 0 ? "border-r border-[var(--border-soft)]" : ""}
              ${i < 2 ? "border-b border-[var(--border-soft)]" : ""}`}
            style={{ background: i === 0 ? "rgba(99,102,241,0.04)" : i === 1 ? "rgba(236,72,153,0.04)" : i === 2 ? "rgba(16,185,129,0.04)" : "rgba(245,158,11,0.04)" }}
          >
            {q}
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { sticky: StickyNode, mind: MindNode, text: TextNode, quadrant: QuadrantNode };

/* ─────────────────────────────────────────────────────────────────────────────
   TEMPLATES
───────────────────────────────────────────────────────────────────────────── */
const TEMPLATES: Record<string, { nodes: Node[]; edges: Edge[]; label: string; description: string }> = {
  mindmap: {
    label: "Mind Map",
    description: "Radial idea exploration",
    nodes: [
      { id: "c",  type: "mind", position: { x: 320, y: 200 }, data: { label: "Central Idea", color: "#9c6b72" } },
      { id: "1",  type: "mind", position: { x: 80,  y: 60  }, data: { label: "Branch 1",    color: "var(--section-accent)" } },
      { id: "2",  type: "mind", position: { x: 540, y: 60  }, data: { label: "Branch 2",    color: "var(--section-accent)" } },
      { id: "3",  type: "mind", position: { x: 80,  y: 340 }, data: { label: "Branch 3",    color: "#5f8169" } },
      { id: "4",  type: "mind", position: { x: 540, y: 340 }, data: { label: "Branch 4",    color: "#97824f" } },
    ],
    edges: [
      { id: "e-c1", source: "c", target: "1" },
      { id: "e-c2", source: "c", target: "2" },
      { id: "e-c3", source: "c", target: "3" },
      { id: "e-c4", source: "c", target: "4" },
    ],
  },
  swot: {
    label: "SWOT Analysis",
    description: "Strengths, Weaknesses, Opportunities, Threats",
    nodes: [
      { id: "title", type: "text",     position: { x: 210, y: 10  }, data: { label: "SWOT Analysis" } },
      { id: "q",     type: "quadrant", position: { x: 20,  y: 50  }, data: { label: "SWOT", q0: "Strengths", q1: "Weaknesses", q2: "Opportunities", q3: "Threats" } },
    ],
    edges: [],
  },
  assumption: {
    label: "Assumption Map",
    description: "Validate ideas by importance & certainty",
    nodes: [
      { id: "title", type: "text",     position: { x: 180, y: 10  }, data: { label: "Assumption Map" } },
      { id: "q",     type: "quadrant", position: { x: 20,  y: 50  }, data: { label: "Important ↔ Known", q0: "Validate First", q1: "Monitor", q2: "Deprioritise", q3: "Research" } },
      { id: "s1", type: "sticky", position: { x: 60,  y: 120 }, data: { label: "Add assumption", color: "lemon"  } },
      { id: "s2", type: "sticky", position: { x: 315, y: 120 }, data: { label: "Add assumption", color: "sky"    } },
      { id: "s3", type: "sticky", position: { x: 60,  y: 320 }, data: { label: "Add assumption", color: "mint"   } },
      { id: "s4", type: "sticky", position: { x: 315, y: 320 }, data: { label: "Add assumption", color: "violet" } },
    ],
    edges: [],
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN CANVAS
───────────────────────────────────────────────────────────────────────────── */
let _id = 100;
const uid = () => `n${++_id}`;

function withHandlers(nodes: Node[], setNodes: (fn: (ns: Node[]) => Node[]) => void): Node[] {
  return nodes.map(n => ({
    ...n,
    data: {
      ...n.data,
      onLabelChange: (val: string) => setNodes(ns => ns.map(x => x.id === n.id ? { ...x, data: { ...x.data, label: val } } : x)),
      onColorChange: (col: string) => setNodes(ns => ns.map(x => x.id === n.id ? { ...x, data: { ...x.data, color: col } } : x)),
    },
  }));
}

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [templateOpen, setTemplateOpen] = useState(false);

  const onConnect = useCallback((c: Connection) =>
    setEdges(eds => addEdge({
      ...c,
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--section-accent)" },
      style: { stroke: "var(--section-accent)", strokeWidth: 1.5 },
    }, eds)),
  [setEdges]);

  const addNode = (type: string, label: string, extra: object = {}) => {
    const id = uid();
    setNodes(ns => [...ns, {
      id, type,
      position: { x: 200 + Math.random() * 240, y: 180 + Math.random() * 120 },
      data: {
        label, ...extra,
        onLabelChange: (val: string) => setNodes(ns2 => ns2.map(n => n.id === id ? { ...n, data: { ...n.data, label: val } } : n)),
        onColorChange: (col: string) => setNodes(ns2 => ns2.map(n => n.id === id ? { ...n, data: { ...n.data, color: col } } : n)),
      },
    }]);
  };

  const loadTemplate = (key: string) => {
    const t = TEMPLATES[key];
    if (!t) return;
    setNodes(withHandlers(t.nodes, setNodes));
    setEdges(t.edges);
    setTemplateOpen(false);
  };

  const selectedCount = nodes.filter(n => n.selected).length + edges.filter(e => e.selected).length;

  return (
    <div className="h-full w-full" style={{ background: "var(--surface-page)" }}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        defaultEdgeOptions={{
          style: { stroke: "var(--section-accent)", strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--section-accent)" },
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* subtle dot grid */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="rgba(255,255,255,0.06)"
        />

        {/* controls — minimal style */}
        <Controls
          showInteractive={false}
          className="[&>button]:!bg-[var(--surface-card)] [&>button]:!border-[var(--border-soft)] [&>button]:!text-[var(--text-secondary)] [&>button:hover]:!bg-[var(--surface-hover)] [&>button:hover]:!text-[var(--text-secondary)] !shadow-none !border !border-[var(--border-soft)] !rounded-sm !overflow-hidden"
        />

        {/* ── Floating toolbar ── */}
        <Panel position="top-center" className="mt-3">
          <div
            className="flex items-center gap-1 rounded-sm px-2 py-1.5"
            style={{
              background: "rgba(12,14,18,0.92)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04) inset",
            }}
          >
            {/* node types */}
            {[
              { icon: <StickyNote size={13} />, label: "Sticky", onClick: () => addNode("sticky", "", { color: "lemon" }) },
              { icon: <Circle size={13} />,     label: "Node",   onClick: () => addNode("mind", "New idea") },
              { icon: <Type size={13} />,        label: "Text",   onClick: () => addNode("text", "Text block") },
              { icon: <LayoutGrid size={13} />,  label: "Matrix", onClick: () => addNode("quadrant", "2×2 Matrix", { q0: "Top Left", q1: "Top Right", q2: "Bottom Left", q3: "Bottom Right" }) },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.onClick}
                className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] transition-all duration-100"
              >
                {btn.icon}
                {btn.label}
              </button>
            ))}

            {/* divider */}
            <div className="h-5 w-px mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

            {/* templates */}
            <div className="relative">
              <button
                onClick={() => setTemplateOpen(o => !o)}
                className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] transition-all duration-100"
              >
                <GitBranch size={13} />
                Templates
                <ChevronDown size={10} className={`transition-transform duration-150 ${templateOpen ? "rotate-180" : ""}`} />
              </button>

              {templateOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTemplateOpen(false)} />
                  <div
                    className="absolute left-1/2 -translate-x-1/2 top-full z-50 mt-2 w-56 rounded-sm p-1.5"
                    style={{
                      background: "rgba(10,12,16,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      backdropFilter: "blur(20px)",
                      boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
                    }}
                  >
                    {Object.entries(TEMPLATES).map(([key, t]) => (
                      <button
                        key={key}
                        onClick={() => loadTemplate(key)}
                        className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
                      >
                        <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{t.label}</span>
                        <span className="text-[10px] text-[var(--text-secondary)]">{t.description}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* divider */}
            <div className="h-5 w-px mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

            {/* delete */}
            <button
              onClick={() => {
                setNodes(ns => ns.filter(n => !n.selected));
                setEdges(es => es.filter(e => !e.selected));
              }}
              disabled={selectedCount === 0}
              className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-stone-500/10 hover:text-stone-400 transition-all duration-100 disabled:pointer-events-none"
            >
              <Trash2 size={13} />
              {selectedCount > 0 ? `Delete (${selectedCount})` : "Delete"}
            </button>
          </div>
        </Panel>

        {/* ── First-run state: an INTERACTIVE quick-start (real template gallery + node shortcuts),
            not a passive caption. Templates are clearly labeled starting layouts — no fake content. */}
        {nodes.length === 0 && (
          <Panel position="top-center" style={{ marginTop: "120px" }}>
            <div className="w-[min(560px,92vw)] rounded-sm border px-6 py-6 text-center" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", boxShadow: "0 16px 48px -16px rgba(0,0,0,0.4)" }}>
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-sm" style={{ background: "var(--section-accent-soft)" }}>
                <LogoMark size={20} style={{ color: "var(--section-accent)" }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>A blank canvas for thinking</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Map ideas, plan a strategy, or sketch a system. Pick a starting layout, or add your first node from the toolbar above.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {Object.entries(TEMPLATES).map(([key, t]) => (
                  <button key={key} onClick={() => loadTemplate(key)}
                    className="flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors hover:border-[var(--section-accent)] hover:bg-[var(--surface-hover)]"
                    style={{ borderColor: "var(--border-soft)" }}>
                    <GitBranch size={14} className="mt-0.5 shrink-0" style={{ color: "var(--section-accent)" }} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>
                        {t.label}
                        <span className="rounded-sm px-1 py-px text-[9px] font-medium uppercase" style={{ background: "var(--surface-hover)", color: "var(--text-faint)" }}>Template</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-[11px]" style={{ color: "var(--text-faint)" }}>Double-click a node to edit · drag between nodes to connect · scroll to zoom</p>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
