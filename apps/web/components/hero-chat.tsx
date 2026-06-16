"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-com-api-neon.vercel.app";

const FEATURE_LINES = [
  "Enrich any company — ARR, headcount & signals in seconds",
  "Ask in plain English — get answers from your live data",
  "Trigger sequences, move deals, run workflows via AI",
  "Connected to your CRM, pipeline, and finance module",
];

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
    </svg>
  );
}

// Letter-by-letter typewriter for a single line
function TypewriterLine({ text, delay = 0, className = "" }: { text: string; delay?: number; className?: string }) {
  const [shown, setShown] = useState("");
  const started = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      started.current = true;
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
    <span className={className}>
      {shown}
      {shown.length < text.length && (
        <span className="inline-block w-[1px] h-[0.85em] bg-violet-600 ml-[1px] opacity-70 animate-pulse align-middle"/>
      )}
    </span>
  );
}

// Typewriter for AI reply
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
      const res = await fetch(`${API_BASE}/api/v1/public/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = res.ok ? await res.json() as { reply?: string } : null;
      const answer = data?.reply ?? "Mondaily connects your data, enriches your records, and runs your workflows — ask me anything.";
      setReply(answer);
      setHistory(prev => [...prev, { q: msg, a: answer }]);
    } catch {
      const answer = "I can walk you through Mondaily — CRM enrichment, AI pipelines, sequences, finance, and more.";
      setReply(answer);
      setHistory(prev => [...prev, { q: msg, a: answer }]);
    }
    setLoading(false);
  }, [input, loading, history]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Chat card — animated violet glow border */}
      <motion.div
        className="rounded-2xl"
        animate={{
          boxShadow: [
            "0 0 0 1px rgba(124,58,237,0.12), 0 0 24px rgba(124,58,237,0.06), 0 24px 64px rgba(0,0,0,0.6)",
            "0 0 0 1px rgba(124,58,237,0.38), 0 0 40px rgba(124,58,237,0.14), 0 24px 64px rgba(0,0,0,0.6)",
            "0 0 0 1px rgba(124,58,237,0.12), 0 0 24px rgba(124,58,237,0.06), 0 24px 64px rgba(0,0,0,0.6)",
          ],
        }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
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
                  <span className="font-mono text-[11px] text-zinc-700 ml-1">thinking…</span>
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
            rows={3}
            className="w-full resize-none bg-transparent font-mono text-[13px] text-white placeholder-zinc-600 outline-none leading-relaxed"
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-5 pb-4">
          <span className="font-mono text-[10px] text-zinc-600">Enter to send · Shift+Enter for new line</span>
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-20 active:scale-95 transition-all"
          >
            <SendIcon />
          </button>
        </div>
      </motion.div>

      {/* Feature lines — hover to highlight */}
      <div className="mt-8 space-y-1">
        {FEATURE_LINES.map((line, i) => (
          <motion.div
            key={i}
            className="group flex cursor-default items-center gap-3 rounded-lg px-3 py-2 transition-colors"
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
