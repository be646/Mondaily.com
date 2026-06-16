"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-com-api-neon.vercel.app";
const WORKSPACE_ID = "8ccef088-6493-4cd9-a0cf-3214098f59a1";

const COMMANDS = [
  "Enrich any company — ARR, headcount & signals in seconds",
  "Ask in plain English — get answers from your live data",
  "Trigger sequences, move deals, run workflows via AI",
  "Connected to your CRM, pipeline, and finance module",
];

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
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
  return (
    <>
      {displayed}
      <span className="inline-block w-[1px] h-[0.85em] bg-violet-500 ml-[1px] opacity-60 animate-pulse"/>
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

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">

      {/* Chat card — slightly contrasted background */}
      <div
        className="rounded-2xl border border-white/[.07] p-1"
        style={{
          background: "rgba(255,255,255,0.03)",
          boxShadow: "0 0 0 1px rgba(124,58,237,0.06), 0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* Textarea */}
        <div className="rounded-xl border border-white/[.06] bg-[#0d0d0d] px-4 pt-4 pb-3">
          {/* Reply area — shows above input when answered */}
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="mb-3 flex items-center gap-2"
              >
                {[0,1,2].map(i => (
                  <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-violet-700"
                    animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
                <span className="font-mono text-[11px] text-zinc-700">thinking…</span>
              </motion.div>
            )}
            {reply && !loading && (
              <motion.div key="reply" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mb-3 border-b border-white/[.04] pb-3"
              >
                <p className="font-mono text-[12px] leading-relaxed text-zinc-400">
                  <Typewriter key={reply} text={reply} />
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything — your workspace will answer…"
            rows={3}
            className="w-full resize-none bg-transparent font-mono text-[13px] text-white placeholder-zinc-800 outline-none leading-relaxed"
          />

          {/* Bottom toolbar */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-700">
              {/* Attachment icon */}
              <button className="hover:text-zinc-400 transition-colors p-1 rounded">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <span className="font-mono text-[10px] text-zinc-800">Shift+Enter for new line</span>
            </div>

            {/* Send button — circular, bottom right */}
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-20 active:scale-95 transition-all"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Frameless command lines — outside the chat, coding style, each is clickable */}
      <div className="mt-6 space-y-2.5">
        {COMMANDS.map((cmd, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
            onClick={() => { setInput(cmd); textareaRef.current?.focus(); }}
            className="group flex w-full items-center gap-3 text-left transition-all"
          >
            <span className="font-mono text-[12px] text-violet-700 transition-colors group-hover:text-violet-500">→</span>
            <span className="font-mono text-[12px] text-zinc-700 transition-colors group-hover:text-zinc-400">{cmd}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
