"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-com-api-neon.vercel.app";
const WORKSPACE_ID = "8ccef088-6493-4cd9-a0cf-3214098f59a1";

const SUGGESTIONS = [
  "How does enrichment work?",
  "Tell me about the pipeline",
  "What can I automate?",
  "How do I get started?",
];

const FEATURE_LINES = [
  "Enrich any company — ARR, headcount, signals in seconds",
  "Ask in plain English — get answers from your live data",
  "Trigger sequences, move deals, run workflows via AI",
  "Connected to your CRM, pipeline, and finance module",
];

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
    </svg>
  );
}

function AIIcon({ active = false }: { active?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 200 200" fill="none" style={{ color: active ? "#7c3aed" : "#3f3f46", flexShrink: 0 }}>
      <polygon points="100,8 176,52 176,148 100,192 24,148 24,52" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/>
      <path d="M42,100 Q100,54 158,100 Q100,146 42,100Z" fill="none" stroke="currentColor" strokeWidth="3.5"/>
      <circle cx="100" cy="100" r="10" fill="currentColor"/>
      <circle cx="100" cy="100" r="6" fill="#7c3aed" opacity={active ? 1 : 0.5}/>
    </svg>
  );
}

function Typewriter({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const i = useRef(0);
  useState(() => {
    i.current = 0;
    setDisplayed("");
    const t = setInterval(() => {
      if (i.current < text.length) { setDisplayed(text.slice(0, i.current + 1)); i.current++; }
      else clearInterval(t);
    }, 12);
    return () => clearInterval(t);
  });
  return <>{displayed}<span className="inline-block w-[1px] h-[0.8em] bg-violet-500 ml-[1px] opacity-60 animate-pulse"/></>;
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
      ...history.flatMap(h => [{ role: "user" as const, content: h.q }, { role: "assistant" as const, content: h.a }]),
      { role: "user" as const, content: msg },
    ];
    try {
      const res = await fetch(`${API_BASE}/api/v1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer demo", "X-Workspace-Id": WORKSPACE_ID },
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
      {/* Input + chips — unified bordered block */}
      <div
        className="rounded-xl border border-white/[.07] bg-[#0a0a0a] transition-all focus-within:border-violet-500/25"
        style={{ boxShadow: "0 0 0 1px rgba(124,58,237,0.04), 0 8px 32px rgba(0,0,0,0.4)" }}
      >
        {/* Search row */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <AIIcon active={loading} />
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Ask Mondaily AI anything…"
            className="flex-1 bg-transparent font-mono text-[12px] text-white placeholder-zinc-800 outline-none"
          />
          {input.trim() && (
            <button
              onClick={() => send()}
              disabled={loading}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-30 active:scale-95 transition-all"
            >
              <SendIcon />
            </button>
          )}
        </div>

        {/* Divider + suggestion chips — flush with the box border */}
        <div className="border-t border-white/[.04] px-3 py-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-md border border-white/[.05] bg-white/[.02] px-2.5 py-1 font-mono text-[10px] text-zinc-700 hover:border-violet-500/20 hover:text-zinc-400 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Reply */}
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loading" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 flex items-center gap-2.5 px-1">
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <motion.span key={i} className="h-1 w-1 rounded-full bg-violet-700" animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}/>
              ))}
            </div>
            <span className="font-mono text-[11px] text-zinc-800">thinking…</span>
          </motion.div>
        )}
        {reply && !loading && (
          <motion.div key="reply" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
            className="mt-3 rounded-xl border border-white/[.04] bg-white/[.02] px-4 py-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <AIIcon active />
              <span className="font-mono text-[10px] text-zinc-700">mondaily.ai</span>
            </div>
            <p className="font-mono text-[12px] leading-relaxed text-zinc-400">
              <Typewriter key={reply} text={reply} />
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feature dedication lines */}
      <div className="mt-8 space-y-3">
        {FEATURE_LINES.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
            className="flex items-start gap-3"
          >
            <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-700/60" />
            <span className="font-mono text-[12px] leading-snug text-zinc-600">{line}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
