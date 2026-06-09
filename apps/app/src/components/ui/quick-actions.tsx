import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Users, CheckSquare, FileText, Mail, Phone, BarChart2, Zap, Settings, Search, Bell, Building2, TrendingUp, X } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
  // Navigation
  { label: "Home", icon: Home, type: "navigate", to: "/home" },
  { label: "Tasks", icon: CheckSquare, type: "navigate", to: "/tasks" },
  { label: "Notes", icon: FileText, type: "navigate", to: "/notes" },
  { label: "People", icon: Users, type: "navigate", to: "/objects/people" },
  { label: "Companies", icon: Building2, type: "navigate", to: "/objects/companies" },
  { label: "Deals", icon: TrendingUp, type: "navigate", to: "/objects/deals" },
  { label: "Emails", icon: Mail, type: "navigate", to: "/emails" },
  { label: "Calls", icon: Phone, type: "navigate", to: "/calls" },
  { label: "Reports", icon: BarChart2, type: "navigate", to: "/reports" },
  { label: "Settings", icon: Settings, type: "navigate", to: "/settings/account" },
  // Create actions
  { label: "New Task", description: "Create a task without leaving this page", icon: CheckSquare, type: "create_task", shortcut: "T" },
  { label: "New Note", description: "Add a note instantly", icon: FileText, type: "create_note", shortcut: "N" },
  { label: "New Contact", description: "Add a person to your CRM", icon: Users, type: "create_contact", shortcut: "C" },
  { label: "New Company", description: "Add a company to your CRM", icon: Building2, type: "create_company" },
  { label: "New Deal", description: "Create a new deal", icon: TrendingUp, type: "create_deal", shortcut: "D" },
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
  const [query, setQuery] = useState("");
  const [activeCreate, setActiveCreate] = useState<ActionType | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
        setQuery("");
        setActiveCreate(null);
        setSelectedIdx(0);
      }
      if (e.key === "Escape") { setOpen(false); setActiveCreate(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = ACTIONS.filter(a => a.label.toLowerCase().includes(query.toLowerCase()) || (a.description?.toLowerCase().includes(query.toLowerCase())));

  const handleAction = (action: Action) => {
    if (action.type === "navigate") {
      navigate(action.to!);
      setOpen(false);
    } else {
      setActiveCreate(action.type);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); }
      if (e.key === "ArrowUp") { setSelectedIdx(i => Math.max(i - 1, 0)); e.preventDefault(); }
      if (e.key === "Enter" && !activeCreate) { const a = filtered[selectedIdx]; if (a) handleAction(a); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selectedIdx, activeCreate]);

  if (!open) return null;

  const createType = activeCreate?.replace("create_", "") as any;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div className="fixed inset-0 bg-black/60" onClick={() => { setOpen(false); setActiveCreate(null); }}/>
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#161820] shadow-2xl overflow-hidden">
        {!activeCreate ? (
          <>
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <Search size={15} className="text-slate-400 shrink-0"/>
              <input
                autoFocus
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
                placeholder="Search actions, navigate, or create..."
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
              />
              <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-xs text-slate-500">esc</kbd>
            </div>
            <div className="max-h-80 overflow-auto p-2">
              {/* Create section */}
              {query === "" && (
                <div className="mb-1">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Create</p>
                  {ACTIONS.filter(a => a.type !== "navigate").map((action, idx) => (
                    <button key={action.label} onClick={() => handleAction(action)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/[.06] hover:text-white transition-colors">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 shrink-0">
                        <action.icon size={13} className="text-red-400"/>
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm">{action.label}</div>
                        {action.description && <div className="text-xs text-slate-600">{action.description}</div>}
                      </div>
                      {action.shortcut && <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-xs text-slate-600">{action.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
              {/* Navigate section */}
              <div>
                {query === "" && <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Navigate</p>}
                {(query === "" ? ACTIONS.filter(a => a.type === "navigate") : filtered).map((action, idx) => (
                  <button key={action.label} onClick={() => handleAction(action)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${selectedIdx === idx && query !== "" ? "bg-white/[.08] text-white" : "text-slate-300 hover:bg-white/[.06] hover:text-white"}`}>
                    <action.icon size={15} className="text-slate-500 shrink-0"/>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
              {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">No results for "{query}"</div>}
            </div>
            <div className="border-t border-white/10 px-4 py-2 text-xs text-slate-600 flex items-center gap-3">
              <span><kbd className="rounded border border-white/10 px-1 py-0.5">↑↓</kbd> navigate</span>
              <span><kbd className="rounded border border-white/10 px-1 py-0.5">↵</kbd> select</span>
              <span><kbd className="rounded border border-white/10 px-1 py-0.5">⌘K</kbd> toggle</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <button onClick={() => setActiveCreate(null)} className="text-slate-400 hover:text-white">
                <X size={15}/>
              </button>
              <span className="text-sm text-white">Quick Create</span>
            </div>
            {createType === "task" && <QuickCreateTask onClose={() => { setActiveCreate(null); setOpen(false); }}/>}
            {(createType === "contact" || createType === "company" || createType === "deal" || createType === "note") && (
              <QuickCreateRecord type={createType} onClose={() => { setActiveCreate(null); setOpen(false); }}/>
            )}
          </>
        )}
      </div>
    </div>
  );
}
