import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Check, Plus } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../components/ui/page-state";

interface Task { id: string; title: string; completed: boolean; due_date?: string; assignee_name?: string; record_name?: string }

export function TasksPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("mine");
  const [draft, setDraft] = useState("");
  const query = useQuery({ queryKey: ["tasks", filter], queryFn: () => apiClient.get<Task[]>(`/tasks?filter=${filter}`) });
  const create = useMutation({ mutationFn: () => apiClient.post("/tasks", { title: draft }), onSuccess: () => { setDraft(""); queryClient.invalidateQueries({ queryKey: ["tasks"] }); } });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.patch(`/tasks/${id}`, { completed: true }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }) });
  const tasks = query.data ?? [];
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Tasks" description="Work assigned to you and your team." />
      <div className="mb-5 flex gap-2">{["mine", "all", "overdue"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${filter === item ? "bg-white/10 text-white" : "text-slate-500"}`}>{item}</button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) create.mutate(); }} className="mb-6 flex gap-2"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Create a task..." className="h-10 flex-1 rounded-md border border-white/10 bg-transparent px-3 text-sm" /><button className="flex items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium"><Plus size={14} /> New task</button></form>
      {query.isLoading ? <PageSkeleton /> : tasks.length === 0 ? <EmptyState icon={Check} title="No tasks" description="You are all caught up. Create a task for yourself or your team." /> : (
        <div className="space-y-1">{tasks.map((task) => <div key={task.id} className="flex items-start gap-3 rounded-lg border border-transparent p-3 hover:border-white/10"><button onClick={() => complete.mutate(task.id)} className={`mt-0.5 grid h-5 w-5 place-items-center rounded border ${task.completed ? "border-emerald-500 bg-emerald-500" : "border-white/20"}`}>{task.completed ? <Check size={12} /> : null}</button><div className="flex-1"><p className={`text-sm ${task.completed ? "text-slate-600 line-through" : "text-slate-200"}`}>{task.title}</p><div className="mt-1 flex gap-3 text-xs text-slate-500">{task.due_date ? <span className="flex items-center gap-1"><Calendar size={10} />{new Date(task.due_date).toLocaleString()}</span> : null}{task.assignee_name ? <span>{task.assignee_name}</span> : null}{task.record_name ? <span>{task.record_name}</span> : null}</div></div></div>)}</div>
      )}
    </div>
  );
}
