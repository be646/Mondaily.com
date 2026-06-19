import { Send, Loader2, ThumbsUp, ThumbsDown, Copy, Download, RefreshCw, Check, Zap, CornerDownLeft, BellDot, TrendingUp, Brain, MailCheck, ListChecks } from "lucide-react";

function LogoSymbol({ size = 28, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="6.5" fill="#6366f1" />
      <circle cx="16" cy="16" r="13" stroke="#6366f1" strokeWidth="1.4" opacity="0.35" />
      <circle cx="0" cy="0" r="2.4" fill="#6366f1" opacity="0.85">
        <animateMotion dur={thinking ? "1.2s" : "6s"} repeatCount="indefinite" path="M27,9 A13,13 0 1 1 5,23 A13,13 0 1 1 27,9" />
      </circle>
    </svg>
  );
}
import { useParams } from "react-router-dom";
import { useState, useRef, useEffect, useCallback } from "react";
import { getThreads, saveThreads, createThread, addMessageToThread, type ChatMessage } from "../../lib/chat-store";
import { getAuthHeaders } from "../../lib/api-client";
import { LogoMark } from "../logo";

// ── Markdown renderer (same as home) ─────────────────────────────────────────
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (!listBuffer.length) return;
    nodes.push(
      <ul key={key} className="my-1.5 space-y-1 pl-1">
        {listBuffer.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-slate-200">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500"/>
            <span className="leading-7">{inlineFormat(item)}</span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) { flushList(`l${i}`); nodes.push(<div key={i} className="h-2"/>); return; }
    if (/^\|[-| :]+\|$/.test(trimmed)) return;
    if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
      const cells = trimmed.split("|").map(c => c.trim()).filter(Boolean);
      listBuffer.push(cells.join("  ·  "));
      return;
    }
    if (/^#{1,3}\s/.test(trimmed)) {
      flushList(`l${i}`);
      const t = trimmed.replace(/^#{1,3}\s/, "");
      nodes.push(<p key={i} className="mt-4 mb-1 text-sm font-semibold text-white">{t}</p>);
      return;
    }
    if (/^---+$/.test(trimmed)) {
      flushList(`l${i}`);
      nodes.push(<hr key={i} className="border-white/[.06] my-3"/>);
      return;
    }
    if (/^[-*•]\s/.test(trimmed)) { listBuffer.push(trimmed.replace(/^[-*•]\s/, "")); return; }
    if (/^\d+\.\s/.test(trimmed)) { listBuffer.push(trimmed.replace(/^\d+\.\s/, "")); return; }
    flushList(`l${i}`);
    nodes.push(<p key={i} className="leading-7 text-slate-200">{inlineFormat(trimmed)}</p>);
  });
  flushList("end");
  return <>{nodes}</>;
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((p, i) => {
    if (/^\*\*/.test(p) || /^__/.test(p))
      return <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
    return p.replace(/[*_`|]/g, "");
  });
}

// ── Accent palette (same as home) ─────────────────────────────────────────────
const ACCENTS = [
  { border: "border-l-violet-500/50", dot: "bg-violet-400", userBorder: "border-violet-500/30", userText: "text-violet-200" },
  { border: "border-l-blue-500/50",   dot: "bg-blue-400",   userBorder: "border-blue-500/30",   userText: "text-blue-200"   },
  { border: "border-l-emerald-500/50",dot: "bg-emerald-400",userBorder: "border-emerald-500/30",userText: "text-emerald-200"},
  { border: "border-l-rose-500/50",   dot: "bg-rose-400",   userBorder: "border-rose-500/30",   userText: "text-rose-200"   },
  { border: "border-l-amber-500/50",  dot: "bg-amber-400",  userBorder: "border-amber-500/30",  userText: "text-amber-200"  },
];

// ── Quick prompt palette ───────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  {
    icon: BellDot,
    label: "Daily brief",
    description: "Everything that happened",
    prompt: "Give me a full daily brief: check my notifications, list my open tasks by priority, highlight any overdue items, and summarise recent CRM activity. Then tell me exactly what I should focus on right now and suggest 3 specific actions.",
  },
  {
    icon: TrendingUp,
    label: "Deals needing attention",
    description: "CRM pipeline check",
    prompt: "Review all my deals in the CRM. Which ones are stalled, overdue for follow-up, or close to closing? Rank them by urgency and tell me exactly what action to take on each one.",
  },
  {
    icon: Brain,
    label: "Meeting prep",
    description: "Brief on who you're meeting",
    prompt: "Help me prep for my next meeting. Search my CRM for the contact or company I'm meeting with, find any related deals or tasks, and give me a concise brief: key facts, open items, what to ask, and what outcome to aim for.",
  },
  {
    icon: MailCheck,
    label: "Follow-up email",
    description: "Draft after a meeting",
    prompt: "Draft a professional follow-up email for my last meeting. Check my recent tasks and CRM records for context on who I met, what was discussed, and any open action items. Make it concise, warm, and end with a clear next step.",
  },
  {
    icon: ListChecks,
    label: "Weekly focus plan",
    description: "Priorities for this week",
    prompt: "Review all my open tasks and tell me what I should focus on this week. Group them by priority, flag anything overdue, and build me a simple day-by-day action plan for the week. Be specific and opinionated.",
  },
  {
    icon: Zap,
    label: "What needs action today?",
    description: "Urgent items right now",
    prompt: "Scan everything — my tasks, notifications, and CRM — and tell me what genuinely needs my attention today. Only surface real urgent items: overdue tasks, deals at risk, unread important notifications. Give me a ranked list with one action per item.",
  },
] as const;

const EMPTY_SUGGESTIONS = [
  "Summarise my pipeline",
  "What tasks are overdue?",
  "Draft a follow-up email",
  "Analyse my deals this week",
];

export function AskMondaily() {
  const { threadId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (threadId && threadId !== "new") {
      const t = getThreads().find(t => t.id === threadId);
      if (t) return t.messages;
    }
    return [];
  });
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(
    threadId && threadId !== "new" ? threadId : null
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [lastUserMsg, setLastUserMsg] = useState("");
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [streamingMsgIdx, setStreamingMsgIdx] = useState<number | null>(null);
  const [streamedUpTo, setStreamedUpTo] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Thinking steps — cycles through while waiting on a response, purely cosmetic
  const THINKING_STEPS = ["Searching workspace", "Reading related records", "Checking recent activity", "Composing answer"];
  const [thinkingStep, setThinkingStep] = useState(0);
  useEffect(() => {
    if (!loading) { setThinkingStep(0); return; }
    const id = setInterval(() => setThinkingStep(s => Math.min(s + 1, THINKING_STEPS.length - 1)), 850);
    return () => clearInterval(id);
  }, [loading]);

  // Close picker on outside click
  useEffect(() => {
    if (!promptPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPromptPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [promptPickerOpen]);

  // Reload when route thread changes
  useEffect(() => {
    if (threadId && threadId !== "new") {
      const t = getThreads().find(t => t.id === threadId);
      if (t) { setMessages(t.messages); setCurrentThreadId(t.id); }
      else   { setMessages([]); setCurrentThreadId(null); }
    } else {
      setMessages([]); setCurrentThreadId(null);
    }
    setSuggestions([]);
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const startStreaming = (msgIdx: number, fullText: string) => {
    if (streamRef.current) clearInterval(streamRef.current);
    setStreamingMsgIdx(msgIdx);
    setStreamedUpTo(0);
    let pos = 0;
    streamRef.current = setInterval(() => {
      pos += Math.floor(Math.random() * 5) + 3;
      if (pos >= fullText.length) {
        pos = fullText.length;
        clearInterval(streamRef.current!);
        streamRef.current = null;
        setStreamingMsgIdx(null);
      }
      setStreamedUpTo(pos);
    }, 18);
  };

  const doSend = async (text: string) => {
    if (!text || loading) return;
    let tid = currentThreadId;
    if (!tid) {
      const thread = createThread(text);
      saveThreads([thread, ...getThreads()]);
      tid = thread.id;
      setCurrentThreadId(tid);
    }
    setLastUserMsg(text);
    const userMsg: ChatMessage = { role: "user", content: text };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    addMessageToThread(tid, userMsg);
    setLoading(true);
    setSuggestions([]);
    try {
      let model = "auto";
      let web_search = false;
      try { const s = JSON.parse(localStorage.getItem("mondaily_ask_settings") || "{}"); model = s.model ?? "auto"; web_search = s.webSearch === "allow"; } catch {}
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiUrl}/api/v1/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: text, model, web_search })
      });
      const data = await res.json() as { reply?: string; suggestions?: string[] };
      const reply = data.reply || "No response.";
      const aiMsg: ChatMessage = { role: "assistant", content: reply };
      const finalMsgs = [...withUser, aiMsg];
      setMessages(finalMsgs);
      addMessageToThread(tid, aiMsg);
      startStreaming(finalMsgs.length - 1, reply);
      if (data.suggestions?.length) setSuggestions(data.suggestions);
    } catch (err: any) {
      const errMsg: ChatMessage = { role: "assistant", content: `Error: ${err.message}` };
      setMessages([...withUser, errMsg]);
      addMessageToThread(tid, errMsg);
    }
    setLoading(false);
  };

  const send = () => { const t = input.trim(); if (t) { setInput(""); doSend(t); } };

  const sendSuggestion = useCallback((text: string) => {
    setPromptPickerOpen(false);
    setSuggestions([]);
    doSend(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentThreadId, loading]);

  const regenerate = () => {
    if (!lastUserMsg || loading) return;
    setMessages(prev => prev.slice(0, -1));
    doSend(lastUserMsg);
  };

  const copyMessage = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const downloadChat = () => {
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
      const headers = await getAuthHeaders();
      const apiUrl = import.meta.env.VITE_API_URL || "";
      await fetch(`${apiUrl}/api/v1/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: userMsg, response: aiMsg, rating })
      });
    } catch {}
  };

  const isChatting = messages.length > 0;

  return (
    <div className="flex h-full flex-col">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-[#e5e7eb] dark:border-white/[.06]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3 text-[#111827] dark:text-white">
            <LogoSymbol size={28} thinking={loading} />
            <div>
              <h1 className="text-sm font-semibold text-[#111827] dark:text-white tracking-wide">Ask Mondaily</h1>
              <p className="text-[11px] text-[#9ca3af] dark:text-slate-500">{loading ? "Thinking…" : "Your AI business assistant"}</p>
            </div>
          </div>
          {isChatting && (
            <div className="flex items-center gap-3">
              <button onClick={downloadChat} className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#111827] dark:text-slate-500 dark:hover:text-white transition-colors">
                <Download size={12}/> Export
              </button>
              <button onClick={() => { setMessages([]); setCurrentThreadId(null); setSuggestions([]); }}
                className="text-xs text-[#6b7280] hover:text-[#111827] dark:text-slate-500 dark:hover:text-white transition-colors">
                New chat
              </button>
            </div>
          )}
        </div>

        {/* Context strip — what the AI has access to */}
        <div className="flex items-center gap-2 px-6 pb-3 overflow-x-auto">
          <span className="flex items-center gap-1 text-[11px] text-[#9ca3af] dark:text-slate-600 shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-50 animate-ping"/>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500"/>
            </span>
            Connected to your workspace graph
          </span>
          {["Tasks", "Deals", "People", "Notes", "Emails"].map(label => (
            <span key={label} className="shrink-0 rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-0.5 text-[10px] font-medium text-[#6b7280] dark:border-white/[.07] dark:bg-white/[.03] dark:text-slate-500">
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Message area ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6" style={{ scrollbarWidth: "none" }}>

        {/* Empty state */}
        {!isChatting && (
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-md text-center">
              <div className="mx-auto mb-5 flex items-center justify-center text-indigo-500 dark:text-white/80">
                <LogoSymbol size={52} />
              </div>
              <p className="text-sm font-medium text-[#111827] dark:text-white mb-1">How can I help you today?</p>
              <p className="text-xs text-[#9ca3af] dark:text-slate-500 mb-6">Ask about your pipeline, contacts, tasks, or anything business-related.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {EMPTY_SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => sendSuggestion(s)} className="key-button px-3 py-1.5 text-xs">{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        {isChatting && (() => {
          let aiIdx = -1;
          return messages.map((m, i) => {
            if (m.role === "assistant") aiIdx++;
            const accent = ACCENTS[aiIdx % ACCENTS.length] ?? ACCENTS[0]!;
            const isStreaming = streamingMsgIdx === i;
            const displayText = isStreaming ? m.content.slice(0, streamedUpTo) : m.content;
            return (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-3 items-start"}>
                {m.role === "assistant" && (
                  <div className="mt-0.5 shrink-0 text-indigo-400">
                    <LogoMark size={16}/>
                  </div>
                )}

                {m.role === "user" ? (
                  <div className={`max-w-[72%] rounded-2xl rounded-tr-sm border bg-transparent px-4 py-2.5 text-sm leading-relaxed ${accent.userBorder} ${accent.userText}`}>
                    {m.content}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className={`border-l-2 pl-4 text-sm space-y-0.5 ${accent.border}`}>
                      {renderMarkdown(displayText)}
                      {isStreaming && <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60"/>}
                    </div>
                    {/* Action bar */}
                    {!isStreaming && i > 0 && (
                      <div className="flex items-center gap-0.5 mt-2 pl-4">
                        <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, 1, i)}
                          className={`rounded-md p-1.5 transition-colors ${feedbackGiven[i] === 1 ? "text-emerald-400" : "text-slate-700 hover:text-emerald-400"}`}
                          title="Good response"><ThumbsUp size={12}/></button>
                        <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, -1, i)}
                          className={`rounded-md p-1.5 transition-colors ${feedbackGiven[i] === -1 ? "text-indigo-400" : "text-zinc-300 hover:text-indigo-400 dark:text-slate-700 dark:hover:text-indigo-400"}`}
                          title="Bad response"><ThumbsDown size={12}/></button>
                        {feedbackGiven[i] && <span className="text-[11px] text-[#9ca3af] dark:text-slate-600 ml-1">{feedbackGiven[i] === 1 ? "Thanks!" : "Got it"}</span>}
                        <button onClick={() => copyMessage(m.content, i)}
                          className={`rounded-md p-1.5 ml-1 transition-colors ${copiedIdx === i ? "text-emerald-400" : "text-zinc-300 hover:text-zinc-500 dark:text-slate-700 dark:hover:text-slate-400"}`}
                          title="Copy">
                          {copiedIdx === i ? <Check size={12}/> : <Copy size={12}/>}
                        </button>
                        {i === messages.length - 1 && !loading && (
                          <button onClick={regenerate} className="rounded-md p-1.5 text-zinc-300 hover:text-zinc-500 dark:text-slate-700 dark:hover:text-slate-400 transition-colors" title="Regenerate"><RefreshCw size={12}/></button>
                        )}
                      </div>
                    )}
                    {/* Static follow-up actions — shown under the most recent finished AI response */}
                    {!isStreaming && !loading && i === messages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5 pl-4">
                        {["Create a task from this", "Show related records", "Draft email", "Explain why"].map(action => (
                          <button key={action} onClick={() => sendSuggestion(action)}
                            className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors dark:border-indigo-400/20 dark:bg-indigo-500/[.06] dark:text-indigo-300 dark:hover:bg-indigo-500/[.12] dark:hover:border-indigo-400/30">
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          });
        })()}

        {/* Thinking */}
        {loading && (
          <div className="flex items-center gap-3 pl-1 text-[#6b7280] dark:text-slate-400">
            <LogoSymbol size={36} thinking />
            <span className="text-sm italic tracking-wide">{THINKING_STEPS[thinkingStep]}…</span>
          </div>
        )}

        {/* Follow-up suggestions */}
        {!loading && streamingMsgIdx === null && suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5 pl-5">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => sendSuggestion(s)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-left text-sm text-[#374151] hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-colors dark:border-white/[.07] dark:bg-white/[.03] dark:text-slate-300 dark:hover:bg-white/[.06] dark:hover:border-white/[.12]">
                <span>{s}</span>
                <CornerDownLeft size={12} className="shrink-0 text-[#9ca3af] group-hover:text-[#52525b] dark:text-slate-600 dark:group-hover:text-slate-400 transition-colors"/>
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* ── Input bar ── */}
      <div className="shrink-0 border-t border-white/[.06] px-6 py-4">
        <div className="relative mx-auto max-w-3xl" ref={pickerRef}>

          {/* Quick prompts picker */}
          {promptPickerOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-full rounded-xl border border-[#e5e7eb] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.10)] overflow-hidden z-50 dark:border-white/[.08] dark:bg-[#13151a] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              <div className="px-4 py-2.5 border-b border-[#eef2f7] dark:border-white/[.06]">
                <p className="text-[10px] font-semibold text-[#9ca3af] dark:text-slate-600 uppercase tracking-widest">Quick prompts</p>
              </div>
              <div className="p-1.5 grid grid-cols-1 gap-px">
                {QUICK_PROMPTS.map(({ icon: Icon, label, description, prompt }) => (
                  <button key={label} onClick={() => sendSuggestion(prompt)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/[.05] transition-colors group">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 group-hover:bg-indigo-100 dark:bg-indigo-500/10 dark:group-hover:bg-indigo-500/20 transition-colors">
                      <Icon size={13} className="text-indigo-600 dark:text-indigo-400"/>
                    </span>
                    <span>
                      <span className="block text-sm text-[#111827] group-hover:text-indigo-700 dark:text-slate-200 dark:group-hover:text-white transition-colors">{label}</span>
                      <span className="block text-[11px] text-[#9ca3af] dark:text-slate-600">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus-within:border-[#c7d2fe] focus-within:ring-2 focus-within:ring-indigo-500/15 transition-all dark:border-white/[.08] dark:bg-white/[.03] dark:shadow-none dark:focus-within:border-white/[.15] dark:focus-within:bg-white/[.04] dark:focus-within:ring-0">
            <button onClick={() => setPromptPickerOpen(o => !o)} title="Quick prompts"
              className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${promptPickerOpen ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400" : "text-[#9ca3af] hover:text-[#52525b] hover:bg-[#f4f4f5] dark:text-slate-600 dark:hover:text-slate-300 dark:hover:bg-white/[.05]"}`}>
              <Zap size={14}/>
            </button>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={isChatting ? "Continue the conversation…" : "Ask Mondaily AI anything…"}
              className="flex-1 bg-transparent text-sm text-[#111827] placeholder-[#9ca3af] outline-none dark:text-white dark:placeholder-slate-600"/>
            {isChatting && (
              <button onClick={() => { setMessages([]); setCurrentThreadId(null); setSuggestions([]); }}
                className="shrink-0 text-xs text-[#9ca3af] hover:text-[#52525b] dark:text-slate-600 dark:hover:text-slate-400 transition-colors mr-1">
                Clear
              </button>
            )}
            <button onClick={send} disabled={loading || !input.trim()}
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150 ${input.trim() && !loading ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500 shadow-lg shadow-indigo-900/10 dark:shadow-indigo-900/30" : "bg-[#f4f4f5] text-[#9ca3af] dark:bg-white/[.04] dark:text-slate-600"}`}>
              {loading ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-slate-700">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
