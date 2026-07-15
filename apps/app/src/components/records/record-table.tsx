import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useWorkspaceSuggestions } from "../../hooks/useWorkspaceSuggestions";
import { LogoMark } from "@/components/logo";
import {
  Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2,
  ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check, Search, X, Command, Settings2, ArrowUpDown, Download, GripVertical,
  UserCircle2, Type, ToggleLeft, ChevronRight, Trash2, RotateCcw, List,
  Rows3, BookmarkCheck, LayoutGrid, Percent, Link2,
  Briefcase, DollarSign, Heart, BookOpen, ShoppingCart, Cpu, Shield,
  Store, Factory, Home, Truck, Tv, Scale, Zap, Megaphone, Receipt,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiClient, apiFetch, getAuthHeaders } from "../../lib/api-client";
import { formatMoney } from "../../hooks/useCurrency";
import { parseNLPCommand } from "../../lib/ai-enrichment";
import { ErrorState, PageSkeleton } from "../ui/page-state";
import { FieldSelect } from "../ui/controls";
import { INDUSTRY_TAXONOMY } from "./record-detail";
import { LeadScoreBadge } from "./lead-score-badge";
import { AIHealthScoreCompact } from "../ai/ai-intelligence";
import { ProspectingModal } from "../ai/prospecting-modal";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string; lead_score?: number | null; lead_score_signals?: Record<string, unknown> | null; relationship_health?: number | null }
/** Columns that live as real node columns (not inside the data jsonb) — the AI
 *  scores. They must be surfaced + read from the record top level, not data[col]. */
const NODE_LEVEL_COLS = ["lead_score", "relationship_health"];
/** Read a cell value, transparently handling node-level columns. */
function cellValue(record: NodeRecord, col: string): unknown {
  return NODE_LEVEL_COLS.includes(col) ? (record as unknown as Record<string, unknown>)[col] : record.data[col];
}
/** Human column label — AI score columns get their landing-page branding. */
function colLabel(col: string): string {
  if (col === "lead_score") return "AI Score";
  if (col === "relationship_health") return "Relationship";
  return col.replace(/_/g, " ");
}
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
        className="max-w-sm rounded-sm px-3 py-2 text-[12px] text-[var(--text-secondary)] leading-relaxed shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
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
        className={`w-full min-w-0 btn-solid text-[12px] text-[var(--text-primary)] outline-none rounded px-1 py-0.5 border border-stone-600/60 -mx-1 ${numeric ? "text-right font-mono" : ""} ${className}`}
      />
    );
  }

  const shown = display(raw);
  return (
    <span
      onClick={startEdit}
      className={`block truncate cursor-text text-[12px] ${shown === "—" ? "text-stone-700 hover:text-stone-500" : ""} ${className}`}
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
          ? <span className="text-xs transition-colors" style={{ color: "var(--text-faint)" }}>+ category</span>
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
              {overflow > 0 && <span className="rounded-full bg-[var(--surface-hover)] border border-[var(--border-soft)] px-1.5 py-0.5 text-[9px] text-stone-500">+{overflow}</span>}
            </>
        }
      </div>

      {/* Picker portal */}
      {open && createPortal(
        <div style={{ position: "fixed", top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 4, left: ref.current?.getBoundingClientRect().left ?? 0, zIndex: 9999 }}
          className="w-52 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-2 pt-2 pb-1">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
              placeholder="Search categories…"
              className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-sm px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-soft)] placeholder:text-[var(--text-secondary)]"/>
          </div>
          <div className="p-1 max-h-56 overflow-y-auto">
            {filtered.map(t => {
              const active = selected.has(t.name);
              return (
                <button key={t.name} onClick={() => toggle(t)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-[var(--surface-hover)] transition-colors">
                  <span style={{ color: t.text }} className="shrink-0 opacity-70">
                    <IndustryIcon name={t.name} size={11}/>
                  </span>
                  <span className="flex-1 text-left text-xs text-[var(--text-secondary)]" style={{ color: active ? t.text : undefined }}>
                    {t.name}
                  </span>
                  {active && <Check size={10} style={{ color: t.border }} className="shrink-0"/>}
                </button>
              );
            })}
          </div>
          {cats.length > 0 && (
            <div className="border-t border-[var(--border-soft)] px-2 py-1.5">
              <button onClick={() => { onSave([]); }} className="text-[10px] text-[var(--text-secondary)] hover:text-stone-400 transition-colors">Clear all</button>
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
  if (lower.includes("name") || lower.includes("person") || lower.includes("contact")) return <User size={12} className="text-stone-600"/>;
  if (lower.includes("email"))  return <Mail size={12} className="text-stone-600"/>;
  if (lower.includes("phone"))  return <Phone size={12} className="text-stone-600"/>;
  if (lower.includes("company") || lower.includes("org")) return <Building2 size={12} className="text-stone-600"/>;
  if (lower.includes("date") || lower.includes("updated")) return <Calendar size={12} className="text-stone-600"/>;
  if (lower.includes("tag") || lower.includes("label") || lower.includes("status") || lower.includes("stage")) return <Tag size={12} className="text-stone-600"/>;
  if (lower.includes("url") || lower.includes("website") || lower.includes("link") || lower.includes("linkedin") || lower.includes("twitter")) return <Globe size={12} className="text-stone-600"/>;
  if (isNumeric(col)) return <Hash size={12} className="text-stone-600"/>;
  return <Database size={12} className="text-stone-600"/>;
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
      className={`fixed z-[9999] overflow-hidden rounded border border-stone-800/70 bg-[var(--surface-card)] shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-sm ${className}`}
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
      <span className="font-mono text-[10px] text-[var(--text-secondary)] tracking-wider select-all group-hover/id:text-[var(--text-secondary)] transition-colors">
        {sid}
      </span>
      <button
        onClick={copy}
        className="opacity-0 group-hover/id:opacity-100 transition-opacity text-stone-400 hover:text-stone-100"
        title="Copy ID"
      >
        {copied
          ? <Check size={9} className="text-[#2f9e6b]"/>
          : <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        }
      </button>
    </div>
  );
}

function RowLogo({ name, enriched }: { name: string; enriched?: boolean }) {
  const initials = String(name).split(" ").map(w => w[0] ?? "").filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  const colors = [
    "bg-stone-500/20 text-stone-400",
    "bg-[#717784]/15 text-[#717784]",
    "bg-[#2f9e6b]/15 text-[#2f9e6b]",
    "bg-stone-500/20 text-stone-400",
    "bg-[#c6892e]/15 text-[#c6892e]",
  ];
  const color = colors[(initials.charCodeAt(0) || 0) % colors.length];
  return (
    <div className="relative shrink-0">
      <div className={`h-6 w-6 rounded flex items-center justify-center text-[10px] font-semibold ${color}`}>
        {initials || "?"}
      </div>
      {enriched && (
        <div className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-white ring-1 ring-[var(--surface-card)] flex items-center justify-center">
          <LogoMark size={5} className="text-black"/>
        </div>
      )}
    </div>
  );
}

// ─── Stage / Status colours — semantic tones that actually READ (success is clearly green, problem is
// clearly red), while staying tasteful (soft tint fills, not neon). Tint + dual light/dark text keeps
// them legible in both themes. slate = in-flight/info, green = success, amber = attention, red = problem.
const TONE_PILL = {
  stone: { pill: "bg-stone-500/[.10] text-stone-600 border-stone-500/25 dark:text-stone-300",  dot: "bg-stone-500" },
  slate: { pill: "bg-[#5b6bb0]/12 text-[#47569c] border-[#5b6bb0]/30 dark:text-[#97a4e2]",      dot: "bg-[#5b6bb0]" },
  green: { pill: "bg-[#2f9e6b]/14 text-[#1f7d52] border-[#2f9e6b]/35 dark:text-[#56c78e]",      dot: "bg-[#2f9e6b]" },
  amber: { pill: "bg-[#c6892e]/15 text-[#9a6a1f] border-[#c6892e]/35 dark:text-[#dcac60]",      dot: "bg-[#c6892e]" },
  rose:  { pill: "bg-[#d1524a]/14 text-[#b2382f] border-[#d1524a]/35 dark:text-[#ed8b84]",      dot: "bg-[#d1524a]" },
} as const;
const STAGE_STYLES: Record<string, { pill: string; dot: string }> = {
  "Lead":         TONE_PILL.stone,
  "New":          TONE_PILL.stone,
  "Qualified":    TONE_PILL.slate,
  "In Progress":  TONE_PILL.amber,
  "Not Started":  TONE_PILL.stone,
  "Completed":    TONE_PILL.green,
  "Complete":     TONE_PILL.green,
  "Proposal":     TONE_PILL.slate,
  "Negotiation":  TONE_PILL.amber,
  "Closed Won":   TONE_PILL.green,
  "Closed Lost":  TONE_PILL.rose,
  "On Hold":      TONE_PILL.amber,
  "Cancelled":    TONE_PILL.rose,
  "Active":       TONE_PILL.green,
  "Churned":      TONE_PILL.rose,
};

export const DEFAULT_STAGE_OPTIONS = [
  "Lead","Qualified","Proposal","Negotiation","Closed Won","Closed Lost","On Hold",
];
export const DEFAULT_STATUS_OPTIONS = [
  "Not Started","In Progress","Completed","On Hold","Cancelled",
];

export function stageStyle(value: string) {
  // Unknown values fall back to the neutral stone tone (works in BOTH themes — the old dark-only
  // bg-stone-900 fallback was invisible/wrong in light mode).
  return STAGE_STYLES[value] ?? TONE_PILL.stone;
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
                {opt === value && <Check size={10} className="ml-auto text-stone-400 shrink-0"/>}
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
          {label}{current === op && <Check size={11} className="ml-auto text-stone-400"/>}
        </button>
      ))}
      {current && <>
        <div className="mx-2 my-1 border-t border-[var(--border-soft)]"/>
        <button onClick={() => { onSelect(null); onClose(); }} className="dropdown-item w-full text-stone-500">Clear</button>
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
      <div className="px-3 py-2 border-b border-[var(--border-soft)]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">Visible columns</p>
      </div>
      <div className="py-1 max-h-64 overflow-auto">
        {columns.map(col => {
          const visible = !hidden.has(col);
          return (
            <button key={col} onClick={() => onToggle(col)}
              className="dropdown-item w-full gap-2.5">
              <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${visible ? "border-stone-500 bg-stone-500" : "border-[var(--border-soft)] bg-transparent"}`}>
                {visible && <Check size={10} className="text-[var(--text-primary)]"/>}
              </div>
              <span className="capitalize">{colLabel(col)}</span>
              <GripVertical size={12} className="ml-auto text-stone-700"/>
            </button>
          );
        })}
      </div>
      <div className="border-t border-[var(--border-soft)] px-3 py-2">
        <button
          onClick={() => { columns.forEach(c => hidden.has(c) && onToggle(c)); onClose(); }}
          className="text-[11px] text-stone-500 hover:text-[var(--text-primary)] transition-colors"
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
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mb-2">Sort by</p>
        {rules.length === 0 && (
          <p className="text-xs text-stone-700 pb-1">No sorts applied</p>
        )}
        <div className="space-y-1.5">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <FieldSelect
                  value={rule.col}
                  onChange={v => updateRule(i, { col: v })}
                  ariaLabel="Sort column"
                  className="w-full capitalize"
                  options={columns.map(c => ({ value: c, label: colLabel(c) }))}
                />
              </div>
              <button
                onClick={() => updateRule(i, { dir: rule.dir === "asc" ? "desc" : "asc" })}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors whitespace-nowrap ${rule.dir === "asc" ? "bg-[#717784]/10 text-[#717784] border border-[#717784]/25" : "bg-[#c6892e]/10 text-[#c6892e] border border-[#c6892e]/25"}`}
              >
                {rule.dir === "asc" ? <><ChevronUp size={9}/>A→Z</> : <><ChevronDown size={9}/>Z→A</>}
              </button>
              <button onClick={() => onChange(rules.filter((_, idx) => idx !== i))} className="text-[var(--text-secondary)] hover:text-stone-400 transition-colors shrink-0">
                <X size={12}/>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--border-soft)] px-3 py-2 flex items-center justify-between">
        <button onClick={addRule} disabled={rules.length >= columns.length}
          className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-20">
          <Plus size={11}/> Add sort
        </button>
        {rules.length > 0 && (
          <button onClick={() => onChange([])} className="text-[11px] text-stone-400/50 hover:text-stone-400 transition-colors">
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
      <div className="px-3 py-2 border-b border-[var(--border-soft)]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">Import / Export</p>
      </div>
      <button onClick={exportCSV} className="dropdown-item w-full gap-2">
        <Download size={12} className="text-stone-400"/>
        Export as CSV
      </button>
      <button
        onClick={onClose}
        className="dropdown-item w-full gap-2 opacity-40 cursor-not-allowed"
        disabled
      >
        <Download size={12} className="text-stone-600"/>
        Import CSV <span className="ml-auto text-[10px]">soon</span>
      </button>
    </PortalDropdown>
  );
}

// ─── Owner cell ───────────────────────────────────────────────────────────────
interface Member { id: string; name: string; email: string; avatar_url?: string; role?: string }

// Deterministic avatar colour from name string
function avatarColor(name: string) {
  const colors = ["bg-stone-500","bg-[#c6892e]","bg-[#717784]","bg-[#2f9e6b]","bg-stone-600","bg-[#d1524a]","bg-stone-400","bg-[#2f9e6b]"];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function MemberAvatar({ name, size = 5 }: { name: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0] ?? "").filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <div className={`h-${size} w-${size} rounded-full ${avatarColor(name)} flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)] shrink-0`}>
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
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-hover)] transition-colors">
        {assigned ? (
          <>
            <MemberAvatar name={label} size={5}/>
            <span className="text-[11px] text-stone-300 truncate max-w-[72px]">{label}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-stone-600 hover:text-stone-400 transition-colors">
            <UserCircle2 size={13}/>
            <span>Assign</span>
          </span>
        )}
      </button>

      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => setOpen(false)} align="left" className="w-48">
          <div className="px-3 py-2 border-b border-[var(--border-soft)]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">Assign to</p>
          </div>
          {members.length === 0 && <p className="px-3 py-2 text-xs text-stone-600">No members yet</p>}
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
                {m.role && <span className="text-[9px] text-stone-600 capitalize shrink-0">{m.role}</span>}
                {isActive && <Check size={10} className="text-stone-400 shrink-0"/>}
              </button>
            );
          })}
          {value && <>
            <div className="mx-2 my-1 border-t border-[var(--border-soft)]"/>
            <button onClick={() => { onSelect(""); setOpen(false); }} className="dropdown-item w-full text-stone-500">
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
  { type: "status",    label: "Status",     hint: "Current state (New, In Progress, Done…)",   icon: ToggleLeft,   color: "text-[#717784]"     },
  { type: "stage",     label: "Stage",      hint: "Pipeline stage (Lead, Proposal, Closed…)",  icon: ChevronRight, color: "text-stone-400"  },
  { type: "assignee",  label: "Assignee",   hint: "Team member responsible for this record",   icon: UserCircle2,  color: "text-[#2f9e6b]" },
  { type: "owner",     label: "Owner",      hint: "Deal owner or account owner",               icon: User,         color: "text-[#c6892e]"   },
  { type: "tag",       label: "Tag",        hint: "Label or category tag (multi-select)",      icon: Tag,          color: "text-[#d1524a]"    },
  { type: "category",  label: "Category",   hint: "Pick a category with icon",                 icon: LayoutGrid,   color: "text-[#c6892e]"  },
  { type: "country",   label: "Country",    hint: "Country picker from world countries list",  icon: Globe,        color: "text-[#2f9e6b]"    },
  { type: "record_id", label: "Record ID",  hint: "Auto-generated unique ID for this record",  icon: Hash,         color: "text-[var(--text-secondary)]"    },
  { type: "text",      label: "Text",       hint: "Free text field",                           icon: Type,         color: "text-stone-400"   },
  { type: "number",    label: "Number",     hint: "Numeric value, amount, count",              icon: Hash,         color: "text-[#717784]"    },
  { type: "date",      label: "Date",       hint: "Date or deadline",                          icon: Calendar,     color: "text-[#d1524a]"    },
  { type: "relation",  label: "Relation",   hint: "Link to a record in another object",        icon: Link2,        color: "text-[#717784]"    },
  { type: "finance_billed",      label: "Finance · Billed",      hint: "Total invoiced to this client (computed, base currency)", icon: Receipt, color: "text-[#2f9e6b]" },
  { type: "finance_outstanding", label: "Finance · Outstanding", hint: "Unpaid invoices for this client (computed, base currency)", icon: Receipt, color: "text-[#c6892e]" },
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
  relation:  "Linked Record",
  finance_billed:      "Billed",
  finance_outstanding: "Outstanding",
};

// Types where only one instance makes sense
const SINGLETON_TYPES = new Set(["assignee","owner","status","stage","record_id","country"]);

function AddColumnDropdown({ onAdd, onClose, triggerRef, existingCols, existingCustomTypes }: {
  onAdd: (name: string, type: string, meta?: Record<string, string>) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | HTMLTableCellElement | null>;
  existingCols: string[];
  existingCustomTypes: string[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColPresetType>("text");
  const [hovered, setHovered] = useState<ColPresetType | null>(null);
  const [relatedTarget, setRelatedTarget] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data: objectDefs = [] } = useQuery<{ id: string; slug: string; label: string }[]>({
    queryKey: ["object-defs"],
    queryFn: () => apiClient.get("/objects"),
    staleTime: 60_000,
    enabled: type === "relation",
  });

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
    const meta = type === "relation" && relatedTarget ? { relatedObjectType: relatedTarget } : undefined;
    onAdd(slug, type, meta);
    onClose();
  }

  const activePreset = COLUMN_TYPE_PRESETS.find(p => p.type === (hovered ?? type))!;

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="right" className="w-64">
      <div className="px-3 pt-3 pb-2 border-b border-[var(--border-soft)]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mb-2">Add column</p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          placeholder="Column name…"
          className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30"
        />
      </div>
      <div className="py-1">
        {COLUMN_TYPE_PRESETS.map(({ type: t, label, icon: Icon, color }) => {
          const taken = isTypeTaken(t);
          return (
            <button key={t} onClick={() => !taken && pickType(t)}
              onMouseEnter={() => setHovered(t)} onMouseLeave={() => setHovered(null)}
              disabled={taken}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors ${taken ? "opacity-30 cursor-not-allowed" : type === t ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-stone-400 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`}>
              <Icon size={13} className={taken ? "text-[var(--text-secondary)]" : color}/>
              <span className="font-medium">{label}</span>
              {taken && <span className="ml-auto text-[9px] text-[var(--text-secondary)]">already added</span>}
              {!taken && type === t && <Check size={10} className="ml-auto text-stone-400 shrink-0"/>}
            </button>
          );
        })}
      </div>
      {activePreset && (
        <div className="px-3 py-2 border-t border-[var(--border-soft)] text-[10px] text-stone-600">
          {activePreset.hint}
        </div>
      )}
      {type === "relation" && (
        <div className="px-3 py-2 border-t border-[var(--border-soft)]">
          <p className="text-[10px] font-semibold text-stone-600 mb-1.5 uppercase tracking-wider">Link to object</p>
          <div className="flex flex-col gap-1">
            {objectDefs.map(obj => (
              <button key={obj.slug} onClick={() => setRelatedTarget(obj.slug)}
                className={`flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs transition-colors ${relatedTarget === obj.slug ? "bg-[#717784]/12 text-[#717784] border border-[#717784]/30" : "text-stone-400 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] border border-transparent"}`}>
                <Link2 size={11} className={relatedTarget === obj.slug ? "text-[#717784]" : "text-stone-600"}/>
                {obj.label || obj.slug}
                {relatedTarget === obj.slug && <Check size={10} className="ml-auto text-[#717784]"/>}
              </button>
            ))}
            {objectDefs.length === 0 && <p className="text-[10px] text-[var(--text-secondary)]">No other objects</p>}
          </div>
        </div>
      )}
      <div className="px-3 pb-3 pt-2 border-t border-[var(--border-soft)]">
        <button onClick={submit}
          className="w-full rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
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

  // Profile-aware NLP examples (from the workspace's object nouns/region); generic fallback.
  const { data: wsSuggestions } = useWorkspaceSuggestions();
  const FALLBACK_EXAMPLES = [
    "Sort by most recent and show the total",
    "Filter by region and sort by value",
    "Show records with no activity in 30 days",
    "Group by status and count",
  ];
  const examples = wsSuggestions?.table_examples?.length ? wsSuggestions.table_examples : FALLBACK_EXAMPLES;
  const placeholder = examples[0] ?? FALLBACK_EXAMPLES[0];

  const apply = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setStatus("thinking");
    try {
      const headers = await getAuthHeaders();
      const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
      const res = await apiFetch(`${apiUrl}/api/v1/generate/nlp`, {
        method: "POST",
        headers,
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

  const statusColors = { idle: "border-stone-800/50 bg-stone-900/20", thinking: "border-stone-700/50 bg-stone-800/30", applied: "border-stone-600/50 bg-stone-800/40", error: "border-stone-700/40 bg-stone-900/30" };

  return (
    <div className={`rounded-sm border px-3 py-2 transition-all duration-300 ${statusColors[status]}`}>
      <div className="flex items-center gap-2">
        <LogoMark size={13} className={`shrink-0 transition-colors ${status === "thinking" ? "text-stone-400 animate-pulse" : status === "applied" ? "text-stone-300" : "text-stone-600"}`}/>
        <input ref={inputRef} value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") apply(); if (e.key === "Escape") { setValue(""); onClear(); setStatus("idle"); } }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          {hasActive && <button onClick={() => { setValue(""); onClear(); setStatus("idle"); }} className="text-[10px] text-stone-600 hover:text-stone-400 transition-colors">Clear</button>}
          <kbd className="flex items-center gap-0.5 rounded border border-[var(--border-soft)] bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-stone-600"><Command size={8}/><span>⇧K</span></kbd>
          <button onClick={apply} disabled={!value.trim() || status === "thinking"}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1 text-[11px] text-stone-400 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40">
            {status === "thinking" ? "…" : "Run"}
          </button>
        </div>
      </div>
      {status === "applied" && lastApplied && <p className="mt-1.5 text-[10px] text-stone-400/80 flex items-center gap-1"><Check size={9}/> Applied: {lastApplied}</p>}
      {status === "error" && <p className="mt-1.5 text-[10px] text-stone-400/80">Couldn't parse — try "sort by ARR desc" or "filter by USA"</p>}
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
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
        {value ? <><Globe size={11} className="text-[#2f9e6b]/70 shrink-0"/>{value}</> : <span className="text-stone-700 hover:text-stone-500">— select country</span>}
      </button>
      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => { setOpen(false); setSearch(""); }} align="left" className="w-52">
          <div className="px-2 py-1.5 border-b border-[var(--border-soft)]">
            <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search country…"
              className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none"/>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {value && <button onClick={() => { onSelect(""); setOpen(false); setSearch(""); }} className="dropdown-item w-full text-stone-500 text-xs">Clear</button>}
            {filtered.slice(0, 80).map(c => (
              <button key={c} onClick={() => { onSelect(c); setOpen(false); setSearch(""); }}
                className={`dropdown-item w-full text-xs ${c === value ? "dropdown-item-active" : ""}`}>
                {c}{c === value && <Check size={10} className="ml-auto text-stone-400 shrink-0"/>}
              </button>
            ))}
            {filtered.length > 80 && <p className="px-3 py-1 text-[10px] text-stone-700">Type to narrow…</p>}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Tag cell (multi-tag, workspace-synced) ───────────────────────────────────
interface WorkspaceTag { id: string; name: string; color: string }

const PRESET_TAG_COLORS = [
  "var(--accent)","#ec4899","#c6892e","#2f9e6b","#717784",
  "#d1524a","var(--accent)","var(--accent)","#f97316","#84cc16",
];

// tagColor kept for backwards compat with filter badges
function tagColor(val: string) {
  const TAG_COLORS = [
    { bg: "bg-[#717784]/12 border-[#717784]/30 text-[#717784]", dot: "bg-[#717784]" },
    { bg: "bg-stone-500/15 border-stone-500/30 text-stone-300", dot: "bg-stone-400" },
    { bg: "bg-[#2f9e6b]/12 border-[#2f9e6b]/30 text-[#2f9e6b]", dot: "bg-[#2f9e6b]" },
    { bg: "bg-[#c6892e]/12 border-[#c6892e]/30 text-[#c6892e]", dot: "bg-[#c6892e]" },
    { bg: "bg-[#d1524a]/12 border-[#d1524a]/30 text-[#d1524a]", dot: "bg-[#d1524a]" },
    { bg: "bg-[#d1524a]/12 border-[#d1524a]/30 text-[#d1524a]", dot: "bg-[#d1524a]" },
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
          ? <span className="text-stone-700 text-xs hover:text-stone-500 transition-colors">+ tag</span>
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
          className="w-52 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-2 pt-2 pb-1">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && canCreate) createAndAdd(); if (e.key === "Escape") setOpen(false); }}
              placeholder="Search or create tag…"
              className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-sm px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-stone-500/40 placeholder:text-[var(--text-secondary)]"/>
          </div>
          <div className="max-h-40 overflow-y-auto p-1">
            {filtered.map(tag => {
              const active = nodeTagIds.has(tag.id);
              return (
                <button key={tag.id} onClick={() => active ? removeTag.mutate(tag.id) : addTag.mutate(tag.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-[var(--surface-hover)] transition-colors">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }}/>
                  <span className="flex-1 text-left text-xs text-[var(--text-secondary)]">{tag.name}</span>
                  {active && <Check size={10} className="text-stone-400 shrink-0"/>}
                </button>
              );
            })}
            {filtered.length === 0 && !canCreate && <p className="text-xs text-[var(--text-secondary)] text-center py-2">No tags found</p>}
          </div>
          {canCreate && (
            <div className="border-t border-[var(--border-soft)] p-2 space-y-1.5">
              <div className="flex gap-1">
                {PRESET_TAG_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="h-4 w-4 rounded-full shrink-0 transition-all"
                    style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px var(--surface-card), 0 0 0 3px ${c}` : undefined }}/>
                ))}
              </div>
              <button onClick={createAndAdd} disabled={creating}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-stone-500/10 hover:text-stone-300 transition-colors disabled:opacity-40">
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
        className="w-full max-w-[100px] bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none font-mono"/>
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] tabular-nums transition-colors text-left w-full">
      {displayVal ?? <span className="text-stone-700">— number</span>}
    </button>
  );
}

// ─── Relation cell — link a record to another object record ──────────────────
type RelationValue = { id: string; label: string } | null;

function RelationCell({ value, relatedObjectType, onSave }: {
  value: unknown;
  relatedObjectType?: string;
  onSave: (v: RelationValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const current: RelationValue = value && typeof value === "object" && !Array.isArray(value)
    ? (value as RelationValue)
    : null;

  const { data: objectDefs = [] } = useQuery<{ id: string; slug: string; label: string }[]>({
    queryKey: ["object-defs"],
    queryFn: () => apiClient.get("/objects"),
    staleTime: 60_000,
  });

  const targetSlug = relatedObjectType || objectDefs[0]?.slug || "";
  const { data: targetRecords = [] } = useQuery<{ id: string; data: Record<string, unknown> }[]>({
    queryKey: ["relation-records", targetSlug],
    queryFn: () => apiClient.get(`/nodes?object_type=${targetSlug}&limit=1000`),
    enabled: open && !!targetSlug,
    staleTime: 30_000,
  });

  function getLabel(r: { id: string; data: Record<string, unknown> }) {
    return String(r.data["name"] ?? r.data["title"] ?? r.data["company_name"] ?? r.id.slice(0, 8));
  }

  const filtered = targetRecords.filter(r =>
    getLabel(r).toLowerCase().includes(search.toLowerCase())
  );

  function openDropdown() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
    setSearch("");
  }

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative">
      <button ref={btnRef} onClick={openDropdown}
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors max-w-[140px] truncate">
        {current
          ? <><Link2 size={10} className="text-[#717784] shrink-0"/><span className="truncate">{current.label}</span></>
          : <span className="text-stone-700">— link record</span>
        }
      </button>
      {open && createPortal(
        <div ref={ref} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-56 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-2xl py-1">
          <div className="px-2 pb-1 pt-1">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${targetSlug || "records"}…`}
              className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-sm px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#717784]/50 placeholder:text-[var(--text-secondary)]"/>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {current && (
              <button onClick={() => { onSave(null); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-400/70 hover:bg-[var(--surface-hover)] hover:text-stone-400 transition-colors">
                <X size={10}/> Remove link
              </button>
            )}
            {filtered.map(r => {
              const lbl = getLabel(r);
              const isActive = current?.id === r.id;
              return (
                <button key={r.id} onClick={() => { onSave({ id: r.id, label: lbl }); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-hover)] ${isActive ? "text-[#717784]" : "text-[var(--text-secondary)]"}`}>
                  <Link2 size={10} className={isActive ? "text-[#717784]" : "text-stone-600"}/>
                  <span className="truncate flex-1 text-left">{lbl}</span>
                  {isActive && <Check size={10} className="text-[#717784] shrink-0"/>}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] text-center py-3">No records found</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
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
        className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs transition-colors whitespace-nowrap ${activeValue ? "border-stone-500/30 bg-stone-600/10 text-stone-300" : "border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-soft)]"}`}
      >
        {s && <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`}/>}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mr-0.5">{col.replaceAll("_", " ")}</span>
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
                {isActive && <Check size={10} className="text-stone-400 shrink-0"/>}
              </button>
            );
          })}
          {activeValue && <>
            <div className="mx-2 my-1 border-t border-[var(--border-soft)]"/>
            <button onClick={() => { onSelect(activeValue); setOpen(false); }} className="dropdown-item w-full text-stone-500">Clear</button>
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
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}&limit=1000`),
  });

  const records = query.data ?? [];

  const allColumns = useMemo(() => {
    const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))))
      .filter(k => !HIDDEN_DATA_COLS.has(k));
    const nameKey = allKeys.find(k => k.toLowerCase() === "name");
    const rest = allKeys.filter(k => k.toLowerCase() !== "name");
    const base = (nameKey ? [nameKey, ...rest] : allKeys).slice(0, 8);
    // Surface node-level AI columns (lead_score / relationship_health) when any
    // record actually carries one — they aren't in the data jsonb, so the key
    // scan above never finds them.
    const nodeCols = NODE_LEVEL_COLS.filter(c => records.some(r => (r as NodeRecord)[c as "lead_score"] != null));
    return [...base, ...nodeCols.filter(c => !base.includes(c))];
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
  const [customCols, setCustomCols] = useState<{ key: string; type: string; meta?: Record<string, string> }[]>(() => {
    try { return JSON.parse(localStorage.getItem(customColsKey) ?? "[]"); } catch { return []; }
  });
  // Reload when objectType changes (navigating between People/Deals/etc.)
  useEffect(() => {
    try { setCustomCols(JSON.parse(localStorage.getItem(`mondaily_custom_cols_${objectType}`) ?? "[]")); }
    catch { setCustomCols([]); }
  }, [objectType]);

  function saveCustomCols(next: { key: string; type: string; meta?: Record<string, string> }[]) {
    setCustomCols(next);
    localStorage.setItem(`mondaily_custom_cols_${objectType}`, JSON.stringify(next));
  }

  // Record-ID column is handled separately (locked between checkbox and name)
  const hasRecordIdCol = customCols.some(c => c.type === "record_id");
  // Non-ID custom cols go into the regular column flow
  const regularCustomCols = customCols.filter(c => c.type !== "record_id");

  // Finance rollup — one query powers the "Finance · Billed/Outstanding" computed columns for the
  // whole sheet (no per-row fetch). Only runs when such a column is actually added.
  const hasFinanceCol = customCols.some(c => c.type === "finance_billed" || c.type === "finance_outstanding");
  const financeRollup = useQuery({
    queryKey: ["invoices-rollup"],
    queryFn: () => apiClient.get<{ base: string; clients: Record<string, { billed: number; collected: number; outstanding: number; count: number }> }>("/invoices/rollup"),
    enabled: hasFinanceCol,
    staleTime: 60_000,
  });

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
        const ar = col === "__updated_at" ? a.updated_at : cellValue(a, col);
        const br = col === "__updated_at" ? b.updated_at : cellValue(b, col);
        const av = col === "__updated_at" ? a.updated_at : display(ar);
        const bv = col === "__updated_at" ? b.updated_at : display(br);
        const an = typeof ar === "number" ? ar : parseFloat(av.replace(/[^0-9.-]/g, ""));
        const bn = typeof br === "number" ? br : parseFloat(bv.replace(/[^0-9.-]/g, ""));
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }, [filtered, sortRules, quickSortCol, quickSortDir]);

  function SortIcon({ col }: { col: string }) {
    const rule = sortRules.find(r => r.col === col);
    if (rule) return rule.dir === "asc" ? <ChevronUp size={10} className="text-stone-400 ml-1 shrink-0"/> : <ChevronDown size={10} className="text-stone-400 ml-1 shrink-0"/>;
    if (quickSortCol === col) return quickSortDir === "asc" ? <ChevronUp size={10} className="text-stone-400 ml-1 shrink-0"/> : <ChevronDown size={10} className="text-stone-400 ml-1 shrink-0"/>;
    return <ChevronsUpDown size={10} className="text-stone-700 ml-1 shrink-0"/>;
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
    if (val === "Closed Won" || val === "Complete" || val === "Completed" || val === "Active") return "border-l-2 border-l-[#2f9e6b]/50";
    if (val === "Closed Lost" || val === "Cancelled" || val === "Churned") return "border-l-2 border-l-rose-500/30";
    if (val === "In Progress" || val === "Negotiation") return "border-l-2 border-l-[#c6892e]/40";
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
  const [prospectOpen, setProspectOpen] = useState(false);
  const prospectSeedQuery = useMemo(() => {
    const names = records
      .filter(r => selected.has(r.id))
      .map(r => String(r.data.name ?? r.data.company ?? r.data.full_name ?? r.data.title ?? "").trim())
      .filter(Boolean)
      .slice(0, 5);
    return names.length ? `Find ${objectType}s similar to: ${names.join(", ")}` : "";
  }, [records, selected, objectType]);

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
    await Promise.all(ids.map(id => apiClient.delete(`/nodes/${id}`).catch((e) => console.error("[bg-task] swallowed error:", e))));
  }

  async function bulkAddToList(listId: string) {
    const results = await Promise.allSettled([...selected].map(id => apiClient.post(`/lists/${listId}/entries`, { node_id: id })));
    const failed = results.filter(r => r.status === "rejected").length;
    const succeeded = results.length - failed;
    setSelected(new Set());
    // Real UI feedback (previously this only logged to the console, so the user got nothing).
    if (succeeded > 0 && failed === 0) showFlash(`Added ${succeeded} record${succeeded === 1 ? "" : "s"} to the list.`, "ok");
    else if (succeeded > 0 && failed > 0) showFlash(`Added ${succeeded}, but ${failed} couldn't be added — the list type may not match.`, "warn");
    else if (failed > 0) showFlash(`Couldn't add ${failed} record${failed === 1 ? "" : "s"} — the list type may not match.`, "warn");
  }

  const [filterSearchOpen, setFilterSearchOpen] = useState(false);
  const filterSearchRef = useRef<HTMLInputElement>(null);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const assignPickerRef = useRef<HTMLDivElement>(null);
  const listsQuery = useQuery({
    queryKey: ["lists", objectType],
    queryFn: () => apiClient.get<{ id: string; name: string; object_type: string }[]>(`/lists?object_type=${encodeURIComponent(objectType)}`),
    enabled: listPickerOpen,
  });

  const [undoToast, setUndoToast] = useState<{ record: NodeRecord; timer: ReturnType<typeof setTimeout> } | null>(null);
  // Lightweight transient feedback toast (bulk add-to-list results, etc.). Auto-dismisses.
  const [flash, setFlash] = useState<{ msg: string; kind: "ok" | "warn" } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showFlash(msg: string, kind: "ok" | "warn") {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ msg, kind });
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  }

  function deleteRow(record: NodeRecord) {
    // Clear any existing undo toast first
    if (undoToast) {
      clearTimeout(undoToast.timer);
      apiClient.delete(`/nodes/${undoToast.record.id}`).catch((e) => console.error("[bg-task] swallowed error:", e));
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
    const val = cellValue(record, col);
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

    // Finance columns — computed, read-only, from the one-shot rollup keyed by the record's name.
    if (customDef?.type === "finance_billed" || customDef?.type === "finance_outstanding") {
      const roll = financeRollup.data;
      const name = String(record.data.name ?? "").trim();
      const entry = roll?.clients?.[name];
      const value = customDef.type === "finance_billed" ? entry?.billed : entry?.outstanding;
      const tone = customDef.type === "finance_billed" ? "#2f9e6b" : "#c6892e";
      return (
        <div className="px-2 py-1.5 text-right text-[12px] tabular-nums" style={{ color: value ? tone : "var(--text-faint)" }}>
          {roll ? (value ? formatMoney(value, roll.base) : "—") : (hasFinanceCol && financeRollup.isLoading ? "…" : "—")}
        </div>
      );
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
        <button className="text-stone-700 text-xs hover:text-stone-400 transition-colors"
          onClick={() => saveCell(record, col, defaults[0]!)}>
          — set {customDef.type}
        </button>
      );
      return <StagePill value={shown} options={existingOptions} onSelect={v => saveCell(record, col, v)}/>;
    }

    // Relation column — link to a record in another object
    if (customDef?.type === "relation") {
      return <RelationCell value={val} relatedObjectType={customDef.meta?.relatedObjectType} onSave={v => saveCell(record, col, v as object)}/>;
    }

    // Custom column — empty by default
    if (customDef) return <span className="text-stone-700 text-xs">—</span>;

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

    // AI relationship/asset health — same real field record-detail.tsx shows,
    // surfaced here too when the column is configured.
    if (col === "relationship_health") return <AIHealthScoreCompact score={val != null ? Number(val) : null} label="Relationship health"/>;

    // Stage / Status pill — handles empty/null values too (no longer falls through to text box)
    if (col.toLowerCase().includes("stage") || col === "status" || col === "deal_status") {
      const isStatusCol = col === "status" && !col.toLowerCase().includes("stage");
      const defaults = isStatusCol ? DEFAULT_STATUS_OPTIONS : DEFAULT_STAGE_OPTIONS;
      const existingOptions = [...new Set([...defaults, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
      const shown = String(val ?? "");
      if (!shown) return (
        <button className="text-stone-700 text-xs hover:text-stone-400 transition-colors"
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
      return <span className="text-[var(--text-secondary)] text-[10px]">image</span>;
    }

    // Long text fields — truncate with tooltip
    const isLong = col === "description" || col === "bio" || col === "notes" || col === "summary" || col === "address";
    if (isLong && typeof val === "string" && val.length > 60) {
      return (
        <span className="block truncate text-[var(--text-secondary)] text-[11px]">
          {val}
        </span>
      );
    }

    // URLs — show as clickable link, not raw
    if (typeof val === "string" && (col === "linkedin" || col === "twitter" || col === "website" || col === "domain") && val.startsWith("http")) {
      return (
        <a href={val} target="_blank" rel="noreferrer" className="text-[#717784] hover:text-[var(--text-primary)] text-[11px] underline underline-offset-2 truncate block max-w-[140px]" onClick={e => e.stopPropagation()}>
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
          className="flex-1 font-medium text-[var(--text-primary)] truncate"
        />
        {isEnriched && (
          <span className="inline-flex items-center gap-0.5 rounded-sm bg-stone-800/60 border border-stone-700/50 px-1.5 py-0.5 text-[9px] font-medium text-stone-400 shrink-0">
            <LogoMark size={8}/> AI
          </span>
        )}
        <Link to={`/objects/${objectType}/${record.id}`} className="shrink-0 opacity-0 group-hover:opacity-100 text-stone-600 hover:text-stone-300 transition-colors">
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
    <div className="mt-4 mx-6 flex min-h-64 flex-col items-center justify-center rounded-sm border border-stone-800/40 bg-[var(--surface-hover)] px-6 text-center">
      <Database className="mb-3 text-stone-700" size={26}/>
      <h2 className="text-sm font-medium text-stone-300">No {objectType} yet</h2>
      <p className="mt-1 max-w-sm text-sm text-stone-600">Create a record to get started.</p>
    </div>
  );

  function renderRow(record: NodeRecord, rowIdx: number) {
    return (
      <tr
        key={record.id}
        className={`group transition-colors ${selected.has(record.id) ? "bg-stone-50 dark:bg-stone-500/[.05]" : rowIdx % 2 === 1 ? "bg-stone-50/60 dark:bg-[var(--surface-hover)]" : "bg-white dark:bg-transparent"} hover:bg-stone-50 dark:hover:bg-[var(--surface-hover)] ${rowAccent(record)}`}
      >
        <td className={`w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 border-b border-b-[#edf0f5] dark:border-b-white/[.04] sticky left-0 z-10 ${selected.has(record.id) ? "bg-stone-50 group-hover:bg-stone-100 dark:bg-[#130d0d] dark:group-hover:bg-[#170f0f]" : "bg-white group-hover:bg-[#f8fbff] dark:bg-[var(--surface-page)] dark:group-hover:bg-[var(--surface-card)]"}`}>
          <div
            onClick={() => toggleSelectRow(record.id)}
            className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${selected.has(record.id) ? "bg-stone-500 border-stone-500" : "border-stone-300 opacity-0 group-hover:opacity-100 hover:border-stone-400 dark:border-[var(--border-soft)] dark:hover:border-[var(--border-soft)]"}`}
          >
            {selected.has(record.id) && <Check size={10} className="text-[var(--text-primary)]" strokeWidth={3}/>}
          </div>
        </td>
        {hasRecordIdCol && (
          <td className={`w-20 min-w-[80px] max-w-[80px] px-3 py-2.5 border-b border-b-[#edf0f5] dark:border-b-white/[.04] sticky left-8 z-10 ${selected.has(record.id) ? "bg-stone-50 group-hover:bg-stone-100 dark:bg-[#130d0d] dark:group-hover:bg-[#170f0f]" : "bg-white group-hover:bg-[#f8fbff] dark:bg-[var(--surface-page)] dark:group-hover:bg-[var(--surface-card)]"}`}>
            <RecordIdCell id={record.id}/>
          </td>
        )}
        {orderedColumns.map((col, colIdx) => (
          <td
            key={col}
            className={`px-4 py-2.5 text-stone-900 dark:text-[var(--text-secondary)] border-b border-b-[#edf0f5] dark:border-b-white/[.04] overflow-hidden max-w-[240px] ${isNumeric(col) ? "text-right tabular-nums font-mono text-stone-500 dark:text-[var(--text-secondary)]" : ""} ${colIdx === 0 ? `sticky ${nameLeft} z-10 shadow-[2px_0_8px_rgba(15,23,42,0.06)] dark:shadow-[2px_0_8px_rgba(0,0,0,0.4)] font-medium text-stone-900 dark:text-[var(--text-secondary)] ` + (selected.has(record.id) ? "bg-stone-50 group-hover:bg-stone-100 dark:bg-[#130d0d] dark:group-hover:bg-[#170f0f]" : "bg-white group-hover:bg-[#f8fbff] dark:bg-[var(--surface-page)] dark:group-hover:bg-[var(--surface-card)]") : ""}`}
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
        <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-stone-500 dark:text-[var(--text-secondary)] tabular-nums border-b border-b-[#edf0f5] dark:border-b-white/[.04]">
          {fmtDate(record.updated_at)}
        </td>
        <td className="border-b border-b-[#edf0f5] dark:border-b-white/[.04] w-10 px-2">
          <button
            onClick={() => deleteRow(record)}
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-6 w-6 rounded-sm text-stone-400 dark:text-stone-400 hover:text-stone-600 dark:hover:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-500/10 transition-all"
            title="Delete row"
          >
            <Trash2 size={12}/>
          </button>
        </td>
      </tr>
    );
  }

  // Toolbar button styles — clean clickable pills with real borders in light mode
  const TB = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-medium transition-colors duration-150 select-none border";
  const TB_IDLE = `${TB} border-[#dfe3ea] bg-white text-[#374151] hover:bg-[#f8fafc] hover:border-[#cbd5e1] dark:border-transparent dark:bg-transparent dark:text-stone-300 dark:hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-hover)] dark:hover:border-[var(--border-soft)]`;
  const TB_ON   = `${TB} border-stone-300 bg-stone-200 text-stone-900 dark:border-[var(--border-soft)] dark:text-[var(--text-primary)] dark:bg-[var(--surface-hover)]`;
  const TB_DOT  = "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-stone-200 px-1 text-[9px] font-semibold text-[var(--accent)] dark:bg-[var(--surface-hover)] dark:text-stone-300";
  const TB_DOT_ACTIVE = "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-stone-500/70 px-1 text-[9px] font-semibold text-[var(--text-primary)]";

  return (
    <>
    <section className="flex flex-col h-full bg-white dark:bg-transparent">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-[#eef2f7] dark:border-[var(--border-soft)] shrink-0">
        {(filterText || filterQuery || quickSortCol || sortRules.length > 0) && (
          <span className="text-[11px] text-[#9ca3af] dark:text-[var(--text-secondary)] tabular-nums mr-2">{sorted.length} of {records.length}</span>
        )}
        {nlpActive && (
          <span className="flex items-center gap-1 rounded-md border border-stone-700/60 bg-stone-800/40 px-2 py-1 text-[10px] text-stone-400 mr-1">
            <LogoMark size={9}/> AI active
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

          <div className="w-px h-3 bg-[var(--surface-hover)] mx-1"/>

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
            {groupByCol && <span className={TB_DOT}>{colLabel(groupByCol)}</span>}
          </button>

          <div className="w-px h-3 bg-[var(--surface-hover)] mx-1"/>

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
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] shrink-0 mr-2">Columns</span>
          {allColumnsWithCustom.map(col => {
            const visible = !hiddenCols.has(col);
            return (
              <button key={col} onClick={() => toggleCol(col)}
                className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] transition-colors shrink-0 border ${visible ? "border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-secondary)]" : "border-[var(--border-soft)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-soft)]"}`}>
                {visible && <Check size={9} className="text-stone-400 shrink-0"/>}
                <span className="capitalize">{colLabel(col)}</span>
              </button>
            );
          })}
          <button onClick={() => allColumnsWithCustom.forEach(c => hiddenCols.has(c) && toggleCol(c))}
            className="ml-2 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors shrink-0 whitespace-nowrap">
            Show all
          </button>
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Sort inline bar ── */}
      {openPanel === "sort" && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] shrink-0">Sort by</span>
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          {sortRules.length === 0 && (
            <span className="text-[11px] text-[var(--text-secondary)]">No sorts — add one below</span>
          )}
          {sortRules.map((rule, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 shrink-0">
              <FieldSelect value={rule.col} onChange={v => setSortRules(r => r.map((x, idx) => idx === i ? { ...x, col: v } : x))}
                ariaLabel="Sort column" className="capitalize max-w-[120px]"
                options={[...allColumnsWithCustom, "__updated_at"].map(c => ({ value: c, label: colLabel(c) }))} />
              <button onClick={() => setSortRules(r => r.map((x, idx) => idx === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x))}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${rule.dir === "asc" ? "bg-[#717784]/10 text-[#717784]" : "bg-[#c6892e]/10 text-[#c6892e]"}`}>
                {rule.dir === "asc" ? <><ChevronUp size={9}/>A→Z</> : <><ChevronDown size={9}/>Z→A</>}
              </button>
              <button onClick={() => setSortRules(r => r.filter((_, idx) => idx !== i))} className="text-[var(--text-secondary)] hover:text-stone-400"><X size={10}/></button>
            </div>
          ))}
          <button onClick={() => { const unused = [...allColumnsWithCustom, "__updated_at"].find(c => !sortRules.some(r => r.col === c)); if (unused) { setSortRules(r => [...r, { col: unused, dir: "asc" }]); setQuickSortCol(null); } }}
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-100 transition-colors shrink-0 whitespace-nowrap">
            <Plus size={11}/> Add sort
          </button>
          {sortRules.length > 0 && (
            <button onClick={() => { setSortRules([]); setQuickSortCol(null); }} className="text-[10px] text-stone-400/50 hover:text-stone-400 transition-colors shrink-0 whitespace-nowrap">
              Clear
            </button>
          )}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Group inline bar ── */}
      {openPanel === "groupby" && (
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] shrink-0 mr-1">Group by</span>
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          <button onClick={() => { setGroupBy(null); }}
            className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] transition-colors shrink-0 border ${!groupByCol ? "border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-primary)]" : "border-[var(--border-soft)] text-stone-400 hover:text-stone-100 hover:border-[var(--border-soft)]"}`}>
            {!groupByCol && <Check size={9} className="text-stone-400"/>}None
          </button>
          {orderedColumns.map(col => (
            <button key={col} onClick={() => setGroupBy(col)}
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] transition-colors shrink-0 border capitalize ${groupByCol === col ? "border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-primary)]" : "border-[var(--border-soft)] text-stone-400 hover:text-stone-100 hover:border-[var(--border-soft)]"}`}>
              {groupByCol === col && <Check size={9} className="text-stone-400"/>}
              {colLabel(col)}
            </button>
          ))}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Export inline bar ── */}
      {openPanel === "export" && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] shrink-0">Export</span>
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          <button onClick={() => {
            const rows = [columns.join(","), ...sorted.map(r => columns.map(c => JSON.stringify(r.data[c] ?? "")).join(","))].join("\n");
            const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([rows], { type: "text/csv" })), download: `${objectType}.csv` });
            a.click(); URL.revokeObjectURL(a.href); setOpenPanel(null);
          }} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <Download size={11}/> Export as CSV
            <span className="text-[10px] text-[var(--text-secondary)] ml-1">({sorted.length} rows)</span>
          </button>
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0"><X size={13}/></button>
        </div>
      )}

      {/* ── Saved views inline bar ── */}
      {openPanel === "views" && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] shrink-0">Saved</span>
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          {savedViews.length === 0 && <span className="text-[11px] text-[var(--text-secondary)]">No saved views yet</span>}
          {savedViews.map(v => (
            <div key={v.id} className="flex items-center gap-0.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] pl-2.5 pr-1 py-1 shrink-0">
              <button onClick={() => { applyView(v); setOpenPanel(null); }} className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap">
                {v.name}
              </button>
              <button onClick={() => deleteView(v.id)} className="p-0.5 text-[var(--text-secondary)] hover:text-stone-400 transition-colors ml-1"><X size={10}/></button>
            </div>
          ))}
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          {saveViewOpen ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <input autoFocus value={newViewName} onChange={e => setNewViewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveCurrentView(); if (e.key === "Escape") setSaveViewOpen(false); }}
                placeholder="Name this view…"
                className="bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-sm px-2.5 py-1 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--border-soft)] placeholder:text-[var(--text-secondary)] w-36"/>
              <button onClick={saveCurrentView} className="text-[#2f9e6b] hover:opacity-80 transition-colors p-0.5"><Check size={12}/></button>
              <button onClick={() => setSaveViewOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] p-0.5"><X size={11}/></button>
            </div>
          ) : (
            <button onClick={() => setSaveViewOpen(true)}
              className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-stone-100 transition-colors shrink-0 whitespace-nowrap">
              <Plus size={11}/> Save current view
            </button>
          )}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0 pl-2"><X size={13}/></button>
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
          <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0 overflow-x-auto">
            {/* Search — icon that expands on click */}
            <div className="flex items-center shrink-0">
              {filterSearchOpen ? (
                <div className="relative flex items-center">
                  <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-stone-500"/>
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
                    <button onClick={() => { setFilterText(""); setFilterSearchOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-600 hover:text-[var(--text-primary)] transition-colors">
                      <X size={10}/>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setFilterSearchOpen(true)}
                  className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${filterText ? "text-[var(--text-primary)] bg-[var(--surface-hover)]" : "text-stone-400 hover:text-stone-100 hover:bg-[var(--surface-hover)]"}`}
                  title="Search records"
                >
                  <Search size={12}/>
                </button>
              )}
            </div>
            {allFilterCols.length > 0 && <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>}

            {allFilterCols.length === 0 && (
              <span className="text-xs text-stone-600">Add a Stage, Status, or Assignee column to enable filters.</span>
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
                    <span className={`text-[10px] font-semibold uppercase tracking-widest shrink-0 ${hasDate ? "text-stone-300" : "text-stone-600"}`}>{col.replaceAll("_"," ")}</span>
                    <input type="date" value={dateFrom}
                      onChange={e => setQuickFilters(prev => { const o = prev.filter(f => f.col !== col+"__from"); return e.target.value ? [...o,{col:col+"__from",value:e.target.value}] : o; })}
                      className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-stone-500/30"
                    />
                    <span className="text-stone-700 text-[10px]">→</span>
                    <input type="date" value={dateTo}
                      onChange={e => setQuickFilters(prev => { const o = prev.filter(f => f.col !== col+"__to"); return e.target.value ? [...o,{col:col+"__to",value:e.target.value}] : o; })}
                      className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-stone-500/30"
                    />
                    <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
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
                  <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
                </div>
              );
            })}

            {quickFilters.length > 0 && (
              <button onClick={() => { setQuickFilters([]); setFilterText(""); }} className="text-[10px] text-stone-400/60 hover:text-stone-400 transition-colors shrink-0 whitespace-nowrap">
                Clear all
              </button>
            )}
            <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0 transition-colors pl-2">
              <X size={13}/>
            </button>
          </div>
        );
      })()}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-[var(--border-soft)] bg-[var(--surface-hover)] shrink-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
            <div className="h-4 w-4 rounded-md bg-stone-500 flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)]">{selected.size}</div>
            selected
          </span>
          <div className="h-3 w-px bg-[var(--surface-hover)]" />

          {/* Add to list */}
          <div className="relative">
            <button
              onClick={() => { setListPickerOpen(o => !o); setAssignPickerOpen(false); }}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <List size={12} /> Add to list
            </button>
            {listPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setListPickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border-soft)]">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Add {selected.size} to list</p>
                  </div>
                  <div className="p-1">
                    {(listsQuery.data ?? []).length === 0 && (
                      <p className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">No lists yet</p>
                    )}
                    {(listsQuery.data ?? []).map(l => (
                      <button key={l.id} onClick={() => { bulkAddToList(l.id); setListPickerOpen(false); }}
                        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                        <List size={11} className="text-[var(--text-secondary)] shrink-0"/>
                        <span className="truncate">{l.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Find similar from web */}
          <div className="h-3 w-px bg-[var(--surface-hover)]" />
          <button
            onClick={() => setProspectOpen(true)}
            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Globe size={12} /> Find similar from web
          </button>

          {/* Assign to */}
          <div className="h-3 w-px bg-[var(--surface-hover)]" />
          <div ref={assignPickerRef} className="relative">
            <button
              onClick={() => { setAssignPickerOpen(o => !o); setListPickerOpen(false); setAssignSearch(""); }}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <UserCircle2 size={12} /> Assign to
            </button>
            {assignPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setAssignPickerOpen(false); setAssignSearch(""); }} />
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border-soft)]">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2">Assign {selected.size} records</p>
                    <div className="relative">
                      <Search size={10} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                      <input
                        autoFocus
                        value={assignSearch}
                        onChange={e => setAssignSearch(e.target.value)}
                        placeholder="Search members…"
                        className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-sm pl-6 pr-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-soft)] placeholder:text-[var(--text-secondary)]"
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
                            className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                            <MemberAvatar name={label} size={5}/>
                            <div className="flex flex-col items-start min-w-0">
                              <span className="truncate text-[var(--text-secondary)]">{m.name || m.email}</span>
                              {m.name && m.email && <span className="text-[10px] text-[var(--text-secondary)] truncate">{m.email}</span>}
                            </div>
                            {m.role && <span className="ml-auto text-[9px] text-[var(--text-secondary)] capitalize shrink-0">{m.role}</span>}
                          </button>
                        );
                      })}
                    {members.filter(m => {
                      const lb = (m.name || m.email || "").toLowerCase();
                      return assignSearch ? lb.includes(assignSearch.toLowerCase()) : true;
                    }).length === 0 && (
                      <p className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">No members found</p>
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
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Check size={12}/> Edit field
              </button>
              {bulkEditField && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setBulkEditField(null)}/>
                  <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border-soft)] flex items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] flex-1">Edit {selected.size} records</p>
                    </div>
                    {/* Column tabs */}
                    {bulkEditCols.length > 1 && (
                      <div className="flex gap-0.5 p-1.5 border-b border-[var(--border-soft)] overflow-x-auto">
                        {bulkEditCols.map(col => (
                          <button key={col} onClick={() => setBulkEditField(col)}
                            className={`rounded-md px-2 py-1 text-[10px] capitalize whitespace-nowrap transition-colors ${bulkEditField === col ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-stone-400 hover:text-stone-100"}`}>
                            {colLabel(col)}
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
                              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                              <span className={`h-2 w-2 rounded-full ${stageStyle(v).dot}`}/>{v}
                            </button>
                          ));
                        }
                        if (isStatusCol) {
                          const opts = [...new Set([...DEFAULT_STATUS_OPTIONS, ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
                          return opts.map(v => (
                            <button key={v} onClick={() => applyBulkEdit(col, v)}
                              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                              <span className={`h-2 w-2 rounded-full ${stageStyle(v).dot}`}/>{v}
                            </button>
                          ));
                        }
                        if (isOwnerCol) {
                          return validMembers.map(m => {
                            const label = m.name || m.email || "";
                            return (
                              <button key={m.id} onClick={() => applyBulkEdit(col, label)}
                                className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                                <MemberAvatar name={label} size={5}/>
                                <div className="flex flex-col items-start min-w-0">
                                  <span className="truncate text-[var(--text-secondary)]">{m.name || m.email}</span>
                                  {m.name && m.email && <span className="text-[10px] text-[var(--text-secondary)]">{m.email}</span>}
                                </div>
                              </button>
                            );
                          });
                        }
                        if (isCountryCol) {
                          const existing = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort();
                          return existing.length > 0 ? existing.map(v => (
                            <button key={v} onClick={() => applyBulkEdit(col, v)}
                              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                              {v}
                            </button>
                          )) : <p className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">No country values yet</p>;
                        }
                        if (isTagCol) {
                          const existing = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))];
                          return existing.length > 0 ? existing.map(v => {
                            const tc = tagColor(v);
                            return (
                              <button key={v} onClick={() => applyBulkEdit(col, v)}
                                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tc.bg}`}>{v}</span>
                              </button>
                            );
                          }) : <p className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">No tags yet</p>;
                        }
                        // Generic text field
                        const existing = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].slice(0, 15);
                        return existing.length > 0 ? existing.map(v => (
                          <button key={v} onClick={() => applyBulkEdit(col, v)}
                            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors truncate">
                            {v}
                          </button>
                        )) : <p className="px-3 py-3 text-xs text-[var(--text-secondary)] text-center">No values yet</p>;
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
            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-stone-400 transition-colors ml-auto"
          >
            <Trash2 size={12} /> Delete {selected.size}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-stone-100">
            <X size={13} />
          </button>
        </div>
      )}

      {prospectOpen && (
        <ProspectingModal
          onClose={() => setProspectOpen(false)}
          defaultObjectType={objectType}
          seedQuery={prospectSeedQuery}
          onCreated={() => qc.invalidateQueries({ queryKey: ["records", objectType] })}
        />
      )}

      <div className="record-scroll flex-1 min-h-0 overflow-x-auto overflow-y-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-[12px]">
          <thead className="sticky top-0 z-20">
            <tr>
              {/* Checkbox column */}
              <th className="w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[#e5e7eb] dark:border-b-white/[.06] sticky left-0 z-30">
                <div
                  onClick={toggleSelectAll}
                  className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${allSelected ? "bg-stone-500 border-stone-500" : someSelected ? "border-stone-300 bg-stone-50 dark:border-[var(--border-soft)] dark:bg-[var(--surface-hover)]" : "border-stone-300 hover:border-stone-400 dark:border-[var(--border-soft)] dark:hover:border-[var(--border-soft)]"}`}
                >
                  {allSelected && <Check size={10} className="text-[var(--text-primary)]" strokeWidth={3}/>}
                  {!allSelected && someSelected && <div className="h-1.5 w-1.5 rounded-sm bg-stone-400 dark:bg-[var(--surface-hover)]" />}
                </div>
              </th>
              {/* Record ID locked column — only when added via Add Column */}
              {hasRecordIdCol && (
                <th className="w-20 min-w-[80px] max-w-[80px] px-3 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[#e5e7eb] dark:border-b-white/[.06] sticky left-8 z-30">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-stone-500 dark:text-[var(--text-secondary)]">ID</span>
                </th>
              )}
              {orderedColumns.map((col, colIdx) => {
                const w = colWidths[col];
                return (
                  <th
                    key={col}
                    style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
                    className={`relative px-4 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[#e5e7eb] dark:border-b-white/[.06] select-none ${colIdx === 0 ? `sticky ${nameLeft} z-30 shadow-[2px_0_8px_rgba(15,23,42,0.06)] dark:shadow-[2px_0_8px_rgba(0,0,0,0.4)]` : ""}`}
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
                          className="cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)] shrink-0 pr-0.5"
                          title="Drag to reorder"
                        >
                          <GripVertical size={11}/>
                        </div>
                      )}
                      <button onClick={() => handleHeaderSort(col)}
                        className={`flex items-center gap-1.5 text-[#64748b] hover:text-[#111827] dark:text-stone-400 dark:hover:text-stone-100 transition-colors min-w-0 flex-1 ${isNumeric(col) ? "ml-auto" : ""}`}>
                        {getColumnIcon(col)}
                        <span className="text-[10px] font-semibold tracking-widest uppercase whitespace-nowrap">{col.replaceAll("_", " ")}</span>
                        {colMeta[col]?.required && <span className="text-stone-400/70 text-[10px] leading-none">*</span>}
                        <SortIcon col={col}/>
                      </button>
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={e => startResize(col, e, w ?? (e.currentTarget.parentElement?.offsetWidth ?? 160))}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group/resize z-10"
                    >
                      <div className="w-px h-4 bg-stone-200 dark:bg-[var(--surface-hover)] group-hover/resize:bg-stone-400/50 transition-colors"/>
                    </div>
                  </th>
                );
              })}
              <th className="px-4 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[#e5e7eb] dark:border-b-white/[.06]">
                <button onClick={() => handleHeaderSort("__updated_at")} className="flex items-center gap-1.5 text-[#64748b] hover:text-[#111827] dark:text-stone-400 dark:hover:text-stone-100 transition-colors">
                  <Calendar size={11}/>
                  <span className="text-[10px] font-semibold tracking-widest uppercase">Updated</span>
                  <SortIcon col="__updated_at"/>
                </button>
              </th>
              {/* Add column */}
              <th
                ref={addColHeaderRef}
                className="w-10 px-3 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[#e5e7eb] dark:border-b-white/[.06] relative"
              >
                <button
                  onClick={() => setOpenPanel(p => p === "addcol" ? null : "addcol")}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)] dark:hover:bg-[var(--surface-hover)] transition-all"
                  title="Add column"
                >
                  <Plus size={13}/>
                </button>
                {openPanel === "addcol" && (
                  <AddColumnDropdown
                    onAdd={(key, type, meta) => { saveCustomCols([...customCols, { key, type, ...(meta ? { meta } : {}) }]); setOpenPanel(null); }}
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
                <td colSpan={columns.length + 3} className="px-4 py-14 text-center text-xs" style={{ color: "var(--text-muted)" }}>
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
                      <td colSpan={columns.length + 3} className="px-4 py-2 bg-stone-50 dark:bg-[var(--surface-hover)] border-y border-stone-200 dark:border-[var(--border-soft)]">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${ss.dot}`}/>
                          <span className="text-[11px] font-semibold text-stone-600 dark:text-[var(--text-secondary)] capitalize">{groupVal}</span>
                          <span className="text-[10px] text-stone-400 dark:text-[var(--text-secondary)] ml-1">{groupRows.length}</span>
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
          <tfoot className="sticky bottom-0 z-40">
            <tr>
              <td className="w-8 min-w-[32px] max-w-[32px] bg-stone-50 dark:bg-[var(--surface-card)] border-t border-t-zinc-200 dark:border-t-zinc-800/60 sticky left-0 z-50" />
              {hasRecordIdCol && <td className="w-20 min-w-[80px] max-w-[80px] bg-stone-50 dark:bg-[var(--surface-card)] border-t border-t-zinc-200 dark:border-t-zinc-800/60 sticky left-8 z-50"/>}
              {orderedColumns.map((col, colIdx) => (
                <td
                  key={col}
                  className={`px-3 py-3 bg-stone-50 dark:bg-[var(--surface-card)] border-t border-t-zinc-200 dark:border-t-zinc-800/60 text-[12px] text-stone-900 dark:text-inherit ${isNumeric(col) ? "text-right" : ""} ${colIdx === 0 ? `sticky ${nameLeft} z-50 shadow-[2px_0_8px_rgba(15,23,42,0.06)] dark:shadow-[2px_0_8px_rgba(0,0,0,0.4)]` : "border-r border-r-zinc-200 dark:border-r-zinc-800/15"}`}
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
                        className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-[var(--text-primary)] transition-colors tabular-nums font-mono">
                        <span className="text-stone-600 uppercase text-[10px] tracking-wide mr-0.5">{calculations[col]}</span>
                        {calcResult(calculations[col], col, sorted)}
                      </button>
                    ) : (
                      <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                        className="flex items-center gap-1 text-[11px] text-stone-700 hover:text-stone-400 transition-colors group">
                        <Plus size={10} className="group-hover:text-stone-400 transition-colors"/>
                        <span>Calculate</span>
                      </button>
                    )}
                  </div>
                </td>
              ))}
              <td className="px-3 py-3 text-[12px] text-stone-700 tabular-nums bg-[var(--surface-card)] border-t border-t-zinc-800/60">{sorted.length} rows</td>
              <td className="bg-[var(--surface-card)] border-t border-t-zinc-800/60 border-l border-l-zinc-800/20 w-8"/>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    {/* Undo delete toast */}
    {cellTip && <CellTipPortal text={cellTip.text} x={cellTip.x} y={cellTip.y}/>}

    {undoToast && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-4 py-3 shadow-2xl">
        <span className="text-sm text-[var(--text-secondary)]">Record deleted</span>
        <button
          onClick={undoDelete}
          className="flex items-center gap-1.5 rounded-sm bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RotateCcw size={11} />
          Undo
        </button>
      </div>
    )}

    {flash && (
      <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-sm border bg-[var(--surface-card)] px-4 py-3 shadow-2xl"
        style={{ borderColor: flash.kind === "warn" ? "color-mix(in srgb, #c6892e 40%, transparent)" : "var(--border-soft)" }}>
        <span className="text-sm" style={{ color: flash.kind === "warn" ? "#c6892e" : "var(--text-secondary)" }}>{flash.msg}</span>
      </div>
    )}

    {/* Column right-click context menu */}
    {colCtxMenu && createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" onClick={() => setColCtxMenu(null)}/>
        <div
          className="fixed z-[9999] rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] py-1 shadow-xl min-w-[160px]"
          style={{ left: colCtxMenu.x, top: colCtxMenu.y }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-stone-600 border-b border-[var(--border-soft)] mb-1">
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
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-stone-400 hover:bg-stone-500/10 transition-colors"
          >
            <Trash2 size={12}/> Remove column
          </button>
          <button
            onClick={() => {
              toggleCol(colCtxMenu.col);
              setColCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={12}/> Hide column
          </button>
          <div className="border-t border-[var(--border-soft)] mt-1 pt-1">
            <button
              onClick={() => {
                const col = colCtxMenu.col;
                const cur = colMeta[col]?.required;
                saveColMeta({ ...colMeta, [col]: { ...colMeta[col], required: !cur } });
                setColCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              {colMeta[colCtxMenu.col]?.required
                ? <><Check size={12} className="text-stone-400"/> Required (click to remove)</>
                : <><Plus size={12}/> Mark as required</>
              }
            </button>
            <button
              onClick={() => {
                const col = colCtxMenu.col;
                const current = colMeta[col]?.defaultValue ?? "";
                const val = window.prompt(`Default value for "${colLabel(col)}"`, current);
                if (val !== null) saveColMeta({ ...colMeta, [col]: { ...colMeta[col], defaultValue: val } });
                setColCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Hash size={12}/> Set default value
              {colMeta[colCtxMenu.col]?.defaultValue && (
                <span className="ml-auto text-[10px] text-[var(--text-secondary)] truncate max-w-[70px]">{colMeta[colCtxMenu.col]!.defaultValue}</span>
              )}
            </button>
          </div>
        </div>
      </>,
      document.body
    )}
    </>
  );
}
