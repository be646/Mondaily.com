"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-com-api-neon.vercel.app";
const WORKSPACE_ID = "8ccef088-6493-4cd9-a0cf-3214098f59a1";

const FEATURE_LINES = [
  { prefix: ">", text: "enrich any company — ARR, headcount, signals in seconds" },
  { prefix: ">", text: "ask in plain english — get answers from your live data" },
  { prefix: ">", text: "trigger sequences, move deals, run workflows via AI" },
  { prefix: ">", text: "connected to your CRM, pipeline, and finance module" },
];

const SUGGESTIONS = [
  "How does enrichment work?",
  "Tell me about the pipeline",
  "What can I automate?",
  "How do I get started?",
];

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/>
      <path d="M22 2 11 13"/>
    </svg>
  );
}

function AIIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 160 160" fill="none" style={{ color: spinning ? "#a78bfa" : "#52525b", flexShrink: 0 }}>
      <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" opacity="0.8"/>
      <path d="M50,80 Q80,55 110,80 Q80,105 50,80Z" fill="none" stroke="currentColor" strokeWidth="2.8"/>
      <circle cx="80" cy="80" r="6" fill="currentColor"/>
      <circle cx="80" cy="80" r="3.5" fill="#7c3aed" opacity={spinning ? 1 : 0.6}/>
    </svg>
  );
}

// Typewriter for reply text
function Typewriter({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const i = useRef(0);
  useState(() => {
    i.current = 0;
    setDisplayed("");
    const t = setInterval(() => {
      if (i.current < text.length) {
        setDisplayed(text.slice(0, i.current + 1));
        i.current++;
      } else {
        clearInterval(t);
      }
    }, 12);
    return () => clearInterval(t);
  });
  return <>{displayed}<span className="inline-block w-[1px] h-[0.8em] bg-violet-400 ml-[1px] opacity-60 animate-pulse" /></>;
}

export function HeroChat() {
  const [input, setInput] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setReply(null);
    setLoading(true);
    const messages = [
      ...history.flatMap(h => [
        { role: "user" as const, content: h.q },
        { role: "assistant" as const, content: h.a },
      ]),
      { role: "user" as const, content: msg },
    ];
    try {
      const res = await fetch(`${API_BASE}/api/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer demo",
          "X-Workspace-Id": WORKSPACE_ID,
        },
        body: JSON.stringify({ messages, stream: false }),
      });
      const data = res.ok ? await res.json() as { reply?: string; content?: string } : null;
      const answer = data?.reply ?? data?.content ?? "Mondaily AI is here — ask me about CRM enrichment, pipeline automation, sequences, or finance.";
      setReply(answer);
      setHistory(prev => [...prev, { q: msg, a: answer }]);
    } catch {
      const answer = "I can walk you through Mondaily's features — CRM enrichment, AI pipelines, sequences, and more.";
      setReply(answer);
      setHistory(prev => [...prev, { q: msg, a: answer }]);
    }
    setLoading(false);
  }, [input, loading, history]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Search bar */}
      <div
        className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-3.5 transition-all focus-within:border-violet-500/30 focus-within:bg-white/[.05]"
        style={{ boxShadow: "0 0 0 1px rgba(124,58,237,0.06), 0 8px 32px rgba(0,0,0,0.4)" }}
      >
        <AIIcon spinning={loading} />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask Mondaily AI anything…"
          className="flex-1 bg-transparent text-[13px] text-white placeholder-zinc-700 outline-none"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        />
        {input.trim() && (
          <button
            onClick={() => send()}
            disabled={loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-30 active:scale-95 transition-all"
          >
            <SendIcon />
          </button>
        )}
      </div>

      {/* Reply */}
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex items-center gap-2.5 px-1"
          >
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <motion.span
                  key={i}
                  className="h-1 w-1 rounded-full bg-violet-600"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
            <span className="text-[11px] text-zinc-700" style={{ fontFamily: "'JetBrains Mono', monospace" }}>thinking…</span>
          </motion.div>
        )}
        {reply && !loading && (
          <motion.div
            key="reply"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-3 rounded-xl border border-white/[.05] bg-white/[.025] px-4 py-3"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <AIIcon />
              <span className="text-[10px] text-zinc-700" style={{ fontFamily: "'JetBrains Mono', monospace" }}>mondaily.ai</span>
            </div>
            <p className="text-[12px] leading-relaxed text-zinc-300" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <Typewriter key={reply} text={reply} />
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Suggestion chips */}
      {!loading && !reply && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-white/[.06] bg-white/[.02] px-3 py-1.5 text-[11px] text-zinc-600 hover:border-violet-500/20 hover:text-zinc-400 transition-all"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Feature lines */}
      <div className="mt-6 space-y-1.5 px-1">
        {FEATURE_LINES.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.6 + i * 0.12 }}
            className="flex items-center gap-2.5 text-[11px]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span className="text-violet-700">{line.prefix}</span>
            <span className="text-zinc-700">{line.text}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
