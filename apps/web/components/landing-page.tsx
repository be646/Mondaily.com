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

// Wider layout — all nodes and sub-text stay inside viewBox
// viewBox: 0 0 1100 320
// Each node: w=110 h=30
const MAIN_NODES = [
  {
    id: "crm", label: "CRM", x: 60, y: 145,
    subs: [
      { label: "Contacts & companies", dx: -8,  dy: -52 },
      { label: "Activity timeline",    dx: -8,  dy: -34 },
      { label: "Custom fields",        dx: -8,  dy: -16 },
      { label: "Auto data sync",       dx: -8,  dy:  48 },
      { label: "Smart dedup",          dx: -8,  dy:  66 },
    ],
    subDir: "left" as const,
  },
  {
    id: "enrich", label: "Enrichment", x: 280, y: 60,
    subs: [
      { label: "ARR & headcount",     dx: 8, dy: -36 },
      { label: "Tech stack detect",   dx: 8, dy: -18 },
      { label: "News signals",        dx: 8, dy:   0 },
      { label: "Auto on record add",  dx: 8, dy:  18 },
    ],
    subDir: "right" as const,
  },
  {
    id: "pipeline", label: "Pipeline", x: 280, y: 230,
    subs: [
      { label: "AI deal scoring",    dx: 8, dy: -18 },
      { label: "Stage automation",   dx: 8, dy:   0 },
      { label: "Health alerts",      dx: 8, dy:  18 },
      { label: "Win/loss analysis",  dx: 8, dy:  36 },
      { label: "Revenue forecast",   dx: 8, dy:  54 },
    ],
    subDir: "right" as const,
  },
  {
    id: "ask", label: "Ask AI", x: 510, y: 145,
    subs: [
      { label: "Natural language queries", dx: 8, dy: -36 },
      { label: "Workspace actions",        dx: 8, dy: -18 },
      { label: "AI summaries",             dx: 8, dy:   0 },
      { label: "Data insights",            dx: 8, dy:  18 },
    ],
    subDir: "right" as const,
  },
  {
    id: "sequences", label: "Sequences", x: 510, y: 60,
    subs: [
      { label: "Multi-step cadences",  dx: 8, dy: -36 },
      { label: "Behaviour triggers",   dx: 8, dy: -18 },
      { label: "A/B subject lines",    dx: 8, dy:   0 },
      { label: "Open & click tracking",dx: 8, dy:  18 },
    ],
    subDir: "right" as const,
  },
  {
    id: "automations", label: "Automations", x: 510, y: 230,
    subs: [
      { label: "Event-driven rules",   dx: 8, dy: -18 },
      { label: "Webhook actions",      dx: 8, dy:   0 },
      { label: "Slack & email notify", dx: 8, dy:  18 },
      { label: "Conditional branching",dx: 8, dy:  36 },
    ],
    subDir: "right" as const,
  },
  {
    id: "finance", label: "Finance", x: 800, y: 145,
    subs: [
      { label: "Invoices & quotes",  dx: 8, dy: -36 },
      { label: "Credit notes",       dx: 8, dy: -18 },
      { label: "Expense tracking",   dx: 8, dy:   0 },
      { label: "4-stage approvals",  dx: 8, dy:  18 },
      { label: "Revenue reporting",  dx: 8, dy:  36 },
    ],
    subDir: "right" as const,
  },
  {
    id: "mcp", label: "MCP Server", x: 800, y: 60,
    subs: [
      { label: "Claude integration",  dx: 8, dy: -18 },
      { label: "AI tool connect",     dx: 8, dy:   0 },
      { label: "Native API access",   dx: 8, dy:  18 },
    ],
    subDir: "right" as const,
  },
];

const MAIN_EDGES: [string,string][] = [
  ["crm","enrich"],["crm","pipeline"],["crm","ask"],
  ["enrich","sequences"],["enrich","ask"],
  ["pipeline","automations"],["pipeline","ask"],
  ["sequences","finance"],["automations","finance"],
  ["ask","finance"],["ask","mcp"],
  ["sequences","mcp"],
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

  const runSeq = useCallback(() => {
    const ids = MAIN_NODES.map(n => n.id);
    setActive(new Set());
    let i = 0;
    const t = setInterval(() => {
      const id = ids[i];
      if (id) setActive(prev => { const s = new Set(prev); s.add(id); return s; });
      i++;
      if (i >= ids.length) clearInterval(t);
    }, 350);
    return t;
  }, []);

  useEffect(() => {
    const t = runSeq();
    const loop = setInterval(runSeq, 11000);
    return () => { clearInterval(t); clearInterval(loop); };
  }, [runSeq]);

  const getNode = (id: string) => MAIN_NODES.find(n => n.id === id)!;
  const NW = 110; // node width
  const NH = 28;  // node height

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// system.modules</div>
      <h2 className="mb-10 font-mono text-xl font-light text-zinc-400">
        <span className="text-violet-600">{'>'}</span> One platform. Every signal.
      </h2>

      {/* Node map — viewBox wide enough to hold all sub-text */}
      <div className="mb-10 w-full overflow-hidden">
        <svg viewBox="0 0 1100 320" className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Edges */}
          {MAIN_EDGES.map(([a, b], i) => {
            const na = getNode(a); const nb = getNode(b);
            const lit = active.has(a) && active.has(b);
            const x1 = na.x + NW; const y1 = na.y + NH / 2;
            const x2 = nb.x;      const y2 = nb.y + NH / 2;
            const mx = (x1 + x2) / 2;
            return (
              <motion.path
                key={i}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke={lit ? "#3b0764" : "#141414"}
                strokeWidth={lit ? 1.2 : 1}
                strokeDasharray={lit ? undefined : "4 5"}
                animate={{ opacity: lit ? 0.8 : 0.3 }}
                transition={{ duration: 0.4 }}
              />
            );
          })}

          {/* Traveling dots on active edges */}
          {MAIN_EDGES.map(([a, b], i) => {
            const na = getNode(a); const nb = getNode(b);
            if (!active.has(a) || !active.has(b)) return null;
            const x1 = na.x + NW; const y1 = na.y + NH / 2;
            const x2 = nb.x;      const y2 = nb.y + NH / 2;
            const mx = (x1 + x2) / 2;
            return (
              <circle key={`dot-${i}`} r="2.5" fill="#6d28d9" opacity="0.7">
                <animateMotion dur="2s" repeatCount="indefinite"
                  path={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}/>
              </circle>
            );
          })}

          {/* Sub-feature branches — positioned using absolute dx/dy offsets */}
          {MAIN_NODES.map(node => {
            const on = active.has(node.id);
            const cx = node.subDir === "left" ? node.x : node.x + NW;
            const cy = node.y + NH / 2;
            return node.subs.map((sub, si) => {
              const tx = cx + sub.dx * (node.subDir === "left" ? 1 : 1);
              const ty = cy + sub.dy;
              const endX = node.subDir === "left" ? tx - 4 : tx + 4;
              return (
                <g key={`${node.id}-s${si}`}>
                  <motion.line
                    x1={cx} y1={cy} x2={endX} y2={ty}
                    stroke="#2e1065" strokeWidth="0.8" strokeDasharray="2 3"
                    animate={{ opacity: on ? 0.5 : 0.06 }}
                    transition={{ duration: 0.35, delay: si * 0.05 }}
                  />
                  <motion.circle cx={endX} cy={ty} r="1.5" fill="#4c1d95"
                    animate={{ opacity: on ? 0.6 : 0.05 }}
                    transition={{ duration: 0.35 }}
                  />
                  <motion.text
                    x={node.subDir === "left" ? endX - 6 : endX + 6}
                    y={ty + 3.5}
                    textAnchor={node.subDir === "left" ? "end" : "start"}
                    fill="#ffffff"
                    fontSize="8"
                    fontFamily="'JetBrains Mono', monospace"
                    animate={{ opacity: on ? 0.35 : 0.04 }}
                    transition={{ duration: 0.35, delay: si * 0.05 }}
                  >
                    {sub.label}
                  </motion.text>
                </g>
              );
            });
          })}

          {/* Main nodes — clean dark bg, white border when active, no purple fill */}
          {MAIN_NODES.map(node => {
            const on = active.has(node.id);
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                <motion.rect
                  x="0" y="0" width={NW} height={NH} rx="6"
                  fill="#0a0a0a"
                  stroke={on ? "rgba(255,255,255,0.18)" : "#1a1a1a"}
                  strokeWidth="1"
                  animate={{ opacity: on ? 1 : 0.3 }}
                  transition={{ duration: 0.3 }}
                />
                {/* Tiny violet dot indicator */}
                <motion.circle cx="11" cy={NH / 2} r="2.5"
                  fill={on ? "#7c3aed" : "#222"}
                  animate={{ opacity: on ? [0.6,1,0.6] : 0.2 }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <text
                  x="21" y={NH / 2 + 4}
                  fill={on ? "#d4d4d8" : "#2a2a2a"}
                  fontSize="9.5"
                  fontFamily="'JetBrains Mono', monospace"
                  fontWeight={on ? "500" : "400"}
                >
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
