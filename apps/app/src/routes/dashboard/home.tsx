import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckSquare, Plus, Sparkles, Send, Loader2, User, Clock, User} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { PageSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage } from "../../lib/chat-store";

interface Task { id: string; title: string; completed: boolean; due_date?: string; priority?: string; status?: string; assignee_email?: string; created_at?: string; }
interface Meeting { id: string; title: string; start_time: string; attendees?: string[] }

export function HomePage() {
  const { user } = useUser();
  const qc = useQueryClient();
  const [task, setTask] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const tasks = useQuery({ queryKey: ["tasks", "home"], queryFn: () => apiClient.get<Task[]>("/tasks?filter=mine") });
  const meetings = useQuery({ queryKey: ["meetings", "home"], queryFn: () => apiClient.get<Meeting[]>("/meetings/today") });
  const create = useMutation({ mutationFn: () => apiClient.post("/tasks", { title: task }), onSuccess: () => { setTask(""); qc.invalidateQueries({ queryKey: ["tasks"] }); } });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const activeTasks = (tasks.data ?? []).filter(t => !t.completed);
  const isChatting = messages.length > 0;
  const recentThreads = getThreads().slice(0, 3);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    let threadId = currentThreadId;
    if (!threadId) {
      const thread = createThread(text);
      saveThreads([thread, ...getThreads()]);
      threadId = thread.id;
      setCurrentThreadId(threadId);
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    addMessageToThread(threadId, userMsg);
    setLoading(true);

    try {
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
        body: JSON.stringify({ message: text, model: (() => { try { return JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}").model ?? "auto"; } catch { return "auto"; } })(), web_search: (() => { try { return JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}").webSearch === "allow"; } catch { return false; } })() })
      });
      const data = await res.json() as any;
      const reply = data.reply || "No response.";
      const aiMsg: ChatMessage = { role: "assistant", content: reply };
      setMessages([...withUser, aiMsg]);
      addMessageToThread(threadId, aiMsg);
    } catch (err: any) {
      const errMsg: ChatMessage = { role: "assistant", content: `Error: ${err.message}` };
      setMessages([...withUser, errMsg]);
      addMessageToThread(threadId, errMsg);
    }
    setLoading(false);
  };

  const newChat = () => {
    setMessages([]);
    setCurrentThreadId(null);
    setInput("");
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{greeting}, {user?.firstName || "there"}.</h1>
      <p className="mt-1 text-sm text-slate-500">Mondaily is ready to run today's work.</p>

      <section className="mt-7">
        {isChatting && (
          <div className="mb-4 space-y-4 rounded-xl border border-white/10 bg-white/[.02] p-4 max-h-80 overflow-auto">
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
            <button onClick={newChat} className="text-xs text-slate-600 hover:text-slate-400 mr-1 shrink-0">New chat</button>
          )}
          <button onClick={send} disabled={loading || !input.trim()} className="shrink-0 text-red-400 hover:text-red-300 disabled:opacity-40">
            {loading ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          {!isChatting && recentThreads.length > 0 && (
            <>
              <span className="text-xs text-slate-600">Recent:</span>
              {recentThreads.map(t => (
                <Link key={t.id} to={`/ask/${t.id}`} className="text-xs text-slate-500 hover:text-red-400 transition-colors truncate max-w-[150px]">{t.title}</Link>
              ))}
              <span className="text-slate-700">·</span>
            </>
          )}
          <Link to="/ask/new" className="text-xs text-red-400 hover:text-red-300">Open Ask Mondaily →</Link>
        </div>
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
              <Link key={item.id} to="/tasks" className="block rounded-lg bg-white/[.03] hover:bg-white/[.05] p-3 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-slate-200">{item.title}</span>
                    {item.priority && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        item.priority === "urgent" ? "bg-red-400/10 text-red-400" :
                        item.priority === "high" ? "bg-orange-400/10 text-orange-400" :
                        item.priority === "medium" ? "bg-blue-400/10 text-blue-400" :
                        "bg-slate-400/10 text-slate-400"
                      }`}>{item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-slate-500">
                    {item.status && item.status !== "todo" && (
                      <span className={`${item.status === "review" ? "text-yellow-400" : item.status === "in_progress" ? "text-blue-400" : "text-emerald-400"}`}>
                        {item.status === "in_progress" ? "In Progress" : item.status === "review" ? "Needs Review" : "Done"}
                      </span>
                    )}
                    {item.due_date && (
                      <span className={`flex items-center gap-1 ${new Date(item.due_date) < new Date() ? "text-red-400" : ""}`}>
                        <Clock size={9}/>{new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {new Date(item.due_date) < new Date() ? " · Overdue" : ""}
                      </span>
                    )}
                    {item.assignee_email && <span className="flex items-center gap-1"><User size={9}/>{item.assignee_email}</span>}
                    {item.created_at && <span>{new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                  </div>
                </Link>
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
