import { Send, Loader2, ThumbsUp, ThumbsDown, Copy, Download, RefreshCw, Check, Zap, CornerDownLeft, BellDot, TrendingUp, Brain, MailCheck, ListChecks, Sparkles } from "lucide-react";

function LogoSymbol({ size = 28, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="6.5" fill="#8a857d" />
      <circle cx="16" cy="16" r="13" stroke="#8a857d" strokeWidth="1.4" opacity="0.35" />
      <circle cx="0" cy="0" r="2.4" fill="#8a857d" opacity="0.85">
        <animateMotion dur={thinking ? "1.2s" : "6s"} repeatCount="indefinite" path="M27,9 A13,13 0 1 1 5,23 A13,13 0 1 1 27,9" />
      </circle>
    </svg>
  );
}
import { useParams } from "react-router-dom";
import { useState, useRef, useEffect, useCallback } from "react";
import { getAuthHeaders } from "../../lib/api-client";
import { LogoMark } from "../logo";
import { useAskEngine } from "./use-ask-engine";
import { GRAPH_REASONING_STEPS, EvidenceStrip, SourceCard } from "./ask-shared";

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
          <li key={i} className="flex gap-2.5" style={{ color: "var(--text-secondary)" }}>
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-stone-500"/>
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
      nodes.push(<p key={i} className="mt-4 mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t}</p>);
      return;
    }
    if (/^---+$/.test(trimmed)) {
      flushList(`l${i}`);
      nodes.push(<hr key={i} className="my-3" style={{ borderColor: "var(--border-soft)" }}/>);
      return;
    }
    if (/^[-*•]\s/.test(trimmed)) { listBuffer.push(trimmed.replace(/^[-*•]\s/, "")); return; }
    if (/^\d+\.\s/.test(trimmed)) { listBuffer.push(trimmed.replace(/^\d+\.\s/, "")); return; }
    flushList(`l${i}`);
    nodes.push(<p key={i} className="leading-7" style={{ color: "var(--text-secondary)" }}>{inlineFormat(trimmed)}</p>);
  });
  flushList("end");
  return <>{nodes}</>;
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((p, i) => {
    if (/^\*\*/.test(p) || /^__/.test(p))
      return <strong key={i} className="font-semibold" style={{ color: "var(--text-primary)" }}>{p.slice(2, -2)}</strong>;
    return p.replace(/[*_`|]/g, "");
  });
}

// ── Accent palette (same as home) ─────────────────────────────────────────────
const ACCENTS = [
  { border: "border-l-violet-500/50", dot: "bg-stone-400", userBorder: "border-stone-500/30", userText: "text-stone-200" },
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
    description: "Everything that happened across the graph",
    prompt: "Give me a full daily brief: check my notifications, list my open tasks by priority, highlight any overdue items, and summarise recent activity across the workspace graph. Then tell me exactly what I should focus on right now and suggest 3 specific actions.",
  },
  {
    icon: TrendingUp,
    label: "What needs attention?",
    description: "Stalled deals, assets, relationships",
    prompt: "Review the workspace graph. Which deals, assets, or relationships are stalled, overdue for follow-up, or close to closing? Rank them by urgency and tell me exactly what action to take on each one.",
  },
  {
    icon: Brain,
    label: "Meeting prep",
    description: "Brief on who you're meeting",
    prompt: "Help me prep for my next meeting. Search the workspace graph for the contact or company I'm meeting with, find any related deals, finance, or tasks, and give me a concise brief: key facts, open items, what to ask, and what outcome to aim for.",
  },
  {
    icon: MailCheck,
    label: "Follow-up message",
    description: "Draft after a meeting",
    prompt: "Draft a professional follow-up message for my last meeting. Check my recent tasks and the workspace graph for context on who I met, what was discussed, and any open action items. Make it concise, warm, and end with a clear next step.",
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
    prompt: "Scan everything across the workspace graph — tasks, notifications, finance, relationships — and tell me what genuinely needs my attention today. Only surface real urgent items. Give me a ranked list with one action per item.",
  },
] as const;

const EMPTY_SUGGESTION_GROUPS = [
  "Brief me on today",
  "What changed in the workspace graph?",
  "What decisions are waiting?",
  "What assets need review?",
  "What finance risks exist?",
  "What workflows are blocked?",
  "Summarize this week",
  "Find stale relationships",
  "Create tasks from recent signals",
];

export function AskMondaily() {
  const { threadId } = useParams();
  const [input, setInput] = useState("");
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [streamingMsgIdx, setStreamingMsgIdx] = useState<number | null>(null);
  const [streamedUpTo, setStreamedUpTo] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // The answer now streams token-by-token for real (SSE) — see use-ask-engine.
  // The old client-side typewriter is disabled so tokens aren't animated twice.
  const startStreaming = (_msgIdx: number, _fullText: string) => { /* real streaming handles display */ };

  // Same request pipeline as every other Ask surface (Home, right-side
  // drawer): same endpoint, thread_id/history handling, agent inference,
  // and real sources. This page's context is general workspace scope
  // unless a thread is already open.
  const { messages, setMessages, currentThreadId, loading, suggestions, setSuggestions, messageMeta, tokenCount, streamStatus, doSend, loadThread, buildChipText, clear } =
    useAskEngine({
      initialThreadId: threadId && threadId !== "new" ? threadId : null,
      context: { scope_label: "the Ask Mondaily page (general workspace)" },
      onAssistantMessage: startStreaming,
    });

  // Reasoning steps — cycles through while waiting on a response, honest UI
  // state (not a fake animation): each label is a real phase of the request.
  const [thinkingStep, setThinkingStep] = useState(0);
  useEffect(() => {
    if (!loading) { setThinkingStep(0); return; }
    const id = setInterval(() => setThinkingStep(s => Math.min(s + 1, GRAPH_REASONING_STEPS.length - 1)), 850);
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

  // Reload when route thread changes — same underlying chat-store thread
  // a Home chat may have created, so continuing it here picks up exactly
  // where it left off.
  useEffect(() => {
    loadThread(threadId && threadId !== "new" ? threadId : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = () => { const t = input.trim(); if (t) { setInput(""); doSend(t); } };

  const sendSuggestion = useCallback((text: string) => {
    setPromptPickerOpen(false);
    setSuggestions([]);
    doSend(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSend]);

  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
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
    <div className="ask-frame flex h-full flex-col">

      {/* ── Header ── */}
      <div className="ask-header shrink-0">
        <div className="flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3 text-[#111827] dark:text-white">
            <LogoSymbol size={24} thinking={loading} />
            <h1 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[#111827] dark:text-white">
              Ask
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-stone-400 opacity-40 animate-ping"/>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-stone-500"/>
              </span>
              {loading && (
                <span className="text-[11px] font-normal tracking-normal text-[#9ca3af] dark:text-stone-500">
                  {streamStatus ? streamStatus : tokenCount > 0 ? `${tokenCount} tokens` : `${GRAPH_REASONING_STEPS[thinkingStep]}…`}
                </span>
              )}
            </h1>
          </div>
          {isChatting && (
            <div className="flex items-center gap-3">
              <button onClick={downloadChat} className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#111827] dark:text-stone-500 dark:hover:text-white transition-colors">
                <Download size={12}/> Export
              </button>
              <button onClick={clear}
                className="text-xs text-[#6b7280] hover:text-[#111827] dark:text-stone-500 dark:hover:text-white transition-colors">
                New chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Message area ── */}
      <div className="ask-message-scroll flex-1 overflow-y-auto px-6 py-6 space-y-6" style={{ scrollbarWidth: "none" }}>

        {/* Empty state — command center, not a generic chatbot greeting */}
        {!isChatting && (
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-lg text-center">
              <div className="mx-auto mb-5 flex items-center justify-center text-stone-500 dark:text-white/80">
                <LogoSymbol size={52} />
              </div>
              <p className="text-sm font-medium text-[#111827] dark:text-white mb-1">What do you want to know about the workspace graph?</p>
              <p className="text-xs text-[#9ca3af] dark:text-stone-500 mb-6">Tasks, finance, relationships, notes, workflows — one connected graph, this workspace only.</p>
              <div className="mx-auto flex max-w-md flex-col gap-0">
                {EMPTY_SUGGESTION_GROUPS.map(s => (
                  <button key={s} onClick={() => sendSuggestion(s)} className="ask-suggestion-row text-xs">{s}</button>
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
            const meta = messageMeta[i];
            const AgentIcon = meta?.agent.icon;
            return (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-3 items-start"}>
                {m.role === "assistant" && (
                  <div className="mt-0.5 shrink-0 text-stone-400">
                    <LogoMark size={16}/>
                  </div>
                )}

                {m.role === "user" ? (
                  <div className="ask-user-bubble max-w-[72%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
                    {m.content}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="ask-assistant-line pl-4 text-sm space-y-0.5">
                      {renderMarkdown(displayText)}
                      {isStreaming && <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle opacity-60"/>}
                    </div>

                    {/* Agent handoff + evidence strip */}
                    {!isStreaming && meta && AgentIcon && (
                      <div className="flex flex-wrap items-center gap-2 mt-2 pl-4">
                        <span className="agent-badge" data-status="draft_ready">
                          <AgentIcon size={10}/>
                          {meta.agent.name}
                        </span>
                        <EvidenceStrip sources={meta.sources}/>
                      </div>
                    )}

                    {/* Source cards — honest empty state when backend returns none */}
                    {!isStreaming && meta && meta.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 pl-4">
                        {meta.sources.map((s, si) => <SourceCard key={si} source={s}/>)}
                      </div>
                    )}

                    {/* Action bar */}
                    {!isStreaming && i > 0 && (
                      <div className="flex items-center gap-0.5 mt-2 pl-4">
                        <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, 1, i)}
                          className={`rounded-md p-1.5 transition-colors ${feedbackGiven[i] === 1 ? "text-emerald-400" : "text-stone-700 hover:text-emerald-400"}`}
                          title="Good response"><ThumbsUp size={12}/></button>
                        <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, -1, i)}
                          className={`rounded-md p-1.5 transition-colors ${feedbackGiven[i] === -1 ? "text-stone-400" : "text-stone-300 hover:text-stone-400 dark:text-stone-700 dark:hover:text-stone-400"}`}
                          title="Bad response"><ThumbsDown size={12}/></button>
                        {feedbackGiven[i] && <span className="text-[11px] text-[#9ca3af] dark:text-stone-600 ml-1">{feedbackGiven[i] === 1 ? "Thanks!" : "Got it"}</span>}
                        <button onClick={() => copyMessage(m.content, i)}
                          className={`rounded-md p-1.5 ml-1 transition-colors ${copiedIdx === i ? "text-emerald-400" : "text-stone-300 hover:text-stone-500 dark:text-stone-700 dark:hover:text-stone-400"}`}
                          title="Copy">
                          {copiedIdx === i ? <Check size={12}/> : <Copy size={12}/>}
                        </button>
                        {i === messages.length - 1 && !loading && (
                          <button onClick={regenerate} className="rounded-md p-1.5 text-stone-300 hover:text-stone-500 dark:text-stone-700 dark:hover:text-stone-400 transition-colors" title="Regenerate"><RefreshCw size={12}/></button>
                        )}
                      </div>
                    )}

                    {/* Actions — only the ones with a real tool behind them are clickable.
                        Each chip embeds the actual previous question + answer explicitly
                        (not just "this") so the request is unambiguous even on its own,
                        in addition to the full history now sent with every request. */}
                    {!isStreaming && !loading && i === messages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5 pl-4">
                        <button onClick={() => sendSuggestion(buildChipText("task", i))} className="btn-ai">
                          <Sparkles size={11}/> Create task from this
                        </button>
                        <button onClick={() => sendSuggestion(buildChipText("draft", i))} className="btn-ai">
                          <Sparkles size={11}/> Draft message
                        </button>
                        <button onClick={() => sendSuggestion(buildChipText("related", i))} className="btn-suggested">
                          Show related objects
                        </button>
                        <button onClick={() => sendSuggestion(buildChipText("explain", i))} className="btn-suggested">
                          Explain reasoning
                        </button>
                        <button onClick={() => sendSuggestion(buildChipText("decision", i))} className="btn-suggested">
                          Add to decision queue
                        </button>
                        <button onClick={() => sendSuggestion(buildChipText("workflow", i))} className="btn-suggested">
                          Draft workflow
                        </button>
                        <span title="Coming soon — no report-creation tool exists yet"
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium cursor-not-allowed opacity-50"
                          style={{ border: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
                          Create report
                        </span>
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
          <div className="flex items-center gap-3 pl-1 text-[#6b7280] dark:text-stone-400">
            <LogoSymbol size={36} thinking />
            <span className="text-sm italic tracking-wide">{GRAPH_REASONING_STEPS[thinkingStep]}…</span>
          </div>
        )}

        {/* Follow-up suggestions */}
        {!loading && streamingMsgIdx === null && suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5 pl-5">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => sendSuggestion(s)}
                className="ask-suggestion-row group text-sm">
                <span>{s}</span>
                <CornerDownLeft size={12} className="shrink-0 text-[#9ca3af] group-hover:text-[#52525b] dark:text-stone-600 dark:group-hover:text-stone-400 transition-colors"/>
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* ── Input bar ── */}
      <div className="ask-input-shell shrink-0 px-6 py-4">
        <div className="relative mx-auto max-w-3xl" ref={pickerRef}>

          {/* Quick prompts picker */}
          {promptPickerOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-full rounded-xl border border-[#e5e7eb] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.10)] overflow-hidden z-50 dark:border-white/[.08] dark:bg-[#13151a] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              <div className="px-4 py-2.5 border-b border-[#eef2f7] dark:border-white/[.06]">
                <p className="text-[10px] font-semibold text-[#9ca3af] dark:text-stone-600 uppercase tracking-widest">Quick prompts</p>
              </div>
              <div className="p-1.5 grid grid-cols-1 gap-px">
                {QUICK_PROMPTS.map(({ icon: Icon, label, description, prompt }) => (
                  <button key={label} onClick={() => sendSuggestion(prompt)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/[.05] transition-colors group">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-stone-50 group-hover:bg-stone-100 dark:bg-stone-500/10 dark:group-hover:bg-stone-500/20 transition-colors">
                      <Icon size={13} className="text-stone-600 dark:text-stone-400"/>
                    </span>
                    <span>
                      <span className="block text-sm text-[#111827] group-hover:text-stone-700 dark:text-stone-200 dark:group-hover:text-white transition-colors">{label}</span>
                      <span className="block text-[11px] text-[#9ca3af] dark:text-stone-600">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="ask-input flex items-center gap-2 rounded-2xl px-4 py-3.5 transition-all">
            <button onClick={() => setPromptPickerOpen(o => !o)} title="Quick prompts"
              className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${promptPickerOpen ? "bg-stone-100 text-stone-600 dark:bg-stone-500/20 dark:text-stone-400" : "text-[#9ca3af] hover:text-[#52525b] hover:bg-[#f4f4f5] dark:text-stone-600 dark:hover:text-stone-300 dark:hover:bg-white/[.05]"}`}>
              <Zap size={14}/>
            </button>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={isChatting ? "Continue the conversation…" : "Ask the workspace graph anything…"}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400" style={{ color: "var(--text-primary)" }}/>
            {isChatting && (
              <button onClick={clear}
                className="shrink-0 text-xs text-[#9ca3af] hover:text-[#52525b] dark:text-stone-600 dark:hover:text-stone-400 transition-colors mr-1">
                Clear
              </button>
            )}
            <button onClick={send} disabled={loading || !input.trim()}
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150 ${input.trim() && !loading ? "bg-stone-600 text-white hover:bg-stone-700 dark:hover:bg-stone-500 shadow-lg shadow-stone-900/10 dark:shadow-stone-900/30" : "bg-[#f4f4f5] text-[#9ca3af] dark:bg-white/[.04] dark:text-stone-600"}`}>
              {loading ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-stone-700">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
