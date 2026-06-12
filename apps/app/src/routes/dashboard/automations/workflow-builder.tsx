import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Plus, Play, GitBranch, Mail, Bell, Tag, UserPlus,
  Zap, CheckSquare, ChevronDown, X, Clock, Filter
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type NodeKind = "trigger" | "condition" | "action";

interface WFNode {
  id: string;
  kind: NodeKind;
  type: string;
  label: string;
  config: Record<string, string>;
  children: string[];
}

// ── Node definitions ──────────────────────────────────────────────────────────
const TRIGGERS = [
  { type: "record_created",    label: "Record created",     icon: Plus },
  { type: "record_updated",    label: "Record updated",     icon: Tag },
  { type: "deal_stage_change", label: "Deal stage changed", icon: GitBranch },
  { type: "email_received",    label: "Email received",     icon: Mail },
  { type: "form_submitted",    label: "Form submitted",     icon: CheckSquare },
];

const CONDITIONS = [
  { type: "field_equals",    label: "Field equals",       icon: Filter },
  { type: "field_contains",  label: "Field contains",     icon: Filter },
  { type: "field_changed",   label: "Field changed",      icon: Tag },
  { type: "time_elapsed",    label: "Time elapsed",       icon: Clock },
];

const ACTIONS = [
  { type: "send_email",      label: "Send email",         icon: Mail },
  { type: "create_task",     label: "Create task",        icon: CheckSquare },
  { type: "assign_owner",    label: "Assign owner",       icon: UserPlus },
  { type: "add_to_sequence", label: "Add to sequence",    icon: Zap },
  { type: "send_notification", label: "Send notification", icon: Bell },
  { type: "update_field",    label: "Update field",       icon: Tag },
];

const KIND_STYLES: Record<NodeKind, { border: string; bg: string; text: string; icon: string }> = {
  trigger:   { border: "border-red-500/30",    bg: "bg-red-500/[.06]",    text: "text-red-400",    icon: "border-red-500/20 bg-red-500/[.08] text-red-400" },
  condition: { border: "border-yellow-500/30", bg: "bg-yellow-500/[.05]", text: "text-yellow-400", icon: "border-yellow-500/20 bg-yellow-500/[.08] text-yellow-400" },
  action:    { border: "border-blue-500/30",   bg: "bg-blue-500/[.05]",   text: "text-blue-400",   icon: "border-blue-500/20 bg-blue-500/[.08] text-blue-400" },
};

function kindLabel(k: NodeKind) {
  return k === "trigger" ? "Trigger" : k === "condition" ? "Condition" : "Action";
}

// ── Node card ─────────────────────────────────────────────────────────────────
function WFNodeCard({ node, onDelete, onAddAfter }: {
  node: WFNode;
  onDelete: (id: string) => void;
  onAddAfter: (id: string) => void;
}) {
  const s = KIND_STYLES[node.kind];
  const allNodes = node.kind === "trigger" ? TRIGGERS : node.kind === "condition" ? CONDITIONS : ACTIONS;
  const def = allNodes.find(n => n.type === node.type) ?? allNodes[0]!;
  const Icon = def.icon;

  return (
    <div className="flex flex-col items-center">
      <div className={`group w-72 rounded-xl border ${s.border} ${s.bg} overflow-hidden`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${s.icon}`}>
            <Icon size={13}/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-widest opacity-50">{kindLabel(node.kind)}</p>
            <p className="text-xs font-medium text-white">{node.label}</p>
          </div>
          {node.kind !== "trigger" && (
            <button
              onClick={() => onDelete(node.id)}
              className="opacity-0 group-hover:opacity-100 rounded-md p-1 text-slate-700 hover:bg-red-500/10 hover:text-red-400 transition-all"
            >
              <X size={12}/>
            </button>
          )}
        </div>
      </div>

      {/* Add node button */}
      <div className="flex flex-col items-center">
        <div className="h-5 w-px bg-white/[.08]"/>
        <button
          onClick={() => onAddAfter(node.id)}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[.10] bg-[#0d0f13] text-slate-600 hover:border-red-500/30 hover:bg-red-500/[.08] hover:text-red-400 transition-all"
        >
          <Plus size={11}/>
        </button>
        <div className="h-5 w-px bg-white/[.08]"/>
      </div>
    </div>
  );
}

// ── Add-node picker ────────────────────────────────────────────────────────────
function NodePicker({ onPick, onClose }: {
  onPick: (kind: NodeKind, type: string, label: string) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<NodeKind>("action");

  const lists: Record<NodeKind, typeof TRIGGERS> = {
    trigger: TRIGGERS,
    condition: CONDITIONS,
    action: ACTIONS,
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[.08] bg-[#13151a] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
          <p className="text-xs font-semibold text-white">Add step</p>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300"><X size={14}/></button>
        </div>
        <div className="flex border-b border-white/[.06]">
          {(["condition","action"] as NodeKind[]).map(k => (
            <button
              key={k}
              onClick={() => setSection(k)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${section === k ? "border-b-2 border-red-500 text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              {kindLabel(k)}
            </button>
          ))}
        </div>
        <div className="py-1">
          {lists[section].map(item => {
            const Icon = item.icon;
            const s = KIND_STYLES[section];
            return (
              <button
                key={item.type}
                onClick={() => { onPick(section, item.type, item.label); onClose(); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-white/[.04] transition-colors"
              >
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${s.icon}`}>
                  <Icon size={11}/>
                </div>
                <span className="text-xs text-slate-300">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const DEFAULT_NODES: WFNode[] = [
  {
    id: "trigger-1",
    kind: "trigger",
    type: "record_created",
    label: "Record created",
    config: { object_type: "" },
    children: [],
  },
];

export function WorkflowBuilderPage() {
  const { id } = useParams();
  const [nodes, setNodes] = useState<WFNode[]>(DEFAULT_NODES);
  const [picking, setPicking] = useState<string | null>(null); // node id after which to insert
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [name, setName] = useState(id === "new" ? "New Workflow" : "Workflow");
  const [nameEdit, setNameEdit] = useState(false);

  const addNode = (afterId: string, kind: NodeKind, type: string, label: string) => {
    const newNode: WFNode = {
      id: crypto.randomUUID(),
      kind,
      type,
      label,
      config: {},
      children: [],
    };
    setNodes(prev => {
      const idx = prev.findIndex(n => n.id === afterId);
      const next = [...prev];
      next.splice(idx + 1, 0, newNode);
      return next;
    });
  };

  const deleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
  };

  const triggerNode = nodes.find(n => n.kind === "trigger");
  const TriggerIcon = TRIGGERS.find(t => t.type === triggerNode?.type)?.icon ?? Zap;

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[.06] px-6 py-3">
        <Link to="/automations" className="text-slate-600 hover:text-slate-300 transition-colors">
          <ArrowLeft size={15}/>
        </Link>

        {nameEdit ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => setNameEdit(false)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setNameEdit(false); }}
            className="flex-1 bg-transparent text-[15px] font-semibold text-white outline-none border-b border-red-500/40 pb-0.5"
          />
        ) : (
          <h1
            className="flex-1 cursor-pointer text-[15px] font-semibold text-white hover:text-red-400 transition-colors"
            onClick={() => setNameEdit(true)}
          >
            {name}
          </h1>
        )}

        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${status === "active" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-slate-600/30 bg-slate-700/50 text-slate-400"}`}>
          {status}
        </span>

        <button
          onClick={() => setStatus(s => s === "active" ? "draft" : "active")}
          className={`flex items-center gap-1.5 rounded-lg border-x border-t border-b-[3px] px-3 py-1.5 text-xs font-semibold transition-all active:translate-y-[1px] ${status === "active" ? "border-yellow-500/40 border-b-yellow-700 bg-yellow-500/80 text-white" : "border-red-500/50 border-b-red-700 bg-red-500 text-white hover:bg-red-400"}`}
        >
          {status === "active" ? "Pause" : <><Play size={11}/> Activate</>}
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto">
        <div className="min-h-full bg-[radial-gradient(#1a1d24_1px,transparent_1px)] [background-size:18px_18px] flex justify-center py-12 px-6">
          <div className="flex flex-col items-center">

            {/* Trigger config */}
            <div className="mb-2 w-72 rounded-xl border border-red-500/30 bg-red-500/[.06] overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/[.08] text-red-400">
                  <TriggerIcon size={13}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-red-400/60">Trigger</p>
                  <p className="text-xs font-medium text-white">When this happens…</p>
                </div>
                <ChevronDown size={13} className="text-slate-600"/>
              </div>
              <div className="border-t border-white/[.06] px-4 py-2.5">
                <select
                  className="w-full rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white outline-none focus:border-red-500/30"
                  defaultValue="record_created"
                >
                  {TRIGGERS.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div className="h-5 w-px bg-white/[.08]"/>
            <button
              onClick={() => setPicking("trigger-1")}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[.10] bg-[#0d0f13] text-slate-600 hover:border-red-500/30 hover:bg-red-500/[.08] hover:text-red-400 transition-all"
            >
              <Plus size={11}/>
            </button>
            <div className="h-5 w-px bg-white/[.08]"/>

            {/* Dynamic nodes */}
            {nodes.filter(n => n.kind !== "trigger").map(node => (
              <WFNodeCard
                key={node.id}
                node={node}
                onDelete={deleteNode}
                onAddAfter={(id) => setPicking(id)}
              />
            ))}

            {/* End cap */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[.06] bg-[#0d0f13] text-slate-700">
              <Zap size={14}/>
            </div>
          </div>
        </div>
      </div>

      {/* Node picker modal */}
      {picking && (
        <NodePicker
          onPick={(kind, type, label) => { addNode(picking, kind, type, label); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
