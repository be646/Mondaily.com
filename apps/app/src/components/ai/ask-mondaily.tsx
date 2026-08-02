import { Send, Loader2, ThumbsUp, ThumbsDown, Copy, Download, RefreshCw, Check, Zap, CornerDownLeft, BellDot, TrendingUp, Brain, MailCheck, ListChecks, Mail, Network, Inbox, GitBranch, BarChart2, Square, Mic } from "lucide-react";

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
import { useParams, useLocation } from "react-router-dom";
import { askModeForPath } from "../../lib/ask-mode";
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { apiFetch, getAuthHeaders } from "../../lib/api-client";
import { LogoMark } from "../logo";
import { useAskEngine } from "./use-ask-engine";
import { GRAPH_REASONING_STEPS, EvidenceStrip, SourceList, TokenLedger, Markdown, sourcesToLinks } from "./ask-shared";
import { useAttachments, AttachPicker, AttachChips, AttachButton } from "./use-attachments";
import { useVoiceDictation } from "./use-voice";
import { useWorkspaceSuggestions } from "../../hooks/useWorkspaceSuggestions";
import { useLanguage } from "../../hooks/useLanguage";


// ── Accent palette (same as home) ─────────────────────────────────────────────
const ACCENTS = [
  { border: "border-l-[#717784]/50", dot: "bg-stone-400", userBorder: "border-stone-500/30", userText: "text-[var(--text-primary)]" },
  { border: "border-l-[#717784]/50",   dot: "bg-[#717784]",   userBorder: "border-[#717784]/30",   userText: "text-[#717784]"   },
  { border: "border-l-[#2f9e6b]/50",dot: "bg-[#2f9e6b]",userBorder: "border-[#2f9e6b]/30",userText: "text-[#2f9e6b]"},
  { border: "border-l-[#d1524a]/50",   dot: "bg-[#d1524a]",   userBorder: "border-[#d1524a]/30",   userText: "text-[#d1524a]"   },
  { border: "border-l-[#c6892e]/50",  dot: "bg-[#c6892e]",  userBorder: "border-[#c6892e]/30",  userText: "text-[#c6892e]"  },
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
  const location = useLocation();
  const askMode = askModeForPath(location.pathname);
  // Industry-aware starter prompts from the workspace profile, followed by the general defaults
  // (deduped). Falls back to the generic defaults while loading / when the profile has no signal.
  const { data: wsSuggestions } = useWorkspaceSuggestions();
  const lang = useLanguage();
  const emptySuggestions = [...new Set([...(wsSuggestions?.ask ?? []), ...EMPTY_SUGGESTION_GROUPS])].slice(0, 9);
  const [input, setInput] = useState("");
  const voice = useVoiceDictation(setInput);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 1 | -1>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [streamingMsgIdx, setStreamingMsgIdx] = useState<number | null>(null);
  const [streamedUpTo, setStreamedUpTo] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = inputRef.current; if (el && input === "") el.style.height = "auto"; }, [input]);
  const pickerRef = useRef<HTMLDivElement>(null);

  // The answer now streams token-by-token for real (SSE) — see use-ask-engine.
  // The old client-side typewriter is disabled so tokens aren't animated twice.
  const startStreaming = (_msgIdx: number, _fullText: string) => { /* real streaming handles display */ };

  // Same request pipeline as every other Ask surface (Home, right-side
  // drawer): same endpoint, thread_id/history handling, agent inference,
  // and real sources. This page's context is general workspace scope
  // unless a thread is already open.
  const attach = useAttachments();
  const { messages, setMessages, currentThreadId, loading, suggestions, setSuggestions, messageMeta, tokenCount, streamStatus, doSend, loadThread, buildChipText, clear, stop } =
    useAskEngine({
      initialThreadId: threadId && threadId !== "new" ? threadId : null,
      context: { scope_label: "the Ask Mondaily page (general workspace)", ...attach.attachContext },
      onAssistantMessage: startStreaming,
    });

  // One-shot: a prompt handed in via navigation state (e.g. the ⌘K command bar's
  // "Ask AI" passthrough) is sent once on mount, then cleared from history state so
  // a refresh or back-nav never re-fires it.
  const initialPromptFired = useRef(false);
  useEffect(() => {
    const askPrompt = (location.state as { askPrompt?: string } | null)?.askPrompt?.trim();
    if (!askPrompt || initialPromptFired.current) return;
    initialPromptFired.current = true;
    window.history.replaceState({ ...window.history.state, usr: null }, "");
    doSend(askPrompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reasoning steps — cycles through while waiting on a response, honest UI
  // state (not a fake animation): each label is a real phase of the request.
  const [thinkingStep, setThinkingStep] = useState(0);
  useEffect(() => {
    if (!loading) { setThinkingStep(0); return; }
    const id = setInterval(() => setThinkingStep(s => Math.min(s + 1, GRAPH_REASONING_STEPS.length - 1)), 850);
    return () => clearInterval(id);
  }, [loading]);

  // Elapsed "time spent thinking" — a clean ticking counter while a reply is
  // being generated (rolls from seconds into m:ss).
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  useEffect(() => {
    if (!loading) { setThinkingSeconds(0); return; }
    setThinkingSeconds(0);
    const id = setInterval(() => setThinkingSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);
  const fmtElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

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

  // Follow the bottom inside the message box only (never the page) — newest text
  // stays at the bottom and older flows up, solid/no shake. Only follows when the
  // user is already near the bottom, so manual scroll-up isn't fought.
  // Stick-to-bottom lock (same model as Home + Quick-Ask). stickRef stays true
  // while the user is parked near the bottom; scrolling up disengages the follow,
  // scrolling back re-engages. Pin runs pre-paint (useLayoutEffect) and only while
  // a turn is active — solid, no jitter, no tug when reading back.
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  const onMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const top = el.scrollTop;
    // Direction-aware: any upward scroll releases the follow (no tug); returning
    // to the bottom re-engages. The programmatic pin only moves down.
    if (top < lastTopRef.current - 1) stickRef.current = false;
    if (el.scrollHeight - top - el.clientHeight < 24) stickRef.current = true;
    lastTopRef.current = top;
  }, []);
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    // Pin whenever stuck — including the final frame when the footer/cards/pills
    // mount — so late content never shoves the answer (no end-of-stream jump).
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading, streamedUpTo, streamingMsgIdx, messageMeta]);

  const send = () => {
    const t = input.trim();
    if (!t && attach.attachments.length === 0) return;
    setInput(""); doSend(t || "Use the attached items.");
    if (attach.attachments.length) attach.clear();
  };

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
      await apiFetch(`${apiUrl}/api/v1/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: userMsg, response: aiMsg, rating })
      });
    } catch {}
  };

  const isChatting = messages.length > 0;

  return (
    // One accent family — the old inline --section-hue:40 (cyan) override is gone; Ask now shares the
    // app accent (theme-spread is 0). Colours use tokens, not hardcoded light hexes.
    <div className="section-soul ask-frame flex h-full flex-col">

      {/* ── Header ── */}
      <div className="ask-header shrink-0">
        <div className="flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3 text-[var(--text-primary)]">
            <LogoSymbol size={24} thinking={loading} />
            <div className="leading-none">
            <div className="soul-kicker mb-1">// MONDAILY · DEEP CONTEXT</div>
            <h1 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-[var(--text-primary)]">
              Ask
              {/* Page-aware mode label — names the scope Ask is grounded in (no logic change). */}
              <span title={askMode.hint} className="rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium tracking-normal" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{askMode.label}</span>
              {/* Honest status dot: static when idle, pings only while a real answer is streaming. */}
              <span className="relative flex h-1.5 w-1.5">
                {loading && <span className="absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping" style={{ background: "var(--section-accent)" }}/>}
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: loading ? "var(--section-accent)" : "var(--text-faint)" }}/>
              </span>
              {loading && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-normal tracking-normal text-[var(--text-muted)]">
                  <span>{streamStatus ? streamStatus : tokenCount > 0 ? `${tokenCount} tokens` : `${GRAPH_REASONING_STEPS[thinkingStep]}…`}</span>
                  <span className="opacity-50">·</span>
                  <span className="tabular-nums">{fmtElapsed(thinkingSeconds)}</span>
                </span>
              )}
            </h1>
            </div>
          </div>
          {isChatting && (
            <div className="flex items-center gap-3">
              <button onClick={downloadChat} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <Download size={12}/> Export
              </button>
              <button onClick={clear}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                New chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Message area ── */}
      <div ref={messagesRef} onScroll={onMessagesScroll} className="ask-message-scroll relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 py-6 space-y-6" style={{ scrollbarWidth: "none", overflowAnchor: "none", scrollBehavior: "auto" }}>

        {/* Empty state — command center, not a generic chatbot greeting */}
        {!isChatting && (
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-lg text-center">
              <div className="mx-auto mb-5 flex items-center justify-center text-[var(--text-muted)] dark:text-[var(--text-secondary)]">
                <LogoSymbol size={52} />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{lang.t("ask.heading")}</p>
              <p className="text-xs text-[var(--text-muted)] mb-6">Tasks, finance, relationships, notes, workflows — one connected graph, this workspace only.</p>
              <div className="chat-suggestion-stack mx-auto max-w-md">
                {emptySuggestions.map(s => (
                  <button key={s} onClick={() => sendSuggestion(s)} className="chat-suggestion-row group">
                    <span className="flex-1 truncate">{s}</span>
                    <CornerDownLeft size={12} className="shrink-0 opacity-45 transition-opacity group-hover:opacity-100"/>
                  </button>
                ))}
              </div>
              {/* Honest capability line — describes the REAL proof model (sources render under replies
                  only when records were actually read; memory disclosure only when memory was used). */}
              <p className="mx-auto mt-5 max-w-sm text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
                Answers are grounded in your workspace — when records are read, they appear as sources under the reply. Nothing is invented to fill a gap.
              </p>
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
                  <div className="mt-0.5 shrink-0 text-[var(--text-secondary)]">
                    <LogoMark size={16}/>
                  </div>
                )}

                {m.role === "user" ? (
                  <div className="ask-user-bubble max-w-[72%] rounded-sm rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
                    {m.content}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="ask-assistant-line min-w-0 break-words whitespace-pre-wrap pl-4 text-sm space-y-0.5">
                      {/* Formatted live even while streaming — the sanitizer hides a half-arrived
                          trailing markdown token so raw symbols never flash before their closer. */}
                      <Markdown text={displayText} streaming={isStreaming} links={sourcesToLinks(meta?.sources)}/>
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
                    {!isStreaming && meta?.usage && (
                      <div className="pl-4"><TokenLedger usage={meta.usage}/></div>
                    )}

                    {/* Source cards — honest empty state when backend returns none */}
                    {!isStreaming && meta && meta.sources.length > 0 && (
                      <div className="mt-2 pl-4">
                        <SourceList sources={meta.sources}/>
                      </div>
                    )}

                    {/* Memory disclosure — part of the source/scope footer, so it renders ONCE per
                        answer directly beneath the sources and before the action buttons. Only shown
                        when source-backed remembered facts were actually injected (honest: absent
                        when none used). */}
                    {/* Degraded = the gateway exhausted retries and this text is the graceful
                        fallback, NOT an answer. Badging it keeps an outage from reading as a reply. */}
                    {!isStreaming && meta?.degraded && (
                      <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10.5px]" style={{ borderColor: "rgb(var(--status-warn-rgb) / 0.35)", color: "var(--status-warn)" }}>
                        AI service unavailable — this is a fallback notice, not an answer. Try again shortly.
                      </div>
                    )}
                    {!isStreaming && meta?.memory && meta.memory.used > 0 && (
                      <div className="mt-1.5 pl-4 text-[11px]" style={{ color: "var(--text-faint)" }}>
                        Used {meta.memory.used} remembered fact{meta.memory.used !== 1 ? "s" : ""}: {meta.memory.refs.map((r) => r.split(":").map((p, i) => i === 1 ? p.slice(0, 8) : p).join(":")).join(", ")}
                      </div>
                    )}

                    {/* Action bar */}
                    {!isStreaming && i > 0 && (
                      <div className="flex items-center gap-0.5 mt-2 pl-4">
                        <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, 1, i)}
                          className={`rounded-md p-1.5 transition-colors ${feedbackGiven[i] === 1 ? "text-[#2f9e6b]" : "text-[var(--text-faint)] hover:text-[#2f9e6b]"}`}
                          title="Good response"><ThumbsUp size={12}/></button>
                        <button onClick={() => sendFeedback(messages[i-1]?.content ?? "", m.content, -1, i)}
                          className={`rounded-md p-1.5 transition-colors ${feedbackGiven[i] === -1 ? "text-[var(--text-secondary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-secondary)] dark:text-[var(--text-faint)] dark:hover:text-[var(--text-secondary)]"}`}
                          title="Bad response"><ThumbsDown size={12}/></button>
                        {feedbackGiven[i] && <span className="text-[11px] text-[var(--text-faint)] ml-1">{feedbackGiven[i] === 1 ? "Thanks!" : "Got it"}</span>}
                        <button onClick={() => copyMessage(m.content, i)}
                          className={`rounded-md p-1.5 ml-1 transition-colors ${copiedIdx === i ? "text-[#2f9e6b]" : "text-[var(--text-secondary)] hover:text-[var(--text-muted)] dark:text-[var(--text-faint)] dark:hover:text-[var(--text-secondary)]"}`}
                          title="Copy">
                          {copiedIdx === i ? <Check size={12}/> : <Copy size={12}/>}
                        </button>
                        {i === messages.length - 1 && !loading && (
                          <button onClick={regenerate} className="rounded-md p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-muted)] dark:text-[var(--text-faint)] dark:hover:text-[var(--text-secondary)] transition-colors" title="Regenerate"><RefreshCw size={12}/></button>
                        )}
                      </div>
                    )}

                    {/* Actions — only the ones with a real tool behind them are clickable.
                        Each chip embeds the actual previous question + answer explicitly
                        (not just "this") so the request is unambiguous even on its own,
                        in addition to the full history now sent with every request. */}
                    {!isStreaming && !loading && i === messages.length - 1 && (
                      <div className="chat-pills-in flex flex-wrap items-center gap-1.5 mt-2.5 pl-4">
                        {([
                          { key: "task" as const, label: "Create task", Icon: ListChecks },
                          { key: "draft" as const, label: "Draft message", Icon: Mail },
                          { key: "related" as const, label: "Show related", Icon: Network },
                          { key: "explain" as const, label: "Explain reasoning", Icon: Brain },
                          { key: "decision" as const, label: "Add to decision queue", Icon: Inbox },
                          { key: "workflow" as const, label: "Draft workflow", Icon: GitBranch },
                          { key: "report" as const, label: "Create report", Icon: BarChart2 },
                        ]).map(({ key, label, Icon }) => (
                          <button key={key} onClick={() => sendSuggestion(buildChipText(key, i))}
                            className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px"
                            style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                            <Icon size={11}/> {label}
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
          <div className="flex items-center gap-3 pl-1 text-[var(--text-muted)]">
            <LogoSymbol size={36} thinking />
            <span className="text-sm italic tracking-wide">{GRAPH_REASONING_STEPS[thinkingStep]}…</span>
          </div>
        )}

        {/* Follow-up suggestions — fade-in sage pills, matching Home */}
        {!loading && streamingMsgIdx === null && suggestions.length > 0 && (
          <div className="chat-pills-in flex flex-wrap gap-2 pl-5">
            {suggestions.map((s, i) => (
              <button key={`${i}-${s}`} onClick={() => sendSuggestion(s)}
                className="group inline-flex items-center gap-1.5 rounded-sm border px-3.5 py-1.5 text-[12.5px] font-medium transition-all hover:-translate-y-px"
                style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                <span>{s}</span>
                <CornerDownLeft size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--accent)" }}/>
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
            <div className="absolute bottom-full left-0 mb-2 w-full rounded-sm border border-[var(--border-soft)] bg-[var(--surface-modal)] shadow-[0_8px_24px_rgba(0,0,0,0.28)] overflow-hidden z-50">
              <div className="px-4 py-2.5 border-b border-[var(--border-soft)]">
                <p className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-widest">Quick prompts</p>
              </div>
              <div className="p-1.5 grid grid-cols-1 gap-px">
                {QUICK_PROMPTS.map(({ icon: Icon, label, description, prompt }) => (
                  <button key={label} onClick={() => sendSuggestion(prompt)}
                    className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-left hover:bg-[var(--surface-hover)] transition-colors group">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-stone-50 group-hover:bg-stone-100 dark:bg-stone-500/10 dark:group-hover:bg-stone-500/20 transition-colors">
                      <Icon size={13} className="text-[var(--text-faint)] dark:text-[var(--text-secondary)]"/>
                    </span>
                    <span>
                      <span className="block text-sm text-[#111827] group-hover:text-[var(--text-faint)] dark:text-[var(--text-primary)] dark:group-hover:text-[var(--text-primary)] transition-colors">{label}</span>
                      <span className="block text-[11px] text-[var(--text-faint)]">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <AttachPicker attach={attach}/>
          <AttachChips attach={attach}/>

          {/* Input */}
          <div className="ask-input flex items-end gap-2 px-4 py-3.5 transition-all">
            <button onClick={() => setPromptPickerOpen(o => !o)} title="Quick prompts"
              className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${promptPickerOpen ? "bg-stone-100 text-[var(--text-faint)] dark:bg-stone-500/20 dark:text-[var(--text-secondary)]" : "text-[#9ca3af] hover:text-[#52525b] hover:bg-[#f4f4f5] dark:text-[var(--text-faint)] dark:hover:text-[var(--text-secondary)] dark:hover:bg-[var(--surface-hover)]"}`}>
              <Zap size={14}/>
            </button>
            <AttachButton attach={attach}/>
            {voice.supported && (
              <button onClick={voice.toggle} title={voice.listening ? "Stop dictation" : "Dictate"}
                className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${voice.listening ? "animate-pulse" : "hover:bg-[#f4f4f5] dark:hover:bg-[var(--surface-hover)]"}`}
                style={{ color: voice.listening ? "var(--accent)" : "var(--text-muted)" }}>
                <Mic size={14}/>
              </button>
            )}
            <textarea ref={inputRef} value={input} rows={1}
              onChange={e => { setInput(e.target.value); if (e.target.value.endsWith("@")) attach.setOpen(true); const el = e.target; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={isChatting ? "Continue the conversation…" : "Ask the workspace graph anything…"}
              className="flex-1 resize-none self-center bg-transparent py-0.5 text-sm leading-6 outline-none placeholder:text-[var(--text-secondary)]"
              style={{ color: "var(--text-primary)", maxHeight: 140 }}/>
            {isChatting && (
              <button onClick={clear}
                className="shrink-0 text-xs text-[#9ca3af] hover:text-[#52525b] dark:text-[var(--text-faint)] dark:hover:text-[var(--text-secondary)] transition-colors mr-1">
                Clear
              </button>
            )}
            <button onClick={loading ? stop : send} disabled={!loading && !input.trim()}
              title={loading ? "Stop generating" : "Send"}
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 ${(input.trim() || loading) ? "border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] dark:hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] shadow-black/10 dark:shadow-black/30" : "bg-[#f4f4f5] text-[#9ca3af] dark:bg-[var(--surface-hover)] dark:text-[var(--text-faint)]"}`}>
              {loading ? <Square size={12} strokeWidth={3} fill="currentColor"/> : <Send size={14}/>}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-[var(--text-faint)]">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
