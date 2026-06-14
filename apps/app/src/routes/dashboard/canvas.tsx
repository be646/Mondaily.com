import { useCallback, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
  type NodeProps, Panel,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, Type, Square, Circle, GitBranch, LayoutGrid, StickyNote, ChevronDown } from "lucide-react";

/* ── Sticky Note Node ────────────────────────────────────────── */
const STICKY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  yellow:  { bg: "#fef9c3", border: "#fde047", text: "#713f12" },
  red:     { bg: "#fee2e2", border: "#fca5a5", text: "#7f1d1d" },
  blue:    { bg: "#dbeafe", border: "#93c5fd", text: "#1e3a5f" },
  green:   { bg: "#dcfce7", border: "#86efac", text: "#14532d" },
  purple:  { bg: "#f3e8ff", border: "#d8b4fe", text: "#581c87" },
  orange:  { bg: "#ffedd5", border: "#fdba74", text: "#7c2d12" },
};

function StickyNode({ data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const c = STICKY_COLORS[(data.color as string) || "yellow"];
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{ background: c.bg, borderColor: selected ? "#ef4444" : c.border, color: c.text }}
      className="relative w-44 min-h-[110px] rounded-sm border-2 shadow-md p-3 cursor-default select-none"
    >
      {/* colour dots */}
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        {Object.keys(STICKY_COLORS).map(col => (
          <button key={col}
            style={{ background: STICKY_COLORS[col].border }}
            className="h-2.5 w-2.5 rounded-full opacity-60 hover:opacity-100 transition-opacity"
            onMouseDown={e => { e.stopPropagation(); data.onColorChange?.(col); }}
          />
        ))}
      </div>
      {editing ? (
        <textarea
          autoFocus
          defaultValue={data.label as string}
          onBlur={e => { data.onLabelChange?.(e.target.value); setEditing(false); }}
          className="w-full h-20 bg-transparent text-sm font-medium resize-none outline-none"
          style={{ color: c.text }}
        />
      ) : (
        <p className="text-sm font-medium leading-snug whitespace-pre-wrap break-words pr-4 mt-1">
          {(data.label as string) || <span className="opacity-40 italic">Double-click to edit</span>}
        </p>
      )}
    </div>
  );
}

/* ── Mind Map Node ───────────────────────────────────────────── */
function MindNode({ data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{ borderColor: selected ? "#ef4444" : (data.color as string) || "#6366f1" }}
      className="min-w-[100px] max-w-[180px] rounded-full border-2 bg-[#1a1d24] px-4 py-2 shadow-md text-center cursor-default select-none"
    >
      {editing ? (
        <input autoFocus defaultValue={data.label as string}
          onBlur={e => { data.onLabelChange?.(e.target.value); setEditing(false); }}
          className="bg-transparent text-sm text-white text-center outline-none w-full" />
      ) : (
        <span className="text-sm font-medium text-white">{(data.label as string) || "Node"}</span>
      )}
    </div>
  );
}

/* ── Text Node ───────────────────────────────────────────────── */
function TextNode({ data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  return (
    <div onDoubleClick={() => setEditing(true)} className={`min-w-[80px] cursor-default ${selected ? "ring-1 ring-red-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}>
      {editing ? (
        <textarea autoFocus defaultValue={data.label as string}
          onBlur={e => { data.onLabelChange?.(e.target.value); setEditing(false); }}
          className="bg-transparent text-white outline-none resize-none text-sm w-40 h-16" />
      ) : (
        <p className="text-white text-sm font-medium whitespace-pre-wrap">{(data.label as string) || "Text"}</p>
      )}
    </div>
  );
}

/* ── Quadrant Node ───────────────────────────────────────────── */
function QuadrantNode({ data }: NodeProps) {
  return (
    <div className="w-[500px] h-[400px] border border-white/20 rounded-lg overflow-hidden select-none">
      <div className="text-center py-1 text-xs font-semibold text-white/60 uppercase tracking-widest border-b border-white/10">
        {data.label as string}
      </div>
      <div className="grid grid-cols-2 grid-rows-2 h-[calc(100%-28px)]">
        {["Top Left", "Top Right", "Bottom Left", "Bottom Right"].map((q, i) => (
          <div key={i} className={`flex items-center justify-center text-xs text-white/30 ${i % 2 === 0 ? "border-r border-white/10" : ""} ${i < 2 ? "border-b border-white/10" : ""}`}>
            {(data as any)[`q${i}`] || q}
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { sticky: StickyNode, mind: MindNode, text: TextNode, quadrant: QuadrantNode };

/* ── Templates ───────────────────────────────────────────────── */
const TEMPLATES: Record<string, { nodes: Node[]; edges: Edge[] }> = {
  mindmap: {
    nodes: [
      { id: "c", type: "mind", position: { x: 300, y: 200 }, data: { label: "Central Idea", color: "#ef4444" } },
      { id: "1", type: "mind", position: { x: 80,  y: 80  }, data: { label: "Branch 1",    color: "#6366f1" } },
      { id: "2", type: "mind", position: { x: 500, y: 80  }, data: { label: "Branch 2",    color: "#06b6d4" } },
      { id: "3", type: "mind", position: { x: 80,  y: 320 }, data: { label: "Branch 3",    color: "#10b981" } },
      { id: "4", type: "mind", position: { x: 500, y: 320 }, data: { label: "Branch 4",    color: "#f59e0b" } },
    ],
    edges: [
      { id: "e-c1", source: "c", target: "1", type: "default" },
      { id: "e-c2", source: "c", target: "2", type: "default" },
      { id: "e-c3", source: "c", target: "3", type: "default" },
      { id: "e-c4", source: "c", target: "4", type: "default" },
    ],
  },
  swot: {
    nodes: [
      { id: "title", type: "text",     position: { x: 200, y: 20  }, data: { label: "SWOT Analysis" } },
      { id: "q",     type: "quadrant", position: { x: 20,  y: 60  }, data: { label: "SWOT", q0: "Strengths", q1: "Weaknesses", q2: "Opportunities", q3: "Threats" } },
    ],
    edges: [],
  },
  assumption: {
    nodes: [
      { id: "title", type: "text",     position: { x: 160, y: 20  }, data: { label: "Assumption Map" } },
      { id: "q",     type: "quadrant", position: { x: 20,  y: 60  }, data: { label: "Important ↔ Known", q0: "Validate First", q1: "Monitor", q2: "Deprioritise", q3: "Research" } },
      { id: "s1", type: "sticky", position: { x: 60,  y: 110 }, data: { label: "Add assumption", color: "yellow" } },
      { id: "s2", type: "sticky", position: { x: 300, y: 110 }, data: { label: "Add assumption", color: "blue"   } },
      { id: "s3", type: "sticky", position: { x: 60,  y: 320 }, data: { label: "Add assumption", color: "green"  } },
      { id: "s4", type: "sticky", position: { x: 300, y: 320 }, data: { label: "Add assumption", color: "purple" } },
    ],
    edges: [],
  },
};

/* ── Main Canvas ─────────────────────────────────────────────── */
let _id = 100;
const uid = () => `n${++_id}`;

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [templateOpen, setTemplateOpen] = useState(false);

  const onConnect = useCallback((c: Connection) =>
    setEdges(eds => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "#6366f1" } }, eds)),
  [setEdges]);

  const addNode = (type: string, label: string, extra: object = {}) => {
    const id = uid();
    setNodes(ns => [...ns, {
      id, type,
      position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 100 },
      data: {
        label,
        ...extra,
        onLabelChange: (val: string) => setNodes(ns2 => ns2.map(n => n.id === id ? { ...n, data: { ...n.data, label: val } } : n)),
        onColorChange: (col: string) => setNodes(ns2 => ns2.map(n => n.id === id ? { ...n, data: { ...n.data, color: col } } : n)),
      },
    }]);
  };

  const loadTemplate = (key: string) => {
    const t = TEMPLATES[key];
    if (!t) return;
    const withHandlers = t.nodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        onLabelChange: (val: string) => setNodes(ns => ns.map(x => x.id === n.id ? { ...x, data: { ...x.data, label: val } } : x)),
        onColorChange: (col: string) => setNodes(ns => ns.map(x => x.id === n.id ? { ...x, data: { ...x.data, color: col } } : x)),
      },
    }));
    setNodes(withHandlers);
    setEdges(t.edges);
    setTemplateOpen(false);
  };

  const deleteSelected = () => {
    setNodes(ns => ns.filter(n => !n.selected));
    setEdges(es => es.filter(e => !e.selected));
  };

  return (
    <div className="h-full w-full bg-[#0d0f13]">
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        defaultEdgeOptions={{ style: { stroke: "#6366f1", strokeWidth: 2 } }}
      >
        <Background color="#ffffff08" gap={24} size={1} />
        <Controls className="[&>button]:bg-[#1a1d24] [&>button]:border-white/10 [&>button]:text-slate-400" />
        <MiniMap className="!bg-[#1a1d24] !border-white/10" nodeColor="#6366f1" />

        <Panel position="top-left" className="flex items-center gap-2 flex-wrap">
          {/* Add nodes */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#1a1d24] p-1">
            <button onClick={() => addNode("sticky", "", { color: "yellow" })}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
              <StickyNote size={12} /> Sticky
            </button>
            <button onClick={() => addNode("mind", "New idea")}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
              <Circle size={12} /> Node
            </button>
            <button onClick={() => addNode("text", "Text block")}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
              <Type size={12} /> Text
            </button>
            <button onClick={() => addNode("quadrant", "2×2 Matrix", { q0: "Top Left", q1: "Top Right", q2: "Bottom Left", q3: "Bottom Right" })}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
              <LayoutGrid size={12} /> Matrix
            </button>
          </div>

          {/* Templates */}
          <div className="relative">
            <button onClick={() => setTemplateOpen(o => !o)}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#1a1d24] px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors">
              <GitBranch size={12} /> Templates <ChevronDown size={10} className={`transition-transform ${templateOpen ? "rotate-180" : ""}`} />
            </button>
            {templateOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setTemplateOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-white/10 bg-[#1a1d24] p-1 shadow-xl">
                  {[
                    { key: "mindmap",    label: "Mind Map" },
                    { key: "swot",       label: "SWOT Analysis" },
                    { key: "assumption", label: "Assumption Map" },
                  ].map(t => (
                    <button key={t.key} onClick={() => loadTemplate(t.key)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-white/[.06] hover:text-white transition-colors">
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Delete */}
          <button onClick={deleteSelected}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#1a1d24] px-3 py-2 text-xs text-slate-500 hover:border-red-500/40 hover:text-red-400 transition-colors">
            <Trash2 size={12} /> Delete selected
          </button>
        </Panel>

        {nodes.length === 0 && (
          <Panel position="top-center" className="pointer-events-none mt-32">
            <div className="text-center">
              <p className="text-slate-600 text-sm mb-1">Start with a template or add nodes from the toolbar</p>
              <p className="text-slate-700 text-xs">Double-click any node to edit · Drag between nodes to connect</p>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
