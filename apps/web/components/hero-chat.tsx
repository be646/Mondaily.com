"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = "/api/ask";

// Shown as fake user message bubbles — click to fire
const SUGGESTIONS: { text: string }[] = [
  { text: "What changed in my graph today?" },
  { text: "Which tasks need attention?" },
  { text: "Where is revenue at risk?" },
  { text: "What should the agents prepare next?" },
];

// Plain-language reasoning flow — no raw code/log syntax, just what the AI is actually doing
const PROCESS_STEPS = [
  { lines: ["Reading workspace graph"],   delay: 0 },
  { lines: ["Finding relevant signals"],  delay: 1400 },
  { lines: ["Cross-checking records"],    delay: 3000 },
  { lines: ["Drafting an answer"],        delay: 4600 },
];

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
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
        <span className="inline-block w-[1px] h-[0.85em] bg-indigo-500 ml-[1px] opacity-60 animate-pulse align-middle"/>
      )}
    </>
  );
}

// Transparent, persistent reasoning panel — a tasteful step list, not a fake terminal log
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
          className="hidden lg:flex absolute top-0 left-[calc(100%+1.5rem)] w-60 flex-col rounded-xl overflow-hidden"
          style={{
            border: "1px solid rgba(99,102,241,0.1)",
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(8px)",
          }}
        >
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-black/[.04] px-3 py-2">
            <span className="text-[12px] text-zinc-600 font-medium">Ask Mondaily is thinking</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500"
            />
          </div>

          {/* Reasoning steps */}
          <div className="px-3.5 py-3.5 flex flex-col gap-2.5">
            {PROCESS_STEPS.map((s, i) => {
              const done = i < activeStep;
              const current = i === activeStep;
              const pending = i > activeStep;
              return (
                <div key={i} className={`flex items-center gap-2.5 transition-opacity ${pending ? "opacity-35" : "opacity-100"}`}>
                  <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {done ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    ) : current ? (
                      <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-indigo-500"/>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-300"/>
                    )}
                  </span>
                  <span className={`text-[13px] ${current ? "text-indigo-600 font-medium" : "text-zinc-500"}`}>{s.lines[0]}</span>
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
        {/* Chat card */}
        <motion.div
          className="bg-white dark:bg-black"
          animate={{
            boxShadow: loading
              ? ["0 0 0 1px rgba(10,10,10,0.2)", "0 0 0 1px rgba(10,10,10,0.45)", "0 0 0 1px rgba(10,10,10,0.2)"]
              : ["0 0 0 1px rgba(10,10,10,0.02)", "0 0 0 1px rgba(10,10,10,0.08)", "0 0 0 1px rgba(10,10,10,0.02)"],
          }}
          transition={{ duration: loading ? 1.0 : 3.8, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Suggestion messages — shown when idle, no history */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-0 pb-3"
              >
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">Try asking</p>
                <div className="grid gap-0">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => void send(s.text)}
                      className="group flex w-full items-center justify-between gap-4 border-t border-black/[.05] py-2.5 text-left text-[13px] transition-colors last:border-b hover:text-neutral-950"
                    >
                      <span className="text-zinc-500 transition-colors group-hover:text-neutral-950">{s.text}</span>
                      <span className="text-[13px] text-zinc-400 transition-colors group-hover:text-neutral-800">↵</span>
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
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden border-y border-black/[.05] px-4 py-4"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    {[0,1,2].map(i => (
                      <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-indigo-700"
                        animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                    <span className="font-mono text-[13px] text-zinc-500 ml-1">processing…</span>
                  </div>
                ) : reply ? (
                  <p className="font-mono text-[14px] leading-relaxed text-zinc-600">
                    <ReplyTypewriter key={reply} text={reply} />
                  </p>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Textarea */}
          <div className="landing-soft-panel border border-black/[.1] px-4 pt-4 pb-2 transition-colors focus-within:border-neutral-950 dark:border-white/15 dark:focus-within:border-white/60">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask Mondaily AI anything…"
              rows={2}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white"
            />
          </div>

          {/* Bottom bar */}
          <div className="landing-soft-panel flex items-center justify-between border-x border-b border-black/[.1] px-4 pb-4 dark:border-white/15">
            <span className="text-[12px] text-zinc-400">Enter to send</span>
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center border border-neutral-950 bg-neutral-950 text-white transition-opacity hover:opacity-85 disabled:opacity-20 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950"
            >
              <SendIcon />
            </button>
          </div>
        </motion.div>

        {/* Process panel — right side, desktop only */}
        <ProcessPanel visible={loading} />
      </div>
    </div>
  );
}
