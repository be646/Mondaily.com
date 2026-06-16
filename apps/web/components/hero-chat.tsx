"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = "/api/ask";

const FEATURE_LINES = [
  "Enrich any company — ARR, headcount & signals in seconds",
  "Ask in plain English — get answers from your live data",
  "Trigger sequences, move deals, run workflows via AI",
  "Connected to your CRM, pipeline, and finance module",
];

// Suggestion chips shown inside the chat when idle
const SUGGESTIONS = [
  "How does AI enrichment work?",
  "Walk me through the pipeline",
  "What can Ask AI do?",
  "How do automations work?",
];

// Process log — each step appears on a delay, loops last line until reply arrives
const PROCESS_STEPS = [
  { lines: ["> mondaily.ai.process(query)", "  parsing intent from natural language..."] ,          delay: 0 },
  { lines: ["  intent: query_type=workspace_info", "  entities: extracted 3 concepts"] ,            delay: 1100 },
  { lines: ["[CONTEXT]  loading workspace schema...", "  records: 8,420 enriched · modules: 6"] ,   delay: 2400 },
  { lines: ["[SEARCH]   scanning record graph...", "  candidates: 42 · top_score: 0.94"] ,          delay: 3800 },
  { lines: ["[REASON]   building context chain...", "  hops: 3 · confidence: 0.91"] ,               delay: 5400 },
  { lines: ["[GENERATE] streaming response...", "  tokens: — · latency: —"] ,                       delay: 7000 },
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
        <span className="inline-block w-[1px] h-[0.85em] bg-violet-600 ml-[1px] opacity-70 animate-pulse align-middle"/>
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
        <span className="inline-block w-[1px] h-[0.85em] bg-violet-500 ml-[1px] opacity-60 animate-pulse align-middle"/>
      )}
    </>
  );
}

// Code-style process panel — stays until reply arrives, loops last step
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
      setShownBlocks(0);
    }
    return () => timers.current.forEach(clearTimeout);
  }, [visible]);

  const allLines = PROCESS_STEPS.slice(0, shownBlocks).flatMap(s => s.lines);
  const isAtLastStep = shownBlocks >= PROCESS_STEPS.length;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.35 }}
          className="hidden lg:flex absolute top-0 left-[calc(100%+1.5rem)] w-64 flex-col rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(124,58,237,0.14)", background: "rgba(6,6,6,0.97)" }}
        >
          {/* Terminal title bar */}
          <div className="flex items-center gap-2 border-b border-white/[.05] px-3 py-2">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
            </div>
            <span className="font-mono text-[9px] text-zinc-700 tracking-wider">mondaily — inference engine</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-600"
            />
          </div>

          {/* Code output */}
          <div className="flex-1 px-3 py-3 font-mono text-[10px] leading-[1.7] space-y-0 min-h-[160px]">
            <AnimatePresence initial={false}>
              {allLines.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={
                    line.startsWith(">")
                      ? "text-violet-400"
                      : line.startsWith("[GENERATE]")
                      ? "text-violet-500"
                      : line.startsWith("[")
                      ? "text-violet-600"
                      : "text-zinc-500"
                  }
                >
                  {line}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Blinking cursor — loops at the end until reply */}
            {shownBlocks > 0 && (
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="inline-block w-[6px] h-[10px] bg-violet-600 align-middle"
              />
            )}

            {/* Streaming indicator once all steps shown */}
            {isAtLastStep && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-1 text-[9px] text-zinc-700"
              >
                <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity }}>
                  awaiting model response…
                </motion.span>
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
              ? ["0 0 0 1px rgba(124,58,237,0.45), 0 0 50px rgba(124,58,237,0.2), 0 24px 64px rgba(0,0,0,0.6)",
                 "0 0 0 1px rgba(124,58,237,0.7), 0 0 70px rgba(124,58,237,0.3), 0 24px 64px rgba(0,0,0,0.6)",
                 "0 0 0 1px rgba(124,58,237,0.45), 0 0 50px rgba(124,58,237,0.2), 0 24px 64px rgba(0,0,0,0.6)"]
              : ["0 0 0 1px rgba(124,58,237,0.12), 0 0 24px rgba(124,58,237,0.06), 0 24px 64px rgba(0,0,0,0.6)",
                 "0 0 0 1px rgba(124,58,237,0.32), 0 0 40px rgba(124,58,237,0.12), 0 24px 64px rgba(0,0,0,0.6)",
                 "0 0 0 1px rgba(124,58,237,0.12), 0 0 24px rgba(124,58,237,0.06), 0 24px 64px rgba(0,0,0,0.6)"],
          }}
          transition={{ duration: loading ? 1.0 : 3.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ border: "1px solid rgba(124,58,237,0.18)", background: "rgba(12,12,12,0.95)" }}
        >
          {/* Suggestions inside chat — shown when idle, no history */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-b border-white/[.05] px-5 py-4"
              >
                <p className="font-mono text-[10px] text-zinc-600 mb-3">// try asking:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => void send(s)}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] text-zinc-400 hover:text-violet-300 transition-all"
                      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,58,237,0.35)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                    >
                      <span className="text-violet-600 text-[9px]">→</span> {s}
                    </button>
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
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-20 active:scale-95 transition-all"
            >
              <SendIcon />
            </button>
          </div>
        </motion.div>

        {/* Process panel — absolute right, desktop only */}
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
