"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

// Use the Next.js API route — runs on the same deployment, has the key
const API_URL = "/api/ask";

const FEATURE_LINES = [
  "Enrich any company — ARR, headcount & signals in seconds",
  "Ask in plain English — get answers from your live data",
  "Trigger sequences, move deals, run workflows via AI",
  "Connected to your CRM, pipeline, and finance module",
];

const SUGGESTIONS = [
  "How does AI enrichment work?",
  "Walk me through the pipeline",
  "What can Ask AI do?",
  "How do automations work?",
];

const PROCESS_STEPS = [
  { tag: "[PARSE]",    msg: "reading intent from query…",            delay: 0 },
  { tag: "[CONTEXT]",  msg: "loading workspace & record schema…",    delay: 900 },
  { tag: "[SEARCH]",   msg: "scanning 8,420 enriched records…",      delay: 1900 },
  { tag: "[REASON]",   msg: "building multi-hop context chain…",     delay: 3100 },
  { tag: "[GENERATE]", msg: "composing response with live data…",    delay: 4500 },
];

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
    </svg>
  );
}

function TypewriterLine({ text, delay = 0 }: { text: string; delay?: number }) {
  const [shown, setShown] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      let i = 0;
      const t = setInterval(() => {
        i++;
        setShown(text.slice(0, i));
        if (i >= text.length) clearInterval(t);
      }, 28);
      return () => clearInterval(t);
    }, delay);
    return () => clearTimeout(timer);
  }, [text, delay]);

  return (
    <span>
      {shown}
      {shown.length < text.length && (
        <span className="inline-block w-[1px] h-[0.85em] bg-violet-600 ml-[1px] opacity-70 animate-pulse align-middle"/>
      )}
    </span>
  );
}

function ReplyTypewriter({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  const i = useRef(0);

  useEffect(() => {
    i.current = 0;
    setShown("");
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
        <span className="inline-block w-[1px] h-[0.85em] bg-violet-500 ml-[1px] opacity-60 animate-pulse align-middle"/>
      )}
    </>
  );
}

// Processing panel — appears to the right of the chat while loading
function ProcessPanel({ visible }: { visible: boolean }) {
  const [shownSteps, setShownSteps] = useState<number>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    if (visible) {
      setShownSteps(0);
      timers.current = PROCESS_STEPS.map((s, i) =>
        setTimeout(() => setShownSteps(i + 1), s.delay)
      );
    } else {
      setShownSteps(0);
    }
    return () => timers.current.forEach(clearTimeout);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.3 }}
          className="hidden lg:block absolute top-0 left-[calc(100%+1.25rem)] w-60 rounded-xl font-mono text-[11px]"
          style={{ border: "1px solid rgba(124,58,237,0.12)", background: "rgba(8,8,8,0.95)" }}
        >
          <div className="border-b border-white/[.04] px-4 py-2.5 flex items-center gap-2">
            <motion.span
              animate={{ opacity: [0.3,1,0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="h-1.5 w-1.5 rounded-full bg-violet-600"
            />
            <span className="text-zinc-600 text-[10px] tracking-wider">mondaily — inference</span>
          </div>
          <div className="px-4 py-3 space-y-2.5">
            <AnimatePresence initial={false}>
              {PROCESS_STEPS.slice(0, shownSteps).map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-start gap-2"
                >
                  <span className={`shrink-0 ${i < shownSteps - 1 ? "text-violet-600" : "text-violet-400"}`}>
                    {step.tag}
                  </span>
                  <span className="text-zinc-600 leading-snug">{step.msg}</span>
                  {i === shownSteps - 1 && (
                    <motion.span
                      animate={{ opacity: [0.3,1,0.3] }}
                      transition={{ duration: 0.6, repeat: Infinity }}
                      className="ml-auto shrink-0 text-[9px] text-violet-700"
                    >
                      ●
                    </motion.span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {/* completion line */}
            {shownSteps >= PROCESS_STEPS.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border-t border-white/[.04] pt-2 text-[10px] text-violet-700"
              >
                [DONE] streaming reply…
              </motion.div>
            )}
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
      const answer = data?.reply ?? "Mondaily connects your data, enriches your records, and runs your workflows automatically.";
      setReply(answer);
      setHistory(prev => [...prev, { q: msg, a: answer }]);
    } catch {
      setReply("Mondaily connects your data, enriches your records, and runs your workflows automatically.");
      setHistory(prev => [...prev, { q: msg, a: "Mondaily connects your data, enriches your records, and runs your workflows automatically." }]);
    }
    setLoading(false);
  }, [input, loading, history]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  const isEmpty = !reply && !loading && !input;

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Suggestion pills — above the chat card */}
      <AnimatePresence>
        {isEmpty && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mb-3 flex flex-wrap justify-center gap-2"
          >
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => void send(s)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] text-zinc-500 hover:text-violet-300 transition-all"
                style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(124,58,237,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
              >
                <span className="text-violet-600">→</span> {s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outer wrapper — relative for process panel absolute positioning */}
      <div className="relative">
        {/* Chat card — animated violet glow border */}
        <motion.div
          className="rounded-2xl"
          animate={{
            boxShadow: loading
              ? [
                  "0 0 0 1px rgba(124,58,237,0.4), 0 0 40px rgba(124,58,237,0.18), 0 24px 64px rgba(0,0,0,0.6)",
                  "0 0 0 1px rgba(124,58,237,0.6), 0 0 60px rgba(124,58,237,0.28), 0 24px 64px rgba(0,0,0,0.6)",
                  "0 0 0 1px rgba(124,58,237,0.4), 0 0 40px rgba(124,58,237,0.18), 0 24px 64px rgba(0,0,0,0.6)",
                ]
              : [
                  "0 0 0 1px rgba(124,58,237,0.12), 0 0 24px rgba(124,58,237,0.06), 0 24px 64px rgba(0,0,0,0.6)",
                  "0 0 0 1px rgba(124,58,237,0.32), 0 0 40px rgba(124,58,237,0.12), 0 24px 64px rgba(0,0,0,0.6)",
                  "0 0 0 1px rgba(124,58,237,0.12), 0 0 24px rgba(124,58,237,0.06), 0 24px 64px rgba(0,0,0,0.6)",
                ],
          }}
          transition={{ duration: loading ? 1.2 : 3.5, repeat: Infinity, ease: "easeInOut" }}
          style={{
            border: "1px solid rgba(124,58,237,0.18)",
            background: "rgba(12,12,12,0.95)",
          }}
        >
          {/* Reply area */}
          <AnimatePresence mode="wait">
            {(reply || loading) && (
              <motion.div
                key="reply-area"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden border-b border-white/[.05] px-5 py-4"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    {[0,1,2].map(i => (
                      <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-violet-700"
                        animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                    <span className="font-mono text-[11px] text-zinc-500 ml-1">processing…</span>
                  </div>
                ) : reply ? (
                  <p className="font-mono text-[12px] leading-relaxed text-zinc-300">
                    <ReplyTypewriter key={reply} text={reply} />
                  </p>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Textarea */}
          <div className="px-5 pt-4 pb-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask Mondaily AI anything…"
              rows={2}
              className="w-full resize-none bg-transparent font-mono text-[13px] text-white placeholder-zinc-600 outline-none leading-relaxed"
            />
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-5 pb-4">
            <span className="font-mono text-[10px] text-zinc-600">Enter ↵ to send</span>
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-20 active:scale-95 transition-all"
            >
              <SendIcon />
            </button>
          </div>
        </motion.div>

        {/* Process panel — absolutely to the right on large screens */}
        <ProcessPanel visible={loading} />
      </div>

      {/* Feature lines — hover to highlight */}
      <div className="mt-8 space-y-1">
        {FEATURE_LINES.map((line, i) => (
          <motion.div
            key={i}
            className="group flex cursor-default items-center gap-3 rounded-lg px-3 py-2"
            whileHover={{ backgroundColor: "rgba(124,58,237,0.07)" }}
          >
            <span className="h-1 w-4 shrink-0 bg-violet-700/50 group-hover:bg-violet-500 transition-colors" style={{ borderRadius: 1 }}/>
            <span className="font-mono text-[12px] leading-snug text-zinc-500 group-hover:text-violet-300 transition-colors">
              <TypewriterLine text={line} delay={800 + i * 600} />
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
