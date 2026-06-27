"use client";
import { motion, AnimatePresence } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "./nav";
import { HeroChat } from "./hero-chat";
import { Logo } from "./logo";

function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

// ── Preloader — calm, premium, but alive: a small animated graph of nodes
// lighting up in sequence (the workspace graph "waking up"), with cycling
// plain-language status text. No boot-log brackets, no timestamps — just
// motion that reads as AI-native rather than a terminal. ───────────────────
const PRELOADER_STATUS = [
  "Reading graph",
  "Checking sources",
  "Preparing agents",
  "Ready",
];

function Preloader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [fade, setFade] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);

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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-8 text-neutral-950"
    >
      <div className="w-full max-w-sm">
        <div className="mb-2 flex items-center justify-center">
          <Logo size={32} />
        </div>

        <div className="mx-auto mb-6 mt-8 w-full max-w-xs space-y-3">
          {PRELOADER_STATUS.slice(0, 3).map((label, i) => {
            const active = statusIdx >= i;
            return (
              <div key={label} className="grid grid-cols-[92px_1fr] items-center gap-3 text-[12px]">
                <span className={active ? "text-neutral-950" : "text-zinc-400"}>{label}</span>
                <div className="h-px bg-black/[.08]">
                  <motion.div
                    className="h-px bg-neutral-950"
                    animate={{ width: active ? "100%" : "0%" }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-px w-full bg-black/[.06]">
          <motion.div className="h-px bg-neutral-950" animate={{ width: `${progress}%` }} transition={{ duration: 0.25 }}/>
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
  "graph.sync(records)",
  "agents.watch(changes)",
  "sources.attach(evidence)",
  "human.approve(actions)",
  "finance.monitor(invoices)",
  "workflow.prepare(next)",
];

function FooterTicker() {
  return (
    <div className="border-b border-black/[.04]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-1 px-6 py-3">
        {FOOTER_TICKER_LINES.map((text, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-zinc-300" aria-hidden="true" />
            <span className="text-[11px] text-zinc-400">{text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const MODULE_ZONES: { zone: string; ids: string[]; accent: string }[] = [
  { zone: "Data",         ids: ["crm", "enrich"],            accent: "#9fb08f" },
  { zone: "Intelligence", ids: ["pipeline", "ask"],          accent: "#a68762" },
  { zone: "Action",       ids: ["sequences", "automations"], accent: "#a07164" },
  { zone: "Operations",   ids: ["finance", "mcp"],           accent: "#6f8068" },
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
      className="text-zinc-800"
    >
      {value.toLocaleString()}
    </motion.span>
  );
}

function RotatingWord({ words }: { words: string[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % words.length), 1700);
    return () => clearInterval(t);
  }, [words.length]);

  return (
    <span className="relative inline-flex min-w-[7.2ch] justify-start text-neutral-950 dark:text-neutral-50">
      <AnimatePresence mode="wait">
        <motion.span
          key={words[idx]}
          initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
          transition={{ duration: 0.28 }}
          className="inline-block"
        >
          {words[idx]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}


function FeatureSection() {
  const [active, setActive] = useState<string | null>(null);
  const getNode = (id: string) => MAIN_NODES.find(n => n.id === id)!;

  return (
    <section className="mx-auto max-w-7xl px-4 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-[0.18em]" style={{ color: "#9fb08f" }}>One workspace graph</p>
      <h2 className="mb-4 font-sans font-semibold tracking-tight text-zinc-800">
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
                    <span className="h-2 w-2 rounded-full transition-all" style={{ background: z.accent, opacity: on ? 1 : 0.6, boxShadow: on ? `0 0 0 3px ${z.accent}26` : "none" }}/>
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

      {/* Integrations strip */}
      <div className="mt-10 border-t border-black/[.05] pt-8 space-y-5">
        {/* App integrations */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400 mr-1">Integrations ·</span>
          {([
            { name: "Gmail", bg: "#EA4335", icon: <path fill="white" d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/> },
            { name: "Outlook", bg: "#0078D4", icon: <><rect x="1" y="2" width="13" height="20" rx="2" fill="white" opacity="0.9"/><circle cx="7.5" cy="12" r="4" fill="#0078D4"/><rect x="14" y="5" width="10" height="14" rx="1" fill="white" opacity="0.7"/><path d="M14 7l5 5-5 5" fill="none" stroke="white" strokeWidth="1.5"/></> },
            { name: "Google Calendar", bg: "#1A73E8", icon: <><rect x="2" y="3" width="20" height="18" rx="2" fill="white" opacity="0.15" stroke="white" strokeWidth="1.5"/><rect x="2" y="3" width="20" height="6" rx="2" fill="white" opacity="0.3"/><text x="12" y="18" textAnchor="middle" fontFamily="Arial" fontWeight="800" fontSize="9" fill="white">31</text><line x1="7" y1="1" x2="7" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><line x1="17" y1="1" x2="17" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></> },
            { name: "Slack", bg: "#4A154B", icon: <path fill="white" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.123 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.166 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.166 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/> },
            { name: "Zapier", bg: "#FF4A00", icon: <path fill="white" d="M13.617 11.997l5.247-5.248H19v-.003l.003.003L24 6.745v-4.49L19.008 2.25 13.753 7.5H13.5L10.24 7.49 15.75 2H11.25L6 7.5h-.247L.003 2.253 0 2.25v4.49l5 .009v.001h.247L0 12v4.5l5.25-.001L10.5 12h.253v.003L5.25 17.49v.003h-.003L.003 17.502 0 17.5V22l5.25.001L10.5 16.5h.253l3.255.009-5.508 5.509v-.001L8.25 22h4.5l5.25-5.5h.247l4.998.009.005-.009V22h.75v-4.5l-5.25-.009V17.49l5.25-5.49V7.5l-5.25 4.497h-.135Z"/> },
            { name: "Typeform", bg: "#262627", icon: <><line x1="4" y1="5" x2="20" y2="5" stroke="white" strokeWidth="2.5" strokeLinecap="round"/><line x1="12" y1="5" x2="12" y2="19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></> },
            { name: "Segment", bg: "#52BD94", icon: <path fill="white" d="M22 11h-1.032A9.004 9.004 0 0 0 13 3.032V2h-2v1.032A9.004 9.004 0 0 0 3.032 11H2v2h1.032A9.004 9.004 0 0 0 11 20.968V22h2v-1.032A9.004 9.004 0 0 0 20.968 13H22v-2zm-9 8a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm4-8H13V7h-2v4H7v2h4v4h2v-4h4v-2z"/> },
            { name: "Mailchimp", bg: "#FFE01B", icon: <path fill="#241C15" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22z"/> },
          ] as { name: string; bg: string; icon: React.ReactNode }[]).map(item => (
            <div
              key={item.name}
              aria-label={item.name}
              title={item.name}
              className="flex items-center justify-center shrink-0"
              style={{ width: 36, height: 36, borderRadius: 9, background: item.bg }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18">{item.icon}</svg>
            </div>
          ))}
        </div>

        {/* Developer tools */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400 mr-1">For developers ·</span>
          {["REST API", "Webhooks", "MCP Server"].map(label => (
            <span
              key={label}
              className="rounded-full border border-black/[.08] px-3 py-1 text-[11.5px] font-medium text-zinc-600"
            >
              {label}
            </span>
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
  { tag: "Record",       tagCol: "#9fb08f", delay: 400,  title: "Record added" },
  { tag: "Enrichment",   tagCol: "#a68762", delay: 1100, title: "AI enrichment fired" },
  { tag: "Graph",        tagCol: "#8fb3b0", delay: 1800, title: "Relationship health updated — moved to Proposal" },
  { tag: "Sequence",     tagCol: "#6f8068", delay: 2500, title: "Sequence enrolled: Enterprise Nurture" },
  { tag: "Automation",   tagCol: "#607078", delay: 3200, title: "Automation triggered on graph event" },
  { tag: "Finance",      tagCol: "#a07164", delay: 3900, title: "Quote drafted — queued for approval" },
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
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % REPLACES_ROWS.length), 1800);
    return () => clearInterval(t);
  }, []);

  const row = REPLACES_ROWS[idx]!;

  return (
    <section className="mx-auto max-w-6xl px-6 py-14">
      <div className="border-y border-black/[.06] py-6">
        <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">What Mondaily replaces</p>
        <div className="flex flex-col gap-2 text-left text-[17px] font-medium tracking-tight text-zinc-900 sm:flex-row sm:items-baseline sm:text-xl">
          <span>From {row.before.toLowerCase()}</span>
          <span className="hidden text-zinc-300 sm:inline">→</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={row.after}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28 }}
              className="text-zinc-500"
            >
              {row.after.toLowerCase()}.
            </motion.span>
          </AnimatePresence>
        </div>
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
        <span className="inline-block w-[1px] h-[0.85em] bg-zinc-800 ml-[1px] opacity-50 animate-pulse align-middle"/>
      )}
    </>
  );
}

function FAQSection() {
  const [active, setActive] = useState(0);

  return (
    <section id="faq" className="mx-auto max-w-4xl px-6 py-16">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">FAQ</p>
      <h2 className="mb-8 font-sans font-semibold tracking-tight text-zinc-900">Common questions</h2>

      <div className="overflow-hidden">
        <div className="flex items-center gap-2 py-3">
          <span className="text-[13px] font-medium text-zinc-700">Workspace answers</span>
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="ml-auto h-1.5 w-1.5 rounded-full bg-zinc-500"
          />
        </div>

        {/* Transcript */}
        <div className="py-5">
          <div className="flex justify-end mb-3">
            <div className="max-w-[80%] px-1 py-2.5 text-right text-[13px] text-zinc-800">
              {FAQ_ITEMS[active]!.q}
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[85%] px-1 py-2.5 text-[13px] leading-relaxed text-zinc-600">
              <FAQTypewriter key={active} text={FAQ_ITEMS[active]!.a} />
            </div>
          </div>
        </div>

        {/* Question list */}
        <div className="py-2">
          {FAQ_ITEMS.map((item, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`flex w-full items-center gap-3 border-b border-black/[.05] py-3 text-left text-[13px] transition-colors last:border-b-0 ${
                active === i ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <span className={active === i ? "text-zinc-900" : "text-zinc-300"}>{'>'}</span>
              <span className="flex-1 truncate">{item.q}</span>
              {active === i && (
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500"
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
      <p className="mb-2 text-[13px] font-medium uppercase tracking-[0.18em]" style={{ color: "#9fb08f" }}>Live on the graph</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-800">
        What happens when a record enters Mondaily
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Zero manual input. The platform enriches, scores, connects, and notifies — automatically.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Left: enriched record card ── */}
        <div className="rounded-2xl border border-black/[.05] p-6" style={{ background: "var(--landing-surface)" }}>
          {/* Card header */}
          <div className="mb-5 flex items-center justify-between border-b border-black/[.04] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/[.07] bg-zinc-100 text-[14px] text-zinc-600 font-bold">{scenario.initials}</div>
              <div>
                <div className="text-[13px] text-zinc-900 font-medium">{scenario.company}</div>
                <div className="text-[14px] text-zinc-600">{scenario.domain}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="h-1.5 w-1.5 rounded-full bg-zinc-500"
              />
              <span className="text-[14px] text-zinc-500">enriched</span>
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
                <span className={`text-[13px] ${f.key === "Signal" ? "text-zinc-700" : f.key === "Relationship Health" ? "text-zinc-600" : "text-zinc-600"}`}>
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
        <div className="rounded-2xl border border-black/[.05] p-6" style={{ background: "var(--landing-surface)" }}>
          <div className="mb-5 flex items-center gap-2 border-b border-black/[.04] pb-4">
            <span className="text-[14px] font-medium text-zinc-700">Activity on this record</span>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="ml-auto h-1.5 w-1.5 rounded-full bg-zinc-500"
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
                    <div className="h-2 w-2 rounded-full mt-1 shrink-0" style={{ background: step.tagCol }} />
                    {i < shownSteps - 1 && (
                      <div className="mt-1 flex-1 w-px min-h-[20px]" style={{ background: `${step.tagCol}30` }}/>
                    )}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-medium" style={{ color: step.tagCol }}>{step.tag}</span>
                      <span className="text-[13px] text-zinc-700">{step.title}</span>
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
                  <motion.span key={i} className="h-1 w-1 rounded-full bg-zinc-500"
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
                <span className="text-[14px] text-zinc-500">[DONE]</span>
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
      { label: "High engagement", col: "#9fb08f" },
      { label: "Nurture", col: "#8a8071" },
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

const FLOW_NODE_COLORS: Record<string, string> = {
  trigger: "#9fb08f",
  score: "#a68762",
  condition: "#8fb3b0",
  sequence: "#6f8068",
  slack: "#607078",
  finance: "#a07164",
};

function FlowNode({ node, active, alwaysShow = false }: { node: typeof FLOW_NODES[number]; active: boolean; alwaysShow?: boolean }) {
  const isVisible = active || alwaysShow;
  const accent = FLOW_NODE_COLORS[node.id] ?? "#9fb08f";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: active ? 1 : alwaysShow ? 0.55 : 0.22, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl px-5 py-3.5"
      style={{
        background: active ? `${accent}10` : "rgba(0,0,0,0.02)",
        border: `1px solid ${active ? `${accent}40` : "rgba(0,0,0,0.04)"}`,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-medium" style={{ color: active ? accent : "#a1a1aa" }}>
          {node.tag}
        </span>
        {active && node.type !== "condition" && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12px]" style={{ color: accent }}>
            ✓
          </motion.span>
        )}
        {active && node.type === "condition" && (
          <span className="text-[12px]" style={{ color: accent }}>branching →</span>
        )}
      </div>
      <div className="text-[14px] text-zinc-800">{node.label}</div>
      <div className="mt-0.5 text-[13px] text-zinc-500 leading-relaxed">{node.sub}</div>
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
        className={`w-px ${short ? "h-5" : "h-8"} bg-gradient-to-b from-zinc-400/60 to-transparent`}
      />
    </div>
  );

  return (
    <section
      ref={ref}
      className="mx-auto max-w-6xl px-6 py-20"
    >
      <p className="mb-2 text-[13px] font-medium uppercase tracking-[0.18em]" style={{ color: "#a68762" }}>How the graph works</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-800">
        Design once. Apply to every object on the graph.
      </h2>
      <p className="mb-6 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Visual flows built on real graph events — no code required. Today a human reviews and runs each
        one; autonomous execution is on the <a href="/roadmap" className="text-zinc-600 hover:underline">roadmap</a>.
      </p>

      {/* Plain-language framing — the full lifecycle of an object in the graph, not a technical diagram */}
      <div className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-black/[.05] bg-zinc-50/70 px-5 py-4 text-[13.5px] font-medium text-zinc-700">
        {["Object enters", "Becomes a graph node", "Enriched", "Connected to related nodes", "Agents monitor", "Signal created", "Decision queued", "Action approved"].map((step, i, arr) => (
          <span key={step} className="flex items-center gap-2">
            <span className={i % 2 === 1 ? "text-zinc-700" : ""}>{step}</span>
            {i < arr.length - 1 && <span className="text-zinc-400">→</span>}
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
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-0.5 text-[14px] text-zinc-700">High intent</span>
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

          {/* Done state — always in DOM, opacity-only transition to prevent layout shift */}
          <div
            style={{ opacity: shownCount >= FLOW_NODES.length ? 1 : 0, transition: "opacity 0.5s ease 0.2s" }}
            className="mt-6 flex items-center gap-3 font-mono"
          >
            <div className="h-px flex-1 bg-black/[.04]"/>
            <span className="text-[14px] text-zinc-500">[FLOW COMPLETE]</span>
            <div className="h-px flex-1 bg-black/[.04]"/>
          </div>
        </div>

        {/* Right: stat callouts */}
        <div className="flex flex-col gap-4">
          <div className="font-mono text-[11px] text-zinc-400 uppercase tracking-widest mb-2">// what this replaces</div>
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
                <span className="mt-0.5 text-zinc-500 text-[14px]">{row.icon}</span>
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
            className="mt-2 rounded-full border border-black/[.1] bg-transparent px-5 py-3 text-center text-[13px] text-zinc-600 hover:border-black/[.2] hover:text-zinc-900 transition-all"
          >
            Build your first flow →
          </motion.a>
        </div>
      </div>
    </section>
  );
}

// ── Email signup ──────────────────────────────────────────────────────────────
// ── Hero backdrop — an SVG net behind the hero text only. Each line is a gradient
// stroke that FADES at its ends and is strongest in the middle, so the lines
// "meet" softly at the centre (no whole-net fade). Glowing colour traces run
// along a few of the lines. ───────────────────────────────────────────────────
const HERO_TRACES: Array<{ type: "h" | "v"; along: number; color: string; dur: number; delay: number }> = [
  { type: "h", along: 120, color: "#5f9e8f", dur: 7,   delay: 0 },
  { type: "h", along: 240, color: "#c08a3e", dur: 9,   delay: 3.2 },
  { type: "v", along: 270, color: "#7b6fb0", dur: 8,   delay: 1.5 },
  { type: "v", along: 450, color: "#4f9bc4", dur: 10,  delay: 5 },
  { type: "h", along: 60,  color: "#c76b78", dur: 8.5, delay: 6.4 },
  { type: "v", along: 180, color: "#5fa05f", dur: 11,  delay: 2.4 },
];
function HeroNetBackdrop() {
  const H = [60, 120, 180, 240, 300];
  const V = [90, 180, 270, 360, 450, 540, 630];
  return (
    <div aria-hidden className="hero-net pointer-events-none absolute left-1/2 top-1/2 w-[min(820px,96vw)] -translate-x-1/2 -translate-y-1/2">
      <svg viewBox="0 0 720 360" className="h-auto w-full" fill="none">
        <defs>
          <linearGradient id="heroLineH" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="720" y2="0">
            <stop offset="0" stopColor="#64748b" stopOpacity="0" />
            <stop offset="0.5" stopColor="#64748b" stopOpacity="0.28" />
            <stop offset="1" stopColor="#64748b" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="heroLineV" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="360">
            <stop offset="0" stopColor="#64748b" stopOpacity="0" />
            <stop offset="0.5" stopColor="#64748b" stopOpacity="0.28" />
            <stop offset="1" stopColor="#64748b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {H.map((y, i) => (
          <line key={`h${i}`} x1="0" y1={y} x2="720" y2={y} stroke="url(#heroLineH)" strokeWidth="1" className="hero-line" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
        {V.map((x, i) => (
          <line key={`v${i}`} x1={x} y1="0" x2={x} y2="360" stroke="url(#heroLineV)" strokeWidth="1" className="hero-line" style={{ animationDelay: `${i * 0.4 + 0.25}s` }} />
        ))}
        {HERO_TRACES.map((t, i) => (
          <circle
            key={i}
            r="3.4"
            cx={t.type === "h" ? 0 : t.along}
            cy={t.type === "h" ? t.along : 0}
            className={`hero-trace hero-trace-${t.type}`}
            style={{ fill: t.color, color: t.color, ["--td" as string]: `${t.dur}s`, animationDelay: `${t.delay}s` } as React.CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
}

// ── Hero visual proof — pipeline board, styled like the real app ──────────────
const STAGE_STYLE: Record<string, { dot: string; text: string }> = {
  New:         { dot: "bg-zinc-300",    text: "text-zinc-500" },
  Qualified:   { dot: "bg-zinc-400",    text: "text-zinc-600" },
  Proposal:    { dot: "bg-zinc-500",    text: "text-zinc-600" },
  Negotiation: { dot: "bg-zinc-600",    text: "text-zinc-700" },
  Won:         { dot: "bg-zinc-900",    text: "text-zinc-900" },
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
      style={{ border: "1px solid var(--landing-line-strong)", background: "var(--landing-surface)" }}
    >
      <div className="flex items-center gap-2 border-b border-black/[.05] px-4 py-2.5">
        <span className="text-[13px] font-medium text-zinc-700">Opportunity flow — your workspace graph</span>
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          className="ml-auto h-1.5 w-1.5 rounded-full"
          style={{ background: "#9fb08f" }}
        />
        <span className="text-[11px]" style={{ color: "#9fb08f" }}>agent-monitored</span>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 border-b border-black/[.05] bg-black/[.015] px-4 py-2.5 text-[12px]">
        <span className="text-zinc-500">Opportunity value <span className="text-zinc-800">{totalValue}</span></span>
        <span className="text-zinc-500">Open opportunities <span className="text-zinc-800">{openDeals}</span></span>
        <span className="text-zinc-500">Won this month <span className="text-zinc-700">£40k</span></span>
      </div>

      {/* Live activity ticker */}
      <div className="border-b border-black/[.05] px-4 py-2 font-mono text-[11px]" style={{ background: "rgba(159,176,143,0.04)", color: "#9fb08f" }}>
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
                        <span className="font-mono text-[11px]" style={{ color: "#9fb08f" }}>{d.val}</span>
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

const WORKSPACE_GRAPH_NODES = [
  { label: "Graph Agent", x: 50, y: 25, color: "#9fb08f", detail: "Searches, links, and explains records" },
  { label: "Enrichment Agent", x: 25, y: 50, color: "#8a8071", detail: "Adds sourced fields from the web" },
  { label: "Relationship Agent", x: 75, y: 50, color: "#a68762", detail: "Watches follow-ups and relationship health" },
  { label: "Finance Agent", x: 25, y: 76, color: "#a07164", detail: "Prepares invoice and credit-note actions" },
  { label: "Operations Agent", x: 75, y: 76, color: "#6f8068", detail: "Finds overdue and stalled work" },
  { label: "Ask AI", x: 50, y: 90, color: "#607078", detail: "Turns the graph into an ongoing conversation" },
];

const WORKSPACE_TERMINAL_ROWS: Array<{
  prompt: string;
  segments: Array<{ text: string; color: string }>;
}> = [
  {
    prompt: "graph.read",
    segments: [
      { text: "mondaily", color: "#9fb08f" },
      { text: ".", color: "#7c8379" },
      { text: "graph.read", color: "#9fb08f" },
      { text: " --input ", color: "#7c8379" },
      { text: "workspace_nodes", color: "#8fb3b0" },
      { text: " --output ", color: "#7c8379" },
      { text: '"records_linked"', color: "#d7c6a3" },
    ],
  },
  {
    prompt: "enrich.run",
    segments: [
      { text: "mondaily", color: "#8a8071" },
      { text: ".", color: "#7c8379" },
      { text: "enrich.run", color: "#8fb3b0" },
      { text: " --scope ", color: "#7c8379" },
      { text: "new_records", color: "#8fb3b0" },
      { text: " --attach ", color: "#7c8379" },
      { text: '"web_sources"', color: "#d7c6a3" },
    ],
  },
  {
    prompt: "relationship.scan",
    segments: [
      { text: "mondaily", color: "#a68762" },
      { text: ".", color: "#7c8379" },
      { text: "relationship.scan", color: "#d7c6a3" },
      { text: " --filter ", color: "#7c8379" },
      { text: "open_loops", color: "#8fb3b0" },
      { text: " --prepare ", color: "#7c8379" },
      { text: '"follow_up"', color: "#d7c6a3" },
    ],
  },
  {
    prompt: "finance.watch",
    segments: [
      { text: "mondaily", color: "#a07164" },
      { text: ".", color: "#7c8379" },
      { text: "finance.watch", color: "#c59a8d" },
      { text: " --check ", color: "#7c8379" },
      { text: "invoice_age", color: "#8fb3b0" },
      { text: " --draft ", color: "#7c8379" },
      { text: '"reminder"', color: "#d7c6a3" },
    ],
  },
  {
    prompt: "ops.queue",
    segments: [
      { text: "mondaily", color: "#6f8068" },
      { text: ".", color: "#7c8379" },
      { text: "ops.queue", color: "#9fb08f" },
      { text: " --scan ", color: "#7c8379" },
      { text: "stalled_tasks", color: "#8fb3b0" },
      { text: " --route ", color: "#7c8379" },
      { text: '"decision_ready"', color: "#d7c6a3" },
    ],
  },
];

const AGENT_ASK_PROMPTS = [
  "What records did the graph link or surface this week?",
  "Which records have been enriched from the web recently?",
  "Which relationships have gone quiet or need a follow-up?",
  "Which invoices are overdue or need chasing right now?",
  "What tasks are stalled or overdue across the workspace?",
  "What should I act on across the workspace today?",
];

function TerminalLine({
  segments,
  children,
  active,
  typedChars,
}: {
  segments?: Array<{ text: string; color: string }>;
  children?: ReactNode;
  active?: boolean;
  typedChars?: number;
}) {
  // Children-only usage (legacy call sites without segments)
  if (!segments) {
    return (
      <div
        style={{ opacity: active ? 1 : 0.45, transition: "opacity 0.35s" }}
        className="h-7 overflow-hidden whitespace-nowrap text-left font-mono text-[12px] leading-7"
      >
        <span style={{ color: "#7c8379" }}>$ </span>{children}
      </div>
    );
  }

  const totalLength = segments.reduce((s, seg) => s + seg.text.length, 0);
  const isTyping = active && typedChars !== undefined;

  if (isTyping) {
    let remaining = typedChars!;
    const visible: Array<{ text: string; color: string }> = [];
    for (const seg of segments) {
      if (remaining <= 0) break;
      visible.push({ text: seg.text.slice(0, remaining), color: seg.color });
      remaining -= seg.text.length;
    }
    const complete = typedChars! >= totalLength;
    return (
      <div className="h-7 overflow-hidden whitespace-nowrap text-left font-mono text-[12px] leading-7">
        <span style={{ color: "#7c8379" }}>$ </span>
        {visible.map((seg, i) => <span key={i} style={{ color: seg.color }}>{seg.text}</span>)}
        {!complete && <span className="ml-px inline-block h-[0.85em] w-px animate-pulse bg-[#9fb08f] align-middle" />}
      </div>
    );
  }

  return (
    <div
      style={{ opacity: active ? 1 : 0.38, transition: "opacity 0.35s" }}
      className="h-7 overflow-hidden whitespace-nowrap text-left font-mono text-[12px] leading-7"
    >
      <span style={{ color: "#7c8379" }}>$ </span>
      {segments.map((seg, i) => <span key={i} style={{ color: seg.color }}>{seg.text}</span>)}
    </div>
  );
}

function WorkspaceGraphPreview() {
  const [active, setActive] = useState(0);
  const [typedChars, setTypedChars] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive(i => (i + 1) % WORKSPACE_GRAPH_NODES.length), 2600);
    return () => clearInterval(t);
  }, []);

  const activeRowIndex = active % WORKSPACE_TERMINAL_ROWS.length;
  const activeRow = WORKSPACE_TERMINAL_ROWS[activeRowIndex]!;
  const activeRowLength = activeRow.segments.reduce((s, seg) => s + seg.text.length, 0);

  useEffect(() => {
    setTypedChars(0);
    const t = setInterval(() => {
      setTypedChars(c => (c < activeRowLength ? c + 1 : c));
    }, 30);
    return () => clearInterval(t);
  }, [active, activeRowLength]);

  const activeNode = WORKSPACE_GRAPH_NODES[active]!;
  const askPrompt = AGENT_ASK_PROMPTS[active]!;

  return (
    <div className="relative mx-auto w-full max-w-full overflow-hidden sm:max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT PANEL — graph tree */}
        <div className="relative flex min-h-[460px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 sm:p-7">
          <div className="mb-6 text-left">
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Living workspace graph</p>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                <motion.span
                  animate={{ opacity: [0.35, 1, 0.35] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  className="h-1.5 w-1.5 rounded-full bg-[#6f8068]"
                />
                agents watching
              </span>
            </div>
            <h3 className="max-w-xl text-xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-2xl">
              Agents operate on one shared graph.
            </h3>
          </div>

          <div className="flex flex-col items-center">
            <div className="flex flex-col items-center gap-1.5">
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="h-2 w-2 rounded-full bg-[#6f8068]"
              />
              <p className="text-[11px] text-zinc-500">workspace graph</p>
            </div>

            <div className="relative mt-4 w-full">
              <div className="absolute left-1/2 -top-4 h-4 w-px -translate-x-1/2" style={{ background: "#8a8378", opacity: 0.5 }} />
              <div className="absolute left-6 right-6 top-0 h-px" style={{ background: "#8a8378", opacity: 0.4 }} />
              <div className="grid grid-cols-1 gap-x-8 gap-y-px pt-5 sm:grid-cols-2">
                {WORKSPACE_GRAPH_NODES.map((node, i) => (
                  <motion.button
                    key={node.label}
                    type="button"
                    onClick={() => setActive(i)}
                    initial={false}
                    animate={{ opacity: i === active ? 1 : 0.5 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-start gap-2.5 py-2.5 text-left"
                  >
                    <span className="relative mt-1 flex h-2 w-2 shrink-0 items-center justify-center">
                      <span className="h-2 w-2 rounded-full" style={{ background: node.color }} />
                      {i === active && (
                        <motion.span
                          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 2.2, 1] }}
                          transition={{ duration: 1.7, repeat: Infinity }}
                          className="absolute inset-0 rounded-full"
                          style={{ background: node.color }}
                        />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-[12px] font-medium text-zinc-800">{node.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{node.detail}</span>
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          </div>

          {/* Ask AI — agent-specific prompt chip */}
          <div className="mt-6 border-t border-zinc-100 pt-4 text-left">
            <div className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#607078]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-zinc-800">Ask AI</p>
                <motion.p
                  key={active}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="mt-0.5 text-[12px] leading-snug text-zinc-500"
                >
                  {askPrompt}
                </motion.p>
              </div>
              <span className="shrink-0 text-[12px] text-zinc-400">↵</span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL — MacBook-inspired terminal */}
        <div className="landing-terminal relative flex min-h-[460px] flex-col overflow-hidden rounded-2xl border border-white/10">
          {/* Title bar — traffic lights + window title */}
          <div className="flex items-center border-b border-white/10 px-4 py-2.5" style={{ background: "rgba(255,255,255,0.025)" }}>
            <span className="flex gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: "#ff5f56" }} />
              <span className="h-3 w-3 rounded-full" style={{ background: "#ffbd2e" }} />
              <span className="h-3 w-3 rounded-full" style={{ background: "#27c93f" }} />
            </span>
            <span className="mx-auto flex items-center gap-2 font-mono text-[11px]" style={{ color: "#7c8379" }}>
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "#9fb08f" }}
              />
              agents@mondaily — operating layer
            </span>
          </div>

          <div className="relative flex flex-1 flex-col p-5 sm:p-6">
            {/* Terminal rows — fixed-height lines, no layout shift */}
            <div className="space-y-1 overflow-hidden">
              {WORKSPACE_TERMINAL_ROWS.map((row, i) => (
                <TerminalLine
                  key={row.prompt}
                  segments={row.segments}
                  active={i === activeRowIndex}
                  typedChars={i === activeRowIndex ? typedChars : undefined}
                />
              ))}
              <div style={{ opacity: 0.28 }} className="h-7 overflow-hidden whitespace-nowrap font-mono text-[12px] leading-7">
                <span style={{ color: "#7c8379" }}>$ </span>
                <span style={{ color: "#c59a8d" }}>approval.queue</span>
                <span style={{ color: "#7c8379" }}> --mode </span>
                <span style={{ color: "#8fb3b0" }}>human_review</span>
              </div>
              <div style={{ opacity: 0.18 }} className="h-7 overflow-hidden whitespace-nowrap font-mono text-[12px] leading-7">
                <span style={{ color: "#7c8379" }}>$ </span>
                <span style={{ color: "#9fb08f" }}>sources.attach</span>
                <span style={{ color: "#7c8379" }}> --scope </span>
                <span style={{ color: "#d7c6a3" }}>workspace_graph</span>
              </div>
            </div>

            {/* Current process + connected Ask AI prompt */}
            <div className="mt-auto pt-5 font-mono text-[12px] leading-6">
              <div style={{ borderTop: "1px solid rgba(159,176,143,0.18)" }} className="pt-4">
                {/* Current process — printed as terminal output, left-aligned */}
                <div className="text-left">
                  <span style={{ color: "#7c8379" }}>$ </span>
                  <span style={{ color: "#9fb08f" }}>process.current</span>
                </div>
                <motion.div
                  key={activeNode.label}
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className="mt-1.5 flex items-start gap-2 pl-3 text-left"
                >
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: activeNode.color }} />
                  <span className="min-w-0">
                    <span style={{ color: "#f4f7f2" }}>{activeNode.label}</span>
                    <span style={{ color: "#7c8379" }}> — {activeNode.detail}</span>
                  </span>
                </motion.div>
                <motion.div
                  key={`ask-${active}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.22, delay: 0.12 }}
                  className="mt-2 truncate pl-3 text-left"
                >
                  <span style={{ color: "#7c8379" }}>$ </span>
                  <span style={{ color: "#9fb08f" }}>ask</span>
                  <span style={{ color: "#7c8379" }}> → </span>
                  <span style={{ color: "#d7c6a3" }}>{askPrompt}</span>
                  <span style={{ color: "#7c8379" }}> ↵</span>
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const INVOICE_STAGE_STYLE: Record<string, { dot: string; text: string }> = {
  Draft:    { dot: "bg-zinc-300",    text: "text-zinc-500" },
  Sent:     { dot: "bg-zinc-500",    text: "text-zinc-600" },
  Approved: { dot: "bg-zinc-600",    text: "text-zinc-700" },
  Paid:     { dot: "bg-zinc-900",    text: "text-zinc-900" },
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
      style={{ border: "1px solid var(--landing-line-strong)", background: "var(--landing-surface)" }}
    >
      <div className="flex items-center gap-2 border-b border-black/[.05] px-4 py-2.5">
        <span className="text-[13px] font-medium text-zinc-700">Finance — quotes &amp; invoices</span>
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          className="ml-auto h-1.5 w-1.5 rounded-full"
          style={{ background: "#a07164" }}
        />
        <span className="text-[11px]" style={{ color: "#a07164" }}>tracked by Finance Agent</span>
      </div>

      <div className="flex items-center gap-6 border-b border-black/[.05] bg-black/[.015] px-4 py-2.5 font-mono text-[11px]">
        <span className="text-zinc-500">Open quotes <span className="text-zinc-800">{totalOpen}</span></span>
        <span className="text-zinc-500">Paid this month <span className="text-zinc-700">£18.6k</span></span>
      </div>

      <div className="border-b border-black/[.05] px-4 py-2 font-mono text-[11px]" style={{ background: "rgba(160,113,100,0.04)", color: "#a07164" }}>
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
                        <span className="font-mono text-[11px]" style={{ color: "#a07164" }}>{d.amt}</span>
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
    name: "Opportunity flow", accent: "#9fb08f",
    columns: [
      { key: "company", label: "Company", type: "text" },
      { key: "stage",   label: "Stage",    type: "badge" },
      { key: "score",   label: "Relationship Health", type: "score" },
      { key: "owner",   label: "Owner",    type: "avatar" },
    ],
    stageCol: "stage",
    stageOrder: ["New", "Qualified", "Proposal", "Negotiation", "Won"],
    stageStyle: {
      New:         { dot: "bg-zinc-300",    text: "text-zinc-500" },
      Qualified:   { dot: "bg-zinc-400",    text: "text-zinc-600" },
      Proposal:    { dot: "bg-zinc-500",    text: "text-zinc-600" },
      Negotiation: { dot: "bg-zinc-600",    text: "text-zinc-700" },
      Won:         { dot: "bg-zinc-900",    text: "text-zinc-900" },
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
    name: "Finance — quotes", accent: "#a07164",
    columns: [
      { key: "company", label: "Company", type: "text" },
      { key: "ref",     label: "Quote",   type: "text" },
      { key: "stage",   label: "Stage",   type: "badge" },
      { key: "amt",     label: "Amount",  type: "text" },
    ],
    stageCol: "stage",
    stageOrder: ["Draft", "Sent", "Approved", "Paid"],
    stageStyle: {
      Draft:    { dot: "bg-zinc-300",    text: "text-zinc-500" },
      Sent:     { dot: "bg-zinc-500",    text: "text-zinc-600" },
      Approved: { dot: "bg-zinc-600",    text: "text-zinc-700" },
      Paid:     { dot: "bg-zinc-900",    text: "text-zinc-900" },
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
    name: "Relationship health", accent: "#a68762",
    columns: [
      { key: "contact",  label: "Contact",    type: "text" },
      { key: "company",  label: "Company",    type: "text" },
      { key: "status",   label: "Status",     type: "badge" },
      { key: "score",    label: "Health",     type: "score" },
    ],
    stageCol: "status",
    stageOrder: ["Healthy", "At risk", "Cold"],
    stageStyle: {
      Healthy:   { dot: "bg-zinc-500",  text: "text-zinc-600" },
      "At risk": { dot: "bg-zinc-400",  text: "text-zinc-600" },
      Cold:      { dot: "bg-zinc-300",  text: "text-zinc-500" },
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
    `px-3 py-2.5 text-[12px] transition-colors ${glowCell?.id === id && glowCell.col === col ? "cell-glow-active" : ""}`;

  return (
    <div
      className="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl"
      style={{ border: "1px solid var(--landing-line-strong)", background: "var(--landing-surface)" }}
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

// Interactive light recreation of the app's Records sheet — select rows, run
// enrichment, lead-score + health columns, contextual action bar.
function RecordsSheetDemo() {
  const seed = [
    { id: 1, name: "Sarah Chen", company: "Acme Corp", title: "VP Sales", score: 92, health: 88 },
    { id: 2, name: "Marcus Webb", company: "Northwind", title: "CTO", score: 74, health: 71 },
    { id: 3, name: "Elena Ruiz", company: "Globex", title: "Head of Ops", score: 58, health: 63 },
  ];
  const [rows, setRows] = useState(seed);
  const [pending, setPending] = useState<{ id: number; name: string } | null>({ id: 4, name: "James Lee" });
  const [selected, setSelected] = useState<number>(1);
  const [enriching, setEnriching] = useState(false);
  const score = (s: number) => (s >= 80 ? { c: "#059669", b: "#ecfdf5" } : s >= 60 ? { c: "#b45309", b: "#fffbeb" } : { c: "#52525b", b: "#f4f4f5" });
  function enrich() {
    if (!pending || enriching) return;
    setEnriching(true);
    setTimeout(() => {
      setRows(r => [...r, { id: pending.id, name: pending.name, company: "Initech", title: "Founder", score: 81, health: 77 }]);
      setSelected(pending.id);
      setPending(null);
      setEnriching(false);
    }, 1300);
  }
  const COLS = "grid grid-cols-[1.4fr_1fr_1fr_0.9fr_0.9fr] items-center gap-2";
  const selName = [...rows, ...(pending ? [pending] : [])].find(r => r.id === selected)?.name ?? "—";
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-800">People</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">{rows.length + (pending ? 1 : 0)} records</span>
        </div>
        <button onClick={enrich} disabled={!pending || enriching} className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity disabled:opacity-50" style={{ background: "#0f172a" }}>
          {enriching ? "Enriching…" : "✦ Enrich all"}
        </button>
      </div>
      <div className="px-1.5 py-1">
        <div className={`${COLS} px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400`}>
          <span>Name</span><span>Company</span><span>Title</span><span>Lead score</span><span>Health</span>
        </div>
        {rows.map(r => {
          const sc = score(r.score); const on = selected === r.id;
          return (
            <button key={r.id} onClick={() => setSelected(r.id)} className={`${COLS} w-full border-t border-zinc-100 px-3 py-2.5 text-left transition-colors ${on ? "bg-zinc-50" : "hover:bg-zinc-50/60"}`}>
              <span className="flex items-center gap-2 text-[12px] text-zinc-800"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-100 text-[9px] font-medium text-zinc-600">{r.name.split(" ").map(w => w[0]).join("")}</span>{r.name}</span>
              <span className="text-[12px] text-zinc-600">{r.company}</span>
              <span className="text-[12px] text-zinc-500">{r.title}</span>
              <span><span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums" style={{ color: sc.c, background: sc.b }}>{r.score}</span></span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-100"><span className="block h-full rounded-full" style={{ width: `${r.health}%`, background: r.health > 80 ? "#059669" : r.health > 65 ? "#d97706" : "#a1a1aa" }} /></span>
                <span className="text-[11px] tabular-nums text-zinc-500">{r.health}</span>
              </span>
            </button>
          );
        })}
        {pending && (
          <div className={`${COLS} border-t border-zinc-100 px-3 py-2.5`}>
            <span className="flex items-center gap-2 text-[12px] text-zinc-800"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-100 text-[9px] font-medium text-zinc-600">JL</span>{pending.name}</span>
            <span className="text-[11px] italic text-zinc-400">{enriching ? "enriching…" : "incomplete"}</span>
            <span className="text-[11px] italic text-zinc-400">{enriching ? "enriching…" : "—"}</span>
            <span className="text-[11px] italic text-zinc-400">{enriching ? "scoring…" : "—"}</span>
            <span>{enriching ? <motion.span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} /> : <span className="text-[11px] text-zinc-300">—</span>}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5 text-[11px]">
        <span className="text-zinc-500">Selected · <span className="font-medium text-zinc-700">{selName}</span></span>
        <span className="ml-auto flex gap-1.5">
          <span className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-600">Ask AI</span>
          <span className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-600">Draft message</span>
          <span className="rounded-md px-2 py-1 font-medium text-white" style={{ background: "#0f172a" }}>Add to list</span>
        </span>
      </div>
    </div>
  );
}

// Interactive light recreation of the app's Invoices view — the status filter
// actually filters the table.
function InvoiceDemo() {
  const BADGE: Record<string, { label: string; c: string; b: string }> = {
    draft:   { label: "Draft",   c: "#52525b", b: "#f4f4f5" },
    sent:    { label: "Sent",    c: "#2563eb", b: "#eff6ff" },
    paid:    { label: "Paid",    c: "#059669", b: "#ecfdf5" },
    overdue: { label: "Overdue", c: "#d97706", b: "#fffbeb" },
  };
  const all = [
    { num: "INV-0042", client: "Acme Corp", amount: "£4,200.00", status: "sent", due: "Jul 14" },
    { num: "INV-0041", client: "Northwind Traders", amount: "£1,850.00", status: "overdue", due: "Jun 30" },
    { num: "INV-0040", client: "Globex", amount: "£9,300.00", status: "paid", due: "Jun 22" },
    { num: "INV-0039", client: "Initech", amount: "£620.00", status: "draft", due: "—" },
    { num: "INV-0038", client: "Stark Industries", amount: "£12,400.00", status: "paid", due: "Jun 10" },
  ];
  const [filter, setFilter] = useState("all");
  const rows = filter === "all" ? all : all.filter(r => r.status === filter);
  const COLS = "grid grid-cols-[1fr_1.7fr_1fr_0.9fr_0.7fr] items-center gap-2";
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center gap-6">
          <div><div className="text-[10px] uppercase tracking-wide text-zinc-400">Outstanding</div><div className="text-[16px] font-semibold text-zinc-900">£6,050.00</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-zinc-400">Paid</div><div className="text-[16px] font-semibold text-emerald-600">£21,700.00</div></div>
        </div>
        <span className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: "#0f172a" }}>+ New invoice</span>
      </div>
      <div className="flex items-center gap-1 border-b border-zinc-100 px-4 py-2">
        {([["all", "All"], ["draft", "Draft"], ["sent", "Sent"], ["paid", "Paid"], ["overdue", "Overdue"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${filter === k ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800"}`}>{l}</button>
        ))}
      </div>
      <div className="px-1.5 py-1">
        <div className={`${COLS} px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400`}>
          <span>Invoice</span><span>Client</span><span>Amount</span><span>Status</span><span>Due</span>
        </div>
        {rows.map(r => (
          <div key={r.num} className={`${COLS} border-t border-zinc-100 px-3 py-2.5 transition-colors hover:bg-zinc-50/60`}>
            <span className="text-[12px] font-medium text-zinc-800">{r.num}</span>
            <span className="truncate text-[12px] text-zinc-700">{r.client}</span>
            <span className="text-[12px] font-semibold text-zinc-900">{r.amount}</span>
            <span><span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: BADGE[r.status]!.c, background: BADGE[r.status]!.b }}>{BADGE[r.status]!.label}</span></span>
            <span className="text-[12px] text-zinc-500">{r.due}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-zinc-400">No {filter} invoices</div>}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5 text-[11px]">
        <motion.span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }} />
        <span className="truncate text-zinc-500"><span className="font-medium text-amber-700">Finance Agent</span> drafted a reminder for INV-0041</span>
        <span className="ml-auto shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-zinc-600">Approve ↵</span>
      </div>
    </div>
  );
}

function RecordsSheetSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-[0.18em]" style={{ color: "#8fb3b0" }}>Records sheet</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-800">
        Your records, kept current automatically
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        No manual data entry — the AI enriches and updates relationship health on rows while you watch.
      </p>
      <RecordsSheetDemo />
    </section>
  );
}

function FinanceBoardSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-[0.18em]" style={{ color: "#a07164" }}>Finance</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-800">
        Invoices tracked to payment, automatically
      </h2>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Draft a quote, raise the invoice, and Mondaily tracks it through to payment — chasing overdue invoices (with your approval) and handling recurring billing without a spreadsheet.
      </p>
      <InvoiceDemo />
    </section>
  );
}

function ProcessTabsSection() {
  const tabs = [
    { label: "Record enters Mondaily", node: <WorkflowDemo /> },
    { label: "Object design", node: <AutomationFlow /> },
    { label: "Records kept current", node: <RecordsSheetSection /> },
    { label: "Invoice to payment", node: <FinanceBoardSection /> },
  ];
  const [active, setActive] = useState(0);

  return (
    <section id="product" className="landing-process-tabs mx-auto max-w-6xl px-6 py-16">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">Product engine</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-900">
        Four processes, one graph
      </h2>
      <p className="mb-8 max-w-2xl text-[14px] leading-relaxed text-zinc-500">
        From a new record landing to an invoice marked paid — the same graph carries the work and the agents run each step. Click through to watch it.
      </p>
      <div className="mb-8 flex flex-wrap gap-2">
        {tabs.map((tab, i) => {
          const accents = ["#9fb08f", "#a68762", "#8fb3b0", "#a07164"];
          const isActive = active === i;
          return (
            <button
              key={tab.label}
              onClick={() => setActive(i)}
              style={isActive ? {
                background: `${accents[i]}14`,
                borderColor: `${accents[i]}50`,
                color: accents[i],
              } : {}}
              className={`relative rounded-full border px-5 py-2 text-left text-[12px] font-medium uppercase tracking-[0.12em] transition-all ${
                isActive
                  ? "border-transparent"
                  : "border-black/[.07] bg-transparent text-zinc-400 hover:border-black/[.14] hover:text-zinc-700"
              }`}
            >
              {isActive && (
                <span
                  className="absolute left-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full"
                  style={{ background: accents[i] }}
                />
              )}
              <span className={isActive ? "pl-4" : ""}>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
          className="[&>section]:px-0 [&>section]:py-6"
        >
          {tabs[active]!.node}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

const AGENTS = [
  {
    icon: "◈", name: "Graph Agent", accent: "#9fb08f", brush: "0deg",
    desc: "The conversational interface to your workspace graph — creates and searches records, builds lists, sets up workflows, and answers questions in plain English.",
    watches: "Every record, conversation, and question asked of the graph",
    prepares: "Filtered lists, new records, draft workflows, and answers with sources attached",
    approval: "No approval needed to answer — sensitive actions still route to the Decision Queue",
  },
  {
    icon: "◆", name: "Enrichment Agent", accent: "#8a8071", brush: "-18deg",
    desc: "Fires the moment a new record enters the graph — pulls ARR, headcount, funding, tech stack, and other public signals automatically from the web.",
    watches: "New records as they're created",
    prepares: "Firmographic and contact fields, sourced and attached to the record",
    approval: "Writes directly — no sensitive action, so no approval required",
  },
  {
    icon: "♥", name: "Relationship Agent", accent: "#a68762", brush: "24deg",
    desc: "Scores every relationship daily based on contact recency, open loops, and recent activity across the graph.",
    watches: "Last-touch dates and open items across every relationship",
    prepares: "An updated relationship health score on each record",
    approval: "Writes directly — no sensitive action, so no approval required",
  },
  {
    icon: "▲", name: "Finance Agent", accent: "#a07164", brush: "48deg",
    desc: "Watches invoices and credit notes across the graph, drafts the reminder or adjustment, and queues it for your approval before anything is sent.",
    watches: "Invoice due dates and credit note disputes",
    prepares: "Draft reminders and adjustments",
    approval: "Requires approval before anything is sent or applied",
  },
  {
    icon: "▶", name: "Operations Agent", accent: "#6f8068", brush: "-42deg",
    desc: "Tracks overdue and stalled work across the graph and queues a recommendation the moment something needs attention.",
    watches: "Task due dates, review status, and stalled work",
    prepares: "A recommendation in the Decision Queue, with the record attached",
    approval: "Requires approval before reassigning or rescheduling",
  },
  {
    icon: "⚙", name: "Workflow Agent", accent: "#607078", brush: "72deg",
    desc: "Designs trigger → condition → action automations across the graph, no code required. Autonomous execution is coming online — today, a human reviews and runs each one.",
    watches: "Workflow definitions you design",
    prepares: "A runnable workflow draft",
    approval: "Always requires a human to review and run it today",
  },
  {
    icon: "✦", name: "Prospecting Agent", accent: "#8fb3b0", brush: "-70deg",
    desc: "Searches the live web for new candidates — people, organizations, investors, suppliers, or any record type your workspace tracks — and proposes them with a real source attached.",
    watches: "A query you give it, plus your existing graph for duplicates",
    prepares: "New candidate records, each with a source URL — never invented",
    approval: "Requires approval before any candidate is added to the graph",
  },
  {
    icon: "◎", name: "Signal Agent", accent: "#7fa3b0", brush: "30deg",
    desc: "Scores intent and flags risk across the graph — lead scores, at-risk and high-intent deals — surfacing what's heating up or going cold before you have to look.",
    watches: "Record activity, deal stage and amount, and engagement signals",
    prepares: "Lead scores and Decision-Queue alerts for at-risk or high-intent deals",
    approval: "Writes scores directly; alerts route to the Decision Queue",
  },
  {
    icon: "◑", name: "Opportunity Agent", accent: "#a07164", brush: "-30deg",
    desc: "Tracks every opportunity through its stages and ages — flags the ones that are stalled, slipping, or close to closing, and recommends the next move.",
    watches: "Opportunity stage, age, and movement across the pipeline",
    prepares: "Decision-Queue recommendations for stalled or at-risk opportunities",
    approval: "Recommends only — never advances a stage without approval",
  },
  {
    icon: "◐", name: "People Agent", accent: "#8a8071", brush: "54deg",
    desc: "Keeps people and contact records warm — surfaces follow-ups, dormant relationships, and the next touch that's overdue.",
    watches: "People records, last-touch dates, and open follow-ups",
    prepares: "Follow-up recommendations queued for review",
    approval: "Recommends only — you approve before anything is sent",
  },
  {
    icon: "◭", name: "Portfolio Agent", accent: "#6f8068", brush: "-54deg",
    desc: "Watches portfolio and investment records for the positions that need attention — concentration, drift, or items going stale.",
    watches: "Portfolio and investment records and their status",
    prepares: "Decision-Queue items for positions needing attention",
    approval: "Recommends only — approval required for any action",
  },
  {
    icon: "◮", name: "Asset Agent", accent: "#a68762", brush: "66deg",
    desc: "Monitors real-estate and asset records — leases, renewals, and maintenance windows — and queues what's coming due.",
    watches: "Asset and real-estate records, dates and status",
    prepares: "Decision-Queue items for assets needing attention",
    approval: "Recommends only — approval required for any action",
  },
];

function AgentTerminalLine({ label, text, color, active }: { label: string; text: string; color: string; active: boolean }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!active) { setShown(""); return; }
    let i = 0;
    setShown("");
    const t = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, 18);
    return () => clearInterval(t);
  }, [text, active]);
  return (
    <div className="flex gap-2 text-[12.5px] leading-relaxed">
      <span className="shrink-0 font-medium" style={{ color }}>{label}:</span>
      <span className="text-zinc-300">{shown}{active && shown.length < text.length && <span className="inline-block w-[1px] h-[0.9em] bg-zinc-500 ml-[1px] animate-pulse align-middle" />}</span>
    </div>
  );
}

type LogLine = { prefix?: string; prefixColor?: string; label?: string; labelColor?: string; text: string; color?: string; indent?: boolean };
function buildAgentLog(agent: (typeof AGENTS)[number], slug: string): LogLine[] {
  return [
    { prefix: "$", prefixColor: "#7c8379", text: `${slug}.inspect --scope workspace_graph`, color: "#9fb08f" },
    { indent: true, label: "watching", labelColor: "#8fb3b0", text: agent.watches, color: "#cfd6cb" },
    { indent: true, label: "preparing", labelColor: "#d7c6a3", text: agent.prepares, color: "#cfd6cb" },
    { indent: true, label: "approval", labelColor: "#9fb08f", text: agent.approval, color: "#cfd6cb" },
    { prefix: "$", prefixColor: "#7c8379", text: "sources.attach --mode human_review", color: "#9fb08f" },
    { indent: true, prefix: "✓", prefixColor: "#6f8068", text: "evidence linked to workspace_graph", color: "#9aa39a" },
    { prefix: "$", prefixColor: "#7c8379", text: "decision.queue --status pending", color: "#9fb08f" },
    { indent: true, prefix: "⮑", prefixColor: "#7c8379", text: "routed for human review", color: "#9aa39a" },
    { prefix: "$", prefixColor: "#7c8379", text: `${slug}.status`, color: "#9fb08f" },
    { indent: true, prefix: "●", prefixColor: agent.accent, text: "active · streaming", color: "#cfd6cb" },
  ];
}

// Rich, auto-scrolling terminal log: lines appear one by one and the data scrolls
// up (older lines fade off the top), instead of three fixed rows.
function AgentTerminalLog({ agent, slug }: { agent: (typeof AGENTS)[number]; slug: string }) {
  const lines = useMemo(() => buildAgentLog(agent, slug), [agent, slug]);
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCount(0);
    const t = setInterval(() => setCount(c => (c >= lines.length ? c : c + 1)), 430);
    return () => clearInterval(t);
  }, [lines]);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [count]);
  return (
    <div ref={ref} className="agent-log relative h-44 overflow-hidden font-mono text-[12px] leading-6">
      {lines.slice(0, count).map((ln, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={ln.indent ? "pl-4" : ""}
        >
          {ln.prefix && <span style={{ color: ln.prefixColor }}>{ln.prefix} </span>}
          {ln.label && <span style={{ color: ln.labelColor }}>{ln.label}&nbsp;&nbsp;</span>}
          <span style={{ color: ln.color }}>{ln.text}</span>
        </motion.div>
      ))}
      {count < lines.length && <span className="ml-px inline-block h-3 w-[6px] animate-pulse align-middle" style={{ background: agent.accent }} />}
    </div>
  );
}

function AgentsSection() {
  const [openIdx, setOpenIdx] = useState(0);
  const agent = AGENTS[openIdx]!;
  const slug = agent.name.toLowerCase().replace(" agent", "").replace(/\s+/g, "_");

  return (
    <section id="agents" className="relative mx-auto max-w-6xl px-6 py-16">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em]" style={{ color: "#9fb08f" }}>Agent layer</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-900">
        A team of agents, watching one graph
      </h2>
      <p className="mb-8 max-w-2xl text-[14px] leading-relaxed text-zinc-500">
        Twelve specialized agents each watch a slice of the graph — enriching, scoring, drafting, and monitoring in real time. Click any tile to inspect what it sees, prepares, and routes to your Decision Queue.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {AGENTS.map((ag, i) => {
          const open = openIdx === i;
          return (
            <motion.div
              key={ag.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: (i % 6) * 0.05 }}
              onClick={() => setOpenIdx(i)}
              className="agent-brush group relative cursor-pointer overflow-hidden rounded-xl border p-3.5 text-left transition-all"
              style={{
                "--brush-rotate": ag.brush,
                "--brush-saturation": open ? "1.0" : "0.55",
                borderColor: open ? `${ag.accent}66` : "rgba(0,0,0,0.07)",
                background: open ? `linear-gradient(160deg, ${ag.accent}16, ${ag.accent}04)` : "white",
                boxShadow: open ? `0 10px 26px -14px ${ag.accent}80` : "0 1px 2px rgba(0,0,0,0.03)",
              } as CSSProperties}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] transition-all"
                  style={{ background: open ? `${ag.accent}22` : "#f4f4f5", color: open ? ag.accent : "#a1a1aa" }}
                >
                  {ag.icon}
                </span>
                <span className="h-1.5 w-1.5 rounded-full transition-all" style={{ background: open ? ag.accent : "#d4d4d8", boxShadow: open ? `0 0 0 3px ${ag.accent}26` : "none" }} />
              </div>
              <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">{ag.name.replace(" Agent", "")}</span>
              <span className="mt-1 block text-[10px] leading-snug" style={{ color: open ? ag.accent : "#a1a1aa" }}>{open ? "inspecting" : "watching"}</span>
            </motion.div>
          );
        })}
      </div>

      <div className="relative overflow-hidden rounded-2xl border bg-[#050706] text-left text-white" style={{ borderColor: `${agent.accent}40` }}>
        {/* MacBook-inspired title bar */}
        <div className="flex items-center border-b border-white/10 px-4 py-2.5" style={{ background: "rgba(255,255,255,0.025)" }}>
          <span className="flex gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: "#ff5f56" }} />
            <span className="h-3 w-3 rounded-full" style={{ background: "#ffbd2e" }} />
            <span className="h-3 w-3 rounded-full" style={{ background: "#27c93f" }} />
          </span>
          <span className="mx-auto flex items-center gap-2 font-mono text-[11px]" style={{ color: "#7c8379" }}>
            <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full" style={{ background: agent.accent }} />
            {slug}@mondaily — inspect
          </span>
          <span className="font-mono text-[11px] font-medium" style={{ color: agent.accent }}>active</span>
        </div>
        {/* Body — live scrolling log */}
        <div className="relative px-5 py-4">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(111,128,104,0.06)_1px,transparent_1px),linear-gradient(180deg,rgba(111,128,104,0.04)_1px,transparent_1px)] bg-[size:28px_28px]" />
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 0% 0%, ${agent.accent}16, transparent 60%)` }} />
          <div className="relative">
            <AgentTerminalLog agent={agent} slug={slug} />
          </div>
        </div>
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
    text: "2 opportunities at risk", source: "Opportunity flow", accent: "#a07164",
    action: "Review suggested",
  },
  {
    text: "Follow-up drafted", source: "Emails", accent: "#9fb08f",
    action: "Draft ready",
  },
  {
    text: "Invoice likely overdue", source: "Finance", accent: "#a68762",
    action: "Reminder prepared",
  },
  {
    text: "New record enriched", source: "Records", accent: "#8fb3b0",
    action: "Record updated",
  },
];

function LiveSignalsSection() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive(i => (i + 1) % LIVE_SIGNALS.length), 1800);
    return () => clearInterval(t);
  }, []);

  const signal = LIVE_SIGNALS[active]!;

  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">Source-backed signals</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-900">
        What Mondaily notices while you work
      </h2>
      <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-zinc-500">
        Agents surface what changed across the graph — every signal carries its source, a relationship-health read, and the next action already prepared for you.
      </p>

      <div className="border-y border-black/[.06] py-5">
        <div className="flex flex-col gap-3 text-left sm:flex-row sm:items-center">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping" style={{ background: signal.accent }}/>
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: signal.accent }}/>
          </span>
          <AnimatePresence mode="wait">
            <motion.p
              key={signal.text}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="flex-1 text-[18px] font-medium tracking-tight text-zinc-900"
            >
              {signal.text}
            </motion.p>
          </AnimatePresence>
          <span className="text-[13px] text-zinc-500">{signal.source}</span>
          <span className="text-[13px] font-medium text-zinc-700">{signal.action}</span>
        </div>
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
    accent: "#9fb08f",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/></svg>),
  },
  {
    title: "AI reads your workspace graph only",
    desc: "Agents only ever see the objects, conversations, and files inside your own workspace graph — never another client's data.",
    accent: "#a68762",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" strokeLinecap="round"/></svg>),
  },
  {
    title: "Human approval on sensitive actions",
    desc: "Agents prepare and recommend continuously, but sensitive actions — sending, billing, deleting — wait for a person to approve.",
    accent: "#8fb3b0",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m20 6 -11 11 -5 -5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  },
  {
    title: "Role-based permissions",
    desc: "Every record is protected by role permissions — members only see what they've been granted access to.",
    accent: "#a07164",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round"/></svg>),
  },
  {
    title: "Granular visibility",
    desc: "Field-level and record-level controls mean teammates only ever see the data relevant to their role.",
    accent: "#6f8068",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6"/></svg>),
  },
  {
    title: "Admin controls & audit logs",
    desc: "Workspace admins get full visibility into who did what, when — every sensitive action is logged.",
    accent: "#8a8071",
    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 5h11v15H4V9l5-4Z" strokeLinejoin="round"/><path d="M9 5v4H4" strokeLinejoin="round"/><path d="M8 13h7M8 16h5" strokeLinecap="round"/></svg>),
  },
];

// ── AI with approval — agents act, humans stay in control ───────────────────
const APPROVAL_STEPS = [
  { label: "Prepare",  desc: "Agents draft the change before anything touches the graph", status: "drafting", tone: "#607078" },
  { label: "Recommend", desc: "A suggested action appears with the records and evidence behind it", status: "ready", tone: "#8b7355" },
  { label: "Monitor",  desc: "Signals and risks are tracked continuously in the background", status: "watching", tone: "#6f8068" },
  { label: "Execute",  desc: "Once approved, the action runs and is logged to the source object", status: "approved", tone: "#a68762" },
];

function ApprovalSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="h-px w-full bg-black/[.06] mb-12" />
      <p className="mb-6 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">Decision Queue</p>
      <h2
        className="font-sans font-semibold tracking-tight text-zinc-900"
        style={{ fontSize: "clamp(1.8rem, 3.5vw, 3rem)", lineHeight: 1.06, letterSpacing: "-0.04em" }}
      >
        Agents prepare.{" "}
        <span className="text-zinc-400">You stay in control.</span>
      </h2>
      <div className="mt-10 flex flex-col gap-0">
        {APPROVAL_STEPS.map((s, i) => (
          <div key={s.label} className="flex items-baseline gap-6 border-t border-black/[.05] py-4 last:border-b">
            <span className="w-6 shrink-0 text-[11px] tabular-nums text-zinc-300">0{i + 1}</span>
            <span className="w-28 shrink-0 text-[13px] font-medium text-zinc-800">{s.label}</span>
            <span className="flex-1 text-[13px] leading-relaxed text-zinc-500">{s.desc}</span>
            <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <span className="h-1 w-1 rounded-full" style={{ background: s.tone }} />
              <span className="text-[11px] text-zinc-400">{s.status}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="h-px w-full bg-black/[.06] mt-12" />
    </section>
  );
}

const USE_CASES = [
  { label: "Client workspaces", desc: "People, companies, and every interaction connected on one graph.", tone: "#9fb08f" },
  { label: "Investment pipelines", desc: "Deals, diligence, and portfolio companies as connected records.", tone: "#6f8068" },
  { label: "Finance operations", desc: "Invoices, credit notes, and approvals beside the work they belong to.", tone: "#a07164" },
  { label: "Hiring & people operations", desc: "Candidates, roles, and interview notes as one connected flow.", tone: "#8fb3b0" },
  { label: "Project delivery", desc: "Tasks, documents, and decisions tied to the source object.", tone: "#607078" },
  { label: "Partner & supplier tracking", desc: "Organizations and contracts enriched and kept current.", tone: "#a68762" },
];

function UseCasesSection() {
  return (
    <section id="solutions" className="mx-auto max-w-6xl px-6 py-16">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">Any workspace graph</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-900">
        Built for what your team actually tracks
      </h2>
      <p className="mb-8 max-w-2xl text-[14px] leading-relaxed text-zinc-500">
        The graph adapts to the records your team needs to connect.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {USE_CASES.map((u, i) => (
          <motion.div
            key={u.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
            className="rounded-xl p-4 text-left"
            style={{ background: `${u.tone}0d`, border: `1px solid ${u.tone}28` }}
          >
            <span className="mb-4 block h-2 w-2 rounded-full" style={{ background: u.tone }} />
            <p className="mb-1.5 text-[12.5px] font-semibold leading-tight text-zinc-800">{u.label}</p>
            <p className="text-[11px] leading-snug text-zinc-500">{u.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ── Integrations ─────────────────────────────────────────────────────────────
const INTEGRATIONS = [
  {
    id: "gmail",
    name: "Gmail",
    desc: "Sync inbox threads and contacts into the graph.",
    accent: "#a07164",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M2 6.5C2 5.67 2.67 5 3.5 5h17C21.33 5 22 5.67 22 6.5v11c0 .83-.67 1.5-1.5 1.5h-17C2.67 19 2 18.33 2 17.5V6.5Z" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "outlook",
    name: "Outlook",
    desc: "Sync Microsoft email and calendar events.",
    accent: "#607078",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M2 9h20" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    desc: "Import meetings, attendees, and follow-up context.",
    accent: "#9fb08f",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M3 9h18M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <rect x="7" y="13" width="4" height="4" rx="0.8" fill="currentColor" opacity="0.5"/>
      </svg>
    ),
  },
  {
    id: "slack",
    name: "Slack",
    desc: "Receive agent alerts and graph signals in channels.",
    accent: "#a68762",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M9 3.5A2.5 2.5 0 0 0 6.5 6v1H9a2.5 2.5 0 0 0 0-5v1.5ZM6.5 9H4a2.5 2.5 0 0 0 0 5h2.5V9ZM9 14.5A2.5 2.5 0 1 0 9 20v-1.5H6.5M14.5 20a2.5 2.5 0 0 0 2.5-2.5V16h-2.5a2.5 2.5 0 0 0 0 5ZM17.5 15H20a2.5 2.5 0 0 0 0-5h-2.5v5ZM14.5 9.5A2.5 2.5 0 1 0 14.5 4V5.5H17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "zapier",
    name: "Zapier",
    desc: "Connect Mondaily to thousands of apps via Zaps.",
    accent: "#8fb3b0",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "typeform",
    name: "Typeform",
    desc: "Turn form responses into workspace graph records.",
    accent: "#6f8068",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M4 7h16M12 7v13M8 7v2M16 7v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="12" cy="4" r="1.5" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: "segment",
    name: "Segment",
    desc: "Stream customer events directly into the graph.",
    accent: "#8a8071",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    desc: "Sync audiences and track campaign engagement.",
    accent: "#a07164",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M4 6h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M4 6l8 7 8-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
];

const DEV_TOOLS = [
  { name: "REST API", desc: "Full programmatic access to every record and action", accent: "#9fb08f" },
  { name: "Webhooks", desc: "Real-time events on record changes, stage moves, and agent completions", accent: "#a68762" },
  { name: "MCP Server", desc: "Connect Mondaily to Claude, ChatGPT, and any MCP-compatible AI tool", accent: "#8fb3b0" },
];

function IntegrationsSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em]" style={{ color: "#9fb08f" }}>Integrations</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-900">
        Works with your existing stack
      </h2>
      <p className="mb-10 max-w-xl text-[14px] leading-relaxed text-zinc-500">
        Connect the tools your team already uses. Records, conversations, and events flow in automatically.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {INTEGRATIONS.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, delay: i * 0.05 }}
            className="rounded-xl border p-4"
            style={{ borderColor: `${item.accent}28`, background: `${item.accent}07` }}
          >
            <div className="mb-3" style={{ color: item.accent }}>{item.icon}</div>
            <p className="mb-1 text-[13px] font-semibold text-zinc-800">{item.name}</p>
            <p className="text-[11.5px] leading-snug text-zinc-500">{item.desc}</p>
          </motion.div>
        ))}
      </div>

      {/* Developer tools row */}
      <div className="mt-8 border-t border-black/[.05] pt-8">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">For developers</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEV_TOOLS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
              className="flex items-start gap-3 rounded-xl border p-4"
              style={{ borderColor: `${t.accent}22`, background: `${t.accent}06` }}
            >
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.accent }} />
              <div>
                <p className="text-[13px] font-semibold text-zinc-800">{t.name}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{t.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section id="company" className="mx-auto max-w-6xl px-6 py-12">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em]" style={{ color: "#8fb3b0" }}>Security & data separation</p>
      <h2 className="mb-2 font-sans font-semibold tracking-tight text-zinc-900">
        Your data, isolated and protected
      </h2>
      <p className="mb-8 max-w-2xl text-[14px] leading-relaxed text-zinc-500">
        Every workspace is isolated at the database with row-level security and scoped by role-based permissions — your records never touch another tenant&apos;s. Isolation and access control are the foundation, not an afterthought.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRUST_POINTS.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
            className="rounded-xl border border-black/[.06] p-5"
            style={{ background: `${p.accent}06` }}
          >
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${p.accent}18`, color: p.accent }}>
              {p.icon}
            </div>
            <p className="mb-1.5 text-[13.5px] font-medium text-zinc-800">{p.title}</p>
            <p className="text-[12px] leading-relaxed text-zinc-500">{p.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const BADGE_ACCENTS = ["#9fb08f", "#a68762", "#8fb3b0"];

function TrustBadges() {
  return (
    <div style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
      <a
        href="/security"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-8 transition-opacity hover:opacity-75"
      >
        {TRUST_BADGES.map((b, i) => (
          <div key={b.label} className="flex items-center gap-2.5">
            <span style={{ color: BADGE_ACCENTS[i % BADGE_ACCENTS.length] }}>{b.icon}</span>
            <span className="text-[12px] text-zinc-500">{b.label}</span>
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
      className="mx-auto flex w-full flex-col overflow-hidden rounded-full border border-black/[.1] bg-white sm:flex-row dark:border-white/10 dark:bg-black"
    >
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Work email"
        className="min-w-0 flex-1 bg-transparent px-5 py-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white"
        required
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-zinc-900 px-6 py-3 text-[13px] font-medium text-white transition-opacity hover:opacity-85 dark:bg-white dark:text-zinc-900"
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
    features: ["Unlimited Ask Mondaily","12 AI agents on your graph","Real-time automations","AI enrichment + lead scoring","Source-backed answers"],
    unlocks: "Unlocks unlimited Ask Mondaily, the full agent fleet, real-time automations, AI enrichment and lead scoring.",
  },
  {
    name: "Business", bestFor: "Best for teams with controls",
    priceMonthly: 89, priceAnnual: 71, period: "per user / mo",
    desc: "For teams that need roles, approvals, and finance.",
    cta: "Start Business trial", href: "https://app.mondaily.com/sign-up?plan=business", highlight: false,
    capacityPct: 90,
    features: ["Roles & permissions (RBAC)","Finance + deal-stage quote drafting","Multi-trigger workflows","Approval & Decision Queue","MCP server + REST API"],
    unlocks: "Unlocks RBAC, the finance module with quote drafting, multi-trigger workflows, and the MCP server + API.",
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
  const planAccents = ["#9fb08f", "#a68762", "#8fb3b0", "#8a8071"];
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500">Pricing</p>
      <h2 className="mb-1 font-sans font-semibold tracking-tight text-zinc-900">
        Simple, transparent pricing
      </h2>
      <p className="mb-8 text-[14px] text-zinc-500">Start free. Upgrade when you&apos;re ready. No hidden fees.</p>

      {/* Pill toggle */}
      <div className="mb-10 inline-flex items-center gap-1 rounded-full border border-black/[.08] bg-zinc-50 p-1 text-[13px]">
        <button
          onClick={() => setAnnual(false)}
          className={`rounded-full px-4 py-1.5 transition-all ${!annual ? "bg-white text-zinc-900 shadow-sm landing-toggle-active" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Monthly
        </button>
        <button
          onClick={() => setAnnual(true)}
          className={`rounded-full px-4 py-1.5 transition-all ${annual ? "bg-white text-zinc-900 shadow-sm landing-toggle-active" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Annual
          {annual && <span className="ml-2 text-[10px] font-medium" style={{ color: "#9fb08f" }}>–20%</span>}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan, i) => {
          const price = annual ? plan.priceAnnual : plan.priceMonthly;
          const accent = planAccents[i]!;
          return (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              className="group relative flex flex-col rounded-2xl border bg-white p-6 transition-all duration-200 hover:-translate-y-1"
              style={{
                borderColor: plan.highlight ? accent : "rgba(0,0,0,0.08)",
                background: plan.highlight ? `linear-gradient(180deg, ${accent}12, #ffffff 40%)` : "#ffffff",
                boxShadow: plan.highlight
                  ? `0 0 0 1px ${accent}, 0 26px 60px -30px ${accent}`
                  : "0 1px 3px rgba(0,0,0,0.04), 0 14px 30px -20px rgba(0,0,0,0.12)",
              }}
            >
              {plan.highlight && (
                <span className="absolute -top-2.5 left-6 rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white" style={{ background: accent }}>
                  Most popular
                </span>
              )}

              <div className="text-[13px] font-semibold uppercase tracking-[0.12em]" style={{ color: accent }}>{plan.name}</div>
              <div className="mb-5 mt-0.5 text-[11px] text-zinc-400">{plan.bestFor}</div>

              <div className="flex items-end gap-1">
                {price === null ? (
                  <span className="text-[34px] font-semibold leading-none tracking-tight text-zinc-900">Custom</span>
                ) : price === 0 ? (
                  <span className="text-[34px] font-semibold leading-none tracking-tight text-zinc-900">Free</span>
                ) : (
                  <>
                    <span className="text-[34px] font-semibold leading-none tracking-tight text-zinc-900">${price}</span>
                    <span className="mb-0.5 text-[12px] text-zinc-400">/{plan.period}</span>
                  </>
                )}
              </div>
              <div className="mb-5 mt-2 text-[12px] leading-relaxed text-zinc-500">{plan.desc}</div>

              <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">What&apos;s included</div>
              <ul className="mb-6 flex-1 space-y-2.5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-[12.5px] text-zinc-600">
                    <svg width="14" height="14" viewBox="0 0 14 14" className="mt-0.5 shrink-0" style={{ color: accent }}><path d="M2.5 7.5l3 3 6-7.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {f}
                  </li>
                ))}
              </ul>

              <a
                href={plan.href}
                className="block rounded-full py-2.5 text-center text-[12.5px] font-medium transition-all hover:opacity-90"
                style={plan.highlight
                  ? { background: accent, color: "#ffffff", boxShadow: `0 10px 22px -12px ${accent}` }
                  : { border: "1px solid rgba(0,0,0,0.12)", color: "#3f3f46" }}
              >
                {plan.cta}
              </a>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-zinc-400">
        {["14-day Pro trial — no card required", "Cancel anytime", "Your data stays yours — row-level isolation"].map(t => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 14 14" className="shrink-0 text-zinc-300"><path d="M2.5 7.5l3 3 6-7.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {t}
          </span>
        ))}
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
          <div className="rounded-2xl border border-black/[.07] overflow-hidden" style={{ background: "var(--landing-surface)" }}>
            <div className="flex items-start gap-4 px-6 py-5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100">
                <span className="font-mono text-[11px] font-semibold text-zinc-600">EU</span>
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
                <button onClick={accept} className="rounded-xl bg-zinc-900 px-4 py-1.5 font-mono text-[12px] font-medium text-white hover:bg-zinc-800 transition-colors">
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
          className="landing-sticky-bar fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-black/[.12] bg-zinc-900 px-5 py-3 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.22)] hover:bg-zinc-800 transition-colors"
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
const LANDING_THEME_KEY = "mondaily_landing_theme";

function FooterThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="landing-theme-toggle"
      aria-label={theme === "dark" ? "Switch landing page to light mode" : "Switch landing page to dark mode"}
    >
      <span className="landing-theme-toggle__icon" aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function LandingPage() {
  const [ready, setReady] = useState(false);
  const [skipPreloader, setSkipPreloader] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useLayoutEffect(() => {
    if (sessionStorage.getItem(PRELOADER_SESSION_KEY)) {
      setSkipPreloader(true);
      setReady(true);
    }
    const saved = localStorage.getItem(LANDING_THEME_KEY);
    const nextTheme = saved === "dark" || saved === "light" ? saved : "light";
    setTheme(nextTheme);
  }, []);

  const handleDone = useCallback(() => {
    setReady(true);
    sessionStorage.setItem(PRELOADER_SESSION_KEY, "1");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(LANDING_THEME_KEY, next);
      return next;
    });
  }, []);

  return (
    <>
      {!ready && !skipPreloader && <Preloader onDone={handleDone} />}
      <StickyStartBar />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        data-theme="light"
        className="landing-shell min-h-screen bg-white text-zinc-900"
      >
        <header className="landing-nav fixed top-0 left-0 right-0 z-40 border-b">
          <Nav />
        </header>

        <main style={{ paddingTop: "64px", overflowX: "hidden" }}>
          {/* ── Hero ── */}
          <section className="relative mx-auto max-w-6xl overflow-hidden px-6 pb-20 pt-16 text-center">
            <div className="relative z-10 mx-auto max-w-3xl">
              <div className="relative">
                <HeroNetBackdrop />
              <motion.div
                className="relative z-[1]"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 14 }}
                transition={{ duration: 0.55, delay: 0.2 }}
              >
                {/* Live badge */}
                <div className="mb-4 inline-flex items-center gap-2 px-1 py-1.5 text-[13px] font-medium text-neutral-600 dark:text-neutral-300">
                  <motion.span animate={{ opacity: [0.3,1,0.3], boxShadow: ["0 0 0 0 rgba(90,120,92,0)", "0 0 0 4px rgba(90,120,92,0.12)", "0 0 0 0 rgba(90,120,92,0)"] }} transition={{ duration: 1.8, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-[#6f8068]"/>
                  An autonomous AI workspace
                </div>

                {/* Live status row — small, real-feeling status chips that
                    breathe, echoing the same vocabulary used inside the app
                    (Home's command room) so the landing page feels alive
                    rather than static marketing copy. */}
                <div className="mb-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-zinc-400">
                  {[
                    { label: "Graph synced", tone: "#6f8068" },
                    { label: "Agents active", tone: "#607078" },
                    { label: "Sources checked", tone: "#8b7355" },
                  ].map((s, i) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <motion.span
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                          className="absolute inline-flex h-full w-full rounded-full"
                          style={{ background: s.tone }}
                        />
                      </span>
                      {s.label}
                    </span>
                  ))}
                </div>

                {/* Slogan */}
                <h1 className="mx-auto mb-5 max-w-4xl font-sans font-semibold leading-[1.02] tracking-tight text-zinc-900" style={{ fontSize: "clamp(2.6rem, 6vw, 4.75rem)" }}>
                  Your business, always{" "}
                  <RotatingWord words={["thinking.", "tracking.", "enriching.", "deciding.", "moving."]} />
                </h1>

                {/* Subheading */}
                <p className="mx-auto mb-7 max-w-xl text-[16px] leading-relaxed text-zinc-500">
                  A living graph of everything your business knows — watched by a fleet of AI agents that enrich, score, and draft your next move in real time. Every action is source-backed, and nothing sends without your approval.
                </p>

              </motion.div>
              </div>

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
                className="mx-auto mt-20 max-w-lg"
              >
                <EmailSignup />
                <p className="mt-3 text-center text-[13px] text-zinc-500">
                  Free forever · no card required · takes 90 seconds
                </p>
              </motion.div>
            </div>

            {/* Hero visual proof — living workspace graph */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 14 }}
              transition={{ duration: 0.55, delay: 0.45 }}
              className="mt-14"
            >
              <WorkspaceGraphPreview />
            </motion.div>
          </section>

          {/* ── Agents — moved close to the hero: agents are the core identity, not a footnote ── */}
          <FadeIn><AgentsSection /></FadeIn>

          {/* ── Live signal cards ── */}
          <FadeIn><LiveSignalsSection /></FadeIn>

          {/* ── How it's different ── */}
          <FadeIn><ComparisonSection /></FadeIn>

          {/* ── Use cases — no narrow CRM framing ── */}
          <FadeIn><UseCasesSection /></FadeIn>

          {/* ── Product process tabs ── */}
          <FadeIn><ProcessTabsSection /></FadeIn>

          {/* ── Feature map ── */}
          <FadeIn><FeatureSection /></FadeIn>

          {/* ── Pricing ── */}
          <FadeIn><PricingSection /></FadeIn>

          {/* ── AI with approval — agents act, humans stay in control ── */}
          <FadeIn><ApprovalSection /></FadeIn>

          {/* ── FAQ ── */}
          <FAQSection />

          {/* ── Trust / data isolation ── */}
          <TrustSection />

          {/* ── Final CTA ── */}
          <section className="mx-auto max-w-6xl px-6 py-16">
            <div className="py-10 text-center">
              <h2 className="mx-auto mb-3 max-w-xl font-sans font-semibold tracking-tight text-zinc-900">
                Build your workspace graph.
              </h2>
              <p className="mb-8 text-[14px] text-zinc-500">
                Start with records. Let the agents prepare the next move.
              </p>
              <div className="mx-auto max-w-2xl">
                <EmailSignup />
                <p className="mt-3 text-center text-[12px] text-zinc-500">
                  Free forever · no card required · takes 90 seconds
                </p>
              </div>
            </div>
          </section>
        </main>

        {/* ── Trust & compliance ── */}
        <TrustBadges />

        {/* ── Footer ── */}
        <footer className="relative" style={{ background: "var(--landing-surface-raised)" }}>
          <div className="absolute top-0 left-0 h-px w-full bg-current opacity-10"/>
          <FooterTicker />
          <div className="mx-auto max-w-6xl px-6 py-14">
            <div className="mb-10 flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-[260px]">
                <div className="mb-4">
                  <Logo size={38} />
                </div>
                <p className="text-[13px] leading-relaxed text-zinc-500">Autonomous AI workspace platform. Built for teams that move fast.</p>
              </div>

              <div className="flex flex-wrap gap-x-14 gap-y-8 text-[13px]">
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Product</span>
                  <a href="#pricing" className="text-zinc-500 hover:text-zinc-700 transition-colors">Pricing</a>
                  <a href="/changelog" className="text-zinc-500 hover:text-zinc-700 transition-colors">Changelog</a>
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Platform</span>
                  <a href="/status" className="text-zinc-500 hover:text-zinc-700 transition-colors">System status</a>
                  <a href="/roadmap" className="text-zinc-500 hover:text-zinc-700 transition-colors">Roadmap</a>
                  <a href="/security" className="text-zinc-500 hover:text-zinc-700 transition-colors">Security</a>
                  <a href="/docs" className="text-zinc-500 hover:text-zinc-700 transition-colors">API docs</a>
                  <a href="/help" className="text-zinc-500 hover:text-zinc-700 transition-colors">Help center</a>
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Legal</span>
                  <a href="/privacy" className="text-zinc-500 hover:text-zinc-700 transition-colors">Privacy</a>
                  <a href="/terms" className="text-zinc-500 hover:text-zinc-700 transition-colors">Terms</a>
                  <a href="/dpa" className="text-zinc-500 hover:text-zinc-700 transition-colors">DPA</a>
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="text-zinc-400 text-[11px] uppercase tracking-widest mb-1">Contact</span>
                  <a href="mailto:support@mondaily.com" className="text-zinc-500 hover:text-zinc-700 transition-colors">Support</a>
                  <a href="mailto:sales@mondaily.com" className="text-zinc-500 hover:text-zinc-700 transition-colors">Sales</a>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-black/[.05] pt-6 text-[12px] text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
              <span>© {new Date().getFullYear()} Mondaily. All rights reserved.</span>
              <div className="flex items-center gap-3">
                <a href="/status" className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-700 transition-colors">
                  System status
                </a>
              </div>
            </div>
          </div>
        </footer>
      </motion.div>

      <CookieBanner />
    </>
  );
}
