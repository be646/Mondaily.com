"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-api.onrender.com";
const WORKSPACE_ID = "8ccef088-6493-4cd9-a0cf-3214098f59a1";

interface Msg { role: "user" | "assistant"; content: string; typing?: boolean }

// Auto-play intro conversation
const INTRO: Msg[] = [
  { role: "user",      content: "What is Mondaily?" },
  { role: "assistant", content: "Mondaily is an autonomous AI workspace platform. It replaces your CRM, spreadsheets, email sequences, and workflow tools with a single system that AI operates for you — enriching records, moving deals, and triggering automations without manual work." },
  { role: "user",      content: "What makes it different?" },
  { role: "assistant", content: "Three things: ① Living CRM tables that auto-fill from the web the moment you add a company. ② A sales pipeline where deals move themselves based on activity. ③ Event-driven automation — when a deal closes above $50K it automatically enrolls the contact in your Enterprise sequence. All of it connected, all of it running while you sleep." },
];

const SUGGESTIONS = [
  "How does AI enrichment work?",
  "Tell me about the pipeline",
  "What automations can I build?",
  "How do I get started?",
];

function SendIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>;
}

function AIAvatar({ thinking = false }: { thinking?: boolean }) {
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${thinking ? "border-white/20 bg-white/[.06]" : "border-white/10 bg-white/[.04]"}`}>
      <style>{`
        @keyframes hc-pulse-outer { 0%,100%{opacity:1;stroke-width:2.5} 50%{opacity:0.4;stroke-width:1.5} }
        @keyframes hc-pulse-mid   { 0%,100%{opacity:1;stroke-width:2}   50%{opacity:0.55;stroke-width:1.2} }
        @keyframes hc-blink       { 0%,45%,55%,100%{opacity:1} 48%,52%{opacity:0} }
        @keyframes hc-scan        { 0%{stroke-dashoffset:60} 100%{stroke-dashoffset:-60} }
        @keyframes hc-glint       { 0%,80%,100%{opacity:0} 85%,92%{opacity:0.9} }
        @keyframes hc-notch       { 0%,100%{opacity:0.3} 50%{opacity:1} }
        .hc-hex-outer { animation: hc-pulse-outer var(--hc-pd,4s) ease-in-out infinite; }
        .hc-hex-mid   { animation: hc-pulse-mid   var(--hc-pd,4s) ease-in-out infinite 0.4s; }
        .hc-eye-group { animation: hc-blink var(--hc-bd,6s) ease-in-out infinite; }
        .hc-scan-line { animation: hc-scan  var(--hc-sd,3s)  linear infinite; }
        .hc-glint     { animation: hc-glint var(--hc-bd,6s) ease-in-out infinite; }
        .hc-notch     { animation: hc-notch var(--hc-pd,4s) ease-in-out infinite; }
      `}</style>
      <svg
        width="18" height="18" viewBox="0 0 160 160"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          color: "rgba(255,255,255,0.75)",
          ["--hc-pd" as string]: thinking ? "1.6s" : "4s",
          ["--hc-bd" as string]: thinking ? "1.4s" : "6s",
          ["--hc-sd" as string]: thinking ? "0.9s" : "3s",
        }}
      >
        <defs>
          <clipPath id="hc-hex-clip">
            <polygon points="80,12 138,44 138,108 80,140 22,108 22,44"/>
          </clipPath>
        </defs>
        <polygon className="hc-hex-outer" points="80,12 138,44 138,108 80,140 22,108 22,44" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" opacity="0.85"/>
        <line className="hc-notch" x1="80" y1="12" x2="80" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.7"/>
        <line className="hc-notch" x1="22" y1="62" x2="29" y2="66" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" style={{animationDelay:"0.3s"}}/>
        <line className="hc-notch" x1="138" y1="62" x2="131" y2="66" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" style={{animationDelay:"0.9s"}}/>
        <polygon className="hc-hex-mid" points="80,28 122,52 122,100 80,124 38,100 38,52" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.4"/>
        <g className="hc-eye-group">
          <path d="M52,76 Q80,52 108,76 Q80,100 52,76Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/>
          <circle cx="80" cy="76" r="13" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
          <circle cx="80" cy="76" r="5" fill="currentColor"/>
          <path className="hc-glint" d="M85,70 Q89,67 88,71" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
        </g>
        <line className="hc-scan-line" x1="52" y1="76" x2="108" y2="76" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeDasharray="8 6" clipPath="url(#hc-hex-clip)" opacity="0.5"/>
      </svg>
    </div>
  );
}

export function HeroChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const introIdx = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Play intro sequence
  useEffect(() => {
    if (!introPlaying) return;
    const playNext = () => {
      const idx = introIdx.current;
      if (idx >= INTRO.length) { setIntroPlaying(false); return; }
      const msg = INTRO[idx]!;
      const delay = idx === 0 ? 700 : msg.role === "assistant" ? 600 : 1000;
      const typingDelay = msg.role === "assistant" ? 900 : 0;

      setTimeout(() => {
        if (msg.role === "assistant") {
          // Show typing indicator first
          setMessages(prev => [...prev, { role: "assistant", content: "", typing: true }]);
          setTimeout(() => {
            setMessages(prev => {
              const n = [...prev];
              n[n.length - 1] = { role: "assistant", content: msg.content };
              return n;
            });
            introIdx.current++;
            playNext();
          }, typingDelay);
        } else {
          setMessages(prev => [...prev, msg]);
          introIdx.current++;
          playNext();
        }
      }, delay);
    };
    playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setIntroPlaying(false);
    const updated: Msg[] = [...messages.filter(m => !m.typing), { role: "user", content: msg }];
    setMessages(updated);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer demo`,
          "X-Workspace-Id": WORKSPACE_ID,
        },
        body: JSON.stringify({
          messages: updated.map(m => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });
      const data = res.ok ? await res.json() as { reply?: string; content?: string } : null;
      const reply = data?.reply ?? data?.content ?? "I'm Mondaily AI — ask me about features, setup, or how automation pipelines work!";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "I can tell you everything about Mondaily — CRM enrichment, sales pipeline, automations, and more. What would you like to know?" }]);
    }
    setLoading(false);
  }, [input, loading, messages]);

  const showSuggestions = !introPlaying && messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && !loading;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0a0c12] shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
        {/* Header bar */}
        <div className="flex items-center gap-2.5 border-b border-white/[.06] bg-[#0c0e16] px-4 py-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]"/>
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]"/>
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]"/>
          </div>
          <div className="flex-1 flex items-center justify-center gap-2">
            <AIAvatar thinking={loading} />
            <span className="text-[11px] font-medium text-slate-400" style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              MONDAILY
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5">
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            />
            <span className="text-[9px] font-semibold text-emerald-400">Live</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex flex-col gap-4 px-5 py-5 min-h-[280px] max-h-[380px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={`flex items-start gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {m.role === "assistant" && <AIAvatar />}
                {m.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.06] border border-white/[.06] text-[10px] font-bold text-slate-300">
                    You
                  </div>
                )}
                <div className={`max-w-[480px] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-tr-sm bg-indigo-600 text-white"
                    : "rounded-tl-sm bg-white/[.05] text-slate-200"
                }`}>
                  {m.typing ? (
                    <div className="flex gap-1 py-0.5">
                      {[0,1,2].map(i => (
                        <motion.span
                          key={i}
                          className="h-1.5 w-1.5 rounded-full bg-slate-500"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  ) : m.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3"
            >
              <AIAvatar thinking />
              <span className="text-[12px] text-slate-500 italic tracking-wide">Thinking…</span>
            </motion.div>
          )}

          {/* Suggestion chips — appear after intro or after assistant reply */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex flex-wrap gap-2 pl-10"
              >
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-white/[.08] bg-white/[.04] px-3 py-1.5 text-[11px] text-slate-400 hover:border-indigo-500/30 hover:bg-indigo-500/[.08] hover:text-indigo-300 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div className="border-t border-white/[.06] px-4 py-3.5">
          <div className="flex items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-3 focus-within:border-indigo-500/30 transition-colors">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Ask Mondaily anything…"
              className="flex-1 bg-transparent text-[13px] text-white placeholder-slate-700 outline-none"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-all hover:bg-indigo-500 disabled:opacity-25 active:scale-95"
            >
              <SendIcon/>
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-700">
            Powered by AI · Connected to your live workspace
          </p>
        </div>
      </div>
    </div>
  );
}
