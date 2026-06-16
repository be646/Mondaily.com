"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";
import { Logo } from "./logo";

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
          <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
            <rect x="6" y="6" width="88" height="88" rx="14" stroke="white" strokeWidth="1.5" fill="none" opacity="0.18"/>
            <polyline points="8,50 20,50 26,26 34,74 42,38 50,50 58,50 64,32 72,68 80,50 92,50" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="50" cy="50" r="5" fill="white"/>
            <circle cx="50" cy="50" r="9" stroke="white" strokeWidth="1.2" fill="none" opacity="0.35"/>
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
// viewBox: 0 0 1300 420   Node: 128×32
// Logical data flow order: crm → enrich → pipeline → sequences → ask → automations → finance → mcp
// All sub-text anchored RIGHT of node so nothing goes off left edge
// SVG render order: edges → dots → sub-text → nodes (text always on top)

const NW = 128;
const NH = 32;

const MAIN_NODES = [
  {
    id: "crm", label: "CRM",
    x: 60,  y: 194,
    // CRM subs go ABOVE and BELOW to avoid left-edge overflow
    subs: [
      { label: "Contacts & companies", ax: 60 + NW/2, ay: 154 },
      { label: "Activity timeline",    ax: 60 + NW/2, ay: 170 },
      { label: "Custom fields",        ax: 60 + NW/2, ay: 242 },
      { label: "Auto data sync",       ax: 60 + NW/2, ay: 258 },
      { label: "Smart dedup",          ax: 60 + NW/2, ay: 274 },
    ],
    subAnchor: "middle" as const,
  },
  {
    id: "enrich", label: "Enrichment",
    x: 300, y: 80,
    subs: [
      { label: "ARR & headcount",    ax: 300 + NW + 10, ay:  72 },
      { label: "Tech stack detect",  ax: 300 + NW + 10, ay:  88 },
      { label: "News signals",       ax: 300 + NW + 10, ay: 104 },
      { label: "Auto on record add", ax: 300 + NW + 10, ay: 120 },
    ],
    subAnchor: "start" as const,
  },
  {
    id: "pipeline", label: "Pipeline",
    x: 300, y: 308,
    subs: [
      { label: "AI deal scoring",   ax: 300 + NW + 10, ay: 300 },
      { label: "Stage automation",  ax: 300 + NW + 10, ay: 316 },
      { label: "Health alerts",     ax: 300 + NW + 10, ay: 332 },
      { label: "Win/loss analysis", ax: 300 + NW + 10, ay: 348 },
      { label: "Revenue forecast",  ax: 300 + NW + 10, ay: 364 },
    ],
    subAnchor: "start" as const,
  },
  {
    id: "sequences", label: "Sequences",
    x: 560, y: 80,
    subs: [
      { label: "Multi-step cadences",   ax: 560 + NW + 10, ay:  72 },
      { label: "Behaviour triggers",    ax: 560 + NW + 10, ay:  88 },
      { label: "A/B subject lines",     ax: 560 + NW + 10, ay: 104 },
      { label: "Open & click tracking", ax: 560 + NW + 10, ay: 120 },
    ],
    subAnchor: "start" as const,
  },
  {
    id: "ask", label: "Ask AI",
    x: 560, y: 194,
    subs: [
      { label: "Natural language queries", ax: 560 + NW + 10, ay: 186 },
      { label: "Workspace actions",        ax: 560 + NW + 10, ay: 202 },
      { label: "AI summaries",             ax: 560 + NW + 10, ay: 218 },
      { label: "Data insights",            ax: 560 + NW + 10, ay: 234 },
    ],
    subAnchor: "start" as const,
  },
  {
    id: "automations", label: "Automations",
    x: 560, y: 308,
    subs: [
      { label: "Event-driven rules",    ax: 560 + NW + 10, ay: 300 },
      { label: "Webhook actions",       ax: 560 + NW + 10, ay: 316 },
      { label: "Slack & email notify",  ax: 560 + NW + 10, ay: 332 },
      { label: "Conditional branching", ax: 560 + NW + 10, ay: 348 },
    ],
    subAnchor: "start" as const,
  },
  {
    id: "finance", label: "Finance",
    x: 900, y: 194,
    subs: [
      { label: "Invoices & quotes", ax: 900 + NW + 10, ay: 178 },
      { label: "Credit notes",      ax: 900 + NW + 10, ay: 194 },
      { label: "Expense tracking",  ax: 900 + NW + 10, ay: 210 },
      { label: "4-stage approvals", ax: 900 + NW + 10, ay: 226 },
      { label: "Revenue reporting", ax: 900 + NW + 10, ay: 242 },
    ],
    subAnchor: "start" as const,
  },
  {
    id: "mcp", label: "MCP Server",
    x: 900, y: 80,
    subs: [
      { label: "Claude integration", ax: 900 + NW + 10, ay:  72 },
      { label: "AI tool connect",    ax: 900 + NW + 10, ay:  88 },
      { label: "Native API access",  ax: 900 + NW + 10, ay: 104 },
    ],
    subAnchor: "start" as const,
  },
];

// Logical flow edges — ordered by real data flow
const MAIN_EDGES: [string,string][] = [
  ["crm","enrich"],
  ["crm","pipeline"],
  ["enrich","sequences"],
  ["enrich","ask"],
  ["pipeline","ask"],
  ["pipeline","automations"],
  ["sequences","finance"],
  ["sequences","mcp"],
  ["ask","finance"],
  ["ask","mcp"],
  ["automations","finance"],
];

// Logical animation order (real workflow)
const FLOW_ORDER = ["crm","enrich","pipeline","sequences","ask","automations","finance","mcp"];

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

  // Build a lookup: nodeId → all nodeIds it connects to (both directions)
  const connectedTo = useCallback((id: string): Set<string> => {
    const result = new Set<string>();
    MAIN_EDGES.forEach(([a, b]) => {
      if (a === id) result.add(b);
      if (b === id) result.add(a);
    });
    return result;
  }, []);

  function handleNodeEnter(id: string) {
    // Activate hovered node + all directly connected nodes
    const group = new Set([id, ...connectedTo(id)]);
    setActive(group);
  }

  function handleNodeLeave() {
    setActive(new Set());
  }

  const getNode = (id: string) => MAIN_NODES.find(n => n.id === id)!;

  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// system.modules</div>
      <h2 className="mb-4 font-mono text-xl font-light text-zinc-400">
        <span className="text-violet-600">{'>'}</span> One platform. Every signal.
      </h2>

      {/* Live stats bar — numbers pulse to signal the system is live */}
      <div className="mb-8 flex gap-6 font-mono text-[10px] text-zinc-600">
        <span>
          <motion.span animate={{ opacity: [0.5,1,0.5] }} transition={{ duration: 3, repeat: Infinity, delay: 0 }} className="text-violet-600">8,420</motion.span>
          {" "}records enriched
        </span>
        <span className="text-zinc-800">·</span>
        <span>
          <motion.span animate={{ opacity: [0.5,1,0.5] }} transition={{ duration: 3, repeat: Infinity, delay: 1 }} className="text-violet-600">234</motion.span>
          {" "}deals tracked
        </span>
        <span className="text-zinc-800">·</span>
        <span>
          <motion.span animate={{ opacity: [0.5,1,0.5] }} transition={{ duration: 3, repeat: Infinity, delay: 2 }} className="text-violet-600">12</motion.span>
          {" "}sequences running
        </span>
      </div>

      {/* Node map */}
      <p className="mb-4 font-mono text-[10px] text-zinc-800">// hover any module to explore its connections</p>
      <div className="mb-10 w-full overflow-hidden">
        <svg viewBox="0 0 1300 420" className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Faint dot grid background */}
          <defs>
            <pattern id="grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="0.8" fill="#1a1a1a"/>
            </pattern>
          </defs>
          <rect width="1300" height="420" fill="url(#grid)" opacity="0.5"/>

          {/* 1. EDGES */}
          {MAIN_EDGES.map(([a, b], i) => {
            const na = getNode(a); const nb = getNode(b);
            const anyHovered = active.size > 0;
            const lit = active.has(a) && active.has(b);
            const x1 = na.x + NW; const y1 = na.y + NH / 2;
            const x2 = nb.x;      const y2 = nb.y + NH / 2;
            const mx = (x1 + x2) / 2;
            // resting: visible dashed lines; hover: active edges go solid+bright, others dim
            const op = anyHovered ? (lit ? 0.85 : 0.08) : 0.28;
            return (
              <path key={i}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke={lit ? "#7c3aed" : "#444"}
                strokeWidth={lit ? 1.5 : 1}
                strokeDasharray={lit ? undefined : "4 6"}
                style={{ opacity: op, transition: "all 0.2s ease" }}
              />
            );
          })}

          {/* 2. Traveling dots */}
          {MAIN_EDGES.map(([a, b], i) => {
            const na = getNode(a); const nb = getNode(b);
            const lit = active.has(a) && active.has(b);
            const x1 = na.x + NW; const y1 = na.y + NH / 2;
            const x2 = nb.x;      const y2 = nb.y + NH / 2;
            const mx = (x1 + x2) / 2;
            return (
              <circle key={`dot-${i}`} r="3" fill="#7c3aed"
                style={{ opacity: lit ? 0.85 : 0, transition: "opacity 0.2s ease" }}>
                <animateMotion dur="2s" repeatCount="indefinite"
                  path={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}/>
              </circle>
            );
          })}

          {/* 3. Sub-branch lines + dots */}
          {MAIN_NODES.map(node => {
            const anyHovered = active.size > 0;
            const on = active.has(node.id);
            const cx = node.x + NW / 2;
            const cy = node.y + NH / 2;
            return node.subs.map((sub, si) => {
              const { ax, ay } = sub as { label: string; ax: number; ay: number };
              const anchor = node.subAnchor;
              const dotX = anchor === "start" ? ax - 4 : ax + 4;
              const lineOp = anyHovered ? (on ? 0.5 : 0.02) : 0.12;
              const dotOp  = anyHovered ? (on ? 0.7 : 0.02) : 0.15;
              return (
                <g key={`${node.id}-sl${si}`}>
                  <line x1={cx} y1={cy} x2={dotX} y2={ay}
                    stroke="#6d28d9" strokeWidth="0.8" strokeDasharray="2 3"
                    style={{ opacity: lineOp, transition: "opacity 0.2s ease" }}
                  />
                  <circle cx={dotX} cy={ay} r="1.8" fill="#6d28d9"
                    style={{ opacity: dotOp, transition: "opacity 0.2s ease" }}
                  />
                </g>
              );
            });
          })}

          {/* 4. Node boxes */}
          {MAIN_NODES.map(node => {
            const anyHovered = active.size > 0;
            const on = active.has(node.id);
            const nodeOp = anyHovered ? (on ? 1 : 0.25) : 0.75;
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => handleNodeEnter(node.id)}
                onMouseLeave={handleNodeLeave}
              >
                <rect x="-8" y="-8" width={NW + 16} height={NH + 16} fill="transparent"/>
                <rect x="0" y="0" width={NW} height={NH} rx="6"
                  fill="#0d0d0d"
                  stroke={on ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.07)"}
                  strokeWidth="1"
                  style={{ opacity: nodeOp, transition: "all 0.15s ease" }}
                />
                <circle cx="12" cy={NH / 2} r="3"
                  fill={on ? "#7c3aed" : "#333"}
                  style={{ transition: "fill 0.15s ease" }}
                />
              </g>
            );
          })}

          {/* 5. ALL text — final layer */}
          {MAIN_NODES.map(node => {
            const anyHovered = active.size > 0;
            const on = active.has(node.id);
            const col = on ? "#e4e4e7" : anyHovered ? "#2a2a2a" : "#666";
            return (
              <text key={`${node.id}-lbl`}
                x={node.x + 24} y={node.y + NH / 2 + 4}
                fill={col} fontSize="10"
                fontFamily="'JetBrains Mono', monospace"
                style={{ transition: "fill 0.15s ease" }}
              >
                {node.label}
              </text>
            );
          })}
          {MAIN_NODES.map(node => {
            const anyHovered = active.size > 0;
            const on = active.has(node.id);
            const subOp = anyHovered ? (on ? 0.5 : 0.02) : 0.18;
            return node.subs.map((sub, si) => {
              const { ax, ay } = sub as { label: string; ax: number; ay: number };
              const anchor = node.subAnchor;
              const dotX = anchor === "start" ? ax - 4 : ax + 4;
              return (
                <text key={`${node.id}-st${si}`}
                  x={anchor === "start" ? dotX + 6 : dotX - 6}
                  y={ay + 3.5} textAnchor={anchor}
                  fill="#fff" fontSize="9"
                  fontFamily="'JetBrains Mono', monospace"
                  style={{ opacity: subOp, transition: "opacity 0.15s ease" }}
                >
                  {sub.label}
                </text>
              );
            });
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

// ── Workflow demo section ─────────────────────────────────────────────────────
// Real Mondaily workflow: company added → enriched → scored → pipeline moved
// → sequence enrolled → automation fires → finance invoice created

const RECORD_FIELDS = [
  { key: "Company",    val: "Acme Corp",                delay: 0 },
  { key: "Domain",     val: "acme.com",                 delay: 120 },
  { key: "ARR",        val: "$4.2M",                    delay: 240 },
  { key: "Headcount",  val: "210 employees",            delay: 360 },
  { key: "Stage",      val: "Series B · London",        delay: 480 },
  { key: "Tech stack", val: "Stripe · AWS · HubSpot",   delay: 600 },
  { key: "Signal",     val: "→ Hiring 3 engineers (2d ago)", delay: 720 },
  { key: "AI Score",   val: "84 / 100  ████████░░",    delay: 840 },
];

const WORKFLOW_STEPS = [
  {
    tag: "[CRM]",
    tagCol: "#3f3f46",
    title: "Record added",
    detail: "acme.com · Sarah Johnson, Head of IT",
    delay: 400,
  },
  {
    tag: "[ENRICH]",
    tagCol: "#6d28d9",
    title: "AI enrichment fired",
    detail: "ARR $4.2M · 210 emp · Series B · London · Tech: Stripe, AWS",
    delay: 1100,
  },
  {
    tag: "[PIPELINE]",
    tagCol: "#6d28d9",
    title: "Deal scored 84/100 — moved to Proposal",
    detail: "High intent · stage: Discovery → Proposal · owner: you",
    delay: 1800,
  },
  {
    tag: "[SEQ]",
    tagCol: "#3f3f46",
    title: "Sequence enrolled: Enterprise Nurture",
    detail: "Step 1 sent · 4-step cadence · open tracked",
    delay: 2500,
  },
  {
    tag: "[AUTO]",
    tagCol: "#6d28d9",
    title: "Automation triggered on deal stage change",
    detail: "Slack notified · CRM updated · owner pinged",
    delay: 3200,
  },
  {
    tag: "[FINANCE]",
    tagCol: "#3f3f46",
    title: "Quote INV-0031 created",
    detail: "£8,400 · sent to sarah@acme.com · pending review",
    delay: 3900,
  },
];

const WORKFLOW_LOOP_MS = 3900 + 3000; // last step + pause before restart

function WorkflowDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [shownFields, setShownFields] = useState<number>(0);
  const [shownSteps, setShownSteps] = useState<number>(0);

  const runSeq = useCallback(() => {
    setShownFields(0);
    setShownSteps(0);
    const timers = [
      ...RECORD_FIELDS.map((f, i) => setTimeout(() => setShownFields(i + 1), 200 + f.delay)),
      ...WORKFLOW_STEPS.map((s, i) => setTimeout(() => setShownSteps(i + 1), s.delay)),
    ];
    return timers;
  }, []);

  useEffect(() => {
    const timers = runSeq();
    const loop = setInterval(runSeq, WORKFLOW_LOOP_MS);
    return () => { timers.forEach(clearTimeout); clearInterval(loop); };
  }, [runSeq]);

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// live.workflow</div>
      <h2 className="mb-2 font-mono text-xl font-light text-zinc-400">
        <span className="text-violet-600">{">"}</span> What happens when a record enters Mondaily
      </h2>
      <p className="mb-10 font-mono text-[11px] text-zinc-500">
        Zero manual input. The platform enriches, scores, moves, and notifies — automatically.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Left: enriched record card ── */}
        <div className="rounded-2xl border border-white/[.05] bg-[#0a0a0a] p-6 font-mono">
          {/* Card header */}
          <div className="mb-5 flex items-center justify-between border-b border-white/[.04] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-600/10 text-[10px] text-violet-500 font-bold">AC</div>
              <div>
                <div className="text-[13px] text-white font-medium">Acme Corp</div>
                <div className="text-[10px] text-zinc-600">acme.com</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="h-1.5 w-1.5 rounded-full bg-violet-600"
              />
              <span className="text-[10px] text-violet-700">enriched</span>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {RECORD_FIELDS.map((f, i) => (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: i < shownFields ? 1 : 0, x: i < shownFields ? 0 : -6 }}
                transition={{ duration: 0.3 }}
                className="flex items-baseline gap-3"
              >
                <span className="w-24 shrink-0 text-[10px] text-zinc-500">{f.key}</span>
                <span className={`text-[11px] ${f.key === "Signal" ? "text-violet-500" : f.key === "AI Score" ? "text-violet-400" : "text-zinc-300"}`}>
                  {f.val}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Contact row */}
          <div className="mt-5 border-t border-white/[.04] pt-4">
            <div className="text-[10px] text-zinc-500 mb-2">Contact</div>
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-400">SJ</div>
              <div>
                <div className="text-[11px] text-zinc-300">Sarah Johnson</div>
                <div className="text-[10px] text-zinc-500">Head of IT · sarah@acme.com</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: workflow log ── */}
        <div className="rounded-2xl border border-white/[.05] bg-[#0a0a0a] p-6 font-mono">
          {/* Window chrome */}
          <div className="mb-5 flex items-center gap-2 border-b border-white/[.04] pb-4">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
              <span className="h-2 w-2 rounded-full bg-zinc-800"/>
            </div>
            <span className="ml-2 text-[10px] text-zinc-700">mondaily — workflow engine</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-700"
            />
          </div>

          {/* Steps */}
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {WORKFLOW_STEPS.slice(0, shownSteps).map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="flex gap-3"
                >
                  {/* Step connector */}
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full mt-1 shrink-0" style={{ background: step.tagCol === "#6d28d9" ? "#6d28d9" : "#27272a" }}/>
                    {i < shownSteps - 1 && (
                      <div className="mt-1 flex-1 w-px bg-white/[.04] min-h-[20px]"/>
                    )}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px]" style={{ color: step.tagCol }}>{step.tag}</span>
                      <span className="text-[11px] text-zinc-300">{step.title}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 leading-relaxed">{step.detail}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Blinking cursor while running */}
            {shownSteps < WORKFLOW_STEPS.length && shownSteps > 0 && (
              <div className="flex items-center gap-2 pl-5">
                {[0,1,2].map(i => (
                  <motion.span key={i} className="h-1 w-1 rounded-full bg-violet-800"
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
                <span className="text-[10px] text-zinc-800 ml-1">processing…</span>
              </div>
            )}

            {/* All done */}
            {shownSteps >= WORKFLOW_STEPS.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-2 pl-5 pt-1"
              >
                <span className="text-[10px] text-violet-700">[DONE]</span>
                <span className="text-[10px] text-zinc-500">6 actions completed · 0 errors · 0 manual steps</span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Automation flow diagram ───────────────────────────────────────────────────
// Vertical flow: trigger → condition → branches → outcomes
// Mirrors Attio's workflow builder but in our dark/violet/mono aesthetic

const FLOW_NODES = [
  {
    id: "trigger",
    type: "trigger" as const,
    tag: "Trigger",
    label: "Deal stage updated",
    sub: "When any deal moves to Proposal or beyond",
    delay: 0,
  },
  {
    id: "score",
    type: "action" as const,
    tag: "AI · Score",
    label: "Score deal intent",
    sub: "AI reads activity, signals, ARR — outputs 0–100",
    delay: 600,
  },
  {
    id: "condition",
    type: "condition" as const,
    tag: "Condition",
    label: "Score ≥ 70?",
    sub: "Route high-intent vs nurture",
    delay: 1200,
    branches: [
      { label: "High intent", col: "#6d28d9" },
      { label: "Nurture", col: "#27272a" },
    ],
  },
  {
    id: "sequence",
    type: "action" as const,
    tag: "Sequences",
    label: "Enroll in Enterprise Nurture",
    sub: "4-step cadence · personalised by AI · open tracked",
    delay: 1900,
    branch: "left" as const,
  },
  {
    id: "slack",
    type: "action" as const,
    tag: "Automations",
    label: "Notify team on Slack",
    sub: '#deals · "High-intent deal — acme.com · 84/100"',
    delay: 2500,
    branch: "left" as const,
  },
  {
    id: "finance",
    type: "action" as const,
    tag: "Finance",
    label: "Create quote",
    sub: "INV-0031 · £8,400 · sent to sarah@acme.com",
    delay: 3100,
    branch: "left" as const,
  },
];

function FlowNode({ node, active, alwaysShow = false }: { node: typeof FLOW_NODES[number]; active: boolean; alwaysShow?: boolean }) {
  const isVisible = active || alwaysShow;
  const borderCol = active
    ? (node.type === "trigger" ? "border-violet-500/40" : node.type === "condition" ? "border-zinc-600/60" : "border-white/[.1]")
    : "border-white/[.04]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: active ? 1 : alwaysShow ? 0.55 : 0.22, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl border ${borderCol} bg-[#0a0a0a] px-5 py-3.5 font-mono`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[10px] ${active ? (node.type === "trigger" || node.type === "action" ? "text-violet-500" : "text-zinc-400") : "text-zinc-700"}`}>
          {node.tag}
        </span>
        {active && node.type !== "condition" && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[10px] text-violet-800">
            ✓ completed
          </motion.span>
        )}
        {active && node.type === "condition" && (
          <span className="text-[10px] text-violet-600">branching →</span>
        )}
      </div>
      <div className={`text-[12px] ${isVisible ? "text-white" : "text-zinc-600"}`}>{node.label}</div>
      <div className="mt-0.5 text-[10px] text-zinc-600 leading-relaxed">{node.sub}</div>
    </motion.div>
  );
}

function AutomationFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const [shownCount, setShownCount] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function startFlow() {
    // Clear any in-progress timers and restart from 0
    timersRef.current.forEach(clearTimeout);
    setShownCount(0);
    timersRef.current = FLOW_NODES.map((n, i) =>
      setTimeout(() => setShownCount(i + 1), n.delay + 200)
    );
  }

  function resetFlow() {
    timersRef.current.forEach(clearTimeout);
    setShownCount(0);
  }

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const Connector = ({ active, short }: { active: boolean; short?: boolean }) => (
    <div className="flex justify-center">
      <motion.div
        animate={{ opacity: active ? 1 : 0.08 }}
        transition={{ duration: 0.4 }}
        className={`w-px ${short ? "h-5" : "h-8"} bg-gradient-to-b from-violet-800/60 to-transparent`}
      />
    </div>
  );

  return (
    <section
      ref={ref}
      className="mx-auto max-w-6xl px-6 py-20"
      onMouseEnter={startFlow}
      onMouseLeave={resetFlow}
    >
      <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// automation.flow</div>
      <h2 className="mb-2 font-mono text-xl font-light text-zinc-400">
        <span className="text-violet-600">{">"}</span> Build once. Run on every deal, forever.
      </h2>
      <p className="mb-6 font-mono text-[11px] text-zinc-500">
        Visual flows that trigger on real CRM events — no code, no ops overhead.
      </p>
      <p className="mb-6 font-mono text-[10px] text-zinc-800">// hover to run the flow</p>

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        {/* Flow diagram */}
        <div className="min-w-0">
          {/* Trigger — always visible as anchor */}
          <FlowNode node={FLOW_NODES[0]!} active={shownCount >= 1} alwaysShow />
          <Connector active={shownCount >= 2} />
          <FlowNode node={FLOW_NODES[1]!} active={shownCount >= 2} />
          <Connector active={shownCount >= 3} />
          <FlowNode node={FLOW_NODES[2]!} active={shownCount >= 3} />

          {/* Branch labels */}
          <motion.div
            animate={{ opacity: shownCount >= 3 ? 1 : 0.06 }}
            transition={{ duration: 0.4 }}
            className="my-3 grid grid-cols-2 gap-4 font-mono"
          >
            <div className="flex justify-center">
              <span className="rounded-full border border-violet-500/20 bg-violet-600/10 px-3 py-0.5 text-[10px] text-violet-500">High intent</span>
            </div>
            <div className="flex justify-center">
              <span className="rounded-full border border-zinc-600/30 bg-zinc-700/10 px-3 py-0.5 text-[10px] text-zinc-400">Nurture</span>
            </div>
          </motion.div>

          {/* Two-column branch */}
          <div className="grid grid-cols-2 gap-4">
            {/* Left branch — high intent */}
            <div>
              <Connector active={shownCount >= 4} short />
              <FlowNode node={FLOW_NODES[3]!} active={shownCount >= 4} />
              <Connector active={shownCount >= 5} short />
              <FlowNode node={FLOW_NODES[4]!} active={shownCount >= 5} />
              <Connector active={shownCount >= 6} short />
              <FlowNode node={FLOW_NODES[5]!} active={shownCount >= 6} />
            </div>

            {/* Right branch — nurture (fully active, same animation timing) */}
            <div>
              <Connector active={shownCount >= 4} short />
              <FlowNode
                node={{ id: "nurture-seq", type: "action", tag: "Sequences", label: "Enroll in Cold Nurture", sub: "6-step · 21-day cadence · re-engagement flow", delay: 1900 }}
                active={shownCount >= 4}
              />
              <Connector active={shownCount >= 5} short />
              <FlowNode
                node={{ id: "nurture-auto", type: "action", tag: "Automations", label: "Tag as low-priority", sub: "CRM field updated · owner notified · review in 30d", delay: 2500 }}
                active={shownCount >= 5}
              />
            </div>
          </div>

          {/* Done state */}
          {shownCount >= FLOW_NODES.length && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mt-6 flex items-center gap-3 font-mono"
            >
              <div className="h-px flex-1 bg-white/[.04]"/>
              <span className="text-[10px] text-violet-800">[FLOW COMPLETE]</span>
              <div className="h-px flex-1 bg-white/[.04]"/>
            </motion.div>
          )}
        </div>

        {/* Right: stat callouts */}
        <div className="flex flex-col gap-4 font-mono">
          <div className="text-[10px] text-zinc-800 uppercase tracking-widest mb-2">// what this replaces</div>
          {[
            { before: "Manual scoring in a spreadsheet", after: "AI scores every deal in real-time", icon: "◈" },
            { before: "Forgetting to follow up",         after: "Sequences enroll automatically",   icon: "◈" },
            { before: "Chasing your team on Slack",      after: "Slack notified the moment it fires",icon: "◈" },
            { before: "Finance chasing the deal owner",  after: "Quote created and sent instantly",  icon: "◈" },
          ].map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: shownCount >= i + 2 ? 1 : 0.1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="rounded-xl border border-white/[.04] bg-[#0a0a0a] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-violet-700 text-[10px]">{row.icon}</span>
                <div>
                  <div className="text-[10px] text-zinc-600 line-through mb-0.5">{row.before}</div>
                  <div className="text-[11px] text-zinc-200">{row.after}</div>
                </div>
              </div>
            </motion.div>
          ))}

          <motion.a
            href="https://app.mondaily.com/sign-up"
            initial={{ opacity: 0 }}
            animate={{ opacity: shownCount >= FLOW_NODES.length ? 1 : 0 }}
            transition={{ duration: 0.5 }}
            className="mt-2 rounded-xl border border-violet-500/25 bg-violet-600/10 px-5 py-3 text-center text-[11px] text-violet-400 hover:bg-violet-600/20 hover:text-violet-200 transition-all"
          >
            Build your first flow →
          </motion.a>
        </div>
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
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-violet-500/[.07] px-3.5 py-1.5 font-mono text-[11px] text-violet-500">
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
                {"// "}<span className="text-zinc-500">autonomous · enriched · always on</span>
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
              className="mt-14"
            >
              <EmailSignup />
              <p className="mt-2.5 font-mono text-[10px] text-zinc-600">
                Free forever · no card required · upgrade anytime
              </p>
            </motion.div>
          </section>

          {/* ── Workflow demo ── */}
          <WorkflowDemo />

          {/* ── Automation flow diagram ── */}
          <AutomationFlow />

          {/* ── Feature map + terminals ── */}
          <FeatureSection />

          {/* ── Pricing ── */}
          <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-2 font-mono text-[10px] text-zinc-800 tracking-widest uppercase">// pricing.config</div>
            <h2 className="mb-2 font-mono text-xl font-light text-zinc-400">
              <span className="text-violet-600">{'>'}</span> Simple, transparent pricing
            </h2>
            <p className="mb-10 font-mono text-[12px] text-zinc-500">Start free. Upgrade when you&apos;re ready. No hidden fees.</p>
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
                  <p className="mb-4 mt-1.5 font-mono text-[10px] leading-relaxed text-zinc-500">{plan.desc}</p>
                  <ul className="mb-5 flex-1 space-y-1.5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 font-mono text-[10px] text-zinc-400">
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
                <div className="mb-3 opacity-60">
                  <Logo size={42} />
                </div>
                <p className="font-mono text-[10px] text-zinc-600 max-w-[200px] leading-relaxed">Autonomous AI workspace platform. Built for teams that move fast.</p>
              </div>

              <div className="flex flex-wrap gap-x-12 gap-y-6 font-mono text-[11px]">
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-500 mb-0.5">Product</span>
                  <a href="#pricing" className="text-zinc-600 hover:text-zinc-300 transition-colors">Pricing</a>
                  <a href="/changelog" className="text-zinc-600 hover:text-zinc-300 transition-colors">Changelog</a>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-500 mb-0.5">Legal</span>
                  <a href="/privacy" className="text-zinc-600 hover:text-zinc-300 transition-colors">Privacy</a>
                  <a href="/terms" className="text-zinc-600 hover:text-zinc-300 transition-colors">Terms</a>
                  <a href="/dpa" className="text-zinc-600 hover:text-zinc-300 transition-colors">DPA</a>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-500 mb-0.5">Contact</span>
                  <a href="mailto:support@mondaily.com" className="text-zinc-600 hover:text-zinc-300 transition-colors">Support</a>
                  <a href="mailto:sales@mondaily.com" className="text-zinc-600 hover:text-zinc-300 transition-colors">Sales</a>
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
