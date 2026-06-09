import { Sparkles, Send, Loader2, User, Plus } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface Message { role: "user" | "assistant"; content: string; }
interface Thread { id: string; title: string; messages: Message[]; }

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

function saveThreads(threads: Thread[]) {
  try { localStorage.setItem("mondaily_chat_threads", JSON.stringify(threads)); } catch {}
}

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem("mondaily_chat_threads");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function AskMondaily() {
  const [threads, setThreads] = useState<Thread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const t = loadThreads();
    return t.length > 0 && t[0] ? t[0].id : null;
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = threads.find(t => t.id === activeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, loading]);

  const newThread = () => {
    const id = Date.now().toString();
    const thread: Thread = { id, title: "New chat", messages: [] };
    const updated = [thread, ...threads];
    setThreads(updated);
    saveThreads(updated);
    setActiveId(id);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    let thread = active;
    let currentThreads = threads;

    if (!thread) {
      const id = Date.now().toString();
      thread = { id, title: text.slice(0, 40), messages: [] };
      currentThreads = [thread, ...threads];
      setThreads(currentThreads);
      setActiveId(id);
    }

    const userMsg: Message = { role: "user", content: text };
    const updatedMessages = [...thread.messages, userMsg];
    const updatedThread = {
      ...thread,
      title: (thread.messages.length === 0 ? text.slice(0, 40) : thread.title) as string,
      messages: updatedMessages
    };
    const newThreads = currentThreads.map(t => t.id === updatedThread.id ? updatedThread : t);
    setThreads(newThreads);
    saveThreads(newThreads);
    setLoading(true);

    try {
      const reply = await callAsk(text);
      const withReply = { ...updatedThread, messages: [...updatedMessages, { role: "assistant" as const, content: reply }] };
      const final = newThreads.map(t => t.id === withReply.id ? withReply : t);
      setThreads(final);
      saveThreads(final);
    } catch (err: any) {
      const withErr = { ...updatedThread, messages: [...updatedMessages, { role: "assistant" as const, content: `Error: ${err.message}` }] };
      const final = newThreads.map(t => t.id === withErr.id ? withErr : t);
      setThreads(final);
      saveThreads(final);
    }
    setLoading(false);
  };

  const SUGGESTIONS = ["Summarize my pipeline", "What tasks are overdue?", "Draft a follow-up email", "Analyze my deals"];

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0a0c10]">
        <div className="p-3">
          <button onClick={newThread} className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
            <Plus size={14}/> New chat
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-0.5">
          {threads.length === 0 && <div className="px-3 py-2 text-xs text-slate-600">No conversations yet</div>}
          {threads.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)} className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors truncate ${activeId === t.id ? "bg-white/[.08] text-white" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-300"}`}>
              {t.title}
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        <div className="border-b border-white/10 px-6 py-3">
          <div className="text-sm font-medium text-white">{active?.title || "Ask Mondaily"}</div>
          <div className="text-xs text-slate-500">AI business assistant</div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {(!active || active.messages.length === 0) && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
                  <Sparkles size={20} className="text-red-400"/>
                </div>
                <div className="text-sm font-medium text-white mb-1">How can I help you today?</div>
                <div className="text-xs text-slate-500 mb-4">Ask about your pipeline, contacts, tasks, or anything business related</div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => setInput(s)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {active?.messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 mt-0.5">
                  <Sparkles size={13} className="text-red-400"/>
                </div>
              )}
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-red-500/20 text-white" : "bg-white/[.06] text-slate-200"}`}>
                {m.content}
              </div>
              {m.role === "user" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 mt-0.5">
                  <User size={13} className="text-slate-400"/>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 mt-0.5">
                <Sparkles size={13} className="text-red-400"/>
              </div>
              <div className="rounded-2xl bg-white/[.06] px-4 py-3">
                <Loader2 size={14} className="animate-spin text-slate-400"/>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 focus-within:border-red-500/30">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask anything about your business..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-white placeholder-slate-500 outline-none"
              style={{ maxHeight: "120px" }}
            />
            <button onClick={send} disabled={loading || !input.trim()} className="shrink-0 rounded-lg bg-red-500 p-2 text-white hover:bg-red-400 disabled:opacity-40 transition-colors">
              <Send size={14}/>
            </button>
          </div>
          <div className="mt-1.5 text-xs text-slate-600 text-center">Enter to send · Shift+Enter for new line</div>
        </div>
      </div>
    </div>
  );
}
