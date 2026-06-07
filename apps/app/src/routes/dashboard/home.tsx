import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckSquare, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { AskMondailyInline } from "../../components/ai/ask-mondaily-inline";
import { PageSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";

interface Task { id: string; title: string; completed: boolean; due_date?: string }
interface Meeting { id: string; title: string; start_time: string; attendees?: string[] }

export function HomePage() {
  const { user } = useUser();
  const qc = useQueryClient();
  const [task, setTask] = useState("");
  const [answer, setAnswer] = useState("");
  const tasks = useQuery({ queryKey: ["tasks", "home"], queryFn: () => apiClient.get<Task[]>("/tasks?filter=mine") });
  const meetings = useQuery({ queryKey: ["meetings", "home"], queryFn: () => apiClient.get<Meeting[]>("/meetings/today") });
  const create = useMutation({ mutationFn: () => apiClient.post("/tasks", { title: task }), onSuccess: () => { setTask(""); qc.invalidateQueries({ queryKey: ["tasks"] }); } });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const activeTasks = (tasks.data ?? []).filter((item) => !item.completed);
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{greeting}, {user?.firstName || "there"}.</h1>
      <p className="mt-1 text-sm text-slate-500">Mondaily is ready to run today’s work.</p>
      <section className="mt-7">
        <p className="mb-2 text-xs text-slate-600">{answer ? "Current conversation" : "Start a new conversation"}</p>
        <AskMondailyInline placeholder="Ask anything..." onResponse={setAnswer} />
        {answer ? <div className="mt-3 rounded-lg border border-white/10 p-4 text-sm leading-6 text-slate-300"><Sparkles className="mb-2 text-red-400" size={14} />{answer}</div> : null}
      </section>
      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <section className="min-h-72 rounded-lg border border-white/10 p-5"><div className="mb-5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Calendar size={14} /> Meetings</h2><span className="text-xs text-slate-600">Today</span></div>{meetings.isLoading ? <PageSkeleton rows={3} /> : meetings.data?.length ? <div className="space-y-2">{meetings.data.map((meeting) => <div key={meeting.id} className="rounded-md bg-white/[.03] p-3"><p className="text-sm">{meeting.title}</p><p className="mt-1 text-xs text-slate-500">{meeting.start_time}</p></div>)}</div> : <div className="flex h-44 flex-col items-center justify-center text-center"><p className="text-sm font-medium text-slate-300">Turn meetings into opportunities</p><p className="mt-1 max-w-xs text-xs text-slate-500">Connect Google or Microsoft Calendar to prepare briefs automatically.</p><div className="mt-4 flex gap-2"><button className="rounded-md border border-white/10 px-3 py-2 text-xs">Sync Google</button><button className="rounded-md border border-white/10 px-3 py-2 text-xs">Sync Microsoft</button></div></div>}</section>
        <section className="min-h-72 rounded-lg border border-white/10 p-5"><div className="mb-5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><CheckSquare size={14} /> Tasks</h2><span className="text-xs text-slate-600">{activeTasks.length}</span></div>{tasks.isLoading ? <PageSkeleton rows={3} /> : activeTasks.length ? <div className="space-y-2">{activeTasks.slice(0, 5).map((item) => <div key={item.id} className="rounded-md bg-white/[.03] p-3 text-sm">{item.title}</div>)}</div> : <p className="py-10 text-center text-sm text-slate-500">Stay on top of work. Create tasks for yourself or your team.</p>}<form onSubmit={(event) => { event.preventDefault(); if (task.trim()) create.mutate(); }} className="mt-4 flex gap-2"><input value={task} onChange={(event) => setTask(event.target.value)} placeholder="New task" className="h-9 flex-1 rounded-md border border-white/10 bg-transparent px-3 text-sm" /><button className="grid w-9 place-items-center rounded-md border border-white/10 text-red-400" aria-label="Create task"><Plus size={14} /></button></form></section>
      </div>
    </div>
  );
}
