import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X, Clock, User, FileText, RotateCcw, ChevronDown, AlertCircle } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageSkeleton } from "../../components/ui/page-state";

interface Member { id: string; user_id: string; email: string; name: string; avatar_url?: string; }
interface Task {
  id: string; title: string; completed: boolean;
  due_date?: string; created_at?: string; updated_at?: string;
  assignee_id?: string; assignee_email?: string;
  record_id?: string; record_name?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "todo" | "in_progress" | "review" | "done";
  notes?: string;
}

const PRIORITY_STYLE: Record<string, string> = {
  low: "text-slate-400 bg-slate-400/10",
  medium: "text-blue-400 bg-blue-400/10",
  high: "text-orange-400 bg-orange-400/10",
  urgent: "text-red-400 bg-red-400/10",
};

function completionStyle(task: Task) {
  if (task.completed) {
    const wasLate = task.due_date && task.updated_at && new Date(task.updated_at) > new Date(task.due_date);
    return wasLate
      ? { label: "Completed late", color: "text-orange-400 bg-orange-400/10" }
      : { label: "Completed", color: "text-emerald-400 bg-emerald-400/10" };
  }
  if (task.due_date && new Date(task.due_date) < new Date()) {
    return { label: "Overdue", color: "text-red-400 bg-red-400/10" };
  }
  if (task.status === "review") return { label: "Needs Review", color: "text-yellow-400 bg-yellow-400/10" };
  if (task.status === "in_progress") return { label: "In Progress", color: "text-blue-400 bg-blue-400/10" };
  if (task.status === "done") return { label: "Done", color: "text-emerald-400 bg-emerald-400/10" };
  return { label: "To Do", color: "text-slate-400 bg-slate-400/10" };
}

function CreateTaskModal({ onClose, members }: { onClose: () => void; members: Member[] }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("todo");
  const [notes, setNotes] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => {
      const member = members.find(m => m.user_id === assigneeId);
      return apiClient.post("/tasks", {
        title, due_date: dueDate || undefined,
        priority, status, notes: notes || undefined,
        assignee_id: assigneeId || undefined,
        assignee_email: member?.email || undefined,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onClose(); }
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
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && title.trim() && create.mutate()} placeholder="Task title..." className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Due Date</label>
            <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Assigned To</label>
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white">
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-[#0b0d10] px-3 text-sm text-white">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Needs Review</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Additional notes..." className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white resize-none"/>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-slate-400">Cancel</button>
          <button onClick={() => title.trim() && create.mutate()} disabled={!title.trim() || create.isPending} className="flex-1 h-10 rounded-lg bg-red-600 text-sm font-medium text-white disabled:opacity-50">
            {create.isPending ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("mine");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["tasks", filter], queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${filter}`) });
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  const members = membersQuery.data ?? [];

  const toggle = useMutation({
    mutationFn: (task: Task) => apiClient.patch(`/tasks/${task.id}`, { completed: !task.completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] })
  });

  const tasks = query.data ?? [];
  const overdueTasks = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date());

  const getMemberName = (task: Task) => {
    const m = members.find(m => m.user_id === task.assignee_id);
    return m ? (m.name || m.email) : task.assignee_email || null;
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Tasks</h1>
          <p className="text-sm text-slate-500 mt-0.5">Work assigned to you and your team.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500">
          <Plus size={15}/> New Task
        </button>
      </div>

      {/* Overdue warning */}
      {overdueTasks.length > 0 && filter !== "overdue" && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5">
          <AlertCircle size={14} className="text-red-400 shrink-0"/>
          <span className="text-sm text-red-400">{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}</span>
          <button onClick={() => setFilter("overdue")} className="ml-auto text-xs text-red-400 hover:text-red-300 underline">View all</button>
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex gap-2 flex-wrap">
        {[
          { key: "mine", label: "Mine" },
          { key: "all", label: "All" },
          { key: "overdue", label: "Overdue" },
          { key: "review", label: "Needs Review" },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${filter === f.key ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="mb-2 hidden md:grid grid-cols-[1fr_120px_140px_140px_110px_80px] gap-2 px-3 text-[11px] font-medium uppercase tracking-wider text-slate-600">
        <span>Task</span>
        <span>Due Date</span>
        <span>Assigned To</span>
        <span>Record</span>
        <span>Priority</span>
        <span>Status</span>
      </div>

      {query.isLoading ? <PageSkeleton /> : tasks.length === 0 ? (
        <EmptyState icon={Check} title="No tasks" description="You are all caught up. Create a task for yourself or your team." />
      ) : (
        <div className="space-y-1.5">
          {tasks.map(task => {
            const completion = completionStyle(task);
            const expanded = expandedId === task.id;
            const assigneeName = getMemberName(task);
            const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();

            return (
              <div key={task.id} className={`rounded-xl border transition-colors ${isOverdue ? "border-red-500/20 bg-red-500/5" : "border-white/[.06] hover:border-white/10 bg-white/[.02]"}`}>
                <div className="grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_120px_140px_140px_110px_80px_auto] gap-2 items-center px-3 py-2.5">
                  
                  {/* Checkbox */}
                  <button onClick={() => toggle.mutate(task)}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : isOverdue ? "border-red-400/50" : "border-white/20 hover:border-white/40"}`}>
                    {task.completed ? <Check size={11}/> : null}
                  </button>

                  {/* Title */}
                  <span className={`text-sm truncate ${task.completed ? "text-slate-600 line-through" : "text-slate-200"}`}>{task.title}</span>

                  {/* Due date — hidden on mobile */}
                  <span className="hidden md:block text-xs text-slate-500 truncate">
                    {task.due_date
                      ? <span className={isOverdue ? "text-red-400" : ""}>{new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      : <span className="text-slate-700">—</span>}
                  </span>

                  {/* Assigned to */}
                  <span className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 truncate">
                    {assigneeName ? <><User size={10} className="shrink-0"/>{assigneeName}</> : <span className="text-slate-700">—</span>}
                  </span>

                  {/* Record */}
                  <span className="hidden md:block text-xs text-slate-600 truncate">
                    {task.record_name || <span className="text-slate-700">—</span>}
                  </span>

                  {/* Priority */}
                  <span className="hidden md:block">
                    {task.priority ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIORITY_STYLE[task.priority]}`}>
                        {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                      </span>
                    ) : <span className="text-slate-700 text-xs">—</span>}
                  </span>

                  {/* Completion status */}
                  <span className="hidden md:block">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${completion.color}`}>
                      {completion.label}
                    </span>
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {task.completed && (
                      <button onClick={() => toggle.mutate(task)} className="rounded p-1 text-slate-600 hover:text-slate-300" title="Reactivate">
                        <RotateCcw size={12}/>
                      </button>
                    )}
                    <button onClick={() => setExpandedId(expanded ? null : task.id)} className="rounded p-1 text-slate-600 hover:text-slate-300">
                      <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`}/>
                    </button>
                  </div>
                </div>

                {/* Mobile details row */}
                <div className="md:hidden px-10 pb-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  {task.due_date && <span className={`flex items-center gap-1 ${isOverdue ? "text-red-400" : ""}`}><Clock size={9}/>{new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                  {assigneeName && <span className="flex items-center gap-1"><User size={9}/>{assigneeName}</span>}
                  {task.priority && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${completion.color}`}>{completion.label}</span>
                </div>

                {/* Expanded details */}
                {expanded && (
                  <div className="border-t border-white/[.06] px-10 py-3 space-y-2">
                    {task.created_at && <p className="text-xs text-slate-600">Created: {new Date(task.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
                    {task.due_date && <p className="text-xs text-slate-500">Due: {new Date(task.due_date).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
                    {task.notes && <p className="text-sm text-slate-300 whitespace-pre-wrap">{task.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} members={members}/>}
    </div>
  );
}
