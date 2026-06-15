import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2,
  ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check, Search, X,
  Sparkles, Command, Settings2, ArrowUpDown, Download, GripVertical,
  UserCircle2, Type, ToggleLeft, ChevronRight, Trash2, RotateCcw, List,
  Rows3, BookmarkCheck, LayoutGrid, Percent,
  Briefcase, DollarSign, Heart, BookOpen, ShoppingCart, Cpu, Shield,
  Store, Factory, Home, Truck, Tv, Scale, Zap, Megaphone,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../../lib/api-client";
import { parseNLPCommand } from "../../lib/ai-enrichment";
import { ErrorState, PageSkeleton } from "../ui/page-state";
import { INDUSTRY_TAXONOMY } from "./record-detail";
import { LeadScoreBadge } from "./lead-score-badge";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string }
type CalcOp = "sum" | "avg" | "min" | "max" | "count" | "filled" | null;
type SortDir = "asc" | "desc";
interface SortRule { col: string; dir: SortDir }

// ─── Cell overflow tooltip ────────────────────────────────────────────────────
// Used directly on <td> via onMouseEnter/Move/Leave props.
// Detects real overflow by comparing td.scrollWidth vs td.clientWidth.
function CellTipPortal({ text, x, y }: { text: string; x: number; y: number }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div
        className="max-w-sm rounded-lg px-3 py-2 text-[12px] text-white/90 leading-relaxed shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
        style={{ background: "rgba(13,15,19,0.96)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(10px)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {text}
      </div>
    </div>,
    document.body,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function display(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ─── Inline editable cell ─────────────────────────────────────────────────────
function EditableCell({
  raw, onSave, className = "", numeric = false,
}: {
  raw: unknown; onSave: (v: string) => void; className?: string; numeric?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(raw == null || raw === "" ? "" : String(raw));
    setEditing(true);
  }

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const original = raw == null || raw === "" ? "" : String(raw);
    if (trimmed !== original) onSave(trimmed);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={numeric ? "number" : "text"}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
        className={`w-full min-w-0 bg-zinc-900 text-[12px] text-white outline-none rounded px-1 py-0.5 border border-zinc-600/60 -mx-1 ${numeric ? "text-right font-mono" : ""} ${className}`}
      />
    );
  }

  const shown = display(raw);
  return (
    <span
      onClick={startEdit}
      className={`block truncate cursor-text text-[12px] ${shown === "—" ? "text-zinc-700 hover:text-zinc-500" : ""} ${className}`}
    >
      {shown}
    </span>
  );
}

// ─── Category cell — shared between built-in `categories` col and custom category cols ──
// Uses the same INDUSTRY_TAXONOMY as the record profile so data is always in sync.
// Format stored: [{ name: string; color: string }, ...] at data.categories

function parseCats(value: unknown): { name: string; color: string }[] {
  if (Array.isArray(value)) return value as { name: string; color: string }[];
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return []; } }
  return [];
}

// Lucide icon per industry (no emojis)
function IndustryIcon({ name, size = 11 }: { name: string; size?: number }) {
  const map: Record<string, React.ReactNode> = {
    "B2B":                   <Building2 size={size}/>,
    "B2C":                   <User size={size}/>,
    "SaaS":                  <Globe size={size}/>,
    "Web Services & Apps":   <Globe size={size}/>,
    "Consulting":            <Briefcase size={size}/>,
    "FinTech":               <DollarSign size={size}/>,
    "HealthTech":            <Heart size={size}/>,
    "EdTech":                <BookOpen size={size}/>,
    "E-commerce":            <ShoppingCart size={size}/>,
    "AI / ML":               <Cpu size={size}/>,
    "Cybersecurity":         <Shield size={size}/>,
    "Marketplace":           <Store size={size}/>,
    "Manufacturing":         <Factory size={size}/>,
    "Real Estate":           <Home size={size}/>,
    "Logistics & Supply":    <Truck size={size}/>,
    "Media & Entertainment": <Tv size={size}/>,
    "Legal":                 <Scale size={size}/>,
    "Energy":                <Zap size={size}/>,
    "Agency":                <Megaphone size={size}/>,
    "Nonprofit":             <Heart size={size}/>,
  };
  return <>{map[name] ?? <LayoutGrid size={size}/>}</>;
}

type CatEntry = { name: string; color: string };

function CategoryCell({ value, onSave }: {
  value: unknown;
  onSave: (cats: CatEntry[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function h(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const cats = parseCats(value);
  const selected = new Set(cats.map(c => c.name));
  const filtered = INDUSTRY_TAXONOMY.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  function toggle(t: typeof INDUSTRY_TAXONOMY[number]) {
    if (selected.has(t.name)) onSave(cats.filter(c => c.name !== t.name));
    else onSave([...cats, { name: t.name, color: t.border }]);
  }

  const MAX = 2;
  const overflow = cats.length - MAX;

  return (
    <div ref={ref} className="relative min-w-0">
      {/* Display */}
      <div className="flex items-center gap-1 flex-wrap cursor-pointer" onClick={() => setOpen(o => !o)}>
        {cats.length === 0
          ? <span className="text-slate-700 text-xs hover:text-slate-500 transition-colors">+ category</span>
          : <>
              {cats.slice(0, MAX).map((cat) => {
                const t = INDUSTRY_TAXONOMY.find(x => x.name === cat.name) ?? INDUSTRY_TAXONOMY[0]!;
                return (
                  <span key={cat.name} style={{ background: t.bg, color: t.text, borderColor: t.border + "55" }}
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold whitespace-nowrap">
                    <IndustryIcon name={cat.name} size={9}/>
                    {cat.name}
                  </span>
                );
              })}
              {overflow > 0 && <span className="rounded-full bg-white/[.05] border border-white/[.06] px-1.5 py-0.5 text-[9px] text-slate-500">+{overflow}</span>}
            </>
        }
      </div>

      {/* Picker portal */}
      {open && createPortal(
        <div style={{ position: "fixed", top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 4, left: ref.current?.getBoundingClientRect().left ?? 0, zIndex: 9999 }}
          className="w-52 rounded-xl border border-white/[.08] bg-[#0f1117] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-2 pt-2 pb-1">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
              placeholder="Search categories…"
              className="w-full bg-white/[.04] border border-white/[.07] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/[.15] placeholder:text-white/20"/>
          </div>
          <div className="p-1 max-h-56 overflow-y-auto">
            {filtered.map(t => {
              const active = selected.has(t.name);
              return (
                <button key={t.name} onClick={() => toggle(t)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[.04] transition-colors">
                  <span style={{ color: t.text }} className="shrink-0 opacity-70">
                    <IndustryIcon name={t.name} size={11}/>
                  </span>
                  <span className="flex-1 text-left text-xs text-white/50" style={{ color: active ? t.text : undefined }}>
                    {t.name}
                  </span>
                  {active && <Check size={10} style={{ color: t.border }} className="shrink-0"/>}
                </button>
              );
            })}
          </div>
          {cats.length > 0 && (
            <div className="border-t border-white/[.06] px-2 py-1.5">
              <button onClick={() => { onSave([]); }} className="text-[10px] text-white/20 hover:text-red-400 transition-colors">Clear all</button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function isNumeric(col: string) {
  const lower = col.toLowerCase();
  return ["amount","price","value","arr","mrr","revenue","budget","salary",
          "cost","balance","count","score","number","followers","raised"].some(k => lower.includes(k));
}

function getColumnIcon(col: string) {
  const lower = col.toLowerCase();
  if (lower.includes("name") || lower.includes("person") || lower.includes("contact")) return <User size={12} className="text-slate-600"/>;
  if (lower.includes("email"))  return <Mail size={12} className="text-slate-600"/>;
  if (lower.includes("phone"))  return <Phone size={12} className="text-slate-600"/>;
  if (lower.includes("company") || lower.includes("org")) return <Building2 size={12} className="text-slate-600"/>;
  if (lower.includes("date") || lower.includes("updated")) return <Calendar size={12} className="text-slate-600"/>;
  if (lower.includes("tag") || lower.includes("label") || lower.includes("status") || lower.includes("stage")) return <Tag size={12} className="text-slate-600"/>;
  if (lower.includes("url") || lower.includes("website") || lower.includes("link") || lower.includes("linkedin") || lower.includes("twitter")) return <Globe size={12} className="text-slate-600"/>;
  if (isNumeric(col)) return <Hash size={12} className="text-slate-600"/>;
  return <Database size={12} className="text-slate-600"/>;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, cb]);
}

// ─── Portal dropdown — renders over ALL overflow/z-index traps ────────────────
function PortalDropdown({ triggerRef, onClose, align = "left", direction = "down", minWidth, className = "", children }: {
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "left" | "right";
  direction?: "down" | "up";
  minWidth?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s: React.CSSProperties = {
      visibility: "visible",
      minWidth: minWidth ?? r.width,
    };
    if (direction === "down") s.top = r.bottom + 4;
    else s.bottom = window.innerHeight - r.top + 4;
    if (align === "right") s.right = window.innerWidth - r.right;
    else s.left = r.left;
    setStyle(s);
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-[9999] overflow-hidden rounded border border-zinc-800/70 bg-[#0f1114] shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-sm ${className}`}
      style={style}
    >
      {children}
    </div>,
    document.body
  );
}

// ─── Human-readable date ──────────────────────────────────────────────────────
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

// Columns to always hide from the data grid (shown separately or internal)
const HIDDEN_DATA_COLS = new Set(["updated_at", "created_at", "workspace_id", "id"]);

// ─── Short record ID derived from UUID ───────────────────────────────────────
// Deterministic, human-readable, 6-char alphanumeric. No backend change needed.
function shortId(uuid: string): string {
  // Take first 6 hex chars and uppercase — always consistent for the same record
  return uuid.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function RecordIdCell({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const sid = shortId(id);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(sid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="flex items-center gap-1.5 group/id">
      <span className="font-mono text-[10px] text-white/25 tracking-wider select-all group-hover/id:text-white/50 transition-colors">
        {sid}
      </span>
      <button
        onClick={copy}
        className="opacity-0 group-hover/id:opacity-100 transition-opacity text-white/30 hover:text-white/70"
        title="Copy ID"
      >
        {copied
          ? <Check size={9} className="text-emerald-400"/>
          : <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        }
      </button>
    </div>
  );
}

function RowLogo({ name, enriched }: { name: string; enriched?: boolean }) {
  const initials = String(name).split(" ").map(w => w[0] ?? "").filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  const colors = [
    "bg-red-500/20 text-red-400",
    "bg-blue-500/20 text-blue-400",
    "bg-emerald-500/20 text-emerald-400",
    "bg-purple-500/20 text-purple-400",
    "bg-amber-500/20 text-amber-400",
  ];
  const color = colors[(initials.charCodeAt(0) || 0) % colors.length];
  return (
    <div className="relative shrink-0">
      <div className={`h-6 w-6 rounded flex items-center justify-center text-[10px] font-semibold ${color}`}>
        {initials || "?"}
      </div>
      {enriched && (
        <div className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-white ring-1 ring-[#0d0f13] flex items-center justify-center">
          <Sparkles size={5} className="text-black"/>
        </div>
      )}
    </div>
  );
}

// ─── Stage / Status colours ───────────────────────────────────────────────────
const STAGE_STYLES: Record<string, { pill: string; dot: string }> = {
  "Lead":         { pill: "bg-zinc-900/60 text-zinc-400 border-zinc-700/50",       dot: "bg-zinc-500" },
  "New":          { pill: "bg-zinc-900/60 text-zinc-400 border-zinc-700/50",       dot: "bg-zinc-500" },
  "Qualified":    { pill: "bg-sky-950/40 text-sky-400 border-sky-900/40",          dot: "bg-sky-400" },
  "In Progress":  { pill: "bg-amber-950/30 text-amber-400 border-amber-900/40",    dot: "bg-amber-400" },
  "Not Started":  { pill: "bg-zinc-900/60 text-zinc-500 border-zinc-700/50",       dot: "bg-zinc-600" },
  "Completed":    { pill: "bg-emerald-950/40 text-emerald-400 border-emerald-900/50", dot: "bg-emerald-400" },
  "Complete":     { pill: "bg-emerald-950/40 text-emerald-400 border-emerald-900/50", dot: "bg-emerald-400" },
  "Proposal":     { pill: "bg-violet-950/40 text-violet-400 border-violet-900/40", dot: "bg-violet-400" },
  "Negotiation":  { pill: "bg-orange-950/40 text-orange-400 border-orange-900/40", dot: "bg-orange-400" },
  "Closed Won":   { pill: "bg-emerald-950/40 text-emerald-400 border-emerald-900/50", dot: "bg-emerald-400" },
  "Closed Lost":  { pill: "bg-rose-950/40 text-rose-400 border-rose-900/50",       dot: "bg-rose-400" },
  "On Hold":      { pill: "bg-yellow-950/40 text-yellow-400 border-yellow-900/40", dot: "bg-yellow-400" },
  "Cancelled":    { pill: "bg-rose-950/30 text-rose-400 border-rose-900/40",       dot: "bg-rose-400" },
  "Active":       { pill: "bg-emerald-950/40 text-emerald-400 border-emerald-900/50", dot: "bg-emerald-400" },
  "Churned":      { pill: "bg-rose-950/30 text-rose-400 border-rose-900/40",       dot: "bg-rose-400" },
};

export const DEFAULT_STAGE_OPTIONS = [
  "Lead","Qualified","Proposal","Negotiation","Closed Won","Closed Lost","On Hold",
];
export const DEFAULT_STATUS_OPTIONS = [
  "Not Started","In Progress","Completed","On Hold","Cancelled",
];

export function stageStyle(value: string) {
  return STAGE_STYLES[value] ?? { pill: "bg-slate-900/60 text-slate-400 border-slate-700/50", dot: "bg-slate-500" };
}

// Clickable stage pill — opens a dropdown to change the value inline
export function StagePill({ value, options, onSelect }: {
  value: string;
  options?: string[];
  onSelect?: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { pill, dot } = stageStyle(value);
  const opts = options?.length ? options : DEFAULT_STAGE_OPTIONS;

  if (!onSelect) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${pill}`}>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`}/>
        {value}
      </span>
    );
  }

  return (
    <div className="relative inline-flex">
      <button
        ref={ref}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-opacity hover:opacity-80 ${pill}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`}/>
        {value}
        <ChevronDown size={9} className="opacity-50 ml-0.5"/>
      </button>
      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => setOpen(false)} align="left" className="w-40">
          {opts.map(opt => {
            const s = stageStyle(opt);
            return (
              <button key={opt} onClick={() => { onSelect(opt); setOpen(false); }}
                className={`dropdown-item w-full gap-2 ${opt === value ? "dropdown-item-active" : ""}`}>
                <span className={`h-2 w-2 rounded-full shrink-0 ${s.dot}`}/>
                {opt}
                {opt === value && <Check size={10} className="ml-auto text-red-400 shrink-0"/>}
              </button>
            );
          })}
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Calc engine ─────────────────────────────────────────────────────────────
function calcResult(op: CalcOp, col: string, records: NodeRecord[]): string {
  if (!op) return "";
  const vals = records.map(r => r.data[col]);
  if (op === "count") return String(vals.length);
  if (op === "filled") {
    const filled = vals.filter(v => v != null && v !== "" && v !== "—").length;
    return `${Math.round((filled / vals.length) * 100)}% filled`;
  }
  const nums = vals
    .map(v => typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, "")))
    .filter(n => !isNaN(n));
  if (!nums.length) return "—";
  if (op === "sum") { const s = nums.reduce((a, b) => a + b, 0); return s % 1 === 0 ? s.toLocaleString() : s.toFixed(2); }
  if (op === "avg") { const a = nums.reduce((a, b) => a + b, 0) / nums.length; return a % 1 === 0 ? a.toLocaleString() : a.toFixed(2); }
  if (op === "min") return Math.min(...nums).toLocaleString();
  if (op === "max") return Math.max(...nums).toLocaleString();
  return "—";
}

// ─── Calc dropdown ────────────────────────────────────────────────────────────
function CalcDropdown({ col, current, onSelect, onClose, triggerRef }: {
  col: string; current: CalcOp; onSelect: (op: CalcOp) => void; onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  const options: { op: CalcOp; label: string }[] = isNumeric(col)
    ? [{ op:"sum",label:"Sum" },{ op:"avg",label:"Average" },{ op:"min",label:"Min" },{ op:"max",label:"Max" },{ op:"count",label:"Count" },{ op:"filled",label:"% Filled" }]
    : [{ op:"count",label:"Count" },{ op:"filled",label:"% Filled" }];
  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} direction="up" align="left" className="w-36">
      {options.map(({ op, label }) => (
        <button key={op} onClick={() => { onSelect(op); onClose(); }}
          className={`dropdown-item w-full ${current === op ? "dropdown-item-active" : ""}`}>
          {label}{current === op && <Check size={11} className="ml-auto text-red-400"/>}
        </button>
      ))}
      {current && <>
        <div className="mx-2 my-1 border-t border-white/[.06]"/>
        <button onClick={() => { onSelect(null); onClose(); }} className="dropdown-item w-full text-slate-500">Clear</button>
      </>}
    </PortalDropdown>
  );
}

// ─── View Settings dropdown ───────────────────────────────────────────────────
function ViewSettingsDropdown({ columns, hidden, onToggle, onClose, triggerRef }: {
  columns: string[];
  hidden: Set<string>;
  onToggle: (col: string) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="left" className="w-56">
      <div className="px-3 py-2 border-b border-white/[.06]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Visible columns</p>
      </div>
      <div className="py-1 max-h-64 overflow-auto">
        {columns.map(col => {
          const visible = !hidden.has(col);
          return (
            <button key={col} onClick={() => onToggle(col)}
              className="dropdown-item w-full gap-2.5">
              <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${visible ? "border-red-500 bg-red-500" : "border-white/20 bg-transparent"}`}>
                {visible && <Check size={10} className="text-white"/>}
              </div>
              <span className="capitalize">{col.replace(/_/g, " ")}</span>
              <GripVertical size={12} className="ml-auto text-slate-700"/>
            </button>
          );
        })}
      </div>
      <div className="border-t border-white/[.06] px-3 py-2">
        <button
          onClick={() => { columns.forEach(c => hidden.has(c) && onToggle(c)); onClose(); }}
          className="text-[11px] text-slate-500 hover:text-white transition-colors"
        >
          Show all columns
        </button>
      </div>
    </PortalDropdown>
  );
}

// ─── Sort panel dropdown ──────────────────────────────────────────────────────
function SortPanel({ columns, rules, onChange, onClose, triggerRef }: {
  columns: string[];
  rules: SortRule[];
  onChange: (rules: SortRule[]) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  function addRule() {
    const unused = columns.find(c => !rules.some(r => r.col === c));
    if (unused) onChange([...rules, { col: unused, dir: "asc" }]);
  }
  function updateRule(i: number, patch: Partial<SortRule>) {
    onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="right" className="w-64">
      <div className="px-3 pt-3 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-2">Sort by</p>
        {rules.length === 0 && (
          <p className="text-xs text-slate-700 pb-1">No sorts applied</p>
        )}
        <div className="space-y-1.5">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[.06] bg-white/[.02] px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <select
                  value={rule.col}
                  onChange={e => updateRule(i, { col: e.target.value })}
                  className="w-full bg-transparent text-xs text-white/80 outline-none capitalize"
                >
                  {columns.map(c => <option key={c} value={c} className="bg-[#13151a]">{c.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <button
                onClick={() => updateRule(i, { dir: rule.dir === "asc" ? "desc" : "asc" })}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors whitespace-nowrap ${rule.dir === "asc" ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}
              >
                {rule.dir === "asc" ? <><ChevronUp size={9}/>A→Z</> : <><ChevronDown size={9}/>Z→A</>}
              </button>
              <button onClick={() => onChange(rules.filter((_, idx) => idx !== i))} className="text-white/20 hover:text-red-400 transition-colors shrink-0">
                <X size={12}/>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/[.06] px-3 py-2 flex items-center justify-between">
        <button onClick={addRule} disabled={rules.length >= columns.length}
          className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white transition-colors disabled:opacity-20">
          <Plus size={11}/> Add sort
        </button>
        {rules.length > 0 && (
          <button onClick={() => onChange([])} className="text-[11px] text-red-400/50 hover:text-red-400 transition-colors">
            Clear
          </button>
        )}
      </div>
    </PortalDropdown>
  );
}

// ─── Export dropdown ──────────────────────────────────────────────────────────
function ExportDropdown({ records, columns, objectType, onClose, triggerRef }: {
  records: NodeRecord[];
  columns: string[];
  objectType: string;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {

  function exportCSV() {
    const header = [...columns, "updated_at"].join(",");
    const rows = records.map(r => {
      const cells = columns.map(c => {
        const v = r.data[c] ?? "";
        const str = String(v).replace(/"/g, '""');
        return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
      });
      cells.push(new Date(r.updated_at).toISOString());
      return cells.join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${objectType}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  }

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="right" className="w-44">
      <div className="px-3 py-2 border-b border-white/[.06]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Import / Export</p>
      </div>
      <button onClick={exportCSV} className="dropdown-item w-full gap-2">
        <Download size={12} className="text-zinc-400"/>
        Export as CSV
      </button>
      <button
        onClick={onClose}
        className="dropdown-item w-full gap-2 opacity-40 cursor-not-allowed"
        disabled
      >
        <Download size={12} className="text-zinc-600"/>
        Import CSV <span className="ml-auto text-[10px]">soon</span>
      </button>
    </PortalDropdown>
  );
}

// ─── Owner cell ───────────────────────────────────────────────────────────────
interface Member { id: string; name: string; email: string; avatar_url?: string; role?: string }

// Deterministic avatar colour from name string
function avatarColor(name: string) {
  const colors = ["bg-red-500","bg-orange-500","bg-amber-500","bg-emerald-500","bg-sky-500","bg-violet-500","bg-pink-500","bg-teal-500"];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function MemberAvatar({ name, size = 5 }: { name: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0] ?? "").filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <div className={`h-${size} w-${size} rounded-full ${avatarColor(name)} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
      {initials}
    </div>
  );
}

function OwnerCell({ value, members, onSelect }: {
  value: string;
  members: Member[];
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const assigned = members.find(m => m.name === value || m.email === value);
  const label = assigned ? (assigned.name || assigned.email || "?") : "";

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-white/[.05] transition-colors">
        {assigned ? (
          <>
            <MemberAvatar name={label} size={5}/>
            <span className="text-[11px] text-slate-300 truncate max-w-[72px]">{label}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
            <UserCircle2 size={13}/>
            <span>Assign</span>
          </span>
        )}
      </button>

      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => setOpen(false)} align="left" className="w-48">
          <div className="px-3 py-2 border-b border-white/[.06]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Assign to</p>
          </div>
          {members.length === 0 && <p className="px-3 py-2 text-xs text-slate-600">No members yet</p>}
          {members.filter(m => {
            const label = m.name || m.email;
            return label && typeof label === "string" && isNaN(Number(label)) && label.trim().length > 0;
          }).map(m => {
            const ml = m.name || m.email || "Unknown";
            const isActive = m.name === value || m.email === value;
            return (
              <button key={m.id} onClick={() => { onSelect(ml); setOpen(false); }}
                className={`dropdown-item w-full gap-2 ${isActive ? "dropdown-item-active" : ""}`}>
                <MemberAvatar name={ml} size={5}/>
                <span className="truncate flex-1">{ml}</span>
                {m.role && <span className="text-[9px] text-slate-600 capitalize shrink-0">{m.role}</span>}
                {isActive && <Check size={10} className="text-red-400 shrink-0"/>}
              </button>
            );
          })}
          {value && <>
            <div className="mx-2 my-1 border-t border-white/[.06]"/>
            <button onClick={() => { onSelect(""); setOpen(false); }} className="dropdown-item w-full text-slate-500">
              Unassign
            </button>
          </>}
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── World countries list ─────────────────────────────────────────────────────
const WORLD_COUNTRIES = ["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];

// ─── Add column dropdown ───────────────────────────────────────────────────────
// Column type presets — each maps to a clear semantic meaning
const COLUMN_TYPE_PRESETS = [
  { type: "status",    label: "Status",     hint: "Current state (New, In Progress, Done…)",   icon: ToggleLeft,   color: "text-sky-400"     },
  { type: "stage",     label: "Stage",      hint: "Pipeline stage (Lead, Proposal, Closed…)",  icon: ChevronRight, color: "text-violet-400"  },
  { type: "assignee",  label: "Assignee",   hint: "Team member responsible for this record",   icon: UserCircle2,  color: "text-emerald-400" },
  { type: "owner",     label: "Owner",      hint: "Deal owner or account owner",               icon: User,         color: "text-amber-400"   },
  { type: "tag",       label: "Tag",        hint: "Label or category tag (multi-select)",      icon: Tag,          color: "text-pink-400"    },
  { type: "category",  label: "Category",   hint: "Pick a category with icon",                 icon: LayoutGrid,   color: "text-orange-400"  },
  { type: "country",   label: "Country",    hint: "Country picker from world countries list",  icon: Globe,        color: "text-teal-400"    },
  { type: "record_id", label: "Record ID",  hint: "Auto-generated unique ID for this record",  icon: Hash,         color: "text-white/30"    },
  { type: "text",      label: "Text",       hint: "Free text field",                           icon: Type,         color: "text-slate-400"   },
  { type: "number",    label: "Number",     hint: "Numeric value, amount, count",              icon: Hash,         color: "text-blue-400"    },
  { type: "date",      label: "Date",       hint: "Date or deadline",                          icon: Calendar,     color: "text-rose-400"    },
] as const;

type ColPresetType = typeof COLUMN_TYPE_PRESETS[number]["type"];

// Default column names per type
const PRESET_DEFAULTS: Record<ColPresetType, string> = {
  status:    "Status",
  stage:     "Stage",
  assignee:  "Assigned To",
  owner:     "Owner",
  tag:       "Tag",
  category:  "",
  country:   "Country",
  record_id: "Record ID",
  text:      "",
  number:    "",
  date:      "",
};

// Types where only one instance makes sense
const SINGLETON_TYPES = new Set(["assignee","owner","status","stage","record_id","country"]);

function AddColumnDropdown({ onAdd, onClose, triggerRef, existingCols, existingCustomTypes }: {
  onAdd: (name: string, type: string) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | HTMLTableCellElement | null>;
  existingCols: string[];
  existingCustomTypes: string[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColPresetType>("text");
  const [hovered, setHovered] = useState<ColPresetType | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Determine which types are already covered so we can block adding duplicates
  function isTypeTaken(t: ColPresetType): boolean {
    if (!SINGLETON_TYPES.has(t)) return false;
    if (existingCustomTypes.includes(t)) return true;
    const cols = existingCols.map(c => c.toLowerCase());
    if (t === "assignee" && cols.some(c => c.includes("assign"))) return true;
    if (t === "owner" && cols.some(c => c.includes("owner"))) return true;
    if (t === "status" && cols.some(c => c === "status" || c === "deal_status")) return true;
    if (t === "stage" && cols.some(c => c.includes("stage"))) return true;
    if (t === "country" && cols.some(c => c.includes("country"))) return true;
    if (t === "record_id" && existingCustomTypes.includes("record_id")) return true;
    return false;
  }

  function pickType(t: ColPresetType) {
    setType(t);
    if (!name.trim() || Object.values(PRESET_DEFAULTS).includes(name)) {
      setName(PRESET_DEFAULTS[t]);
    }
    inputRef.current?.focus();
  }

  function submit() {
    const slug = (name.trim() || PRESET_DEFAULTS[type] || type).toLowerCase().replace(/\s+/g, "_");
    onAdd(slug, type);
    onClose();
  }

  const activePreset = COLUMN_TYPE_PRESETS.find(p => p.type === (hovered ?? type))!;

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="right" className="w-64">
      <div className="px-3 pt-3 pb-2 border-b border-white/[.06]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-2">Add column</p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          placeholder="Column name…"
          className="w-full rounded-md border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none focus:border-red-500/30"
        />
      </div>
      <div className="py-1">
        {COLUMN_TYPE_PRESETS.map(({ type: t, label, icon: Icon, color }) => {
          const taken = isTypeTaken(t);
          return (
            <button key={t} onClick={() => !taken && pickType(t)}
              onMouseEnter={() => setHovered(t)} onMouseLeave={() => setHovered(null)}
              disabled={taken}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors ${taken ? "opacity-30 cursor-not-allowed" : type === t ? "bg-white/[.05] text-white" : "text-slate-400 hover:bg-white/[.03] hover:text-white"}`}>
              <Icon size={13} className={taken ? "text-white/20" : color}/>
              <span className="font-medium">{label}</span>
              {taken && <span className="ml-auto text-[9px] text-white/20">already added</span>}
              {!taken && type === t && <Check size={10} className="ml-auto text-red-400 shrink-0"/>}
            </button>
          );
        })}
      </div>
      {activePreset && (
        <div className="px-3 py-2 border-t border-white/[.04] text-[10px] text-slate-600">
          {activePreset.hint}
        </div>
      )}
      <div className="px-3 pb-3 pt-2 border-t border-white/[.06]">
        <button onClick={submit}
          className="w-full rounded-lg bg-red-500 py-1.5 text-xs font-semibold text-white hover:bg-red-400 transition-colors">
          Add {name.trim() || PRESET_DEFAULTS[type] || type}
        </button>
      </div>
    </PortalDropdown>
  );
}

// ─── NLP Command Bar ──────────────────────────────────────────────────────────
function NLPCommandBar({ columns, onApply, onClear, hasActive }: {
  columns: string[];
  onApply: (filterText: string, sortCol: string | null, sortDir: SortDir, calcOps: Record<string, "sum"|"avg"|"min"|"max"|"count">) => void;
  onClear: () => void;
  hasActive: boolean;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle"|"thinking"|"applied"|"error">("idle");
  const [lastApplied, setLastApplied] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const EXAMPLES = [
    "Sort by ARR descending and show total revenue",
    "Filter by USA and sort by funding raised",
    "Show sum of deal value sorted by stage",
    "Average ARR and filter by Series A",
  ];
  const [placeholder] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);

  const apply = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setStatus("thinking");
    try {
      const token = localStorage.getItem("mondaily_session_token");
      const workspaceId = localStorage.getItem("mondaily_workspace_id");
      const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
      const res = await fetch(`${apiUrl}/api/v1/generate/nlp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
        },
        body: JSON.stringify({ query: trimmed, columns }),
      });
      if (!res.ok) throw new Error();
      const parsed = await res.json() as any;
      if (parsed.error) throw new Error();
      onApply(parsed.filterText ?? "", parsed.sortCol ?? null, parsed.sortDir ?? "asc", parsed.calcOps ?? {});
      setLastApplied(trimmed);
      setStatus("applied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      // Fallback to regex parser
      const parsed = parseNLPCommand(trimmed, columns);
      if (parsed.confidence === 0) {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 2500);
        return;
      }
      onApply(parsed.filterText ?? "", parsed.sortCol ?? null, parsed.sortDir ?? "asc", parsed.calcOps ?? {});
      setLastApplied(trimmed);
      setStatus("applied");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }, [value, columns, onApply]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const statusColors = { idle: "border-zinc-800/50 bg-zinc-900/20", thinking: "border-zinc-700/50 bg-zinc-800/30", applied: "border-zinc-600/50 bg-zinc-800/40", error: "border-zinc-700/40 bg-zinc-900/30" };

  return (
    <div className={`rounded-lg border px-3 py-2 transition-all duration-300 ${statusColors[status]}`}>
      <div className="flex items-center gap-2">
        <Sparkles size={13} className={`shrink-0 transition-colors ${status === "thinking" ? "text-zinc-400 animate-pulse" : status === "applied" ? "text-zinc-300" : "text-slate-600"}`}/>
        <input ref={inputRef} value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") apply(); if (e.key === "Escape") { setValue(""); onClear(); setStatus("idle"); } }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs text-white placeholder-slate-700 outline-none"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          {hasActive && <button onClick={() => { setValue(""); onClear(); setStatus("idle"); }} className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">Clear</button>}
          <kbd className="flex items-center gap-0.5 rounded border border-white/[.08] bg-white/[.04] px-1.5 py-0.5 text-[10px] text-slate-600"><Command size={8}/><span>⇧K</span></kbd>
          <button onClick={apply} disabled={!value.trim() || status === "thinking"}
            className="rounded-md border border-white/[.08] bg-white/[.04] px-2.5 py-1 text-[11px] text-slate-400 hover:bg-white/[.07] hover:text-white transition-colors disabled:opacity-40">
            {status === "thinking" ? "…" : "Run"}
          </button>
        </div>
      </div>
      {status === "applied" && lastApplied && <p className="mt-1.5 text-[10px] text-zinc-400/80 flex items-center gap-1"><Check size={9}/> Applied: {lastApplied}</p>}
      {status === "error" && <p className="mt-1.5 text-[10px] text-red-400/80">Couldn't parse — try "sort by ARR desc" or "filter by USA"</p>}
    </div>
  );
}

// ─── Country cell ─────────────────────────────────────────────────────────────
function CountryCell({ value, onSelect }: { value: string; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = WORLD_COUNTRIES.filter(c => c.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors">
        {value ? <><Globe size={11} className="text-teal-400/60 shrink-0"/>{value}</> : <span className="text-slate-700 hover:text-slate-500">— select country</span>}
      </button>
      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => { setOpen(false); setSearch(""); }} align="left" className="w-52">
          <div className="px-2 py-1.5 border-b border-white/[.06]">
            <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search country…"
              className="w-full bg-transparent text-xs text-white placeholder-slate-700 outline-none"/>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {value && <button onClick={() => { onSelect(""); setOpen(false); setSearch(""); }} className="dropdown-item w-full text-slate-500 text-xs">Clear</button>}
            {filtered.slice(0, 80).map(c => (
              <button key={c} onClick={() => { onSelect(c); setOpen(false); setSearch(""); }}
                className={`dropdown-item w-full text-xs ${c === value ? "dropdown-item-active" : ""}`}>
                {c}{c === value && <Check size={10} className="ml-auto text-red-400 shrink-0"/>}
              </button>
            ))}
            {filtered.length > 80 && <p className="px-3 py-1 text-[10px] text-slate-700">Type to narrow…</p>}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Tag cell (multi-tag, workspace-synced) ───────────────────────────────────
interface WorkspaceTag { id: string; name: string; color: string }

const PRESET_TAG_COLORS = [
  "#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6",
  "#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16",
];

// tagColor kept for backwards compat with filter badges
function tagColor(val: string) {
  const TAG_COLORS = [
    { bg: "bg-sky-500/15 border-sky-500/30 text-sky-300", dot: "bg-sky-400" },
    { bg: "bg-violet-500/15 border-violet-500/30 text-violet-300", dot: "bg-violet-400" },
    { bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300", dot: "bg-emerald-400" },
    { bg: "bg-amber-500/15 border-amber-500/30 text-amber-300", dot: "bg-amber-400" },
    { bg: "bg-rose-500/15 border-rose-500/30 text-rose-300", dot: "bg-rose-400" },
    { bg: "bg-pink-500/15 border-pink-500/30 text-pink-300", dot: "bg-pink-400" },
  ];
  let h = 0; for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffffffff;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]!;
}

function TagCell({ nodeId, col, colKey }: { nodeId: string; col: string; colKey: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newColor, setNewColor] = useState(PRESET_TAG_COLORS[0]!);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const allTags = useQuery({ queryKey: ["tags"], queryFn: () => apiClient.get<WorkspaceTag[]>("/tags") });
  const nodeTags = useQuery({ queryKey: ["node-tags", nodeId], queryFn: () => apiClient.get<WorkspaceTag[]>(`/tags/node/${nodeId}`) });
  const nodeTagIds = new Set((nodeTags.data ?? []).map(t => t.id));

  const addTag = useMutation({
    mutationFn: (tag_id: string) => apiClient.post(`/tags/node/${nodeId}`, { tag_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-tags", nodeId] }),
  });
  const removeTag = useMutation({
    mutationFn: (tagId: string) => apiClient.delete(`/tags/node/${nodeId}/${tagId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-tags", nodeId] }),
  });

  async function createAndAdd() {
    const name = search.trim(); if (!name) return;
    setCreating(true);
    try {
      const tag = await apiClient.post<WorkspaceTag>("/tags", { name, color: newColor });
      await apiClient.post(`/tags/node/${nodeId}`, { tag_id: tag.id });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["node-tags", nodeId] });
      setSearch("");
    } finally { setCreating(false); }
  }

  const filtered = (allTags.data ?? []).filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const canCreate = search.trim() && !(allTags.data ?? []).some(t => t.name.toLowerCase() === search.trim().toLowerCase());
  const activeTags = nodeTags.data ?? [];
  void col; void colKey; // used for context only

  return (
    <div ref={ref} className="relative min-w-0">
      <div className="flex items-center gap-1 flex-wrap cursor-pointer" onClick={() => setOpen(o => !o)}>
        {activeTags.length === 0
          ? <span className="text-slate-700 text-xs hover:text-slate-500 transition-colors">+ tag</span>
          : activeTags.map(t => (
            <span key={t.id} onClick={e => { e.stopPropagation(); removeTag.mutate(t.id); }}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-pointer hover:opacity-70 transition-opacity"
              style={{ background: t.color + "22", color: t.color, borderColor: t.color + "44" }}>
              {t.name}<X size={8}/>
            </span>
          ))
        }
      </div>
      {open && createPortal(
        <div style={{ position: "fixed", top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 4, left: ref.current?.getBoundingClientRect().left ?? 0, zIndex: 9999 }}
          className="w-52 rounded-xl border border-white/[.08] bg-[#0f1117] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-2 pt-2 pb-1">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && canCreate) createAndAdd(); if (e.key === "Escape") setOpen(false); }}
              placeholder="Search or create tag…"
              className="w-full bg-white/[.04] border border-white/[.07] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/40 placeholder:text-white/20"/>
          </div>
          <div className="max-h-40 overflow-y-auto p-1">
            {filtered.map(tag => {
              const active = nodeTagIds.has(tag.id);
              return (
                <button key={tag.id} onClick={() => active ? removeTag.mutate(tag.id) : addTag.mutate(tag.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[.04] transition-colors">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }}/>
                  <span className="flex-1 text-left text-xs text-white/70">{tag.name}</span>
                  {active && <Check size={10} className="text-violet-400 shrink-0"/>}
                </button>
              );
            })}
            {filtered.length === 0 && !canCreate && <p className="text-xs text-white/20 text-center py-2">No tags found</p>}
          </div>
          {canCreate && (
            <div className="border-t border-white/[.06] p-2 space-y-1.5">
              <div className="flex gap-1">
                {PRESET_TAG_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="h-4 w-4 rounded-full shrink-0 transition-all"
                    style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px #0f1117, 0 0 0 3px ${c}` : undefined }}/>
                ))}
              </div>
              <button onClick={createAndAdd} disabled={creating}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-white/60 hover:bg-violet-500/10 hover:text-violet-300 transition-colors disabled:opacity-40">
                <Plus size={11}/> Create "{search.trim()}"
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Number cell with formula support ─────────────────────────────────────────
function evalFormula(expr: string, _context?: Record<string, number>): number | null {
  try {
    // Only allow safe math characters
    const safe = expr.replace(/\s/g, "");
    if (!/^[0-9+\-*/().%,]+$/.test(safe)) return null;
    // % operator: treat trailing % as /100
    const withPct = safe.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${withPct})`)();
    return typeof result === "number" && isFinite(result) ? result : null;
  } catch { return null; }
}

function NumberCell({ value, onSave }: { value: unknown; onSave: (v: number | string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(String(value ?? "")); inputRef.current?.focus(); inputRef.current?.select(); } }, [editing, value]);

  function commit() {
    const s = draft.trim();
    if (!s) { onSave(""); setEditing(false); return; }
    if (s.startsWith("=")) {
      const result = evalFormula(s.slice(1));
      if (result !== null) { onSave(result); setEditing(false); return; }
    }
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
    onSave(isNaN(n) ? s : n);
    setEditing(false);
  }

  const isPercent = String(value ?? "").includes("%") || (typeof value === "number" && value > 0 && value <= 1);
  const displayVal = value === "" || value == null ? null
    : typeof value === "number" ? (isPercent && value <= 1 ? `${(value * 100).toFixed(1)}%` : value.toLocaleString())
    : String(value);

  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="0 or =A*0.1"
        className="w-full max-w-[100px] bg-white/[.04] border border-white/[.10] rounded px-2 py-0.5 text-xs text-white outline-none font-mono"/>
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-white/70 hover:text-white tabular-nums transition-colors text-left w-full">
      {displayVal ?? <span className="text-slate-700">— number</span>}
    </button>
  );
}

// ─── Filter column dropdown (inline bar style) ───────────────────────────────
function FilterColDropdown({ col, vals, activeValue, isStage, onSelect }: {
  col: string;
  vals: string[];
  activeValue: string | null;
  isStage: boolean;
  onSelect: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = activeValue && isStage ? stageStyle(activeValue) : null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors whitespace-nowrap ${activeValue ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-white/[.08] bg-white/[.03] text-white/40 hover:text-white/80 hover:border-white/[.15]"}`}
      >
        {s && <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`}/>}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mr-0.5">{col.replaceAll("_", " ")}</span>
        {activeValue ? <span>{activeValue}</span> : <ChevronDown size={10} className="opacity-40"/>}
        {activeValue && <X size={9} className="ml-0.5 opacity-60" onClick={e => { e.stopPropagation(); onSelect(activeValue); }}/>}
      </button>
      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => setOpen(false)} align="left" className="w-44">
          {vals.map(val => {
            const ss = isStage ? stageStyle(val) : null;
            const isActive = activeValue === val;
            return (
              <button key={val} onClick={() => { onSelect(val); setOpen(false); }}
                className={`dropdown-item w-full gap-2 ${isActive ? "dropdown-item-active" : ""}`}>
                {ss && <span className={`h-2 w-2 rounded-full shrink-0 ${ss.dot}`}/>}
                <span className="flex-1 text-left">{val}</span>
                {isActive && <Check size={10} className="text-red-400 shrink-0"/>}
              </button>
            );
          })}
          {activeValue && <>
            <div className="mx-2 my-1 border-t border-white/[.06]"/>
            <button onClick={() => { onSelect(activeValue); setOpen(false); }} className="dropdown-item w-full text-slate-500">Clear</button>
          </>}
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Main table ───────────────────────────────────────────────────────────────
export function RecordTable({ objectType, enrichedIds = [], filterQuery = "", onColumnsChange }: { objectType: string; enrichedIds?: string[]; filterQuery?: string; onColumnsChange?: (cols: string[]) => void }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["records", objectType],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`),
  });

  const records = query.data ?? [];

  const allColumns = useMemo(() => {
    const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))))
      .filter(k => !HIDDEN_DATA_COLS.has(k));
    const nameKey = allKeys.find(k => k.toLowerCase() === "name");
    const rest = allKeys.filter(k => k.toLowerCase() !== "name");
    return (nameKey ? [nameKey, ...rest] : allKeys).slice(0, 8);
  }, [records]);

  // ── Column visibility (allColumnsWithCustom declared after customCols below) ──
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  function toggleCol(col: string) {
    setHiddenCols(prev => { const n = new Set(prev); n.has(col) ? n.delete(col) : n.add(col); return n; });
  }

  // ── Multi-sort state (stacked rules) ──
  const [sortRules, setSortRules] = useState<SortRule[]>([]);

  // ── Legacy single-sort (header clicks) ──
  const [quickSortCol, setQuickSortCol] = useState<string | null>(null);
  const [quickSortDir, setQuickSortDir] = useState<SortDir>("asc");

  // ── Calc state ──
  const [calculations, setCalculations] = useState<Record<string, CalcOp>>({});
  const [openCalcCol, setOpenCalcCol] = useState<string | null>(null);

  // ── Filter ──
  const [filterText, setFilterText] = useState("");
  // Quick filter chips: { col, value } pairs, AND-ed together
  const [quickFilters, setQuickFilters] = useState<{ col: string; value: string }[]>([]);

  function toggleQuickFilter(col: string, value: string) {
    setQuickFilters(prev => {
      const exists = prev.some(f => f.col === col && f.value === value);
      return exists ? prev.filter(f => !(f.col === col && f.value === value)) : [...prev, { col, value }];
    });
  }

  // ── NLP ──
  const [nlpActive, setNlpActive] = useState(false);

  // ── Toolbar dropdown open state ──
  const [openPanel, setOpenPanel] = useState<"view"|"sort"|"filter"|"export"|"addcol"|"groupby"|"views"|null>(null);

  // Add column lives in the table header now
  const addColHeaderRef = useRef<HTMLTableCellElement>(null);

  // ── Calc footer trigger refs (dynamic columns) ──
  const calcWrapRefs = useRef(new Map<string, HTMLDivElement>());

  // ── Custom columns — persisted to localStorage per objectType ──
  const customColsKey = `mondaily_custom_cols_${objectType}`;
  const [customCols, setCustomCols] = useState<{ key: string; type: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem(customColsKey) ?? "[]"); } catch { return []; }
  });
  // Reload when objectType changes (navigating between People/Deals/etc.)
  useEffect(() => {
    try { setCustomCols(JSON.parse(localStorage.getItem(`mondaily_custom_cols_${objectType}`) ?? "[]")); }
    catch { setCustomCols([]); }
  }, [objectType]);

  function saveCustomCols(next: { key: string; type: string }[]) {
    setCustomCols(next);
    localStorage.setItem(`mondaily_custom_cols_${objectType}`, JSON.stringify(next));
  }

  // Record-ID column is handled separately (locked between checkbox and name)
  const hasRecordIdCol = customCols.some(c => c.type === "record_id");
  // Non-ID custom cols go into the regular column flow
  const regularCustomCols = customCols.filter(c => c.type !== "record_id");

  const allColumnsWithCustom = useMemo(() => [...allColumns, ...regularCustomCols.map(c => c.key)], [allColumns, regularCustomCols]);
  const columns = useMemo(() => allColumnsWithCustom.filter(c => !hiddenCols.has(c)), [allColumnsWithCustom, hiddenCols]);

  // ── Column reorder ──
  const [colOrder, setColOrder] = useState<string[]>([]);
  const dragColRef = useRef<string | null>(null);

  // Final ordered columns (apply colOrder on top of visibility)
  const orderedColumns = useMemo(() => {
    if (!colOrder.length) return columns;
    const orderMap = new Map(colOrder.map((c, i) => [c, i]));
    return [...columns].sort((a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999));
  }, [columns, colOrder]);

  // ── Column header context menu (right-click to delete) ──
  const [colCtxMenu, setColCtxMenu] = useState<{ col: string; x: number; y: number } | null>(null);

  useEffect(() => { onColumnsChange?.(columns); }, [columns]);

  // ── Owner cell state: recordId → owner name ──
  // owners[recordId][col] — separate tracker per column so Deal Owner ≠ Assigned To
  const [owners, setOwners] = useState<Record<string, Record<string, string>>>({});
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function resolveOwner(raw: unknown): string {
    const s = String(raw ?? "");
    if (!UUID_RE.test(s)) return s;
    // It's a UUID — try to find a matching member by id or user_id
    const match = (membersQuery.data ?? []).find(m => m.id === s || (m as any).user_id === s);
    return match ? (match.name || match.email || "") : "";
  }
  function getOwner(recordId: string, col: string, fallback: unknown) {
    return owners[recordId]?.[col] ?? resolveOwner(fallback);
  }
  function setOwner(recordId: string, col: string, name: string) {
    setOwners(prev => ({ ...prev, [recordId]: { ...prev[recordId], [col]: name } }));
  }

  // ── Members for owner picker ──
  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get<Member[]>("/members"),
    staleTime: 60_000,
  });

  useEffect(() => {
    setFilterText(""); setQuickSortCol(null); setSortRules([]); setNlpActive(false); setHiddenCols(new Set());
  }, [objectType]);

  function handleHeaderSort(col: string) {
    if (quickSortCol === col) setQuickSortDir(d => d === "asc" ? "desc" : "asc");
    else { setQuickSortCol(col); setQuickSortDir("asc"); }
    setSortRules([]); // clear stacked rules when header-clicking
  }

  const handleNLPApply = useCallback((ft: string, sc: string | null, sd: SortDir, ops: Record<string, "sum"|"avg"|"min"|"max"|"count">) => {
    if (ft) setFilterText(ft);
    if (sc) { setQuickSortCol(sc); setQuickSortDir(sd); setSortRules([]); }
    if (Object.keys(ops).length) setCalculations(prev => ({ ...prev, ...ops }));
    setNlpActive(true);
  }, []);

  // ── Filter → sort pipeline ──
  const filtered = useMemo(() => {
    let base = records;
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      base = base.filter(r => Object.values(r.data).some(v => String(v ?? "").toLowerCase().includes(q)));
    }
    if (filterText.trim()) {
      const q2 = filterText.toLowerCase();
      base = base.filter(r => Object.values(r.data).some(v => String(v ?? "").toLowerCase().includes(q2)));
    }
    if (quickFilters.length) {
      base = base.filter(r => quickFilters.every(f => {
        if (f.col.endsWith("__from")) {
          const col = f.col.replace("__from", "");
          const v = String(r.data[col] ?? r.updated_at ?? "");
          return v >= f.value;
        }
        if (f.col.endsWith("__to")) {
          const col = f.col.replace("__to", "");
          const v = String(r.data[col] ?? r.updated_at ?? "");
          return v <= f.value;
        }
        // For owner/assignee columns use the owners state (same source as display)
        const l = f.col.toLowerCase();
        const isOwnerCol = l.includes("owner") || l.includes("assign");
        const cellVal = isOwnerCol
          ? (owners[r.id]?.[f.col] ?? String(r.data[f.col] ?? ""))
          : String(r.data[f.col] ?? "");
        return cellVal.toLowerCase() === f.value.toLowerCase();
      }));
    }
    return base;
  }, [records, filterText, filterQuery, quickFilters]);

  const sorted = useMemo(() => {
    // Stacked sort rules take priority over quick sort
    const rules = sortRules.length > 0
      ? sortRules
      : quickSortCol ? [{ col: quickSortCol, dir: quickSortDir }] : [];

    if (!rules.length) return filtered;

    return [...filtered].sort((a, b) => {
      for (const { col, dir } of rules) {
        const av = col === "__updated_at" ? a.updated_at : display(a.data[col]);
        const bv = col === "__updated_at" ? b.updated_at : display(b.data[col]);
        const an = typeof a.data[col] === "number" ? (a.data[col] as number) : parseFloat(av.replace(/[^0-9.-]/g, ""));
        const bn = typeof b.data[col] === "number" ? (b.data[col] as number) : parseFloat(bv.replace(/[^0-9.-]/g, ""));
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }, [filtered, sortRules, quickSortCol, quickSortDir]);

  function SortIcon({ col }: { col: string }) {
    const rule = sortRules.find(r => r.col === col);
    if (rule) return rule.dir === "asc" ? <ChevronUp size={10} className="text-purple-400 ml-1 shrink-0"/> : <ChevronDown size={10} className="text-purple-400 ml-1 shrink-0"/>;
    if (quickSortCol === col) return quickSortDir === "asc" ? <ChevronUp size={10} className="text-red-400 ml-1 shrink-0"/> : <ChevronDown size={10} className="text-red-400 ml-1 shrink-0"/>;
    return <ChevronsUpDown size={10} className="text-slate-700 ml-1 shrink-0"/>;
  }

  const nameCol = columns[0];
  const members = membersQuery.data ?? [];
  // Name column sticky offset changes when the Record ID locked column is present
  const nameLeft = hasRecordIdCol ? "left-[112px]" : "left-8";

  // ── Column widths (resizable) ──
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  function startResize(col: string, e: React.MouseEvent, currentW: number) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { col, startX: e.clientX, startW: currentW };
    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(80, resizingRef.current.startW + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Conditional row colour by stage/status ──
  function rowAccent(record: NodeRecord): string {
    const stageCol = columns.find(c => c.toLowerCase().includes("stage") || c === "status" || c === "deal_status");
    if (!stageCol) return "";
    const val = String(record.data[stageCol] ?? "");
    if (val === "Closed Won" || val === "Complete" || val === "Completed" || val === "Active") return "border-l-2 border-l-emerald-500/40";
    if (val === "Closed Lost" || val === "Cancelled" || val === "Churned") return "border-l-2 border-l-rose-500/30";
    if (val === "In Progress" || val === "Negotiation") return "border-l-2 border-l-amber-500/30";
    return "";
  }

  // ── Bulk edit ──
  const [bulkEditField, setBulkEditField] = useState<string | null>(null);
  const bulkEditRef = useRef<HTMLDivElement>(null);

  function applyBulkEdit(col: string, value: string) {
    const ids = [...selected];
    ids.forEach(id => {
      const record = records.find(r => r.id === id);
      if (record) saveCell(record, col, value);
    });
    setBulkEditField(null);
  }

  // Columns suitable for bulk edit — all except name/id/date/number
  const bulkEditCols = orderedColumns.filter(c => {
    const l = c.toLowerCase();
    const customDef = customCols.find(cc => cc.key === c);
    if (l === "id" || l === "created_at" || l === "updated_at") return false;
    if (customDef?.type === "number" || customDef?.type === "date") return false;
    return true;
  });

  // ── Group by ──
  const groupByKey = `mondaily_groupby_${objectType}`;
  const [groupByCol, setGroupByCol] = useState<string | null>(() => {
    try { return localStorage.getItem(groupByKey) ?? null; } catch { return null; }
  });
  function setGroupBy(col: string | null) {
    setGroupByCol(col);
    if (col) localStorage.setItem(groupByKey, col); else localStorage.removeItem(groupByKey);
  }

  // ── Saved views ──
  const savedViewsKey = `mondaily_views_${objectType}`;
  interface SavedView { id: string; name: string; filters: typeof quickFilters; sortRules: typeof sortRules; hiddenCols: string[]; groupBy: string | null }
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem(savedViewsKey) ?? "[]"); } catch { return []; }
  });
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  function persistViews(next: SavedView[]) {
    setSavedViews(next);
    localStorage.setItem(savedViewsKey, JSON.stringify(next));
  }
  function saveCurrentView() {
    if (!newViewName.trim()) return;
    const view: SavedView = {
      id: crypto.randomUUID(),
      name: newViewName.trim(),
      filters: quickFilters,
      sortRules,
      hiddenCols: [...hiddenCols],
      groupBy: groupByCol,
    };
    persistViews([...savedViews, view]);
    setNewViewName("");
    setSaveViewOpen(false);
  }
  function applyView(view: SavedView) {
    setQuickFilters(view.filters);
    setSortRules(view.sortRules);
    setHiddenCols(new Set(view.hiddenCols));
    setGroupBy(view.groupBy ?? null);
  }
  function deleteView(id: string) {
    persistViews(savedViews.filter(v => v.id !== id));
  }

  // ── Column metadata (defaults + required) ──
  const colMetaKey = `mondaily_colmeta_${objectType}`;
  const [colMeta, setColMeta] = useState<Record<string, { defaultValue?: string; required?: boolean }>>(() => {
    try { return JSON.parse(localStorage.getItem(colMetaKey) ?? "{}"); } catch { return {}; }
  });
  function saveColMeta(next: typeof colMeta) {
    setColMeta(next);
    localStorage.setItem(colMetaKey, JSON.stringify(next));
  }
  function setColDefault(col: string, val: string) {
    saveColMeta({ ...colMeta, [col]: { ...colMeta[col], defaultValue: val } });
  }
  function toggleColRequired(col: string) {
    saveColMeta({ ...colMeta, [col]: { ...colMeta[col], required: !colMeta[col]?.required } });
  }

  // ── Bulk selection ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cellTip, setCellTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const allSelected = sorted.length > 0 && sorted.every(r => selected.has(r.id));
  const someSelected = selected.size > 0;

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(r => r.id)));
  }
  function toggleSelectRow(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function bulkDelete() {
    const ids = [...selected];
    setSelected(new Set());
    qc.setQueryData<NodeRecord[]>(["records", objectType], old => (old ?? []).filter(r => !ids.includes(r.id)));
    await Promise.all(ids.map(id => apiClient.delete(`/nodes/${id}`).catch(() => {})));
  }

  async function bulkAddToList(listId: string) {
    await Promise.all([...selected].map(id => apiClient.post(`/lists/${listId}/entries`, { node_id: id }).catch(() => {})));
    setSelected(new Set());
  }

  const [filterSearchOpen, setFilterSearchOpen] = useState(false);
  const filterSearchRef = useRef<HTMLInputElement>(null);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const assignPickerRef = useRef<HTMLDivElement>(null);
  const listsQuery = useQuery({
    queryKey: ["lists"],
    queryFn: () => apiClient.get<{ id: string; name: string }[]>("/lists"),
    enabled: listPickerOpen,
  });

  const [undoToast, setUndoToast] = useState<{ record: NodeRecord; timer: ReturnType<typeof setTimeout> } | null>(null);

  function deleteRow(record: NodeRecord) {
    // Clear any existing undo toast first
    if (undoToast) {
      clearTimeout(undoToast.timer);
      apiClient.delete(`/nodes/${undoToast.record.id}`).catch(() => {});
    }
    // Optimistic remove
    qc.setQueryData<NodeRecord[]>(["records", objectType], old => (old ?? []).filter(r => r.id !== record.id));
    // Show undo toast for 6 seconds before actually deleting
    const timer = setTimeout(() => {
      apiClient.delete(`/nodes/${record.id}`).catch(() => {
        qc.invalidateQueries({ queryKey: ["records", objectType] });
      });
      setUndoToast(null);
    }, 6000);
    setUndoToast({ record, timer });
  }

  function undoDelete() {
    if (!undoToast) return;
    clearTimeout(undoToast.timer);
    qc.setQueryData<NodeRecord[]>(["records", objectType], old => [...(old ?? []), undoToast.record]);
    setUndoToast(null);
  }

  function saveCell(record: NodeRecord, col: string, newVal: string | number | object) {
    const newData = { ...record.data, [col]: newVal };
    qc.setQueryData<NodeRecord[]>(["records", objectType], old =>
      (old ?? []).map(r => r.id === record.id ? { ...r, data: newData } : r)
    );
    apiClient.patch(`/nodes/${record.id}`, { data: newData }).catch(() => {
      qc.invalidateQueries({ queryKey: ["records", objectType] });
    });
  }

  function renderCell(col: string, record: NodeRecord) {
    const val = record.data[col];
    const isEnriched = enrichedIds.includes(record.id);
    const customDef = customCols.find(c => c.key === col);

    // Custom assignee/owner/stage/status columns
    if (customDef?.type === "owner" || customDef?.type === "assignee") {
      return (
        <OwnerCell
          value={getOwner(record.id, col, val)}
          members={members}
          onSelect={name => { setOwner(record.id, col, name); saveCell(record, col, name); }}
        />
      );
    }
    // Record ID column — show the short ID, locked
    if (customDef?.type === "record_id") {
      return <RecordIdCell id={record.id}/>;
    }

    // Country column — searchable dropdown
    if (customDef?.type === "country") {
      return <CountryCell value={String(val ?? "")} onSelect={v => saveCell(record, col, v)}/>;
    }

    // Tag column — multi-tag chip picker synced to workspace tags
    if (customDef?.type === "tag") {
      return <TagCell nodeId={record.id} col={col} colKey={customDef.key}/>;
    }

    // Number column — editable with formula support
    if (customDef?.type === "number") {
      return <NumberCell value={val} onSave={v => saveCell(record, col, v)}/>;
    }

    // Category column — always reads/writes data.categories to stay in sync with profile
    if (customDef?.type === "category") {
      return <CategoryCell value={record.data["categories"]} onSave={cats => saveCell(record, "categories", cats)}/>;
    }

    if (customDef?.type === "stage" || customDef?.type === "status") {
      const shown = String(val ?? "");
      const defaults = customDef.type === "stage" ? DEFAULT_STAGE_OPTIONS : DEFAULT_STATUS_OPTIONS;
      const existingOptions = [...new Set([...defaults, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
      if (!shown) return (
        <button className="text-slate-700 text-xs hover:text-slate-400 transition-colors"
          onClick={() => saveCell(record, col, defaults[0]!)}>
          — set {customDef.type}
        </button>
      );
      return <StagePill value={shown} options={existingOptions} onSelect={v => saveCell(record, col, v)}/>;
    }

    // Custom column — empty by default
    if (customDef) return <span className="text-slate-700 text-xs">—</span>;

    // Built-in categories column — same component, same data.categories field
    if (col === "categories") return <CategoryCell value={val} onSave={cats => saveCell(record, "categories", cats)}/>;

    // Owner/assigned_to columns — each col tracked independently
    if (col === "assigned_to" || col === "deal_owner" || col.toLowerCase().includes("owner") || col.toLowerCase().includes("assignee")) {
      return (
        <OwnerCell
          value={getOwner(record.id, col, val)}
          members={members}
          onSelect={name => { setOwner(record.id, col, name); saveCell(record, col, name); }}
        />
      );
    }

    // Lead score badge
    if (col === "lead_score" && val != null) return <LeadScoreBadge score={Number(val)} size="sm"/>;

    // Stage / Status pill — handles empty/null values too (no longer falls through to text box)
    if (col.toLowerCase().includes("stage") || col === "status" || col === "deal_status") {
      const isStatusCol = col === "status" && !col.toLowerCase().includes("stage");
      const defaults = isStatusCol ? DEFAULT_STATUS_OPTIONS : DEFAULT_STAGE_OPTIONS;
      const existingOptions = [...new Set([...defaults, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
      const shown = String(val ?? "");
      if (!shown) return (
        <button className="text-slate-700 text-xs hover:text-slate-400 transition-colors"
          onClick={() => saveCell(record, col, defaults[0]!)}>
          — set {isStatusCol ? "status" : "stage"}
        </button>
      );
      return <StagePill value={shown} options={existingOptions} onSelect={v => saveCell(record, col, v)}/>;
    }

    // Logo URL — render as image, skip base64
    if ((col === "logo_url" || col === "avatar_url" || col === "image_url") && typeof val === "string" && val.startsWith("http")) {
      return <img src={val} alt="" className="h-6 w-6 rounded object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}/>;
    }
    if ((col === "logo_url" || col === "avatar_url" || col === "image_url") && typeof val === "string" && val.startsWith("data:")) {
      return <span className="text-white/20 text-[10px]">image</span>;
    }

    // Long text fields — truncate with tooltip
    const isLong = col === "description" || col === "bio" || col === "notes" || col === "summary" || col === "address";
    if (isLong && typeof val === "string" && val.length > 60) {
      return (
        <span className="block truncate text-white/40 text-[11px]">
          {val}
        </span>
      );
    }

    // URLs — show as clickable link, not raw
    if (typeof val === "string" && (col === "linkedin" || col === "twitter" || col === "website" || col === "domain") && val.startsWith("http")) {
      return (
        <a href={val} target="_blank" rel="noreferrer" className="text-blue-400/70 hover:text-blue-400 text-[11px] underline underline-offset-2 truncate block max-w-[140px]" onClick={e => e.stopPropagation()}>
          {val.replace(/^https?:\/\/(www\.)?/, "").slice(0, 30)}
        </a>
      );
    }

    // Name column — editable text + open link on hover
    if (col === nameCol) return (
      <div className="flex items-center gap-2 min-w-0">
        <RowLogo name={display(val)} enriched={isEnriched}/>
        <EditableCell
          raw={val}
          onSave={v => saveCell(record, col, v)}
          className="flex-1 font-medium text-white truncate"
        />
        {isEnriched && (
          <span className="inline-flex items-center gap-0.5 rounded-sm bg-zinc-800/60 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 shrink-0">
            <Sparkles size={8}/> AI
          </span>
        )}
        <Link to={`/objects/${objectType}/${record.id}`} className="shrink-0 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-300 transition-colors">
          <ChevronRight size={11}/>
        </Link>
      </div>
    );

    // All other fields — inline editable, truncated
    return (
      <div className="max-w-[180px] truncate">
        <EditableCell
          raw={val}
          numeric={isNumeric(col)}
          onSave={v => saveCell(record, col, v)}
        />
      </div>
    );
  }

  const activeSortCount = sortRules.length || (quickSortCol ? 1 : 0);

  if (query.isLoading) return <div className="mt-4"><PageSkeleton /></div>;
  if (query.isError)   return <div className="mt-4"><ErrorState error={query.error as Error} onRetry={() => query.refetch()} /></div>;
  if (!records.length) return (
    <div className="mt-4 mx-6 flex min-h-64 flex-col items-center justify-center rounded-lg border border-zinc-800/40 bg-white/[.01] px-6 text-center">
      <Database className="mb-3 text-slate-700" size={26}/>
      <h2 className="text-sm font-medium text-slate-300">No {objectType} yet</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-600">Create a record to get started.</p>
    </div>
  );

  function renderRow(record: NodeRecord, rowIdx: number) {
    return (
      <tr
        key={record.id}
        className={`group transition-colors ${selected.has(record.id) ? "bg-red-500/[.05]" : rowIdx % 2 === 1 ? "bg-white/[.008]" : ""} hover:bg-white/[.03] ${rowAccent(record)}`}
      >
        <td className={`w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 border-b border-b-white/[.04] sticky left-0 z-10 ${selected.has(record.id) ? "bg-[#130d0d] group-hover:bg-[#170f0f]" : "bg-[#0b0d10] group-hover:bg-[#0f1115]"}`}>
          <div
            onClick={() => toggleSelectRow(record.id)}
            className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${selected.has(record.id) ? "bg-red-500 border-red-500" : "border-white/[.10] opacity-0 group-hover:opacity-100 hover:border-white/30"}`}
          >
            {selected.has(record.id) && <Check size={10} className="text-white" strokeWidth={3}/>}
          </div>
        </td>
        {hasRecordIdCol && (
          <td className={`w-20 min-w-[80px] max-w-[80px] px-3 py-2.5 border-b border-b-white/[.04] sticky left-8 z-10 ${selected.has(record.id) ? "bg-[#130d0d] group-hover:bg-[#170f0f]" : "bg-[#0b0d10] group-hover:bg-[#0f1115]"}`}>
            <RecordIdCell id={record.id}/>
          </td>
        )}
        {orderedColumns.map((col, colIdx) => (
          <td
            key={col}
            className={`px-4 py-2.5 text-white/70 border-b border-b-white/[.04] overflow-hidden max-w-[240px] ${isNumeric(col) ? "text-right tabular-nums font-mono text-white/50" : ""} ${colIdx === 0 ? `sticky ${nameLeft} z-10 shadow-[2px_0_8px_rgba(0,0,0,0.4)] font-medium text-white/90 ` + (selected.has(record.id) ? "bg-[#130d0d] group-hover:bg-[#170f0f]" : "bg-[#0b0d10] group-hover:bg-[#0f1115]") : ""}`}
            onMouseEnter={(e) => {
              const td = e.currentTarget;
              if (td.scrollWidth > td.clientWidth + 2) {
                const text = display(record.data[col]);
                if (text && text !== "—") setCellTip({ text, x: e.clientX, y: e.clientY });
              }
            }}
            onMouseMove={(e) => cellTip && setCellTip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setCellTip(null)}
          >
            {renderCell(col, record)}
          </td>
        ))}
        <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-white/20 tabular-nums border-b border-b-white/[.04]">
          {fmtDate(record.updated_at)}
        </td>
        <td className="border-b border-b-white/[.04] w-10 px-2">
          <button
            onClick={() => deleteRow(record)}
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-6 w-6 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
            title="Delete row"
          >
            <Trash2 size={12}/>
          </button>
        </td>
      </tr>
    );
  }

  // Toolbar button styles — clean borderless pills
  const TB = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors duration-150 select-none";
  const TB_IDLE = `${TB} text-white/35 hover:text-white/70 hover:bg-white/[.04]`;
  const TB_ON   = `${TB} text-white/80 bg-white/[.06]`;
  const TB_DOT  = "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white/[.10] px-1 text-[9px] font-semibold text-white/60";
  const TB_DOT_ACTIVE = "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500/70 px-1 text-[9px] font-semibold text-white";

  return (
    <>
    <section className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-white/[.04] shrink-0">
        {(filterText || filterQuery || quickSortCol || sortRules.length > 0) && (
          <span className="text-[11px] text-white/20 tabular-nums mr-2">{sorted.length} of {records.length}</span>
        )}
        {nlpActive && (
          <span className="flex items-center gap-1 rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1 text-[10px] text-zinc-400 mr-1">
            <Sparkles size={9}/> AI active
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {/* Columns (was "View") */}
          <button onClick={() => setOpenPanel(p => p === "view" ? null : "view")}
            className={openPanel === "view" ? TB_ON : TB_IDLE}>
            <Settings2 size={11}/>
            <span>Columns</span>
            {hiddenCols.size > 0 && <span className={TB_DOT}>{allColumnsWithCustom.length - hiddenCols.size}</span>}
          </button>

          <div className="w-px h-3 bg-white/[.07] mx-1"/>

          {/* Filter */}
          <button onClick={() => setOpenPanel(p => p === "filter" ? null : "filter")}
            className={openPanel === "filter" || quickFilters.length > 0 || filterText ? TB_ON : TB_IDLE}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 2.5h10M3 6h6M5 9.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <span>Filter</span>
            {(quickFilters.length > 0 || filterText) && <span className={TB_DOT_ACTIVE}>{quickFilters.length + (filterText ? 1 : 0)}</span>}
          </button>

          {/* Sort */}
          <button onClick={() => setOpenPanel(p => p === "sort" ? null : "sort")}
            className={openPanel === "sort" || activeSortCount > 0 ? TB_ON : TB_IDLE}>
            <ArrowUpDown size={11}/>
            <span>Sort</span>
            {activeSortCount > 0 && <span className={TB_DOT}>{activeSortCount}</span>}
          </button>

          {/* Group */}
          <button onClick={() => setOpenPanel(p => p === "groupby" ? null : "groupby")}
            className={groupByCol || openPanel === "groupby" ? TB_ON : TB_IDLE}>
            <Rows3 size={11}/>
            <span>Group</span>
            {groupByCol && <span className={TB_DOT}>{groupByCol.replace(/_/g," ")}</span>}
          </button>

          <div className="w-px h-3 bg-white/[.07] mx-1"/>

          {/* Export */}
          <button onClick={() => setOpenPanel(p => p === "export" ? null : "export")}
            className={openPanel === "export" ? TB_ON : TB_IDLE}>
            <Download size={11}/>
            <span>Export</span>
          </button>

          {/* Saved (was "Views") */}
          <button onClick={() => setOpenPanel(p => p === "views" ? null : "views")}
            className={openPanel === "views" ? TB_ON : TB_IDLE}>
            <BookmarkCheck size={11}/>
            <span>Saved</span>
            {savedViews.length > 0 && <span className={TB_DOT}>{savedViews.length}</span>}
          </button>
        </div>
      </div>

      {/* ── Columns inline bar ── */}
      {openPanel === "view" && (
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20 shrink-0 mr-2">Columns</span>
          {allColumnsWithCustom.map(col => {
            const visible = !hiddenCols.has(col);
            return (
              <button key={col} onClick={() => toggleCol(col)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition-colors shrink-0 border ${visible ? "border-white/[.10] bg-white/[.05] text-white/70" : "border-white/[.04] bg-transparent text-white/20 hover:text-white/40 hover:border-white/[.08]"}`}>
                {visible && <Check size={9} className="text-red-400 shrink-0"/>}
                <span className="capitalize">{col.replace(/_/g," ")}</span>
              </button>
            );
          })}
          <button onClick={() => allColumnsWithCustom.forEach(c => hiddenCols.has(c) && toggleCol(c))}
            className="ml-2 text-[10px] text-white/25 hover:text-white/60 transition-colors shrink-0 whitespace-nowrap">
            Show all
          </button>
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/50 shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Sort inline bar ── */}
      {openPanel === "sort" && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20 shrink-0">Sort by</span>
          <div className="h-3 w-px bg-white/[.08] shrink-0"/>
          {sortRules.length === 0 && (
            <span className="text-[11px] text-white/20">No sorts — add one below</span>
          )}
          {sortRules.map((rule, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-2 py-1 shrink-0">
              <select value={rule.col} onChange={e => setSortRules(r => r.map((x, idx) => idx === i ? { ...x, col: e.target.value } : x))}
                className="bg-transparent text-[11px] text-white/70 outline-none capitalize max-w-[120px]">
                {[...allColumnsWithCustom, "__updated_at"].map(c => <option key={c} value={c} className="bg-[#13151a]">{c.replace(/_/g," ")}</option>)}
              </select>
              <button onClick={() => setSortRules(r => r.map((x, idx) => idx === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x))}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${rule.dir === "asc" ? "bg-sky-500/10 text-sky-400" : "bg-amber-500/10 text-amber-400"}`}>
                {rule.dir === "asc" ? <><ChevronUp size={9}/>A→Z</> : <><ChevronDown size={9}/>Z→A</>}
              </button>
              <button onClick={() => setSortRules(r => r.filter((_, idx) => idx !== i))} className="text-white/20 hover:text-red-400"><X size={10}/></button>
            </div>
          ))}
          <button onClick={() => { const unused = [...allColumnsWithCustom, "__updated_at"].find(c => !sortRules.some(r => r.col === c)); if (unused) { setSortRules(r => [...r, { col: unused, dir: "asc" }]); setQuickSortCol(null); } }}
            className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/70 transition-colors shrink-0 whitespace-nowrap">
            <Plus size={11}/> Add sort
          </button>
          {sortRules.length > 0 && (
            <button onClick={() => { setSortRules([]); setQuickSortCol(null); }} className="text-[10px] text-red-400/50 hover:text-red-400 transition-colors shrink-0 whitespace-nowrap">
              Clear
            </button>
          )}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/50 shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Group inline bar ── */}
      {openPanel === "groupby" && (
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20 shrink-0 mr-1">Group by</span>
          <div className="h-3 w-px bg-white/[.08] shrink-0"/>
          <button onClick={() => { setGroupBy(null); }}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition-colors shrink-0 border ${!groupByCol ? "border-white/[.12] bg-white/[.06] text-white" : "border-white/[.04] text-white/30 hover:text-white/60 hover:border-white/[.08]"}`}>
            {!groupByCol && <Check size={9} className="text-red-400"/>}None
          </button>
          {orderedColumns.map(col => (
            <button key={col} onClick={() => setGroupBy(col)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] transition-colors shrink-0 border capitalize ${groupByCol === col ? "border-white/[.12] bg-white/[.06] text-white" : "border-white/[.04] text-white/30 hover:text-white/60 hover:border-white/[.08]"}`}>
              {groupByCol === col && <Check size={9} className="text-red-400"/>}
              {col.replace(/_/g," ")}
            </button>
          ))}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/50 shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Export inline bar ── */}
      {openPanel === "export" && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20 shrink-0">Export</span>
          <div className="h-3 w-px bg-white/[.08] shrink-0"/>
          <button onClick={() => {
            const rows = [columns.join(","), ...sorted.map(r => columns.map(c => JSON.stringify(r.data[c] ?? "")).join(","))].join("\n");
            const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([rows], { type: "text/csv" })), download: `${objectType}.csv` });
            a.click(); URL.revokeObjectURL(a.href); setOpenPanel(null);
          }} className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors">
            <Download size={11}/> Export as CSV
            <span className="text-[10px] text-white/20 ml-1">({sorted.length} rows)</span>
          </button>
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/50 shrink-0"><X size={13}/></button>
        </div>
      )}

      {/* ── Saved views inline bar ── */}
      {openPanel === "views" && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20 shrink-0">Saved</span>
          <div className="h-3 w-px bg-white/[.08] shrink-0"/>
          {savedViews.length === 0 && <span className="text-[11px] text-white/20">No saved views yet</span>}
          {savedViews.map(v => (
            <div key={v.id} className="flex items-center gap-0.5 rounded-lg border border-white/[.08] bg-white/[.03] pl-2.5 pr-1 py-1 shrink-0">
              <button onClick={() => { applyView(v); setOpenPanel(null); }} className="text-[11px] text-white/60 hover:text-white transition-colors whitespace-nowrap">
                {v.name}
              </button>
              <button onClick={() => deleteView(v.id)} className="p-0.5 text-white/15 hover:text-red-400 transition-colors ml-1"><X size={10}/></button>
            </div>
          ))}
          <div className="h-3 w-px bg-white/[.08] shrink-0"/>
          {saveViewOpen ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <input autoFocus value={newViewName} onChange={e => setNewViewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveCurrentView(); if (e.key === "Escape") setSaveViewOpen(false); }}
                placeholder="Name this view…"
                className="bg-white/[.04] border border-white/[.08] rounded-lg px-2.5 py-1 text-[11px] text-white outline-none focus:border-white/[.15] placeholder:text-white/20 w-36"/>
              <button onClick={saveCurrentView} className="text-emerald-400 hover:text-emerald-300 transition-colors p-0.5"><Check size={12}/></button>
              <button onClick={() => setSaveViewOpen(false)} className="text-white/20 hover:text-white/50 p-0.5"><X size={11}/></button>
            </div>
          ) : (
            <button onClick={() => setSaveViewOpen(true)}
              className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/70 transition-colors shrink-0 whitespace-nowrap">
              <Plus size={11}/> Save current view
            </button>
          )}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/50 shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Filter inline bar ── */}
      {openPanel === "filter" && (() => {
        const filterableCols = orderedColumns.filter(c => {
          const l = c.toLowerCase();
          return (
            l.includes("stage") || l === "status" || l === "deal_status" ||
            l.includes("assignee") || l.includes("assigned") || l.includes("owner") ||
            l.includes("date") || l === "close_date" || l === "due_date" || l === "start_date" ||
            l === "country" || l.includes("country")
          );
        });
        // Also include custom stage/status/owner/assignee/country cols
        const customFilterCols = customCols
          .filter(c => ["stage","status","assignee","owner","country"].includes(c.type))
          .map(c => c.key)
          .filter(k => !filterableCols.includes(k));
        const allFilterCols = [...filterableCols, ...customFilterCols];

        return (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0 overflow-x-auto">
            {/* Search — icon that expands on click */}
            <div className="flex items-center shrink-0">
              {filterSearchOpen ? (
                <div className="relative flex items-center">
                  <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"/>
                  <input
                    ref={filterSearchRef}
                    autoFocus
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    onBlur={() => { if (!filterText) setFilterSearchOpen(false); }}
                    onKeyDown={e => { if (e.key === "Escape") { setFilterText(""); setFilterSearchOpen(false); } }}
                    placeholder="Search…"
                    className="key-input w-44 py-1 pl-6 pr-6 text-xs"
                  />
                  {filterText && (
                    <button onClick={() => { setFilterText(""); setFilterSearchOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white transition-colors">
                      <X size={10}/>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setFilterSearchOpen(true)}
                  className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${filterText ? "text-white bg-white/[.08]" : "text-white/30 hover:text-white/70 hover:bg-white/[.04]"}`}
                  title="Search records"
                >
                  <Search size={12}/>
                </button>
              )}
            </div>
            {allFilterCols.length > 0 && <div className="h-3 w-px bg-white/[.08] shrink-0"/>}

            {allFilterCols.length === 0 && (
              <span className="text-xs text-slate-600">Add a Stage, Status, or Assignee column to enable filters.</span>
            )}

            {allFilterCols.map(col => {
              const l = col.toLowerCase();
              const customDef = customCols.find(c => c.key === col);
              const isDate = l.includes("date");
              const isStage = l.includes("stage") || col === "deal_status" || customDef?.type === "stage";
              const isStatus = col === "status" || customDef?.type === "status";

              if (isDate) {
                const dateFrom = quickFilters.find(f => f.col === col + "__from")?.value ?? "";
                const dateTo   = quickFilters.find(f => f.col === col + "__to")?.value ?? "";
                const hasDate  = dateFrom || dateTo;
                return (
                  <div key={col} className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-semibold uppercase tracking-widest shrink-0 ${hasDate ? "text-red-300" : "text-slate-600"}`}>{col.replaceAll("_"," ")}</span>
                    <input type="date" value={dateFrom}
                      onChange={e => setQuickFilters(prev => { const o = prev.filter(f => f.col !== col+"__from"); return e.target.value ? [...o,{col:col+"__from",value:e.target.value}] : o; })}
                      className="rounded-lg border border-white/[.08] bg-white/[.03] px-2 py-1 text-[10px] text-white outline-none focus:border-red-500/30"
                    />
                    <span className="text-slate-700 text-[10px]">→</span>
                    <input type="date" value={dateTo}
                      onChange={e => setQuickFilters(prev => { const o = prev.filter(f => f.col !== col+"__to"); return e.target.value ? [...o,{col:col+"__to",value:e.target.value}] : o; })}
                      className="rounded-lg border border-white/[.08] bg-white/[.03] px-2 py-1 text-[10px] text-white outline-none focus:border-red-500/30"
                    />
                    <div className="h-3 w-px bg-white/[.08] shrink-0"/>
                  </div>
                );
              }

              // Options: use full defaults for stage/status, real member names for owner/assignee, data values for others
              const isCountry = l.includes("country") || customDef?.type === "country";
              const isOwnerCol = l.includes("owner") || l.includes("assign") || customDef?.type === "assignee" || customDef?.type === "owner";
              let vals: string[];
              if (isStage) {
                vals = [...new Set([...DEFAULT_STAGE_OPTIONS, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
              } else if (isStatus) {
                vals = [...new Set([...DEFAULT_STATUS_OPTIONS, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
              } else if (isOwnerCol) {
                // Use owners state (local display source) merged with data values, then fall back to member names
                const fromOwners = records.map(r => owners[r.id]?.[col] ?? resolveOwner(r.data[col])).filter(v => v && !UUID_RE.test(v));
                const fromMembers = members.filter(m => { const lb = m.name || m.email; return lb && typeof lb === "string" && isNaN(Number(lb)); }).map(m => m.name || m.email || "");
                vals = [...new Set([...fromOwners, ...fromMembers])].filter(Boolean).sort();
              } else if (isCountry) {
                vals = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort();
              } else {
                vals = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort().slice(0, 20);
              }

              if (!vals.length) return null;
              const active = quickFilters.find(f => f.col === col);

              return (
                <div key={col} className="flex items-center gap-2 shrink-0">
                  <FilterColDropdown
                    col={col}
                    vals={vals}
                    activeValue={active?.value ?? null}
                    isStage={isStage || isStatus}
                    onSelect={val => toggleQuickFilter(col, val)}
                  />
                  <div className="h-3 w-px bg-white/[.08] shrink-0"/>
                </div>
              );
            })}

            {quickFilters.length > 0 && (
              <button onClick={() => { setQuickFilters([]); setFilterText(""); }} className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors shrink-0 whitespace-nowrap">
                Clear all
              </button>
            )}
            <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/50 shrink-0 transition-colors pl-2">
              <X size={13}/>
            </button>
          </div>
        );
      })()}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">
            <div className="h-4 w-4 rounded-md bg-red-500 flex items-center justify-center text-[9px] font-bold text-white">{selected.size}</div>
            selected
          </span>
          <div className="h-3 w-px bg-white/[.08]" />

          {/* Add to list */}
          <div className="relative">
            <button
              onClick={() => { setListPickerOpen(o => !o); setAssignPickerOpen(false); }}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
            >
              <List size={12} /> Add to list
            </button>
            {listPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setListPickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-white/[.07] bg-[#0f1117] shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[.05]">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Add {selected.size} to list</p>
                  </div>
                  <div className="p-1">
                    {(listsQuery.data ?? []).length === 0 && (
                      <p className="px-3 py-3 text-xs text-white/25 text-center">No lists yet</p>
                    )}
                    {(listsQuery.data ?? []).map(l => (
                      <button key={l.id} onClick={() => { bulkAddToList(l.id); setListPickerOpen(false); }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-white/55 hover:bg-white/[.05] hover:text-white transition-colors">
                        <List size={11} className="text-white/25 shrink-0"/>
                        <span className="truncate">{l.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Assign to */}
          <div className="h-3 w-px bg-white/[.08]" />
          <div ref={assignPickerRef} className="relative">
            <button
              onClick={() => { setAssignPickerOpen(o => !o); setListPickerOpen(false); setAssignSearch(""); }}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
            >
              <UserCircle2 size={12} /> Assign to
            </button>
            {assignPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setAssignPickerOpen(false); setAssignSearch(""); }} />
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-white/[.07] bg-[#0f1117] shadow-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[.05]">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25 mb-2">Assign {selected.size} records</p>
                    <div className="relative">
                      <Search size={10} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/20"/>
                      <input
                        autoFocus
                        value={assignSearch}
                        onChange={e => setAssignSearch(e.target.value)}
                        placeholder="Search members…"
                        className="w-full bg-white/[.04] border border-white/[.06] rounded-lg pl-6 pr-3 py-1.5 text-xs text-white outline-none focus:border-white/[.12] placeholder:text-white/20"
                      />
                    </div>
                  </div>
                  <div className="p-1 max-h-48 overflow-y-auto">
                    {members
                      .filter(m => {
                        const lb = m.name || m.email;
                        return lb && typeof lb === "string" && isNaN(Number(lb)) && lb.trim().length > 0;
                      })
                      .filter(m => {
                        const lb = (m.name || m.email || "").toLowerCase();
                        return !assignSearch || lb.includes(assignSearch.toLowerCase());
                      })
                      .map(m => {
                        const label = m.name || m.email || "";
                        return (
                          <button key={m.id}
                            onClick={() => {
                              // Apply to all assignee/owner columns that exist
                              const assignCols = columns.filter(c => c.toLowerCase().includes("assign") || c.toLowerCase().includes("owner"));
                              const col = assignCols[0] ?? "assigned_to";
                              applyBulkEdit(col, label);
                              setAssignPickerOpen(false);
                              setAssignSearch("");
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-white/55 hover:bg-white/[.05] hover:text-white transition-colors">
                            <MemberAvatar name={label} size={5}/>
                            <div className="flex flex-col items-start min-w-0">
                              <span className="truncate text-white/70">{m.name || m.email}</span>
                              {m.name && m.email && <span className="text-[10px] text-white/25 truncate">{m.email}</span>}
                            </div>
                            {m.role && <span className="ml-auto text-[9px] text-white/20 capitalize shrink-0">{m.role}</span>}
                          </button>
                        );
                      })}
                    {members.filter(m => {
                      const lb = (m.name || m.email || "").toLowerCase();
                      return assignSearch ? lb.includes(assignSearch.toLowerCase()) : true;
                    }).length === 0 && (
                      <p className="px-3 py-3 text-xs text-white/25 text-center">No members found</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Bulk edit field */}
          {bulkEditCols.length > 0 && (
            <div ref={bulkEditRef} className="relative">
              <button
                onClick={() => setBulkEditField(f => f ? null : (bulkEditCols[0] ?? null))}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
              >
                <Check size={12}/> Edit field
              </button>
              {bulkEditField && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setBulkEditField(null)}/>
                  <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-xl border border-white/[.07] bg-[#0f1117] shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[.05] flex items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25 flex-1">Edit {selected.size} records</p>
                    </div>
                    {/* Column tabs */}
                    {bulkEditCols.length > 1 && (
                      <div className="flex gap-0.5 p-1.5 border-b border-white/[.05] overflow-x-auto">
                        {bulkEditCols.map(col => (
                          <button key={col} onClick={() => setBulkEditField(col)}
                            className={`rounded-md px-2 py-1 text-[10px] capitalize whitespace-nowrap transition-colors ${bulkEditField === col ? "bg-white/[.08] text-white" : "text-white/30 hover:text-white/60"}`}>
                            {col.replace(/_/g," ")}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="p-1 max-h-56 overflow-y-auto">
                      {(() => {
                        const col = bulkEditField;
                        const l = col.toLowerCase();
                        const customDef = customCols.find(c => c.key === col);
                        const isStageCol = l.includes("stage") || col === "deal_status" || customDef?.type === "stage";
                        const isStatusCol = col === "status" || customDef?.type === "status";
                        const isOwnerCol = l.includes("owner") || l.includes("assign") || customDef?.type === "assignee" || customDef?.type === "owner";
                        const isCountryCol = l.includes("country") || customDef?.type === "country";
                        const isTagCol = customDef?.type === "tag";
                        const validMembers = members.filter(m => { const lb = m.name || m.email; return lb && typeof lb === "string" && isNaN(Number(lb)) && lb.trim().length > 0; });

                        if (isStageCol) {
                          const opts = [...new Set([...DEFAULT_STAGE_OPTIONS, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
                          return opts.map(v => (
                            <button key={v} onClick={() => applyBulkEdit(col, v)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                              <span className={`h-2 w-2 rounded-full ${stageStyle(v).dot}`}/>{v}
                            </button>
                          ));
                        }
                        if (isStatusCol) {
                          const opts = [...new Set([...DEFAULT_STATUS_OPTIONS, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
                          return opts.map(v => (
                            <button key={v} onClick={() => applyBulkEdit(col, v)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                              <span className={`h-2 w-2 rounded-full ${stageStyle(v).dot}`}/>{v}
                            </button>
                          ));
                        }
                        if (isOwnerCol) {
                          return validMembers.map(m => {
                            const label = m.name || m.email || "";
                            return (
                              <button key={m.id} onClick={() => applyBulkEdit(col, label)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                                <MemberAvatar name={label} size={5}/>
                                <div className="flex flex-col items-start min-w-0">
                                  <span className="truncate text-white/70">{m.name || m.email}</span>
                                  {m.name && m.email && <span className="text-[10px] text-white/25">{m.email}</span>}
                                </div>
                              </button>
                            );
                          });
                        }
                        if (isCountryCol) {
                          const existing = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort();
                          return existing.length > 0 ? existing.map(v => (
                            <button key={v} onClick={() => applyBulkEdit(col, v)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                              {v}
                            </button>
                          )) : <p className="px-3 py-3 text-xs text-white/20 text-center">No country values yet</p>;
                        }
                        if (isTagCol) {
                          const existing = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))];
                          return existing.length > 0 ? existing.map(v => {
                            const tc = tagColor(v);
                            return (
                              <button key={v} onClick={() => applyBulkEdit(col, v)}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tc.bg}`}>{v}</span>
                              </button>
                            );
                          }) : <p className="px-3 py-3 text-xs text-white/20 text-center">No tags yet</p>;
                        }
                        // Generic text field
                        const existing = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].slice(0, 15);
                        return existing.length > 0 ? existing.map(v => (
                          <button key={v} onClick={() => applyBulkEdit(col, v)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors truncate">
                            {v}
                          </button>
                        )) : <p className="px-3 py-3 text-xs text-white/20 text-center">No values yet</p>;
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Bulk delete */}
          <button
            onClick={bulkDelete}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-red-400 transition-colors ml-auto"
          >
            <Trash2 size={12} /> Delete {selected.size}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-white/30 hover:text-white/60">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="record-scroll flex-1 min-h-0 overflow-x-auto overflow-y-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-[12px]">
          <thead className="sticky top-0 z-20">
            <tr>
              {/* Checkbox column */}
              <th className="w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06] sticky left-0 z-30">
                <div
                  onClick={toggleSelectAll}
                  className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${allSelected ? "bg-red-500 border-red-500" : someSelected ? "border-white/30 bg-white/[.06]" : "border-white/[.10] hover:border-white/30"}`}
                >
                  {allSelected && <Check size={10} className="text-white" strokeWidth={3}/>}
                  {!allSelected && someSelected && <div className="h-1.5 w-1.5 rounded-sm bg-white/60" />}
                </div>
              </th>
              {/* Record ID locked column — only when added via Add Column */}
              {hasRecordIdCol && (
                <th className="w-20 min-w-[80px] max-w-[80px] px-3 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06] sticky left-8 z-30">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-white/20">ID</span>
                </th>
              )}
              {orderedColumns.map((col, colIdx) => {
                const w = colWidths[col];
                return (
                  <th
                    key={col}
                    style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
                    className={`relative px-4 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06] select-none ${colIdx === 0 ? `sticky ${nameLeft} z-30 shadow-[2px_0_8px_rgba(0,0,0,0.4)]` : ""}`}
                    onDragOver={e => { e.preventDefault(); }}
                    onDrop={() => {
                      const from = dragColRef.current;
                      if (!from || from === col) return;
                      const base = orderedColumns;
                      const next = [...base];
                      const fi = next.indexOf(from);
                      const ti = next.indexOf(col);
                      if (fi < 0 || ti < 0) return;
                      next.splice(fi, 1);
                      next.splice(ti, 0, from);
                      setColOrder(next);
                      dragColRef.current = null;
                    }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setColCtxMenu({ col, x: e.clientX, y: e.clientY }); }}
                  >
                    <div className="flex items-center gap-1 min-w-0 w-full">
                      {/* Drag handle — only on non-first columns */}
                      {colIdx > 0 && (
                        <div
                          draggable
                          onDragStart={e => { e.stopPropagation(); dragColRef.current = col; }}
                          className="cursor-grab active:cursor-grabbing text-white/10 hover:text-white/30 shrink-0 pr-0.5"
                          title="Drag to reorder"
                        >
                          <GripVertical size={11}/>
                        </div>
                      )}
                      <button onClick={() => handleHeaderSort(col)}
                        className={`flex items-center gap-1.5 text-white/30 hover:text-white/70 transition-colors min-w-0 flex-1 ${isNumeric(col) ? "ml-auto" : ""}`}>
                        {getColumnIcon(col)}
                        <span className="text-[10px] font-semibold tracking-widest uppercase whitespace-nowrap">{col.replaceAll("_", " ")}</span>
                        <SortIcon col={col}/>
                      </button>
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={e => startResize(col, e, w ?? (e.currentTarget.parentElement?.offsetWidth ?? 160))}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group/resize z-10"
                    >
                      <div className="w-px h-4 bg-white/[.06] group-hover/resize:bg-red-400/50 transition-colors"/>
                    </div>
                  </th>
                );
              })}
              <th className="px-4 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06]">
                <button onClick={() => handleHeaderSort("__updated_at")} className="flex items-center gap-1.5 text-white/30 hover:text-white/70 transition-colors">
                  <Calendar size={11}/>
                  <span className="text-[10px] font-semibold tracking-widest uppercase">Updated</span>
                  <SortIcon col="__updated_at"/>
                </button>
              </th>
              {/* Add column */}
              <th
                ref={addColHeaderRef}
                className="w-10 px-3 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06] relative"
              >
                <button
                  onClick={() => setOpenPanel(p => p === "addcol" ? null : "addcol")}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-white/20 hover:text-white/60 hover:bg-white/[.05] transition-all"
                  title="Add column"
                >
                  <Plus size={13}/>
                </button>
                {openPanel === "addcol" && (
                  <AddColumnDropdown
                    onAdd={(key, type) => { saveCustomCols([...customCols, { key, type }]); setOpenPanel(null); }}
                    onClose={() => setOpenPanel(null)}
                    triggerRef={addColHeaderRef}
                    existingCols={allColumnsWithCustom}
                    existingCustomTypes={customCols.map(c => c.type)}
                  />
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 3} className="px-4 py-14 text-center text-xs text-white/20">
                  No results{(filterText || filterQuery) ? ` for "${filterText || filterQuery}"` : ""}
                </td>
              </tr>
            ) : (() => {
              // Build row list — optionally grouped
              const rowsToRender: React.ReactNode[] = [];
              if (groupByCol) {
                const groups = new Map<string, NodeRecord[]>();
                for (const r of sorted) {
                  const key = String(r.data[groupByCol] ?? "—");
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(r);
                }
                for (const [groupVal, groupRows] of groups) {
                  const ss = stageStyle(groupVal);
                  rowsToRender.push(
                    <tr key={`grp-${groupVal}`}>
                      <td colSpan={columns.length + 3} className="px-4 py-2 bg-white/[.015] border-y border-white/[.04]">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${ss.dot}`}/>
                          <span className="text-[11px] font-semibold text-white/50 capitalize">{groupVal}</span>
                          <span className="text-[10px] text-white/20 ml-1">{groupRows.length}</span>
                        </div>
                      </td>
                    </tr>
                  );
                  groupRows.forEach((record, rowIdx) => rowsToRender.push(renderRow(record, rowIdx)));
                }
              } else {
                sorted.forEach((record, rowIdx) => rowsToRender.push(renderRow(record, rowIdx)));
              }
              return rowsToRender;
            })()}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td className="w-8 min-w-[32px] max-w-[32px] bg-[#0d0f13] border-t border-t-zinc-800/60 sticky left-0 z-30" />
              {hasRecordIdCol && <td className="w-20 min-w-[80px] max-w-[80px] bg-[#0d0f13] border-t border-t-zinc-800/60 sticky left-8 z-30"/>}
              {orderedColumns.map((col, colIdx) => (
                <td
                  key={col}
                  className={`px-3 py-3 bg-[#0d0f13] border-t border-t-zinc-800/60 text-[12px] ${isNumeric(col) ? "text-right" : ""} ${colIdx === 0 ? `sticky ${nameLeft} z-30 shadow-[2px_0_8px_rgba(0,0,0,0.4)]` : "border-r border-r-zinc-800/15"}`}
                >
                  <div
                    ref={el => { if (el) calcWrapRefs.current.set(col, el); else calcWrapRefs.current.delete(col); }}
                    className={`inline-block ${isNumeric(col) ? "ml-auto" : ""}`}
                  >
                    {openCalcCol === col && (
                      <CalcDropdown col={col} current={calculations[col] ?? null}
                        onSelect={op => setCalculations(prev => ({ ...prev, [col]: op }))}
                        onClose={() => setOpenCalcCol(null)}
                        triggerRef={{ current: calcWrapRefs.current.get(col) ?? null }}
                      />
                    )}
                    {calculations[col] ? (
                      <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                        className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-white transition-colors tabular-nums font-mono">
                        <span className="text-zinc-600 uppercase text-[10px] tracking-wide mr-0.5">{calculations[col]}</span>
                        {calcResult(calculations[col], col, sorted)}
                      </button>
                    ) : (
                      <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                        className="flex items-center gap-1 text-[11px] text-zinc-700 hover:text-zinc-400 transition-colors group">
                        <Plus size={10} className="group-hover:text-red-400 transition-colors"/>
                        <span>Calculate</span>
                      </button>
                    )}
                  </div>
                </td>
              ))}
              <td className="px-3 py-3 text-[12px] text-zinc-700 tabular-nums bg-[#0d0f13] border-t border-t-zinc-800/60">{sorted.length} rows</td>
              <td className="bg-[#0d0f13] border-t border-t-zinc-800/60 border-l border-l-zinc-800/20 w-8"/>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    {/* Undo delete toast */}
    {cellTip && <CellTipPortal text={cellTip.text} x={cellTip.x} y={cellTip.y}/>}

    {undoToast && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-white/10 bg-[#1a1d24] px-4 py-3 shadow-2xl">
        <span className="text-sm text-white/70">Record deleted</span>
        <button
          onClick={undoDelete}
          className="flex items-center gap-1.5 rounded-lg bg-white/[.08] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/[.12] transition-colors"
        >
          <RotateCcw size={11} />
          Undo
        </button>
      </div>
    )}

    {/* Column right-click context menu */}
    {colCtxMenu && createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" onClick={() => setColCtxMenu(null)}/>
        <div
          className="fixed z-[9999] rounded-xl border border-white/[.08] bg-[#0f1117] py-1 shadow-xl min-w-[160px]"
          style={{ left: colCtxMenu.x, top: colCtxMenu.y }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600 border-b border-white/[.06] mb-1">
            {colCtxMenu.col.replaceAll("_", " ")}
          </div>
          <button
            onClick={() => {
              const col = colCtxMenu.col;
              // Hide data column OR remove custom column
              if (customCols.some(c => c.key === col)) {
                saveCustomCols(customCols.filter(c => c.key !== col));
              } else {
                toggleCol(col);
              }
              setColCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={12}/> Remove column
          </button>
          <button
            onClick={() => {
              toggleCol(colCtxMenu.col);
              setColCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-white/40 hover:bg-white/[.04] hover:text-white transition-colors"
          >
            <X size={12}/> Hide column
          </button>
        </div>
      </>,
      document.body
    )}
    </>
  );
}
