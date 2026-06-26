import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X, Clock, User, RotateCcw, ChevronDown, Trash2, Calendar, Pencil, Tag, ArrowUpDown, ArrowUp, ArrowDown, Flag, List, Columns3, Sheet, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DndContext, useDroppable, useDraggable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useUser } from "@clerk/react";
import { TaskDetailPanel } from "../../components/tasks/task-detail-panel";
import { apiClient } from "../../lib/api-client";
import { EmptyState, ErrorState, PageSkeleton } from "../../components/ui/page-state";

interface Member { id: string; user_id: string; email: string; name: string; }
interface Task {
  id: string; title: string; completed: boolean;
  due_date?: string; created_at?: string; updated_at?: string;
  assignee_id?: string; assignee_email?: string;
  record_id?: string; record_name?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "todo" | "in_progress" | "review" | "done";
  notes?: string;
  labels?: string[];
}

const LABEL_COLORS: Record<string, string> = {
  "Help Needed": "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "Blocked":     "text-stone-400 bg-stone-400/10 border-stone-400/30",
  "Waiting":     "text-stone-400 bg-stone-400/10 border-stone-400/30",
  "Bug":         "text-red-500 bg-stone-500/10 border-stone-500/30",
  "Feature":     "text-stone-400 bg-stone-400/10 border-stone-400/30",
  "Research":    "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
};

const PRIORITY_STYLE: Record<string, string> = {
  low:    "text-stone-400 bg-stone-400/10 border-stone-400/20",
  medium: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  high:   "text-orange-400 bg-orange-400/10 border-orange-400/20",
  urgent: "text-stone-400 bg-stone-400/10 border-stone-400/20",
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  todo:        { label: "To Do",        dot: "bg-stone-500" },
  in_progress: { label: "In Progress",  dot: "bg-blue-400" },
  review:      { label: "Needs Review", dot: "bg-yellow-400" },
  done:        { label: "Done",         dot: "bg-emerald-400" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Shared modal shell ────────────────────────────────────────────────────────
const INPUT = "key-input h-10 w-full px-3 text-sm";
const SELECT = "key-input h-10 w-full px-3 text-sm";
const BTN_CANCEL = "btn-secondary flex-1 h-10 text-sm";
const BTN_PRIMARY = "btn-primary flex-1 h-10 text-sm";

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4">
      <div className="surface-modal w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-soft)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
          <button onClick={onClose} className="btn-icon h-7 w-7"><X size={15}/></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Create Task modal ─────────────────────────────────────────────────────────
function CreateTaskModal({ onClose, members, currentUserId, userName }: { onClose: () => void; members: Member[]; currentUserId: string; userName: string }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("todo");
  const [notes, setNotes] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const qc = useQueryClient();

  const sorted = [...members].sort((a, b) => a.user_id === currentUserId ? -1 : b.user_id === currentUserId ? 1 : (a.name || a.email).localeCompare(b.name || b.email));

  const create = useMutation({
    mutationFn: () => {
      const member = members.find(m => m.user_id === assigneeId);
      return apiClient.post("/tasks", { title, due_date: dueDate ? dueDate + ":00" : undefined, priority, status, notes: notes || undefined, assignee_id: assigneeId || undefined, assignee_email: member?.email || undefined, _user_name: userName });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });

  return (
    <ModalShell title="New Task" onClose={onClose}>
      <div className="space-y-3">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && title.trim() && create.mutate()}
          placeholder="Task title…" className={INPUT}/>
        <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className={`${INPUT} dark:[color-scheme:dark]`}/>
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={SELECT}>
          <option value="">Unassigned</option>
          {sorted.map(m => <option key={m.user_id} value={m.user_id}>{m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email)}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select value={priority} onChange={e => setPriority(e.target.value)} className={SELECT}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className={SELECT}>
            <option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="done">Done</option>
          </select>
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes (optional)…"
          className="key-input w-full px-3 py-2 text-sm resize-none"/>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className={BTN_CANCEL}>Cancel</button>
          <button onClick={() => title.trim() && create.mutate()} disabled={!title.trim() || create.isPending} className={BTN_PRIMARY}>
            {create.isPending ? "Creating…" : "Create Task"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Edit Task modal ───────────────────────────────────────────────────────────
function EditTaskModal({ task, onClose, members, currentUserId }: { task: Task; onClose: () => void; members: Member[]; currentUserId: string }) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.due_date ? new Date(task.due_date).toISOString().slice(0,16) : "");
  const [priority, setPriority] = useState<"low"|"medium"|"high"|"urgent">(task.priority || "medium");
  const [status, setStatus] = useState<"todo"|"in_progress"|"review"|"done">(task.status || "todo");
  const [notes, setNotes] = useState(task.notes || "");
  const [assigneeId, setAssigneeId] = useState(task.assignee_id || "");
  const qc = useQueryClient();

  const sorted = [...members].sort((a, b) => a.user_id === currentUserId ? -1 : b.user_id === currentUserId ? 1 : (a.name || a.email).localeCompare(b.name || b.email));

  const update = useMutation({
    mutationFn: () => {
      const member = members.find(m => m.user_id === assigneeId);
      return apiClient.patch(`/tasks/${task.id}`, { title, due_date: dueDate || null, priority, status, notes: notes || null, assignee_id: assigneeId || null, assignee_email: member?.email || null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });

  return (
    <ModalShell title="Edit Task" onClose={onClose}>
      <div className="space-y-3">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className={INPUT}/>
        <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`${INPUT} dark:[color-scheme:dark]`}/>
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={SELECT}>
          <option value="">Unassigned</option>
          {sorted.map(m => <option key={m.user_id} value={m.user_id}>{m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email)}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select value={priority} onChange={e => setPriority(e.target.value as any)} className={SELECT}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value as any)} className={SELECT}>
            <option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="done">Done</option>
          </select>
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-[#111827] resize-none outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-500/20 dark:border-white/[.08] dark:bg-white/[.03] dark:text-white dark:focus:border-white/20 dark:focus:ring-0 transition-colors"/>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className={BTN_CANCEL}>Cancel</button>
          <button onClick={() => title.trim() && update.mutate()} disabled={!title.trim() || update.isPending} className={BTN_PRIMARY}>
            {update.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Board draggable card ──────────────────────────────────────────────────────
function DraggableCard({ task, onDetail, onEdit, onDelete, onToggle, currentUserId, getMemberName, flagged }: {
  task: Task; onDetail: (t: Task) => void; onEdit: (t: Task) => void;
  onDelete: (id: string) => void; onToggle: (t: Task) => void;
  currentUserId: string; getMemberName: (t: Task) => string | null;
  flagged?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 50 } : undefined;
  const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
  const assigneeName = getMemberName(task);

  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`rounded-xl border p-3 transition-all ${isDragging ? "shadow-2xl opacity-80 border-stone-500/40 bg-white dark:bg-[#1a1d24]" : "border-stone-200 bg-white hover:border-stone-300 dark:border-white/[.07] dark:bg-white/[.02] dark:hover:border-white/[.12]"}`}>
      {/* Drag handle covers the background only */}
      <div {...listeners} className="absolute inset-0 rounded-xl cursor-grab active:cursor-grabbing" style={{ zIndex: 0 }}/>
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-start gap-2 mb-2">
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onToggle(task)}
            className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : isOverdue ? "border-stone-400/60 hover:border-stone-400" : "border-stone-300 hover:border-stone-400 dark:border-white/25 dark:hover:border-white/50"}`}>
            {task.completed && <Check size={9} className="text-white"/>}
          </button>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onDetail(task)}
            className={`flex-1 text-left text-xs font-medium leading-snug hover:text-stone-600 dark:hover:text-white transition-colors ${task.completed ? "line-through text-stone-400 dark:text-stone-600" : "text-[#111827] dark:text-stone-200"}`}>
            {task.title}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {task.priority && task.priority !== "low" && (
              <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>
            )}
            {isOverdue && <span className="rounded-full border border-stone-500/30 bg-stone-600/10 px-1.5 py-px text-[10px] text-stone-400">Overdue</span>}
            {flagged && (
              <span className="flex items-center gap-1 rounded-full border border-stone-500/30 bg-stone-600/10 px-1.5 py-px text-[10px] font-medium text-stone-500 dark:text-stone-400" title="Operations Agent queued a recommendation for this task">
                <LogoMark size={9}/>AI flagged
              </span>
            )}
          </div>
          {/* Actions — always visible but subtle, no opacity-0 */}
          <div className="flex gap-0.5 shrink-0">
            <button onPointerDown={e => e.stopPropagation()} onClick={() => onEdit(task)}
              className="rounded-md p-1 text-stone-400 hover:text-stone-100 hover:bg-white/[.05] transition-colors"><Pencil size={10}/></button>
            {(task.assignee_id === currentUserId || !task.assignee_id) && (
              <button onPointerDown={e => e.stopPropagation()} onClick={() => onDelete(task.id)}
                className="rounded-md p-1 text-stone-400 hover:text-stone-400 hover:bg-stone-400/10 transition-colors"><Trash2 size={10}/></button>
            )}
          </div>
        </div>

        {(assigneeName || task.due_date) && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-stone-600">
            {assigneeName && <span className="flex items-center gap-0.5"><User size={9}/>{assigneeName.split(" ")[0]}</span>}
            {task.due_date && <span className={`flex items-center gap-0.5 ${isOverdue ? "text-stone-400" : ""}`}><Clock size={9}/>{fmtDate(task.due_date)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardColumn({ col, tasks, onDetail, onEdit, onDelete, onToggle, currentUserId, getMemberName, flaggedTaskIds }: {
  col: { key: string; label: string; dotColor: string };
  tasks: Task[]; onDetail: (t: Task) => void; onEdit: (t: Task) => void;
  onDelete: (id: string) => void; onToggle: (t: Task) => void;
  currentUserId: string; getMemberName: (t: Task) => string | null;
  flaggedTaskIds: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div className="flex flex-col min-w-[240px] w-[240px] shrink-0">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={`h-2 w-2 rounded-full shrink-0 ${col.dotColor}`}/>
        <span className="text-sm font-medium text-stone-300">{col.label}</span>
        <span className="ml-auto rounded-full bg-white/[.06] px-2 py-px text-[10px] text-stone-500">{tasks.length}</span>
      </div>
      <div ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-xl border-2 border-dashed p-2 space-y-2 transition-colors ${isOver ? "border-stone-500/30 bg-stone-600/[.03]" : "border-white/[.04] bg-white/[.01]"}`}>
        {tasks.length === 0 && <div className="flex h-16 items-center justify-center text-xs text-stone-700">Drop here</div>}
        {tasks.map(task => (
          <div key={task.id} className="relative">
            <DraggableCard task={task} onDetail={onDetail} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} currentUserId={currentUserId} getMemberName={getMemberName} flagged={flaggedTaskIds.has(task.id)}/>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI Suggest Tasks modal ────────────────────────────────────────────────────
function AISuggestModal({ onClose, members, currentUserId }: { onClose: () => void; members: Member[]; currentUserId: string }) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("Based on my current records and deals, what tasks should I work on this week?");
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    setLoading(true); setError(""); setSuggestions([]); setSelected(new Set());
    try {
      const res = await apiClient.post<{ tasks: any[] }>("/generate/tasks", { prompt, count, members: members.map(m => ({ email: m.email, name: m.name || m.email })) });
      setSuggestions(res.tasks ?? []);
      setSelected(new Set((res.tasks ?? []).map((_: any, i: number) => i)));
    } catch (e: any) { setError(e.message || "Failed to generate"); }
    finally { setLoading(false); }
  };

  const importSelected = async () => {
    setSaving(true);
    for (const t of suggestions.filter((_, i) => selected.has(i))) {
      const member = members.find(m => m.email === t.suggested_assignee_email);
      const dueDate = t.due_days ? new Date(Date.now() + t.due_days * 86400000).toISOString() : undefined;
      try { await apiClient.post("/tasks", { title: t.title, notes: t.notes || undefined, priority: t.priority || "medium", status: "todo", due_date: dueDate, assignee_id: member?.user_id || undefined, assignee_email: member?.email || undefined }); } catch {}
    }
    qc.invalidateQueries({ queryKey: ["tasks"] });
    setSaving(false); onClose();
  };

  const PCOL: Record<string, string> = { low: "text-stone-400", medium: "text-blue-400", high: "text-orange-400", urgent: "text-stone-400" };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4">
      <div className={`w-full rounded-2xl border border-stone-200 bg-white shadow-2xl overflow-hidden transition-all dark:border-white/[.09] dark:bg-[#141414] ${suggestions.length ? "max-w-2xl" : "max-w-md"}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-white/[.06]">
          <div className="flex items-center gap-2">
            <LogoMark size={14} className="text-stone-600 dark:text-stone-400"/>
            <span className="text-sm font-semibold text-[#111827] dark:text-white">Suggest tasks with AI</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-900 dark:text-stone-500 dark:hover:text-white transition-colors"><X size={15}/></button>
        </div>

        <div className="p-5 space-y-4">
          <textarea autoFocus value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-[#111827] placeholder-[#9ca3af] resize-none outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-500/20 dark:border-white/[.08] dark:bg-white/[.02] dark:text-white dark:placeholder-stone-600 dark:focus:border-stone-500/40 dark:focus:ring-0 transition-colors"/>
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-500 dark:text-stone-500">Suggest</span>
            <div className="flex gap-1">
              {[3,5,10].map(n => (
                <button key={n} onClick={() => setCount(n)}
                  className={`w-9 rounded-lg border py-1 text-xs font-medium transition-colors ${count === n ? "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-500/50 dark:bg-stone-500/10 dark:text-stone-300" : "border-stone-200 text-stone-500 hover:text-stone-800 dark:border-white/[.08] dark:text-stone-500 dark:hover:text-stone-300"}`}>{n}</button>
              ))}
            </div>
            <span className="text-xs text-stone-500 dark:text-stone-500">tasks</span>
          </div>
          {error && <p className="text-xs text-stone-600 dark:text-stone-400">{error}</p>}
        </div>

        {suggestions.length > 0 && (
          <div className="border-t border-stone-200 dark:border-white/[.06]">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-xs text-stone-500 dark:text-stone-500">{suggestions.length} suggestions</span>
              <button onClick={() => setSelected(prev => prev.size === suggestions.length ? new Set() : new Set(suggestions.map((_,i)=>i)))}
                className="text-xs text-stone-500 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-300 transition-colors">
                {selected.size === suggestions.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="max-h-64 overflow-auto">
              {suggestions.map((t, i) => (
                <button key={i} onClick={() => setSelected(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left border-b border-stone-100 hover:bg-stone-50 dark:border-white/[.04] dark:hover:bg-white/[.02] transition-colors ${selected.has(i) ? "" : "opacity-40"}`}>
                  <div className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${selected.has(i) ? "bg-stone-600 border-stone-600" : "border-stone-300 dark:border-white/20"}`}>
                    {selected.has(i) && <Check size={10} className="text-white"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#111827] dark:text-white">{t.title}</p>
                    {t.notes && <p className="text-xs text-stone-500 dark:text-stone-500 mt-0.5 truncate">{t.notes}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-medium capitalize ${PCOL[t.priority] ?? "text-stone-400 dark:text-stone-400"}`}>{t.priority}</span>
                      {t.due_days && <span className="text-[10px] text-stone-400 dark:text-stone-600">due in {t.due_days}d</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-t border-stone-200 dark:border-white/[.06]">
          <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-300 transition-colors">Cancel</button>
          {suggestions.length === 0 ? (
            <button onClick={generate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 rounded-xl bg-stone-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-stone-700 dark:hover:bg-stone-500 transition-colors">
              {loading ? <><Loader2 size={13} className="animate-spin"/> Generating…</> : <><LogoMark size={13}/> Generate</>}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={generate} disabled={loading} className="text-sm text-stone-500 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-300 transition-colors">
                {loading ? "Regenerating…" : "Regenerate"}
              </button>
              <button onClick={importSelected} disabled={selected.size === 0 || saving}
                className="flex items-center gap-2 rounded-xl bg-stone-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-stone-700 dark:hover:bg-stone-500 transition-colors">
                {saving ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
                Add {selected.size} task{selected.size !== 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function TasksPage() {
  const qc = useQueryClient();
  const { user } = useUser();
  const location = useLocation();

  useEffect(() => { apiClient.post("/tasks/check-overdue", {}).catch(() => {}); }, []);

  const navState = (location.state ?? {}) as { filter?: string; priority?: string };
  const [filter, setFilter] = useState<string>(navState.filter ?? "mine");
  const [showCreate, setShowCreate]       = useState(false);
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [detailTask, setDetailTask]       = useState<Task | null>(null);
  const [showDone, setShowDone]           = useState(false);
  const [labelFilter, setLabelFilter]     = useState("");
  const [priorityFilter, setPriorityFilter] = useState(navState.priority ?? "");
  const [priorityOpen, setPriorityOpen]   = useState(false);
  const [sortBy, setSortBy]               = useState("created_at");
  const [sortDir, setSortDir]             = useState<"asc" | "desc">("desc");
  const [labelOpen, setLabelOpen]         = useState(false);
  const [sortOpen, setSortOpen]           = useState(false);
  const [editTask, setEditTask]           = useState<Task | null>(null);
  const [viewMode, setViewMode]           = useState<"list" | "board" | "sheet">("list");

  const query = useQuery({ queryKey: ["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir], queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${filter}${labelFilter ? `&label=${labelFilter}` : ""}${priorityFilter ? `&priority=${priorityFilter}` : ""}&sort=${sortBy}&dir=${sortDir}`) });
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  const members = membersQuery.data ?? [];

  // Real AI signal on task cards: which tasks have a pending Decision Queue
  // recommendation (queued by the overdue-task-decisions job). Fails quiet
  // if the decision_queue migration isn't applied yet — never blocks the list.
  const decisionsQuery = useQuery({
    queryKey: ["decisions", "pending", "task"],
    queryFn: () => apiClient.get<{ source_id: string | null }[]>("/decisions?status=pending"),
    staleTime: 30_000,
    retry: false,
  });
  const flaggedTaskIds = new Set((decisionsQuery.data ?? []).map(d => d.source_id).filter(Boolean) as string[]);
  const currentUserId = user?.id ?? "";

  const toggle = useMutation({
    mutationFn: (task: Task) => apiClient.patch(`/tasks/${task.id}`, { completed: !task.completed, _user_name: user?.fullName || user?.firstName || "Someone" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] })
  });
  const moveTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/tasks/${id}`, { status, _user_name: user?.fullName || user?.firstName || "Someone" }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData(["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir]);
      qc.setQueryData(["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir], (old: any) => old?.map((t: Task) => t.id === id ? { ...t, status } : t));
      return { prev };
    },
    onError: (_e: any, _v: any, ctx: any) => { if (ctx?.prev) qc.setQueryData(["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] })
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const BOARD_COLS: { key: string; label: string; dotColor: string }[] = [
    { key: "todo",        label: "To Do",       dotColor: "bg-stone-500"   },
    { key: "in_progress", label: "In Progress",  dotColor: "bg-blue-400"   },
    { key: "review",      label: "Review",       dotColor: "bg-yellow-400" },
    { key: "done",        label: "Done",         dotColor: "bg-emerald-400"},
  ];

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const targetCol = BOARD_COLS.find(c => c.key === over.id);
    if (!targetCol) return;
    const task = allTasks.find(t => t.id === active.id);
    if (!task || task.status === targetCol.key) return;
    moveTask.mutate({ id: String(active.id), status: targetCol.key });
  }

  const allTasks   = query.data ?? [];
  const tasks      = allTasks.filter(t => !t.completed && t.status !== "done");
  const doneTasks  = allTasks.filter(t => t.completed || t.status === "done");
  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date());

  const getMemberName = (task: Task) => {
    const m = members.find(m => m.user_id === task.assignee_id);
    if (!m) return task.assignee_email || null;
    return m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email);
  };

  // Shared dropdown closer
  const closeDropdowns = () => { setLabelOpen(false); setPriorityOpen(false); setSortOpen(false); };

  return (
    <div className={`mx-auto px-6 py-8 ${viewMode === "list" ? "max-w-3xl" : "max-w-full"}`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <p className="text-sm text-stone-500">Work assigned to you and your team.</p>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex gap-0.5 rounded-xl border border-stone-200 bg-stone-50 dark:border-white/[.07] dark:bg-white/[.02] p-0.5">
            {([["list","List",<List size={12}/>],["board","Board",<Columns3 size={12}/>],["sheet","Sheet",<Sheet size={12}/>]] as const).map(([mode, label, icon]) => (
              <button key={mode} onClick={() => setViewMode(mode as any)} title={label}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${viewMode === mode ? "bg-stone-200 text-stone-900 dark:bg-white/[.08] dark:text-white" : "text-stone-500 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-300"}`}>
                {icon}{label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAISuggest(true)}
            className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-stone-200 dark:border-stone-500/25 dark:bg-stone-500/[.07] dark:text-stone-400 dark:hover:bg-stone-500/[.13] transition-colors">
            <LogoMark size={12} className="text-[var(--accent)] dark:text-stone-400"/> Suggest with AI
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-stone-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 dark:hover:bg-stone-500 transition-colors">
            <Plus size={13}/> New Task
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="mb-5 flex items-center gap-1.5 flex-wrap">
        {/* Status */}
        <div className="flex gap-0.5 rounded-xl border border-stone-200 bg-stone-50 dark:border-white/[.07] dark:bg-white/[.02] p-0.5">
          {([
            { key: "mine",    label: "Mine" },
            { key: "all",     label: "All" },
            { key: "overdue", label: "Overdue", badge: overdueTasks.length },
            { key: "review",  label: "Review" },
          ]).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors ${filter === f.key ? "bg-stone-200 text-stone-900 dark:bg-white/[.08] dark:text-white" : "text-stone-500 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-300"}`}>
              {f.label}
              {f.badge && filter !== f.key && <span className="rounded-full bg-stone-100 px-1 py-px text-[10px] text-stone-700 dark:bg-stone-500/20 dark:text-stone-400">{f.badge}</span>}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-white/[.07]"/>

        {/* Label filter */}
        <div className="relative">
          {labelOpen && <div className="fixed inset-0 z-40" onClick={() => setLabelOpen(false)}/>}
          <button onClick={() => { setLabelOpen(o => !o); setPriorityOpen(false); setSortOpen(false); }}
            className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs transition-colors ${labelFilter ? "border-stone-500/30 bg-stone-600/[.06] text-stone-400" : "border-white/[.07] text-stone-500 hover:text-stone-300 hover:border-white/[.12]"}`}>
            <Tag size={11}/>{labelFilter || "Label"}<ChevronDown size={10} className={`transition-transform ${labelOpen ? "rotate-180" : ""}`}/>
          </button>
          {labelOpen && (
            <div className="dropdown-panel left-0 w-44 z-50">
              {[
                { value: "", label: "All labels", dot: "bg-stone-600" },
                { value: "Help Needed", label: "Help Needed", dot: "bg-blue-400" },
                { value: "Blocked",     label: "Blocked",     dot: "bg-stone-400" },
                { value: "Waiting",     label: "Waiting",     dot: "bg-stone-400" },
                { value: "Bug",         label: "Bug",         dot: "bg-stone-500" },
                { value: "Feature",     label: "Feature",     dot: "bg-stone-400" },
                { value: "Research",    label: "Research",    dot: "bg-cyan-400" },
              ].map(opt => (
                <button key={opt.value} onClick={() => { setLabelFilter(opt.value); setLabelOpen(false); }}
                  className={`dropdown-item ${labelFilter === opt.value ? "dropdown-item-active" : ""}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dot}`}/>{opt.label}
                  {labelFilter === opt.value && <Check size={12} className="ml-auto text-stone-400"/>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority filter */}
        <div className="relative">
          {priorityOpen && <div className="fixed inset-0 z-40" onClick={() => setPriorityOpen(false)}/>}
          <button onClick={() => { setPriorityOpen(o => !o); setLabelOpen(false); setSortOpen(false); }}
            className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs transition-colors ${priorityFilter ? "border-stone-500/30 bg-stone-600/[.06] text-stone-400" : "border-white/[.07] text-stone-500 hover:text-stone-300 hover:border-white/[.12]"}`}>
            <Flag size={11}/>{priorityFilter ? priorityFilter.charAt(0).toUpperCase()+priorityFilter.slice(1) : "Priority"}<ChevronDown size={10} className={`transition-transform ${priorityOpen ? "rotate-180" : ""}`}/>
          </button>
          {priorityOpen && (
            <div className="dropdown-panel left-0 w-40 z-50">
              {[
                { value: "",       label: "All priorities", dot: "bg-stone-600" },
                { value: "urgent", label: "Urgent",         dot: "bg-stone-500" },
                { value: "high",   label: "High",           dot: "bg-orange-400" },
                { value: "medium", label: "Medium",         dot: "bg-yellow-400" },
                { value: "low",    label: "Low",            dot: "bg-stone-400" },
              ].map(opt => (
                <button key={opt.value} onClick={() => { setPriorityFilter(opt.value); setPriorityOpen(false); }}
                  className={`dropdown-item ${priorityFilter === opt.value ? "dropdown-item-active" : ""}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dot}`}/>{opt.label}
                  {priorityFilter === opt.value && <Check size={12} className="ml-auto text-stone-400"/>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          {sortOpen && <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)}/>}
          <button onClick={() => { setSortOpen(o => !o); setLabelOpen(false); setPriorityOpen(false); }}
            className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs transition-colors ${(sortBy !== "created_at" || sortDir !== "desc") ? "border-stone-500/30 bg-stone-600/[.06] text-stone-400" : "border-white/[.07] text-stone-500 hover:text-stone-300 hover:border-white/[.12]"}`}>
            <ArrowUpDown size={11}/>
            {sortBy === "due_date" ? "Due date" : sortBy === "priority" ? "Priority" : sortBy === "assignee" ? "Assignee" : "Sort"}
            <ChevronDown size={10} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`}/>
          </button>
          {sortOpen && (
            <div className="dropdown-panel left-0 w-48 z-50">
              {[
                { value: "created_at", label: "Date created", icon: <Calendar size={13}/> },
                { value: "due_date",   label: "Due date",     icon: <Clock size={13}/> },
                { value: "priority",   label: "Priority",     icon: <Flag size={13}/> },
                { value: "assignee",   label: "Assignee",     icon: <User size={13}/> },
              ].map(opt => (
                <button key={opt.value} onClick={() => { setSortBy(opt.value); setSortOpen(false); }}
                  className={`dropdown-item ${sortBy === opt.value ? "dropdown-item-active" : ""}`}>
                  {opt.icon}{opt.label}{sortBy === opt.value && <Check size={12} className="ml-auto text-stone-400"/>}
                </button>
              ))}
              <div className="mx-2 my-1 border-t border-white/[.07]"/>
              <div className="flex gap-1 px-1 pb-1">
                <button onClick={() => setSortDir("desc")} className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${sortDir === "desc" ? "bg-white/[.06] text-white" : "text-stone-500 hover:bg-white/[.04] hover:text-stone-300"}`}><ArrowDown size={11}/> Newest</button>
                <button onClick={() => setSortDir("asc")}  className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors ${sortDir === "asc"  ? "bg-white/[.06] text-white" : "text-stone-500 hover:bg-white/[.04] hover:text-stone-300"}`}><ArrowUp size={11}/> Oldest</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── LIST VIEW ── */}
      {viewMode === "list" && (
        query.isLoading ? <PageSkeleton label="Loading tasks…"/> : query.isError ? <ErrorState error={query.error as Error} onRetry={() => query.refetch()}/> : tasks.length === 0 ? (
          <EmptyState icon={Check} title="No tasks" description="You're all caught up."/>
        ) : (
          <div className="space-y-1.5">
            {tasks.map(task => {
              const expanded = expandedId === task.id;
              const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
              const assigneeName = getMemberName(task);
              const sm = STATUS_META[task.status ?? "todo"] ?? STATUS_META["todo"]!;
              return (
                <div key={task.id} className={`rounded-2xl border transition-colors ${isOverdue ? "border-stone-200 bg-stone-50/60 dark:border-stone-500/20 dark:bg-stone-500/[.03]" : "border-stone-200 bg-white hover:border-stone-300 dark:border-white/[.07] dark:bg-white/[.02] dark:hover:border-white/[.11]"}`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <button onClick={() => toggle.mutate(task)}
                      className={`h-5 w-5 shrink-0 rounded border flex items-center justify-center transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : isOverdue ? "border-stone-400/60 hover:border-stone-400" : "border-stone-300 hover:border-stone-400 dark:border-white/25 dark:hover:border-white/50"}`}>
                      {task.completed && <Check size={11} className="text-white"/>}
                    </button>

                    {/* Title */}
                    <button onClick={() => setDetailTask(task)}
                      className={`flex-1 min-w-0 text-left text-sm font-medium truncate transition-colors ${task.completed ? "text-stone-400 line-through dark:text-stone-600" : "text-[#111827] hover:text-stone-600 dark:text-stone-100 dark:hover:text-white"}`}>
                      {task.title}
                    </button>

                    {/* Inline meta */}
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      {task.priority && task.priority !== "low" && (
                        <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>
                      )}
                      <span className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium border-stone-200 text-stone-500 dark:border-white/[.07] dark:text-stone-500`}>
                        <span className={`h-1 w-1 rounded-full ${sm.dot}`}/>{sm.label}
                      </span>
                      {flaggedTaskIds.has(task.id) && (
                        <span className="flex items-center gap-1 rounded-full border border-stone-500/30 bg-stone-600/10 px-1.5 py-px text-[10px] font-medium text-stone-500 dark:text-stone-400" title="Operations Agent queued a recommendation for this task">
                          <LogoMark size={9}/>AI flagged
                        </span>
                      )}
                      {task.due_date && (
                        <span className={`flex items-center gap-0.5 text-[11px] ${isOverdue ? "text-stone-600 dark:text-stone-400" : "text-stone-500 dark:text-stone-600"}`}>
                          <Clock size={10}/>{fmtDate(task.due_date)}
                        </span>
                      )}
                      {assigneeName && <span className="flex items-center gap-0.5 text-[11px] text-stone-500 dark:text-stone-600"><User size={10}/>{assigneeName.split(" ")[0]}</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {task.completed && (
                        <button onClick={() => toggle.mutate(task)} title="Reactivate"
                          className="rounded-lg p-1.5 text-stone-400 hover:text-stone-100 hover:bg-white/[.05] transition-colors"><RotateCcw size={12}/></button>
                      )}
                      <button onClick={() => setExpandedId(expanded ? null : task.id)}
                        className="rounded-lg p-1.5 text-stone-400 hover:text-stone-100 hover:bg-white/[.05] transition-colors">
                        <ChevronDown size={13} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}/>
                      </button>
                      <button onClick={() => setEditTask(task)} title="Edit"
                        className="rounded-lg p-1.5 text-stone-400 hover:text-stone-100 hover:bg-white/[.05] transition-colors"><Pencil size={12}/></button>
                      {(task.assignee_id === currentUserId || !task.assignee_id) && (
                        <button onClick={() => setConfirmDeleteId(task.id)} title="Delete"
                          className="rounded-lg p-1.5 text-stone-400 hover:text-stone-400 hover:bg-stone-400/10 transition-colors"><Trash2 size={12}/></button>
                      )}
                    </div>
                  </div>

                  {/* Expanded panel */}
                  {expanded && (
                    <div className="border-t border-white/[.06] px-4 py-4 space-y-3">
                      <div className="flex flex-wrap gap-4 text-xs">
                        <div><p className="text-stone-600 mb-0.5">Created</p><p className="text-stone-300">{task.created_at ? fmtDateTime(task.created_at) : "—"}</p></div>
                        <div><p className="text-stone-600 mb-0.5">Due</p><p className={task.due_date ? (isOverdue ? "text-stone-400" : "text-stone-300") : "text-stone-600"}>{task.due_date ? fmtDateTime(task.due_date) : "No due date"}</p></div>
                        <div><p className="text-stone-600 mb-0.5">Assignee</p><p className="text-stone-300">{assigneeName || "Unassigned"}</p></div>
                        {task.record_name && <div><p className="text-stone-600 mb-0.5">Record</p><p className="text-stone-300">{task.record_name}</p></div>}
                      </div>
                      {task.labels && task.labels.filter(l => LABEL_COLORS[l]).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {task.labels.filter(l => LABEL_COLORS[l]).map(l => (
                            <span key={l} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${LABEL_COLORS[l]}`}>{l}</span>
                          ))}
                        </div>
                      )}
                      {task.notes && <p className="text-sm text-stone-400 leading-relaxed whitespace-pre-wrap">{task.notes}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── BOARD VIEW ── */}
      {viewMode === "board" && (
        query.isLoading ? <PageSkeleton label="Loading tasks…"/> : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {BOARD_COLS.map(col => {
                const colTasks = allTasks.filter(t =>
                  col.key === "done"
                    ? (t.completed || t.status === "done")
                    : (t.status === col.key && !t.completed)
                );
                return <BoardColumn key={col.key} col={col} tasks={colTasks} onDetail={setDetailTask} onEdit={setEditTask} onDelete={setConfirmDeleteId} onToggle={t => toggle.mutate(t)} currentUserId={currentUserId} getMemberName={getMemberName} flaggedTaskIds={flaggedTaskIds}/>;
              })}
            </div>
          </DndContext>
        )
      )}

      {/* ── SHEET VIEW ── */}
      {viewMode === "sheet" && (
        query.isLoading ? <PageSkeleton label="Loading tasks…"/> : allTasks.length === 0 ? (
          <EmptyState icon={Check} title="No tasks" description="You're all caught up."/>
        ) : (
          <>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowDone(v => !v)}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-colors ${showDone ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/[.06] dark:text-emerald-400" : "border-stone-200 text-stone-500 hover:text-stone-800 dark:border-white/[.07] dark:text-stone-500 dark:hover:text-stone-300"}`}>
                <Check size={11}/>{showDone ? "Hiding completed" : "Show completed"}
              </button>
            </div>
            <div className="overflow-auto rounded-2xl border border-stone-200 dark:border-white/[.07]">
              <table className="minimal-table min-w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-[#f9fafb] dark:border-white/[.06] dark:bg-white/[.01]">
                    {["", "Task", "Status", "Priority", "Assignee", "Due Date", "Created", "Labels"].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold tracking-widest uppercase text-[#6b7280] dark:text-stone-400">{h}</th>
                    ))}
                    <th className="px-4 py-2.5"/>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-white/[.04]">
                  {(showDone ? allTasks : tasks).map(task => {
                    const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
                    const assigneeName = getMemberName(task);
                    const sm = STATUS_META[task.status ?? "todo"] ?? STATUS_META["todo"]!;
                    return (
                      <tr key={task.id} className="group bg-white hover:bg-[#f9fafb] dark:bg-transparent dark:hover:bg-white/[.015] transition-colors">
                        <td className="px-4 py-3 w-8">
                          <button onClick={() => toggle.mutate(task)}
                            className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : "border-stone-300 hover:border-stone-400 dark:border-white/25 dark:hover:border-white/50"}`}>
                            {task.completed && <Check size={9} className="text-white"/>}
                          </button>
                        </td>
                        <td className="px-4 py-3 max-w-[240px]">
                          <button onClick={() => setDetailTask(task)} className={`text-left hover:underline font-medium truncate block w-full ${task.completed ? "text-stone-400 line-through dark:text-stone-600" : "text-[#111827] dark:text-stone-100"}`}>{task.title}</button>
                          {task.notes && <p className="text-xs text-[#6b7280] dark:text-stone-600 truncate mt-0.5">{task.notes}</p>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${sm.dot}`}/>{sm.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {task.priority && <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority.charAt(0).toUpperCase()+task.priority.slice(1)}</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                          {assigneeName ? <span className="flex items-center gap-1"><User size={11}/>{assigneeName}</span> : <span className="text-stone-300 dark:text-stone-700">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs tabular-nums">
                          {task.due_date ? <span className={isOverdue ? "text-stone-600 dark:text-stone-400" : "text-stone-500 dark:text-stone-400"}>{fmtDate(task.due_date)}</span> : <span className="text-stone-300 dark:text-stone-700">—</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-[#6b7280] dark:text-stone-500 tabular-nums">
                          {task.created_at ? fmtDate(task.created_at) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(task.labels ?? []).filter(l => LABEL_COLORS[l]).map(l => (
                              <span key={l} className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${LABEL_COLORS[l]}`}>{l}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setEditTask(task)} className="rounded-md p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-white/[.05] transition-colors"><Pencil size={12}/></button>
                            {(task.assignee_id === currentUserId || !task.assignee_id) && (
                              <button onClick={() => setConfirmDeleteId(task.id)} className="rounded-md p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:text-stone-400 dark:hover:bg-stone-400/10 transition-colors"><Trash2 size={12}/></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* ── Completed section (list view) ── */}
      {viewMode === "list" && doneTasks.length > 0 && !labelFilter && sortBy === "created_at" && (
        <div className="mt-6">
          <button onClick={() => setShowDone(!showDone)}
            className="flex items-center gap-2 text-xs text-stone-400 hover:text-stone-200 transition-colors mb-3">
            <ChevronDown size={13} className={`transition-transform ${showDone ? "" : "-rotate-90"}`}/>
            Completed
            <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-stone-500">{doneTasks.length}</span>
          </button>
          {showDone && (
            <div className="space-y-1 opacity-50">
              {doneTasks.map(task => (
                <div key={task.id} className="rounded-xl border border-white/[.04] p-3 flex items-center gap-3">
                  <button onClick={() => toggle.mutate(task)}
                    className="h-4 w-4 shrink-0 rounded border border-emerald-500/50 bg-emerald-500/20 flex items-center justify-center">
                    <Check size={9} className="text-emerald-400"/>
                  </button>
                  <button onClick={() => setDetailTask(task)} className="flex-1 text-sm text-stone-500 line-through text-left hover:text-stone-400 truncate transition-colors">{task.title}</button>
                  <span className="text-[10px] text-stone-700 shrink-0">{task.status === "done" ? "Done" : "Completed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Delete confirm ── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-white/[.09] dark:bg-[#141414]">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-50 dark:bg-stone-500/10 mb-4">
              <Trash2 size={16} className="text-stone-600 dark:text-stone-400"/>
            </div>
            <h2 className="text-base font-semibold text-[#111827] dark:text-white mb-1">Delete task?</h2>
            <p className="text-sm text-stone-500 dark:text-stone-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteId(null)} className={BTN_CANCEL}>Cancel</button>
              <button onClick={() => { remove.mutate(confirmDeleteId); setConfirmDeleteId(null); }} className={BTN_PRIMARY}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {detailTask && (
        <TaskDetailPanel task={detailTask} members={members}
          onClose={() => setDetailTask(null)}
          onUpdate={() => { qc.invalidateQueries({ queryKey: ["tasks", filter, labelFilter, sortBy] }).then(() => { const allT = qc.getQueryData<any[]>(["tasks", filter, labelFilter, sortBy]) || []; const updated = allT.find((t: any) => t.id === detailTask?.id); if (updated) setDetailTask(updated); }); }}
        />
      )}
      {editTask && <EditTaskModal task={editTask} onClose={() => setEditTask(null)} members={members} currentUserId={currentUserId}/>}
      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} members={members} currentUserId={currentUserId} userName={user?.fullName || user?.firstName || "Someone"}/>}
      {showAISuggest && <AISuggestModal onClose={() => setShowAISuggest(false)} members={members} currentUserId={currentUserId}/>}
    </div>
  );
}
