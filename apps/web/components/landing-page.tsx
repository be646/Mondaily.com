"use client";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { MondailyLogo } from "./mondaily-logo";

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function SearchIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
}
function PlusIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>;
}
function ChevronDownIcon({ size = 10 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
}
function ChevronRightIcon({ size = 10 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>;
}
function XIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
}
function FilterIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
}
function ColumnsIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>;
}
function BriefcaseIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
}
function UsersIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function ListIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>;
}
function ZapIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>;
}
function CheckIcon({ size = 11 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
}
function GlobeIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>;
}
function MailIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>;
}
function SparklesIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>;
}
function SettingsIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;
}

// ── Preloader ─────────────────────────────────────────────────────────────────
const LOG_LINES = [
  { tag: "[MONDAILY-AI]", msg: "Bootstrapping cluster nodes..." },
  { tag: "[DB]", msg: "Connected to Supabase relational network graph (edges_v2 matched)" },
  { tag: "[AI]", msg: "Engine status: ACTIVE" },
  { tag: "[DATA]", msg: "Hydrating 42 records from CSV cache..." },
  { tag: "[TAVILY]", msg: 'Scraped "Vercel Inc." revenue profiles (ARR: $42M) [SUCCESS]' },
  { tag: "[ENRICH]", msg: "12 records enriched with live web data — 0 errors" },
  { tag: "[PIPELINE]", msg: "3 deals auto-advanced to next stage" },
  { tag: "[WS]", msg: "Workspace ready — loading interface..." },
];

function nowStamp() {
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${mo}-${da}-${yr} ${hh}:${mm}:${ss}]`;
}

function Preloader({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<Array<{ tag: string; msg: string; ts: string }>>([]);
  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    let i = 0;
    const step = () => {
      if (i >= LOG_LINES.length) {
        setTimeout(() => {
          if (!doneRef.current) { doneRef.current = true; setExiting(true); }
        }, 500);
        return;
      }
      const item = LOG_LINES[i]!;
      setLines(prev => [...prev, { ...item, ts: nowStamp() }]);
      i++;
      setTimeout(step, 260 + Math.random() * 160);
    };
    const t = setTimeout(step, 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!exiting && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.55, ease: "easeInOut" as const }}
          className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0c] font-mono text-[11px] leading-relaxed"
        >
          {/* Top bar */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[.05] px-5">
            <MondailyLogo size={20} showWordmark />
            <span className="ml-auto text-zinc-700 text-[10px]">system boot · v2.0.0</span>
          </div>

          {/* Log output */}
          <div className="flex-1 overflow-hidden px-5 py-5 space-y-1.5">
            {lines.map((line, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" as const }}
                className="flex items-start gap-3"
              >
                <span className="shrink-0 text-zinc-700">{String(idx + 1).padStart(2, "0")}</span>
                <span className="shrink-0 text-zinc-600">➜</span>
                <span className={`shrink-0 ${
                  line.tag === "[AI]" ? "text-indigo-400" :
                  line.tag === "[DB]" ? "text-emerald-500" :
                  line.tag === "[TAVILY]" ? "text-amber-400" :
                  "text-zinc-500"
                }`}>{line.tag}</span>
                <span className={idx === lines.length - 1 ? "text-zinc-300" : "text-zinc-600"}>
                  {line.msg}
                </span>
                <span className="ml-auto shrink-0 text-zinc-800">{line.ts}</span>
              </motion.div>
            ))}
            {/* Blinking cursor */}
            {lines.length > 0 && lines.length < LOG_LINES.length && (
              <div className="flex items-center gap-3 pl-8">
                <span className="text-zinc-700">➜</span>
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.7, repeat: Infinity }}
                  className="inline-block h-3 w-1.5 bg-zinc-400"
                />
              </div>
            )}
          </div>

          {/* Bottom status bar */}
          <div className="flex h-7 items-center gap-4 border-t border-white/[.04] px-5 text-[10px] text-zinc-800">
            <span>MONDAILY WORKSPACE</span>
            <div className="h-px flex-1 bg-zinc-900"/>
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="text-indigo-600"
            >● BOOTING</motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── CRM Data ──────────────────────────────────────────────────────────────────
type RowStatus = "Active" | "In Progress" | "Closed Won" | "Lost" | "Enriching";

interface CRMRow {
  id: number;
  name: string;
  domain: string;
  status: RowStatus;
  arr: string;
  arrNum: number;
  country: string;
  stage: string;
  owner: string;
  ownerBg: string;
  enriching?: boolean;
  justAdded?: boolean;
}

const SEED: CRMRow[] = [
  { id: 1, name: "Stripe",  domain: "stripe.com",  status: "Active",      arr: "$4.2M",  arrNum: 4200000, country: "🇺🇸 US", stage: "Customer",    owner: "AK", ownerBg: "bg-violet-600" },
  { id: 2, name: "Vercel",  domain: "vercel.com",  status: "In Progress", arr: "$1.8M",  arrNum: 1800000, country: "🇺🇸 US", stage: "Negotiation", owner: "MR", ownerBg: "bg-blue-600"   },
  { id: 3, name: "Linear",  domain: "linear.app",  status: "Active",      arr: "$840K",  arrNum:  840000, country: "🇺🇸 US", stage: "Customer",    owner: "DK", ownerBg: "bg-emerald-600"},
  { id: 4, name: "Figma",   domain: "figma.com",   status: "Active",      arr: "$2.1M",  arrNum: 2100000, country: "🇸🇬 SG", stage: "Customer",    owner: "AK", ownerBg: "bg-violet-600" },
  { id: 5, name: "Notion",  domain: "notion.so",   status: "In Progress", arr: "$620K",  arrNum:  620000, country: "🇺🇸 US", stage: "Proposal",    owner: "JS", ownerBg: "bg-amber-600"  },
];

const NEW_ROW_SEED: Omit<CRMRow, "id"> = {
  name: "Resend", domain: "resend.com", status: "Enriching",
  arr: "—", arrNum: 0, country: "—", stage: "—", owner: "AI", ownerBg: "bg-indigo-600",
  enriching: true, justAdded: true,
};

const ENRICHED_PATCH: Partial<CRMRow> = {
  status: "Active", arr: "$380K", arrNum: 380000, country: "🇺🇸 US", stage: "Discovery", enriching: false, justAdded: false,
};

const STATUS_COLORS: Record<RowStatus, string> = {
  "Active":      "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "In Progress": "bg-amber-500/15  text-amber-400  border-amber-500/20",
  "Closed Won":  "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  "Lost":        "bg-red-500/15    text-red-400    border-red-500/20",
  "Enriching":   "bg-violet-500/15 text-violet-400 border-violet-500/20",
};

function fmtArr(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: RowStatus }) {
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" as const }}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[status]}`}
    >
      {status === "Enriching" && (
        <motion.span
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity }}
          className="h-1 w-1 rounded-full bg-violet-400"
        />
      )}
      {status}
    </motion.span>
  );
}

// ── Inspector sidebar ─────────────────────────────────────────────────────────
function Inspector({ row, onClose }: { row: CRMRow; onClose: () => void }) {
  const [tasks, setTasks] = useState([
    { id: 1, label: "Send NDA draft", done: true },
    { id: 2, label: "Follow up on pricing", done: false },
    { id: 3, label: "Schedule demo call", done: false },
  ]);

  useEffect(() => {
    const t = setTimeout(() => {
      setTasks(prev => prev.map((t, i) => i === 1 ? { ...t, done: true } : t));
    }, 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as const }}
      className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l border-white/[.07] bg-[#0d0f14] shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/[.06] px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[.06] text-[11px] font-bold text-white">
          {row.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-[13px] font-semibold text-white">{row.name}</p>
          <p className="text-[10px] text-zinc-600">{row.domain}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-zinc-600 hover:text-zinc-300 transition-colors">
          <XIcon size={12}/>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 px-4 py-4 text-[12px]">
        {/* Key fields */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Details</p>
          {[
            { label: "ARR",     value: row.arr,     icon: <ZapIcon size={11}/> },
            { label: "Stage",   value: row.stage,   icon: <BriefcaseIcon size={11}/> },
            { label: "Country", value: row.country, icon: <GlobeIcon size={11}/> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-lg border border-white/[.05] bg-white/[.02] px-3 py-2">
              <span className="text-zinc-600">{icon}</span>
              <span className="text-zinc-500 w-14 shrink-0">{label}</span>
              <span className="font-medium text-zinc-300">{value}</span>
            </div>
          ))}
        </div>

        {/* Relations */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Contacts</p>
          {[
            { name: "Sarah Chen",   title: "VP Sales",   color: "bg-pink-600"   },
            { name: "Marcus Reid",  title: "Eng Lead",   color: "bg-blue-600"   },
          ].map(c => (
            <div key={c.name} className="flex items-center gap-2.5 rounded-lg border border-white/[.05] bg-white/[.02] px-3 py-2">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${c.color}`}>
                {c.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <p className="font-medium text-zinc-300">{c.name}</p>
                <p className="text-[10px] text-zinc-600">{c.title}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tasks */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Tasks</p>
          {tasks.map(task => (
            <motion.div
              key={task.id}
              animate={task.done ? { backgroundColor: "rgba(16,185,129,0.04)" } : {}}
              className="flex items-center gap-2.5 rounded-lg border border-white/[.05] bg-white/[.02] px-3 py-2"
            >
              <motion.div
                animate={task.done
                  ? { backgroundColor: "rgb(16,185,129)", borderColor: "rgb(16,185,129)" }
                  : { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.12)" }
                }
                transition={{ duration: 0.3 }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
              >
                {task.done && <CheckIcon size={9}/>}
              </motion.div>
              <span className={task.done ? "text-zinc-600 line-through" : "text-zinc-300"}>{task.label}</span>
            </motion.div>
          ))}
        </div>

        {/* Activity */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Activity</p>
          {[
            { icon: <MailIcon size={10}/>, text: "Email sent · 2h ago", color: "text-blue-400" },
            { icon: <SparklesIcon size={10}/>, text: "AI enriched record · 4h ago", color: "text-indigo-400" },
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-600">
              <span className={a.color}>{a.icon}</span>
              {a.text}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const SIDEBAR_LISTS = ["All Companies", "My Accounts", "Enterprise Tier", "High Intent"];
const SIDEBAR_PIPES = ["Sales Pipeline", "Partnerships", "Renewals"];
const SIDEBAR_MEMBERS = [
  { init: "AK", bg: "bg-violet-600" },
  { init: "MR", bg: "bg-blue-600"   },
  { init: "JS", bg: "bg-amber-600"  },
  { init: "DK", bg: "bg-emerald-600"},
];

function Sidebar() {
  const [activeList, setActiveList] = useState(0);
  return (
    <div className="flex w-48 shrink-0 flex-col border-r border-white/[.06] bg-[#0a0c10] text-[12px]">
      {/* Logo area */}
      <div className="flex h-10 items-center gap-2.5 border-b border-white/[.05] px-3.5">
        <MondailyLogo size={20} showWordmark />
      </div>

      <div className="flex-1 overflow-y-auto py-3 space-y-4 px-2">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg border border-white/[.06] bg-white/[.03] px-2.5 py-1.5 text-zinc-600">
          <SearchIcon size={11}/>
          <span className="text-[11px]">Search…</span>
        </div>

        {/* Lists */}
        <div>
          <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Lists</p>
          {SIDEBAR_LISTS.map((l, i) => (
            <button
              key={l}
              onClick={() => setActiveList(i)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                activeList === i ? "bg-white/[.06] text-white" : "text-zinc-500 hover:bg-white/[.03] hover:text-zinc-300"
              }`}
            >
              <ListIcon size={11}/>
              {l}
            </button>
          ))}
        </div>

        {/* Pipelines */}
        <div>
          <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Pipelines</p>
          {SIDEBAR_PIPES.map(p => (
            <button key={p} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-zinc-500 hover:bg-white/[.03] hover:text-zinc-300 transition-colors">
              <BriefcaseIcon size={11}/>
              {p}
            </button>
          ))}
        </div>

        {/* Members */}
        <div>
          <p className="mb-2 px-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Members</p>
          <div className="flex flex-wrap gap-1.5 px-1.5">
            {SIDEBAR_MEMBERS.map(m => (
              <div key={m.init} className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ${m.bg}`}>
                {m.init}
              </div>
            ))}
            <button className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[.1] text-zinc-600 hover:text-zinc-300 transition-colors">
              <PlusIcon size={9}/>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom settings */}
      <div className="border-t border-white/[.05] px-3.5 py-3 flex items-center gap-2 text-zinc-700">
        <SettingsIcon size={12}/>
        <span className="text-[11px]">Settings</span>
      </div>
    </div>
  );
}

// ── Main Canvas ───────────────────────────────────────────────────────────────
const COLS = [
  { key: "status",  label: "Status",  w: "w-28" },
  { key: "arr",     label: "ARR",     w: "w-24" },
  { key: "country", label: "Country", w: "w-20" },
  { key: "stage",   label: "Stage",   w: "w-28" },
  { key: "owner",   label: "Owner",   w: "w-20" },
];

export function LandingPage() {
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<CRMRow[]>(SEED);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [totalArr, setTotalArr] = useState(() => SEED.reduce((s, r) => s + r.arrNum, 0));
  const [arrPulse, setArrPulse] = useState(false);
  const cycleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedRow = rows.find(r => r.id === selectedId) ?? null;

  const calcTotal = useCallback((rs: CRMRow[]) =>
    rs.reduce((s, r) => s + r.arrNum, 0), []);

  // Animation cycle
  useEffect(() => {
    if (!ready) return;

    const runCycle = () => {
      // Reset
      setRows(SEED);
      setSelectedId(null);
      setTotalArr(calcTotal(SEED));

      // t=1.2s: add empty-then-enriching row
      cycleRef.current = setTimeout(() => {
        const newRow: CRMRow = { ...NEW_ROW_SEED, id: 99 };
        setRows(prev => [...prev, newRow]);
      }, 1200);

      // t=3.2s: populate enriched row
      cycleRef.current = setTimeout(() => {
        setRows(prev => prev.map(r =>
          r.id === 99 ? { ...r, ...ENRICHED_PATCH } : r
        ));
        const enrichedTotal = calcTotal([...SEED, { ...NEW_ROW_SEED, id: 99, ...ENRICHED_PATCH } as CRMRow]);
        setTotalArr(enrichedTotal);
        setArrPulse(true);
        setTimeout(() => setArrPulse(false), 600);
      }, 3200);

      // t=5s: status mutation on Vercel row (In Progress → Closed Won)
      cycleRef.current = setTimeout(() => {
        setRows(prev => prev.map(r =>
          r.id === 2 ? { ...r, status: "Closed Won" as RowStatus } : r
        ));
      }, 5000);

      // t=6.5s: select Stripe row, open inspector
      cycleRef.current = setTimeout(() => {
        setSelectedId(1);
      }, 6500);

      // t=10s: close inspector, loop
      cycleRef.current = setTimeout(() => {
        setSelectedId(null);
        setTimeout(runCycle, 800);
      }, 10000);
    };

    runCycle();
    return () => { if (cycleRef.current) clearTimeout(cycleRef.current); };
  }, [ready, calcTotal]);

  return (
    <>
      <Preloader onDone={() => setReady(true)} />

      <AnimatePresence>
        {ready && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" as const }}
            className="flex h-screen w-screen overflow-hidden bg-[#0d0f13] text-zinc-300"
          >
            <Sidebar />

            {/* Main panel */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Top bar */}
              <div className="flex h-10 shrink-0 items-center gap-3 border-b border-white/[.06] px-4">
                <div className="flex items-center gap-1 text-[12px] text-zinc-500">
                  <UsersIcon size={12}/>
                  <span className="ml-1.5 font-medium text-zinc-300">Companies</span>
                  <ChevronRightIcon size={10}/>
                  <span>All Companies</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button className="flex items-center gap-1.5 rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                    <FilterIcon size={10}/> Filter
                  </button>
                  <button className="flex items-center gap-1.5 rounded-md border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                    <ColumnsIcon size={10}/> Columns
                  </button>
                  <button className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 transition-colors">
                    <PlusIcon size={10}/> Add record
                  </button>
                </div>
              </div>

              {/* Table + inspector wrapper */}
              <div className="relative flex-1 overflow-hidden">
                {/* Scrollable table area */}
                <div className="h-full overflow-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-white/[.06]">
                        {/* Frozen Name column */}
                        <th className="sticky left-0 z-10 bg-[#0d0f13] py-2.5 pl-4 pr-3 text-left">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                            Name <ChevronDownIcon size={9}/>
                          </div>
                        </th>
                        {COLS.map(c => (
                          <th key={c.key} className={`${c.w} py-2.5 px-3 text-left`}>
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{c.label}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence>
                        {rows.map(row => (
                          <motion.tr
                            key={row.id}
                            initial={row.justAdded ? { opacity: 0, y: -8 } : false}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3, ease: "easeOut" as const }}
                            onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}
                            className={`group cursor-pointer border-b border-white/[.04] transition-colors ${
                              selectedId === row.id
                                ? "bg-indigo-500/[.08]"
                                : "hover:bg-white/[.025]"
                            } ${row.enriching ? "animate-pulse" : ""}`}
                          >
                            {/* Frozen Name cell */}
                            <td className="sticky left-0 z-10 bg-[#0d0f13] py-2.5 pl-4 pr-3 group-hover:bg-[#111420]">
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/[.08] bg-white/[.04] text-[9px] font-bold text-zinc-400">
                                  {row.name[0]}
                                </div>
                                <span className="font-medium text-zinc-200">{row.name}</span>
                                {row.enriching && (
                                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] text-violet-400">
                                    <SparklesIcon size={9}/> AI
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="w-28 py-2.5 px-3"><StatusPill status={row.status}/></td>
                            <td className="w-24 py-2.5 px-3 font-mono text-zinc-300">{row.arr}</td>
                            <td className="w-20 py-2.5 px-3 text-zinc-500">{row.country}</td>
                            <td className="w-28 py-2.5 px-3 text-zinc-500">{row.stage}</td>
                            <td className="w-20 py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white ${row.ownerBg}`}>
                                  {row.owner}
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>

                  {/* ── Sticky calculate footer ─────────────────────────────── */}
                  <div className="sticky bottom-0 left-0 right-0 flex items-center border-t border-white/[.08] bg-[#0d0f13]/95 backdrop-blur-sm px-4 py-2.5 text-[11px]">
                    <div className="sticky left-4 flex items-center gap-2 text-zinc-600">
                      <PlusIcon size={10}/>
                      <span>Calculate</span>
                      <span className="mx-2 text-zinc-800">·</span>
                      <span className="text-zinc-700">{rows.length} records</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-zinc-600">Total ARR</span>
                      <motion.span
                        key={totalArr}
                        animate={arrPulse
                          ? { scale: [1, 1.08, 1], color: ["#a5b4fc", "#6366f1", "#e2e8f0"] }
                          : { scale: 1 }}
                        transition={{ duration: 0.5, ease: "easeOut" as const }}
                        className="font-mono font-semibold text-zinc-200"
                      >
                        {fmtArr(totalArr)}
                      </motion.span>
                    </div>
                  </div>
                </div>

                {/* Inspector */}
                <AnimatePresence>
                  {selectedRow && (
                    <Inspector
                      key={selectedRow.id}
                      row={selectedRow}
                      onClose={() => setSelectedId(null)}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
