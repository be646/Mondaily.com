import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Check, Plus, X, Flag, Clock, User, FileText, RotateCcw, ChevronDown } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageSkeleton } from "../../components/ui/page-state";

interface Task {
  id: string; title: string; completed: boolean; due_date?: string;
  assignee_id?: string; assignee_email?: string; record_name?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "todo" | "in_progress" | "review" | "done";
  notes?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-slate-400 bg-slate-400/10",
  medium: "text-blue-400 bg-blue-400/10",
  high: "text-orange-400 bg-orange-400/10",
  urgent: "text-red-400 bg-red-400/10",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent"
};

const STATUS_COLORS: Record<string, string> = {
  todo: "text-slate-400", in_progress: "text-blue-400",
  review: "text-yellow-400", done: "text-emerald-400"
};

function isOverdue(due_date?: string, completed?: boolean) {
  if (!due_date || completed) return false;
  return new Date(due_date) < new Date();
}

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("todo");
  const [notes, setNotes] = useState("");
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () => apiClient.post("/tasks", {
      title, due_date: dueDate || undefined,
      priority, status, notes: notes || undefined,
      assignee_email: assigneeEmail || undefined
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); onCreated(); onClose(); }
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
            <label className="text-xs text-slate-500 mb-1 block">Title *</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && title.trim() && create.mutate()} placeholder="Task title..." className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white"/>
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
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Due Date</label>
            <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Assign to (email)</label>
            <input value={assigneeEmail} onChange={e => setAssigneeEmail(e.target.value)} placeholder="colleague@company.com" className="h-10 w-full rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white"/>
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
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("mine");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["tasks", filter], queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${filter}`) });
  
  const toggle = useMutation({
    mutationFn: (task: Task) => apiClient.patch(`/tasks/${task.id}`, { completed: !task.completed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] })
  });

  const tasks = query.data ?? [];
  const overdueTasks = tasks.filter(t => isOverdue(t.due_date, t.completed));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
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
          <Clock size={14} className="text-red-400 shrink-0"/>
          <span className="text-sm text-red-400">{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}</span>
          <button onClick={() => setFilter("overdue")} className="ml-auto text-xs text-red-400 hover:text-red-300 underline">View all</button>
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex gap-2 flex-wrap">
        {["mine", "all", "overdue", "review"].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors ${filter === f ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
            {f === "review" ? "Needs Review" : f}
          </button>
        ))}
      </div>

      {query.isLoading ? <PageSkeleton /> : tasks.length === 0 ? (
        <EmptyState icon={Check} title="No tasks" description="You are all caught up. Create a task for yourself or your team." />
      ) : (
        <div className="space-y-1.5">
          {tasks.map(task => {
            const overdue = isOverdue(task.due_date, task.completed);
            const expanded = expandedId === task.id;
            return (
              <div key={task.id} className={`rounded-xl border transition-colors ${overdue ? "border-red-500/20 bg-red-500/5" : "border-white/[.06] hover:border-white/10"}`}>
                <div className="flex items-start gap-3 p-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggle.mutate(task)}
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${task.completed ? "border-emerald-500 bg-emerald-500" : overdue ? "border-red-400/50" : "border-white/20 hover:border-white/40"}`}
                  >
                    {task.completed ? <Check size={11}/> : null}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm ${task.completed ? "text-slate-600 line-through" : "text-slate-200"}`}>{task.title}</p>
                      {task.priority && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[task.priority]}`}>
                          {PRIORITY_LABELS[task.priority]}
                        </span>
                      )}
                      {task.status && task.status !== "todo" && (
                        <span className={`text-[10px] ${STATUS_COLORS[task.status]}`}>
                          {task.status === "in_progress" ? "In Progress" : task.status === "review" ? "Needs Review" : "Done"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-3 flex-wrap text-xs">
                      {task.due_date && (
                        <span className={`flex items-center gap-1 ${overdue ? "text-red-400" : "text-slate-500"}`}>
                          <Clock size={10}/>
                          {overdue ? "Overdue · " : ""}{new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {task.assignee_email && <span className="flex items-center gap-1 text-slate-500"><User size={10}/>{task.assignee_email}</span>}
                      {task.record_name && <span className="text-slate-600">{task.record_name}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {task.completed && (
                      <button onClick={() => toggle.mutate(task)} className="rounded p-1 text-slate-600 hover:text-slate-300" title="Reactivate task">
                        <RotateCcw size={13}/>
                      </button>
                    )}
                    {task.notes && (
                      <button onClick={() => setExpandedId(expanded ? null : task.id)} className="rounded p-1 text-slate-600 hover:text-slate-300">
                        <FileText size={13}/>
                      </button>
                    )}
                    <button onClick={() => setExpandedId(expanded ? null : task.id)} className="rounded p-1 text-slate-600 hover:text-slate-300">
                      <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`}/>
                    </button>
                  </div>
                </div>

                {/* Expanded notes */}
                {expanded && task.notes && (
                  <div className="border-t border-white/[.06] px-4 py-3 ml-8">
                    <p className="text-xs text-slate-500 mb-1">Notes</p>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap">{task.notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={() => {}}/>}
    </div>
  );
}
