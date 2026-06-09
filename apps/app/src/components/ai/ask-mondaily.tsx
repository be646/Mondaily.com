import { Sparkles, Send, Loader2, User, ThumbsUp, ThumbsDown, Copy, Download, RefreshCw, Check } from "lucide-react";
import { useParams } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage } from "../../lib/chat-store";

export function AskMondaily() {
  const { threadId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (threadId && threadId !== "new") {
      const t = getThreads().find(t => t.id === threadId);
      if (t) return t.messages;
    }
    return [];
  });
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(threadId && threadId !== "new" ? threadId : null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [lastUserMsg, setLastUserMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reload messages when threadId changes (clicking sidebar chat)
  useEffect(() => {
    if (threadId && threadId !== "new") {
      const t = getThreads().find(t => t.id === threadId);
      if (t) {
        setMessages(t.messages);
        setCurrentThreadId(t.id);
      } else {
        setMessages([]);
        setCurrentThreadId(null);
      }
    } else {
      setMessages([]);
      setCurrentThreadId(null);
    }
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    if (!overrideText) setInput("");
    let threadId = currentThreadId;
    if (!threadId) {
      const thread = createThread(text);
      saveThreads([thread, ...getThreads()]);
      threadId = thread.id;
      setCurrentThreadId(threadId);
    }
    setLastUserMsg(text);
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
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}) },
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

  const copyMessage = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const regenerate = () => {
    if (!lastUserMsg || loading) return;
    setMessages(prev => prev.slice(0, -1));
    send(lastUserMsg);
  };

  const downloadPdf = () => {
    const lines = messages.map(m => `${m.role === "user" ? "You" : "Mondaily AI"}:\n${m.content}`).join("\n\n---\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mondaily-chat.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sendFeedback = async (userMsg: string, aiMsg: string, rating: 1 | -1, idx: number) => {
    setFeedbackGiven(prev => ({ ...prev, [idx]: rating }));
    try {
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const apiUrl = import.meta.env.VITE_API_URL || "";
      await fetch(`${apiUrl}/api/v1/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
        },
        body: JSON.stringify({ message: userMsg, response: aiMsg, rating })
      });
    } catch {}
  };

  const SUGGESTIONS = ["Summarize my pipeline", "What tasks are overdue?", "Draft a follow-up email", "Analyze my deals"];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Ask Mondaily</h1>
          <p className="text-xs text-slate-500">Your AI business assistant</p>
        </div>
        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={downloadPdf} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors" title="Download chat"><Download size={13}/> Export</button>
            <button onClick={() => { setMessages([]); setCurrentThreadId(null); }} className="text-xs text-slate-500 hover:text-white transition-colors">New chat</button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-sm">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
                <Sparkles size={20} className="text-red-400"/>
              </div>
              <div className="text-sm font-medium text-white mb-1">How can I help you today?</div>
              <div className="text-xs text-slate-500 mb-4">Ask about your pipeline, contacts, tasks, or anything business related</div>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[.04] hover:text-white transition-colors">{s}</button>)}
              </div>
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 mt-0.5"><Sparkles size={13} className="text-red-400"/></div>}
            <div className="flex flex-col gap-1">
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-red-500/20 text-white" : "bg-white/[.06] text-slate-200"}`}>{m.content}</div>
              {m.role === "assistant" && i > 0 && (
                <div className="flex gap-1 ml-1">
                  <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, 1, i)} className={`rounded p-1.5 transition-colors ${feedbackGiven[i] === 1 ? "text-green-400" : "text-slate-600 hover:text-green-400"}`} title="Good response"><ThumbsUp size={12}/></button>
                  <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, -1, i)} className={`rounded p-1.5 transition-colors ${feedbackGiven[i] === -1 ? "text-red-400" : "text-slate-600 hover:text-red-400"}`} title="Bad response"><ThumbsDown size={12}/></button>
                  {feedbackGiven[i] && <span className="text-xs text-slate-600 ml-1">{feedbackGiven[i] === 1 ? "Thanks!" : "Got it"}</span>}
                  <button onClick={() => copyMessage(m.content, i)} className={`rounded p-1.5 transition-colors ml-1 ${copiedIdx === i ? "text-green-400" : "text-slate-600 hover:text-slate-300"}`} title="Copy"><Check size={12} className={copiedIdx === i ? "" : "hidden"}/><Copy size={12} className={copiedIdx === i ? "hidden" : ""}/></button>
                  {i === messages.length - 1 && !loading && <button onClick={regenerate} className="rounded p-1.5 text-slate-600 hover:text-slate-300 transition-colors" title="Regenerate"><RefreshCw size={12}/></button>}
                </div>
              )}
            </div>
            {m.role === "user" && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 mt-0.5"><User size={13} className="text-slate-400"/></div>}
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 mt-0.5"><Sparkles size={13} className="text-red-400"/></div>
            <div className="rounded-2xl bg-white/[.06] px-4 py-3"><Loader2 size={14} className="animate-spin text-slate-400"/></div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>
      <div className="border-t border-white/10 px-6 py-4">
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 focus-within:border-red-500/30">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask anything about your business..." rows={1} className="flex-1 resize-none bg-transparent text-sm text-white placeholder-slate-500 outline-none" style={{ maxHeight: "120px" }}/>
          <button id="ask-send-btn" onClick={() => send()} disabled={loading || !input.trim()} className="shrink-0 rounded-lg bg-red-500 p-2 text-white hover:bg-red-400 disabled:opacity-40 transition-colors"><Send size={14}/></button>
        </div>
        <div className="mt-1.5 text-xs text-slate-600 text-center">Enter to send · Shift+Enter for new line</div>
      </div>
    </div>
  );
}
