"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };
const ORBIT: React.CSSProperties = { fontFamily: "'Orbitron', sans-serif" };

// ── Preloader ─────────────────────────────────────────────────────────────────
const LOG_LINES = [
  { tag: "[MONDAILY]", msg: "Bootstrapping AI workspace...",                           col: "text-violet-500" },
  { tag: "[DB]",       msg: "Connected to relational data graph — edges_v2 matched",   col: "text-zinc-600"   },
  { tag: "[AI]",       msg: "Engine status: ACTIVE · model loaded · inference ready",  col: "text-violet-500" },
  { tag: "[DATA]",     msg: "Hydrating 42 company records from live web sources...",    col: "text-zinc-600"   },
  { tag: "[ENRICH]",   msg: "12 records enriched — ARR, headcount, signals · 0 err",   col: "text-zinc-600"   },
  { tag: "[PIPELINE]", msg: "3 deals auto-advanced via activity rules",                 col: "text-zinc-600"   },
  { tag: "[SEQ]",      msg: "Sequence engine running · 847 contacts enrolled",          col: "text-zinc-600"   },
  { tag: "[WS]",       msg: "Workspace ready — loading interface...",                   col: "text-violet-500" },
];

function nowStamp() {
  const d = new Date();
  return `[${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}]`;
}

function Preloader({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<{ stamp: string; tag: string; msg: string; col: string }[]>([]);
  const [progress, setProgress] = useState(0);
  const [fade, setFade] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (idx.current < LOG_LINES.length) {
        const item = LOG_LINES[idx.current]!;
        setLines(prev => [...prev, { stamp: nowStamp(), ...item }]);
        setProgress(Math.round(((idx.current + 1) / LOG_LINES.length) * 100));
        idx.current++;
      } else {
        clearInterval(interval);
        setTimeout(() => setFade(true), 400);
        setTimeout(() => onDone(), 900);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [onDone]);

  return (
    <motion.div
      animate={{ opacity: fade ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#080808] p-8"
    >
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3.5">
          <svg width="32" height="32" viewBox="0 0 160 160" fill="none" style={{ color: "white" }}>
            <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" opacity="0.95"/>
            <path d="M48,80 Q80,50 112,80 Q80,110 48,80Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
            <circle cx="80" cy="80" r="7" fill="currentColor"/>
            <circle cx="80" cy="80" r="4.5" fill="#7c3aed" opacity="0.85"/>
          </svg>
          <span style={{ ...ORBIT, fontWeight: 400, fontSize: "0.9rem", letterSpacing: "0.18em", color: "white" }}>MONDAILY</span>
        </div>

        <div className="mb-6 h-44 overflow-hidden text-[11px] leading-6" style={MONO}>
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex gap-3">
                <span className="text-zinc-800">{l.stamp}</span>
                <span className={l.col}>{l.tag}</span>
                <span className="text-zinc-600">{l.msg}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="h-px w-full bg-white/[.04]">
          <motion.div className="h-px bg-violet-600" animate={{ width: `${progress}%` }} transition={{ duration: 0.25 }}/>
        </div>
        <div className="mt-2 flex justify-between text-[10px]" style={MONO}>
          <span className="text-zinc-800">Initialising workspace</span>
          <span className="text-violet-700">{progress}%</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Feature map with terminal sidebar ─────────────────────────────────────────
const NODES = [
  { id: "ai",       label: "Ask AI",       violet: true,  x: 0,   y: 60  },
  { id: "crm",      label: "CRM",          violet: false, x: 150, y: 20  },
  { id: "enrich",   label: "Enrichment",   violet: true,  x: 150, y: 110 },
  { id: "pipeline", label: "Pipeline",     violet: false, x: 290, y: 60  },
  { id: "seq",      label: "Sequences",    violet: false, x: 420, y: 20  },
  { id: "auto",     label: "Automations",  violet: false, x: 420, y: 110 },
  { id: "finance",  label: "Finance",      violet: true,  x: 550, y: 60  },
];

const EDGES: [string, string][] = [
  ["ai","crm"],["ai","enrich"],["crm","pipeline"],["enrich","pipeline"],
  ["pipeline","seq"],["pipeline","auto"],["seq","finance"],["auto","finance"],
];

const TERMINAL_LINES = [
  { cmd: "mondaily enrich",    out: "→ 47 companies enriched in 2.1s"             },
  { cmd: "pipeline.advance",   out: "→ deal #1482 moved to Negotiation via AI"    },
  { cmd: "sequence.trigger",   out: "→ 'Enterprise Nurture' enrolled 12 contacts" },
  { cmd: "ask 'top deals'",    out: "→ 3 deals > £80K, avg close in 18 days"      },
  { cmd: "finance.invoice",    out: "→ INV-0031 created · sent to client@co.com"  },
  { cmd: "automation.run",     out: "→ Slack alert sent · CRM record updated"     },
  { cmd: "enrich acme.com",    out: "→ ARR $4.2M · 210 employees · Series B"      },
  { cmd: "pipeline.score",     out: "→ AI health score updated for 9 deals"       },
];

function FeatureSection() {
  const [active, setActive] = useState<Set<string>>(new Set());
  const [termLines, setTermLines] = useState<{ cmd: string; out: string }[]>([]);
  const stepRef = useRef(0);
  const termRef = useRef(0);

  const runLoop = useCallback(() => {
    const ids = NODES.map(n => n.id);
    setActive(new Set());
    stepRef.current = 0;
    let i = 0;
    const seq = setInterval(() => {
      const id = ids[i];
      if (id) setActive(prev => { const n = new Set(prev); n.add(id); return n; });
      i++;
      if (i >= ids.length) clearInterval(seq);
    }, 340);
  }, []);

  useEffect(() => { runLoop(); const t = setInterval(runLoop, 9000); return () => clearInterval(t); }, [runLoop]);

  // Terminal scrolling lines
  useEffect(() => {
    const t = setInterval(() => {
      const line = TERMINAL_LINES[termRef.current % TERMINAL_LINES.length]!;
      setTermLines(prev => [...prev.slice(-6), line]);
      termRef.current++;
    }, 1800);
    return () => clearInterval(t);
  }, []);

  const getNode = (id: string) => NODES.find(n => n.id === id)!;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-2 text-[10px] text-zinc-800 tracking-widest uppercase" style={MONO}>// system.modules</div>
      <h2 className="mb-10 text-xl font-light text-zinc-300" style={MONO}>
        <span className="text-violet-600">{'>'}</span> One platform. Every signal.
      </h2>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Node map */}
        <div className="flex-1 overflow-x-auto">
          <svg viewBox="0 0 660 170" className="w-full" style={{ minWidth: 480 }}>
            {EDGES.map(([a, b], i) => {
              const na = getNode(a); const nb = getNode(b);
              const lit = active.has(a) && active.has(b);
              return (
                <motion.line
                  key={i}
                  x1={na.x + 50} y1={na.y + 15}
                  x2={nb.x} y2={nb.y + 15}
                  stroke={lit ? "#5b21b6" : "#161616"}
                  strokeWidth={lit ? 1 : 1}
                  strokeDasharray={lit ? undefined : "3 4"}
                  animate={{ opacity: lit ? 0.6 : 0.3 }}
                  transition={{ duration: 0.4 }}
                />
              );
            })}

            {NODES.map(f => {
              const on = active.has(f.id);
              return (
                <g key={f.id} transform={`translate(${f.x},${f.y})`}>
                  <motion.rect
                    x="0" y="0" width="96" height="30"
                    rx="5"
                    fill={on ? "#0e0e0e" : "#090909"}
                    stroke={on ? (f.violet ? "#5b21b6" : "rgba(255,255,255,0.15)") : "#141414"}
                    strokeWidth="1"
                    animate={{ opacity: on ? 1 : 0.28 }}
                    transition={{ duration: 0.3 }}
                  />
                  <motion.circle
                    cx="9" cy="15" r="2.5"
                    fill={on ? (f.violet ? "#7c3aed" : "#e4e4e7") : "#1e1e1e"}
                    animate={{ opacity: on ? [0.5, 1, 0.5] : 0.2 }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <text
                    x="19" y="20"
                    fill={on ? (f.violet ? "#8b5cf6" : "#d4d4d8") : "#262626"}
                    fontSize="9.5"
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {f.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Terminal sidebar */}
        <div
          className="w-full rounded-xl border border-white/[.05] bg-[#090909] p-4 lg:w-72"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
            </div>
            <span className="text-[10px] text-zinc-800">mondaily — live</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-700"
            />
          </div>
          <div className="space-y-2.5 text-[11px]">
            <AnimatePresence initial={false}>
              {termLines.map((line, i) => (
                <motion.div
                  key={`${i}-${line.cmd}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="text-violet-600"><span className="text-zinc-800">$ </span>{line.cmd}</div>
                  <div className="text-zinc-700">{line.out}</div>
                </motion.div>
              ))}
            </AnimatePresence>
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="inline-block h-3 w-1.5 bg-violet-700 align-middle"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: "Starter", price: "$0", period: "forever",
    desc: "For solo founders exploring the AI workspace.",
    cta: "Start free", href: "https://app.mondaily.com/sign-up", highlight: false,
    features: ["1 user","500 contacts","CRM & pipeline","Ask Mondaily AI (100 credits/mo)","1 email integration","Community support"],
  },
  {
    name: "Pro", price: "$49", period: "per user / mo",
    desc: "For growing teams that want AI doing the heavy lifting.",
    cta: "Start Pro trial", href: "https://app.mondaily.com/sign-up?plan=pro", highlight: true,
    features: ["Unlimited contacts","Full pipeline + AI scoring","Sequences & automations","Ask Mondaily AI (unlimited)","AI enrichment (5,000 credits/mo)","Priority support"],
  },
  {
    name: "Business", price: "$89", period: "per user / mo",
    desc: "For teams needing advanced controls and collaboration.",
    cta: "Start Business trial", href: "https://app.mondaily.com/sign-up?plan=business", highlight: false,
    features: ["Everything in Pro","Custom objects & fields","Role-based access control","Finance module","Webhook & API access","Advanced reporting"],
  },
  {
    name: "Enterprise", price: "Custom", period: "talk to us",
    desc: "For large organisations needing SSO, compliance, and SLAs.",
    cta: "Contact sales", href: "mailto:sales@mondaily.com", highlight: false,
    features: ["Everything in Business","SAML SSO & SCIM","Audit log","Data residency","SLA & dedicated CSM","Custom contract"],
  },
];

// ── Cookie banner ─────────────────────────────────────────────────────────────
function CookieBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!localStorage.getItem("mondaily_cookies")) setTimeout(() => setVisible(true), 2000); }, []);
  function accept() { localStorage.setItem("mondaily_cookies", "1"); setVisible(false); }
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 w-full max-w-lg px-4"
        >
          <div className="flex items-center gap-4 rounded-xl border border-white/[.06] bg-[#0c0c0c] px-5 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.7)] text-[11px]" style={MONO}>
            <span className="text-violet-700">[GDPR]</span>
            <span className="flex-1 text-zinc-700">Essential cookies only. No tracking without consent.</span>
            <button onClick={accept} className="shrink-0 rounded border border-violet-500/20 bg-violet-500/[.08] px-3 py-1.5 text-violet-500 hover:bg-violet-500/[.14] transition-colors">Accept</button>
            <button onClick={() => setVisible(false)} className="text-zinc-800 hover:text-zinc-500 transition-colors">✕</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function LandingPage() {
  const [ready, setReady] = useState(false);
  const handleDone = useCallback(() => setReady(true), []);

  return (
    <>
      {!ready && <Preloader onDone={handleDone} />}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="min-h-screen bg-[#080808] text-white"
      >
        <header className="sticky top-0 z-40 border-b border-white/[.04] bg-[#080808]/90 backdrop-blur-md">
          <Nav />
        </header>

        <main>
          {/* ── Hero ── */}
          <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 16 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              {/* Live badge */}
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/15 bg-violet-500/[.05] px-3.5 py-1.5 text-[11px] text-violet-500" style={MONO}>
                <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.8, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-violet-500"/>
                Live AI workspace · no setup required
              </div>

              {/* Slogan */}
              <h1 className="mx-auto mb-4 max-w-2xl font-light leading-[1.18] tracking-tight" style={{ ...MONO, fontSize: "clamp(1.6rem, 4vw, 2.6rem)" }}>
                One workspace.{" "}
                <span className="text-zinc-500">Every signal.</span>{" "}
                <span className="text-violet-500">Always thinking.</span>
              </h1>

              {/* Subheading */}
              <p className="mx-auto mb-8 max-w-md text-[12px] text-zinc-700" style={MONO}>
                <span className="text-zinc-800">{"// "}</span>
                autonomous · enriched · always on
              </p>

              {/* CTAs */}
              <div className="mb-10 flex items-center justify-center gap-3">
                <a href="https://app.mondaily.com/sign-up" className="rounded-lg border border-violet-500/30 bg-violet-600 px-5 py-2.5 text-[12px] font-medium text-white hover:bg-violet-500 active:translate-y-[1px] transition-all" style={MONO}>
                  Start free →
                </a>
                <a href="https://app.mondaily.com/sign-in" className="rounded-lg border border-white/[.06] bg-white/[.03] px-5 py-2.5 text-[12px] text-zinc-500 hover:text-white hover:bg-white/[.06] transition-all" style={MONO}>
                  Sign in
                </a>
              </div>
            </motion.div>

            {/* Search-bar chat */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 16 }}
              transition={{ duration: 0.6, delay: 0.35 }}
            >
              <HeroChat />
            </motion.div>
          </section>

          {/* ── Thin divider marquee ── */}
          <div className="relative overflow-hidden border-y border-white/[.03] py-3">
            <motion.div
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
              className="flex gap-10 whitespace-nowrap text-[10px] text-zinc-900"
              style={MONO}
            >
              {["AI ENRICHMENT","LIVING CRM","DEAL PIPELINE","EMAIL SEQUENCES","FINANCE MODULE",
                "WORKFLOW BUILDER","MCP SERVER","REAL-TIME SIGNALS","APPROVAL FLOWS",
                "AI ENRICHMENT","LIVING CRM","DEAL PIPELINE","EMAIL SEQUENCES","FINANCE MODULE",
                "WORKFLOW BUILDER","MCP SERVER","REAL-TIME SIGNALS","APPROVAL FLOWS"].map((item, i) => (
                <span key={i} className="flex items-center gap-3">
                  <span className="h-px w-3 bg-violet-900"/>
                  {item}
                </span>
              ))}
            </motion.div>
          </div>

          {/* ── Feature map + terminal ── */}
          <FeatureSection />

          {/* ── Pricing ── */}
          <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-2 text-[10px] text-zinc-800 tracking-widest uppercase" style={MONO}>// pricing.config</div>
            <h2 className="mb-2 text-xl font-light text-zinc-300" style={MONO}>
              <span className="text-violet-600">{'>'}</span> Simple, transparent pricing
            </h2>
            <p className="mb-10 text-[12px] text-zinc-700" style={MONO}>Start free. Upgrade when you&apos;re ready. No hidden fees.</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {PLANS.map(plan => (
                <div key={plan.name} className={`flex flex-col rounded-2xl border p-5 ${plan.highlight ? "border-violet-500/20 bg-violet-500/[.03] shadow-[0_0_40px_rgba(124,58,237,0.06)]" : "border-white/[.05] bg-white/[.01]"}`}>
                  {plan.highlight && (
                    <div className="mb-3 self-start rounded-full border border-violet-500/20 bg-violet-500/[.08] px-2.5 py-0.5 text-[10px] text-violet-500 uppercase tracking-wider" style={MONO}>
                      Most popular
                    </div>
                  )}
                  <div className="mb-1 text-[12px] text-zinc-500" style={MONO}>{plan.name}</div>
                  <div className="mb-1 flex items-end gap-1">
                    <span className="text-2xl font-light text-white" style={MONO}>{plan.price}</span>
                    {plan.price !== "Custom" && <span className="mb-1 text-[10px] text-zinc-700" style={MONO}>/{plan.period}</span>}
                  </div>
                  {plan.price === "Custom" && <div className="mb-1 text-[10px] text-zinc-700" style={MONO}>{plan.period}</div>}
                  <p className="mb-4 mt-1.5 text-[11px] leading-relaxed text-zinc-700" style={MONO}>{plan.desc}</p>
                  <ul className="mb-5 flex-1 space-y-1.5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-[11px] text-zinc-600" style={MONO}>
                        <span className="mt-0.5 text-violet-700">›</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a href={plan.href} className={`mt-auto rounded-lg py-2.5 text-center text-[12px] transition-all ${plan.highlight ? "border border-violet-500/30 bg-violet-600 text-white hover:bg-violet-500 active:translate-y-[1px]" : "border border-white/[.06] bg-white/[.02] text-zinc-500 hover:text-white hover:bg-white/[.05]"}`} style={MONO}>
                    {plan.cta}
                  </a>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-white/[.04] bg-[#060606]">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 160 160" fill="none" style={{ color: "rgba(255,255,255,0.25)" }}>
                  <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
                  <path d="M48,80 Q80,50 112,80 Q80,110 48,80Z" fill="none" stroke="currentColor" strokeWidth="2.8"/>
                  <circle cx="80" cy="80" r="6.5" fill="currentColor"/>
                  <circle cx="80" cy="80" r="4" fill="#7c3aed" opacity="0.5"/>
                </svg>
                <span style={{ ...ORBIT, fontWeight: 400, fontSize: "0.7rem", letterSpacing: "0.18em", color: "rgba(255,255,255,0.2)" }}>MONDAILY</span>
              </div>

              {/* Links */}
              <div className="flex flex-wrap gap-x-8 gap-y-3 text-[11px] text-zinc-800" style={MONO}>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-700 mb-1">Product</span>
                  <a href="#pricing" className="hover:text-zinc-400 transition-colors">Pricing</a>
                  <a href="/changelog" className="hover:text-zinc-400 transition-colors">Changelog</a>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-700 mb-1">Legal</span>
                  <a href="/privacy" className="hover:text-zinc-400 transition-colors">Privacy</a>
                  <a href="/terms" className="hover:text-zinc-400 transition-colors">Terms</a>
                  <a href="/dpa" className="hover:text-zinc-400 transition-colors">DPA</a>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-700 mb-1">Support</span>
                  <a href="mailto:support@mondaily.com" className="hover:text-zinc-400 transition-colors">support@mondaily.com</a>
                  <a href="mailto:sales@mondaily.com" className="hover:text-zinc-400 transition-colors">sales@mondaily.com</a>
                </div>
              </div>
            </div>
            <div className="border-t border-white/[.03] pt-5 text-[10px] text-zinc-900" style={MONO}>
              © {new Date().getFullYear()} Mondaily. All rights reserved.
            </div>
          </div>
        </footer>
      </motion.div>

      <CookieBanner />
    </>
  );
}
