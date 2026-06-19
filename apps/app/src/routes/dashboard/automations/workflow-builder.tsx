import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Play, GitBranch, Mail, Bell, Tag, UserPlus,
  Zap, CheckSquare, ChevronDown, X, Clock, Filter, Sparkles, Loader2, Save,
} from "lucide-react";
import { apiClient } from "../../../lib/api-client";

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
  trigger:   { border: "border-indigo-500/30",    bg: "bg-indigo-500/[.06]",    text: "text-indigo-400",    icon: "border-indigo-500/20 bg-indigo-500/[.08] text-indigo-400" },
  condition: { border: "border-yellow-500/30", bg: "bg-yellow-500/[.05]", text: "text-yellow-400", icon: "border-yellow-500/20 bg-yellow-500/[.08] text-yellow-400" },
  action:    { border: "border-blue-500/30",   bg: "bg-blue-500/[.05]",   text: "text-blue-400",   icon: "border-blue-500/20 bg-blue-500/[.08] text-blue-400" },
};

function kindLabel(k: NodeKind) {
  return k === "trigger" ? "Trigger" : k === "condition" ? "Condition" : "Action";
}

// ── Node config fields ────────────────────────────────────────────────────────
function NodeConfigFields({ node, onChange }: { node: WFNode; onChange: (config: Record<string, string>) => void }) {
  const set = (key: string, val: string) => onChange({ ...node.config, [key]: val });
  const inp = (key: string, placeholder: string, type = "text") => (
    <input
      type={type}
      value={node.config[key] ?? ""}
      onChange={e => set(key, e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none focus:border-current/30"
    />
  );

  if (node.type === "field_equals" || node.type === "field_contains") return (
    <div className="space-y-2">
      {inp("field", "Field name (e.g. status, stage)")}
      {inp("value", node.type === "field_equals" ? "Equals…" : "Contains…")}
    </div>
  );
  if (node.type === "field_changed") return inp("field", "Field name (e.g. stage)");
  if (node.type === "time_elapsed") return (
    <div className="flex gap-2">
      {inp("amount", "Amount", "number")}
      <select value={node.config.unit ?? "days"} onChange={e => set("unit", e.target.value)}
        className="flex-1 rounded-md border border-white/[.07] bg-[#0d0f13] px-2 py-1.5 text-xs text-white outline-none">
        <option value="minutes">Minutes</option>
        <option value="hours">Hours</option>
        <option value="days">Days</option>
      </select>
    </div>
  );
  if (node.type === "send_email") return (
    <div className="space-y-2">
      {inp("to", "To (e.g. {email} or fixed address)")}
      {inp("subject", "Subject line")}
      <textarea value={node.config.body ?? ""} onChange={e => set("body", e.target.value)}
        placeholder="Email body… use {first_name}, {company} tokens"
        rows={3}
        className="w-full rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none resize-none focus:border-current/30"
      />
    </div>
  );
  if (node.type === "create_task") return (
    <div className="space-y-2">
      {inp("task_title", "Task title")}
      {inp("due_in_days", "Due in (days)", "number")}
      {inp("assignee", "Assign to (name or {owner})")}
    </div>
  );
  if (node.type === "assign_owner") return inp("owner", "Owner name or email");
  if (node.type === "add_to_sequence") return inp("sequence_name", "Sequence name");
  if (node.type === "send_notification") return inp("message", "Notification message");
  if (node.type === "update_field") return (
    <div className="space-y-2">
      {inp("field", "Field name")}
      {inp("value", "New value")}
    </div>
  );
  return null;
}

// ── Node card ─────────────────────────────────────────────────────────────────
function WFNodeCard({ node, onDelete, onAddAfter, onUpdate }: {
  node: WFNode;
  onDelete: (id: string) => void;
  onAddAfter: (id: string) => void;
  onUpdate: (id: string, config: Record<string, string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const s = KIND_STYLES[node.kind];
  const allNodes = node.kind === "trigger" ? TRIGGERS : node.kind === "condition" ? CONDITIONS : ACTIONS;
  const def = allNodes.find(n => n.type === node.type) ?? allNodes[0]!;
  const Icon = def.icon;

  return (
    <div className="flex flex-col items-center">
      <div className={`group w-72 rounded-xl border ${s.border} ${s.bg} overflow-hidden`}>
        <button
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => setExpanded(e => !e)}
        >
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${s.icon}`}>
            <Icon size={13}/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-widest opacity-50">{kindLabel(node.kind)}</p>
            <p className="text-xs font-medium text-white">{node.label}</p>
          </div>
          <ChevronDown size={12} className={`shrink-0 text-slate-600 transition-transform ${expanded ? "rotate-180" : ""}`}/>
          {node.kind !== "trigger" && (
            <span
              role="button"
              onClick={e => { e.stopPropagation(); onDelete(node.id); }}
              className="opacity-0 group-hover:opacity-100 rounded-md p-1 text-slate-700 hover:bg-indigo-500/10 hover:text-indigo-400 transition-all"
            >
              <X size={12}/>
            </span>
          )}
        </button>

        {expanded && (
          <div className="border-t border-white/[.06] px-4 py-3" onClick={e => e.stopPropagation()}>
            <NodeConfigFields node={node} onChange={cfg => onUpdate(node.id, cfg)}/>
          </div>
        )}
      </div>

      {/* Add node button */}
      <div className="flex flex-col items-center">
        <div className="h-5 w-px bg-white/[.08]"/>
        <button
          onClick={() => onAddAfter(node.id)}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[.10] bg-[#0d0f13] text-slate-600 hover:border-indigo-500/30 hover:bg-indigo-500/[.08] hover:text-indigo-400 transition-all"
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
      <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_24px_64px_rgba(0,0,0,0.7)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-3">
          <p className="text-xs font-semibold text-white">Add step</p>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300"><X size={14}/></button>
        </div>
        <div className="flex border-b border-white/[.06]">
          {(["condition","action"] as NodeKind[]).map(k => (
            <button
              key={k}
              onClick={() => setSection(k)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${section === k ? "border-b-2 border-indigo-500 text-white" : "text-slate-500 hover:text-slate-300"}`}
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

// ── AI Workflow Generator Modal ───────────────────────────────────────────────
function AIWorkflowModal({ onClose, onApply }: {
  onClose: () => void;
  onApply: (name: string, nodes: WFNode[]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ name: string; nodes: Array<{ kind: NodeKind; type: string; label: string }> } | null>(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(""); setPreview(null);
    try {
      const res = await apiClient.post<{ name: string; nodes: Array<{ kind: NodeKind; type: string; label: string }> }>("/generate/workflow", { prompt });
      setPreview(res);
    } catch (e: any) { setError(e.message || "Failed to generate"); }
    finally { setLoading(false); }
  };

  const apply = () => {
    if (!preview) return;
    const wfNodes: WFNode[] = preview.nodes.map(n => ({
      id: crypto.randomUUID(),
      kind: n.kind,
      type: n.type,
      label: n.label,
      config: {},
      children: [],
    }));
    // Ensure first node is a trigger; if not, prepend default
    if (wfNodes[0]?.kind !== "trigger") {
      wfNodes.unshift({ id: "trigger-1", kind: "trigger", type: "record_created", label: "Record created", config: {}, children: [] });
    } else {
      wfNodes[0].id = "trigger-1";
    }
    onApply(preview.name, wfNodes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className={`w-full rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_24px_64px_rgba(0,0,0,0.7)] transition-all ${preview ? "max-w-lg" : "max-w-md"}`}>
        <div className="flex items-center justify-between p-5 border-b border-white/[.06]">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-violet-400"/>
            <h2 className="font-semibold text-white">Generate workflow with AI</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16}/></button>
        </div>

        <div className="p-5 space-y-4">
          <textarea
            autoFocus
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            placeholder={`e.g. "When a deal is marked as Won, create a follow-up task and notify the team" or "Send a welcome email when a contact form is submitted"`}
            className="w-full rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5 text-sm text-white placeholder-slate-600 resize-none outline-none focus:border-violet-500/40 transition-colors"
          />
          {error && <p className="text-xs text-indigo-400">{error}</p>}
        </div>

        {preview && (
          <div className="border-t border-white/[.06] px-5 pb-4">
            <p className="py-3 text-xs font-semibold text-slate-400">"{preview.name}"</p>
            <div className="space-y-1.5">
              {preview.nodes.map((n, i) => {
                const s = KIND_STYLES[n.kind];
                return (
                  <div key={i} className={`flex items-center gap-3 rounded-lg border ${s.border} ${s.bg} px-3 py-2`}>
                    <span className={`text-[9px] font-bold uppercase tracking-widest w-16 shrink-0 ${s.text}`}>{n.kind}</span>
                    <span className="text-xs text-slate-300">{n.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-5 border-t border-white/[.06]">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">Cancel</button>
          {!preview ? (
            <button onClick={generate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-violet-500">
              {loading ? <><Loader2 size={13} className="animate-spin"/> Generating…</> : <><Sparkles size={13}/> Generate</>}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={generate} disabled={loading} className="text-sm text-slate-500 hover:text-slate-300">Regenerate</button>
              <button onClick={apply}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">
                <Sparkles size={13}/> Apply to builder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
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
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<WFNode[]>(DEFAULT_NODES);
  const [picking, setPicking] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [name, setName] = useState("New Workflow");
  const [nameEdit, setNameEdit] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>(id === "new" ? undefined : id);
  const [triggerType, setTriggerType] = useState("record_created");

  // Load existing workflow
  useEffect(() => {
    if (!id || id === "new") return;
    apiClient.get<{ id: string; name: string; status: string; nodes: WFNode[] }>(`/workflows/${id}`)
      .then(wf => {
        setName(wf.name);
        setStatus(wf.status as "draft" | "active");
        if (Array.isArray(wf.nodes) && wf.nodes.length > 0) {
      setNodes(wf.nodes);
      const trigger = wf.nodes.find((n: WFNode) => n.kind === "trigger");
      if (trigger) setTriggerType(trigger.type);
    }
      })
      .catch(() => {});
  }, [id]);

  async function saveWorkflow() {
    setSaving(true);
    try {
      const targetId = currentId ?? "new";
      const wf = await apiClient.patch<{ id: string }>(`/workflows/${targetId}`, { name, status, nodes });
      if (!currentId) {
        setCurrentId(wf.id);
        navigate(`/automations/workflows/${wf.id}`, { replace: true });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  }

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

  const updateNodeConfig = (id: string, config: Record<string, string>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, config } : n));
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
            className="flex-1 bg-transparent text-[15px] font-semibold text-white outline-none border-b border-indigo-500/40 pb-0.5"
          />
        ) : (
          <h1
            className="flex-1 cursor-pointer text-[15px] font-semibold text-white hover:text-indigo-400 transition-colors"
            onClick={() => setNameEdit(true)}
          >
            {name}
          </h1>
        )}

        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${status === "active" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-slate-600/30 bg-slate-700/50 text-slate-400"}`}>
          {status}
        </span>

        <button onClick={() => setAiOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-600/30 transition-colors">
          <Sparkles size={12}/> Generate with AI
        </button>

        <button onClick={saveWorkflow} disabled={saving}
          className="flex items-center gap-1.5 rounded-lg border border-white/[.06] bg-white/[.04] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-50 transition-colors">
          {saving ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>}
          {saved ? "Saved!" : saving ? "Saving…" : "Save"}
        </button>

        <button
          onClick={() => { setStatus(s => s === "active" ? "draft" : "active"); }}
          className={`flex items-center gap-1.5 rounded-lg border-x border-t border-b-[3px] px-3 py-1.5 text-xs font-semibold transition-all active:translate-y-[1px] ${status === "active" ? "border-yellow-500/40 border-b-yellow-700 bg-yellow-500/80 text-white" : "border-indigo-500/50 border-b-red-700 bg-indigo-500 text-white hover:bg-indigo-400"}`}
        >
          {status === "active" ? "Pause" : <><Play size={11}/> Activate</>}
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto">
        <div className="min-h-full bg-[radial-gradient(#1a1d24_1px,transparent_1px)] [background-size:18px_18px] flex justify-center py-12 px-6">
          <div className="flex flex-col items-center">

            {/* Trigger config */}
            <div className="mb-2 w-72 rounded-xl border border-indigo-500/30 bg-indigo-500/[.06] overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/[.08] text-indigo-400">
                  <TriggerIcon size={13}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-indigo-400/60">Trigger</p>
                  <p className="text-xs font-medium text-white">When this happens…</p>
                </div>
                <ChevronDown size={13} className="text-slate-600"/>
              </div>
              <div className="border-t border-white/[.06] px-4 py-2.5">
                <select
                  className="w-full rounded-md border border-white/[.07] bg-[#0d0f13] px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500/30"
                  value={triggerType}
                  onChange={e => {
                    const type = e.target.value;
                    const def = TRIGGERS.find(t => t.type === type) ?? TRIGGERS[0]!;
                    setTriggerType(type);
                    setNodes(prev => prev.map(n => n.kind === "trigger" ? { ...n, type, label: def.label } : n));
                  }}
                >
                  {TRIGGERS.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div className="h-5 w-px bg-white/[.08]"/>
            <button
              onClick={() => setPicking("trigger-1")}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[.10] bg-[#0d0f13] text-slate-600 hover:border-indigo-500/30 hover:bg-indigo-500/[.08] hover:text-indigo-400 transition-all"
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
                onUpdate={updateNodeConfig}
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

      {/* AI workflow generator */}
      {aiOpen && (
        <AIWorkflowModal
          onClose={() => setAiOpen(false)}
          onApply={(newName, newNodes) => { setName(newName); setNodes(newNodes); }}
        />
      )}
    </div>
  );
}
