"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";
import { Logo } from "./logo";

// ── Preloader — calm, premium, but alive: a small animated graph of nodes
// lighting up in sequence (the workspace graph "waking up"), with cycling
// plain-language status text. No boot-log brackets, no timestamps — just
// motion that reads as AI-native rather than a terminal. ───────────────────
const PRELOADER_STATUS = [
  "Connecting to your workspace graph",
  "Waking agents",
  "Loading records",
  "Ready",
];
const PRELOADER_NODES = [
  { x: 50, y: 14 }, { x: 86, y: 50 }, { x: 50, y: 86 }, { x: 14, y: 50 },
];

function Preloader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [fade, setFade] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const litCount = Math.min(Math.floor((progress / 100) * (PRELOADER_NODES.length + 1)), PRELOADER_NODES.length);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        const next = Math.min(p + 14 + Math.random() * 10, 100);
        setStatusIdx(Math.min(Math.floor((next / 100) * PRELOADER_STATUS.length), PRELOADER_STATUS.length - 1));
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(() => setFade(true), 300);
          setTimeout(() => onDone(), 600);
        }
        return next;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [onDone]);

  return (
    <motion.div
      animate={{ opacity: fade ? 0 : 1 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-8"
    >
      <div className="w-full max-w-sm">
        <div className="mb-2 flex items-center justify-center">
          <Logo size={32} />
        </div>

        {/* Animated graph core — nodes light up around a center as progress advances */}
        <div className="relative mx-auto mb-6 h-28 w-28">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            {PRELOADER_NODES.map((n, i) => (
              <motion.line
                key={i}
                x1={50} y1={50} x2={n.x} y2={n.y}
                stroke="#6366f1"
                strokeWidth={1}
                initial={{ opacity: 0.08 }}
                animate={{ opacity: i < litCount ? 0.5 : 0.08 }}
                transition={{ duration: 0.4 }}
              />
            ))}
          </svg>
          <motion.span
            animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500"
          />
          {PRELOADER_NODES.map((n, i) => (
            <motion.span
              key={i}
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${n.x}%`, top: `${n.y}%`, background: i < litCount ? "#6366f1" : "#d4d4d8" }}
              animate={i < litCount ? { scale: [1, 1.4, 1] } : { scale: 1 }}
              transition={{ duration: 0.5 }}
            />
          ))}
        </div>

        <div className="h-px w-full bg-black/[.06]">
          <motion.div className="h-px bg-indigo-500" animate={{ width: `${progress}%` }} transition={{ duration: 0.25 }}/>
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={statusIdx}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="mt-3 text-center text-[13px] text-zinc-400"
          >
            {PRELOADER_STATUS[statusIdx]}…
          </motion.p>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Feature section — node map + terminal windows ─────────────────────────────
// viewBox: 0 0 1300 420   Node: 128×32
// Logical data flow order: crm → enrich → pipeline → sequences → ask → automations → finance → mcp
// All sub-text anchored RIGHT of node so nothing goes off left edge
// SVG render order: edges → dots → sub-text → nodes (text always on top)

const NW = 150;
const NH = 40;

const MAIN_NODES = [
  {
    id: "crm", label: "Records",
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
    id: "pipeline", label: "Opportunity flow",
    x: 300, y: 308,
    subs: [
      { label: "Relationship health", ax: 300 + NW + 10, ay: 300 },
      { label: "Stage tracking",    ax: 300 + NW + 10, ay: 316 },
      { label: "Health alerts",     ax: 300 + NW + 10, ay: 332 },
      { label: "Decision queue",    ax: 300 + NW + 10, ay: 348 },
      { label: "Source-backed signals", ax: 300 + NW + 10, ay: 364 },
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

// Footer ticker — slow scrolling log-line stream, same mono/terminal language as the rest of the page
const FOOTER_TICKER_LINES = [
  "One workspace graph for records, tasks, finance, and decisions",
  "Agents read, recommend, and prepare — you approve",
  "Every answer comes with the source it came from",
  "Built for any workspace graph, not just sales pipelines",
  "Graph Agent · Operations Agent · Relationship Agent · Finance Agent — always watching",
  "Source-backed signals, never a guess presented as fact",
];

function FooterTicker() {
  const line = (text: string, i: number) => (
    <span key={i} className="inline-flex items-center gap-2 px-6">
      <span className="relative flex h-1.5 w-1.5">
        <motion.span
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: (i % 6) * 0.3 }}
          className="absolute inline-flex h-full w-full rounded-full bg-indigo-400"
        />
      </span>
      <span className="text-[12px] text-zinc-400">{text}</span>
    </span>
  );
  return (
    <div className="relative h-7 overflow-hidden border-b border-black/[.04]" style={{
      maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
      WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
    }}>
      <motion.div
        className="absolute top-0 left-0 flex h-7 items-center whitespace-nowrap"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
      >
        {FOOTER_TICKER_LINES.map(line)}
        {FOOTER_TICKER_LINES.map((l, i) => line(l, i + FOOTER_TICKER_LINES.length))}
      </motion.div>
    </div>
  );
}

const MODULE_ZONES: { zone: string; ids: string[]; accent: string }[] = [
  { zone: "Data",         ids: ["crm", "enrich"],          accent: "#4f46e5" },
  { zone: "Intelligence", ids: ["pipeline", "ask"],        accent: "#7c3aed" },
  { zone: "Action",       ids: ["sequences", "automations"], accent: "#d97706" },
  { zone: "Operations",   ids: ["finance", "mcp"],         accent: "#059669" },
];

function LiveStat({ start, step, intervalMs }: { start: number; step: [number, number]; intervalMs: number }) {
  const [value, setValue] = useState(start);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setValue(v => v + (step[0] + Math.floor(Math.random() * (step[1] - step[0] + 1))));
      setBump(true);
      setTimeout(() => setBump(false), 400);
    }, intervalMs);
    return () => clearInterval(t);
  }, [step, intervalMs]);

  return (
    <motion.span
      animate={{ opacity: [0.5, 1, 0.5], scale: bump ? [1, 1.08, 1] : 1 }}
      transition={{ opacity: { duration: 3, repeat: Infinity }, scale: { duration: 0.4 } }}
      className="text-indigo-600"
    >
      {value.toLocaleString()}
    </motion.span>
  );
}

function FeatureSection() {
  const [active, setActive] = useState<string | null>(null);
  const getNode = (id: string) => MAIN_NODES.find(n => n.id === id)!;

  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">One workspace graph</p>
      <h2 className="mb-4 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Every part of the business, one connected graph
      </h2>

      {/* Live stats bar — numbers pulse to signal the system is live */}
      <div className="mb-10 flex gap-6 text-[14px] text-zinc-600">
        <span>
          <LiveStat start={8420} step={[1, 3]} intervalMs={4200} />
          {" "}records enriched
        </span>
        <span className="text-zinc-500">·</span>
        <span>
          <LiveStat start={234} step={[0, 1]} intervalMs={6500} />
          {" "}opportunities tracked
        </span>
        <span className="text-zinc-500">·</span>
        <span>
          <LiveStat start={12} step={[0, 1]} intervalMs={9000} />
          {" "}sequences running
        </span>
      </div>

      {/* Module grid — grouped by zone */}
      <div className="mb-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {MODULE_ZONES.map((z, zi) => (
          <div key={z.zone} className="flex flex-col gap-3">
            <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: z.accent }}>{z.zone}</span>
            {z.ids.map((id, ii) => {
              const node = getNode(id);
              const on = active === id;
              return (
                <motion.div
                  key={id}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.35, delay: (zi * 2 + ii) * 0.06 }}
                  whileHover={{ y: -2 }}
                  onMouseEnter={() => setActive(id)}
                  onMouseLeave={() => setActive(null)}
                  className="rounded-xl border p-4 transition-colors cursor-default"
                  style={{
                    borderColor: on ? `${z.accent}4d` : "rgba(0,0,0,.05)",
                    background: on ? `${z.accent}0a` : "rgba(0,0,0,.015)",
                  }}
                >
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full transition-colors" style={{ background: on ? z.accent : "#d4d4d8" }}/>
                    <span className={`text-[14px] font-semibold transition-colors ${on ? "text-zinc-800" : "text-zinc-600"}`}>{node.label}</span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {node.subs.slice(0, 3).map((sub, si) => (
                      <li key={si} className="text-[12px] text-zinc-500 leading-relaxed">{sub.label}</li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>

      {/* What Mondaily does automatically — broad, honest, no terminal-log
          theatrics. Each line maps to a real job/route in the product. */}
      <div className="rounded-2xl border border-black/[.05] bg-zinc-50/60 p-6 sm:p-8">
        <p className="mb-4 text-[13px] font-medium uppercase tracking-widest text-zinc-500">What Mondaily does automatically</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            "Turns messy records into one connected workspace graph",
            "Enriches new records with source-backed data from the web",
            "Finds signals and explains what changed, with evidence",
            "Drafts tasks, messages, and workflows for your approval",
            "Watches finance, decisions, and operations continuously",
            "Discovers new candidates and assets when you ask the Prospecting Agent",
          ].map(line => (
            <div key={line} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"/>
              <p className="text-[14px] leading-relaxed text-zinc-700">{line}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Workflow demo section ─────────────────────────────────────────────────────
// Real Mondaily workflow: company added → enriched → scored → pipeline moved
// → sequence enrolled → automation fires → finance invoice created

const RECORD_SCENARIOS = [
  {
    company: "Acme Corp", domain: "acme.com", initials: "AC",
    contact: { name: "Sarah Johnson", role: "Head of IT", email: "sarah@acme.com" },
    quoteId: "INV-0031", quoteAmount: "£8,400",
    fields: [
      { key: "Company",    val: "Acme Corp" },
      { key: "Domain",     val: "acme.com" },
      { key: "ARR",        val: "$4.2M" },
      { key: "Headcount",  val: "210 employees" },
      { key: "Stage",      val: "Series B · London" },
      { key: "Tech stack", val: "Stripe · AWS · HubSpot" },
      { key: "Signal",     val: "→ Hiring 3 engineers (2d ago)" },
      { key: "Relationship Health", val: "84 / 100  ████████░░" },
    ],
  },
  {
    company: "Globex Inc", domain: "globex.io", initials: "GX",
    contact: { name: "Marcus Lee", role: "VP Revenue", email: "marcus@globex.io" },
    quoteId: "INV-0032", quoteAmount: "£3,150",
    fields: [
      { key: "Company",    val: "Globex Inc" },
      { key: "Domain",     val: "globex.io" },
      { key: "ARR",        val: "$1.6M" },
      { key: "Headcount",  val: "64 employees" },
      { key: "Stage",      val: "Seed · Berlin" },
      { key: "Tech stack", val: "Notion · GCP · Intercom" },
      { key: "Signal",     val: "→ Raised new round (5d ago)" },
      { key: "Relationship Health", val: "71 / 100  ███████░░░" },
    ],
  },
  {
    company: "Initech", domain: "initech.com", initials: "IN",
    contact: { name: "Priya Anand", role: "COO", email: "priya@initech.com" },
    quoteId: "INV-0033", quoteAmount: "£14,900",
    fields: [
      { key: "Company",    val: "Initech" },
      { key: "Domain",     val: "initech.com" },
      { key: "ARR",        val: "$9.8M" },
      { key: "Headcount",  val: "480 employees" },
      { key: "Stage",      val: "Series C · Austin" },
      { key: "Tech stack", val: "Salesforce · AWS · Zendesk" },
      { key: "Signal",     val: "→ Visited pricing page 3x (1d ago)" },
      { key: "Relationship Health", val: "92 / 100  █████████░" },
    ],
  },
];

const STEP_TEMPLATE = [
  { tag: "Record",       tagCol: "#3f3f46", delay: 400,  title: "Record added" },
  { tag: "Enrichment",   tagCol: "#4f46e5", delay: 1100, title: "AI enrichment fired" },
  { tag: "Graph",        tagCol: "#4f46e5", delay: 1800, title: "Relationship health updated — moved to Proposal" },
  { tag: "Sequence",     tagCol: "#3f3f46", delay: 2500, title: "Sequence enrolled: Enterprise Nurture" },
  { tag: "Automation",   tagCol: "#4f46e5", delay: 3200, title: "Automation triggered on graph event" },
  { tag: "Finance",      tagCol: "#3f3f46", delay: 3900, title: "Quote drafted — queued for approval" },
];

function buildWorkflowSteps(scenario: typeof RECORD_SCENARIOS[number]) {
  const f = scenario.fields;
  const details = [
    `${scenario.domain} · ${scenario.contact.name}, ${scenario.contact.role}`,
    `ARR ${f[2]!.val} · ${f[3]!.val} · ${f[4]!.val} · Tech: ${f[5]!.val.split(" · ")[0]}`,
    `Relationship health ${f[7]!.val.split(" ")[0]}/100 · stage: Discovery → Proposal · owner: you`,
    "Step 1 sent · 4-step cadence · open tracked",
    "Slack notified · Record updated · owner pinged",
    `${scenario.quoteId} drafted · ${scenario.quoteAmount} · for ${scenario.contact.email} · awaiting your approval`,
  ];
  return STEP_TEMPLATE.map((s, i) => ({ ...s, detail: details[i]! }));
}

const WORKFLOW_LOOP_MS = 3900 + 3000; // last step + pause before restart

// ── How it's different — standalone comparison section ────────────────────────
const REPLACES_ROWS = [
  { before: "Disconnected spreadsheets",            after: "One living asset graph",                 icon: "◈" },
  { before: "Stale asset & contact lists",          after: "Autonomous agents keeping it current",   icon: "◈" },
  { before: "Isolated finance tools",                after: "Connected business memory",              icon: "◈" },
  { before: "Documents scattered everywhere",        after: "Explainable, source-backed decisions",   icon: "◈" },
  { before: "Task silos with no context",            after: "Graph-aware workflows",                  icon: "◈" },
  { before: "Decisions lost in chat threads",        after: "Workspace-wide intelligence",            icon: "◈" },
];

function ComparisonSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">How it's different</p>
      <h2 className="mb-3 font-sans text-4xl font-semibold tracking-tight text-zinc-800">What Mondaily replaces</h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Stop stitching together disconnected tools for every part of the business. One workspace graph, operated by AI, runs all of it.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {REPLACES_ROWS.map((row, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className="relative overflow-hidden rounded-xl border border-black/[.05] bg-white p-4"
          >
            {/* Old way */}
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] text-zinc-400">✕</span>
              <span className="font-mono text-[13px] text-zinc-400 line-through">{row.before}</span>
            </div>

            {/* Animated connector */}
            <div className="my-2 flex items-center gap-2 pl-[10px]">
              <motion.div
                className="h-px flex-1 origin-left bg-gradient-to-r from-indigo-400/50 to-emerald-500/50"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 + 0.2 }}
              />
              <motion.span
                animate={{ y: [0, 2, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="text-[11px] text-zinc-400"
              >
                ↓ now
              </motion.span>
            </div>

            {/* New way */}
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-[10px] text-emerald-600">
                ✓
                <motion.span
                  animate={{ opacity: [0, 0.6, 0], scale: [1, 1.6, 1.6] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
                  className="absolute inset-0 rounded-full bg-emerald-500/40"
                />
              </span>
              <span className="font-mono text-[13px] font-medium text-zinc-800">{row.after}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  {
    q: "Can I migrate my data from another CRM?",
    a: "Yes — import contacts, companies, and deals via CSV in minutes. For larger migrations from Salesforce, HubSpot, or Pipedrive, our team can help map fields and move historical activity over with you.",
  },
  {
    q: "Is Mondaily secure? Are you SOC 2 compliant?",
    a: "Data is encrypted in transit and at rest, access is role-based, and infrastructure runs on audited cloud providers. SOC 2 Type II is in progress — reach out if you need our current security overview for a vendor review.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. There's no lock-in — cancel from your billing settings whenever you like and you'll keep access through the end of your current billing period. No retention calls, no hoops.",
  },
  {
    q: "Is there a contract, or is it month-to-month?",
    a: "Monthly and annual billing are both available, but neither requires a contract. Annual just gets you a discount — you're never locked into a multi-year term.",
  },
  {
    q: "Is Mondaily a CRM?",
    a: "No — Mondaily is an AI-native autonomous workspace and asset-graph engine. A sales pipeline is one example of what you can model in it, but the graph holds any kind of record — people, companies, assets, documents, tasks, invoices — connected and operated on by AI agents. CRM, finance, and operations all run on the same graph instead of living in separate tools.",
  },
  {
    q: "How does the AI enrichment actually work?",
    a: "When a record is added, Mondaily looks up the company's domain and pulls firmographic data — ARR, headcount, funding stage, tech stack — plus live signals like hiring activity or recent funding. It's attached to the record automatically, no manual research required.",
  },
  {
    q: "Can I build my own automations and sequences?",
    a: "Yes. Automations trigger on any record or pipeline event — stage change, new signal, field update — and can notify a channel, update a record, or kick off a sequence. Sequences are multi-step outreach cadences you design once and Mondaily runs continuously.",
  },
  {
    q: "Does Mondaily handle invoicing and finance, or is that a separate tool?",
    a: "It's built in. Quotes, invoices, and expense tracking live on the same workspace graph as your records — no exporting to a separate finance app. The Finance Agent drafts invoice reminders and credit note adjustments and queues them in your Decision Queue; you approve before anything sends. Deal-stage-triggered quote drafting is on the roadmap, not shipped yet.",
  },
  {
    q: "What integrations does Mondaily support?",
    a: "Mondaily connects to your inbox, calendar, and common finance and communication tools out of the box, plus an API and MCP server for custom integrations. If you use a tool we don't yet support natively, talk to us — most requests are quick to add.",
  },
  {
    q: "How long does it take to get set up?",
    a: "Most teams are live within a day. Import your existing contacts and deals via CSV, connect your inbox, and the AI starts enriching records immediately — there's no lengthy implementation process.",
  },
];

function FAQTypewriter({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    let i = 0;
    const t = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, 12);
    return () => clearInterval(t);
  }, [text]);
  return (
    <>
      {shown}
      {shown.length < text.length && (
        <span className="inline-block w-[1px] h-[0.85em] bg-indigo-500 ml-[1px] opacity-60 animate-pulse align-middle"/>
      )}
    </>
  );
}

function FAQSection() {
  const [active, setActive] = useState(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">FAQ</p>
      <h2 className="mb-10 font-sans text-4xl font-semibold tracking-tight text-zinc-800">Ask Mondaily AI</h2>

      <div
        className="overflow-hidden rounded-2xl"
        style={{ border: "1px solid rgba(99,102,241,0.15)", background: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)" }}
      >
        <div className="flex items-center gap-2 border-b border-black/[.05] px-4 py-2.5">
          <span className="text-[13px] font-medium text-zinc-700">Ask Mondaily</span>
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500"
          />
        </div>

        {/* Transcript */}
        <div className="px-5 py-5">
          <div className="flex justify-end mb-3">
            <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-indigo-600/15 border border-indigo-500/20 px-4 py-2.5 font-mono text-[13px] text-zinc-800">
              {FAQ_ITEMS[active]!.q}
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-black/[.06] bg-black/[.02] px-4 py-2.5 font-mono text-[13px] leading-relaxed text-zinc-600">
              <FAQTypewriter key={active} text={FAQ_ITEMS[active]!.a} />
            </div>
          </div>
        </div>

        {/* Question list */}
        <div className="border-t border-black/[.05] px-5 py-2">
          {FAQ_ITEMS.map((item, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`flex w-full items-center gap-3 border-b border-black/[.04] py-3 text-left font-mono text-[13px] transition-colors last:border-b-0 ${
                active === i ? "text-indigo-600" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <span className={active === i ? "text-indigo-500" : "text-zinc-300"}>{'>'}</span>
              <span className="flex-1 truncate">{item.q}</span>
              {active === i && (
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [shownFields, setShownFields] = useState<number>(0);
  const [shownSteps, setShownSteps] = useState<number>(0);

  const scenario = RECORD_SCENARIOS[scenarioIdx]!;
  const fields = scenario.fields;
  const steps = useMemo(() => buildWorkflowSteps(scenario), [scenario]);

  const runSeq = useCallback((s: typeof scenario, f: typeof fields, st: typeof steps) => {
    setShownFields(0);
    setShownSteps(0);
    const timers = [
      ...f.map((_field, i) => setTimeout(() => setShownFields(i + 1), 200 + i * 120)),
      ...st.map((step, i) => setTimeout(() => setShownSteps(i + 1), step.delay)),
    ];
    return timers;
  }, []);

  useEffect(() => {
    const timers = runSeq(scenario, fields, steps);
    return () => { timers.forEach(clearTimeout); };
  }, [scenario, fields, steps, runSeq]);

  useEffect(() => {
    const loop = setInterval(() => {
      setScenarioIdx(i => (i + 1) % RECORD_SCENARIOS.length);
    }, WORKFLOW_LOOP_MS);
    return () => clearInterval(loop);
  }, []);

  return (
    <section id="workflow" className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-violet-500">Live on the graph</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        What happens when a record enters Mondaily
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Zero manual input. The platform enriches, scores, connects, and notifies — automatically.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Left: enriched record card ── */}
        <div className="rounded-2xl border border-black/[.05] bg-white p-6">
          {/* Card header */}
          <div className="mb-5 flex items-center justify-between border-b border-black/[.04] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-600/10 text-[14px] text-indigo-500 font-bold">{scenario.initials}</div>
              <div>
                <div className="text-[13px] text-zinc-900 font-medium">{scenario.company}</div>
                <div className="text-[14px] text-zinc-600">{scenario.domain}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="h-1.5 w-1.5 rounded-full bg-indigo-600"
              />
              <span className="text-[14px] text-indigo-700">enriched</span>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {fields.map((f, i) => (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: i < shownFields ? 1 : 0, x: i < shownFields ? 0 : -6 }}
                transition={{ duration: 0.3 }}
                className="flex items-baseline gap-3"
              >
                <span className="w-24 shrink-0 text-[14px] text-zinc-500">{f.key}</span>
                <span className={`text-[13px] ${f.key === "Signal" ? "text-indigo-500" : f.key === "Relationship Health" ? "text-indigo-400" : "text-zinc-600"}`}>
                  {f.val}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Contact row */}
          <div className="mt-5 border-t border-black/[.04] pt-4">
            <div className="text-[14px] text-zinc-500 mb-2">Contact</div>
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-zinc-200 flex items-center justify-center text-[11px] text-zinc-500">
                {scenario.contact.name.split(" ").map(p => p[0]).join("")}
              </div>
              <div>
                <div className="text-[13px] text-zinc-600">{scenario.contact.name}</div>
                <div className="text-[14px] text-zinc-500">{scenario.contact.role} · {scenario.contact.email}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: activity timeline ── */}
        <div className="rounded-2xl border border-black/[.05] bg-white p-6">
          <div className="mb-5 flex items-center gap-2 border-b border-black/[.04] pb-4">
            <span className="text-[14px] font-medium text-zinc-700">Activity on this record</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500"
            />
          </div>

          {/* Steps */}
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {steps.slice(0, shownSteps).map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="flex gap-3"
                >
                  {/* Step connector */}
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full mt-1 shrink-0" style={{ background: step.tagCol === "#4f46e5" ? "#4f46e5" : "#27272a" }}/>
                    {i < shownSteps - 1 && (
                      <div className="mt-1 flex-1 w-px bg-black/[.04] min-h-[20px]"/>
                    )}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px]" style={{ color: step.tagCol }}>{step.tag}</span>
                      <span className="text-[13px] text-zinc-600">{step.title}</span>
                    </div>
                    <div className="text-[14px] text-zinc-500 leading-relaxed">{step.detail}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Blinking cursor while running */}
            {shownSteps < steps.length && shownSteps > 0 && (
              <div className="flex items-center gap-2 pl-5">
                {[0,1,2].map(i => (
                  <motion.span key={i} className="h-1 w-1 rounded-full bg-indigo-800"
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
                <span className="text-[14px] text-zinc-500 ml-1">processing…</span>
              </div>
            )}

            {/* All done */}
            {shownSteps >= steps.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-2 pl-5 pt-1"
              >
                <span className="text-[14px] text-indigo-700">[DONE]</span>
                <span className="text-[14px] text-zinc-500">6 actions completed · 0 errors · 0 manual steps</span>
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
// Mirrors Attio's workflow builder but in our dark/indigo/mono aesthetic

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
    tag: "AI · Relationship health",
    label: "Update relationship health",
    sub: "Real backend field — recency, open loops, activity — 0–100",
    delay: 600,
  },
  {
    id: "condition",
    type: "condition" as const,
    tag: "Condition",
    label: "Health ≥ 70?",
    sub: "Route high-engagement vs nurture",
    delay: 1200,
    branches: [
      { label: "High engagement", col: "#4f46e5" },
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
    sub: '#signals · "High relationship health — acme.com"',
    delay: 2500,
    branch: "left" as const,
  },
  {
    id: "finance",
    type: "action" as const,
    tag: "Finance",
    label: "Quote drafted",
    sub: "INV-0031 · £8,400 · queued for your approval",
    delay: 3100,
    branch: "left" as const,
  },
];

function FlowNode({ node, active, alwaysShow = false }: { node: typeof FLOW_NODES[number]; active: boolean; alwaysShow?: boolean }) {
  const isVisible = active || alwaysShow;
  const borderCol = active
    ? (node.type === "trigger" ? "border-indigo-500/40" : node.type === "condition" ? "border-zinc-300/60" : "border-black/[.1]")
    : "border-black/[.04]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: active ? 1 : alwaysShow ? 0.55 : 0.22, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl border ${borderCol} bg-white px-5 py-3.5 font-mono`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[14px] ${active ? (node.type === "trigger" || node.type === "action" ? "text-indigo-500" : "text-zinc-500") : "text-zinc-500"}`}>
          {node.tag}
        </span>
        {active && node.type !== "condition" && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[14px] text-indigo-800">
            ✓ completed
          </motion.span>
        )}
        {active && node.type === "condition" && (
          <span className="text-[14px] text-indigo-600">branching →</span>
        )}
      </div>
      <div className={`text-[14px] ${isVisible ? "text-zinc-900" : "text-zinc-600"}`}>{node.label}</div>
      <div className="mt-0.5 text-[14px] text-zinc-600 leading-relaxed">{node.sub}</div>
    </motion.div>
  );
}

function AutomationFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const [shownCount, setShownCount] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    function runFlow() {
      timersRef.current.forEach(clearTimeout);
      setShownCount(0);
      timersRef.current = FLOW_NODES.map((n, i) =>
        setTimeout(() => setShownCount(i + 1), n.delay + 200)
      );
    }
    runFlow();
    const loop = setInterval(runFlow, 3100 + 200 + 2600);
    return () => {
      clearInterval(loop);
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  const Connector = ({ active, short }: { active: boolean; short?: boolean }) => (
    <div className="flex justify-center">
      <motion.div
        animate={{ opacity: active ? 1 : 0.08 }}
        transition={{ duration: 0.4 }}
        className={`w-px ${short ? "h-5" : "h-8"} bg-gradient-to-b from-indigo-800/60 to-transparent`}
      />
    </div>
  );

  return (
    <section
      ref={ref}
      className="mx-auto max-w-6xl px-6 py-20"
    >
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-amber-500">How the graph works</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Design once. Apply to every object on the graph.
      </h2>
      <p className="mb-6 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Visual flows built on real graph events — no code required. Today a human reviews and runs each
        one; autonomous execution is on the <a href="/roadmap" className="text-indigo-500 hover:underline">roadmap</a>.
      </p>

      {/* Plain-language framing — the full lifecycle of an object in the graph, not a technical diagram */}
      <div className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-black/[.05] bg-zinc-50/70 px-5 py-4 text-[13.5px] font-medium text-zinc-700">
        {["Object enters", "Becomes a graph node", "Enriched", "Connected to related nodes", "Agents monitor", "Signal created", "Decision queued", "Action approved"].map((step, i, arr) => (
          <span key={step} className="flex items-center gap-2">
            <span className={i % 2 === 1 ? "text-indigo-600" : ""}>{step}</span>
            {i < arr.length - 1 && <span className="text-indigo-400">→</span>}
          </span>
        ))}
      </div>

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
              <span className="rounded-full border border-indigo-500/20 bg-indigo-600/10 px-3 py-0.5 text-[14px] text-indigo-500">High intent</span>
            </div>
            <div className="flex justify-center">
              <span className="rounded-full border border-zinc-300/30 bg-zinc-300/10 px-3 py-0.5 text-[14px] text-zinc-500">Nurture</span>
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
                node={{ id: "nurture-auto", type: "action", tag: "Automations", label: "Tag as low-priority", sub: "Record field updated · owner notified · review in 30d", delay: 2500 }}
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
              <div className="h-px flex-1 bg-black/[.04]"/>
              <span className="text-[14px] text-indigo-800">[FLOW COMPLETE]</span>
              <div className="h-px flex-1 bg-black/[.04]"/>
            </motion.div>
          )}
        </div>

        {/* Right: stat callouts */}
        <div className="flex flex-col gap-4 font-mono">
          <div className="text-[14px] text-zinc-500 uppercase tracking-widest mb-2">// what this replaces</div>
          {[
            { before: "Manual scoring in a spreadsheet", after: "AI scores relationships automatically, daily", icon: "◈" },
            { before: "Forgetting to follow up",         after: "Sequences enroll without manual setup",   icon: "◈" },
            { before: "Chasing your team for updates",   after: "Notified the moment a signal fires",icon: "◈" },
            { before: "Finance chasing the deal owner",  after: "Quote drafted, waiting on your approval", icon: "◈" },
          ].map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: shownCount >= i + 2 ? 1 : 0.1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="rounded-xl border border-black/[.04] bg-white p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-indigo-700 text-[14px]">{row.icon}</span>
                <div>
                  <div className="text-[14px] text-zinc-600 line-through mb-0.5">{row.before}</div>
                  <div className="text-[13px] text-zinc-700">{row.after}</div>
                </div>
              </div>
            </motion.div>
          ))}

          <motion.a
            href="https://app.mondaily.com/sign-up"
            initial={{ opacity: 0 }}
            animate={{ opacity: shownCount >= FLOW_NODES.length ? 1 : 0 }}
            transition={{ duration: 0.5 }}
            className="mt-2 rounded-xl border border-indigo-500/25 bg-indigo-600/10 px-5 py-3 text-center text-[13px] text-indigo-400 hover:bg-indigo-600/20 hover:text-indigo-200 transition-all"
          >
            Build your first flow →
          </motion.a>
        </div>
      </div>
    </section>
  );
}

// ── Email signup ──────────────────────────────────────────────────────────────
// ── Hero visual proof — pipeline board, styled like the real app ──────────────
const STAGE_STYLE: Record<string, { dot: string; text: string }> = {
  New:         { dot: "bg-zinc-400",    text: "text-zinc-600" },
  Qualified:   { dot: "bg-blue-500",    text: "text-blue-700" },
  Proposal:    { dot: "bg-amber-500",   text: "text-amber-700" },
  Negotiation: { dot: "bg-violet-500",  text: "text-violet-700" },
  Won:         { dot: "bg-emerald-500", text: "text-emerald-700" },
};

const STAGE_NAMES = ["New", "Qualified", "Proposal", "Negotiation", "Won"] as const;
type StageName = typeof STAGE_NAMES[number];

// Qualitative, honest labels — never a fabricated confidence/score number
// the app can't actually back. Tied to real stage data, not invented per-card.
const STAGE_AI_LABEL: Record<StageName, string> = {
  New: "Agent watching",
  Qualified: "Signal found",
  Proposal: "AI-assisted",
  Negotiation: "Needs review",
  Won: "Source-backed",
};

type Deal = { id: string; co: string; val: string; who: string; stage: StageName };

const DEAL_POOL: Omit<Deal, "stage">[] = [
  { id: "acme",     co: "Acme Co",    val: "£4.2k",  who: "JS" },
  { id: "globex",   co: "Globex",     val: "£1.8k",  who: "MK" },
  { id: "initech",  co: "Initech",    val: "£12k",   who: "AR" },
  { id: "soylent",  co: "Soylent",    val: "£3.6k",  who: "JS" },
  { id: "umbrella", co: "Umbrella",   val: "£28k",   who: "JS" },
  { id: "vandelay", co: "Vandelay",   val: "£6.4k",  who: "MK" },
  { id: "hooli",    co: "Hooli",      val: "£40k",   who: "AR" },
];

const INITIAL_DEALS: Deal[] = [
  { ...DEAL_POOL[0]!, stage: "New" },
  { ...DEAL_POOL[1]!, stage: "New" },
  { ...DEAL_POOL[2]!, stage: "Qualified" },
  { ...DEAL_POOL[3]!, stage: "Qualified" },
  { ...DEAL_POOL[4]!, stage: "Proposal" },
  { ...DEAL_POOL[5]!, stage: "Negotiation" },
  { ...DEAL_POOL[6]!, stage: "Won" },
];

const NEXT_STAGE: Record<StageName, StageName | null> = {
  New: "Qualified", Qualified: "Proposal", Proposal: "Negotiation", Negotiation: "Won", Won: null,
};

function HeroPipelinePreview() {
  const [deals, setDeals] = useState<Deal[]>(INITIAL_DEALS);
  const [activity, setActivity] = useState("AI is scanning open deals…");
  const [glowId, setGlowId] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setDeals(prev => {
        const pick = prev[Math.floor(Math.random() * prev.length)]!;
        if (pick.stage === "Won") {
          // Recycle won deals back into the top of the funnel — keeps the board alive forever
          const fresh = DEAL_POOL[Math.floor(Math.random() * DEAL_POOL.length)]!;
          setGlowId(pick.id);
          setActivity(`AI logged ${pick.co} as won — starting a new deal`);
          setTimeout(() => setGlowId(null), 1200);
          return prev.map(d => (d.id === pick.id ? { ...fresh, id: pick.id, stage: "New" } : d));
        }
        const next = NEXT_STAGE[pick.stage]!;
        setGlowId(pick.id);
        setActivity(`AI moved ${pick.co} → ${next}`);
        setTimeout(() => setGlowId(null), 1200);
        return prev.map(d => (d.id === pick.id ? { ...d, stage: next } : d));
      });
    }, 2800);
    return () => clearInterval(t);
  }, []);

  const totalValue = "£92.4k";
  const openDeals = deals.filter(d => d.stage !== "Won").length;

  return (
    <div
      className="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl"
      style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center gap-2 border-b border-black/[.05] px-4 py-2.5">
        <span className="text-[13px] font-medium text-zinc-700">Opportunity flow — your workspace graph</span>
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500"
        />
        <span className="text-[11px] text-indigo-500">agent-monitored</span>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 border-b border-black/[.05] bg-black/[.015] px-4 py-2.5 text-[12px]">
        <span className="text-zinc-500">Opportunity value <span className="text-zinc-800">{totalValue}</span></span>
        <span className="text-zinc-500">Open opportunities <span className="text-zinc-800">{openDeals}</span></span>
        <span className="text-zinc-500">Won this month <span className="text-emerald-600">£40k</span></span>
      </div>

      {/* Live activity ticker */}
      <div className="border-b border-black/[.05] bg-indigo-500/[.03] px-4 py-2 font-mono text-[11px] text-indigo-600">
        <AnimatePresence mode="wait">
          <motion.span
            key={activity}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center gap-2"
          >
            <span className="text-indigo-500">⚡</span>{activity}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Scrolls horizontally on narrow viewports instead of cramming 5
          fixed columns into the width — was overlapping stage labels at
          mobile widths. */}
      <div className="flex gap-3 overflow-x-auto p-4 text-left sm:grid sm:grid-cols-5" style={{ scrollbarWidth: "none" }}>
        {STAGE_NAMES.map(stageName => {
          const style = STAGE_STYLE[stageName]!;
          const colDeals = deals.filter(d => d.stage === stageName);
          return (
            <div key={stageName} className="flex min-w-[136px] shrink-0 flex-col gap-2 rounded-lg border border-zinc-200/50 bg-black/[.01] sm:min-w-0 sm:shrink">
              <div className="flex items-center justify-between px-2.5 py-2 border-b border-zinc-200/50">
                <span className={`inline-flex items-center gap-1.5 rounded-md border border-black/[.05] bg-zinc-100/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold ${style.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`}/>
                  {stageName}
                </span>
                <span className="font-mono text-[10px] text-zinc-400">{colDeals.length}</span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2.5 min-h-[80px]">
                <AnimatePresence initial={false}>
                  {colDeals.map(d => (
                    <motion.div
                      key={d.id}
                      layout
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{
                        opacity: 1,
                        scale: 1,
                        boxShadow: glowId === d.id
                          ? "0 0 0 1px rgba(99,102,241,0.6), 0 0 16px rgba(99,102,241,0.35)"
                          : "0 0 0 0px rgba(99,102,241,0)",
                      }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.45, layout: { duration: 0.5, ease: "easeInOut" } }}
                      className="rounded-md border border-zinc-200/60 bg-zinc-100/50 px-2.5 py-2.5"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-zinc-700 truncate">{d.co}</span>
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 font-mono text-[8px] text-zinc-500">{d.who}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-zinc-400">{STAGE_AI_LABEL[d.stage]}</span>
                        <span className="font-mono text-[11px] text-indigo-500">{d.val}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const INVOICE_STAGE_STYLE: Record<string, { dot: string; text: string }> = {
  Draft:    { dot: "bg-zinc-400",    text: "text-zinc-600" },
  Sent:     { dot: "bg-blue-500",    text: "text-blue-700" },
  Approved: { dot: "bg-amber-500",   text: "text-amber-700" },
  Paid:     { dot: "bg-emerald-500", text: "text-emerald-700" },
};
const INVOICE_STAGE_NAMES = ["Draft", "Sent", "Approved", "Paid"] as const;
type InvoiceStage = typeof INVOICE_STAGE_NAMES[number];
type Invoice = { id: string; co: string; amt: string; ref: string; stage: InvoiceStage };

const INVOICE_POOL: Omit<Invoice, "stage">[] = [
  { id: "acme",     co: "Acme Corp",      amt: "£8,400",  ref: "INV-0031" },
  { id: "globex",   co: "Globex Inc",     amt: "£3,150",  ref: "INV-0032" },
  { id: "initech",  co: "Initech",        amt: "£14,900", ref: "INV-0033" },
  { id: "soylent",  co: "Soylent",        amt: "£2,200",  ref: "INV-0034" },
  { id: "hooli",    co: "Hooli",          amt: "£21,750", ref: "INV-0035" },
  { id: "vandelay", co: "Vandelay Ind.",  amt: "£6,300",  ref: "INV-0036" },
  { id: "umbrella", co: "Umbrella Group", amt: "£11,200", ref: "INV-0037" },
  { id: "stark",    co: "Stark Logistics",amt: "£4,750",  ref: "INV-0038" },
  { id: "wayne",    co: "Wayne Analytics",amt: "£9,900",  ref: "INV-0039" },
  { id: "monarch",  co: "Monarch Co",     amt: "£5,600",  ref: "INV-0040" },
  { id: "pied",     co: "Pied Piper",     amt: "£7,300",  ref: "INV-0041" },
  { id: "massive",  co: "Massive Dynamic",amt: "£18,200", ref: "INV-0042" },
];

const INITIAL_INVOICES: Invoice[] = [
  { ...INVOICE_POOL[0]!, stage: "Draft" },
  { ...INVOICE_POOL[1]!, stage: "Draft" },
  { ...INVOICE_POOL[2]!, stage: "Sent" },
  { ...INVOICE_POOL[3]!, stage: "Sent" },
  { ...INVOICE_POOL[4]!, stage: "Approved" },
  { ...INVOICE_POOL[5]!, stage: "Approved" },
  { ...INVOICE_POOL[6]!, stage: "Paid" },
];

const NEXT_INVOICE_STAGE: Record<InvoiceStage, InvoiceStage | null> = {
  Draft: "Sent", Sent: "Approved", Approved: "Paid", Paid: null,
};

function InvoiceBoardPreview() {
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [activity, setActivity] = useState("AI is tracking open quotes…");
  const [glowId, setGlowId] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setInvoices(prev => {
        const pick = prev[Math.floor(Math.random() * prev.length)]!;
        if (pick.stage === "Paid") {
          const usedCo = new Set(prev.filter(d => d.id !== pick.id).map(d => d.co));
          const fresh = INVOICE_POOL.find(p => !usedCo.has(p.co)) ?? INVOICE_POOL.find(p => p.co !== pick.co)!;
          setGlowId(pick.id);
          setActivity(`${pick.co} paid — new quote opened for ${fresh.co}`);
          setTimeout(() => setGlowId(null), 1200);
          return prev.map(d => (d.id === pick.id ? { ...fresh, id: pick.id, stage: "Draft" } : d));
        }
        const next = NEXT_INVOICE_STAGE[pick.stage]!;
        setGlowId(pick.id);
        setActivity(`AI moved ${pick.ref} (${pick.co}) → ${next}`);
        setTimeout(() => setGlowId(null), 1200);
        return prev.map(d => (d.id === pick.id ? { ...d, stage: next } : d));
      });
    }, 3100);
    return () => clearInterval(t);
  }, []);

  const totalOpen = invoices.filter(d => d.stage !== "Paid").length;

  return (
    <div
      className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl"
      style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center gap-2 border-b border-black/[.05] px-4 py-2.5">
        <span className="text-[13px] font-medium text-zinc-700">Finance — quotes &amp; invoices</span>
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500"
        />
        <span className="text-[11px] text-emerald-600">tracked by Finance Agent</span>
      </div>

      <div className="flex items-center gap-6 border-b border-black/[.05] bg-black/[.015] px-4 py-2.5 font-mono text-[11px]">
        <span className="text-zinc-500">Open quotes <span className="text-zinc-800">{totalOpen}</span></span>
        <span className="text-zinc-500">Paid this month <span className="text-emerald-600">£18.6k</span></span>
      </div>

      <div className="border-b border-black/[.05] bg-emerald-500/[.04] px-4 py-2 font-mono text-[11px] text-emerald-700">
        <AnimatePresence mode="wait">
          <motion.span
            key={activity}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center gap-2"
          >
            <span className="text-emerald-600">⚡</span>{activity}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex gap-3 overflow-x-auto p-4 text-left sm:grid sm:grid-cols-4" style={{ scrollbarWidth: "none" }}>
        {INVOICE_STAGE_NAMES.map(stageName => {
          const style = INVOICE_STAGE_STYLE[stageName]!;
          const colInvoices = invoices.filter(d => d.stage === stageName);
          return (
            <div key={stageName} className="flex min-w-[136px] shrink-0 flex-col gap-2 rounded-lg border border-zinc-200/50 bg-black/[.01] sm:min-w-0 sm:shrink">
              <div className="flex items-center justify-between px-2.5 py-2 border-b border-zinc-200/50">
                <span className={`inline-flex items-center gap-1.5 rounded-md border border-black/[.05] bg-zinc-100/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold ${style.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`}/>
                  {stageName}
                </span>
                <span className="font-mono text-[10px] text-zinc-400">{colInvoices.length}</span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2.5 min-h-[100px]">
                <AnimatePresence initial={false}>
                  {colInvoices.map(d => (
                    <motion.div
                      key={d.id}
                      layout
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{
                        opacity: 1,
                        scale: 1,
                        boxShadow: glowId === d.id
                          ? "0 0 0 1px rgba(16,185,129,0.6), 0 0 16px rgba(16,185,129,0.35)"
                          : "0 0 0 0px rgba(16,185,129,0)",
                      }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.45, layout: { duration: 0.5, ease: "easeInOut" } }}
                      className="rounded-md border border-zinc-200/60 bg-zinc-100/50 px-2.5 py-2.5"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-zinc-700 truncate">{d.co}</span>
                        <span className="font-mono text-[10px] text-zinc-400">{d.ref}</span>
                      </div>
                      <div className="flex items-center justify-end">
                        <span className="font-mono text-[11px] text-emerald-600">{d.amt}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SheetCol = { key: string; label: string; type: "text" | "badge" | "score" | "avatar" };
type SheetRow = { id: string; [key: string]: string | number };
type SheetView = {
  name: string;
  accent: string;
  columns: SheetCol[];
  stageCol: string;
  stageOrder: string[];
  stageStyle: Record<string, { dot: string; text: string }>;
  rows: SheetRow[];
};

const SHEET_VIEWS: SheetView[] = [
  {
    name: "Opportunity flow", accent: "#4f46e5",
    columns: [
      { key: "company", label: "Company", type: "text" },
      { key: "stage",   label: "Stage",    type: "badge" },
      { key: "score",   label: "Relationship Health", type: "score" },
      { key: "owner",   label: "Owner",    type: "avatar" },
    ],
    stageCol: "stage",
    stageOrder: ["New", "Qualified", "Proposal", "Negotiation", "Won"],
    stageStyle: {
      New:         { dot: "bg-zinc-400",    text: "text-zinc-600" },
      Qualified:   { dot: "bg-blue-500",    text: "text-blue-700" },
      Proposal:    { dot: "bg-amber-500",   text: "text-amber-700" },
      Negotiation: { dot: "bg-violet-500",  text: "text-violet-700" },
      Won:         { dot: "bg-emerald-500", text: "text-emerald-700" },
    },
    rows: [
      { id: "vandelay", company: "Vandelay Industries", stage: "New",         score: 58, owner: "MK" },
      { id: "stark",    company: "Stark Logistics",     stage: "Qualified",   score: 74, owner: "JS" },
      { id: "wayne",    company: "Wayne Analytics",     stage: "Proposal",    score: 88, owner: "AR" },
      { id: "umbrella", company: "Umbrella Group",      stage: "Negotiation", score: 81, owner: "JS" },
      { id: "acme",     company: "Acme Corp",           stage: "Qualified",   score: 67, owner: "AR" },
    ],
  },
  {
    name: "Finance — quotes", accent: "#059669",
    columns: [
      { key: "company", label: "Company", type: "text" },
      { key: "ref",     label: "Quote",   type: "text" },
      { key: "stage",   label: "Stage",   type: "badge" },
      { key: "amt",     label: "Amount",  type: "text" },
    ],
    stageCol: "stage",
    stageOrder: ["Draft", "Sent", "Approved", "Paid"],
    stageStyle: {
      Draft:    { dot: "bg-zinc-400",    text: "text-zinc-600" },
      Sent:     { dot: "bg-blue-500",    text: "text-blue-700" },
      Approved: { dot: "bg-amber-500",   text: "text-amber-700" },
      Paid:     { dot: "bg-emerald-500", text: "text-emerald-700" },
    },
    rows: [
      { id: "globex",  company: "Globex Inc",  ref: "INV-0032", stage: "Draft",    amt: "£3,150" },
      { id: "soylent", company: "Soylent",     ref: "INV-0034", stage: "Sent",     amt: "£2,200" },
      { id: "hooli",   company: "Hooli",       ref: "INV-0035", stage: "Approved", amt: "£21,750" },
      { id: "acme2",   company: "Acme Corp",   ref: "INV-0031", stage: "Paid",     amt: "£8,400" },
      { id: "initech", company: "Initech",     ref: "INV-0033", stage: "Sent",     amt: "£14,900" },
    ],
  },
  {
    name: "Relationship health", accent: "#d97706",
    columns: [
      { key: "contact",  label: "Contact",    type: "text" },
      { key: "company",  label: "Company",    type: "text" },
      { key: "status",   label: "Status",     type: "badge" },
      { key: "score",    label: "Health",     type: "score" },
    ],
    stageCol: "status",
    stageOrder: ["Healthy", "At risk", "Cold"],
    stageStyle: {
      Healthy: { dot: "bg-emerald-500", text: "text-emerald-700" },
      "At risk": { dot: "bg-amber-500", text: "text-amber-700" },
      Cold:    { dot: "bg-red-500",     text: "text-red-700" },
    },
    rows: [
      { id: "priya",  contact: "Priya Anand",  company: "Initech",    status: "Healthy", score: 91 },
      { id: "marcus", contact: "Marcus Lee",   company: "Globex Inc", status: "At risk", score: 54 },
      { id: "sarah",  contact: "Sarah Johnson",company: "Acme Corp",  status: "Cold",    score: 22 },
      { id: "derek",  contact: "Derek Wayne",  company: "Wayne Analytics", status: "Healthy", score: 86 },
      { id: "nina",   contact: "Nina Kapoor",  company: "Stark Logistics", status: "At risk", score: 49 },
    ],
  },
];

const VIEW_ROTATE_MS = 9000;

function RecordsSheetPreview() {
  const [viewIdx, setViewIdx] = useState(0);
  const view = SHEET_VIEWS[viewIdx]!;
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [activity, setActivity] = useState(`Watching ${view.name.toLowerCase()}…`);
  const [glowCell, setGlowCell] = useState<{ id: string; col: string } | null>(null);
  const allAdded = useRef(false);

  useEffect(() => {
    allAdded.current = false;
    setRows([]);
    setActivity(`Watching ${view.name.toLowerCase()}…`);
    let i = 0;
    const add = setInterval(() => {
      const next = view.rows[i];
      if (!next) { allAdded.current = true; clearInterval(add); return; }
      setRows(prev => [...prev, next]);
      i++;
      if (i >= view.rows.length) allAdded.current = true;
    }, 450);
    return () => clearInterval(add);
  }, [view]);

  useEffect(() => {
    const rotate = setInterval(() => setViewIdx(i => (i + 1) % SHEET_VIEWS.length), VIEW_ROTATE_MS);
    return () => clearInterval(rotate);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (!allAdded.current) return;
      setRows(prev => {
        if (prev.length === 0) return prev;
        const pick = prev[Math.floor(Math.random() * prev.length)];
        if (!pick) return prev;
        const order = view.stageOrder;
        const curStage = String(pick[view.stageCol]);
        const stageIdx = order.indexOf(curStage);
        const label = String(pick.company ?? pick.contact ?? pick.id);
        const scoreCol = view.columns.find(c => c.type === "score")?.key;

        if (scoreCol && Math.random() < 0.5) {
          setGlowCell({ id: pick.id, col: scoreCol });
          setActivity(`AI updated ${view.columns.find(c => c.key === scoreCol)!.label.toLowerCase()} for ${label}`);
          setTimeout(() => setGlowCell(null), 1100);
          const cur = Number(pick[scoreCol]);
          const next = Math.max(10, Math.min(99, cur + Math.floor(Math.random() * 12 - 5)));
          return prev.map(r => (r.id === pick.id ? { ...r, [scoreCol]: next } : r));
        }

        if (stageIdx === -1 || stageIdx === order.length - 1) {
          setGlowCell({ id: pick.id, col: view.stageCol });
          setActivity(`AI reviewed ${label}`);
          setTimeout(() => setGlowCell(null), 1100);
          return prev;
        }
        const nextStage = order[stageIdx + 1]!;
        setGlowCell({ id: pick.id, col: view.stageCol });
        setActivity(`AI moved ${label} → ${nextStage}`);
        setTimeout(() => setGlowCell(null), 1100);
        return prev.map(r => (r.id === pick.id ? { ...r, [view.stageCol]: nextStage } : r));
      });
    }, 2600);
    return () => clearInterval(t);
  }, [view]);

  const cellClass = (id: string, col: string) =>
    `px-3 py-2.5 text-[12px] transition-colors ${glowCell?.id === id && glowCell.col === col ? "bg-indigo-500/[.08]" : ""}`;

  return (
    <div
      className="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl"
      style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center gap-2 border-b border-black/[.05] px-4 py-2.5">
        <AnimatePresence mode="wait">
          <motion.span
            key={view.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[13px] font-medium text-zinc-700"
          >
            Records — {view.name.toLowerCase()}
          </motion.span>
        </AnimatePresence>
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          className="ml-auto h-1.5 w-1.5 rounded-full"
          style={{ background: view.accent }}
        />
        <span className="font-mono text-[11px]" style={{ color: view.accent }}>live-edited by AI</span>
      </div>

      <div className="border-b border-black/[.05] px-4 py-2 font-mono text-[11px]" style={{ background: `${view.accent}08`, color: view.accent }}>
        <AnimatePresence mode="wait">
          <motion.span
            key={activity}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center gap-2"
          >
            <span>⚡</span>{activity}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="overflow-x-auto">
        <AnimatePresence mode="wait">
          <motion.table
            key={view.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full font-mono text-left"
          >
            <thead>
              <tr className="border-b border-black/[.05] bg-black/[.015]">
                {view.columns.map(c => (
                  <th key={c.key} className="px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-400 font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
              {rows.filter((r): r is SheetRow => Boolean(r)).map(r => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="border-b border-black/[.04] last:border-0"
                >
                  {view.columns.map(c => {
                    const val = r[c.key];
                    return (
                      <td key={c.key} className={cellClass(r.id, c.key)}>
                        {c.type === "badge" ? (
                          <span className={`inline-flex items-center gap-1.5 rounded-md border border-black/[.05] bg-zinc-100/60 px-1.5 py-0.5 text-[10px] font-semibold ${view.stageStyle[String(val)]?.text ?? "text-zinc-600"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${view.stageStyle[String(val)]?.dot ?? "bg-zinc-400"}`}/>
                            {val}
                          </span>
                        ) : c.type === "score" ? (
                          <span style={{ color: view.accent }}>{val}{c.key === "score" ? "%" : ""}</span>
                        ) : c.type === "avatar" ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[9px] text-zinc-500">{val}</span>
                        ) : (
                          <span className="text-zinc-700">{val}</span>
                        )}
                      </td>
                    );
                  })}
                </motion.tr>
              ))}
              </AnimatePresence>
            </tbody>
          </motion.table>
        </AnimatePresence>
      </div>
    </div>
  );
}

function RecordsSheetSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-emerald-500">Records sheet</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Your records, kept current automatically
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        No manual data entry — the AI enriches and updates relationship health on rows while you watch.
      </p>
      <RecordsSheetPreview />
    </section>
  );
}

function FinanceBoardSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-emerald-500">Finance</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Invoices tracked to payment, automatically
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Draft a quote, raise the invoice, and Mondaily tracks it through to payment — chasing overdue invoices (with your approval) and handling recurring billing without a spreadsheet.
      </p>
      <InvoiceBoardPreview />
    </section>
  );
}

const AGENTS = [
  {
    icon: "◈", name: "Graph Agent", accent: "#4f46e5",
    desc: "The conversational interface to your workspace graph — creates and searches records, builds lists, sets up workflows, and answers questions in plain English.",
    watches: "Every record, conversation, and question asked of the graph",
    prepares: "Filtered lists, new records, draft workflows, and answers with sources attached",
    approval: "No approval needed to answer — sensitive actions still route to the Decision Queue",
  },
  {
    icon: "◆", name: "Enrichment Agent", accent: "#7c3aed",
    desc: "Fires the moment a new record enters the graph — pulls ARR, headcount, funding, tech stack, and other public signals automatically from the web.",
    watches: "New records as they're created",
    prepares: "Firmographic and contact fields, sourced and attached to the record",
    approval: "Writes directly — no sensitive action, so no approval required",
  },
  {
    icon: "♥", name: "Relationship Agent", accent: "#d97706",
    desc: "Scores every relationship daily based on contact recency, open loops, and recent activity across the graph.",
    watches: "Last-touch dates and open items across every relationship",
    prepares: "An updated relationship health score on each record",
    approval: "Writes directly — no sensitive action, so no approval required",
  },
  {
    icon: "▲", name: "Finance Agent", accent: "#dc2626",
    desc: "Watches invoices and credit notes across the graph, drafts the reminder or adjustment, and queues it for your approval before anything is sent.",
    watches: "Invoice due dates and credit note disputes",
    prepares: "Draft reminders and adjustments",
    approval: "Requires approval before anything is sent or applied",
  },
  {
    icon: "▶", name: "Operations Agent", accent: "#059669",
    desc: "Tracks overdue and stalled work across the graph and queues a recommendation the moment something needs attention.",
    watches: "Task due dates, review status, and stalled work",
    prepares: "A recommendation in the Decision Queue, with the record attached",
    approval: "Requires approval before reassigning or rescheduling",
  },
  {
    icon: "⚙", name: "Workflow Agent", accent: "#0891b2",
    desc: "Designs trigger → condition → action automations across the graph, no code required. Autonomous execution is coming online — today, a human reviews and runs each one.",
    watches: "Workflow definitions you design",
    prepares: "A runnable workflow draft",
    approval: "Always requires a human to review and run it today",
  },
  {
    icon: "✦", name: "Prospecting Agent", accent: "#0ea5e9",
    desc: "Searches the live web for new candidates — people, organizations, investors, suppliers, or any record type your workspace tracks — and proposes them with a real source attached.",
    watches: "A query you give it, plus your existing graph for duplicates",
    prepares: "New candidate records, each with a source URL — never invented",
    approval: "Requires approval before any candidate is added to the graph",
  },
];

function AgentsSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section id="agents" className="relative mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-violet-500">Agent constellation</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        A team of agents, watching one graph
      </h2>
      <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Not bots bolted onto a CRM — every agent below reads from the same workspace graph, prepares a specific kind of work, and tells you plainly whether it needs your approval. Click one to see how it works.
      </p>

      {/* Central graph node — agents are spokes off the same workspace graph,
          not a row of unrelated SaaS feature cards. Purely decorative
          (pointer-events-none), so it can never break layout or block clicks. */}
      <div className="relative mb-2 hidden flex-col items-center sm:flex" aria-hidden="true">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/[.06]">
          <motion.span
            animate={{ opacity: [0.35, 0.8, 0.35], scale: [1, 1.25, 1] }}
            transition={{ duration: 2.4, repeat: Infinity }}
            className="absolute inset-0 rounded-full border border-violet-500/30"
          />
          <span className="font-mono text-[10px] font-semibold text-violet-600">graph</span>
        </div>
        {/* Connector spine — a single line dropping from the hub into the
            grid; ambient and schematic, not pinned to exact card positions
            (which would break across responsive column counts). */}
        <div className="h-8 w-px bg-gradient-to-b from-violet-400/40 to-transparent"/>
        <div className="absolute top-[52px] h-px w-full max-w-2xl bg-gradient-to-r from-transparent via-violet-400/25 to-transparent"/>
      </div>

      <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent, i) => {
          const open = openIdx === i;
          return (
            <motion.div
              key={agent.name}
              layout
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              whileHover={{ y: -3 }}
              onClick={() => setOpenIdx(open ? null : i)}
              className="relative cursor-pointer overflow-hidden rounded-xl border p-5 transition-colors"
              style={{
                borderColor: open ? `${agent.accent}40` : "rgba(0,0,0,.05)",
                background: open ? `${agent.accent}08` : "#ffffff",
              }}
            >
              {/* Short connector stub at the top of each card — echoes the
                  hub line above so each node reads as "plugged into the
                  graph" rather than a standalone card. Hidden on mobile
                  along with the hub, so nothing can overflow narrow widths. */}
              <div className="absolute left-1/2 top-0 hidden h-2 w-px -translate-x-1/2 sm:block" style={{ background: `${agent.accent}45` }} aria-hidden="true"/>

              <div className="mb-3 flex items-center gap-3">
                <span
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[15px]"
                  style={{ background: `${agent.accent}12`, color: agent.accent, border: `1px solid ${agent.accent}30` }}
                >
                  {agent.icon}
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }}
                    className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: agent.accent }}
                  />
                </span>
                <span className="text-[14.5px] font-semibold text-zinc-800">{agent.name}</span>
                <motion.span
                  animate={{ rotate: open ? 180 : 0 }}
                  transition={{ duration: 0.25 }}
                  className="ml-auto text-[11px] text-zinc-400"
                >
                  ▾
                </motion.span>
              </div>
              <p className="text-[13px] leading-relaxed text-zinc-500">{agent.desc}</p>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: "auto", marginTop: 12 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 rounded-lg p-3" style={{ background: `${agent.accent}07` }}>
                      <div className="flex gap-2 text-[12px]">
                        <span className="shrink-0 font-medium" style={{ color: agent.accent }}>Watches</span>
                        <span className="text-zinc-600">{agent.watches}</span>
                      </div>
                      <div className="flex gap-2 text-[12px]">
                        <span className="shrink-0 font-medium" style={{ color: agent.accent }}>Prepares</span>
                        <span className="text-zinc-600">{agent.prepares}</span>
                      </div>
                      <div className="flex gap-2 text-[12px]">
                        <span className="shrink-0 font-medium" style={{ color: agent.accent }}>Approval</span>
                        <span className="text-zinc-600">{agent.approval}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

// ── Live signal cards — concrete examples of what the AI actually surfaces.
// Labeled "Source-backed" rather than a fabricated confidence percentage —
// the app itself never shows a numeric confidence score it can't back, so
// the landing page doesn't either. ──────────────────────────────────────
const LIVE_SIGNALS = [
  {
    text: "2 opportunities at risk", source: "Opportunity flow", accent: "#dc2626",
    action: "Review →",
  },
  {
    text: "Follow-up drafted", source: "Emails", accent: "#4f46e5",
    action: "Review draft →",
  },
  {
    text: "Invoice likely overdue", source: "Finance", accent: "#d97706",
    action: "Send reminder →",
  },
  {
    text: "New record enriched", source: "Records", accent: "#059669",
    action: "View record →",
  },
];

function LiveSignalsSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">Source-backed signals</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        What Mondaily notices while you work
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Every signal below comes with where it was found and a suggested next step — source-backed, never a guess presented as fact.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LIVE_SIGNALS.map((s, i) => (
          <motion.div
            key={s.text}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.07 }}
            whileHover={{ y: -3 }}
            className="rounded-xl border border-black/[.05] bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping" style={{ background: s.accent }}/>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: s.accent }}/>
              </span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${s.accent}12`, color: s.accent }}>
                Source-backed
              </span>
            </div>
            <p className="mb-2.5 text-[15px] font-medium text-zinc-800">{s.text}</p>
            <div className="mb-3.5 flex items-center gap-1.5">
              <span className="rounded-full border border-black/[.06] bg-black/[.02] px-2 py-0.5 text-[11px] text-zinc-500">{s.source}</span>
            </div>
            <button className="text-[13px] font-medium transition-opacity hover:opacity-70" style={{ color: s.accent }}>
              {s.action}
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const TRUST_BADGES: { icon: React.ReactElement; label: string }[] = [
  {
    label: "GDPR Compliant Architecture",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3z" strokeLinejoin="round"/>
        <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    label: "CCPA Data Protected",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="11" width="14" height="9" rx="1.5"/>
        <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round"/>
        <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    label: "Hosting Infrastructure: ISO 27001 & SOC 2",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="16" height="5" rx="1.2"/>
        <rect x="4" y="10.5" width="16" height="5" rx="1.2"/>
        <rect x="4" y="17" width="16" height="3" rx="1"/>
        <circle cx="7.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"/>
        <circle cx="7.5" cy="13" r="0.6" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
];

// ── Trust / data isolation ───────────────────────────────────────────────────
const TRUST_POINTS = [
  {
    title: "Workspace isolation",
    desc: "Every client gets a fully isolated workspace — data never crosses tenant boundaries.",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/></svg>),
  },
  {
    title: "AI reads your workspace graph only",
    desc: "Agents only ever see the objects, conversations, and files inside your own workspace graph — never another client's data.",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" strokeLinecap="round"/></svg>),
  },
  {
    title: "Human approval on sensitive actions",
    desc: "Agents prepare and recommend continuously, but sensitive actions — sending, billing, deleting — wait for a person to approve.",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m20 6 -11 11 -5 -5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  },
  {
    title: "Role-based permissions",
    desc: "Every record is protected by role permissions — members only see what they've been granted access to.",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round"/></svg>),
  },
  {
    title: "Granular visibility",
    desc: "Field-level and record-level controls mean teammates only ever see the data relevant to their role.",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6"/></svg>),
  },
  {
    title: "Admin controls & audit logs",
    desc: "Workspace admins get full visibility into who did what, when — every sensitive action is logged.",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 5h11v15H4V9l5-4Z" strokeLinejoin="round"/><path d="M9 5v4H4" strokeLinejoin="round"/><path d="M8 13h7M8 16h5" strokeLinecap="round"/></svg>),
  },
];

// ── AI with approval — agents act, humans stay in control ───────────────────
const APPROVAL_STEPS = [
  { label: "Prepare",  desc: "Agents draft the change before anything touches the graph" },
  { label: "Recommend", desc: "A suggested action appears with the records and evidence behind it" },
  { label: "Monitor",  desc: "Signals and risks are tracked continuously in the background" },
  { label: "Execute",  desc: "Once approved, the action runs and is logged to the source object" },
];

function ApprovalSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">Decision Queue</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Agents prepare. You stay in control.
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Agents prepare, recommend, draft, and monitor continuously — but sensitive actions wait for your approval. Nothing executes on the graph without a human in the loop when it matters.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {APPROVAL_STEPS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.07 }}
            className="relative rounded-xl border border-black/[.05] bg-white p-4"
          >
            <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-[11px] font-semibold text-indigo-600">{i + 1}</span>
            <p className="mb-1 text-[14px] font-medium text-zinc-800">{s.label}</p>
            <p className="text-[12.5px] leading-relaxed text-zinc-500">{s.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const USE_CASES = [
  { label: "Client workspaces", desc: "People, companies, and every interaction connected on one graph.", icon: "◈" },
  { label: "Investment pipelines", desc: "Track deals, diligence, and portfolio companies as connected records.", icon: "◆" },
  { label: "Finance operations", desc: "Invoices, credit notes, and approvals on the same graph as everything else.", icon: "▲" },
  { label: "Hiring & people operations", desc: "Candidates, roles, and interview notes as one connected flow.", icon: "♥" },
  { label: "Project delivery", desc: "Tasks, documents, and decisions tied to the work they belong to.", icon: "▶" },
  { label: "Partner & supplier tracking", desc: "Organizations and contracts, enriched and kept current automatically.", icon: "⚙" },
];

function UseCasesSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">Any workspace graph</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Built for what your team actually tracks
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Mondaily isn't a CRM with a new coat of paint — the workspace graph adapts to whatever records your team needs to connect.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {USE_CASES.map((u, i) => (
          <motion.div
            key={u.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
            className="rounded-xl border border-black/[.05] bg-white p-5"
          >
            <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/[.07] text-[14px] text-indigo-500">{u.icon}</span>
            <p className="mb-1 text-[14px] font-semibold text-zinc-800">{u.label}</p>
            <p className="text-[12.5px] leading-relaxed text-zinc-500">{u.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">Security & data separation</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Your data, isolated and protected
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Mondaily is built so the AI is as trustworthy as the team using it. Isolation and permissions aren&apos;t an afterthought — they&apos;re the foundation.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TRUST_POINTS.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
            className="rounded-xl border border-black/[.05] bg-white p-5"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/[.07] text-indigo-600">
              {p.icon}
            </div>
            <p className="mb-1.5 text-[15px] font-medium text-zinc-800">{p.title}</p>
            <p className="text-[13px] leading-relaxed text-zinc-500">{p.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function TrustBadges() {
  return (
    <div className="border-t border-black/[.04] bg-white">
      <a
        href="/security"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-8 transition-colors hover:bg-black/[.012]"
      >
        {TRUST_BADGES.map(b => (
          <div key={b.label} className="flex items-center gap-2.5 text-zinc-500">
            <span className="text-zinc-400">{b.icon}</span>
            <span className="font-mono text-[12.5px]">{b.label}</span>
          </div>
        ))}
      </a>
    </div>
  );
}

function EmailSignup() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    window.location.href = `https://app.mondaily.com/sign-up?email=${encodeURIComponent(email)}`;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full flex-col gap-2.5 sm:flex-row"
    >
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="flex-1 rounded-xl border border-black/[.08] bg-white px-5 py-3 font-mono text-[14px] text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500/40 transition-colors"
        required
      />
      <button
        type="submit"
        className="shrink-0 rounded-xl bg-indigo-600 px-6 py-3 font-mono text-[14px] font-medium text-white hover:bg-indigo-500 active:translate-y-[1px] transition-all whitespace-nowrap"
      >
        Start free →
      </button>
    </form>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: "Starter", bestFor: "Best for solo operators",
    priceMonthly: 0, priceAnnual: 0, period: "forever",
    desc: "Workspace graph basics for exploring solo.",
    cta: "Start free — takes 90 seconds", href: "https://app.mondaily.com/sign-up", highlight: false,
    capacityPct: 20,
    features: ["Workspace graph basics","Limited Ask Mondaily","Basic records","1 integration","Community support"],
    unlocks: "Unlocks the workspace graph, basic records, and a taste of Ask Mondaily.",
  },
  {
    name: "Pro", bestFor: "Best for AI-operated workspaces",
    priceMonthly: 49, priceAnnual: 39, period: "per user / mo",
    desc: "For workspaces that want AI doing the heavy lifting.",
    cta: "Start Pro trial", href: "https://app.mondaily.com/sign-up?plan=pro", highlight: true,
    capacityPct: 75,
    features: ["Unlimited Ask Mondaily","Agent recommendations","AI enrichment","Automations","Source-backed answers"],
    unlocks: "Unlocks unlimited Ask Mondaily, agent recommendations, AI enrichment, and automations.",
  },
  {
    name: "Business", bestFor: "Best for teams with controls",
    priceMonthly: 89, priceAnnual: 71, period: "per user / mo",
    desc: "For teams that need roles, approvals, and finance.",
    cta: "Start Business trial", href: "https://app.mondaily.com/sign-up?plan=business", highlight: false,
    capacityPct: 90,
    features: ["Roles and permissions","Finance module","Advanced reports","Approval flows","API / webhooks"],
    unlocks: "Unlocks roles & permissions, the finance module, approval flows, and the API.",
  },
  {
    name: "Enterprise", bestFor: "Best for secure graph at scale",
    priceMonthly: null, priceAnnual: null, period: "talk to us",
    desc: "For large organisations needing SSO and compliance.",
    cta: "Contact sales", href: "mailto:sales@mondaily.com", highlight: false,
    capacityPct: 100,
    features: ["SSO / SAML","Audit logs","Data controls","Custom security","SLA"],
    unlocks: "Unlocks SSO/SAML, audit logs, data residency controls, and a dedicated SLA.",
  },
];

// ── Live now / Operating now / Coming online — an honest status board so
// nothing on this page overpromises. Every item is checked against the
// real backend before being placed in a tier. ─────────────────────────────
// Exported so the standalone /pricing page renders the exact same plans —
// previously it had its own stub with different plan names and prices,
// which contradicted the landing page.
export function PricingSection() {
  const [annual, setAnnual] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-widest text-indigo-500">Pricing</p>
      <h2 className="mb-2 font-sans text-4xl font-semibold tracking-tight text-zinc-800">
        Simple, transparent pricing
      </h2>
      <p className="mb-6 text-[15px] text-zinc-500">Start free. Upgrade when you&apos;re ready. No hidden fees.</p>

      {/* Monthly / Annual toggle */}
      <div className="mb-10 flex items-center gap-3 text-[13px]">
        <span className={annual ? "text-zinc-400" : "text-zinc-800 font-medium"}>Monthly</span>
        <button
          onClick={() => setAnnual(a => !a)}
          className="relative h-6 w-11 rounded-full transition-colors"
          style={{ background: annual ? "#4f46e5" : "rgba(0,0,0,.12)" }}
          aria-label="Toggle annual billing"
        >
          <motion.span
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow"
            animate={{ x: annual ? 20 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
          />
        </button>
        <span className={annual ? "text-zinc-800 font-medium" : "text-zinc-400"}>Annual</span>
        <AnimatePresence>
          {annual && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600"
            >
              Save ~20%
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan, i) => {
          const price = annual ? plan.priceAnnual : plan.priceMonthly;
          const hovered = hoverIdx === i;
          return (
            <motion.div
              key={plan.name}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="relative flex flex-col overflow-hidden rounded-2xl border p-5"
              style={{
                borderColor: plan.highlight ? "rgba(79,70,229,0.25)" : "rgba(0,0,0,.05)",
                background: plan.highlight ? "rgba(99,102,241,0.025)" : "rgba(0,0,0,.01)",
              }}
            >
              {/* Pro card — subtle moving AI glow, not a static shadow */}
              {plan.highlight && (
                <motion.div
                  className="pointer-events-none absolute -inset-px rounded-2xl opacity-40"
                  style={{ background: "conic-gradient(from 0deg, transparent, rgba(99,102,241,0.25), transparent 40%)" }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                />
              )}
              <div className="relative">
                {plan.highlight && (
                  <div className="mb-3 self-start rounded-full border border-indigo-500/20 bg-indigo-500/[.07] px-2.5 py-0.5 font-mono text-[11px] text-indigo-600 uppercase tracking-wider inline-block">Most popular</div>
                )}
                <div className="mb-0.5 font-mono text-[13px] font-semibold text-zinc-700">{plan.name}</div>
                <div className="mb-1 font-mono text-[10.5px] text-indigo-500">{plan.bestFor}</div>
                <div className="mb-1 flex items-end gap-1">
                  {price === null ? (
                    <span className="font-mono text-2xl font-light text-zinc-900">Custom</span>
                  ) : (
                    <>
                      <span className="font-mono text-2xl font-light text-zinc-900">${price}</span>
                      <span className="mb-1 font-mono text-[13px] text-zinc-500">/{plan.period}</span>
                    </>
                  )}
                </div>
                {price === null && <div className="mb-1 font-mono text-[13px] text-zinc-500">{plan.period}</div>}
                <p className="mb-3 mt-1.5 font-mono text-[13px] leading-relaxed text-zinc-500">{plan.desc}</p>

                {/* Animated AI capacity meter — illustrative relative tier
                    sizing, not a literal usage metric. */}
                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-zinc-400">
                    <span>AI capacity</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/[.04] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: plan.highlight ? "#4f46e5" : "#a5b4fc" }}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${plan.capacityPct}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>

                <ul className="mb-5 flex-1 space-y-1.5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 font-mono text-[13px] text-zinc-500">
                      <span className="mt-0.5 text-indigo-700">›</span>{f}
                    </li>
                  ))}
                </ul>

                {/* Hover reveal — what this plan unlocks */}
                <AnimatePresence initial={false}>
                  {hovered && (
                    <motion.p
                      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                      animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden font-mono text-[11.5px] leading-relaxed text-indigo-600"
                    >
                      {plan.unlocks}
                    </motion.p>
                  )}
                </AnimatePresence>

                <a href={plan.href} className={`mt-auto block rounded-lg py-2.5 text-center font-mono text-[13px] transition-all ${plan.highlight ? "border border-indigo-500/25 bg-indigo-600 text-white hover:bg-indigo-500 active:translate-y-[1px]" : "border border-black/[.05] bg-black/[.02] text-zinc-600 hover:text-zinc-900 hover:bg-black/[.05]"}`}>
                  {plan.cta}
                </a>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

// ── Cookie banner ─────────────────────────────────────────────────────────────
function CookieBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (localStorage.getItem("mondaily_cookies")) return;
    const t = setTimeout(() => setVisible(true), 4500);
    return () => clearTimeout(t);
  }, []);
  function accept() { localStorage.setItem("mondaily_cookies", "accepted"); setVisible(false); }
  function decline() { localStorage.setItem("mondaily_cookies", "declined"); setVisible(false); }
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed inset-x-0 bottom-6 z-50 mx-auto w-full max-w-xl px-4"
        >
          <div className="rounded-2xl border border-black/[.07] bg-white shadow-[0_24px_64px_rgba(0,0,0,0.10)] overflow-hidden">
            <div className="flex items-start gap-4 px-6 py-5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/10">
                <span className="font-mono text-[11px] font-semibold text-indigo-600">EU</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="mb-1 font-mono text-[12px] font-semibold text-zinc-800">We respect your privacy</p>
                <p className="font-mono text-[12px] text-zinc-500 leading-relaxed">
                  We use essential cookies only — no tracking, no ads, no third-party analytics without your consent. Your data stays yours.
                </p>
              </div>
              <button onClick={decline} className="shrink-0 text-zinc-300 hover:text-zinc-500 transition-colors mt-0.5">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="flex items-center gap-2 border-t border-black/[.05] px-6 py-3">
              <a href="/privacy" className="font-mono text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors">Privacy policy</a>
              <span className="text-zinc-200">·</span>
              <a href="/terms" className="font-mono text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors">Terms</a>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={decline} className="rounded-xl border border-black/[.08] px-4 py-1.5 font-mono text-[12px] text-zinc-500 hover:bg-zinc-50 transition-colors">
                  Decline
                </button>
                <button onClick={accept} className="rounded-xl bg-indigo-600 px-4 py-1.5 font-mono text-[12px] font-medium text-white hover:bg-indigo-500 transition-colors">
                  Accept all
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Sticky start-free nudge ─────────────────────────────────────────────────
function StickyStartBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onScroll() {
      setShow(window.scrollY > 800);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.a
          href="https://app.mondaily.com/sign-up"
          initial={{ y: 16, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 16, opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-600 px-5 py-3 font-mono text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] hover:bg-indigo-500 transition-colors"
        >
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="h-1.5 w-1.5 rounded-full bg-white/90"
          />
          Start free →
        </motion.a>
      )}
    </AnimatePresence>
  );
}

const PRELOADER_SESSION_KEY = "mondaily_preloader_seen";

// ── Main ──────────────────────────────────────────────────────────────────────
export function LandingPage() {
  const [ready, setReady] = useState(false);
  const [skipPreloader, setSkipPreloader] = useState(false);

  useLayoutEffect(() => {
    if (sessionStorage.getItem(PRELOADER_SESSION_KEY)) {
      setSkipPreloader(true);
      setReady(true);
    }
  }, []);

  const handleDone = useCallback(() => {
    setReady(true);
    sessionStorage.setItem(PRELOADER_SESSION_KEY, "1");
  }, []);

  return (
    <>
      {!ready && !skipPreloader && <Preloader onDone={handleDone} />}
      <StickyStartBar />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="min-h-screen bg-white text-zinc-900"
      >
        <header className="sticky top-0 z-40 border-b border-black/[.04] bg-white/90 backdrop-blur-md">
          <Nav />
        </header>

        <main>
          {/* ── Hero ── */}
          <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center">
            <div className="mx-auto max-w-3xl">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 14 }}
                transition={{ duration: 0.55, delay: 0.2 }}
              >
                {/* Live badge */}
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-500/[.07] px-3.5 py-1.5 text-[13px] font-medium text-indigo-500">
                  <motion.span animate={{ opacity: [0.4,1,0.4] }} transition={{ duration: 1.8, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-indigo-600"/>
                  An autonomous AI workspace
                </div>

                {/* Live status row — small, real-feeling status chips that
                    breathe, echoing the same vocabulary used inside the app
                    (Home's command room) so the landing page feels alive
                    rather than static marketing copy. */}
                <div className="mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-zinc-400">
                  {[
                    { label: "Graph synced", color: "#10b981" },
                    { label: "Agents active", color: "#8b5cf6" },
                    { label: "Sources checked", color: "#06b6d4" },
                  ].map((s, i) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <motion.span
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                          className="absolute inline-flex h-full w-full rounded-full"
                          style={{ background: s.color }}
                        />
                      </span>
                      {s.label}
                    </span>
                  ))}
                </div>

                {/* Slogan */}
                <h1 className="mx-auto mb-4 max-w-3xl font-sans font-semibold leading-[1.08] tracking-tight text-zinc-900" style={{ fontSize: "clamp(2.4rem, 5.5vw, 3.75rem)" }}>
                  Your workspace,{" "}
                  <span className="text-indigo-500">run by AI agents.</span>
                </h1>

                {/* Subheading */}
                <p className="mx-auto mb-7 max-w-xl text-[15px] leading-relaxed text-zinc-500">
                  Mondaily connects records, tasks, finance, conversations, workflows, and decisions into one living workspace graph. AI agents watch the graph, explain what changed, and prepare the next action with sources.
                </p>

                {/* Primary / secondary CTAs */}
                <div className="mb-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <a
                    href="https://app.mondaily.com/sign-up"
                    className="rounded-full bg-indigo-600 px-7 py-3 text-[14.5px] font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.28)] transition-all hover:bg-indigo-500 hover:shadow-[0_10px_30px_rgba(79,70,229,0.35)] active:translate-y-[1px]"
                  >
                    Start your workspace graph →
                  </a>
                  <a
                    href="#agents"
                    className="flex items-center gap-2 rounded-full border border-black/[.08] bg-white px-7 py-3 text-[14.5px] font-medium text-zinc-700 transition-all hover:border-indigo-500/30 hover:text-indigo-600 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>
                    See agents operate
                  </a>
                </div>

                {/* Agent preview strip — agents are core identity, shown immediately under the fold */}
                <div className="mb-9 flex flex-wrap items-center justify-center gap-2">
                  {AGENTS.slice(0, 4).map((agent, i) => (
                    <span
                      key={agent.name}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px]"
                      style={{ borderColor: `${agent.accent}25`, background: `${agent.accent}08`, color: agent.accent }}
                    >
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: agent.accent }}
                      />
                      {agent.name}
                    </span>
                  ))}
                </div>
              </motion.div>

              {/* Chat search bar */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 12 }}
                transition={{ duration: 0.55, delay: 0.32 }}
              >
                <HeroChat />
              </motion.div>

              {/* Email signup — directly under the feature lines, with breathing room */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 10 }}
                transition={{ duration: 0.55, delay: 0.55 }}
                className="mx-auto mt-12 max-w-2xl"
              >
                <EmailSignup />
                <p className="mt-3 text-center font-mono text-[13px] text-zinc-500">
                  Free forever · no card required · takes 90 seconds
                </p>
              </motion.div>
            </div>

            {/* Hero visual proof — stylized pipeline mockup */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 14 }}
              transition={{ duration: 0.55, delay: 0.45 }}
              className="mt-14"
            >
              <HeroPipelinePreview />
            </motion.div>
          </section>

          {/* ── Agents — moved close to the hero: agents are the core identity, not a footnote ── */}
          <AgentsSection />

          {/* ── Live signal cards ── */}
          <LiveSignalsSection />

          {/* ── How it's different ── */}
          <ComparisonSection />

          {/* ── Use cases — no narrow CRM framing ── */}
          <UseCasesSection />

          {/* ── Workflow demo ── */}
          <WorkflowDemo />

          {/* ── Automation flow diagram ── */}
          <AutomationFlow />

          {/* ── Records sheet demo ── */}
          <RecordsSheetSection />

          {/* ── Finance / invoice board demo ── */}
          <FinanceBoardSection />

          {/* ── Feature map ── */}
          <FeatureSection />

          {/* ── Pricing ── */}
          <PricingSection/>

          {/* ── AI with approval — agents act, humans stay in control ── */}
          <ApprovalSection />

          {/* ── Trust / data isolation ── */}
          <TrustSection />

          {/* ── FAQ ── */}
          <FAQSection />

          {/* ── Final CTA ── */}
          <section className="mx-auto max-w-6xl px-6 py-20 text-center">
            <h2 className="mx-auto mb-3 max-w-2xl font-sans text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              Ready to put your workspace on autopilot?
            </h2>
            <p className="mb-8 font-mono text-[14px] text-zinc-500">
              Join the teams already running records, pipeline, and finance from one place.
            </p>
            <div className="mx-auto max-w-2xl">
              <EmailSignup />
              <p className="mt-3 text-center font-mono text-[13px] text-zinc-500">
                Free forever · no card required · takes 90 seconds
              </p>
            </div>
          </section>
        </main>

        {/* ── Trust & compliance ── */}
        <TrustBadges />

        {/* ── Footer ── */}
        <footer className="relative bg-zinc-50">
          <div className="absolute top-0 left-1/2 h-px w-full max-w-3xl -translate-x-1/2" style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.35), transparent)" }}/>
          <FooterTicker />
          <div className="mx-auto max-w-6xl px-6 py-14">
            <div className="mb-10 flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-[260px]">
                <div className="mb-4">
                  <Logo size={38} />
                </div>
                <p className="font-mono text-[13px] text-zinc-500 leading-relaxed">Autonomous AI workspace platform. Built for teams that move fast.</p>
              </div>

              <div className="flex flex-wrap gap-x-14 gap-y-8 font-mono text-[13px]">
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Product</span>
                  <a href="#pricing" className="text-zinc-500 hover:text-indigo-400 transition-colors">Pricing</a>
                  <a href="/changelog" className="text-zinc-500 hover:text-indigo-400 transition-colors">Changelog</a>
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Platform</span>
                  <a href="/status" className="text-zinc-500 hover:text-indigo-400 transition-colors">System status</a>
                  <a href="/roadmap" className="text-zinc-500 hover:text-indigo-400 transition-colors">Roadmap</a>
                  <a href="/security" className="text-zinc-500 hover:text-indigo-400 transition-colors">Security</a>
                  <a href="/docs" className="text-zinc-500 hover:text-indigo-400 transition-colors">API docs</a>
                  <a href="/help" className="text-zinc-500 hover:text-indigo-400 transition-colors">Help center</a>
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Legal</span>
                  <a href="/privacy" className="text-zinc-500 hover:text-indigo-400 transition-colors">Privacy</a>
                  <a href="/terms" className="text-zinc-500 hover:text-indigo-400 transition-colors">Terms</a>
                  <a href="/dpa" className="text-zinc-500 hover:text-indigo-400 transition-colors">DPA</a>
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Contact</span>
                  <a href="mailto:support@mondaily.com" className="text-zinc-500 hover:text-indigo-400 transition-colors">Support</a>
                  <a href="mailto:sales@mondaily.com" className="text-zinc-500 hover:text-indigo-400 transition-colors">Sales</a>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-black/[.05] pt-6 font-mono text-[12px] text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
              <span>© {new Date().getFullYear()} Mondaily. All rights reserved.</span>
              <a href="/status" className="flex items-center gap-1.5 text-zinc-400 hover:text-indigo-400 transition-colors">
                System status
              </a>
            </div>
          </div>
        </footer>
      </motion.div>

      <CookieBanner />
    </>
  );
}
