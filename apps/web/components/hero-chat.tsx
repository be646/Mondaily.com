"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = "/api/ask";

const FEATURE_LINES = [
  { icon: "◆", text: "Enrich any company — ARR, headcount & signals in seconds" },
  { icon: "▣", text: "Ask in plain English — get answers from your live data" },
  { icon: "▶", text: "Trigger sequences, move deals, run workflows via AI" },
  { icon: "◈", text: "Connected to your CRM, pipeline, and finance module" },
];

// Shown as fake user message bubbles — click to fire
const SUGGESTIONS: { text: string; icon: string }[] = [
  { icon: "◈", text: "How does AI enrichment work?" },
  { icon: "◈", text: "Walk me through the pipeline" },
  { icon: "◈", text: "What can Ask AI do?" },
  { icon: "◈", text: "How do automations work?" },
];

const PROCESS_STEPS = [
  { lines: ["> mondaily.ai.process(query)", "  parsing intent..."] ,                               delay: 0 },
  { lines: ["  intent: workspace_info", "  entities: 3 concepts extracted"] ,                      delay: 1200 },
  { lines: ["[CONTEXT]  loading schema...", "  records: 8,420 · modules: 6"] ,                     delay: 2600 },
  { lines: ["[SEARCH]   scanning record graph...", "  candidates: 42 · score: 0.94"] ,             delay: 4200 },
  { lines: ["[REASON]   building context...", "  hops: 3 · confidence: 0.91"] ,                    delay: 5900 },
  { lines: ["[GENERATE] streaming response...", "  awaiting model output..."] ,                     delay: 7800 },
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
    setShown("");
    const timer = setTimeout(() => {
      let i = 0;
      const t = setInterval(() => { i++; setShown(text.slice(0, i)); if (i >= text.length) clearInterval(t); }, 28);
      return () => clearInterval(t);
    }, delay);
    return () => clearTimeout(timer);
  }, [text, delay]);
  return (
    <span>
      {shown}
      {shown.length < text.length && (
        <span className="inline-block w-[1px] h-[0.85em] bg-indigo-600 ml-[1px] opacity-70 animate-pulse align-middle"/>
      )}
    </span>
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

// Transparent, persistent process panel — fades gently, stays until reply
function ProcessPanel({ visible }: { visible: boolean }) {
  const [shownBlocks, setShownBlocks] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    if (visible) {
      setShownBlocks(0);
      timers.current = PROCESS_STEPS.map((s, i) =>
        setTimeout(() => setShownBlocks(i + 1), s.delay)
      );
    } else {
      // Don't immediately reset — let the exit animation play (handled by AnimatePresence)
      const t = setTimeout(() => setShownBlocks(0), 600);
      timers.current = [t];
    }
    return () => timers.current.forEach(clearTimeout);
  }, [visible]);

  const allLines = PROCESS_STEPS.slice(0, shownBlocks).flatMap(s => s.lines);

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
            <div className="flex gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-200"/>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-200"/>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-200"/>
            </div>
            <span className="font-mono text-[11px] text-zinc-500 tracking-wider">mondaily — inference</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-700"
            />
          </div>

          {/* Code lines */}
          <div className="px-3 py-3 font-mono text-[14px] leading-[1.75] min-h-[150px]">
            <AnimatePresence initial={false}>
              {allLines.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className={
                    line.startsWith(">")
                      ? "text-indigo-500"
                      : line.startsWith("[GENERATE]")
                      ? "text-indigo-400"
                      : line.startsWith("[")
                      ? "text-indigo-600/80"
                      : "text-zinc-600"
                  }
                >
                  {line}
                </motion.div>
              ))}
            </AnimatePresence>

            {shownBlocks > 0 && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, repeatType: "reverse" }}
                className="inline-block w-[5px] h-[9px] bg-indigo-700/60 align-middle mt-0.5"
              />
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
          className="rounded-2xl"
          animate={{
            boxShadow: loading
              ? ["0 0 0 1px rgba(99,102,241,0.45), 0 0 50px rgba(99,102,241,0.18), 0 16px 48px rgba(0,0,0,0.08)",
                 "0 0 0 1px rgba(99,102,241,0.7),  0 0 70px rgba(99,102,241,0.26), 0 16px 48px rgba(0,0,0,0.08)",
                 "0 0 0 1px rgba(99,102,241,0.45), 0 0 50px rgba(99,102,241,0.18), 0 16px 48px rgba(0,0,0,0.08)"]
              : ["0 0 0 1px rgba(99,102,241,0.12), 0 0 24px rgba(99,102,241,0.05), 0 16px 48px rgba(0,0,0,0.06)",
                 "0 0 0 1px rgba(99,102,241,0.32), 0 0 40px rgba(99,102,241,0.1), 0 16px 48px rgba(0,0,0,0.06)",
                 "0 0 0 1px rgba(99,102,241,0.12), 0 0 24px rgba(99,102,241,0.05), 0 16px 48px rgba(0,0,0,0.06)"],
          }}
          transition={{ duration: loading ? 1.0 : 3.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ border: "1px solid rgba(99,102,241,0.18)", background: "#ffffff" }}
        >
          {/* Suggestion messages — shown when idle, no history */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-b border-black/[.05] px-4 py-3 space-y-1.5"
              >
                <p className="font-mono text-[11px] text-zinc-500 mb-2 tracking-widest uppercase">// try asking</p>
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07 }}
                    onClick={() => void send(s.text)}
                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-mono text-[13px] transition-all"
                    style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.05)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.25)"; (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.05)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.05)"; (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.02)"; }}
                  >
                    <span className="text-indigo-700 text-[14px] shrink-0">{s.icon}</span>
                    <span className="text-zinc-500 group-hover:text-indigo-600 transition-colors">{s.text}</span>
                    <span className="ml-auto text-[14px] text-zinc-500 group-hover:text-indigo-700 transition-colors shrink-0">↵</span>
                  </motion.button>
                ))}
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
                className="overflow-hidden border-b border-black/[.05] px-5 py-4"
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
          <div className="px-5 pt-4 pb-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask Mondaily AI anything…"
              rows={2}
              className="w-full resize-none bg-transparent font-mono text-[13px] text-zinc-900 placeholder-zinc-600 outline-none leading-relaxed"
            />
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-5 pb-4">
            <span className="font-mono text-[14px] text-zinc-600">Enter ↵ to send</span>
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-20 active:scale-95 transition-all"
            >
              <SendIcon />
            </button>
          </div>
        </motion.div>

        {/* Process panel — right side, desktop only */}
        <ProcessPanel visible={loading} />
      </div>

      {/* Feature lines */}
      <div className="mt-8 flex flex-col gap-1.5">
        {FEATURE_LINES.map((line, i) => (
          <motion.div
            key={i}
            className="group flex cursor-default items-center gap-3 rounded-lg border border-transparent px-3 py-2.5"
            whileHover={{ backgroundColor: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.15)" }}
          >
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-black/[.06] bg-black/[.02] text-[11px] text-indigo-500 group-hover:border-indigo-500/30 group-hover:text-indigo-600 transition-colors">
              {line.icon}
              <motion.span
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.6 }}
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500"
              />
            </span>
            <span className="font-mono text-[14px] leading-snug text-zinc-500 group-hover:text-indigo-600 transition-colors">
              <TypewriterLine text={line.text} delay={800 + i * 600} />
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
