import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckSquare, Plus, Sparkles, Send, Loader2, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { PageSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";

interface Task { id: string; title: string; completed: boolean; due_date?: string }
interface Meeting { id: string; title: string; start_time: string; attendees?: string[] }
interface Message { role: "user" | "assistant"; content: string; }

async function callAsk(message: string): Promise<string> {
  const token = localStorage.getItem("mondaily_session_token");
  const workspaceId = localStorage.getItem("mondaily_workspace_id");
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const res = await fetch(`${apiUrl}/api/v1/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
    },
    body: JSON.stringify({ message })
  });
  const data = await res.json() as any;
  return data.reply || "No response.";
}

export function HomePage() {
  const { user } = useUser();
  const qc = useQueryClient();
  const [task, setTask] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const tasks = useQuery({ queryKey: ["tasks", "home"], queryFn: () => apiClient.get<Task[]>("/tasks?filter=mine") });
  const meetings = useQuery({ queryKey: ["meetings", "home"], queryFn: () => apiClient.get<Meeting[]>("/meetings/today") });
  const create = useMutation({ mutationFn: () => apiClient.post("/tasks", { title: task }), onSuccess: () => { setTask(""); qc.invalidateQueries({ queryKey: ["tasks"] }); } });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const activeTasks = (tasks.data ?? []).filter((item) => !item.completed);
  const isChatting = messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const reply = await callAsk(text);
      setMessages([...newMessages, { role: "assistant" as const, content: reply }]);
    } catch (err: any) {
      setMessages([...newMessages, { role: "assistant" as const, content: `Error: ${err.message}` }]);
    }
    setLoading(false);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{greeting}, {user?.firstName || "there"}.</h1>
      <p className="mt-1 text-sm text-slate-500">Mondaily is ready to run today's work.</p>

      {/* Chat section */}
      <section className="mt-7">
        {isChatting && (
          <div className="mb-4 space-y-4 rounded-xl border border-white/10 bg-white/[.02] p-4 max-h-96 overflow-auto">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 mt-0.5">
                    <Sparkles size={11} className="text-red-400"/>
                  </div>
                )}
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-red-500/20 text-white" : "bg-white/[.06] text-slate-200"}`}>
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 mt-0.5">
                    <User size={11} className="text-slate-400"/>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-3 justify-start">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 mt-0.5">
                  <Sparkles size={11} className="text-red-400"/>
                </div>
                <div className="rounded-xl bg-white/[.06] px-3 py-2">
                  <Loader2 size={13} className="animate-spin text-slate-400"/>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 focus-within:border-red-500/30">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder={isChatting ? "Continue the conversation..." : "Ask anything or give Mondaily an instruction..."}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          {isChatting && (
            <button onClick={() => setMessages([])} className="text-xs text-slate-600 hover:text-slate-400 mr-2">Clear</button>
          )}
          <button onClick={send} disabled={loading || !input.trim()} className="shrink-0 text-red-400 hover:text-red-300 disabled:opacity-40">
            {loading ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
          </button>
        </div>
        {!isChatting && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-600">Or open full chat:</span>
            <Link to="/ask/new" className="text-xs text-red-400 hover:text-red-300">Ask Mondaily →</Link>
          </div>
        )}
      </section>

      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <section className="min-h-72 rounded-lg border border-white/10 p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium"><Calendar size={14}/> Meetings</h2>
            <span className="text-xs text-slate-600">Today</span>
          </div>
          {meetings.isLoading ? <PageSkeleton rows={3}/> : meetings.data?.length ? (
            <div className="space-y-2">{meetings.data.map(m => (
              <div key={m.id} className="rounded-md bg-white/[.03] p-3">
                <p className="text-sm">{m.title}</p>
                <p className="mt-1 text-xs text-slate-500">{m.start_time}</p>
              </div>
            ))}</div>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center text-center">
              <p className="text-sm font-medium text-slate-300">Turn meetings into opportunities</p>
              <p className="mt-1 max-w-xs text-xs text-slate-500">Connect Google or Microsoft Calendar to prepare briefs automatically.</p>
              <div className="mt-4 flex gap-2">
                <button className="rounded-md border border-white/10 px-3 py-2 text-xs">Sync Google</button>
                <button className="rounded-md border border-white/10 px-3 py-2 text-xs">Sync Microsoft</button>
              </div>
            </div>
          )}
        </section>

        <section className="min-h-72 rounded-lg border border-white/10 p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium"><CheckSquare size={14}/> Tasks</h2>
            <span className="text-xs text-slate-600">{activeTasks.length}</span>
          </div>
          {tasks.isLoading ? <PageSkeleton rows={3}/> : activeTasks.length ? (
            <div className="space-y-2">{activeTasks.slice(0, 5).map(item => (
              <div key={item.id} className="rounded-md bg-white/[.03] p-3 text-sm">{item.title}</div>
            ))}</div>
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">Stay on top of work. Create tasks for yourself or your team.</p>
          )}
          <form onSubmit={e => { e.preventDefault(); if (task.trim()) create.mutate(); }} className="mt-4 flex gap-2">
            <input value={task} onChange={e => setTask(e.target.value)} placeholder="New task" className="h-9 flex-1 rounded-md border border-white/10 bg-transparent px-3 text-sm"/>
            <button className="grid w-9 place-items-center rounded-md border border-white/10 text-red-400"><Plus size={14}/></button>
          </form>
        </section>
      </div>
    </div>
  );
}
