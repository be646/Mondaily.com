import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, CheckSquare, Sparkles, Send, Loader2, User, Clock, ArrowUpRight, Flag } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { PageSkeleton } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage } from "../../lib/chat-store";
import { TaskDetailPanel } from "../../components/tasks/task-detail-panel";

interface Task { id: string; title: string; completed: boolean; due_date?: string; priority?: string; status?: string; assignee_id?: string; assignee_email?: string; created_at?: string; notes?: string; labels?: string[]; record_id?: string; record_name?: string; updated_at?: string; }
interface Member { id: string; user_id: string; email: string; name: string; }
interface Meeting { id: string; title: string; start_time: string; attendees?: string[] }

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-400/10 text-red-400",
  high:   "bg-orange-400/10 text-orange-400",
  medium: "bg-blue-400/10 text-blue-400",
  low:    "bg-slate-400/10 text-slate-400",
};

export function HomePage() {
  const { user } = useUser();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const tasksQuery = useQuery({ queryKey: ["tasks", "home"], queryFn: () => apiClient.get<Task[]>("/tasks?filter=mine&sort=priority") });
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members") });
  const meetings = useQuery({ queryKey: ["meetings", "home"], queryFn: () => apiClient.get<Meeting[]>("/meetings/today") });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const members = membersQuery.data ?? [];
  const activeTasks = (tasksQuery.data ?? [])
    .filter(t => !t.completed && t.status !== "done")
    .sort((a, b) => (PRIORITY_ORDER[a.priority ?? "low"] ?? 3) - (PRIORITY_ORDER[b.priority ?? "low"] ?? 3));

  const getMemberName = (task: Task) => {
    if (!task.assignee_id) return task.assignee_email?.split("@")[0] ?? null;
    const m = members.find(m => m.user_id === task.assignee_id);
    return m ? (m.name || m.email.split("@")[0]) : (task.assignee_email?.split("@")[0] ?? null);
  };

  const isChatting = messages.length > 0;
  const recentThreads = getThreads().slice(0, 3);
  const inputRef = useRef<HTMLInputElement>(null);

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
      let model = "auto";
      let web_search = false;
      try { const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}"); model = s.model ?? "auto"; web_search = s.webSearch === "allow"; } catch {}
      const data = await apiClient.post<{ reply: string }>("/ask", { message: text, model, web_search });
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
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
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

        <section className="rounded-lg border border-white/10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[.06]">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-medium"><CheckSquare size={13}/> Tasks</h2>
              <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-px text-[10px] text-red-400">
                <Sparkles size={9}/> AI sorted
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">{activeTasks.length} open</span>
              <Link to="/tasks" className="flex items-center gap-0.5 text-xs text-slate-500 hover:text-white transition-colors">
                View all <ArrowUpRight size={11}/>
              </Link>
            </div>
          </div>

          {/* Table */}
          {tasksQuery.isLoading ? (
            <div className="p-4"><PageSkeleton rows={3}/></div>
          ) : activeTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <Sparkles size={18} className="text-red-400/50 mb-2"/>
              <p className="text-sm text-slate-400">Mondaily has nothing to assign you right now.</p>
              <p className="text-xs text-slate-600 mt-1">Ask it to create tasks or manage your work.</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/[.04]">
                  <th className="px-4 py-1.5 text-left font-medium text-[10px] text-slate-600 w-full">Task</th>
                  <th className="px-3 py-1.5 text-left font-medium text-[10px] text-slate-600 whitespace-nowrap">Priority</th>
                  <th className="px-3 py-1.5 text-left font-medium text-[10px] text-slate-600 whitespace-nowrap hidden sm:table-cell">Assignee</th>
                  <th className="px-3 py-1.5 text-left font-medium text-[10px] text-slate-600 whitespace-nowrap hidden sm:table-cell">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.03]">
                {activeTasks.slice(0, 8).map(item => {
                  const isOverdue = item.due_date && new Date(item.due_date) < new Date();
                  const assigneeName = getMemberName(item);
                  const statusDot = item.status === "in_progress" ? "bg-blue-400" : item.status === "review" ? "bg-yellow-400" : item.status === "done" ? "bg-emerald-400" : "bg-slate-500";
                  return (
                    <tr key={item.id} onClick={() => setDetailTask(item)}
                      className="group cursor-pointer hover:bg-white/[.03] transition-colors">
                      <td className="px-4 py-1.5 max-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${statusDot}`}/>
                          <span className="text-[11px] text-slate-300 group-hover:text-white transition-colors truncate">
                            {item.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {item.priority ? (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-medium ${PRIORITY_STYLE[item.priority]}`}>
                            <Flag size={7}/>{item.priority}
                          </span>
                        ) : <span className="text-[10px] text-slate-700">—</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">
                        {assigneeName ? (
                          <span className="flex items-center gap-1 text-[10px] text-slate-500"><User size={8}/>{assigneeName}</span>
                        ) : <span className="text-[10px] text-slate-700">—</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">
                        {item.due_date ? (
                          <span className={`flex items-center gap-0.5 text-[10px] ${isOverdue ? "text-red-400" : "text-slate-500"}`}>
                            <Clock size={8}/>{new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        ) : <span className="text-[10px] text-slate-700">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* AI footer */}
          <div className="border-t border-white/[.06] px-4 py-2 flex items-center gap-2">
            <Sparkles size={10} className="text-red-400 shrink-0"/>
            <button
              onClick={() => { setInput("Review my tasks and tell me what to focus on today"); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 50); }}
              className="flex-1 text-left text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
              Ask AI about your tasks…
            </button>
            <button
              onClick={() => { setInput("Review my tasks and tell me what to focus on today"); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 50); }}
              className="text-[10px] text-red-400 hover:text-red-300 transition-colors shrink-0">↑ Ask</button>
          </div>
        </section>
      </div>

      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          members={members}
          onClose={() => setDetailTask(null)}
          onUpdate={() => { qc.invalidateQueries({ queryKey: ["tasks", "home"] }); }}
        />
      )}
    </div>
  );
}
