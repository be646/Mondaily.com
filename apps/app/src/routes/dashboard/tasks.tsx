import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X, Clock, User, RotateCcw, ChevronDown, AlertCircle, Trash2, Calendar, Pencil, Tag, ArrowUpDown, ArrowUp, ArrowDown, Flag, List, Columns3, Sheet } from "lucide-react";
import { useState, useEffect } from "react";
import { DndContext, useDroppable, useDraggable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useUser } from "@clerk/react";
import { TaskDetailPanel } from "../../components/tasks/task-detail-panel";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageSkeleton } from "../../components/ui/page-state";

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
  "Blocked": "text-red-400 bg-red-400/10 border-red-400/30",
  "Waiting": "text-slate-400 bg-slate-400/10 border-slate-400/30",
  "Bug": "text-red-500 bg-red-500/10 border-red-500/30",
  "Feature": "text-purple-400 bg-purple-400/10 border-purple-400/30",
  "Research": "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  medium: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  high: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  urgent: "text-red-400 bg-red-400/10 border-red-400/20",
};

function getCompletionBadge(task: Task) {
  if (task.completed) {
    const wasLate = task.due_date && task.updated_at && new Date(task.updated_at) > new Date(task.due_date);
    return wasLate
      ? { label: "Completed late", cls: "text-orange-400 bg-orange-400/10 border-orange-400/20" }
      : { label: "Completed", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" };
  }
  if (task.due_date && new Date(task.due_date) < new Date())
    return { label: "Overdue", cls: "text-red-400 bg-red-400/10 border-red-400/20" };
  if (task.status === "review") return { label: "Needs Review", cls: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" };
  if (task.status === "in_progress") return { label: "In Progress", cls: "text-blue-400 bg-blue-400/10 border-blue-400/20" };
  if (task.status === "done") return { label: "Done", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" };
  return { label: "To Do", cls: "text-slate-400 bg-slate-400/10 border-slate-400/20" };
}

function CreateTaskModal({ onClose, members, currentUserId, userName }: { onClose: () => void; members: Member[]; currentUserId: string; userName: string }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("todo");
  const [notes, setNotes] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => {
      const member = members.find(m => m.user_id === assigneeId);
      return apiClient.post("/tasks", {
        title, due_date: dueDate ? dueDate + ":00" : undefined,
        priority, status, notes: notes || undefined,
        assignee_id: assigneeId || undefined,
        assignee_email: member?.email || undefined,
        _user_name: userName,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });

  // Sort members: current user first
  const sortedMembers = [...members].sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111419] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-white">New Task</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Task *</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && title.trim() && create.mutate()}
              placeholder="Task title..."
              className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white placeholder-slate-600 focus:border-white/20 outline-none"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Due Date</label>
            <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white outline-none focus:border-white/20"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Assigned To</label>
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
              <option value="">Unassigned</option>
              {sortedMembers.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as any)}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as any)}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Needs Review</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Additional notes..."
              className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder-slate-600 resize-none outline-none focus:border-white/20"/>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={() => title.trim() && create.mutate()} disabled={!title.trim() || create.isPending}
            className="flex-1 h-10 rounded-lg bg-red-600 text-sm font-medium text-white disabled:opacity-50 hover:bg-red-500">
            {create.isPending ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTaskModal({ task, onClose, members, currentUserId }: { task: Task; onClose: () => void; members: Member[]; currentUserId: string }) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.due_date ? new Date(task.due_date).toISOString().slice(0,16) : "");
  const [priority, setPriority] = useState<"low"|"medium"|"high"|"urgent">(task.priority || "medium");
  const [status, setStatus] = useState<"todo"|"in_progress"|"review"|"done">(task.status || "todo");
  const [notes, setNotes] = useState(task.notes || "");
  const [assigneeId, setAssigneeId] = useState(task.assignee_id || "");
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: () => {
      const member = members.find(m => m.user_id === assigneeId);
      return apiClient.patch(`/tasks/${task.id}`, {
        title, due_date: dueDate || null,
        priority, status, notes: notes || null,
        assignee_id: assigneeId || null,
        assignee_email: member?.email || null,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
  });

  const sortedMembers = [...members].sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111419] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-white">Edit Task</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Task *</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white placeholder-slate-600 outline-none focus:border-white/20"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Due Date</label>
            <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white outline-none focus:border-white/20"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Assigned To</label>
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
              <option value="">Unassigned</option>
              {sortedMembers.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as any)}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as any)}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white outline-none">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Needs Review</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white resize-none outline-none focus:border-white/20"/>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={() => title.trim() && update.mutate()} disabled={!title.trim() || update.isPending}
            className="flex-1 h-10 rounded-lg bg-red-600 text-sm font-medium text-white disabled:opacity-50 hover:bg-red-500">
            {update.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Board column + draggable card ──────────────────────────────
function DraggableCard({ task, onDetail, onEdit, onDelete, onToggle, currentUserId, getMemberName }: {
  task: Task; onDetail: (t: Task) => void; onEdit: (t: Task) => void;
  onDelete: (id: string) => void; onToggle: (t: Task) => void;
  currentUserId: string; getMemberName: (t: Task) => string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 50 } : undefined;
  const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
  const assigneeName = getMemberName(task);
  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`rounded-lg border bg-[#111419] p-3 cursor-grab active:cursor-grabbing transition-shadow ${isDragging ? "shadow-2xl opacity-80 border-red-500/40" : "border-white/10 hover:border-white/20"}`}>
      {/* drag handle = entire card; click targets are separate */}
      <div {...listeners} className="absolute inset-0 rounded-lg cursor-grab active:cursor-grabbing" style={{ zIndex: 0 }}/>
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-start gap-2">
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onToggle(task)}
            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : isOverdue ? "border-red-400/50" : "border-white/25 hover:border-white/50"}`}>
            {task.completed && <Check size={9} className="text-white"/>}
          </button>
          <button onPointerDown={e => e.stopPropagation()} onClick={() => onDetail(task)}
            className={`flex-1 text-left text-xs font-medium leading-snug hover:underline ${task.completed ? "line-through text-slate-600" : "text-slate-100"}`}>
            {task.title}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {task.priority && <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>}
          {isOverdue && <span className="rounded-full border border-red-400/30 bg-red-400/10 px-1.5 py-px text-[10px] text-red-400">Overdue</span>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
            {assigneeName && <span className="flex items-center gap-0.5"><User size={9}/>{assigneeName.split(" ")[0]}</span>}
            {task.due_date && <span className="flex items-center gap-0.5"><Clock size={9}/>{new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          </div>
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
            <button onPointerDown={e => e.stopPropagation()} onClick={() => onEdit(task)} className="rounded p-0.5 text-slate-600 hover:text-slate-300 hover:bg-white/[.05]"><Pencil size={10}/></button>
            {(task.assignee_id === currentUserId || !task.assignee_id) && <button onPointerDown={e => e.stopPropagation()} onClick={() => onDelete(task.id)} className="rounded p-0.5 text-slate-600 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={10}/></button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardColumn({ col, tasks, onDetail, onEdit, onDelete, onToggle, currentUserId, getMemberName }: {
  col: { key: string; label: string; accent: string; badge: string };
  tasks: Task[]; onDetail: (t: Task) => void; onEdit: (t: Task) => void;
  onDelete: (id: string) => void; onToggle: (t: Task) => void;
  currentUserId: string; getMemberName: (t: Task) => string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div className="flex flex-col min-w-[240px] w-[240px] shrink-0">
      {/* Column header */}
      <div className={`flex items-center gap-2 rounded-lg border-l-2 ${col.accent} pl-2 mb-3`}>
        <span className="text-sm font-medium text-slate-300">{col.label}</span>
        <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${col.badge}`}>{tasks.length}</span>
      </div>
      {/* Drop zone */}
      <div ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-xl border-2 border-dashed p-2 space-y-2 transition-colors ${isOver ? "border-red-500/40 bg-red-500/5" : "border-white/[.05] bg-white/[.01]"}`}>
        {tasks.length === 0 && (
          <div className="flex h-16 items-center justify-center text-xs text-slate-700">Drop here</div>
        )}
        {tasks.map(task => (
          <div key={task.id} className="group relative">
            <DraggableCard task={task} onDetail={onDetail} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} currentUserId={currentUserId} getMemberName={getMemberName}/>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TasksPage() {
  const qc = useQueryClient();
  const { user } = useUser();

  // Check for overdue tasks on page load and notify assignees
  useEffect(() => {
    apiClient.post("/tasks/check-overdue", {}).catch(() => {});
  }, []);
  const [filter, setFilter] = useState("mine");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [labelFilter, setLabelFilter] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [labelOpen, setLabelOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "board" | "sheet">("list");

  const query = useQuery({ queryKey: ["tasks", filter, labelFilter, sortBy, sortDir], queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${filter}${labelFilter ? `&label=${labelFilter}` : ""}&sort=${sortBy}&dir=${sortDir}`) });
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  const members = membersQuery.data ?? [];
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
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/tasks/${id}`, { status, _user_name: user?.fullName || user?.firstName || "Someone" }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData(["tasks", filter, labelFilter, sortBy, sortDir]);
      qc.setQueryData(["tasks", filter, labelFilter, sortBy, sortDir], (old: any) =>
        old?.map((t: Task) => t.id === id ? { ...t, status } : t)
      );
      return { prev };
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["tasks", filter, labelFilter, sortBy, sortDir], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] })
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const BOARD_COLS = [
    { key: "todo",        label: "To Do",        accent: "border-slate-500",   badge: "bg-slate-500/10 text-slate-400" },
    { key: "in_progress", label: "In Progress",   accent: "border-blue-500",    badge: "bg-blue-500/10 text-blue-400" },
    { key: "review",      label: "Under Review",  accent: "border-yellow-500",  badge: "bg-yellow-500/10 text-yellow-400" },
    { key: "done",        label: "Done",          accent: "border-emerald-500", badge: "bg-emerald-500/10 text-emerald-400" },
  ] as const;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const targetCol = BOARD_COLS.find(c => c.key === over.id);
    if (!targetCol) return;
    const task = allTasks.find(t => t.id === active.id);
    if (!task || task.status === targetCol.key) return;
    moveTask.mutate({ id: String(active.id), status: targetCol.key });
  }

  const allTasks = query.data ?? [];
  const tasks = allTasks.filter((t: Task) => !t.completed && t.status !== "done");
  const doneTasks: Task[] = allTasks.filter((t: Task) => t.completed || t.status === "done");
  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date());

  const getMemberName = (task: Task) => {
    const m = members.find(m => m.user_id === task.assignee_id);
    if (!m) return task.assignee_email || null;
    return m.user_id === currentUserId ? `${m.name || m.email} (me)` : (m.name || m.email);
  };

  return (
    <div className={`mx-auto px-6 py-8 ${viewMode === "list" ? "max-w-3xl" : "max-w-full"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Tasks</h1>
          <p className="text-sm text-slate-500 mt-0.5">Work assigned to you and your team.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-0.5 rounded-lg border border-white/10 p-1">
            {([["list","List",<List size={14}/>],["board","Board",<Columns3 size={14}/>],["sheet","Sheet",<Sheet size={14}/>]] as const).map(([mode, label, icon]) => (
              <button key={mode} onClick={() => setViewMode(mode as any)} title={label}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${viewMode === mode ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
                {icon} {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium hover:bg-red-500">
            <Plus size={14}/> New Task
          </button>
        </div>
      </div>

      {/* Filters + Label + Sort — single row */}
      <div className="mb-5 flex items-center gap-1.5 flex-wrap">

        {/* Status filter pill group */}
        <div className="flex gap-1 rounded-lg border border-white/10 p-1">
          {[
            { key: "mine",    label: "Mine" },
            { key: "all",     label: "All" },
            { key: "overdue", label: "Overdue" },
            { key: "review",  label: "Needs Review" },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${filter === f.key ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
              {f.label}
              {f.key === "overdue" && overdueTasks.length > 0 && filter !== "overdue" && (
                <span className="ml-1.5 rounded-full bg-red-500/20 px-1 py-px text-[10px] text-red-400">{overdueTasks.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-white/10"/>

        {/* Label filter */}
        <div className="relative">
          {labelOpen && <div className="fixed inset-0 z-40" onClick={() => setLabelOpen(false)}/>}
          <button onClick={() => { setLabelOpen(o => !o); setSortOpen(false); }}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors ${labelFilter ? "border-red-500/40 bg-red-500/5 text-red-400" : "border-white/10 bg-transparent text-slate-400 hover:border-white/15 hover:text-slate-300"}`}>
            <Tag size={11}/>
            {labelFilter || "Label"}
            {labelFilter && <span className="h-1.5 w-1.5 rounded-full bg-red-400"/>}
            <ChevronDown size={10} className={`transition-transform ${labelOpen ? "rotate-180" : ""}`}/>
          </button>
          {labelOpen && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-white/10 bg-[#161820]/95 backdrop-blur-sm shadow-2xl p-1">
              {[
                { value: "",            label: "All labels",  dot: "bg-slate-600" },
                { value: "Help Needed", label: "Help Needed", dot: "bg-blue-400" },
                { value: "Blocked",     label: "Blocked",     dot: "bg-red-400" },
                { value: "Waiting",     label: "Waiting",     dot: "bg-slate-400" },
                { value: "Bug",         label: "Bug",         dot: "bg-red-500" },
                { value: "Feature",     label: "Feature",     dot: "bg-purple-400" },
                { value: "Research",    label: "Research",    dot: "bg-cyan-400" },
              ].map(opt => (
                <button key={opt.value} onClick={() => { setLabelFilter(opt.value); setLabelOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${labelFilter === opt.value ? "bg-white/[.06] text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-white"}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dot}`}/>
                  {opt.label}
                  {labelFilter === opt.value && <Check size={12} className="ml-auto text-red-400"/>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          {sortOpen && <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)}/>}
          {(() => {
            const sortLabel = sortBy === "due_date" ? "Due date" : sortBy === "priority" ? "Priority" : sortBy === "assignee" ? "Assignee" : "Sort";
            const isNonDefault = sortBy !== "created_at" || sortDir !== "desc";
            return (
              <button onClick={() => { setSortOpen(o => !o); setLabelOpen(false); }}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors ${isNonDefault ? "border-red-500/40 bg-red-500/5 text-red-400" : "border-white/10 bg-transparent text-slate-400 hover:border-white/15 hover:text-slate-300"}`}>
                <ArrowUpDown size={11}/>
                {sortLabel}
                {isNonDefault && <span className="h-1.5 w-1.5 rounded-full bg-red-400"/>}
                <ChevronDown size={10} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`}/>
              </button>
            );
          })()}
          {sortOpen && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-white/10 bg-[#161820]/95 backdrop-blur-sm shadow-2xl p-1">
              {[
                { value: "created_at", label: "Date created", icon: <Calendar size={13}/> },
                { value: "due_date",   label: "Due date",     icon: <Clock size={13}/> },
                { value: "priority",   label: "Priority",     icon: <Flag size={13}/> },
                { value: "assignee",   label: "Assignee",     icon: <User size={13}/> },
              ].map(opt => (
                <button key={opt.value} onClick={() => { setSortBy(opt.value); setSortOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${sortBy === opt.value ? "bg-white/[.06] text-white" : "text-slate-400 hover:bg-white/[.04] hover:text-white"}`}>
                  {opt.icon}{opt.label}
                  {sortBy === opt.value && <Check size={12} className="ml-auto text-red-400"/>}
                </button>
              ))}
              <div className="mx-2 my-1 border-t border-white/10"/>
              <div className="flex gap-1 px-1 pb-1">
                <button onClick={() => setSortDir("desc")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-colors ${sortDir === "desc" ? "bg-white/[.06] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}><ArrowDown size={11}/> Newest</button>
                <button onClick={() => setSortDir("asc")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-colors ${sortDir === "asc" ? "bg-white/[.06] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}><ArrowUp size={11}/> Oldest</button>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── LIST VIEW ─────────────────────────────────────── */}
      {viewMode === "list" && (
        query.isLoading ? <PageSkeleton /> : tasks.length === 0 ? (
          <EmptyState icon={Check} title="No tasks" description="You are all caught up." />
        ) : (
          <div className="space-y-2">
            {tasks.map(task => {
              const completion = getCompletionBadge(task);
              const expanded = expandedId === task.id;
              const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
              const assigneeName = getMemberName(task);
              return (
                <div key={task.id} className={`rounded-xl border transition-colors ${isOverdue ? "border-red-500/20 bg-red-500/5" : "border-white/[.07] bg-white/[.02] hover:border-white/[.12]"}`}>
                  <div className="flex items-start gap-3 p-4">
                    <button onClick={() => toggle.mutate(task)} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : isOverdue ? "border-red-400/60 hover:border-red-400" : "border-white/25 hover:border-white/50"}`}>
                      {task.completed && <Check size={11} className="text-white"/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => setDetailTask(task)} className={`text-sm font-medium leading-snug text-left hover:underline ${task.completed ? "text-slate-600 line-through" : "text-slate-100 hover:text-white"}`}>{task.title}</button>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${completion.cls}`}>{completion.label}</span>
                        {task.priority && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span>}
                      </div>
                      {task.labels && task.labels.filter(l => l !== "Need Review" && LABEL_COLORS[l]).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {task.labels.filter(l => l !== "Need Review" && LABEL_COLORS[l]).map(l => (
                            <span key={l} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${LABEL_COLORS[l]}`}>{l}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {task.due_date && <span className={`flex items-center gap-1 ${isOverdue ? "text-red-400" : ""}`}><Clock size={10}/>Due {new Date(task.due_date).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}{isOverdue && " · Overdue"}</span>}
                        {assigneeName && <span className="flex items-center gap-1"><User size={10}/>{assigneeName}</span>}
                        {task.created_at && <span className="flex items-center gap-1"><Calendar size={10}/>Created {new Date(task.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {task.completed && <button onClick={() => toggle.mutate(task)} title="Reactivate" className="rounded-lg p-1.5 text-slate-600 hover:text-slate-300 hover:bg-white/[.05] transition-colors"><RotateCcw size={13}/></button>}
                      <button onClick={() => setExpandedId(expanded ? null : task.id)} className="rounded-lg p-1.5 text-slate-600 hover:text-slate-300 hover:bg-white/[.05] transition-colors"><ChevronDown size={14} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}/></button>
                      <button onClick={() => setEditTask(task)} title="Edit" className="rounded-lg p-1.5 text-slate-600 hover:text-slate-300 hover:bg-white/[.05] transition-colors"><Pencil size={13}/></button>
                      {(task.assignee_id === currentUserId || !task.assignee_id) && <button onClick={() => setConfirmDeleteId(task.id)} title="Delete" className="rounded-lg p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"><Trash2 size={13}/></button>}
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-white/[.07] px-4 py-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><p className="text-slate-600 mb-0.5">Created</p><p className="text-slate-300">{task.created_at ? new Date(task.created_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p></div>
                        <div><p className="text-slate-600 mb-0.5">Due Date</p><p className={task.due_date ? (isOverdue ? "text-red-400" : "text-slate-300") : "text-slate-600"}>{task.due_date ? new Date(task.due_date).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "No due date"}</p></div>
                        <div><p className="text-slate-600 mb-0.5">Assigned To</p><p className="text-slate-300">{assigneeName || "Unassigned"}</p></div>
                        <div><p className="text-slate-600 mb-0.5">Record</p><p className="text-slate-300">{task.record_name || "—"}</p></div>
                      </div>
                      {task.notes && <div><p className="text-xs text-slate-600 mb-1">Notes</p><p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{task.notes}</p></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── BOARD VIEW ────────────────────────────────────── */}
      {viewMode === "board" && (
        query.isLoading ? <PageSkeleton /> : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {BOARD_COLS.map(col => {
                const colTasks = allTasks.filter(t =>
                  col.key === "done"
                    ? (t.completed || t.status === "done")
                    : (t.status === col.key && !t.completed)
                );
                return <BoardColumn key={col.key} col={col} tasks={colTasks} onDetail={setDetailTask} onEdit={setEditTask} onDelete={setConfirmDeleteId} onToggle={t => toggle.mutate(t)} currentUserId={currentUserId} getMemberName={getMemberName}/>;
              })}
            </div>
          </DndContext>
        )
      )}

      {/* ── SHEET VIEW ────────────────────────────────────── */}
      {viewMode === "sheet" && (
        query.isLoading ? <PageSkeleton /> : allTasks.length === 0 ? (
          <EmptyState icon={Check} title="No tasks" description="You are all caught up." />
        ) : (
          <div className="overflow-auto rounded-xl border border-white/10">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[.02]">
                  {["", "Task", "Status", "Priority", "Assignee", "Due Date", "Created", "Labels"].map(h => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-slate-500">{h}</th>
                  ))}
                  <th className="px-4 py-3"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.04]">
                {tasks.map(task => {
                  const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
                  const assigneeName = getMemberName(task);
                  const completion = getCompletionBadge(task);
                  return (
                    <tr key={task.id} className="group hover:bg-white/[.02] transition-colors">
                      <td className="px-4 py-3 w-8">
                        <button onClick={() => toggle.mutate(task)} className={`grid h-4 w-4 place-items-center rounded border transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : "border-white/25 hover:border-white/50"}`}>
                          {task.completed && <Check size={9} className="text-white"/>}
                        </button>
                      </td>
                      <td className="px-4 py-3 max-w-[260px]">
                        <button onClick={() => setDetailTask(task)} className={`text-left hover:underline font-medium truncate block w-full ${task.completed ? "text-slate-600 line-through" : "text-slate-100"}`}>{task.title}</button>
                        {task.notes && <p className="text-xs text-slate-600 truncate mt-0.5">{task.notes}</p>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${completion.cls}`}>{completion.label}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {task.priority && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${PRIORITY_STYLE[task.priority]}`}>{task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
                        {assigneeName ? <span className="flex items-center gap-1"><User size={11}/>{assigneeName}</span> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {task.due_date
                          ? <span className={isOverdue ? "text-red-400" : "text-slate-400"}>{new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                        {task.created_at ? new Date(task.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
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
                          <button onClick={() => setEditTask(task)} className="rounded p-1 text-slate-600 hover:text-slate-300 hover:bg-white/[.05]"><Pencil size={12}/></button>
                          {(task.assignee_id === currentUserId || !task.assignee_id) && <button onClick={() => setConfirmDeleteId(task.id)} className="rounded p-1 text-slate-600 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={12}/></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── DONE section (list view only) ─────────────────── */}
      {viewMode === "list" && doneTasks.length > 0 && !labelFilter && sortBy === "created_at" && (
        <div className="mt-6">
          <button onClick={() => setShowDone(!showDone)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-3">
            <ChevronDown size={14} className={`transition-transform ${showDone ? "" : "-rotate-90"}`}/>
            <span>Completed</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-500">{doneTasks.length}</span>
          </button>
          {showDone && (
            <div className="space-y-2 opacity-60">
              {doneTasks.map(task => (
                <div key={task.id} className="rounded-xl border border-white/[.04] bg-white/[.01] p-3 flex items-center gap-3">
                  <button onClick={() => toggle.mutate(task)} className="h-5 w-5 shrink-0 rounded border border-emerald-500/50 bg-emerald-500/20 grid place-items-center">
                    <Check size={11} className="text-emerald-400"/>
                  </button>
                  <button onClick={() => setDetailTask(task)} className="flex-1 text-sm text-slate-500 line-through text-left hover:text-slate-400 truncate">{task.title}</button>
                  <span className="text-[11px] text-slate-600 shrink-0">{task.status === "done" ? "Done" : "Completed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#111419] p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 mb-4">
              <Trash2 size={18} className="text-red-400"/>
            </div>
            <h2 className="text-base font-semibold text-white mb-1">Delete task?</h2>
            <p className="text-sm text-slate-500 mb-5">
              {tasks.find(t => t.id === confirmDeleteId)?.title && (
                <span>"{tasks.find(t => t.id === confirmDeleteId)?.title}" </span>
              )}
              This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteId(null)} className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={() => { remove.mutate(confirmDeleteId); setConfirmDeleteId(null); }} className="flex-1 h-10 rounded-lg bg-red-600 text-sm font-medium text-white hover:bg-red-500 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          members={members}
          onClose={() => setDetailTask(null)}
          onUpdate={() => { qc.invalidateQueries({ queryKey: ["tasks", filter, labelFilter, sortBy] }).then(() => { const allT = qc.getQueryData<any[]>(["tasks", filter, labelFilter, sortBy]) || []; const updated = allT.find((t: any) => t.id === detailTask?.id); if (updated) setDetailTask(updated); }); }}
        />
      )}

      {editTask && (
        <EditTaskModal
          task={editTask}
          onClose={() => setEditTask(null)}
          members={members}
          currentUserId={currentUserId}
        />
      )}

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          members={members}
          currentUserId={currentUserId}
          userName={user?.fullName || user?.firstName || "Someone"}
        />
      )}
    </div>
  );
}
