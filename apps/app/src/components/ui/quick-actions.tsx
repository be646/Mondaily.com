import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Users, CheckSquare, FileText, Building2, TrendingUp, ArrowLeft } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FieldSelect } from "./controls";

type ActionType = "create_task" | "create_note" | "create_contact" | "create_company" | "create_deal";

interface Action {
  label: string;
  description: string;
  icon: any;
  type: ActionType;
  shortcut?: string;
  color: string;
  iconBg: string;
}

const ACTIONS: Action[] = [
  { label: "New Task",    description: "Create a task without leaving this page", icon: CheckSquare, type: "create_task",    shortcut: "T", color: "text-[#2f9e6b]", iconBg: "bg-[#2f9e6b]/10" },
  { label: "New Note",    description: "Add a note instantly",                    icon: FileText,    type: "create_note",    shortcut: "N", color: "text-[#c6892e]",   iconBg: "bg-[#c6892e]/10"   },
  { label: "New Contact", description: "Add a person to the workspace graph",      icon: Users,       type: "create_contact", shortcut: "C", color: "text-[#717784]",    iconBg: "bg-[#717784]/10"    },
  { label: "New Company", description: "Add a company to the workspace graph",    icon: Building2,   type: "create_company",                color: "text-stone-400",  iconBg: "bg-stone-500/10"  },
  { label: "New Deal",    description: "Create a new deal",                        icon: TrendingUp,  type: "create_deal",    shortcut: "D", color: "text-[#d1524a]",    iconBg: "bg-[#d1524a]/10"    },
];

// Shared input style matching CommandPalette
const inputCls = "h-9 w-full rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-900 placeholder-stone-400 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 dark:placeholder-stone-600 dark:focus:border-stone-600";
const selectCls = "h-9 flex-1 rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:focus:border-stone-600";
const btnPrimary = "flex-1 h-9 rounded-md border border-stone-950 bg-stone-950 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-stone-800 disabled:opacity-40 dark:border-stone-50 dark:bg-stone-50 dark:text-stone-950 dark:hover:bg-stone-200";
const btnSecondary = "flex-1 h-9 rounded-md border border-stone-200 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-950 dark:border-stone-800 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-50";

function QuickCreateTask({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => apiClient.post("/tasks", { title, priority, due_date: dueDate || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });
  return (
    <>
      <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-3.5 dark:border-stone-800">
        <button onClick={onBack} className="shrink-0 text-stone-400 transition-colors hover:text-stone-950 dark:text-stone-600 dark:hover:text-stone-50">
          <ArrowLeft size={14}/>
        </button>
        <span className="text-sm font-semibold text-stone-950 dark:text-stone-50">New Task</span>
      </div>
      <div className="p-4 space-y-2.5">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && title.trim() && create.mutate()}
          placeholder="Task title…" className={inputCls}/>
        <div className="flex gap-2">
          <FieldSelect value={priority} onChange={v => setPriority(v)} ariaLabel="Priority" className="flex-1"
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "urgent", label: "Urgent" },
            ]} />
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className={`${selectCls} flex-1 dark:[color-scheme:dark]`}/>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onBack} className={btnSecondary}>Back</button>
          <button onClick={() => title.trim() && create.mutate()} disabled={!title.trim() || create.isPending} className={btnPrimary}>
            {create.isPending ? "Creating…" : "Create Task"}
          </button>
        </div>
      </div>
    </>
  );
}

function QuickCreateRecord({ type, onBack, onClose }: { type: "contact" | "company" | "deal" | "note"; onBack: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();

  const objectType = type === "contact" ? "people" : type === "company" ? "companies" : type === "deal" ? "deals" : "notes";
  const namePlaceholder = type === "contact" ? "Full name…" : type === "company" ? "Company name…" : type === "deal" ? "Deal name…" : "Note title…";
  const extraPlaceholder = type === "contact" ? "Email (optional)" : type === "company" ? "Website (optional)" : type === "deal" ? "Value (optional)" : "Content…";
  const titleLabel = type === "contact" ? "New Contact" : type === "company" ? "New Company" : type === "deal" ? "New Deal" : "New Note";

  const create = useMutation({
    mutationFn: () => {
      if (type === "note") return apiClient.post("/notes", { title: name, content: extra });
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
    <>
      <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-3.5 dark:border-stone-800">
        <button onClick={onBack} className="shrink-0 text-stone-400 transition-colors hover:text-stone-950 dark:text-stone-600 dark:hover:text-stone-50">
          <ArrowLeft size={14}/>
        </button>
        <span className="text-sm font-semibold text-stone-950 dark:text-stone-50">{titleLabel}</span>
      </div>
      <div className="p-4 space-y-2.5">
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && !extra && create.mutate()}
          placeholder={namePlaceholder} className={inputCls}/>
        {type === "note" ? (
          <textarea value={extra} onChange={e => setExtra(e.target.value)}
            placeholder={extraPlaceholder} rows={3}
            className="w-full resize-none rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none transition-colors focus:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 dark:placeholder-stone-600 dark:focus:border-stone-600"/>
        ) : (
          <input value={extra} onChange={e => setExtra(e.target.value)}
            placeholder={extraPlaceholder} className={inputCls}/>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onBack} className={btnSecondary}>Back</button>
          <button onClick={() => name.trim() && create.mutate()} disabled={!name.trim() || create.isPending} className={btnPrimary}>
            {create.isPending ? "Creating…" : `Create ${titleLabel.replace("New ", "")}`}
          </button>
        </div>
      </div>
    </>
  );
}

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const [activeCreate, setActiveCreate] = useState<ActionType | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setActiveCreate(null); } };
    const onOpen = () => { setOpen(o => !o); setActiveCreate(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mondaily:open-quick-actions", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mondaily:open-quick-actions", onOpen);
    };
  }, []);

  const close = () => { setOpen(false); setActiveCreate(null); };
  const back  = () => setActiveCreate(null);
  const createType = activeCreate?.replace("create_", "") as any;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4" onClick={close}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-sm border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
        onClick={e => e.stopPropagation()}
      >
        {!activeCreate ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3.5 dark:border-stone-800">
              <span className="text-sm font-semibold text-stone-950 dark:text-stone-50">Quick Create</span>
              <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-600">ESC</kbd>
            </div>

            {/* Action list */}
            <div className="py-1.5">
              {ACTIONS.map(action => (
                <button
                  key={action.label}
                  onClick={() => setActiveCreate(action.type)}
                  className="group flex w-full items-center gap-3 px-4 py-2.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${action.iconBg}`}>
                    <action.icon size={14} className={action.color}/>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm text-stone-700 transition-colors group-hover:text-stone-950 dark:text-stone-300 dark:group-hover:text-stone-50">{action.label}</div>
                    <div className="text-[11px] text-stone-400 dark:text-stone-600">{action.description}</div>
                  </div>
                  {action.shortcut && (
                    <kbd className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-600">{action.shortcut}</kbd>
                  )}
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-stone-200 px-4 py-2 dark:border-stone-800">
              <span className="text-[10px] text-stone-400 dark:text-stone-600">↵ select</span>
              <span className="ml-auto text-[10px] text-stone-400 dark:text-stone-600">⌘K to search</span>
            </div>
          </>
        ) : (
          <>
            {createType === "task" && (
              <QuickCreateTask onBack={back} onClose={close}/>
            )}
            {(createType === "contact" || createType === "company" || createType === "deal" || createType === "note") && (
              <QuickCreateRecord type={createType} onBack={back} onClose={close}/>
            )}
          </>
        )}
      </div>
    </div>
  );
}
