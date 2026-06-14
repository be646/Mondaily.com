"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";

// ── Preloader ─────────────────────────────────────────────────────────────────
const LOG_LINES = [
  { tag: "[MONDAILY]", msg: "Bootstrapping AI workspace..." },
  { tag: "[DB]",       msg: "Connected to relational data graph — edges_v2 matched" },
  { tag: "[AI]",       msg: "Engine status: ACTIVE · model loaded" },
  { tag: "[DATA]",     msg: "Hydrating 42 company records from live web sources..." },
  { tag: "[ENRICH]",   msg: "12 records enriched with ARR, headcount, signals — 0 errors" },
  { tag: "[PIPELINE]", msg: "3 deals auto-advanced to next stage via activity rules" },
  { tag: "[SEQ]",      msg: "Sequence engine running · 847 contacts enrolled" },
  { tag: "[WS]",       msg: "Workspace ready — loading interface..." },
];

function nowStamp() {
  const d = new Date();
  return `[${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}]`;
}

function Preloader({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<{ stamp: string; tag: string; msg: string }[]>([]);
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
    }, 260);
    return () => clearInterval(interval);
  }, [onDone]);

  return (
    <motion.div
      animate={{ opacity: fade ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#090b0f] p-8"
    >
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="mb-8 flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="1" fill="none"/>
            <path d="M18 18 L18 2 A16 16 0 1 1 2.54 22.14 Z" fill="#f5820a"/>
            <circle cx="18" cy="18" r="7" fill="#090b0f"/>
            <circle cx="18" cy="18" r="2.5" fill="#f5820a"/>
          </svg>
          <span style={{ fontWeight: 200, letterSpacing: "0.22em", fontSize: "0.85rem", textTransform: "uppercase", color: "white" }}>MONDAILY</span>
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
                <span className="text-slate-600">{l.stamp}</span>
                <span className="text-orange-400">{l.tag}</span>
                <span className="text-slate-400">{l.msg}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="h-px w-full bg-white/[.06]">
          <motion.div
            className="h-px bg-orange-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-600">
          <span>Initialising workspace</span>
          <span>{progress}%</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Features data ─────────────────────────────────────────────────────────────
const FEATURES = [
  { label: "CRM",                   desc: "Living contact & company records that update themselves from the web.",         live: true  },
  { label: "Pipeline",              desc: "Visual deal board with AI-driven stage progression and health scores.",         live: true  },
  { label: "AI Enrichment",         desc: "Auto-fill ARR, headcount, tech stack, and news signals for any company.",      live: true  },
  { label: "Ask Mondaily AI",       desc: "Conversational AI over your workspace — query, summarise, and take action.",    live: true  },
  { label: "Email & Calendar",      desc: "Sync Gmail or Outlook. Log conversations, surface meeting context.",            live: true  },
  { label: "Sequences",             desc: "Multi-step email cadences triggered by behaviour, deal stage, or AI signal.",  live: true  },
  { label: "Automations",           desc: "Event-driven workflow builder — no code, any trigger, any action.",            live: true  },
  { label: "Objects",               desc: "Custom data objects beyond contacts: assets, projects, tickets.",               live: true  },
  { label: "Members & Roles",       desc: "Invite your team with granular role-based access controls.",                    live: true  },
  { label: "Reporting",             desc: "Live dashboards for pipeline, revenue, and sequence performance.",              live: false },
  { label: "Revenue Forecasting",   desc: "AI-powered quarterly and annual projections based on pipeline signals.",        live: false },
  { label: "Meeting Intelligence",  desc: "Auto-transcribe calls, extract action items, log to the CRM.",                 live: false },
  { label: "AI Outbound",           desc: "AI drafts personalised outreach from your CRM data and prospect signals.",     live: false },
  { label: "MCP Server",            desc: "Connect Mondaily to Claude, ChatGPT, and approved AI tools via MCP.",          live: true  },
];

// ── Pricing data ──────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "forever",
    desc: "For solo founders and individuals exploring AI-driven sales.",
    cta: "Start free",
    href: "https://app.mondaily.com/sign-up",
    highlight: false,
    features: ["1 user", "500 contacts", "Basic CRM & pipeline", "Ask Mondaily AI (100 credits/mo)", "1 email integration", "Community support"],
  },
  {
    name: "Pro",
    price: "$49",
    period: "per user / mo",
    desc: "For growing sales teams that want AI doing the heavy lifting.",
    cta: "Start Pro trial",
    href: "https://app.mondaily.com/sign-up?plan=pro",
    highlight: true,
    features: ["Unlimited contacts", "Full pipeline + AI scoring", "Sequences & automations", "Ask Mondaily AI (unlimited)", "All email integrations", "AI enrichment (5,000 credits/mo)", "Priority support"],
  },
  {
    name: "Business",
    price: "$89",
    period: "per user / mo",
    desc: "For revenue teams that need advanced controls and collaboration.",
    cta: "Start Business trial",
    href: "https://app.mondaily.com/sign-up?plan=business",
    highlight: false,
    features: ["Everything in Pro", "Custom objects & fields", "Role-based access control", "Webhook & API access", "MCP server integration", "Advanced reporting", "Dedicated onboarding"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "talk to us",
    desc: "For large organisations needing SSO, compliance, and SLAs.",
    cta: "Contact sales",
    href: "mailto:sales@mondaily.com",
    highlight: false,
    features: ["Everything in Business", "SAML SSO & SCIM", "Audit log", "Custom AI enrichment limits", "Data residency options", "SLA & dedicated CSM", "Custom contract"],
  },
];

// ── Cookie banner ─────────────────────────────────────────────────────────────
function CookieBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const accepted = localStorage.getItem("mondaily_cookies");
    if (!accepted) setTimeout(() => setVisible(true), 1200);
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
          <div className="flex items-center gap-4 rounded-xl border border-white/[.08] bg-[#0d0f13] px-5 py-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.6)] font-mono text-[11px]">
            <span className="text-orange-400">[GDPR]</span>
            <span className="flex-1 text-slate-400">We use essential cookies to operate this site. No tracking without consent.</span>
            <button onClick={accept} className="shrink-0 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-orange-400 hover:bg-orange-500/20 transition-colors">Accept</button>
            <button onClick={() => setVisible(false)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">✕</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────
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
        className="min-h-screen bg-[#090b0f] text-white"
      >
        {/* ── Sticky nav ── */}
        <header className="sticky top-0 z-40 border-b border-white/[.05] bg-[#090b0f]/80 backdrop-blur-md">
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
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/[.07] px-4 py-1.5 text-xs text-orange-300">
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  className="h-1.5 w-1.5 rounded-full bg-orange-400"
                />
                Live AI workspace — no setup required
              </div>

              <h1 className="mx-auto mb-6 max-w-3xl text-5xl font-semibold leading-[1.12] tracking-tight md:text-6xl">
                Your entire revenue motion,<br />
                <span className="text-orange-400">understood by AI.</span>
              </h1>

              <p className="mx-auto mb-8 max-w-xl text-lg text-slate-400 leading-relaxed">
                Mondaily replaces your CRM, sequences, and workflow tools with one AI system that enriches records, moves deals, and triggers automations — automatically.
              </p>

              <div className="mb-12 flex items-center justify-center gap-3">
                <a
                  href="https://app.mondaily.com/sign-up"
                  className="rounded-xl border-x border-t border-orange-400/40 border-b-[3px] border-b-orange-700 bg-orange-500 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-400 active:translate-y-[1px] transition-all"
                >
                  Start for free
                </a>
                <a
                  href="https://app.mondaily.com/sign-in"
                  className="rounded-xl border border-white/[.08] bg-white/[.04] px-6 py-3 text-sm font-medium text-slate-300 hover:bg-white/[.07] hover:text-white transition-all"
                >
                  Sign in
                </a>
              </div>
            </motion.div>

            {/* ── Wide embedded AI sales chat ── */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 24 }}
              transition={{ duration: 0.7, delay: 0.4 }}
              className="mx-auto w-full max-w-3xl"
            >
              <div className="mb-3 text-left text-xs text-slate-600 font-mono uppercase tracking-widest">Ask Mondaily — let AI show you what&apos;s possible</div>
              <HeroChat />
            </motion.div>
          </section>

          {/* ── Scroll marquee ── */}
          <div className="relative overflow-hidden border-y border-white/[.05] py-4">
            <motion.div
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
              className="flex gap-10 whitespace-nowrap text-[11px] font-medium text-slate-600"
            >
              {["AI ENRICHMENT", "CRM AUTOMATION", "DEAL PIPELINE", "EMAIL SEQUENCES", "REVENUE FORECASTING", "WORKFLOW BUILDER", "MCP SERVER", "REAL-TIME DATA", "SALES AI",
                "AI ENRICHMENT", "CRM AUTOMATION", "DEAL PIPELINE", "EMAIL SEQUENCES", "REVENUE FORECASTING", "WORKFLOW BUILDER", "MCP SERVER", "REAL-TIME DATA", "SALES AI"].map((item, i) => (
                <span key={i} className="flex items-center gap-3">
                  <span className="h-1 w-1 rounded-full bg-orange-500/50"/>
                  {item}
                </span>
              ))}
            </motion.div>
          </div>

          {/* ── Features ── */}
          <section id="features" className="mx-auto max-w-6xl px-6 py-24">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-3xl font-semibold tracking-tight">Everything your revenue team needs</h2>
              <p className="text-slate-400">Built today, shipping tomorrow — watch the platform grow.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(f => (
                <div
                  key={f.label}
                  className="group relative rounded-xl border border-white/[.07] bg-white/[.02] p-5 transition-colors hover:border-white/[.1] hover:bg-white/[.04]"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">{f.label}</span>
                    {f.live ? (
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Live</span>
                    ) : (
                      <span className="rounded-full border border-orange-500/20 bg-orange-500/[.07] px-2 py-0.5 text-[10px] font-medium text-orange-400">Coming soon</span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Pricing ── */}
          <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-3xl font-semibold tracking-tight">Simple, transparent pricing</h2>
              <p className="text-slate-400">Start free. Upgrade when you&apos;re ready. No hidden fees.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {PLANS.map(plan => (
                <div
                  key={plan.name}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    plan.highlight
                      ? "border-orange-500/40 bg-orange-500/[.04] shadow-[0_0_48px_rgba(245,130,10,0.1)]"
                      : "border-white/[.07] bg-white/[.02]"
                  }`}
                >
                  {plan.highlight && (
                    <div className="mb-4 self-start rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-semibold text-orange-400 uppercase tracking-wider">
                      Most popular
                    </div>
                  )}
                  <div className="mb-1 text-sm font-medium text-slate-300">{plan.name}</div>
                  <div className="mb-1 flex items-end gap-1">
                    <span className="text-3xl font-bold text-white">{plan.price}</span>
                    {plan.price !== "Custom" && <span className="mb-1 text-xs text-slate-500">/{plan.period}</span>}
                  </div>
                  {plan.price === "Custom" && <div className="mb-1 text-xs text-slate-500">{plan.period}</div>}
                  <p className="mb-5 mt-2 text-xs leading-relaxed text-slate-500">{plan.desc}</p>
                  <ul className="mb-6 flex-1 space-y-2">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-xs text-slate-400">
                        <svg className="mt-0.5 shrink-0 text-orange-400" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={plan.href}
                    className={`mt-auto rounded-xl py-2.5 text-center text-sm font-medium transition-all ${
                      plan.highlight
                        ? "border-x border-t border-orange-400/40 border-b-[3px] border-b-orange-700 bg-orange-500 text-white hover:bg-orange-400 active:translate-y-[1px]"
                        : "border border-white/[.08] bg-white/[.04] text-slate-300 hover:bg-white/[.08] hover:text-white"
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
        <footer className="border-t border-white/[.05] bg-[#060709]">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <svg width="24" height="24" viewBox="0 0 36 36" fill="none">
                  <circle cx="18" cy="18" r="16" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none"/>
                  <path d="M18 18 L18 2 A16 16 0 1 1 2.54 22.14 Z" fill="#f5820a"/>
                  <circle cx="18" cy="18" r="7" fill="#060709"/>
                  <circle cx="18" cy="18" r="2.5" fill="#f5820a"/>
                </svg>
                <span style={{ fontWeight: 200, letterSpacing: "0.22em", fontSize: "0.8rem", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>MONDAILY</span>
              </div>
              <div className="flex flex-wrap gap-6 text-xs text-slate-600">
                <a href="/privacy" className="hover:text-slate-400 transition-colors">Privacy Policy</a>
                <a href="/terms" className="hover:text-slate-400 transition-colors">Terms of Service</a>
                <a href="/dpa" className="hover:text-slate-400 transition-colors">DPA</a>
                <a href="/ccpa" className="hover:text-slate-400 transition-colors">Do Not Sell My Data</a>
                <a href="mailto:support@mondaily.com" className="hover:text-slate-400 transition-colors">Support</a>
              </div>
            </div>
            <div className="border-t border-white/[.04] pt-6 text-[11px] text-slate-700">
              © {new Date().getFullYear()} Mondaily. All rights reserved. Built for revenue teams that move fast.
            </div>
          </div>
        </footer>
      </motion.div>

      <CookieBanner />
    </>
  );
}
