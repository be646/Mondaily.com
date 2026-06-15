"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://mondaily-api.onrender.com";
const WORKSPACE_ID = "8ccef088-6493-4cd9-a0cf-3214098f59a1";

interface Msg { role: "user" | "assistant"; content: string; typing?: boolean }

const INTRO: Msg[] = [
  { role: "user",      content: "What is Mondaily?" },
  { role: "assistant", content: "Mondaily is an autonomous AI workspace. It replaces your CRM, spreadsheets, email sequences, and workflow tools with a single system that enriches records, moves deals, and triggers automations — without manual input." },
  { role: "user",      content: "What makes it different?" },
  { role: "assistant", content: "Three things: ① Living CRM tables that auto-fill from the web the moment you add a company. ② A sales pipeline where deals move themselves based on activity rules. ③ Event-driven automation — when a deal closes above £50K it automatically enrolls the contact in your Enterprise sequence. All of it connected, all of it running while you sleep." },
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
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${thinking ? "border-violet-500/30 bg-violet-500/[.07]" : "border-white/10 bg-white/[.04]"}`}>
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
          <circle cx="80" cy="76" r="3.2" fill="#7c3aed" opacity="0.7"/>
          <path className="hc-glint" d="M85,70 Q89,67 88,71" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
        </g>
        <line className="hc-scan-line" x1="52" y1="76" x2="108" y2="76" stroke="#7c3aed" strokeWidth="0.9" strokeLinecap="round" strokeDasharray="8 6" clipPath="url(#hc-hex-clip)" opacity="0.6"/>
      </svg>
    </div>
  );
}

// Typewriter component for AI replies
function Typewriter({ text, onDone }: { text: string; onDone?: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const i = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    setDisplayed("");
    i.current = 0;
    doneRef.current = false;
    const t = setInterval(() => {
      if (i.current < text.length) {
        setDisplayed(text.slice(0, i.current + 1));
        i.current++;
      } else {
        clearInterval(t);
        if (!doneRef.current) { doneRef.current = true; onDone?.(); }
      }
    }, 14);
    return () => clearInterval(t);
  }, [text, onDone]);

  return <>{displayed}<span className="inline-block w-[1px] h-[0.85em] bg-violet-400 ml-[1px] opacity-70 animate-pulse"/></>;
}

export function HeroChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(true);
  const [typingDone, setTypingDone] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const introIdx = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!introPlaying) return;
    const playNext = () => {
      const idx = introIdx.current;
      if (idx >= INTRO.length) { setIntroPlaying(false); return; }
      const msg = INTRO[idx]!;
      const delay = idx === 0 ? 700 : msg.role === "assistant" ? 600 : 1400;
      const typingDelay = msg.role === "assistant" ? 700 : 0;

      setTimeout(() => {
        if (msg.role === "assistant") {
          setMessages(prev => [...prev, { role: "assistant", content: "", typing: true }]);
          setTimeout(() => {
            setMessages(prev => {
              const n = [...prev];
              n[n.length - 1] = { role: "assistant", content: msg.content };
              return n;
            });
            introIdx.current++;
            // wait for typewriter to finish before next message
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

  const handleTypewriterDone = useCallback((idx: number) => {
    setTypingDone(prev => ({ ...prev, [idx]: true }));
    // continue intro sequence after typewriter finishes
    if (introPlaying && introIdx.current < INTRO.length) {
      setTimeout(() => {
        const nextMsg = INTRO[introIdx.current];
        if (!nextMsg) { setIntroPlaying(false); return; }
        const delay = nextMsg.role === "user" ? 800 : 600;
        setTimeout(() => {
          if (nextMsg.role === "assistant") {
            setMessages(prev => [...prev, { role: "assistant", content: "", typing: true }]);
            setTimeout(() => {
              setMessages(prev => {
                const n = [...prev];
                n[n.length - 1] = { role: "assistant", content: nextMsg.content };
                return n;
              });
              introIdx.current++;
            }, 700);
          } else {
            setMessages(prev => [...prev, nextMsg]);
            introIdx.current++;
          }
        }, delay);
      }, 200);
    } else if (introIdx.current >= INTRO.length) {
      setIntroPlaying(false);
    }
  }, [introPlaying]);

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

  const lastMsg = messages[messages.length - 1];
  const showSuggestions = !introPlaying && lastMsg?.role === "assistant" && !lastMsg.typing && !loading;

  return (
    <div className="w-full mx-auto">
      {/* Violet glow ring around the chat frame */}
      <div
        className="overflow-hidden rounded-2xl border border-white/[.07]"
        style={{ boxShadow: "0 0 0 1px rgba(124,58,237,0.12), 0 24px 72px rgba(0,0,0,0.7), 0 0 60px rgba(124,58,237,0.08)" }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2.5 border-b border-white/[.05] bg-[#0b0b0b] px-4 py-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]"/>
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]"/>
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]"/>
          </div>
          <div className="flex-1 flex items-center justify-center gap-2">
            <AIAvatar thinking={loading} />
            <span className="font-mono text-[11px] text-zinc-500" style={{ letterSpacing: "0.18em" }}>
              MONDAILY AI
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/[.08] px-2.5 py-1">
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="h-1.5 w-1.5 rounded-full bg-violet-400"
            />
            <span className="font-mono text-[9px] font-semibold text-violet-400">Live</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex flex-col gap-4 px-5 py-5 min-h-[300px] max-h-[440px] overflow-y-auto bg-[#090909]">
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
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.05] border border-white/[.06] font-mono text-[10px] font-bold text-zinc-300">
                    You
                  </div>
                )}
                <div className={`max-w-[520px] rounded-2xl px-4 py-2.5 font-mono text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-tr-sm bg-violet-600/80 text-white"
                    : "rounded-tl-sm bg-white/[.04] text-zinc-200"
                }`}>
                  {m.typing ? (
                    <div className="flex gap-1 py-0.5">
                      {[0,1,2].map(j => (
                        <motion.span
                          key={j}
                          className="h-1.5 w-1.5 rounded-full bg-zinc-600"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.2 }}
                        />
                      ))}
                    </div>
                  ) : m.role === "assistant" && !typingDone[i] ? (
                    <Typewriter text={m.content} onDone={() => handleTypewriterDone(i)} />
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
              <span className="font-mono text-[11px] text-zinc-600 italic">Thinking…</span>
            </motion.div>
          )}

          {/* Suggestion chips */}
          <AnimatePresence>
            {showSuggestions && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex flex-wrap gap-2 pl-11"
              >
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-violet-500/20 bg-violet-500/[.06] px-3 py-1.5 font-mono text-[11px] text-violet-400 hover:border-violet-500/40 hover:bg-violet-500/[.12] hover:text-violet-300 transition-all"
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
        <div className="border-t border-white/[.05] bg-[#0b0b0b] px-4 py-3.5">
          <div className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3 focus-within:border-violet-500/30 transition-colors">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Ask Mondaily anything…"
              className="flex-1 bg-transparent font-mono text-[13px] text-white placeholder-zinc-700 outline-none"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-all hover:bg-violet-500 disabled:opacity-25 active:scale-95"
            >
              <SendIcon/>
            </button>
          </div>
          <p className="mt-2 text-center font-mono text-[10px] text-zinc-800">
            Powered by AI · Connected to your live workspace
          </p>
        </div>
      </div>
    </div>
  );
}
