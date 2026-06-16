"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";

// ── Preloader ─────────────────────────────────────────────────────────────────
const LOG_LINES = [
  { tag: "[MONDAILY]", msg: "Bootstrapping AI workspace...",                           col: "#7c3aed" },
  { tag: "[DB]",       msg: "Connected to relational data graph — edges_v2 matched",   col: "#3f3f46" },
  { tag: "[AI]",       msg: "Engine status: ACTIVE · model loaded · inference ready",  col: "#7c3aed" },
  { tag: "[DATA]",     msg: "Hydrating 42 company records from live web sources...",    col: "#3f3f46" },
  { tag: "[ENRICH]",   msg: "12 records enriched — ARR, headcount, signals · 0 err",   col: "#3f3f46" },
  { tag: "[PIPELINE]", msg: "3 deals auto-advanced via activity rules",                 col: "#3f3f46" },
  { tag: "[SEQ]",      msg: "Sequence engine running · 847 contacts enrolled",          col: "#3f3f46" },
  { tag: "[WS]",       msg: "Workspace ready — loading interface...",                   col: "#7c3aed" },
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
        <div className="mb-8 flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 200 200" fill="none" style={{ color: "white", flexShrink: 0 }}>
            <polygon points="100,8 176,52 176,148 100,192 24,148 24,52" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/>
            <path d="M42,100 Q100,54 158,100 Q100,146 42,100Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/>
            <circle cx="100" cy="100" r="11" fill="currentColor"/>
            <circle cx="100" cy="100" r="7" fill="#7c3aed" opacity="0.9"/>
          </svg>
          <span className="font-orbitron text-white" style={{ fontWeight: 400, fontSize: "0.9rem", letterSpacing: "0.16em" }}>MONDAILY</span>
        </div>

        <div className="mb-6 h-44 overflow-hidden font-mono text-[11px] leading-6">
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex gap-3">
                <span className="text-zinc-800">{l.stamp}</span>
                <span style={{ color: l.col }}>{l.tag}</span>
                <span className="text-zinc-700">{l.msg}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="h-px w-full bg-white/[.04]">
          <motion.div className="h-px bg-violet-600" animate={{ width: `${progress}%` }} transition={{ duration: 0.25 }}/>
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px]">
          <span className="text-zinc-800">Initialising workspace</span>
          <span className="text-violet-700">{progress}%</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Feature section — node map + terminal windows ─────────────────────────────

// Main nodes and their real sub-features
const MAIN_NODES = [
  {
    id: "crm", label: "CRM", x: 60, y: 100,
    subs: ["Contacts & companies","Activity timeline","Custom fields","Auto data sync"],
  },
  {
    id: "enrich", label: "Enrichment", x: 220, y: 30,
    subs: ["ARR & headcount","Tech stack detect","News signals","Auto on record add"],
  },
  {
    id: "pipeline", label: "Pipeline", x: 220, y: 170,
    subs: ["AI deal scoring","Stage automation","Health alerts","Win/loss analysis"],
  },
  {
    id: "sequences", label: "Sequences", x: 390, y: 30,
    subs: ["Multi-step cadences","Behaviour triggers","A/B subject lines","Open & click tracking"],
  },
  {
    id: "automations", label: "Automations", x: 390, y: 170,
    subs: ["Event-driven rules","Webhook actions","Slack & email notify","Conditional branching"],
  },
  {
    id: "finance", label: "Finance", x: 560, y: 100,
    subs: ["Invoices & quotes","Credit notes","Expense tracking","4-stage approvals"],
  },
];

const MAIN_EDGES: [string,string][] = [
  ["crm","enrich"],["crm","pipeline"],
  ["enrich","sequences"],["pipeline","automations"],
  ["sequences","finance"],["automations","finance"],
];

// Terminal windows — 3 different panels
const TERM_STREAMS: { cmd: string; out: string }[][] = [
  [
    { cmd: "$ mondaily enrich acme.com",         out: "  ARR: $4.2M · 210 emp · Series B · London" },
    { cmd: "$ mondaily enrich stripe.com",        out: "  ARR: $3.1B · 7000 emp · Public · SF" },
    { cmd: "$ mondaily enrich linear.app",        out: "  ARR: ~$50M · 90 emp · Series B · SF" },
    { cmd: "$ mondaily enrich notion.so",         out: "  ARR: $330M · 600 emp · Series C · NY" },
  ],
  [
    { cmd: "$ pipeline.advance --deal 1482",      out: "  → Moved: Proposal → Negotiation (AI rule)" },
    { cmd: "$ pipeline.score --all",              out: "  → 9 deals rescored · 2 flagged at risk" },
    { cmd: "$ sequence.enroll --list enterprise", out: "  → 47 contacts enrolled in Enterprise Nurture" },
    { cmd: "$ ask 'which deals close this month'",out: "  → 3 deals · total £142K · avg 6 days left" },
  ],
  [
    { cmd: "$ finance.invoice --create",          out: "  → INV-0031 created · sent to client@co.io" },
    { cmd: "$ finance.approve INV-0031",          out: "  → Status: pending_review → verified" },
    { cmd: "$ automation.run --trigger deal_won", out: "  → Slack sent · Sequence enrolled · CRM updated" },
    { cmd: "$ finance.report --period Q2",        out: "  → Billed £84K · Collected £71K · 3 overdue" },
  ],
];

function TermWindow({ lines, title }: { lines: { cmd: string; out: string }[]; title: string }) {
  const [shown, setShown] = useState<{ cmd: string; out: string }[]>([]);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setShown([]);
    const t = setInterval(() => {
      const line = lines[idx.current % lines.length];
      if (line) setShown(prev => [...prev.slice(-3), line]);
      idx.current++;
    }, 2200);
    return () => clearInterval(t);
  }, [lines]);

  return (
    <div className="rounded-xl border border-white/[.05] bg-[#0a0a0a] p-4 font-mono text-[11px]">
      <div className="mb-3 flex items-center gap-2 border-b border-white/[.04] pb-2.5">
        <div className="flex gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-800"/>
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-800"/>
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-800"/>
        </div>
        <span className="text-zinc-800 text-[10px]">{title}</span>
        <motion.span animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 1.6, repeat: Infinity }} className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-800"/>
      </div>
      <div className="space-y-2 min-h-[80px]">
        <AnimatePresence initial={false}>
          {shown.map((l, i) => (
            <motion.div key={i + l.cmd} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <div className="text-violet-700">{l.cmd}</div>
              <div className="text-zinc-700">{l.out}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        <motion.span animate={{ opacity: [0,1,0] }} transition={{ duration: 1, repeat: Infinity }} className="inline-block h-3 w-1 bg-violet-800 align-middle"/>
      </div>
    </div>
  );
}

function FeatureSection() {
  const [active, setActive] = useState<Set<string>>(new Set());
  const stepRef = useRef(0);

  const runSeq = useCallback(() => {
    const ids = MAIN_NODES.map(n => n.id);
    setActive(new Set());
    let i = 0;
    const t = setInterval(() => {
      const id = ids[i];
      if (id) setActive(prev => { const s = new Set(prev); s.add(id); return s; });
      i++;
      if (i >= ids.length) clearInterval(t);
    }, 380);
    return t;
  }, []);

  useEffect(() => {
    const t = runSeq();
    const loop = setInterval(runSeq, 10000);
    return () => { clearInterval(t); clearInterval(loop); };
  }, [runSeq]);

  const getNode = (id: string) => MAIN_NODES.find(n => n.id === id)!;

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// system.modules</div>
      <h2 className="mb-10 font-mono text-xl font-light text-zinc-400">
        <span className="text-violet-600">{'>'}</span> One platform. Every signal.
      </h2>

      {/* Node map */}
      <div className="mb-10 overflow-x-auto">
        <svg viewBox="0 0 680 240" className="w-full" style={{ minWidth: 560 }}>
          {/* Edge lines */}
          {MAIN_EDGES.map(([a, b], i) => {
            const na = getNode(a); const nb = getNode(b);
            const lit = active.has(a) && active.has(b);
            const mx = (na.x + 52 + nb.x) / 2;
            return (
              <motion.path
                key={i}
                d={`M${na.x + 52},${na.y + 14} C${mx},${na.y + 14} ${mx},${nb.y + 14} ${nb.x},${nb.y + 14}`}
                fill="none"
                stroke={lit ? "#5b21b6" : "#161616"}
                strokeWidth="1"
                strokeDasharray={lit ? undefined : "4 5"}
                animate={{ opacity: lit ? 0.7 : 0.25 }}
                transition={{ duration: 0.45 }}
              />
            );
          })}

          {/* Animated dot traveling along active edges */}
          {MAIN_EDGES.map(([a, b], i) => {
            const na = getNode(a); const nb = getNode(b);
            const lit = active.has(a) && active.has(b);
            if (!lit) return null;
            const mx = (na.x + 52 + nb.x) / 2;
            return (
              <motion.circle
                key={`dot-${i}`}
                r="3"
                fill="#7c3aed"
                opacity="0.8"
              >
                <animateMotion
                  dur="1.8s"
                  repeatCount="indefinite"
                  path={`M${na.x + 52},${na.y + 14} C${mx},${na.y + 14} ${mx},${nb.y + 14} ${nb.x},${nb.y + 14}`}
                />
              </motion.circle>
            );
          })}

          {/* Sub-feature branches */}
          {MAIN_NODES.map(node => {
            const on = active.has(node.id);
            return node.subs.map((sub, si) => {
              const angle = -40 + si * 26;
              const rad = (angle * Math.PI) / 180;
              const ex = node.x + 54 + Math.cos(rad) * 72;
              const ey = node.y + 14 + Math.sin(rad) * 36;
              return (
                <g key={`${node.id}-sub-${si}`}>
                  <motion.line
                    x1={node.x + 54} y1={node.y + 14}
                    x2={ex} y2={ey}
                    stroke={on ? "#3b0764" : "#111"}
                    strokeWidth="0.8"
                    strokeDasharray="2 3"
                    animate={{ opacity: on ? 0.6 : 0.1 }}
                    transition={{ duration: 0.4, delay: si * 0.07 }}
                  />
                  <motion.circle cx={ex} cy={ey} r="1.5" fill={on ? "#6d28d9" : "#1a1a1a"} animate={{ opacity: on ? 0.7 : 0.1 }} transition={{ duration: 0.4 }}/>
                  <motion.text
                    x={ex + (Math.cos(rad) > 0 ? 4 : -4)}
                    y={ey + 3}
                    textAnchor={Math.cos(rad) > 0 ? "start" : "end"}
                    fill={on ? "#4c1d95" : "#1a1a1a"}
                    fontSize="7.5"
                    fontFamily="'JetBrains Mono', monospace"
                    animate={{ opacity: on ? 0.8 : 0.08 }}
                    transition={{ duration: 0.4, delay: si * 0.07 }}
                  >
                    {sub}
                  </motion.text>
                </g>
              );
            });
          })}

          {/* Main nodes */}
          {MAIN_NODES.map(node => {
            const on = active.has(node.id);
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                {on && (
                  <motion.rect x="-3" y="-3" width="110" height="34" rx="8" fill="#7c3aed" initial={{ opacity: 0 }} animate={{ opacity: 0.06 }}/>
                )}
                <motion.rect
                  x="0" y="0" width="104" height="28" rx="6"
                  fill={on ? "#0d0d0d" : "#090909"}
                  stroke={on ? "#5b21b6" : "#141414"}
                  strokeWidth="1"
                  animate={{ opacity: on ? 1 : 0.3 }}
                  transition={{ duration: 0.35 }}
                />
                <motion.circle cx="10" cy="14" r="2.5" fill={on ? "#7c3aed" : "#1e1e1e"} animate={{ opacity: on ? [0.5,1,0.5] : 0.2 }} transition={{ duration: 1.8, repeat: Infinity }}/>
                <text x="20" y="19" fill={on ? "#8b5cf6" : "#222"} fontSize="9" fontFamily="'JetBrains Mono', monospace" fontWeight={on ? "500" : "400"}>
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Three terminal windows */}
      <div className="grid gap-4 sm:grid-cols-3">
        {TERM_STREAMS.map((stream, i) => (
          <TermWindow
            key={i}
            lines={stream}
            title={["mondaily — enrichment", "mondaily — pipeline & AI", "mondaily — finance & ops"][i]!}
          />
        ))}
      </div>
    </section>
  );
}

// ── Email signup ──────────────────────────────────────────────────────────────
function EmailSignup() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    window.location.href = `https://app.mondaily.com/sign-up?email=${encodeURIComponent(email)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-md gap-2">
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="flex-1 rounded-lg border border-white/[.07] bg-white/[.03] px-4 py-2.5 font-mono text-[12px] text-white placeholder-zinc-700 outline-none focus:border-violet-500/30 transition-colors"
        required
      />
      <button
        type="submit"
        className="rounded-lg border border-violet-500/30 bg-violet-600 px-5 py-2.5 font-mono text-[12px] font-medium text-white hover:bg-violet-500 active:translate-y-[1px] transition-all whitespace-nowrap"
      >
        Start free →
      </button>
    </form>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: "Starter", price: "$0", period: "forever",
    desc: "For solo founders exploring the AI workspace.",
    cta: "Start free", href: "https://app.mondaily.com/sign-up", highlight: false,
    features: ["1 user","500 contacts","CRM & pipeline","Ask Mondaily AI (100/mo)","1 email integration","Community support"],
  },
  {
    name: "Pro", price: "$49", period: "per user / mo",
    desc: "For growing teams that want AI doing the heavy lifting.",
    cta: "Start Pro trial", href: "https://app.mondaily.com/sign-up?plan=pro", highlight: true,
    features: ["Unlimited contacts","Full pipeline + AI scoring","Sequences & automations","Ask Mondaily AI (unlimited)","AI enrichment (5,000/mo)","Priority support"],
  },
  {
    name: "Business", price: "$89", period: "per user / mo",
    desc: "For teams needing advanced controls and collaboration.",
    cta: "Start Business trial", href: "https://app.mondaily.com/sign-up?plan=business", highlight: false,
    features: ["Everything in Pro","Custom objects & fields","Role-based access","Finance module","Webhook & API","Advanced reporting"],
  },
  {
    name: "Enterprise", price: "Custom", period: "talk to us",
    desc: "For large organisations needing SSO and compliance.",
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
          <div className="flex items-center gap-4 rounded-xl border border-white/[.05] bg-[#0c0c0c] px-5 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.7)] font-mono text-[11px]">
            <span className="text-violet-800">[GDPR]</span>
            <span className="flex-1 text-zinc-800">Essential cookies only. No tracking without consent.</span>
            <button onClick={accept} className="shrink-0 rounded border border-violet-500/20 bg-violet-500/[.07] px-3 py-1.5 text-violet-600 hover:bg-violet-500/[.12] transition-colors">Accept</button>
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
          <section className="mx-auto max-w-3xl px-6 pb-20 pt-16 text-center">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 14 }}
              transition={{ duration: 0.55, delay: 0.2 }}
            >
              {/* Live badge */}
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/12 bg-violet-500/[.04] px-3.5 py-1.5 font-mono text-[11px] text-violet-600">
                <motion.span animate={{ opacity: [0.4,1,0.4] }} transition={{ duration: 1.8, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-violet-600"/>
                Live AI workspace · no setup required
              </div>

              {/* Slogan */}
              <h1 className="mx-auto mb-3 max-w-2xl font-light leading-[1.2] tracking-tight text-white" style={{ fontFamily: "var(--font-mono)", fontSize: "clamp(1.5rem, 3.5vw, 2.4rem)" }}>
                One workspace.{" "}
                <span className="text-zinc-600">Every signal.</span>{" "}
                <span className="text-violet-500">Always thinking.</span>
              </h1>

              {/* Subheading */}
              <p className="mx-auto mb-8 font-mono text-[11px] text-zinc-800">
                {"// "}<span className="text-zinc-700">autonomous · enriched · always on</span>
              </p>
            </motion.div>

            {/* Chat search bar */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 12 }}
              transition={{ duration: 0.55, delay: 0.32 }}
            >
              <HeroChat />
            </motion.div>

            {/* Email signup — placed after feature lines */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 10 }}
              transition={{ duration: 0.55, delay: 0.65 }}
              className="mt-8"
            >
              <EmailSignup />
              <p className="mt-2.5 font-mono text-[10px] text-zinc-800">
                Free forever · no card required · upgrade anytime
              </p>
            </motion.div>
          </section>

          {/* ── Feature map + terminals ── */}
          <FeatureSection />

          {/* ── Pricing ── */}
          <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// pricing.config</div>
            <h2 className="mb-2 font-mono text-xl font-light text-zinc-400">
              <span className="text-violet-600">{'>'}</span> Simple, transparent pricing
            </h2>
            <p className="mb-10 font-mono text-[12px] text-zinc-700">Start free. Upgrade when you&apos;re ready. No hidden fees.</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {PLANS.map(plan => (
                <div key={plan.name} className={`flex flex-col rounded-2xl border p-5 ${plan.highlight ? "border-violet-500/20 bg-violet-500/[.025] shadow-[0_0_40px_rgba(124,58,237,0.05)]" : "border-white/[.04] bg-white/[.01]"}`}>
                  {plan.highlight && (
                    <div className="mb-3 self-start rounded-full border border-violet-500/20 bg-violet-500/[.07] px-2.5 py-0.5 font-mono text-[10px] text-violet-600 uppercase tracking-wider">Most popular</div>
                  )}
                  <div className="mb-1 font-mono text-[11px] text-zinc-600">{plan.name}</div>
                  <div className="mb-1 flex items-end gap-1">
                    <span className="font-mono text-2xl font-light text-white">{plan.price}</span>
                    {plan.price !== "Custom" && <span className="mb-1 font-mono text-[10px] text-zinc-700">/{plan.period}</span>}
                  </div>
                  {plan.price === "Custom" && <div className="mb-1 font-mono text-[10px] text-zinc-700">{plan.period}</div>}
                  <p className="mb-4 mt-1.5 font-mono text-[10px] leading-relaxed text-zinc-700">{plan.desc}</p>
                  <ul className="mb-5 flex-1 space-y-1.5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 font-mono text-[10px] text-zinc-700">
                        <span className="mt-0.5 text-violet-700">›</span>{f}
                      </li>
                    ))}
                  </ul>
                  <a href={plan.href} className={`mt-auto rounded-lg py-2.5 text-center font-mono text-[11px] transition-all ${plan.highlight ? "border border-violet-500/25 bg-violet-600 text-white hover:bg-violet-500 active:translate-y-[1px]" : "border border-white/[.05] bg-white/[.02] text-zinc-600 hover:text-white hover:bg-white/[.05]"}`}>
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
            <div className="mb-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <svg width="16" height="16" viewBox="0 0 200 200" fill="none" style={{ color: "rgba(255,255,255,0.2)" }}>
                    <polygon points="100,8 176,52 176,148 100,192 24,148 24,52" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/>
                    <path d="M42,100 Q100,54 158,100 Q100,146 42,100Z" fill="none" stroke="currentColor" strokeWidth="3.5"/>
                    <circle cx="100" cy="100" r="10" fill="currentColor"/>
                    <circle cx="100" cy="100" r="6" fill="#5b21b6" opacity="0.5"/>
                  </svg>
                  <span className="font-orbitron text-[0.65rem]" style={{ letterSpacing: "0.16em", color: "rgba(255,255,255,0.18)", fontWeight: 400 }}>MONDAILY</span>
                </div>
                <p className="font-mono text-[10px] text-zinc-800 max-w-[180px] leading-relaxed">Autonomous AI workspace platform. Built for teams that move fast.</p>
              </div>

              <div className="flex flex-wrap gap-x-12 gap-y-6 font-mono text-[11px]">
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-700 mb-0.5">Product</span>
                  <a href="#pricing" className="text-zinc-800 hover:text-zinc-400 transition-colors">Pricing</a>
                  <a href="/changelog" className="text-zinc-800 hover:text-zinc-400 transition-colors">Changelog</a>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-700 mb-0.5">Legal</span>
                  <a href="/privacy" className="text-zinc-800 hover:text-zinc-400 transition-colors">Privacy</a>
                  <a href="/terms" className="text-zinc-800 hover:text-zinc-400 transition-colors">Terms</a>
                  <a href="/dpa" className="text-zinc-800 hover:text-zinc-400 transition-colors">DPA</a>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-700 mb-0.5">Contact</span>
                  <a href="mailto:support@mondaily.com" className="text-zinc-800 hover:text-zinc-400 transition-colors">Support</a>
                  <a href="mailto:sales@mondaily.com" className="text-zinc-800 hover:text-zinc-400 transition-colors">Sales</a>
                </div>
              </div>
            </div>
            <div className="border-t border-white/[.03] pt-5 font-mono text-[10px] text-zinc-900">
              © {new Date().getFullYear()} Mondaily. All rights reserved.
            </div>
          </div>
        </footer>
      </motion.div>

      <CookieBanner />
    </>
  );
}
