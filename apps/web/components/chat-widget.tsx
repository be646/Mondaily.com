"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-api.onrender.com";
const DEMO_TOKEN = "demo";
const WORKSPACE_ID = "8ccef088-6493-4cd9-a0cf-3214098f59a1";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What can Mondaily do?",
  "How does AI enrichment work?",
  "Tell me about the pipeline",
];

function SendIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
    </svg>
  );
}
function BotIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>
      <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
    </svg>
  );
}
function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    const updated: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(updated);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEMO_TOKEN}`,
          "X-Workspace-Id": WORKSPACE_ID,
        },
        body: JSON.stringify({
          messages: updated.map(m => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { reply?: string; content?: string; message?: string };
        const reply = data.reply ?? data.content ?? data.message ?? "I'm here to help! Try asking about Mondaily's features.";
        setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: "I'm Mondaily AI. Ask me anything about the platform!" }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "I'm Mondaily AI — your autonomous workspace assistant. What would you like to know?" }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex h-13 w-13 items-center justify-center rounded-2xl border border-white/10 bg-[#111318] shadow-xl hover:bg-[#1a1d26] transition-colors"
            style={{ width: 52, height: 52 }}
          >
            <BotIcon size={22}/>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-6 right-6 z-50 flex w-[360px] flex-col overflow-hidden rounded-2xl border border-white/[.08] bg-[#0d0f14] shadow-2xl"
            style={{ height: 520 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[.07] bg-[#111318]">
                <BotIcon size={15}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white">Ask Mondaily</p>
                <p className="text-[10px] text-slate-600">AI-powered workspace assistant</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-white/[.05] hover:text-slate-300 transition-colors"
              >
                <XIcon size={13}/>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[.05] text-slate-400">
                      <BotIcon size={12}/>
                    </div>
                    <div className="rounded-xl rounded-tl-sm bg-white/[.04] px-3 py-2.5 text-[12px] text-slate-300 leading-relaxed max-w-[260px]">
                      Hi! I'm the Mondaily AI assistant. Ask me anything about the platform, features, or how to get started.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-8">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[10px] text-slate-400 hover:bg-white/[.07] hover:text-white transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex items-start gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[.05] text-slate-400">
                      <BotIcon size={12}/>
                    </div>
                  )}
                  <div className={`rounded-xl px-3 py-2.5 text-[12px] leading-relaxed max-w-[260px] ${
                    m.role === "user"
                      ? "rounded-tr-sm bg-indigo-600/80 text-white"
                      : "rounded-tl-sm bg-white/[.04] text-slate-300"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-start gap-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[.05] text-slate-400">
                    <BotIcon size={12}/>
                  </div>
                  <div className="rounded-xl rounded-tl-sm bg-white/[.04] px-3 py-2.5">
                    <motion.div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <motion.span
                          key={i}
                          className="h-1.5 w-1.5 rounded-full bg-slate-600"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </motion.div>
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>

            {/* Input */}
            <div className="border-t border-white/[.06] p-3">
              <div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.03] px-3 py-2.5">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder="Ask anything…"
                  className="flex-1 bg-transparent text-[12px] text-white placeholder-slate-700 outline-none"
                />
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || loading}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:opacity-30"
                >
                  <SendIcon size={11}/>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
