"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = "/api/ask";

const SUGGESTIONS = [
  { text: "How does AI enrichment work?", tag: "Enrichment" },
  { text: "Walk me through the opportunity flow on the graph", tag: "Graph" },
  { text: "What can Ask AI do?", tag: "Ask AI" },
  { text: "How do automations work?", tag: "Automations" },
];

const PROCESS_STEPS = [
  { lines: ["Reading workspace graph"],  delay: 0 },
  { lines: ["Finding relevant signals"], delay: 1400 },
  { lines: ["Cross-checking records"],   delay: 3000 },
  { lines: ["Drafting an answer"],       delay: 4600 },
];

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function ReplyTypewriter({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  const i = useRef(0);
  useEffect(() => {
    i.current = 0; setShown("");
    const t = setInterval(() => {
      if (i.current < text.length) { setShown(text.slice(0, i.current + 1)); i.current++; }
      else clearInterval(t);
    }, 14);
    return () => clearInterval(t);
  }, [text]);
  return (
    <>
      {shown}
      {shown.length < text.length && (
        <span className="inline-block w-[1px] h-[0.85em] bg-zinc-800 ml-[1px] opacity-50 animate-pulse align-middle"/>
      )}
    </>
  );
}

function ProcessPanel({ visible }: { visible: boolean }) {
  const [activeStep, setActiveStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    if (visible) {
      setActiveStep(0);
      timers.current = PROCESS_STEPS.map((s, i) =>
        setTimeout(() => setActiveStep(i), s.delay)
      );
    } else {
      const t = setTimeout(() => setActiveStep(0), 600);
      timers.current = [t];
    }
    return () => timers.current.forEach(clearTimeout);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 6, transition: { duration: 1.2, ease: "easeOut" } }}
          transition={{ duration: 0.4 }}
          className="landing-terminal absolute left-[calc(100%+1.5rem)] top-0 hidden w-64 flex-col overflow-hidden p-4 lg:flex"
        >
          <div className="mb-3 flex items-center gap-2 text-left">
            <span className="text-[12px] font-medium text-[#9fb08f]">ask.process</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-[#9fb08f]"
            />
          </div>
          <div className="flex flex-col gap-1 font-mono">
            {PROCESS_STEPS.map((s, i) => {
              const done = i < activeStep;
              const current = i === activeStep;
              const pending = i > activeStep;
              return (
                <div
                  key={i}
                  style={{ opacity: pending ? 0.35 : 1, transition: "opacity 0.3s" }}
                  className="h-7 overflow-hidden whitespace-nowrap text-left text-[12px] leading-7"
                >
                  <span style={{ color: "#7c8379" }}>$ </span>
                  <span style={{ color: current ? "#9fb08f" : done ? "#8fb3b0" : "#7c8379" }}>
                    {done ? "done" : current ? "run" : "queue"}
                  </span>
                  <span style={{ color: "#7c8379" }}> -- </span>
                  <span style={{ color: "#d7c6a3" }}>{s.lines[0]}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function HeroChat() {
  const [input, setInput] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setReply(null);
    setLoading(true);
    const messages = [
      ...history.flatMap(h => [{ role: "user" as const, content: h.q }, { role: "assistant" as const, content: h.a }]),
      { role: "user" as const, content: msg },
    ];
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = res.ok ? await res.json() as { reply?: string } : null;
      const answer = data?.reply ?? "Mondaily connects your records into one workspace graph, with AI agents that enrich, recommend, and act once you approve.";
      setReply(answer);
      setHistory(prev => [...prev, { q: msg, a: answer }]);
    } catch {
      setReply("Mondaily connects your records into one workspace graph, with AI agents that enrich, recommend, and act once you approve.");
      setHistory(prev => [...prev, { q: msg, a: "Mondaily connects your data." }]);
    }
    setLoading(false);
  }, [input, loading, history]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  const showSuggestions = !reply && !loading && history.length === 0;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="relative">
        <div>
          {/* Suggestion chips — shown when idle, no history */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="mx-auto mb-5 max-w-xl"
              >
                <p className="mb-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
                  Try asking
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.07 }}
                      onClick={() => void send(s.text)}
                      className="group flex w-full items-center gap-3 rounded-xl border border-black/[.06] bg-black/[.02] px-4 py-2.5 text-left transition-all hover:border-black/[.1] hover:bg-black/[.04]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 transition-colors group-hover:bg-zinc-500" />
                      <span className="flex-1 text-[13px] text-zinc-600 transition-colors group-hover:text-zinc-900">
                        {s.text}
                      </span>
                      <span className="shrink-0 rounded-md border border-black/[.06] bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors group-hover:border-black/[.1] group-hover:text-zinc-600">
                        {s.tag}
                      </span>
                      <span className="shrink-0 text-[13px] text-zinc-300 transition-colors group-hover:text-zinc-600">↵</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reply / loading area */}
          <AnimatePresence mode="wait">
            {(reply || loading) && (
              <motion.div
                key="reply-area"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 86 }}
                exit={{ opacity: 0, height: 0 }}
                className="mx-auto mb-3 max-w-xl overflow-hidden px-1 py-3 text-left"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    {[0,1,2].map(i => (
                      <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-neutral-800 dark:bg-neutral-100"
                        animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                    <span className="ml-1 text-[13px] text-zinc-500">processing…</span>
                  </div>
                ) : reply ? (
                  <p className="text-[14px] leading-relaxed text-zinc-600">
                    <ReplyTypewriter key={reply} text={reply} />
                  </p>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input pill */}
          <div className="landing-chat-pill mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 transition-colors focus-within:border-neutral-950">
            <button
              type="button"
              aria-label="Add context"
              className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-950 transition-opacity hover:opacity-70 dark:text-white"
            >
              <PlusIcon />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="What do you want to know?"
              rows={1}
              className="min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[16px] leading-7 text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-white dark:placeholder:text-zinc-500"
            />
            <button
              type="button"
              aria-label="Voice input"
              className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-500 transition-opacity hover:opacity-70 hover:text-neutral-950 dark:text-white"
            >
              <MicIcon />
            </button>
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="landing-chat-pulse flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-85 disabled:opacity-25"
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>

        {/* Process panel — right side, desktop only */}
        <ProcessPanel visible={loading} />
      </div>
    </div>
  );
}
