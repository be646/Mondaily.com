import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Users, CheckSquare, FileText, Building2, TrendingUp, X } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// useNavigate is used inside QuickCreateRecord

type ActionType = "navigate" | "create_task" | "create_note" | "create_contact" | "create_company" | "create_deal";

interface Action {
  label: string;
  description?: string;
  icon: any;
  type: ActionType;
  to?: string;
  shortcut?: string;
}

const ACTIONS: Action[] = [
  { label: "New Task",    description: "Create a task without leaving this page", icon: CheckSquare, type: "create_task",    shortcut: "T" },
  { label: "New Note",    description: "Add a note instantly",                    icon: FileText,    type: "create_note",    shortcut: "N" },
  { label: "New Contact", description: "Add a person to your CRM",                icon: Users,       type: "create_contact", shortcut: "C" },
  { label: "New Company", description: "Add a company to your CRM",               icon: Building2,   type: "create_company" },
  { label: "New Deal",    description: "Create a new deal",                        icon: TrendingUp,  type: "create_deal",    shortcut: "D" },
];

function QuickCreateTask({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => apiClient.post("/tasks", { title, priority, due_date: dueDate || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });
  return (
    <div className="p-4 border-t border-white/10">
      <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wide">New Task</p>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && title.trim() && create.mutate()} placeholder="Task title..." className="h-9 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white mb-2"/>
      <div className="flex gap-2 mb-3">
        <select value={priority} onChange={e => setPriority(e.target.value)} className="h-9 flex-1 rounded-lg border border-white/10 bg-[#0b0d10] px-2 text-xs text-white">
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 flex-1 rounded-lg border border-white/10 bg-transparent px-2 text-xs text-white"/>
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 h-8 rounded-lg border border-white/10 text-xs text-slate-400">Cancel</button>
        <button onClick={() => title.trim() && create.mutate()} disabled={!title.trim()} className="flex-1 h-8 rounded-lg bg-red-600 text-xs text-white disabled:opacity-50">{create.isPending ? "Creating..." : "Create"}</button>
      </div>
    </div>
  );
}

function QuickCreateRecord({ type, onClose }: { type: "contact" | "company" | "deal" | "note"; onClose: () => void }) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();

  const objectType = type === "contact" ? "people" : type === "company" ? "companies" : type === "deal" ? "deals" : "notes";
  const placeholder = type === "contact" ? "Full name" : type === "company" ? "Company name" : type === "deal" ? "Deal name" : "Note title";
  const extraPlaceholder = type === "contact" ? "Email (optional)" : type === "company" ? "Website (optional)" : type === "deal" ? "Value (optional)" : "Content...";

  const create = useMutation({
    mutationFn: () => {
      if (type === "note") {
        return apiClient.post("/notes", { title: name, content: extra });
      }
      const data: Record<string, string> = { name };
      if (extra) data[type === "contact" ? "email" : type === "company" ? "website" : "value"] = extra;
      return apiClient.post("/nodes", { vertical: "shared", object_type: objectType, data });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["records", objectType] });
      onClose();
      if (data?.id && type !== "note") navigate(`/objects/${objectType}/${data.id}`);
    }
  });

  return (
    <div className="p-4 border-t border-white/10">
      <p className="text-xs text-slate-500 mb-3 font-medium uppercase tracking-wide">New {type.charAt(0).toUpperCase() + type.slice(1)}</p>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white mb-2"/>
      {type === "note" ? (
        <textarea value={extra} onChange={e => setExtra(e.target.value)} placeholder={extraPlaceholder} rows={2} className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white resize-none mb-2"/>
      ) : (
        <input value={extra} onChange={e => setExtra(e.target.value)} placeholder={extraPlaceholder} className="h-9 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white mb-2"/>
      )}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 h-8 rounded-lg border border-white/10 text-xs text-slate-400">Cancel</button>
        <button onClick={() => name.trim() && create.mutate()} disabled={!name.trim()} className="flex-1 h-8 rounded-lg bg-red-600 text-xs text-white disabled:opacity-50">{create.isPending ? "Creating..." : "Create"}</button>
      </div>
    </div>
  );
}

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const [activeCreate, setActiveCreate] = useState<ActionType | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setActiveCreate(null); }
    };
    const opener = () => { setOpen(o => !o); setActiveCreate(null); };
    window.addEventListener("keydown", handler);
    window.addEventListener("mondaily:open-quick-actions", opener);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("mondaily:open-quick-actions", opener);
    };
  }, []);

  const createType = activeCreate?.replace("create_", "") as any;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-start p-4 md:items-end md:justify-start md:pb-6 md:pl-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => { setOpen(false); setActiveCreate(null); }}/>
          <div className="relative w-72 rounded-2xl border border-white/[.08] bg-[#13151a] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
            {!activeCreate ? (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[.07]">
                  <span className="text-sm font-semibold text-white">Quick Create</span>
                  <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-white transition-colors">
                    <X size={14}/>
                  </button>
                </div>
                <div className="p-2">
                  {ACTIONS.map(action => (
                    <button
                      key={action.label}
                      onClick={() => setActiveCreate(action.type)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[.06] transition-colors group"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors">
                        <action.icon size={14} className="text-red-400"/>
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{action.label}</div>
                        {action.description && <div className="text-[11px] text-slate-600">{action.description}</div>}
                      </div>
                      {action.shortcut && (
                        <kbd className="rounded border border-white/[.08] bg-white/[.04] px-1.5 py-0.5 text-[10px] text-slate-600">{action.shortcut}</kbd>
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-white/[.05] px-4 py-2 text-[10px] text-slate-700">
                  Use ⌘K to search & navigate
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-white/[.07] px-4 py-3">
                  <button onClick={() => setActiveCreate(null)} className="text-slate-500 hover:text-white transition-colors">
                    <X size={14}/>
                  </button>
                  <span className="text-sm font-semibold text-white">{ACTIONS.find(a => a.type === activeCreate)?.label}</span>
                </div>
                {createType === "task" && <QuickCreateTask onClose={() => { setActiveCreate(null); setOpen(false); }}/>}
                {(createType === "contact" || createType === "company" || createType === "deal" || createType === "note") && (
                  <QuickCreateRecord type={createType} onClose={() => { setActiveCreate(null); setOpen(false); }}/>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
