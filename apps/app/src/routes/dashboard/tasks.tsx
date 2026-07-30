import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X, Clock, User, RotateCcw, ChevronDown, Trash2, Calendar, Pencil, Tag, ArrowUpDown, ArrowUp, ArrowDown, Flag, List, Columns3, Sheet, Loader2 } from "lucide-react";
import { AIMark } from "@/components/ui/ai-button";
import { LogoMark } from "@/components/logo";
import { useState, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DndContext, useDroppable, useDraggable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useIsViewer } from "../../hooks/useModules";
import { TaskDetailPanel } from "../../components/tasks/task-detail-panel";
import { apiClient } from "../../lib/api-client";
import { FieldSelect, FilterButton, FilterStrip, CommandPageHeader } from "../../components/ui/controls";
import { EmptyState, ErrorState, PageSkeleton } from "../../components/ui/page-state";
import { SegmentedControl } from "../../components/ui/segmented";
import { DataTable, type DataTableColumn } from "../../components/ui/data-table";
import { useLanguage } from "../../hooks/useLanguage";
import { isOverdue as isPastDue } from "@mondaily/shared/dates";


/** <input type="datetime-local"> reads/writes LOCAL wall-clock time, but due_date is stored as
 *  UTC. Converting with toISOString() put a UTC value straight into the input, so every Edit
 *  displayed the time shifted by the viewer's offset — and saving persisted that shift. Create
 *  and Edit also sent two different formats to the same column. These normalise both ends. */
const toLocalInputValue = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInputValue = (v: string) => {
  if (!v) return null;
  const d = new Date(v);                    // parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

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

// Matte semantic tones (flat-line design system) — slate for informational, amber for attention,
// rose for problems, muted green for done. No bright utility colors.
const LABEL_COLORS: Record<string, string> = {
  "Help Needed": "text-[#717784] bg-[#717784]/10 border-[#717784]/30",
  "Blocked":     "text-[#d1524a] bg-[#d1524a]/10 border-[#d1524a]/30",
  "Waiting":     "text-stone-400 bg-stone-400/10 border-stone-400/30",
  "Bug":         "text-[#d1524a] bg-[#d1524a]/10 border-[#d1524a]/30",
  "Feature":     "text-stone-400 bg-stone-400/10 border-stone-400/30",
  "Research":    "text-[#717784] bg-[#717784]/10 border-[#717784]/30",
};

const PRIORITY_STYLE: Record<string, string> = {
  low:    "text-stone-400 bg-stone-400/10 border-stone-400/20",
  medium: "text-[#717784] bg-[#717784]/10 border-[#717784]/20",
  high:   "text-[#c6892e] bg-[#c6892e]/10 border-[#c6892e]/20",
  urgent: "text-[#d1524a] bg-[#d1524a]/10 border-[#d1524a]/20",
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  todo:        { label: "To Do",        dot: "bg-stone-500" },
  in_progress: { label: "In Progress",  dot: "bg-[#717784]" },
  review:      { label: "Needs Review", dot: "bg-[#c6892e]" },
  done:        { label: "Done",         dot: "bg-[#2f9e6b]" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Shared modal shell ────────────────────────────────────────────────────────
const INPUT = "key-input h-9 w-full px-3 text-sm";
const SELECT = "key-input h-9 w-full px-3 text-sm";
const BTN_CANCEL = "btn-secondary flex-1 h-10 text-sm";
const BTN_PRIMARY = "btn-primary flex-1 h-10 text-sm";

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4">
      <div className="surface-modal w-full max-w-md rounded-sm overflow-hidden">
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
      return apiClient.post("/tasks", { title, due_date: fromLocalInputValue(dueDate) ?? undefined, priority, status, notes: notes || undefined, assignee_id: assigneeId || undefined, assignee_email: member?.email || undefined, _user_name: userName });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });

  return (
    <ModalShell title="New Task" onClose={onClose}>
      <div className="space-y-3">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && title.trim() && !create.isPending) create.mutate(); }}
          placeholder="Task title…" className={INPUT}/>
        <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className={`${INPUT} dark:[color-scheme:dark]`}/>
        <FieldSelect value={assigneeId} onChange={v => setAssigneeId(v)} ariaLabel="Assignee" className={SELECT}
          options={[{ value: "", label: "Unassigned" }, ...sorted.map(m => ({ value: m.user_id, label: m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email) }))]} />
        <div className="grid grid-cols-2 gap-3">
          <FieldSelect value={priority} onChange={v => setPriority(v)} ariaLabel="Priority" className={SELECT}
            options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} />
          <FieldSelect value={status} onChange={v => setStatus(v)} ariaLabel="Status" className={SELECT}
            options={[{ value: "todo", label: "To Do" }, { value: "in_progress", label: "In Progress" }, { value: "review", label: "Review" }, { value: "done", label: "Done" }]} />
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
  const [dueDate, setDueDate] = useState(toLocalInputValue(task.due_date));
  const [priority, setPriority] = useState<"low"|"medium"|"high"|"urgent">(task.priority || "medium");
  const [status, setStatus] = useState<"todo"|"in_progress"|"review"|"done">(task.status || "todo");
  const [notes, setNotes] = useState(task.notes || "");
  const [assigneeId, setAssigneeId] = useState(task.assignee_id || "");
  const qc = useQueryClient();

  const sorted = [...members].sort((a, b) => a.user_id === currentUserId ? -1 : b.user_id === currentUserId ? 1 : (a.name || a.email).localeCompare(b.name || b.email));

  const update = useMutation({
    mutationFn: () => {
      const member = members.find(m => m.user_id === assigneeId);
      return apiClient.patch(`/tasks/${task.id}`, { title, due_date: fromLocalInputValue(dueDate), priority, status, notes: notes || null, assignee_id: assigneeId || null, assignee_email: member?.email || null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });

  return (
    <ModalShell title="Edit Task" onClose={onClose}>
      <div className="space-y-3">
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className={INPUT}/>
        <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`${INPUT} dark:[color-scheme:dark]`}/>
        <FieldSelect value={assigneeId} onChange={v => setAssigneeId(v)} ariaLabel="Assignee" className={SELECT}
          options={[{ value: "", label: "Unassigned" }, ...sorted.map(m => ({ value: m.user_id, label: m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email) }))]} />
        <div className="grid grid-cols-2 gap-3">
          <FieldSelect value={priority} onChange={v => setPriority(v as any)} ariaLabel="Priority" className={SELECT}
            options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} />
          <FieldSelect value={status} onChange={v => setStatus(v as any)} ariaLabel="Status" className={SELECT}
            options={[{ value: "todo", label: "To Do" }, { value: "in_progress", label: "In Progress" }, { value: "review", label: "Review" }, { value: "done", label: "Done" }]} />
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[#111827] resize-none outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-stone-500/20 dark:bg-[var(--surface-hover)] dark:text-[var(--text-primary)] dark:focus:ring-0 transition-colors"/>
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
  const isOverdue = !task.completed && isPastDue(task.due_date);
  const assigneeName = getMemberName(task);

  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`rounded-sm border p-3 transition-all ${isDragging ? " opacity-80 border-stone-500/40 bg-[var(--surface-card)] dark:bg-[#1a1d24]" : "border-[var(--border-soft)] bg-[var(--surface-card)] hover:border-[var(--border-soft)]"}`}>
      {/* Drag handle covers the background only */}
      <div {...listeners} className="absolute inset-0 rounded-sm cursor-grab active:cursor-grabbing" style={{ zIndex: 0 }}/>
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-start gap-2 mb-2">
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onToggle(task)}
            className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${task.completed ? "border-[#2f9e6b] bg-[#2f9e6b]" : isOverdue ? "border-stone-400/60 hover:border-stone-400" : "border-[var(--border-soft)] hover:border-[var(--border-soft)]"}`}>
            {task.completed && <Check size={9} className="text-[var(--text-primary)]"/>}
          </button>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onDetail(task)}
            className={`flex-1 text-left text-xs font-medium leading-snug hover:text-[var(--text-secondary)] transition-colors ${task.completed ? "line-through text-[var(--text-faint)]" : "text-[#111827] dark:text-stone-200"}`}>
            {task.title}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {task.priority && task.priority !== "low" && (
              <span className={`rounded-full border px-1.5 py-px text-caption font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>
            )}
            {isOverdue && <span className="rounded-full border border-stone-500/30 bg-stone-600/10 px-1.5 py-px text-caption text-stone-400">Overdue</span>}
            {flagged && (
              <span className="flex items-center gap-1 rounded-full border border-stone-500/30 bg-stone-600/10 px-1.5 py-px text-caption font-medium text-stone-500 dark:text-stone-400" title="Operations Agent queued a recommendation for this task">
                <LogoMark size={9}/>AI flagged
              </span>
            )}
          </div>
          {/* Actions — always visible but subtle, no opacity-0 */}
          <div className="flex gap-0.5 shrink-0">
            <button onPointerDown={e => e.stopPropagation()} onClick={() => onEdit(task)}
              className="rounded-md p-1 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"><Pencil size={10}/></button>
            {(task.assignee_id === currentUserId || !task.assignee_id) && (
              <button onPointerDown={e => e.stopPropagation()} onClick={() => onDelete(task.id)}
                className="rounded-md p-1 text-[var(--text-faint)] hover:text-stone-400 hover:bg-stone-400/10 transition-colors"><Trash2 size={10}/></button>
            )}
          </div>
        </div>

        {(assigneeName || task.due_date) && (
          <div className="mt-2 flex items-center gap-2 text-caption text-[var(--text-secondary)]">
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
        <span className="text-sm font-medium text-[var(--text-faint)]">{col.label}</span>
        <span className="ml-auto rounded-full bg-[var(--surface-hover)] px-2 py-px text-caption text-[var(--text-muted)]">{tasks.length}</span>
      </div>
      <div ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-sm border-2 border-dashed p-2 space-y-2 transition-colors ${isOver ? "border-stone-500/30 bg-stone-600/[.03]" : "border-[var(--border-soft)] bg-[var(--surface-hover)]"}`}>
        {tasks.length === 0 && <div className="flex h-16 items-center justify-center text-xs text-[var(--text-faint)]">Drop here</div>}
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
    setSaving(true); setError("");
    const chosen = suggestions.filter((_, i) => selected.has(i));
    let failed = 0;
    for (const t of chosen) {
      const member = members.find(m => m.email === t.suggested_assignee_email);
      const dueDate = t.due_days ? new Date(Date.now() + t.due_days * 86400000).toISOString() : undefined;
      try { await apiClient.post("/tasks", { title: t.title, notes: t.notes || undefined, priority: t.priority || "medium", status: "todo", due_date: dueDate, assignee_id: member?.user_id || undefined, assignee_email: member?.email || undefined }); }
      catch { failed++; }
    }
    qc.invalidateQueries({ queryKey: ["tasks"] });
    setSaving(false);
    if (failed === chosen.length) { setError(`Couldn't create any of the ${chosen.length} task(s). Please try again.`); return; }
    if (failed > 0) { setError(`Created ${chosen.length - failed} of ${chosen.length} — ${failed} failed.`); return; }
    onClose();
  };

  const PCOL: Record<string, string> = { low: "text-stone-400", medium: "text-[#717784]", high: "text-[#c6892e]", urgent: "text-stone-400" };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4">
      <div className={`w-full rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden transition-all ${suggestions.length ? "max-w-2xl" : "max-w-md"}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <LogoMark size={14} className="text-[var(--text-secondary)]"/>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Suggest tasks with AI</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"><X size={15}/></button>
        </div>

        <div className="p-5 space-y-4">
          <textarea autoFocus value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
            className="w-full rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 py-2.5 text-sm text-[#111827] placeholder-[#9ca3af] resize-none outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-500/20 dark:bg-[var(--surface-hover)] dark:text-[var(--text-primary)] dark:placeholder-stone-600 dark:focus:border-stone-500/40 dark:focus:ring-0 transition-colors"/>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">Suggest</span>
            <div className="flex gap-1">
              {[3,5,10].map(n => (
                <button key={n} onClick={() => setCount(n)}
                  className={`w-9 rounded-sm border py-1 text-xs font-medium transition-colors ${count === n ? "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-500/50 dark:bg-stone-500/10 dark:text-stone-300" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>{n}</button>
              ))}
            </div>
            <span className="text-xs text-[var(--text-muted)]">tasks</span>
          </div>
          {error && <p className="text-xs text-[var(--text-secondary)]">{error}</p>}
        </div>

        {suggestions.length > 0 && (
          <div className="border-t border-[var(--border-soft)]">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-xs text-[var(--text-muted)]">{suggestions.length} suggestions</span>
              <button onClick={() => setSelected(prev => prev.size === suggestions.length ? new Set() : new Set(suggestions.map((_,i)=>i)))}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                {selected.size === suggestions.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="max-h-64 overflow-auto">
              {suggestions.map((t, i) => (
                <button key={i} onClick={() => setSelected(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left border-b border-[var(--border-soft)] hover:bg-[var(--surface-hover)] transition-colors ${selected.has(i) ? "" : "opacity-40"}`}>
                  <div className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${selected.has(i) ? "bg-stone-600 border-stone-600" : "border-[var(--border-soft)]"}`}>
                    {selected.has(i) && <Check size={10} className="text-[var(--text-primary)]"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)]">{t.title}</p>
                    {t.notes && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{t.notes}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-caption font-medium capitalize ${PCOL[t.priority] ?? "text-[var(--text-faint)]"}`}>{t.priority}</span>
                      {!!t.due_days && <span className="text-caption text-[var(--text-faint)]">due in {t.due_days}d</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--border-soft)]">
          <button onClick={onClose} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
          {suggestions.length === 0 ? (
            <button onClick={generate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
              {loading ? <><Loader2 size={13} className="animate-spin"/> Generating…</> : <><LogoMark size={13}/> Generate</>}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={generate} disabled={loading} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                {loading ? "Regenerating…" : "Regenerate"}
              </button>
              <button onClick={importSelected} disabled={selected.size === 0 || saving}
                className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
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
  const { t } = useLanguage();
  const me = useCurrentUser();
  const isViewer = useIsViewer();   // read-only member — gate write controls (backend also enforces)
  const location = useLocation();

  useEffect(() => { apiClient.post("/tasks/check-overdue", {}).catch((e) => console.error("[bg-task] swallowed error:", e)); }, []);

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
  const [filterOpen, setFilterOpen]       = useState(false);
  const [editTask, setEditTask]           = useState<Task | null>(null);
  const [viewMode, setViewMode]           = useState<"list" | "board" | "sheet">("list");
  const [highlightId, setHighlightId]     = useState<string | null>(null);
  const [searchParams, setSearchParams]   = useSearchParams();

  const query = useQuery({ queryKey: ["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir], queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${filter}${labelFilter ? `&label=${labelFilter}` : ""}${priorityFilter ? `&priority=${priorityFilter}` : ""}&sort=${sortBy}&dir=${sortDir}`) });

  // Deep-link resolver: when arriving with ?id=<taskId> (e.g. from a chat card),
  // open that task's detail panel, highlight + scroll to its row, then strip the
  // param so a later list reopen doesn't re-trigger. Falls back to fetching the
  // single task if it isn't in the current filtered list.
  const focusId = searchParams.get("id");
  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    const fromList = (query.data ?? []).find(t => t.id === focusId);
    const open = (t: Task) => {
      if (cancelled) return;
      setDetailTask(t);
      setHighlightId(focusId);
      requestAnimationFrame(() => document.getElementById(`task-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete("id"); return n; }, { replace: true });
      setTimeout(() => { if (!cancelled) setHighlightId(null); }, 4000);
    };
    if (fromList) open(fromList);
    // If not in the current filtered view, it's likely filtered out — the user can
    // clear filters to find it; we don't 404 on a non-existent single-task endpoint.
    return () => { cancelled = true; };
  }, [focusId, query.data]);
  // Deep-link: ?new=1 (e.g. from the ⌘K command bar "New task" action) opens the
  // create modal once, then strips the param so a refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setShowCreate(true);
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete("new"); return n; }, { replace: true });
  }, [searchParams]);

  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  const members = membersQuery.data ?? [];

  // Real AI signal on task cards: which tasks have a pending Decision Queue
  // recommendation (queued by the overdue-task-decisions job). Fails quiet
  // if the decision_queue migration isn't applied yet — never blocks the list.
  const decisionsQuery = useQuery({
    // Same URL as the Decision Queue + finance strip — one shared key so React Query
    // dedupes it into a single request instead of three identical round-trips.
    queryKey: ["decisions", "pending"],
    queryFn: () => apiClient.get<{ source_id: string | null }[]>("/decisions?status=pending"),
    staleTime: 30_000,
    retry: false,
  });
  const flaggedTaskIds = new Set((decisionsQuery.data ?? []).map(d => d.source_id).filter(Boolean) as string[]);
  const currentUserId = me.userId ?? "";

  const toggle = useMutation({
    mutationFn: (task: Task) => apiClient.patch(`/tasks/${task.id}`, { completed: !task.completed, _user_name: me.name || "Someone" }),
    // Optimistic flip so the checkbox + line-through respond instantly (no "click does nothing,
    // then it vanishes" lag). The row then settles into the Done section on refetch.
    onMutate: async (task: Task) => {
      const key = ["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir];
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: any) =>
        old?.map((t: Task) => t.id === task.id ? { ...t, completed: !task.completed, status: !task.completed ? "done" : "todo" } : t));
      return { prev, key };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  // Keep a just-completed task on screen (checked + struck) for ~1.4s before it moves to Done.
  const [keepVisible, setKeepVisible] = useState<Set<string>>(new Set());
  function handleToggle(task: Task) {
    if (isViewer) return;   // viewers are read-only
    if (!task.completed) {
      setKeepVisible(s => new Set(s).add(task.id));
      window.setTimeout(() => setKeepVisible(s => { const n = new Set(s); n.delete(task.id); return n; }), 1400);
    }
    toggle.mutate(task);
  }
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] })
  });
  const moveTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/tasks/${id}`, { status, _user_name: me.name || "Someone" }),
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
    { key: "in_progress", label: "In Progress",  dotColor: "bg-[#717784]"   },
    { key: "review",      label: "Review",       dotColor: "bg-[#c6892e]" },
    { key: "done",        label: "Done",         dotColor: "bg-[#2f9e6b]"},
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
  // A just-checked task lingers in the active list (checked + struck-through) for a beat so the
  // tick is actually visible, instead of vanishing the instant it's marked done.
  const tasks      = allTasks.filter(t => (!t.completed && t.status !== "done") || keepVisible.has(t.id));
  const doneTasks  = allTasks.filter(t => (t.completed || t.status === "done") && !keepVisible.has(t.id));
  const overdueTasks = tasks.filter(t => !t.completed && isPastDue(t.due_date));

  const getMemberName = (task: Task) => {
    const m = members.find(m => m.user_id === task.assignee_id);
    if (!m) return task.assignee_email || null;
    return m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email);
  };

  // Shared dropdown closer
  const closeDropdowns = () => { setLabelOpen(false); setPriorityOpen(false); setSortOpen(false); };

  // Sheet-view column model for the shared DataTable. Every cell (completion toggle, title→detail,
  // status/priority/assignee/due/created/labels, edit/delete) stays page-owned; the shell only renders
  // the table shell. Created + Labels hide below md via hideBelow. Deep-link anchor + highlight wired on
  // the <DataTable> itself (rowId / rowStyle). No selection, no sortable headers (sort is the toolbar).
  const sheetColumns: DataTableColumn<Task>[] = [
    { key: "__complete", header: "", cellClassName: "w-8", cell: (task) => (
        <button onClick={() => handleToggle(task)}
          className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${task.completed ? "border-[#2f9e6b] bg-[#2f9e6b]" : "border-[var(--border-soft)] hover:border-[var(--border-soft)]"}`}>
          {task.completed && <Check size={9} className="text-[var(--text-primary)]" />}
        </button>
      ) },
    { key: "task", header: "Task", cellClassName: "max-w-[240px]", cell: (task) => (
        <>
          <button onClick={() => setDetailTask(task)} className={`text-left hover:underline font-medium truncate block w-full ${task.completed ? "text-[var(--text-faint)] line-through" : "text-[#111827] dark:text-stone-100"}`}>{task.title}</button>
          {task.notes && <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{task.notes}</p>}
        </>
      ) },
    { key: "status", header: "Status", cellClassName: "whitespace-nowrap", cell: (task) => {
        const sm = STATUS_META[task.status ?? "todo"] ?? STATUS_META["todo"]!;
        return <span className="flex items-center gap-1 text-label text-[var(--text-muted)]"><span className={`h-1.5 w-1.5 rounded-full shrink-0 ${sm.dot}`} />{sm.label}</span>;
      } },
    { key: "priority", header: "Priority", cellClassName: "whitespace-nowrap", cell: (task) => (
        task.priority ? <span className={`rounded-full border px-1.5 py-px text-caption font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span> : null
      ) },
    { key: "assignee", header: "Assignee", cellClassName: "whitespace-nowrap text-label text-[var(--text-muted)]", cell: (task) => {
        const assigneeName = getMemberName(task);
        return assigneeName ? <span className="flex items-center gap-1"><User size={11} />{assigneeName}</span> : <span className="text-[var(--text-faint)]">—</span>;
      } },
    { key: "due", header: "Due Date", cellClassName: "whitespace-nowrap text-label tabular-nums", cell: (task) => {
        const isOverdue = !task.completed && isPastDue(task.due_date);
        return task.due_date ? <span className={isOverdue ? "text-stone-600 dark:text-stone-400" : "text-[var(--text-muted)]"}>{fmtDate(task.due_date)}</span> : <span className="text-[var(--text-faint)]">—</span>;
      } },
    { key: "created", header: "Created", hideBelow: "md", cellClassName: "whitespace-nowrap text-label text-[var(--text-muted)] tabular-nums", cell: (task) => task.created_at ? fmtDate(task.created_at) : "—" },
    { key: "labels", header: "Labels", hideBelow: "md", cell: (task) => (
        <div className="flex flex-wrap gap-1">
          {(task.labels ?? []).filter(l => LABEL_COLORS[l]).map(l => (
            <span key={l} className={`rounded-full border px-1.5 py-px text-caption font-medium ${LABEL_COLORS[l]}`}>{l}</span>
          ))}
        </div>
      ) },
    { key: "__actions", header: "", cellClassName: "whitespace-nowrap", cell: (task) => (
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditTask(task)} className="rounded-md p-1 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"><Pencil size={12} /></button>
          {(task.assignee_id === currentUserId || !task.assignee_id) && (
            <button onClick={() => setConfirmDeleteId(task.id)} className="rounded-md p-1 text-[var(--text-faint)] hover:text-stone-600 hover:bg-stone-50 dark:hover:text-stone-400 dark:hover:bg-stone-400/10 transition-colors"><Trash2 size={12} /></button>
          )}
        </div>
      ) },
  ];

  return (
    <div className={`mx-auto px-6 pt-2 pb-8 ${viewMode === "list" ? "max-w-3xl" : "max-w-full"}`}>

      {/* ── Header ── */}
      <CommandPageHeader
        variant="bar"
        icon={List}
        callsign="TASKS"
        title="Tasks"
        subtitle="Work assigned to you and your team."
        primaryAction={
          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle */}
            <SegmentedControl
              segments={[{ key: "list", label: "List", icon: List }, { key: "board", label: "Board", icon: Columns3 }, { key: "sheet", label: "Sheet", icon: Sheet }]}
              active={viewMode}
              onChange={(k) => setViewMode(k as "list" | "board" | "sheet")}
            />
            {!isViewer && (
              <>
                <button onClick={() => setShowAISuggest(true)}
                  className="flex items-center gap-1.5 rounded-sm border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs text-[var(--section-accent)] hover:bg-stone-200 dark:border-stone-500/25 dark:bg-stone-500/[.07] dark:text-stone-400 dark:hover:bg-stone-500/[.13] transition-colors">
                  <AIMark size={12}/> Suggest
                </button>
                <button onClick={() => setShowCreate(true)}
                  className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
                  <Plus size={13}/> {t("tasks.new")}
                </button>
              </>
            )}
            {isViewer && <span className="text-label text-[var(--text-muted)]">Read-only access</span>}
          </div>
        }
      />

      {/* ── Filter bar ── */}
      <div className="mb-5 flex items-center gap-1.5 flex-wrap">
        {/* Status */}
        <SegmentedControl
          segments={[
            { key: "mine",    label: t("tasks.filter.mine") },
            { key: "all",     label: t("tasks.filter.all") },
            { key: "overdue", label: t("tasks.filter.overdue"), count: overdueTasks.length },
            { key: "review",  label: t("tasks.filter.review") },
          ]}
          active={filter}
          onChange={(k) => setFilter(k as typeof filter)}
        />

        <div className="h-4 w-px bg-[var(--surface-hover)]"/>

        {/* Sort */}
        <div className="relative">
          {sortOpen && <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)}/>}
          <button onClick={() => { setSortOpen(o => !o); setLabelOpen(false); setPriorityOpen(false); }}
            className={`flex items-center gap-1 rounded-sm border px-2.5 py-1 text-xs transition-colors ${(sortBy !== "created_at" || sortDir !== "desc") ? "border-stone-500/30 bg-stone-600/[.06] text-stone-400" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:border-[var(--border-soft)]"}`}>
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
                  {opt.icon}{opt.label}{sortBy === opt.value && <Check size={12} className="ml-auto text-[var(--text-faint)]"/>}
                </button>
              ))}
              <div className="mx-2 my-1 border-t border-[var(--border-soft)]"/>
              <div className="flex gap-1 px-1 pb-1">
                <button onClick={() => setSortDir("desc")} className={`flex flex-1 items-center justify-center gap-1 rounded-sm py-1.5 text-xs transition-colors ${sortDir === "desc" ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-faint)]"}`}><ArrowDown size={11}/> Newest</button>
                <button onClick={() => setSortDir("asc")}  className={`flex flex-1 items-center justify-center gap-1 rounded-sm py-1.5 text-xs transition-colors ${sortDir === "asc"  ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-faint)]"}`}><ArrowUp size={11}/> Oldest</button>
              </div>
            </div>
          )}
        </div>

        <FilterButton open={filterOpen} onToggle={() => setFilterOpen(o => !o)} activeCount={[labelFilter, priorityFilter].filter(Boolean).length} />
      </div>

      {/* Filter strip — records-sheet pattern: thin full-width strip appears flush below the toolbar
          ONLY when the Filter button is toggled on. No wasted space when closed. */}
      {filterOpen && (
      <FilterStrip
        className="mb-4"
        filters={[
          { key: "label", label: "Label", options: [
            { value: "Help Needed", label: "Help Needed", dot: "#5b6bb0" },
            { value: "Blocked", label: "Blocked", dot: "#d1524a" },
            { value: "Waiting", label: "Waiting", dot: "#c6892e" },
            { value: "Bug", label: "Bug", dot: "#d1524a" },
            { value: "Feature", label: "Feature", dot: "#2f9e6b" },
            { value: "Research", label: "Research", dot: "var(--section-accent)" },
          ] },
          { key: "priority", label: "Priority", options: [
            { value: "urgent", label: "Urgent", dot: "#d1524a" },
            { value: "high", label: "High", dot: "#c6892e" },
            { value: "medium", label: "Medium", dot: "#c6892e" },
            { value: "low", label: "Low", dot: "var(--text-faint)" },
          ] },
        ]}
        values={{ label: labelFilter, priority: priorityFilter }}
        onChange={(k, v) => { if (k === "label") setLabelFilter(v); else setPriorityFilter(v); }}
      />
      )}

      {/* ── LIST VIEW ── */}
      {viewMode === "list" && (
        query.isLoading ? <PageSkeleton label="Loading tasks…"/> : query.isError ? <ErrorState error={query.error as Error} onRetry={() => query.refetch()}/> : tasks.length === 0 ? (
          <EmptyState icon={Check} title={t("tasks.empty")} description={t("tasks.caught_up")}/>
        ) : (
          <div className="overflow-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] divide-y divide-[var(--border-soft)]">
            {tasks.map(task => {
              const expanded = expandedId === task.id;
              const isOverdue = !task.completed && isPastDue(task.due_date);
              const assigneeName = getMemberName(task);
              const sm = STATUS_META[task.status ?? "todo"] ?? STATUS_META["todo"]!;
              return (
                <div key={task.id} id={`task-${task.id}`} className={`transition-colors ${highlightId === task.id ? "relative z-10 ring-2 ring-offset-1" : ""} ${isOverdue ? "bg-stone-50/60 dark:bg-stone-500/[.03]" : "hover:bg-[var(--surface-hover)]"}`} style={highlightId === task.id ? { boxShadow: "0 0 0 2px var(--section-accent)", borderColor: "var(--section-accent)" } : undefined}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <button onClick={() => handleToggle(task)}
                      className={`h-5 w-5 shrink-0 rounded border flex items-center justify-center transition-colors ${task.completed ? "border-[#2f9e6b] bg-[#2f9e6b]" : isOverdue ? "border-stone-400/60 hover:border-stone-400" : "border-[var(--border-soft)] hover:border-[var(--border-soft)]"}`}>
                      {task.completed && <Check size={11} className="text-[var(--text-primary)]"/>}
                    </button>

                    {/* Title */}
                    <button onClick={() => setDetailTask(task)}
                      className={`flex-1 min-w-0 text-left text-sm font-medium truncate transition-colors ${task.completed ? "text-[var(--text-faint)] line-through" : "text-[#111827] hover:text-[var(--text-secondary)] dark:text-stone-100 dark:hover:text-[var(--text-primary)]"}`}>
                      {task.title}
                    </button>

                    {/* Inline meta */}
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      {task.priority && task.priority !== "low" && (
                        <span className={`rounded-full border px-1.5 py-px text-caption font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>
                      )}
                      <span className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-caption font-medium border-[var(--border-soft)] text-[var(--text-muted)]`}>
                        <span className={`h-1 w-1 rounded-full ${sm.dot}`}/>{sm.label}
                      </span>
                      {flaggedTaskIds.has(task.id) && (
                        <span className="flex items-center gap-1 rounded-full border border-stone-500/30 bg-stone-600/10 px-1.5 py-px text-caption font-medium text-stone-500 dark:text-stone-400" title="Operations Agent queued a recommendation for this task">
                          <LogoMark size={9}/>AI flagged
                        </span>
                      )}
                      {task.due_date && (
                        <span className={`flex items-center gap-0.5 text-label ${isOverdue ? "text-stone-600 dark:text-stone-400" : "text-[var(--text-muted)]"}`}>
                          <Clock size={10}/>{fmtDate(task.due_date)}
                        </span>
                      )}
                      {assigneeName && <span className="flex items-center gap-0.5 text-label text-[var(--text-muted)]"><User size={10}/>{assigneeName.split(" ")[0]}</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {task.completed && (
                        <button onClick={() => handleToggle(task)} title="Reactivate"
                          className="rounded-sm p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"><RotateCcw size={12}/></button>
                      )}
                      <button onClick={() => setExpandedId(expanded ? null : task.id)}
                        className="rounded-sm p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors">
                        <ChevronDown size={13} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}/>
                      </button>
                      <button onClick={() => setEditTask(task)} title="Edit"
                        className="rounded-sm p-1.5 text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"><Pencil size={12}/></button>
                      {(task.assignee_id === currentUserId || !task.assignee_id) && (
                        <button onClick={() => setConfirmDeleteId(task.id)} title="Delete"
                          className="rounded-sm p-1.5 text-[var(--text-faint)] hover:text-stone-400 hover:bg-stone-400/10 transition-colors"><Trash2 size={12}/></button>
                      )}
                    </div>
                  </div>

                  {/* Expanded panel */}
                  {expanded && (
                    <div className="border-t border-[var(--border-soft)] px-4 py-4 space-y-3">
                      <div className="flex flex-wrap gap-4 text-xs">
                        <div><p className="text-[var(--text-secondary)] mb-0.5">Created</p><p className="text-[var(--text-faint)]">{task.created_at ? fmtDateTime(task.created_at) : "—"}</p></div>
                        <div><p className="text-[var(--text-secondary)] mb-0.5">Due</p><p className={task.due_date ? (isOverdue ? "text-stone-400" : "text-[var(--text-faint)]") : "text-[var(--text-secondary)]"}>{task.due_date ? fmtDateTime(task.due_date) : "No due date"}</p></div>
                        <div><p className="text-[var(--text-secondary)] mb-0.5">Assignee</p><p className="text-[var(--text-faint)]">{assigneeName || "Unassigned"}</p></div>
                        {task.record_name && <div><p className="text-[var(--text-secondary)] mb-0.5">Record</p><p className="text-[var(--text-faint)]">{task.record_name}</p></div>}
                      </div>
                      {task.labels && task.labels.filter(l => LABEL_COLORS[l]).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {task.labels.filter(l => LABEL_COLORS[l]).map(l => (
                            <span key={l} className={`rounded-full border px-2 py-0.5 text-caption font-medium ${LABEL_COLORS[l]}`}>{l}</span>
                          ))}
                        </div>
                      )}
                      {task.notes && <p className="text-sm text-[var(--text-faint)] leading-relaxed whitespace-pre-wrap">{task.notes}</p>}
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
        query.isLoading ? <PageSkeleton label="Loading tasks…"/> : query.isError ? (
          <ErrorState error={query.error as Error} onRetry={() => query.refetch()}/>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {BOARD_COLS.map(col => {
                const colTasks = allTasks.filter(t =>
                  col.key === "done"
                    ? (t.completed || t.status === "done")
                    : (t.status === col.key && !t.completed)
                );
                return <BoardColumn key={col.key} col={col} tasks={colTasks} onDetail={setDetailTask} onEdit={setEditTask} onDelete={setConfirmDeleteId} onToggle={t => { if (!isViewer) toggle.mutate(t); }} currentUserId={currentUserId} getMemberName={getMemberName} flaggedTaskIds={flaggedTaskIds}/>;
              })}
            </div>
          </DndContext>
        )
      )}

      {/* ── SHEET VIEW ── */}
      {viewMode === "sheet" && (
        query.isLoading ? <PageSkeleton label="Loading tasks…"/> : query.isError ? (
          <ErrorState error={query.error as Error} onRetry={() => query.refetch()}/>
        ) : allTasks.length === 0 ? (
          <EmptyState icon={Check} title={t("tasks.empty")} description={t("tasks.caught_up")}/>
        ) : (
          <>
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowDone(v => !v)}
                className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs transition-colors ${showDone ? "border-[#2f9e6b]/25 bg-[#2f9e6b]/10 text-[#2f9e6b] dark:border-[#2f9e6b]/30 dark:bg-[#2f9e6b]/[.06] dark:text-[#2f9e6b]" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                <Check size={11}/>{showDone ? "Hiding completed" : "Show completed"}
              </button>
            </div>
            {/* Presentational shell only — every cell (completion toggle, title→detail, actions) and
                the deep-link anchor (rowId=`task-{id}`) + highlight (rowStyle when highlightId matches)
                stay page-owned. Sort/filter remain the toolbar's; no selection, no sortable headers. */}
            <div className="overflow-auto rounded-sm border border-[var(--border-soft)]">
              <DataTable<Task>
                className="min-w-full text-sm"
                columns={sheetColumns}
                rows={showDone ? allTasks : tasks}
                rowKey={(task) => task.id}
                rowId={(task) => `task-${task.id}`}
                rowStyle={(task) => highlightId === task.id ? { boxShadow: "inset 2px 0 0 0 var(--section-accent)", background: "color-mix(in srgb, var(--section-accent) 7%, transparent)" } : undefined}
              />
            </div>
          </>
        )
      )}

      {/* ── Completed section (list view) ── */}
      {viewMode === "list" && doneTasks.length > 0 && !labelFilter && sortBy === "created_at" && (
        <div className="mt-6">
          <button onClick={() => setShowDone(!showDone)}
            className="flex items-center gap-2 text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors mb-3">
            <ChevronDown size={13} className={`transition-transform ${showDone ? "" : "-rotate-90"}`}/>
            Completed
            <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-caption text-[var(--text-muted)]">{doneTasks.length}</span>
          </button>
          {showDone && (
            <div className="overflow-hidden rounded-sm border border-[var(--border-soft)] divide-y divide-[var(--border-soft)] opacity-50">
              {doneTasks.map(task => (
                <div key={task.id} className="px-4 py-3 flex items-center gap-3 transition-colors hover:bg-[var(--surface-hover)]">
                  <button onClick={() => handleToggle(task)}
                    className="h-4 w-4 shrink-0 rounded border border-[#2f9e6b]/50 bg-[#2f9e6b]/20 flex items-center justify-center">
                    <Check size={9} className="text-[#2f9e6b]"/>
                  </button>
                  <button onClick={() => setDetailTask(task)} className="flex-1 text-sm text-[var(--text-muted)] line-through text-left hover:text-[var(--text-faint)] truncate transition-colors">{task.title}</button>
                  <span className="text-caption text-[var(--text-faint)] shrink-0">{task.status === "done" ? "Done" : "Completed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Delete confirm ── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-stone-50 dark:bg-stone-500/10 mb-4">
              <Trash2 size={16} className="text-stone-600 dark:text-stone-400"/>
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">Delete task?</h2>
            <p className="text-sm text-[var(--text-muted)] mb-5">This cannot be undone.</p>
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
          onUpdate={() => {
            // The list key is ["tasks", filter, label, priority, sort, dir]. This used to
            // invalidate (and read back) ["tasks", filter, label, sort] — a key that never
            // matches, so the list stayed stale and the open panel kept the pre-edit task.
            const listKey = ["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir];
            qc.invalidateQueries({ queryKey: ["tasks"] }).then(() => {
              const allT = qc.getQueryData<Task[]>(listKey) ?? [];
              const updated = allT.find(t => t.id === detailTask?.id);
              if (updated) setDetailTask(updated);
            });
          }}
        />
      )}
      {editTask && <EditTaskModal task={editTask} onClose={() => setEditTask(null)} members={members} currentUserId={currentUserId}/>}
      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} members={members} currentUserId={currentUserId} userName={me.name || "Someone"}/>}
      {showAISuggest && <AISuggestModal onClose={() => setShowAISuggest(false)} members={members} currentUserId={currentUserId}/>}
    </div>
  );
}
