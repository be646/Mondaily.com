"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";

// ── Preloader ─────────────────────────────────────────────────────────────────
const LOG_LINES = [
  { tag: "[MONDAILY]", msg: "Bootstrapping AI workspace...",                             col: "text-violet-400" },
  { tag: "[DB]",       msg: "Connected to relational data graph — edges_v2 matched",     col: "text-zinc-500"   },
  { tag: "[AI]",       msg: "Engine status: ACTIVE · model loaded · inference ready",    col: "text-violet-400" },
  { tag: "[DATA]",     msg: "Hydrating 42 company records from live web sources...",      col: "text-zinc-500"   },
  { tag: "[ENRICH]",   msg: "12 records enriched — ARR, headcount, signals · 0 errors",  col: "text-zinc-500"   },
  { tag: "[PIPELINE]", msg: "3 deals auto-advanced to next stage via activity rules",     col: "text-zinc-500"   },
  { tag: "[SEQ]",      msg: "Sequence engine running · 847 contacts enrolled",            col: "text-zinc-500"   },
  { tag: "[WS]",       msg: "Workspace ready — loading interface...",                     col: "text-violet-400" },
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
      <div className="w-full max-w-xl">
        {/* Logo + wordmark */}
        <div className="mb-8 flex items-center gap-4">
          <svg width="30" height="30" viewBox="0 0 160 160" fill="none" style={{ color: "white" }}>
            <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" opacity="0.9"/>
            <polygon points="80,28 122,52 122,108 80,132 38,108 38,52" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" opacity="0.35"/>
            <path d="M50,80 Q80,52 110,80 Q80,108 50,80Z" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round"/>
            <circle cx="80" cy="80" r="15" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.5"/>
            <circle cx="80" cy="80" r="6.5" fill="currentColor"/>
            <circle cx="80" cy="80" r="4" fill="#7c3aed" opacity="0.7"/>
          </svg>
          <span style={{ fontFamily: "'Montserrat', system-ui, sans-serif", fontWeight: 200, letterSpacing: "0.24em", fontSize: "0.85rem", textTransform: "uppercase", color: "white" }}>
            MONDAILY
          </span>
        </div>

        {/* Log output */}
        <div className="mb-6 h-48 overflow-hidden font-mono text-[11px] leading-6">
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex gap-3"
              >
                <span className="text-zinc-700">{l.stamp}</span>
                <span className={l.col}>{l.tag}</span>
                <span className="text-zinc-500">{l.msg}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="h-px w-full bg-white/[.05]">
          <motion.div
            className="h-px bg-violet-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px]">
          <span className="text-zinc-700">Initialising workspace</span>
          <span className="text-violet-600">{progress}%</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Animated motherboard feature section ──────────────────────────────────────
const BOARD_FEATURES = [
  { id: "ai",       label: "Ask AI",        desc: "Query your workspace in plain language",   violet: true,  x: 30,  y: 70  },
  { id: "crm",      label: "Living CRM",    desc: "Records that auto-fill from the web",      violet: false, x: 190, y: 30  },
  { id: "pipeline", label: "Pipeline",      desc: "Deals move via AI activity rules",         violet: false, x: 360, y: 70  },
  { id: "enrich",   label: "Enrichment",    desc: "ARR, headcount, signals — automated",      violet: true,  x: 190, y: 150 },
  { id: "seq",      label: "Sequences",     desc: "Multi-step cadences on autopilot",         violet: false, x: 510, y: 30  },
  { id: "auto",     label: "Automations",   desc: "Event-driven workflows — no code",         violet: false, x: 510, y: 150 },
  { id: "finance",  label: "Finance",       desc: "Invoices, credit notes, approvals",        violet: true,  x: 660, y: 70  },
  { id: "mcp",      label: "MCP Server",    desc: "Connect Claude & AI tools natively",       violet: true,  x: 660, y: 180 },
];

const BOARD_EDGES: [string, string][] = [
  ["ai", "crm"], ["ai", "enrich"], ["crm", "pipeline"], ["crm", "enrich"],
  ["pipeline", "seq"], ["pipeline", "auto"], ["enrich", "seq"],
  ["seq", "finance"], ["auto", "finance"], ["finance", "mcp"],
];

function MotherboardSection() {
  const [active, setActive] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const stepRef = useRef(0);

  const runSequence = useCallback(() => {
    const ids = BOARD_FEATURES.map(f => f.id);
    stepRef.current = 0;
    setActive(new Set());
    let i = 0;
    const inner = setInterval(() => {
      const id = ids[i];
      if (id) setActive(prev => { const n = new Set(prev); n.add(id); return n; });
      i++;
      if (i >= ids.length) clearInterval(inner);
    }, 320);
    return inner;
  }, []);

  useEffect(() => {
    const t = runSequence();
    const loop = setInterval(() => runSequence(), 8000);
    return () => { clearInterval(t); clearInterval(loop); };
  }, [runSequence]);

  const getNode = (id: string) => BOARD_FEATURES.find(f => f.id === id)!;

  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-3 font-mono text-[10px] text-zinc-700 tracking-widest uppercase">// system.features</div>
      <h2 className="mb-2 font-mono text-2xl font-light text-white">
        <span className="text-violet-400">{'>'}</span> One platform. Every signal.
      </h2>
      <p className="mb-14 font-mono text-[13px] text-zinc-600">Modules boot in sequence — watch the system come online.</p>

      <div className="relative w-full overflow-x-auto">
        <svg viewBox="0 0 800 260" className="w-full" style={{ minWidth: 680 }}>
          {BOARD_EDGES.map(([a, b], i) => {
            const na = getNode(a);
            const nb = getNode(b);
            const lit = active.has(a) && active.has(b);
            return (
              <motion.line
                key={i}
                x1={na.x + 56} y1={na.y + 18}
                x2={nb.x} y2={nb.y + 18}
                stroke={lit ? "#7c3aed" : "#1c1c1c"}
                strokeWidth={lit ? 1.5 : 1}
                strokeDasharray={lit ? undefined : "4 4"}
                animate={{ opacity: lit ? 0.7 : 0.2 }}
                transition={{ duration: 0.4 }}
              />
            );
          })}

          {BOARD_FEATURES.map(f => {
            const isActive = active.has(f.id);
            const isHov = hovered === f.id;
            return (
              <g
                key={f.id}
                transform={`translate(${f.x},${f.y})`}
                onMouseEnter={() => setHovered(f.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {isActive && (
                  <motion.rect
                    x="-4" y="-4" width="116" height="44"
                    rx="9" fill="#7c3aed"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.07 }}
                  />
                )}
                <motion.rect
                  x="0" y="0" width="108" height="36"
                  rx="6"
                  fill={isActive ? "#0f0f0f" : "#090909"}
                  stroke={isActive ? (f.violet ? "#7c3aed" : "rgba(255,255,255,0.22)") : "#181818"}
                  strokeWidth={isActive ? 1.5 : 1}
                  animate={{ opacity: isActive ? 1 : 0.3 }}
                  transition={{ duration: 0.35 }}
                />
                <motion.circle
                  cx="10" cy="18" r="3"
                  fill={isActive ? (f.violet ? "#7c3aed" : "#ffffff") : "#1e1e1e"}
                  animate={{ opacity: isActive ? [0.6, 1, 0.6] : 0.3 }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
                <text
                  x="21" y="23"
                  fill={isActive ? (f.violet ? "#a78bfa" : "#ffffff") : "#2a2a2a"}
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight={isActive ? "500" : "400"}
                >
                  {f.label}
                </text>

                {isHov && isActive && (
                  <g>
                    <rect x="0" y="42" width="168" height="28" rx="4" fill="#111" stroke="#7c3aed" strokeWidth="0.8" opacity="0.97"/>
                    <text x="8" y="60" fill="#a78bfa" fontSize="9" fontFamily="monospace">{f.desc}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

// ── Pricing data ───────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    desc: "For solo founders exploring the AI workspace.",
    cta: "Start free",
    href: "https://app.mondaily.com/sign-up",
    highlight: false,
    features: ["1 user", "500 contacts", "CRM & pipeline", "Ask Mondaily AI (100 credits/mo)", "1 email integration", "Community support"],
  },
  {
    name: "Pro",
    price: "$49",
    period: "per user / mo",
    desc: "For growing teams that want AI doing the heavy lifting.",
    cta: "Start Pro trial",
    href: "https://app.mondaily.com/sign-up?plan=pro",
    highlight: true,
    features: ["Unlimited contacts", "Full pipeline + AI scoring", "Sequences & automations", "Ask Mondaily AI (unlimited)", "AI enrichment (5,000 credits/mo)", "Priority support"],
  },
  {
    name: "Business",
    price: "$89",
    period: "per user / mo",
    desc: "For teams needing advanced controls and collaboration.",
    cta: "Start Business trial",
    href: "https://app.mondaily.com/sign-up?plan=business",
    highlight: false,
    features: ["Everything in Pro", "Custom objects & fields", "Role-based access control", "Finance module", "Webhook & API access", "Advanced reporting"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "talk to us",
    desc: "For large organisations needing SSO, compliance, and SLAs.",
    cta: "Contact sales",
    href: "mailto:sales@mondaily.com",
    highlight: false,
    features: ["Everything in Business", "SAML SSO & SCIM", "Audit log", "Data residency", "SLA & dedicated CSM", "Custom contract"],
  },
];

// ── Cookie banner ──────────────────────────────────────────────────────────────
function CookieBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem("mondaily_cookies")) setTimeout(() => setVisible(true), 1800);
  }, []);
  function accept() { localStorage.setItem("mondaily_cookies", "1"); setVisible(false); }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 w-full max-w-xl px-4"
        >
          <div className="flex items-center gap-4 rounded-xl border border-white/[.07] bg-[#0d0d0d] px-5 py-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.7)] font-mono text-[11px]">
            <span className="text-violet-500">[GDPR]</span>
            <span className="flex-1 text-zinc-500">We use essential cookies to operate this site. No tracking without consent.</span>
            <button onClick={accept} className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-violet-400 hover:bg-violet-500/20 transition-colors">Accept</button>
            <button onClick={() => setVisible(false)} className="shrink-0 text-zinc-700 hover:text-zinc-400 transition-colors">✕</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
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
        <header className="sticky top-0 z-40 border-b border-white/[.04] bg-[#080808]/85 backdrop-blur-md">
          <Nav />
        </header>

        <main>
          {/* ── Hero ── */}
          <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 20 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              {/* Live AI badge */}
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/[.07] px-4 py-1.5 font-mono text-xs text-violet-400">
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  className="h-1.5 w-1.5 rounded-full bg-violet-400"
                />
                Live AI workspace — no setup required
              </div>

              {/* Headline */}
              <h1 className="mx-auto mb-6 max-w-3xl font-mono text-5xl font-light leading-[1.12] tracking-tight md:text-6xl">
                One workspace.<br />
                <span className="text-zinc-400">Every signal.</span>{" "}
                <span className="text-violet-400">Always thinking.</span>
              </h1>

              <p className="mx-auto mb-8 max-w-xl font-mono text-[14px] leading-relaxed text-zinc-600">
                <span className="text-zinc-500">{"// "}</span>
                Mondaily connects your data, enriches your records, moves your deals, and runs your workflows — continuously, without manual input.
              </p>

              {/* CTAs */}
              <div className="mb-12 flex items-center justify-center gap-3">
                <a
                  href="https://app.mondaily.com/sign-up"
                  className="rounded-lg border border-violet-500/40 bg-violet-600 px-6 py-3 font-mono text-sm font-medium text-white hover:bg-violet-500 active:translate-y-[1px] transition-all"
                >
                  Start free →
                </a>
                <a
                  href="https://app.mondaily.com/sign-in"
                  className="rounded-lg border border-white/[.07] bg-white/[.03] px-6 py-3 font-mono text-sm text-zinc-400 hover:bg-white/[.06] hover:text-white transition-all"
                >
                  Sign in
                </a>
              </div>
            </motion.div>

            {/* AI chat */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 24 }}
              transition={{ duration: 0.7, delay: 0.4 }}
              className="mx-auto w-full max-w-3xl"
            >
              <div className="mb-3 text-left font-mono text-[10px] uppercase tracking-widest text-zinc-700">
                <span className="text-violet-700">{'>'}</span> mondaily.ai — ask anything about the platform
              </div>
              <HeroChat />
            </motion.div>
          </section>

          {/* ── Marquee ── */}
          <div className="relative overflow-hidden border-y border-white/[.04] py-3.5">
            <motion.div
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 32, repeat: Infinity, ease: "linear" }}
              className="flex gap-10 whitespace-nowrap font-mono text-[10px] font-medium text-zinc-800"
            >
              {["AI ENRICHMENT", "LIVING CRM", "DEAL PIPELINE", "EMAIL SEQUENCES", "FINANCE MODULE",
                "WORKFLOW BUILDER", "MCP SERVER", "REAL-TIME SIGNALS", "APPROVAL FLOWS",
                "AI ENRICHMENT", "LIVING CRM", "DEAL PIPELINE", "EMAIL SEQUENCES", "FINANCE MODULE",
                "WORKFLOW BUILDER", "MCP SERVER", "REAL-TIME SIGNALS", "APPROVAL FLOWS"].map((item, i) => (
                <span key={i} className="flex items-center gap-3">
                  <span className="h-1 w-1 rounded-full bg-violet-700/60"/>
                  {item}
                </span>
              ))}
            </motion.div>
          </div>

          {/* ── Motherboard feature planner ── */}
          <MotherboardSection />

          {/* ── Pricing ── */}
          <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
            <div className="mb-3 font-mono text-[10px] text-zinc-700 tracking-widest uppercase">// pricing.config</div>
            <h2 className="mb-2 font-mono text-2xl font-light text-white">
              <span className="text-violet-400">{'>'}</span> Simple, transparent pricing
            </h2>
            <p className="mb-12 font-mono text-[13px] text-zinc-600">Start free. Upgrade when you&apos;re ready. No hidden fees.</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {PLANS.map(plan => (
                <div
                  key={plan.name}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    plan.highlight
                      ? "border-violet-500/30 bg-violet-500/[.04] shadow-[0_0_48px_rgba(124,58,237,0.08)]"
                      : "border-white/[.06] bg-white/[.015]"
                  }`}
                >
                  {plan.highlight && (
                    <div className="mb-4 self-start rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 font-mono text-[10px] font-semibold text-violet-400 uppercase tracking-wider">
                      Most popular
                    </div>
                  )}
                  <div className="mb-1 font-mono text-sm text-zinc-400">{plan.name}</div>
                  <div className="mb-1 flex items-end gap-1">
                    <span className="font-mono text-3xl font-light text-white">{plan.price}</span>
                    {plan.price !== "Custom" && <span className="mb-1 font-mono text-xs text-zinc-600">/{plan.period}</span>}
                  </div>
                  {plan.price === "Custom" && <div className="mb-1 font-mono text-xs text-zinc-600">{plan.period}</div>}
                  <p className="mb-5 mt-2 font-mono text-[11px] leading-relaxed text-zinc-600">{plan.desc}</p>
                  <ul className="mb-6 flex-1 space-y-2">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 font-mono text-[11px] text-zinc-500">
                        <span className="mt-0.5 text-violet-600">›</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={plan.href}
                    className={`mt-auto rounded-xl py-2.5 text-center font-mono text-sm transition-all ${
                      plan.highlight
                        ? "border border-violet-500/40 bg-violet-600 text-white hover:bg-violet-500 active:translate-y-[1px]"
                        : "border border-white/[.07] bg-white/[.03] text-zinc-400 hover:bg-white/[.06] hover:text-white"
                    }`}
                  >
                    {plan.cta}
                  </a>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-white/[.04] bg-[#060606]">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3.5">
                <svg width="20" height="20" viewBox="0 0 160 160" fill="none" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <polygon points="80,10 140,45 140,115 80,150 20,115 20,45" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
                  <path d="M50,80 Q80,52 110,80 Q80,108 50,80Z" fill="none" stroke="currentColor" strokeWidth="2.8"/>
                  <circle cx="80" cy="80" r="6.5" fill="currentColor"/>
                  <circle cx="80" cy="80" r="4" fill="#7c3aed" opacity="0.6"/>
                </svg>
                <span style={{ fontFamily: "'Montserrat', system-ui, sans-serif", fontWeight: 200, letterSpacing: "0.24em", fontSize: "0.78rem", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>MONDAILY</span>
              </div>
              <div className="flex flex-wrap gap-6 font-mono text-xs text-zinc-700">
                <a href="/privacy" className="hover:text-zinc-400 transition-colors">Privacy</a>
                <a href="/terms" className="hover:text-zinc-400 transition-colors">Terms</a>
                <a href="/dpa" className="hover:text-zinc-400 transition-colors">DPA</a>
                <a href="mailto:support@mondaily.com" className="hover:text-zinc-400 transition-colors">Support</a>
              </div>
            </div>
            <div className="border-t border-white/[.03] pt-6 font-mono text-[11px] text-zinc-800">
              © {new Date().getFullYear()} Mondaily. All rights reserved.
            </div>
          </div>
        </footer>
      </motion.div>

      <CookieBanner />
    </>
  );
}
