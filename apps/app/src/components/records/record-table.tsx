import { useQuery, useQueryClient, useMutation, keepPreviousData } from "@tanstack/react-query";
import { useWorkspaceSuggestions } from "../../hooks/useWorkspaceSuggestions";
import { LogoMark } from "@/components/logo";
import {
  Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2,
  ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check, Search, X, Command, Settings2, ArrowUpDown, Download, GripVertical,
  UserCircle2, Type, ToggleLeft, ChevronRight, Trash2, RotateCcw, List,
  Rows3, BookmarkCheck, LayoutGrid, Percent, Link2,
  Briefcase, DollarSign, Heart, BookOpen, ShoppingCart, Cpu, Shield,
  Store, Factory, Home, Truck, Tv, Scale, Zap, Megaphone, Receipt,
  Sigma, Loader2, Sparkles, MoreHorizontal,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiClient, apiFetch, getAuthHeaders } from "../../lib/api-client";
import { evaluateFormula } from "@mondaily/shared/formula";
import { LossReasonModal, isLostStage, type PendingLoss } from "./loss-reason";
import { formatMoney, convertAmount, useCurrency } from "../../hooks/useCurrency";
import { countryFacts, fmtPopulation } from "../../lib/countries";
import { parseNLPCommand } from "../../lib/ai-enrichment";
import { ErrorState, PageSkeleton } from "../ui/page-state";
import { FieldSelect } from "../ui/controls";
import { INDUSTRY_TAXONOMY } from "./record-detail";
import { LeadScoreBadge } from "./lead-score-badge";
import { AIHealthScoreCompact } from "../ai/ai-intelligence";
import { ProspectingModal } from "../ai/prospecting-modal";
import { PipelineHealthBadge } from "./pipeline-health-badge";
import { parseNumeric } from "@mondaily/shared/numbers";
import type { PipelineHealth } from "./pipeline-health-badge";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string; lead_score?: number | null; lead_score_signals?: Record<string, unknown> | null; relationship_health?: number | null }
/** Columns that live as real node columns (not inside the data jsonb) — the AI
 *  scores. They must be surfaced + read from the record top level, not data[col]. */
const NODE_LEVEL_COLS = ["lead_score", "relationship_health"];
/** Read a cell value, transparently handling node-level columns. */
function cellValue(record: NodeRecord, col: string): unknown {
  return NODE_LEVEL_COLS.includes(col) ? (record as unknown as Record<string, unknown>)[col] : record.data[col];
}
/** Human column label — AI score columns get their landing-page branding.
 *  Owner vs Assigned-to (2026-08-01): ONE meaning each, app-wide. Owner = the accountable member
 *  on a RECORD; Assignee = who executes a TASK. Record sheets therefore display every
 *  assigned-to-style column as "Owner" so the same concept never wears two names on one screen.
 *  (Task surfaces keep "Assignee" — they are tasks.) Data keys are unchanged; this is display
 *  unification, not a destructive rename. */
function colLabel(col: string): string {
  if (col === "lead_score") return "AI Score";
  if (col === "relationship_health") return "Relationship";
  if (/^(assigned_to|assignee|assigned)$/i.test(col)) return "Owner";
  if (/^deal_owner$/i.test(col)) return "Deal owner";
  return col.replace(/_/g, " ");
}
type CalcOp = "sum" | "avg" | "min" | "max" | "count" | "filled" | null;
type SortDir = "asc" | "desc";
export interface SortRule { col: string; dir: SortDir }

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
        className="max-w-sm rounded-sm px-3 py-2 text-[12px] text-[var(--text-secondary)] leading-relaxed"
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
  raw, onSave, className = "", numeric = false, openTo,
}: {
  raw: unknown; onSave: (v: string) => void; className?: string; numeric?: boolean;
  /** When set, the cell is the record's IDENTITY: a single click opens it and editing needs a
   *  double-click. Clicking a name used to start renaming it, so the primary action (open) was
   *  hidden behind a hover-only chevron while the destructive-ish one (rename) was the default. */
  openTo?: string;
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
        className={`-mx-1 w-full min-w-0 rounded-sm border border-[var(--section-accent-line)] bg-[var(--surface-card)] px-1 py-0.5 text-[12px] text-[var(--text-primary)] outline-none ${numeric ? "text-right font-mono" : ""} ${className}`}
      />
    );
  }

  const shown = display(raw);
  if (openTo) {
    return (
      <Link
        to={openTo}
        onDoubleClick={e => { e.preventDefault(); startEdit(); }}
        title="Click to open · double-click to rename"
        className={`block truncate text-[12px] hover:underline ${shown === "—" ? "text-stone-700 hover:text-stone-500" : ""} ${className}`}
      >
        {shown}
      </Link>
    );
  }
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
  // "country" contains "count" — it rendered with a # header icon and right-aligned as a number.
  if (lower.includes("country")) return false;
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
  if (isNumeric(col) && !/phone/i.test(col)) return <Hash size={12} className="text-stone-600"/>;
  return <Database size={12} className="text-stone-600"/>;
}

// (Removed dead component `useClickOutside` — 2026-07-31 audit: defined once, imported nowhere;//  superseded by the inline toolbar bars that are actually rendered.)

// ─── Portal dropdown — renders over ALL overflow/z-index traps ────────────────
export function PortalDropdown({ triggerRef, onClose, align = "left", direction = "down", minWidth, className = "", children }: {
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
    // Viewport-bounded + scrollable: the panel had NO max height, so a tall menu (Add column:
    // 18 presets ≈ 750px) ran past the fold with no scrollbar — its lower options unreachable.
    // Auto-flip up when the space below is too tight to be usable.
    const spaceBelow = window.innerHeight - (r.bottom + 4) - 8;
    const dir = direction === "down" && spaceBelow < 180 && r.top > spaceBelow ? "up" : direction;
    if (dir === "down") { s.top = r.bottom + 4; s.maxHeight = Math.max(120, spaceBelow); }
    else { s.bottom = window.innerHeight - r.top + 4; s.maxHeight = Math.max(120, r.top - 12); }
    // Clamp horizontally — align="right" on the last column of a scrolled table went negative and
    // hung the panel off the right edge of the screen.
    if (align === "right") s.right = Math.max(8, window.innerWidth - r.right);
    else s.left = Math.max(8, Math.min(r.left, window.innerWidth - (minWidth ?? r.width) - 8));
    setStyle(s);
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    // Close when anything OUTSIDE the panel scrolls — the fixed panel doesn't track its trigger,
    // so scrolling the sheet left it floating detached from its cell. ARMED after 250ms: the
    // open itself can scroll (autofocusing a search input scrolls the table), which closed the
    // menu the same instant it opened — clicks looked like they did nothing.
    const armedAt = Date.now() + 250;
    function onScroll(e: Event) { if (Date.now() >= armedAt && !panelRef.current?.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-[9999] overflow-y-auto overflow-x-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_8px_24px_rgba(0,0,0,0.28)] ${className}`}
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
export function StagePill({ value, options, onSelect, placeholder }: {
  value: string;
  options?: string[];
  onSelect?: (v: string) => void;
  placeholder?: string;
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
        className={value
          ? `inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-opacity hover:opacity-80 ${pill}`
          : "inline-flex items-center gap-1 px-2 py-0.5 text-[12px] whitespace-nowrap transition-colors text-[var(--text-faint)] hover:text-[var(--text-muted)]"}
      >
        {value && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`}/>}
        {value || placeholder || "— set"}
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
  // cellValue(), not r.data[col]: node-level columns (lead_score / relationship_health) live at the
  // top level of the record, so a Sum or Avg over them always came back "—".
  const vals = records.map(r => cellValue(r, col));
  if (op === "count") return String(vals.length);
  if (op === "filled") {
    const filled = vals.filter(v => v != null && v !== "" && v !== "—").length;
    return `${Math.round((filled / Math.max(vals.length, 1)) * 100)}% filled`;
  }
  const nums = vals
    .map(v => parseNumeric(v) ?? NaN)
    .filter(n => !isNaN(n));
  if (!nums.length) return "—";
  if (op === "sum") { const s = nums.reduce((a, b) => a + b, 0); return s % 1 === 0 ? s.toLocaleString() : s.toFixed(2); }
  if (op === "avg") { const a = nums.reduce((a, b) => a + b, 0) / nums.length; return a % 1 === 0 ? a.toLocaleString() : a.toFixed(2); }
  if (op === "min") return Math.min(...nums).toLocaleString();
  if (op === "max") return Math.max(...nums).toLocaleString();
  return "—";
}

// Type-aware footer total. Currency columns convert each row to the workspace DISPLAY currency
// (fail-closed via convertAmount — a missing rate is flagged, never guessed). Checkbox columns
// count the checked rows. Percentage columns default to an average. Everything else falls back to
// the plain numeric calc above. Pure over the passed rows + rate table — no fabrication.
function calcResultTyped(
  op: CalcOp, col: string, records: NodeRecord[], kind: string | undefined,
  ctx: { display: string; rates: Record<string, number>; base: string },
  formulaSrc?: string,
): string {
  if (!op) return "";
  // Formula columns: computed per loaded row by the shared evaluator, then aggregated
  // client-side. The footer labels the scope honestly ("this view"/loaded rows) upstream.
  if (kind === "formula" && formulaSrc) {
    const vals: number[] = [];
    let filled = 0;
    for (const r of records) {
      const res = evaluateFormula(formulaSrc, r.data as Record<string, unknown>);
      if (res.ok && res.value != null && res.value !== "") filled += 1;
      if (res.ok && typeof res.value === "number" && Number.isFinite(res.value)) vals.push(res.value);
      if (res.ok && typeof res.value === "boolean" && res.value) vals.push(1);
    }
    if (op === "filled") return `${Math.round((filled / Math.max(records.length, 1)) * 100)}% filled`;
    if (op === "count") return String(filled);
    if (!vals.length) return "—";
    const v = op === "sum" ? vals.reduce((a, b) => a + b, 0)
      : op === "avg" ? vals.reduce((a, b) => a + b, 0) / vals.length
      : op === "min" ? Math.min(...vals) : Math.max(...vals);
    return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
  }
  if (kind === "checkbox") {
    const checked = records.filter(r => truthy(cellValue(r, col))).length;
    if (op === "filled") { const f = records.filter(r => cellValue(r, col) != null && cellValue(r, col) !== "").length; return `${Math.round((f / Math.max(records.length, 1)) * 100)}% filled`; }
    return `${checked} checked`;
  }
  if (kind === "currency" && (op === "sum" || op === "avg" || op === "min" || op === "max")) {
    const items = records
      .map(r => ({ n: parseNumeric(cellValue(r, col)) ?? NaN, cur: String(r.data.currency ?? ctx.base) }))
      .filter(x => !isNaN(x.n));
    if (!items.length) return "—";
    let missing = 0;
    const conv = items.map(x => {
      if (x.cur === ctx.display) return x.n;
      const v = convertAmount(x.n, x.cur, ctx.display, ctx.rates);
      if (v == null) { missing += 1; return x.n; } // face-value fallback, flagged
      return v;
    });
    const agg = op === "sum" ? conv.reduce((a, b) => a + b, 0)
      : op === "avg" ? conv.reduce((a, b) => a + b, 0) / conv.length
      : op === "min" ? Math.min(...conv) : Math.max(...conv);
    return formatMoney(agg, ctx.display) + (missing > 0 ? ` · ${missing} unconverted` : "");
  }
  if (kind === "percentage" && (op === "sum" || op === "avg" || op === "min" || op === "max")) {
    const nums = records.map(r => parseNumeric(cellValue(r, col)) ?? NaN).filter(n => !isNaN(n));
    if (!nums.length) return "—";
    const agg = op === "sum" ? nums.reduce((a, b) => a + b, 0)
      : op === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length
      : op === "min" ? Math.min(...nums) : Math.max(...nums);
    return `${(agg % 1 === 0 ? agg : Number(agg.toFixed(1))).toLocaleString()}%`;
  }
  return calcResult(op, col, records);
}

/** A total that outgrows its column renders compact ("€1.24M") with the exact figure in the
 *  tooltip — a truncated sum is worse than a compact one. Non-numeric strings pass through. */
function CompactTotal({ text }: { text: string }) {
  if (text.length <= 18) return <>{text}</>;
  const m = text.match(/^([^0-9-]*)(-?[\d,.]+)(.*)$/);
  const n = m ? parseFloat(m[2]!.replace(/,/g, "")) : NaN;
  if (isNaN(n) || Math.abs(n) < 10_000) return <span title={text}>{text}</span>;
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);
  return <span title={text}>{(m![1] ?? "") + compact + (m![3] ?? "")}</span>;
}

// ─── Server-side authoritative total (Phase 3) ───────────────────────────────
// The client footer above totals the fetched page (capped at 1000). When the sheet is UNFILTERED,
// we additionally ask the server to aggregate the WHOLE table via POST /records/aggregate — the same
// nodes source, currency-aware + fail-closed. The client value shows instantly and stays as the
// fallback while the server result loads or if the request errors (labeled honestly).
type AggResp = { op: string; value?: number; total_rows: number; truncated: boolean; unconverted: number; currency: string | null };
function serverAggOp(kind: string | undefined, op: CalcOp): "count" | "sum" | "avg" | "min" | "max" | "filled" | "checked" | null {
  if (!op) return null;
  if (kind === "formula") return null;   // server can't evaluate formulas — client subtotal only
  if (kind === "checkbox") return op === "filled" ? "filled" : "checked"; // checkbox "count" means checked
  return op;
}
// A small muted/warn qualifier chip shown after a footer total — communicates the SCOPE of the number
// (full table vs filtered vs truncated) and any unconverted-currency count. Warn tone = the honesty
// cases where the number is NOT the whole picture (truncated / unconverted).
function TotalNote({ text, warn }: { text: string; warn?: boolean }) {
  return <span className="ml-1 font-sans text-[9px] font-normal normal-case tracking-normal" style={{ color: warn ? "#c6892e" : "var(--text-faint)" }}>· {text}</span>;
}
// Splits a server aggregate into the main value + honest scope notes. `filtered` = the server total
// reflects the active (equality) filters, so it's labelled "filtered" rather than "over N".
function aggParts(kind: string | undefined, op: CalcOp, resp: AggResp, display: string, filtered: boolean): { value: string; notes: { text: string; warn?: boolean }[] } {
  const v = resp.value ?? 0;
  const value =
    op === "count" ? v.toLocaleString() :
    op === "filled" ? `${Math.round((v / Math.max(resp.total_rows, 1)) * 100)}% filled` :
    kind === "checkbox" ? `${v.toLocaleString()} checked` :
    kind === "currency" ? formatMoney(v, resp.currency ?? display) :
    kind === "percentage" ? `${(v % 1 === 0 ? v : Number(v.toFixed(1))).toLocaleString()}%` :
    (v % 1 === 0 ? v.toLocaleString() : v.toFixed(2));
  // A plain exact count needs no scope note (the value IS the row count).
  if (op === "count" && !filtered) return { value, notes: [] };
  const notes: { text: string; warn?: boolean }[] = [];
  notes.push(filtered
    ? { text: `filtered · ${resp.total_rows.toLocaleString()}` }
    : resp.truncated
    ? { text: `first ${resp.total_rows.toLocaleString()}`, warn: true }
    : { text: `over ${resp.total_rows.toLocaleString()}` });
  // A filtered aggregate can ALSO be truncated (filters apply after the row cap) — hiding the
  // warning presented a partial sum as the complete filtered total.
  if (filtered && resp.truncated) notes.push({ text: "first rows only", warn: true });
  if (resp.unconverted > 0) notes.push({ text: `${resp.unconverted} unconverted`, warn: true });
  return { value, notes };
}
type AggFilter = { column: string; value: string };
// The subset of the active conditions the aggregate route can reproduce EXACTLY: plain equality
// on a non-owner column. Owner/assignee filters resolve through display-name state the server
// can't see; every other operator keeps the honest client subtotal.
function serverFilters(conditions: Cond[]): AggFilter[] {
  return conditions
    .filter(c => c.op === "is" && !/owner|assign/i.test(c.col) && c.col !== LAST_ACTIVITY)
    .map(c => ({ column: c.col, value: String(c.value ?? "") }));
}
// Compact Excel-style subtotal string for a single group value (server-provided).
function fmtGroupVal(kind: string | undefined, op: CalcOp, value: number, currency: string, unconverted: number): string {
  if (op === "count" || op === "filled") return value.toLocaleString();
  if (kind === "checkbox") return `${value.toLocaleString()} checked`;
  if (kind === "currency") return formatMoney(value, currency) + (unconverted > 0 ? ` ·${unconverted}✗` : "");
  if (kind === "percentage") return `${(value % 1 === 0 ? value : Number(value.toFixed(1))).toLocaleString()}%`;
  return value % 1 === 0 ? value.toLocaleString() : value.toFixed(2);
}
function ServerTotalValue({ objectType, col, op, kind, display, fallback, filters }: {
  objectType: string; col: string; op: CalcOp; kind: string | undefined; display: string; fallback: string; filters?: AggFilter[];
}) {
  const aggOp = serverAggOp(kind, op);
  const q = useQuery<AggResp>({
    queryKey: ["records-agg", objectType, col, aggOp, kind === "currency", JSON.stringify(filters ?? [])],
    queryFn: () => apiClient.post<AggResp>("/records/aggregate", { object_type: objectType, column: col, op: aggOp, group_by: "none", currency: kind === "currency", ...(filters?.length ? { filters } : {}) }),
    enabled: !!aggOp,
    staleTime: 30_000,
    retry: false,
  });
  // Loading or errored → keep the honest client subtotal (never a blank or a fake number).
  if (!q.data) return <CompactTotal text={fallback}/>;
  const { value, notes } = aggParts(kind, op, q.data, display, !!filters?.length);
  return <><CompactTotal text={value}/>{notes.map((n, i) => <TotalNote key={i} text={n.text} warn={n.warn} />)}</>;
}

// ─── Calc dropdown ────────────────────────────────────────────────────────────
function CalcDropdown({ col, current, onSelect, onClose, triggerRef, kind }: {
  col: string; current: CalcOp; onSelect: (op: CalcOp) => void; onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>; kind?: string;
}) {
  const numericKind = kind === "currency" || kind === "percentage" || kind === "number" || kind === "formula";
  // Text-like server types never aggregate to sums/averages — only count / % filled (even if the
  // column NAME would otherwise trip the numeric heuristic, e.g. "phone_number").
  const textKind = kind === "select" || kind === "multi_select" || kind === "url" || kind === "email" || kind === "phone" || kind === "datetime" || kind === "date" || kind === "text" || kind === "long_text";
  const options: { op: CalcOp; label: string }[] = kind === "checkbox"
    ? [{ op:"count",label:"Checked" },{ op:"filled",label:"% Filled" }]
    : numericKind
    ? [{ op:"sum",label:"Sum" },{ op:"avg",label:"Average" },{ op:"min",label:"Min" },{ op:"max",label:"Max" },{ op:"count",label:"Count" },{ op:"filled",label:"% Filled" }]
    : textKind
    ? [{ op:"count",label:"Count" },{ op:"filled",label:"% Filled" }]
    : isNumeric(col)
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
// (Removed dead component `ViewSettingsDropdown` — 2026-07-31 audit: defined once, imported nowhere;//  superseded by the inline toolbar bars that are actually rendered.)

// ─── Sort panel dropdown ──────────────────────────────────────────────────────
// (Removed dead component `SortPanel` — 2026-07-31 audit: defined once, imported nowhere;//  superseded by the inline toolbar bars that are actually rendered.)

// ─── Export dropdown ──────────────────────────────────────────────────────────
// (Removed dead component `ExportDropdown` — 2026-07-31 audit: defined once, imported nowhere;//  superseded by the inline toolbar bars that are actually rendered.)

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
    // Sized inline: `h-${size}` is an interpolated class name, which Tailwind never emits — the
    // avatars had no width or height at all.
    <div style={{ height: size * 4, width: size * 4 }} className={`rounded-full ${avatarColor(name)} flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)] shrink-0`}>
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
            <p className="text-body text-[var(--text-secondary)]">Assign to</p>
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
  { type: "currency",  label: "Currency",   hint: "Money amount — totals in your display currency", icon: Receipt,  color: "text-[#2f9e6b]"  },
  { type: "percentage",label: "Percent",    hint: "Percentage value (totals average)",         icon: Hash,         color: "text-[#c6892e]"  },
  { type: "checkbox",  label: "Checkbox",   hint: "Yes/no — e.g. paid, done (totals count checked)", icon: ToggleLeft, color: "text-[#2f9e6b]" },
  { type: "date",      label: "Date",       hint: "Date or deadline",                          icon: Calendar,     color: "text-[#d1524a]"    },
  { type: "relation",  label: "Relation",   hint: "Link to a record in another object",        icon: Link2,        color: "text-[#717784]"    },
  { type: "formula",   label: "Formula",    hint: "Computed from other fields — e.g. {price} * {qty}", icon: Sigma, color: "text-[#8b7ec8]" },
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
  currency:  "Amount",
  percentage:"Percent",
  checkbox:  "Paid",
  date:      "",
  relation:  "Linked Record",
  formula:             "Computed",
  finance_billed:      "Billed",
  finance_outstanding: "Outstanding",
};

// Types where only one instance makes sense
const SINGLETON_TYPES = new Set(["assignee","owner","status","stage","record_id","country"]);

function AddColumnDropdown({ onAdd, onClose, triggerRef, existingCols, existingCustomTypes, objectTypeForFormula }: {
  onAdd: (name: string, type: string, meta?: Record<string, string>) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | HTMLTableCellElement | null>;
  existingCols: string[];
  existingCustomTypes: string[];
  objectTypeForFormula: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColPresetType>("text");
  const [hovered, setHovered] = useState<ColPresetType | null>(null);
  const [relatedTarget, setRelatedTarget] = useState("");
  const [formulaSrc, setFormulaSrc] = useState("");
  const [formulaResult, setFormulaResult] = useState<"auto" | "currency" | "percent">("auto");
  const [fbDesc, setFbDesc] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbPreview, setFbPreview] = useState<{ name: string; value?: unknown; error?: string }[] | null>(null);
  const [fbWarnings, setFbWarnings] = useState<string[]>([]);
  const [fbMsg, setFbMsg] = useState<string | null>(null);
  async function buildFormula() {
    if (!fbDesc.trim()) return;
    setFbBusy(true); setFbMsg(null); setFbPreview(null); setFbWarnings([]);
    try {
      const r = await apiClient.post<{ ok: boolean; formula?: string; preview?: { name: string; value?: unknown; error?: string }[]; warnings?: string[]; detail?: string }>(
        "/records/formula-builder", { object_type: objectTypeForFormula, description: fbDesc.trim() });
      if (r.ok && r.formula) { setFormulaSrc(r.formula); setFbPreview(r.preview ?? []); setFbWarnings(r.warnings ?? []); }
      else setFbMsg(r.detail ?? "Couldn't express that as a formula.");
    } catch (e) { setFbMsg(e instanceof Error ? e.message : "AI is unavailable — write the formula by hand."); }
    finally { setFbBusy(false); }
  }
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // `label` does not exist on object_definitions — the table stores name_singular / name_plural.
  // Declaring it here made `obj.label` typecheck while being undefined at runtime for all 15 object
  // types, so the relation picker silently fell back to raw slugs ("discovered-leads", "people").
  const { data: objectDefs = [] } = useQuery<{ id: string; slug: string; name_singular?: string; name_plural?: string }[]>({
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
    if (t === "country" && existingCustomTypes.includes("country")) return true;
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
    const meta: Record<string, string> | undefined =
      type === "relation" && relatedTarget ? { relatedObjectType: relatedTarget }
      : type === "formula" ? { formula: formulaSrc, result: formulaResult }
      : undefined;
    if (type === "formula" && !formulaSrc.trim()) return; // a formula column needs a formula
    onAdd(slug, type, meta);
    onClose();
  }

  const activePreset = COLUMN_TYPE_PRESETS.find(p => p.type === (hovered ?? type))!;

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="right" className="w-64 !overflow-hidden flex flex-col">
      <div className="px-3 pt-3 pb-2 border-b border-[var(--border-soft)]">
        <p className="text-body text-[var(--text-secondary)] mb-2">Add column</p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          placeholder="Column name…"
          className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-stone-700 outline-none focus:border-stone-500/30"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
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
      {type === "formula" && (
        <div className="px-3 py-2 border-t border-[var(--border-soft)]">
          <p className="mb-1.5 text-body text-[var(--text-secondary)]">Formula</p>
          {/* AI builder — describe it; the SERVER proves the result against real rows before you
              see it, and nothing saves until you click Add (approval stays with the user). */}
          <div className="mb-2 flex items-center gap-1.5">
            <input value={fbDesc} onChange={e => setFbDesc(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void buildFormula(); } }}
              placeholder="Describe it — e.g. days until the due date"
              className="min-w-0 flex-1 rounded-md border border-[var(--border-soft)] bg-transparent px-2.5 py-1.5 text-[11.5px] text-[var(--text-primary)] outline-none focus:border-stone-500/30" />
            <button onClick={() => void buildFormula()} disabled={fbBusy || !fbDesc.trim()}
              className="btn-primary h-7 shrink-0 gap-1 px-2.5 text-[11px] font-semibold">
              {fbBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Build
            </button>
          </div>
          {fbMsg && <p className="mb-1.5 text-[10.5px]" style={{ color: "var(--status-warn)" }}>{fbMsg}</p>}
          <textarea value={formulaSrc} onChange={e => setFormulaSrc(e.target.value)} rows={2}
            placeholder={"{price} * {qty}  ·  IF({paid}, 0, {total})  ·  DAYS({due date}, TODAY())"}
            className="w-full resize-none rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-stone-500/30"/>
          <div className="mt-1.5 flex items-center gap-1">
            {(["auto", "currency", "percent"] as const).map(r => (
              <button key={r} onClick={() => setFormulaResult(r)}
                className="rounded-md px-2 py-0.5 text-[10.5px] font-medium capitalize transition-colors"
                style={formulaResult === r
                  ? { background: "color-mix(in srgb, var(--text-primary) 5%, transparent)", color: "var(--text-primary)" }
                  : { color: "var(--text-muted)" }}>
                {r}
              </button>
            ))}
          </div>
          {fbPreview && fbPreview.length > 0 && (
            <div className="mt-1.5 space-y-0.5 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--border-soft)" }}>
              <p className="text-[10px] font-semibold" style={{ color: "var(--text-faint)" }}>Proof — real rows</p>
              {fbPreview.map((pv, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="truncate" style={{ color: "var(--text-muted)" }}>{pv.name}</span>
                  {"error" in pv && pv.error
                    ? <span title={pv.error} style={{ color: "var(--status-error)" }}>#ERR</span>
                    : <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>{String(pv.value ?? "—")}</span>}
                </div>
              ))}
            </div>
          )}
          {fbWarnings.map((wr, i) => <p key={i} className="mt-1 text-[10px]" style={{ color: "var(--status-warn)" }}>{wr}</p>)}
          <p className="mt-1 text-[10px] text-[var(--text-secondary)]">Fields as {"{name}"} · IF, ROUND, ABS, MIN, MAX, SUM, DAYS, TODAY, CONCAT, LEN · read-only, computed per row</p>
        </div>
      )}
      {type === "relation" && (
        <div className="px-3 py-2 border-t border-[var(--border-soft)]">
          <p className="mb-1.5 text-body text-[var(--text-secondary)]">Link to object</p>
          <div className="flex flex-col gap-1">
            {objectDefs.map(obj => (
              <button key={obj.slug} onClick={() => setRelatedTarget(obj.slug)}
                className={`flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs transition-colors ${relatedTarget === obj.slug ? "bg-[#717784]/12 text-[#717784] border border-[#717784]/30" : "text-stone-400 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] border border-transparent"}`}>
                <Link2 size={11} className={relatedTarget === obj.slug ? "text-[#717784]" : "text-stone-600"}/>
                {obj.name_plural || obj.name_singular || obj.slug}
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
/**
 * Natural-language table commands ("sort by AI score descending, total the value column").
 * Calls /generate/nlp (now metered), with the regex parser as an offline fallback.
 *
 * 2026-07-31 audit: fully built but NEVER MOUNTED — no render site anywhere in the app, so the
 * endpoint had zero callers and the feature was unreachable. Restored and wired into the toolbar
 * as an "Ask" panel rather than deleted.
 */
function NLPCommandBar({ columns, onApply, onClear, hasActive }: {
  columns: string[];
  onApply: (filterText: string, sortCol: string | null, sortDir: SortDir, calcOps: Record<string, "sum"|"avg"|"min"|"max"|"count">, conditions?: Cond[]) => void;
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
      onApply(parsed.filterText ?? "", parsed.sortCol ?? null, parsed.sortDir ?? "asc", parsed.calcOps ?? {}, Array.isArray(parsed.conditions) ? parsed.conditions : []);
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
      onApply(parsed.filterText ?? "", parsed.sortCol ?? null, parsed.sortDir ?? "asc", parsed.calcOps ?? {}, []);
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

// ─── Editable link cell — click follows the link, double-click edits ──────────
function EditableContactCell({ val, kind, onSave }: { val: unknown; kind: "url" | "email" | "phone"; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  if (editing) return (
    <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft.trim() !== String(val ?? "")) onSave(draft.trim()); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="w-full bg-transparent text-[12px] text-[var(--text-primary)] outline-none"/>
  );
  return (
    <div onDoubleClick={() => { setDraft(String(val ?? "")); setEditing(true); }} title="Double-click to edit">
      <ContactCell value={val} kind={kind}/>
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
            {filtered.slice(0, 80).map(c => {
              // Owner-supplied 2026 reference data — shown at the moment of choice (market size is
              // WHY someone picks a country), never stored on the record. The field stays a name.
              const facts = countryFacts(c);
              return (
                <button key={c} onClick={() => { onSelect(c); setOpen(false); setSearch(""); }}
                  title={facts ? `${facts.name} — ${facts.population.toLocaleString()} people · ${facts.landKm2.toLocaleString()} km² · ${facts.density.toLocaleString()}/km²` : undefined}
                  className={`dropdown-item w-full text-xs ${c === value ? "dropdown-item-active" : ""}`}>
                  <span className="min-w-0 flex-1 truncate text-left">{c}</span>
                  {facts && <span className="ml-2 shrink-0 tabular-nums text-[10px] text-stone-500">{fmtPopulation(facts.population)}</span>}
                  {c === value && <Check size={10} className="ml-1 text-stone-400 shrink-0"/>}
                </button>
              );
            })}
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
          ? <span className="text-[12px] text-[var(--text-faint)] hover:text-stone-500 transition-colors">+ tag</span>
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
      // A failed '=' entry is NEVER stored as text — the cell reverts instead of silently saving
      // the literal string "=A*0.1" as a value.
      if (result !== null) onSave(result);
      setEditing(false); return;
    }
    const n = parseNumeric(s);   // shared parser — the regex strip corrupted "1.200,50" to 1.2 AND STORED IT
    onSave(n == null ? s : n);
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
        placeholder="0 or =100*0.1"
        className="w-full max-w-[100px] bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none font-mono"/>
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] tabular-nums transition-colors text-left w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]">
      {displayVal ?? <span className="text-[var(--text-faint)]">— number</span>}
    </button>
  );
}

// ─── Checkbox cell — a real boolean toggle (e.g. paid / done). Writes data[col] = true|false ──
function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "paid" || s === "done" || s === "1" || s === "✓";
}
function CheckboxCell({ value, onSave }: { value: unknown; onSave: (v: boolean) => void }) {
  const checked = truthy(value);
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onSave(e.target.checked)}
        aria-label={checked ? "Checked" : "Unchecked"}
        className="h-3.5 w-3.5 accent-[var(--section-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]" />
    </label>
  );
}

// ─── Currency cell — money amount, edited as a number (formula-aware), shown in its own currency.
//     Totals convert to the workspace DISPLAY currency (fail-closed) in the footer, never here. ──
function CurrencyCell({ value, currency, onSave }: { value: unknown; currency: string; onSave: (v: number | string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(String(value ?? "")); inputRef.current?.focus(); inputRef.current?.select(); } }, [editing, value]);
  function commit() {
    const s = draft.trim();
    if (!s) { onSave(""); setEditing(false); return; }
    if (s.startsWith("=")) { const r = evalFormula(s.slice(1)); if (r !== null) onSave(r); setEditing(false); return; }
    const n = parseNumeric(s);   // shared parser — the regex strip corrupted "1.200,50" to 1.2 AND STORED IT
    onSave(n == null ? s : n);
    setEditing(false);
  }
  const num = parseNumeric(value) ?? NaN;
  const shown = value === "" || value == null || isNaN(num) ? null : formatMoney(num, currency);
  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="0 or =100*0.1"
        className="w-full max-w-[110px] bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none font-mono"/>
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] tabular-nums transition-colors text-left w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]">
      {shown ?? <span className="text-[var(--text-faint)]">— amount</span>}
    </button>
  );
}

// ─── Percentage cell — editable number shown with a trailing %. Totals AVERAGE in the footer. ──
function PercentCell({ value, onSave }: { value: unknown; onSave: (v: number | string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(String(value ?? "")); inputRef.current?.focus(); inputRef.current?.select(); } }, [editing, value]);
  function commit() {
    const s = draft.trim();
    if (!s) { onSave(""); setEditing(false); return; }
    const n = parseNumeric(s);   // shared parser — the regex strip corrupted "1.200,50" to 1.2 AND STORED IT
    onSave(n == null ? s : n);
    setEditing(false);
  }
  const num = parseNumeric(value) ?? NaN;
  const shown = value === "" || value == null || isNaN(num) ? null : `${num.toLocaleString()}%`;
  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="0"
        className="w-full max-w-[80px] bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none font-mono"/>
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] tabular-nums transition-colors text-left w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]">
      {shown ?? <span className="text-[var(--text-faint)]">— %</span>}
    </button>
  );
}

// ─── Safe absolute date/datetime formatter — degrades to the raw string, never throws/crashes. ──
function fmtAbsDate(v: unknown, withTime: boolean): { text: string; ok: boolean } {
  const s = String(v ?? "").trim();
  if (!s) return { text: "", ok: false };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { text: s, ok: false }; // honest: show what's stored, don't invent
  return {
    ok: true,
    text: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }),
  };
}
// Date / datetime cell — formatted display, editable as raw text (unparseable input degrades to text).
function DateCell({ value, withTime, onSave }: { value: unknown; withTime: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(String(value ?? "")); inputRef.current?.focus(); inputRef.current?.select(); } }, [editing, value]);
  function commit() { onSave(draft.trim()); setEditing(false); }
  const { text, ok } = fmtAbsDate(value, withTime);
  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder={withTime ? "2026-01-31 14:00" : "2026-01-31"}
        className="w-full max-w-[150px] bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none font-mono"/>
    );
  }
  return (
    <button onClick={() => setEditing(true)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-left w-full truncate rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]">
      {text ? <span className={ok ? "tabular-nums" : ""}>{text}</span> : <span className="text-[var(--text-faint)]">— date</span>}
    </button>
  );
}
// Multi-select — renders the stored value (array OR comma string) as read chips; unknown shapes
// degrade to plain text. No fabricated options; empty shows a dash.
function MultiSelectChips({ value }: { value: unknown }) {
  const parts = Array.isArray(value)
    ? value.map(v => String(v)).filter(Boolean)
    : String(value ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!parts.length) return <span className="text-[12px] text-[var(--text-faint)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.slice(0, 6).map((p, i) => (
        <span key={i} className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{p}</span>
      ))}
      {parts.length > 6 && <span className="text-[10px] text-[var(--text-faint)]">+{parts.length - 6}</span>}
    </div>
  );
}
// url / email / phone — a typed link when the value plausibly matches, else honest plain text.
function ContactCell({ value, kind }: { value: unknown; kind: "url" | "email" | "phone" }) {
  const s = String(value ?? "").trim();
  if (!s) return <span className="text-[12px] text-[var(--text-faint)]">—</span>;
  const linkClass = "text-[#717784] hover:text-[var(--text-primary)] text-[11px] underline underline-offset-2 truncate block max-w-[160px]";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (kind === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return <a href={`mailto:${s}`} onClick={stop} className={linkClass}>{s}</a>;
  }
  if (kind === "phone" && /[0-9]/.test(s) && /^[+()\-.\s0-9]{5,}$/.test(s)) {
    return <a href={`tel:${s.replace(/[^\d+]/g, "")}`} onClick={stop} className={linkClass}>{s}</a>;
  }
  if (kind === "url" && /^https?:\/\//i.test(s)) {
    return <a href={s} target="_blank" rel="noreferrer" onClick={stop} className={linkClass}>{s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 30)}</a>;
  }
  return <span className="text-[var(--text-secondary)] text-[11px] truncate block max-w-[160px]">{s}</span>;
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

  // `label` does not exist on object_definitions — the table stores name_singular / name_plural.
  // Declaring it here made `obj.label` typecheck while being undefined at runtime for all 15 object
  // types, so the relation picker silently fell back to raw slugs ("discovered-leads", "people").
  const { data: objectDefs = [] } = useQuery<{ id: string; slug: string; name_singular?: string; name_plural?: string }[]>({
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
    <div ref={ref} className="relative">
      <button ref={btnRef} onClick={openDropdown}
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors max-w-[140px] truncate">
        {current
          ? <><Link2 size={10} className="text-[#717784] shrink-0"/><span className="truncate">{current.label}</span></>
          : <span className="text-[var(--text-faint)]">— link record</span>
        }
      </button>
      {open && createPortal(
        <div ref={ref} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-56 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] py-1">
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
        <span className="mr-0.5 text-[11.5px] font-medium text-[var(--text-secondary)] first-letter:uppercase">{colLabel(col)}</span>
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

/** One page of records. `/nodes` caps limit at 1000; the exact total comes from /nodes/counts. */
const PAGE_LIMIT = 1000;

// ── Filter conditions (search-first redesign, 2026-07-31) ─────────────────────
/** ops before/after are dates; gt/lt are numeric and CLIENT-side only (jsonb text-compare lies
 *  about numbers, so the server never pretends to answer them — see ubc.NodeFilter). */
export type CondOp = "is" | "is_not" | "contains" | "empty" | "not_empty" | "before" | "after" | "gt" | "lt";
export type Cond = { col: string; op: CondOp; value?: string };
const OP_LABEL: Record<CondOp, string> = {
  is: "is", is_not: "is not", contains: "contains", empty: "is empty", not_empty: "is not empty",
  before: "before", after: "after", gt: "more than", lt: "less than",
};
/** last_activity is a pseudo-column over updated_at — "no activity in 30 days" as one condition. */
const LAST_ACTIVITY = "last_activity";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Infer a column's kind from its live values so the condition builder offers the right operators
 *  and input (dates get before/after, numbers get more/less-than, bounded sets get a picker). */
function inferColKind(records: NodeRecord[], col: string, customType?: string): "date" | "number" | "select" | "text" {
  if (col === LAST_ACTIVITY) return "date";
  if (customType) {
    if (customType === "date") return "date";
    if (customType === "number" || customType === "currency" || customType === "percentage") return "number";
    if (["stage", "status", "select", "country", "assignee", "owner"].includes(customType)) return "select";
  }
  const vals: string[] = [];
  for (const r of records) { const v = cellValue(r, col); if (v != null && v !== "") { vals.push(String(v)); if (vals.length >= 50) break; } }
  if (!vals.length) return "text";
  if (vals.every(v => /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
  if (vals.every(v => !isNaN(parseFloat(v)) && /^[\d.,%$€£\s-]+$/.test(v))) return "number";
  if (new Set(vals.map(v => v.toLowerCase())).size <= 15) return "select";
  return "text";
}
const OPS_FOR_KIND: Record<ReturnType<typeof inferColKind>, CondOp[]> = {
  date:   ["after", "before", "empty", "not_empty"],
  number: ["gt", "lt", "is", "empty", "not_empty"],
  select: ["is", "is_not", "empty", "not_empty"],
  text:   ["contains", "is", "is_not", "empty", "not_empty"],
};
/** Columns shown before the user opens the Columns panel; the rest start hidden, not discarded. */
const DEFAULT_VISIBLE_COLS = 8;


// ── FilterBar — search-first structured conditions (2026-07-31 redesign) ──────
/** Active chips + a "+ Filter" builder: field → operator → value. Operators and the value input
 *  come from the column's inferred kind; bounded columns get a picker of their real values. */
function FilterBar({ records, columns, customCols, conditions, onChange, onClose }: {
  records: NodeRecord[];
  columns: string[];
  customCols: { key: string; type: string }[];
  conditions: Cond[];
  onChange: (c: Cond[]) => void;
  onClose: () => void;
}) {
  const [draftCol, setDraftCol] = useState<string | null>(null);
  const [draftOp, setDraftOp] = useState<CondOp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [colSearch, setColSearch] = useState("");

  const kindOf = (col: string) => inferColKind(records, col, customCols.find(c => c.key === col)?.type);
  const label = (col: string) => (col === LAST_ACTIVITY ? "last activity" : colLabel(col));
  const valueOptions = (col: string): string[] =>
    [...new Set(records.map(r => String(cellValue(r, col) ?? "")).filter(Boolean))].sort().slice(0, 30);

  const commit = (op: CondOp, value?: string) => {
    if (!draftCol) return;
    onChange([...conditions, { col: draftCol, op, value }]);
    setDraftCol(null); setDraftOp(null); setDraftValue(""); setPickerOpen(false);
  };
  // last_activity presets — "no activity in N days" is one click, not a date calculation.
  const daysAgoIso = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0">
      {conditions.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-2 py-1 text-[11px] text-[var(--text-primary)]">
          <span className="text-[var(--text-muted)] first-letter:uppercase">{label(c.col)}</span>
          <span className="text-[var(--text-faint)]">{OP_LABEL[c.op]}</span>
          {c.value != null && c.value !== "" && <span className="max-w-40 truncate font-medium">{kindOf(c.col) === "date" && c.col === LAST_ACTIVITY ? new Date(c.value).toLocaleDateString() : c.value}</span>}
          <button onClick={() => onChange(conditions.filter((_, j) => j !== i))} aria-label="Remove filter"
            className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"><X size={10}/></button>
        </span>
      ))}

      {/* + Filter builder */}
      <div className="relative">
        <button onClick={() => { setPickerOpen(o => !o); setDraftCol(null); setDraftOp(null); }}
          className="flex items-center gap-1 rounded-sm border border-dashed border-[var(--border-soft)] px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]">
          <Plus size={10}/> Filter
        </button>
        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setPickerOpen(false); setDraftCol(null); setDraftOp(null); }}/>
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-1">
              {!draftCol ? (
                <>
                  {/* Searchable + capped: the raw list rendered EVERY column unbounded, running
                      off-screen on wide sheets — fields looked broken because they were unreachable. */}
                  {columns.length > 8 && (
                    <input autoFocus value={colSearch} onChange={e => setColSearch(e.target.value)}
                      placeholder="Find a field…" className="mb-1 w-full rounded-sm border border-[var(--border-soft)] bg-transparent px-2 py-1 text-[11.5px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"/>
                  )}
                  <div className="max-h-64 overflow-y-auto">
                    {columns.filter(col => !colSearch || label(col).toLowerCase().includes(colSearch.toLowerCase())).map(col => (
                      <button key={col} onClick={() => { setDraftCol(col); setColSearch(""); }}
                        className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors first-letter:uppercase hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                        {label(col)}
                      </button>
                    ))}
                  </div>
                </>
              ) : !draftOp ? (
                <>
                  <p className="px-2.5 py-1 text-[10px] text-[var(--text-faint)] first-letter:uppercase">{label(draftCol)}</p>
                  {/owner|assign/i.test(draftCol) && (
                    <>
                      <button onClick={() => commit("empty")}
                        className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">Unassigned</button>
                      <button onClick={() => commit("not_empty")}
                        className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">Assigned</button>
                    </>
                  )}
                  {draftCol === LAST_ACTIVITY && ([["No activity in 30 days", 30], ["No activity in 60 days", 60], ["No activity in 90 days", 90]] as const).map(([txt, d]) => (
                    <button key={d} onClick={() => commit("before", daysAgoIso(d))}
                      className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">{txt}</button>
                  ))}
                  {OPS_FOR_KIND[kindOf(draftCol)].map(op => (
                    <button key={op} onClick={() => (op === "empty" || op === "not_empty") ? commit(op) : setDraftOp(op)}
                      className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">{OP_LABEL[op]}</button>
                  ))}
                </>
              ) : (
                <div className="p-1.5">
                  <p className="mb-1 text-[10px] text-[var(--text-faint)]"><span className="first-letter:uppercase">{label(draftCol)}</span> {OP_LABEL[draftOp]}…</p>
                  {kindOf(draftCol) === "select" && (draftOp === "is" || draftOp === "is_not") ? (
                    <div className="max-h-56 overflow-y-auto">
                    {valueOptions(draftCol).map(v => (
                      <button key={v} onClick={() => commit(draftOp, v)}
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">{v}</button>
                    ))}
                    </div>
                  ) : (
                    <input autoFocus
                      type={kindOf(draftCol) === "date" ? "date" : kindOf(draftCol) === "number" ? "number" : "text"}
                      value={draftValue} onChange={e => setDraftValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && draftValue) commit(draftOp, draftValue); if (e.key === "Escape") { setDraftOp(null); setDraftValue(""); } }}
                      placeholder="Value — Enter to apply" className="key-input w-full px-2 py-1.5 text-[11.5px]"/>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {conditions.length > 0 && (
        <button onClick={() => onChange([])} className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">Clear all</button>
      )}
      <button onClick={onClose} className="ml-auto text-[var(--text-secondary)] shrink-0 hover:text-[var(--text-primary)]"><X size={13}/></button>
    </div>
  );
}

// ── FilterBar end ──

// ─── Main table ───────────────────────────────────────────────────────────────
// `filterQuery` prop removed (2026-07-31 audit): the only call site never passed it, so it was
// permanently "" — one of three identical free-text filters. filterText + toolbarSearch remain.
export interface SheetViewState {
  search: string; setSearch: (v: string) => void;
  conditions: Cond[]; setConditions: (v: Cond[] | ((p: Cond[]) => Cond[])) => void;
  sortRules: SortRule[]; setSortRules: (v: SortRule[] | ((p: SortRule[]) => SortRule[])) => void;
}
export function RecordTable({ objectType, enrichedIds = [], onColumnsChange, view }: { objectType: string; enrichedIds?: string[]; onColumnsChange?: (cols: string[]) => void; view: SheetViewState }) {
  const qc = useQueryClient();
  // ── Filter — search-first + structured condition chips (2026-07-31 redesign) ──
  // ONE text filter (the always-visible toolbar search) instead of the previous three parallel
  // ones, plus explicit conditions added via "+ Filter": field → operator → value, rendered as
  // removable chips. The old model was a permanent dropdown-per-column row.
  // LIFTED to the page (2026-08-01): switching Table→Board silently discarded the user's whole
  // filter set because this state lived here. Both views now share it.
  const { search: toolbarSearch, setSearch: setToolbarSearch, conditions, setConditions } = view;
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  // Search + SQL-representable conditions also go to the SERVER (debounced), so filtering covers
  // every record of the type — not just the loaded page. The client predicate below still runs for
  // instant feedback and for the numeric ops jsonb text-compare can't do honestly (gt/lt).
  const debouncedSearch = useDebounced(toolbarSearch.trim(), 300);
  const serverConds = useMemo(() => conditions.filter(c => c.op !== "gt" && c.op !== "lt" && !/owner|assign/i.test(c.col)), [conditions]);

  // ── ONE sort model (2026-08-01 rebuild): sortRules is the whole truth. The old header-click
  // "quick sort" was a second, parallel system — each silently cancelled the other. Header clicks
  // now edit rule 0 of the same list the Sort panel manages. The PRIMARY rule is sent to the
  // server so SQL orders the whole type and the page received is the true top-N — sorting only
  // the loaded page silently sorted the wrong subset on any type past the cap. Numeric columns
  // sort via the jsonb value (data->col), where numbers compare numerically.
  const { sortRules, setSortRules } = view;
  const primarySort = sortRules[0] ?? null;
  // Whether the primary sort column is numeric is LEARNED from the loaded rows (declared below),
  // so it lives in state and joins the query key — the first fetch may order as text, and the
  // corrected numeric ordering refetches the moment the column kind resolves.
  const [primarySortNumeric, setPrimarySortNumeric] = useState(false);

  const query = useQuery({
    queryKey: ["records", objectType, debouncedSearch, JSON.stringify(serverConds), primarySort?.col ?? "", primarySort?.dir ?? "", primarySortNumeric],
    queryFn: () => {
      const params = new URLSearchParams({ object_type: objectType, limit: String(PAGE_LIMIT) });
      if (debouncedSearch) {
        params.set("q", debouncedSearch);
        // the sheet's own columns join the server search — see ubc.listNodes q_cols
        params.set("q_cols", allColumnsWithCustom.filter(c => c !== LAST_ACTIVITY).join(","));
      }
      if (serverConds.length) params.set("filters", JSON.stringify(serverConds.map(c => ({ col: c.col, op: c.op, value: c.value }))));
      if (primarySort) {
        params.set("sort_col", primarySort.col);
        params.set("sort_dir", primarySort.dir);
        // jsonb numeric ordering for number-kind columns — text ordering would put 9 after 10
        if (primarySortNumeric) params.set("sort_numeric", "true");
      }
      return apiClient.get<NodeRecord[]>(`/nodes?${params}`);
    },
    placeholderData: keepPreviousData,
  });
  // The EXACT number of records of this type. The table only holds one page, so `records.length`
  // is a page size, not a total — it read "1000" for every type past a thousand rows, and the CSV
  // export silently stopped at the same edge with no indication.
  const countsQuery = useQuery({
    queryKey: ["node-counts"],
    queryFn: () => apiClient.get<{ total: number; by_type: Record<string, number> }>("/nodes/counts"),
    staleTime: 60_000,
  });

  const records = query.data ?? [];
  useEffect(() => {
    if (!primarySort) { setPrimarySortNumeric(false); return; }
    setPrimarySortNumeric(inferColKind(records, primarySort.col, customCols.find(cc => cc.key === primarySort.col)?.type) === "number");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primarySort?.col, records.length]);
  const totalOfType = countsQuery.data?.by_type?.[objectType] ?? records.length;
  // Truncated ONLY when the page hit the cap — `records` is the filtered result now, so comparing
  // it to the type total would flag every narrowed search as truncation.
  const truncated = records.length >= PAGE_LIMIT && totalOfType > records.length;

  // Column universe survives filtering: seed it from the unfiltered page and only EXTEND it when
  // new keys appear — never shrink because the current (filtered) rows carry fewer keys.
  const columnUniverse = useRef<{ type: string; keys: string[] }>({ type: "", keys: [] });
  const allColumns = useMemo(() => {
    if (columnUniverse.current.type !== objectType) columnUniverse.current = { type: objectType, keys: [] };
    const known = columnUniverse.current.keys;
    // keepPreviousData shows the OLD type's rows while the new query is in flight — extending the
    // universe from placeholder data wrote the previous sheet's columns into this one permanently.
    const fresh = query.isPlaceholderData ? [] : records.flatMap(r => Object.keys(r.data)).filter(k => !known.includes(k));
    if (fresh.length) columnUniverse.current.keys = [...known, ...fresh];
    const allKeys = Array.from(new Set(columnUniverse.current.keys))
      .filter(k => !HIDDEN_DATA_COLS.has(k));
    const nameKey = allKeys.find(k => k.toLowerCase() === "name");
    const rest = allKeys.filter(k => k.toLowerCase() !== "name");
    // Keep EVERY key. This used to .slice(0, 8) here, i.e. before the visibility layer, so a 9th
    // column simply did not exist anywhere in the UI. The 9th onward are now hidden-by-default
    // (see the hiddenCols seed) and can be switched back on from the Columns panel.
    const base = nameKey ? [nameKey, ...rest] : allKeys;
    // Surface node-level AI columns (lead_score / relationship_health) when any
    // record actually carries one — they aren't in the data jsonb, so the key
    // scan above never finds them.
    const nodeCols = NODE_LEVEL_COLS.filter(c => records.some(r => (r as NodeRecord)[c as "lead_score"] != null));
    return [...base, ...nodeCols.filter(c => !base.includes(c))];
  }, [records, objectType]);

  // ── Column visibility (allColumnsWithCustom declared after customCols below) ──
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  // Seed once per object type: show the first DEFAULT_VISIBLE_COLS columns, hide the rest. Same
  // default density as before, except the extra columns are now RECOVERABLE from the Columns panel
  // instead of being dropped from the data model entirely.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === objectType || allColumns.length === 0) return;
    seededFor.current = objectType;
    // Default visibility, with three rules on top of "first N":
    //  • AI columns (lead_score/relationship_health) never start hidden.
    //  • Only ONE owner-ish column starts visible (deal_owner > owner > assigned_to) — sheets
    //    were showing Owner AND Deal owner side by side saying the same thing.
    //  • Only ONE stage-ish and ONE status-ish column start visible, same reason.
    // Everything hidden here stays recoverable from the Columns panel.
    const ownerish = allColumns.filter(c => /owner|assign/i.test(c));
    const keepOwner = ownerish.find(c => /^deal_owner$/i.test(c)) ?? ownerish.find(c => /^owner$/i.test(c)) ?? ownerish[0];
    const stageish = allColumns.filter(c => /stage/i.test(c));
    const statusish = allColumns.filter(c => /status/i.test(c) && !/stage/i.test(c));
    const dupExtras = [
      ...ownerish.filter(c => c !== keepOwner),
      ...stageish.slice(1),
      ...statusish.slice(1),
    ];
    setHiddenCols(new Set([
      ...allColumns.slice(DEFAULT_VISIBLE_COLS).filter(c => !NODE_LEVEL_COLS.includes(c)),
      ...dupExtras,
    ]));
  }, [objectType, allColumns]);
  function toggleCol(col: string) {
    setHiddenCols(prev => { const n = new Set(prev); n.has(col) ? n.delete(col) : n.add(col); return n; });
  }


  // ── Calc state ──
  const [calculations, setCalculations] = useState<Record<string, CalcOp>>({});
  const [openCalcCol, setOpenCalcCol] = useState<string | null>(null);


  // ── NLP ──

  // ── Toolbar dropdown open state ──
  const [openPanel, setOpenPanel] = useState<"view"|"sort"|"filter"|"export"|"addcol"|"groupby"|"views"|"ask"|null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // Add column lives in the table header now
  const addColHeaderRef = useRef<HTMLTableCellElement>(null);

  // ── Calc footer trigger refs (dynamic columns) ──
  const calcWrapRefs = useRef(new Map<string, HTMLDivElement>());

  // ── Custom columns — persisted to localStorage per objectType ──
  const customColsKey = `mondaily_custom_cols_${objectType}`;
  // WORKSPACE-SHARED custom columns (2026-07-31): the server (nodes sheet_config) is the source
  // of truth so every member sees the same sheet; localStorage remains a fast-paint cache and the
  // one-time migration source for columns created in the per-browser era.
  const [customCols, setCustomCols] = useState<{ key: string; type: string; meta?: Record<string, string> }[]>(() => {
    try { return JSON.parse(localStorage.getItem(customColsKey) ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    let cancelled = false;
    // paint from cache immediately, then reconcile with the server
    try { setCustomCols(JSON.parse(localStorage.getItem(`mondaily_custom_cols_${objectType}`) ?? "[]")); }
    catch { setCustomCols([]); }
    apiClient.get<{ columns: { key: string; type: string; meta?: Record<string, string> }[]; exists: boolean }>(`/records/sheet-config/${encodeURIComponent(objectType)}`)
      .then(r => {
        if (cancelled) return;
        if (r.exists) {
          setCustomCols(r.columns);
          localStorage.setItem(`mondaily_custom_cols_${objectType}`, JSON.stringify(r.columns));
        } else {
          // one-time migration: this browser has columns the workspace doesn't — push them up
          const local = JSON.parse(localStorage.getItem(`mondaily_custom_cols_${objectType}`) ?? "[]");
          if (Array.isArray(local) && local.length > 0) {
            apiClient.post(`/records/sheet-config/${encodeURIComponent(objectType)}`, { columns: local }).catch(() => {});
          }
        }
      })
      .catch(() => { /* offline/legacy server — the local cache keeps working */ });
    return () => { cancelled = true; };
  }, [objectType]);

  function saveCustomCols(next: { key: string; type: string; meta?: Record<string, string> }[]) {
    setCustomCols(next);
    localStorage.setItem(`mondaily_custom_cols_${objectType}`, JSON.stringify(next));
    apiClient.post(`/records/sheet-config/${encodeURIComponent(objectType)}`, { columns: next }).catch(() => {});
  }

  // Record-ID column is handled separately (locked between checkbox and name)
  const hasRecordIdCol = customCols.some(c => c.type === "record_id");
  // Non-ID custom cols go into the regular column flow
  const regularCustomCols = customCols.filter(c => c.type !== "record_id");

  // Workspace currency context — base + display override + ECB rates (fail-closed conversion).
  const { base: wsBase, display: wsDisplay, rates: fxRates } = useCurrency();

  // Server field types are AUTHORITATIVE when present: the persisted object_definitions.attributes
  // carry a real type enum (currency/percentage/checkbox/date/…). We map each attribute → its data
  // key via the same normalization the create form uses (lower + spaces→underscore). An explicit
  // local preset (customCols) still overrides; name inference remains the final fallback.
  const { data: objectDefsForTypes = [] } = useQuery<{ id: string; slug: string; attributes?: { name: string; type?: string; options?: string[] }[] }[]>({
    queryKey: ["object-defs"],
    queryFn: () => apiClient.get("/objects"),
    staleTime: 60_000,
  });
  const serverAttrType = useMemo(() => {
    const def = objectDefsForTypes.find(o => o.slug === objectType);
    const m = new Map<string, string>();
    for (const a of def?.attributes ?? []) {
      if (a?.type) m.set(a.name.toLowerCase().replace(/\s+/g, "_"), a.type);
    }
    return m;
  }, [objectDefsForTypes, objectType]);
  // Persisted select/multi_select option lists (when the schema provides them). Used as a clean
  // starting set; distinct existing column values are merged in so the picker always has real choices.
  const serverAttrOptions = useMemo(() => {
    const def = objectDefsForTypes.find(o => o.slug === objectType);
    const m = new Map<string, string[]>();
    for (const a of def?.attributes ?? []) {
      if (Array.isArray(a?.options) && a.options.length) m.set(a.name.toLowerCase().replace(/\s+/g, "_"), a.options.map(String));
    }
    return m;
  }, [objectDefsForTypes, objectType]);
  // Effective type for a column: explicit local preset → persisted server type → undefined (fall back
  // to the existing name/value inference). Only the spreadsheet display types are consumed here.
  const effectiveType = useCallback((col: string): string | undefined => {
    const local = customCols.find(cc => cc.key === col)?.type;
    if (local) return local;
    return serverAttrType.get(col);
  }, [customCols, serverAttrType]);
  // Numeric treatment (right-align, mono, header alignment) comes from the RESOLVED type first;
  // the name heuristic only covers untyped columns — one type source, not two disagreeing ones.
  const isNumericCol = useCallback((col: string): boolean => {
    const t = effectiveType(col);
    if (t) return ["number", "currency", "percentage", "formula", "finance_billed", "finance_outstanding"].includes(t);
    if (/phone/i.test(col)) return false;   // phone numbers are identifiers, not quantities
    return isNumeric(col);
  }, [effectiveType]);

  // Finance rollup — one query powers the "Finance · Billed/Outstanding" computed columns for the
  // whole sheet (no per-row fetch). Only runs when such a column is actually added.
  const hasFinanceCol = customCols.some(c => c.type === "finance_billed" || c.type === "finance_outstanding");
  const financeRollup = useQuery({
    queryKey: ["invoices-rollup"],
    queryFn: () => apiClient.get<{ base: string; clients: Record<string, { billed: number; collected: number; outstanding: number; count: number }> }>("/invoices/rollup"),
    enabled: hasFinanceCol,
    staleTime: 60_000,
  });

  // Dedupe: a custom column whose key collides with a data-derived key (e.g. a "Country" custom
  // column on a sheet whose records already carry `country`) rendered the SAME key twice —
  // duplicate React keys orphaned one td's fiber, leaving a visible but completely DEAD cell
  // (clicks reached the handler, state updates were enqueued and never flushed). One key, one column.
  const allColumnsWithCustom = useMemo(
    () => [...allColumns, ...regularCustomCols.map(c => c.key).filter(k => !allColumns.some(a => a.toLowerCase() === k.toLowerCase()))],
    [allColumns, regularCustomCols],
  );
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

  // Emit the FULL column universe, not the visible subset — visibility is a display concern, and
  // the create drawer was offering only the 8 default-visible fields.
  useEffect(() => { onColumnsChange?.(allColumnsWithCustom); }, [allColumnsWithCustom]);

  // ── Owner cell state: recordId → owner name ──
  // owners[recordId][col] — separate tracker per column so Deal Owner ≠ Assigned To
  const [owners, setOwners] = useState<Record<string, Record<string, string>>>({});
  // Local display overlay only — MUST reset when the sheet changes or a reassignment made on one
  // sheet haunted rows with the same ids… and simply never expired against server truth.
  useEffect(() => { setOwners({}); }, [objectType]);
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
    // Column visibility is NOT reset here — the seeding effect above owns it per object type.
    // (search/conditions/sort reset lives on the PAGE now, which owns that state.)
  }, [objectType]);

  function handleHeaderSort(col: string) {
    // Edits rule 0 of the ONE list: same col toggles direction; a new col becomes the primary
    // sort and clears the stack (header clicks express "sort by this now").
    setSortRules(prev => prev[0]?.col === col
      ? [{ col, dir: prev[0].dir === "asc" ? "desc" : "asc" }, ...prev.slice(1)]
      : [{ col, dir: "asc" }]);
  }

  // SERVER-side CSV: the whole filtered set (same q/filters/sort the view uses), not just the
  // loaded page — and the role export permission from Security settings is enforced there.
  const [exportErr, setExportErr] = useState<string | null>(null);
  async function exportCSV() {
    setExportErr(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (serverConds.length) params.set("filters", JSON.stringify(serverConds.map(cd => ({ col: cd.col, op: cd.op, value: cd.value }))));
      if (primarySort) { params.set("sort_col", primarySort.col); params.set("sort_dir", primarySort.dir); }
      const res = await apiFetch(`${(import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || ""}/api/v1/records/export/${encodeURIComponent(objectType)}?${params}`, { headers: await getAuthHeaders() });
      if (!res.ok) { const j = await res.json().catch(() => ({})) as { error?: string }; throw new Error(j.error || "Export failed."); }
      const blob = await res.blob();
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${objectType}.csv` });
      a.click(); URL.revokeObjectURL(a.href); setOpenPanel(null);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Export failed.");
    }
  }

  const [nlpActive, setNlpActive] = useState(false);
  const handleNLPApply = useCallback((ft: string, sc: string | null, sd: SortDir, ops: Record<string, "sum"|"avg"|"min"|"max"|"count">, conds?: Cond[]) => {
    // Structured conditions land as the SAME removable chips a manual filter creates — the user
    // sees and can undo exactly what the AI applied, instead of an opaque text search.
    if (conds?.length) { setConditions(conds); setOpenPanel("filter"); }
    if (ft) setToolbarSearch(ft);
    if (sc) setSortRules([{ col: sc, dir: sd }]);
    if (Object.keys(ops).length) setCalculations(prev => ({ ...prev, ...ops }));
    setNlpActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filter → sort pipeline ──
  const filtered = useMemo(() => {
    let base = records;
    // Instant text pass while the debounced server query is in flight (the server then re-answers
    // over ALL records, incl. `last_activity` which lives on updated_at, not in data).
    if (toolbarSearch.trim()) {
      const q3 = toolbarSearch.toLowerCase();
      base = base.filter(r => Object.values(r.data).some(v => String(v ?? "").toLowerCase().includes(q3)));
    }
    if (conditions.length) {
      base = base.filter(r => conditions.every(c => {
        // last_activity is the record's updated_at — a real filterable dimension now.
        const raw = c.col === "last_activity" ? r.updated_at
          : /owner|assign/i.test(c.col) ? (owners[r.id]?.[c.col] ?? resolveOwner(cellValue(r, c.col)))
          : cellValue(r, c.col);
        const v = String(raw ?? "");
        const want = String(c.value ?? "");
        switch (c.op) {
          case "is":        return v.toLowerCase() === want.toLowerCase();
          case "is_not":    return v.toLowerCase() !== want.toLowerCase();
          case "contains":  return v.toLowerCase().includes(want.toLowerCase());
          case "empty":     return v === "";
          case "not_empty": return v !== "";
          case "after":     return v >= want;         // ISO date strings compare correctly as text
          case "before":    return v !== "" && v <= want;
          case "gt":        return (parseNumeric(v) ?? NaN) > (parseNumeric(want) ?? NaN);   // numeric — client-side only
          case "lt":        return (parseNumeric(v) ?? NaN) < (parseNumeric(want) ?? NaN);
          default:          return true;
        }
      }));
    }
    return base;
  }, [records, toolbarSearch, conditions, owners]);
  // Health filter is applied over the sorted page below (healthOf needs dupCounts, declared later).   // `owners` IS read above (owner/assignee branch) — without it a reassignment left the filtered view stale

  const sorted = useMemo(() => {
    // The page arrives pre-ordered by the primary rule (SQL); re-sorting here is a no-op for rule
    // 0 and applies the stacked tie-break rules over the page.
    const rules = sortRules;
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
  }, [filtered, sortRules]);

  function SortIcon({ col }: { col: string }) {
    const rule = sortRules.find(r => r.col === col);
    if (rule) return rule.dir === "asc" ? <ChevronUp size={10} className="text-stone-400 ml-1 shrink-0"/> : <ChevronDown size={10} className="text-stone-400 ml-1 shrink-0"/>;
    return <ChevronsUpDown size={10} className="text-stone-700 ml-1 shrink-0"/>;
  }

  const nameCol = columns[0];
  const members = membersQuery.data ?? [];
  // Name column sticky offset changes when the Record ID locked column is present
  const nameLeft = hasRecordIdCol ? "left-[112px]" : "left-8";

  // ── Column widths: auto-fit content, capped per kind; manual resize overrides ──
  // Cells are ALWAYS single-line (a wrapped cell breaks row scanning). A column sizes itself to
  // its content — including its own footer total, which must never truncate — up to a hard cap so
  // one 1000-character value can't wreck the layout. Past the cap: ellipsis + hover tooltip.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const autoWidths = useMemo(() => {
    const CAPS: Record<ReturnType<typeof inferColKind>, [number, number]> = {
      number: [96, 150], date: [110, 160], select: [110, 180], text: [120, 360],
    };
    const out: Record<string, number> = {};
    for (const col of allColumnsWithCustom) {
      const kind = inferColKind(records, col, customCols.find(c => c.key === col)?.type);
      const [min, cap] = col.toLowerCase() === "name" ? [140, 260] : CAPS[kind];
      let maxLen = colLabel(col).length + 3;   // header label + sort icon
      for (const r of records.slice(0, 60)) {
        const v = display(cellValue(r, col));
        if (v && v !== "—") maxLen = Math.max(maxLen, Math.min(v.length, 60));
      }
      const total = calculations[col] ? calcResultTyped(calculations[col], col, records, effectiveType(col), { display: wsDisplay, rates: fxRates, base: wsBase }) : "";
      maxLen = Math.max(maxLen, total.length);
      const pillChrome = kind === "select" ? 40 : 0;
      out[col] = Math.round(Math.min(min + pillChrome + Math.max(0, maxLen - 8) * 7.2, Math.max(cap + pillChrome, total.length * 7.2 + 34)));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allColumnsWithCustom, records, calculations, customCols, wsBase, wsDisplay, fxRates]);
  const effectiveWidth = (col: string): number => colWidths[col] ?? autoWidths[col] ?? 160;
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
    const rows = visibleRows.filter(r => selected.has(r.id));
    // Already-set rows are SKIPPED and reported — assigning someone who is already the assignee
    // silently rewrote rows and told the user nothing.
    const already = rows.filter(r => String((owners[r.id]?.[col] ?? resolveOwner(cellValue(r, col))) ?? "").trim().toLowerCase() === value.trim().toLowerCase());
    const toChange = rows.filter(r => !already.includes(r));
    toChange.forEach(record => saveCell(record, col, value));
    setBulkEditField(null);
    if (already.length && !toChange.length) showFlash(`All ${already.length} selected record${already.length === 1 ? " is" : "s are"} already set to "${value}" — nothing changed.`, "warn");
    else if (already.length) showFlash(`Set ${toChange.length}; ${already.length} already "${value}" and skipped.`, "ok");
    else if (toChange.length) showFlash(`Set ${colLabel(col)} = "${value}" on ${toChange.length} record${toChange.length === 1 ? "" : "s"}.`, "ok");
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupByCol, setGroupByCol] = useState<string | null>(() => {
    try { return localStorage.getItem(groupByKey) ?? null; } catch { return null; }
  });
  function setGroupBy(col: string | null) {
    setGroupByCol(col);
    if (col) localStorage.setItem(groupByKey, col); else localStorage.removeItem(groupByKey);
  }

  // ── Group subtotals (Phase 3b.1) ──
  // When the view is grouped AND a column has an active calc, ask the server for per-group aggregates
  // so grouped views show Excel-style subtotals over the whole (optionally filtered) table. Falls back
  // to a client per-group calc if the request is disabled/loading/errored (never a fake number).
  const groupCalcCol = groupByCol ? (Object.keys(calculations).find(k => calculations[k]) ?? null) : null;
  const groupCalcOp: CalcOp = groupCalcCol ? (calculations[groupCalcCol] ?? null) : null;
  const groupCalcKind = groupCalcCol ? effectiveType(groupCalcCol) : undefined;
  // Only send filters when the whole active set is server-representable; otherwise disable the server
  // group query and fall back to the client per-group calc (honest, over the visible rows).
  const groupByIsDate = groupByCol ? inferColKind(records, groupByCol, customCols.find(cc => cc.key === groupByCol)?.type) === "date" : false;
  const groupFiltersRepresentable = !toolbarSearch.trim() && serverFilters(conditions).length === conditions.length && !groupByIsDate;
  const groupAggQ = useQuery<{ groups?: { label: string; value: number; count: number; unconverted: number }[]; currency: string | null }>({
    queryKey: ["records-group-agg", objectType, groupByCol, groupCalcCol, groupCalcOp, groupCalcKind === "currency", JSON.stringify(groupFiltersRepresentable ? serverFilters(conditions) : "client")],
    queryFn: () => apiClient.post("/records/aggregate", { object_type: objectType, column: groupCalcCol, op: serverAggOp(groupCalcKind, groupCalcOp), group_by: groupByCol, group_exact: true, currency: groupCalcKind === "currency", ...(serverFilters(conditions).length ? { filters: serverFilters(conditions) } : {}) }),
    enabled: !!(groupByCol && groupCalcCol && groupCalcOp && serverAggOp(groupCalcKind, groupCalcOp) && groupFiltersRepresentable),
    staleTime: 30_000,
    retry: false,
  });
  const groupSubtotals = useMemo(() => {
    const m = new Map<string, { value: number; count: number; unconverted: number }>();
    for (const g of groupAggQ.data?.groups ?? []) m.set(g.label, g);
    return m;
  }, [groupAggQ.data]);
  const groupAggCurrency = groupAggQ.data?.currency ?? wsDisplay;

  // ── Saved views ──
  const savedViewsKey = `mondaily_views_${objectType}`;
  interface SavedView { id: string; name: string; filters: (Cond | { col: string; value: string })[]; sortRules: typeof sortRules; hiddenCols: string[]; groupBy: string | null }
  // Views saved before the 2026-07-31 filter redesign stored {col,value} equality pairs (with
  // __from/__to date-range suffixes) — migrate on read so nobody's saved views break.
  const migrateView = (f: Cond | { col: string; value: string }): Cond =>
    "op" in f ? f
    : f.col.endsWith("__from") ? { col: f.col.slice(0, -6), op: "after", value: f.value }
    : f.col.endsWith("__to") ? { col: f.col.slice(0, -4), op: "before", value: f.value }
    : { col: f.col, op: "is", value: f.value };
  // WORKSPACE-SHARED views (2026-08-01): stored on the server's sheet_config row, so your team
  // sees the same views on every device. localStorage was per-browser — invisible to teammates,
  // gone on a new machine. Any views already in THIS browser migrate up once, then the server owns.
  const viewsQ = useQuery({
    queryKey: ["sheet-views", objectType],
    queryFn: () => apiClient.get<{ views: SavedView[] }>(`/records/sheet-views/${encodeURIComponent(objectType)}`),
    staleTime: 60_000,
  });
  const savedViews = viewsQ.data?.views ?? [];
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || !viewsQ.isSuccess) return;
    migratedRef.current = true;
    try {
      const local: SavedView[] = JSON.parse(localStorage.getItem(savedViewsKey) ?? "[]");
      const unseen = local.filter(l => !savedViews.some(sv => sv.id === l.id));
      if (unseen.length) void persistViews([...savedViews, ...unseen]);
      if (local.length) localStorage.removeItem(savedViewsKey);
    } catch { /* nothing to migrate */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewsQ.isSuccess]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  async function persistViews(next: SavedView[]) {
    try {
      await apiClient.post(`/records/sheet-views/${encodeURIComponent(objectType)}`, { views: next });
      qc.invalidateQueries({ queryKey: ["sheet-views", objectType] });
    } catch { /* server rejected — the list refetches to truth on next read */ }
  }
  function saveCurrentView() {
    if (!newViewName.trim()) return;
    const view: SavedView = {
      id: crypto.randomUUID(),
      name: newViewName.trim(),
      filters: conditions,
      sortRules,
      hiddenCols: [...hiddenCols],
      groupBy: groupByCol,
    };
    persistViews([...savedViews, view]);
    setNewViewName("");
    setSaveViewOpen(false);
  }
  function applyView(view: SavedView) {
    setConditions(Array.isArray(view.filters) ? view.filters.map(migrateView) : []);
    setSortRules(Array.isArray(view.sortRules) ? view.sortRules : []);   // legacy entries may lack the key — this threw
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

  // ── Bulk selection ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cellTip, setCellTip] = useState<{ text: string; x: number; y: number } | null>(null);
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
    else setSelected(new Set(visibleRows.map(r => r.id)));
  }
  function toggleSelectRow(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Applies an optimistic update to EVERY cached records query for this type (table + board),
  // whatever search/filter/sort segments their keys carry — setQueryData with the old exact
  // 2-part key hit nothing once the key grew, so edits/deletes only appeared after a refetch.
  function patchRecordsCache(fn: (old: NodeRecord[]) => NodeRecord[]) {
    qc.setQueriesData<NodeRecord[]>(
      { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "records" && q.queryKey.includes(objectType) },
      (old) => fn(old ?? []),
    );
  }

  async function bulkDelete() {
    const ids = visibleRows.filter(r => selected.has(r.id)).map(r => r.id);   // visible ∩ selected — never rows filtered out of sight
    // Explicit, exact confirm — the user must see precisely what is being deleted.
    if (!window.confirm(`Delete ${ids.length} selected record${ids.length === 1 ? "" : "s"}? Only these ${ids.length} are deleted — nothing else.`)) return;
    setSelected(new Set());
    patchRecordsCache(old => old.filter(r => !ids.includes(r.id)));
    await Promise.all(ids.map(id => apiClient.delete(`/nodes/${id}`).catch((e) => console.error("[bg-task] swallowed error:", e))));
    qc.invalidateQueries({ queryKey: ["records"] });
    qc.invalidateQueries({ queryKey: ["node-counts"] });
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

  // ── Bulk set-field (2026-08-01): "set stage for the 40 selected" — categorical columns only,
  // real per-row PATCHes with honest per-row success/failure feedback, never a silent partial. ──
  const [setFieldOpen, setSetFieldOpen] = useState(false);
  const [setFieldCol, setSetFieldCol] = useState<string | null>(null);
  async function bulkSetField(col: string, value: string) {
    const rows = visibleRows.filter(r => selected.has(r.id));
    const results = await Promise.allSettled(rows.map(r => apiClient.patch(`/nodes/${r.id}`, { data: { ...r.data, [col]: value } })));
    const failed = results.filter(r => r.status === "rejected").length;
    const ok = results.length - failed;
    setSelected(new Set()); setSetFieldOpen(false); setSetFieldCol(null);
    qc.invalidateQueries({ queryKey: ["records", objectType] });
    if (failed === 0) showFlash(`Set ${colLabel(col)} = "${value}" on ${ok} record${ok === 1 ? "" : "s"}.`, "ok");
    else showFlash(`Set on ${ok}, failed on ${failed} — those rows were not changed.`, "warn");
  }
  const bulkEditableCols = allColumnsWithCustom.filter(c => /stage|status|priority|country|region|label|^category$|^type$/.test(c.toLowerCase()));

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
  const [pendingLoss, setPendingLoss] = useState<PendingLoss | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showFlash(msg: string, kind: "ok" | "warn") {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ msg, kind });
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  }

  // The Sum/Avg footer and the group calc bar are SERVER aggregates under their own query keys, so
  // an optimistic setQueryData on ["records"] left them showing pre-edit numbers — on money columns.
  function invalidateAggregates() {
    qc.invalidateQueries({ queryKey: ["records-agg"] });
    qc.invalidateQueries({ queryKey: ["records-group-agg"] });
  }

  function deleteRow(record: NodeRecord) {
    // Clear any existing undo toast first
    if (undoToast) {
      clearTimeout(undoToast.timer);
      apiClient.delete(`/nodes/${undoToast.record.id}`).catch((e) => console.error("[bg-task] swallowed error:", e));
    }
    // Optimistic remove
    patchRecordsCache(old => old.filter(r => r.id !== record.id));
    // Show undo toast for 6 seconds before actually deleting
    const timer = setTimeout(() => {
      apiClient.delete(`/nodes/${record.id}`)
        .then(invalidateAggregates)
        .catch(() => {
          qc.invalidateQueries({ queryKey: ["records", objectType] });
          invalidateAggregates();
        });
      setUndoToast(null);
    }, 6000);
    setUndoToast({ record, timer });
  }

  function undoDelete() {
    if (!undoToast) return;
    clearTimeout(undoToast.timer);
    patchRecordsCache(old => [...old, undoToast.record]);
    setUndoToast(null);
  }

  function saveCell(record: NodeRecord, col: string, newVal: string | number | boolean | object, extra?: Record<string, unknown>) {
    // Loss-reason capture: a stage-ish column moving to a lost value, with no reason on file,
    // pauses for ONE modal — reason + stage land in the SAME patch (read-merge-write).
    if (!extra && /stage|status/i.test(col) && isLostStage(newVal) && !record.data.loss_reason) {
      setPendingLoss({
        name: String(record.data.name ?? record.data.title ?? "This deal"),
        apply: (reason) => saveCell(record, col, newVal, reason ? { loss_reason: reason } : { }),
      });
      return;
    }
    const newData = { ...record.data, [col]: newVal, ...(extra ?? {}) };
    patchRecordsCache(old => old.map(r => r.id === record.id ? { ...r, data: newData } : r));
    apiClient.patch(`/nodes/${record.id}`, { data: newData })
      .then(() => {
        invalidateAggregates();
        if (col === primarySort?.col || serverConds.some(cd => cd.col === col)) qc.invalidateQueries({ queryKey: ["records"] });
      })
      .catch((e) => {
        // The optimistic value used to just snap back with no message — a viewer-role user (blocked
        // by denyViewerWrites) watched their edit appear and silently vanish.
        qc.invalidateQueries({ queryKey: ["records", objectType] });
        invalidateAggregates();
        setFlash({ kind: "warn", msg: e instanceof Error ? e.message : "Couldn't save that change." });
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 4000);
      });
  }

  // ── Row health (2026-08-01): RULE-based data-quality checks — computed locally, zero AI cost,
  // display only. Flags what is mechanically verifiable: malformed email/URL, duplicate name,
  // stale record, a won/closed deal with no value. "Fixing" stays a human action — the dot links
  // to the record, where enrichment PROPOSES values; nothing here writes.
  const healthOf = (record: NodeRecord): string[] => {
    const issues: string[] = [];
    const d = record.data;
    const email = String(d.email ?? "");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push("Email looks malformed");
    for (const k of ["source_url", "linkedin", "website", "url"]) {
      const v = String(d[k] ?? "");
      if (v && !/^https?:\/\//i.test(v) && v !== "—") issues.push(`${colLabel(k)} is not a valid link`);
    }
    if (dupCountOf(record) > 1) issues.push(`${dupCountOf(record)} records share this name — possible duplicate`);
    const ageDays = (Date.now() - new Date(record.updated_at).getTime()) / 86400_000;
    if (ageDays > 90) issues.push(`No activity in ${Math.floor(ageDays)} days`);
    const stage = String(d.deal_stage ?? d.stage ?? "").toLowerCase();
    const value = parseFloat(String(d.deal_value ?? d.value ?? d.amount ?? ""));
    if (/won|closed won/.test(stage) && (isNaN(value) || value === 0)) issues.push("Won deal with no value");
    return issues;
  };
  // Possible-duplicate indicator (display ONLY — no data is touched): identical primary names on
  // the loaded page get a small ×N marker, so three "Bassem Epra" rows read as one person entered
  // three times instead of silently looking like three people. Merging stays a separate,
  // supervised job for the cleaning toolkit.
  const dupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) {
      const n = String(r.data.name ?? r.data.title ?? r.data.full_name ?? "").trim().toLowerCase();
      if (n) m.set(n, (m.get(n) ?? 0) + 1);
    }
    return m;
  }, [records]);
  const dupCountOf = (record: NodeRecord): number => {
    const n = String(record.data.name ?? record.data.title ?? record.data.full_name ?? "").trim().toLowerCase();
    return n ? (dupCounts.get(n) ?? 0) : 0;
  };

  const flaggedCount = useMemo(() => sorted.reduce((n, r) => n + (healthOf(r).length ? 1 : 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted, dupCounts]);
  // What the grid actually renders: the sorted page, optionally narrowed to rows needing attention.
  const visibleRows = useMemo(() => showFlaggedOnly ? sorted.filter(r => healthOf(r).length > 0) : sorted,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted, showFlaggedOnly, dupCounts]);
  // The chip disappears when nothing is flagged — the narrow state must release with it, or the
  // grid stays empty with no visible control to clear it.
  useEffect(() => { if (flaggedCount === 0 && showFlaggedOnly) setShowFlaggedOnly(false); }, [flaggedCount, showFlaggedOnly]);
  const allSelected = visibleRows.length > 0 && visibleRows.every(r => selected.has(r.id));


  function renderCell(col: string, record: NodeRecord) {
    const val = cellValue(record, col);
    // Object-valued fields (agent-written structures) must NEVER fall through to the text editor:
    // the grid printed pipeline_health as raw JSON ("shows code"), and clicking it started a text
    // edit whose save destroyed the agent's structure. pipeline_health gets its real badge; any
    // other object renders read-only.
    if (val && typeof val === "object") {
      if (col === "pipeline_health") return <div className="px-2"><PipelineHealthBadge health={val as PipelineHealth} compact/></div>;
      return <span className="px-2 text-[11px]" style={{ color: "var(--text-faint)" }} title="Structured field — edited by agents, not by hand">structured</span>;
    }
    const isEnriched = enrichedIds.includes(record.id);
    const customDef = customCols.find(c => c.key === col);

    // Spreadsheet display types — resolved from the explicit local preset OR the persisted server
    // attribute type. These render as real typed cells; totals are handled type-aware in the footer.
    const kind = effectiveType(col);
    if (kind === "checkbox") {
      return <div className="px-2 py-1.5"><CheckboxCell value={val} onSave={v => saveCell(record, col, v)} /></div>;
    }
    if (kind === "currency") {
      const cur = String(record.data.currency ?? wsBase);
      return <div className="px-2 py-1.5 text-right"><CurrencyCell value={val} currency={cur} onSave={v => saveCell(record, col, v)} /></div>;
    }
    if (kind === "percentage") {
      return <div className="px-2 py-1.5 text-right"><PercentCell value={val} onSave={v => saveCell(record, col, v)} /></div>;
    }
    // Server 'number' — reuse the formula-aware number editor.
    if (kind === "number" && !customDef) {
      return <NumberCell value={val} onSave={v => saveCell(record, col, v)} />;
    }
    // Select — a clean picker built from any persisted options ∪ the distinct values already in the
    // column. If there are genuinely no options yet, degrade to a plain editable cell (never crash).
    if (kind === "select" && !/country/i.test(col)) {
      const opts = [...new Set([...(serverAttrOptions.get(col) ?? []), ...records.map(r => String(r.data[col] ?? "")).filter(Boolean)])];
      const shown = String(val ?? "");
      if (!opts.length) return <div className="px-2 py-1.5"><EditableCell raw={val} onSave={v => saveCell(record, col, v)} /></div>;
      return <StagePill value={shown} options={opts} onSelect={v => saveCell(record, col, v)} placeholder="— set" />;
    }
    // Multi-select — read chips from an array or comma string; unknown shapes degrade to text.
    if (kind === "multi_select") {
      if (val == null || (Array.isArray(val) && val.length === 0) || String(val).trim() === "") {
        return <div className="px-2 py-1.5"><EditableCell raw={val} onSave={v => saveCell(record, col, v)} /></div>;
      }
      return (
        <div className="px-2 py-1.5" title="Double-click to edit"
          onDoubleClick={e => { e.stopPropagation(); const next = window.prompt("Values (comma-separated):", Array.isArray(val) ? (val as unknown[]).join(", ") : String(val ?? "")); if (next != null) saveCell(record, col, next.split(",").map(x => x.trim()).filter(Boolean)); }}>
          <MultiSelectChips value={val} />
        </div>
      );
    }
    // Date / datetime — honest formatted display, editable as raw text; bad values degrade to text.
    if (kind === "datetime" || kind === "date") {
      return <div className="px-2 py-1.5"><DateCell value={val} withTime={kind === "datetime"} onSave={v => saveCell(record, col, v)} /></div>;
    }
    // Typed contact/link values — email/phone/url as links when plausible, else plain text.
    if (kind === "url" || kind === "email" || kind === "phone") {
      if (val == null || String(val).trim() === "") {
        // typing into an empty url/email/phone cell was impossible — read-only '—'
        return <div className="px-2 py-1.5"><EditableCell raw={val} onSave={v => saveCell(record, col, v)} /></div>;
      }
      return <div className="px-2 py-1.5"><EditableContactCell val={val} kind={kind} onSave={v => saveCell(record, col, v)}/></div>;
    }

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
    // Formula column — computed per row by the shared safe evaluator, read-only, honest #ERR.
    if (customDef?.type === "formula") {
      const res = evaluateFormula(customDef.meta?.formula ?? "", record.data as Record<string, unknown>);
      if (!res.ok) return <div className="px-2 py-1.5 text-right text-[11px]" style={{ color: "var(--status-error)" }} title={res.error}>#ERR</div>;
      const v = res.value;
      const rk = customDef.meta?.result;
      const text = v == null ? "—"
        : typeof v === "boolean" ? (v ? "✓" : "✗")
        : typeof v === "number" ? (rk === "currency" ? formatMoney(v, wsDisplay) : rk === "percent" ? `${v}%` : String(Math.round(v * 100) / 100))
        : String(v);
      return <div className="px-2 py-1.5 text-right text-[12px] tabular-nums" style={{ color: "var(--text-primary)" }} title={customDef.meta?.formula}>{text}</div>;
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

    // Country column — searchable dropdown. Name-based fallback so a country column that arrived
    // via CSV/AI/schema renders the same picker on EVERY sheet, not only where a per-sheet custom
    // column existed (the same column looked completely different across sheets).
    if (customDef?.type === "country" || (/country/i.test(col) && !customDef)) {
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
      return <StagePill value={shown} options={existingOptions} onSelect={v => saveCell(record, col, v)} placeholder={`— set ${customDef.type}`}/>;
    }

    // Relation column — link to a record in another object
    if (customDef?.type === "relation") {
      return <RelationCell value={val} relatedObjectType={customDef.meta?.relatedObjectType} onSave={v => saveCell(record, col, v as object)}/>;
    }

    // Custom column with an unmatched type (text is the DEFAULT) — a real editable cell. This
    // returned a dead '—' span: the most common custom column a user creates was uneditable.
    if (customDef) return <div className="px-2 py-1.5"><EditableCell raw={val} onSave={v => saveCell(record, col, v)} /></div>;

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
      return <StagePill value={shown} options={existingOptions} onSelect={v => saveCell(record, col, v)} placeholder={isStatusCol ? "— set status" : "— set stage"}/>;
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
          openTo={`/objects/${objectType}/${record.id}`}
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
          numeric={isNumericCol(col)}
          onSave={v => saveCell(record, col, v)}
        />
      </div>
    );
  }

  const activeSortCount = sortRules.length;

  if (query.isLoading) return <div className="mt-4"><PageSkeleton /></div>;
  if (query.isError)   return <div className="mt-4"><ErrorState error={query.error as Error} onRetry={() => query.refetch()} /></div>;
  // The onboarding empty state ONLY when the type is genuinely empty. `records` is now the
  // server-FILTERED result, so returning early here whenever it was empty replaced the whole
  // table — toolbar included — the moment a filter matched nothing, leaving no way to clear the
  // filter. With a filter or search active, the table renders normally and shows its own
  // "No results" row instead.
  if (!records.length && !debouncedSearch && conditions.length === 0) return (
    <div className="mt-4 mx-6 flex min-h-64 flex-col items-center justify-center rounded-sm border border-dashed px-6 text-center" style={{ borderColor: "var(--border-soft)" }}>
      <Database className="mb-3" size={26} style={{ color: "var(--text-faint)" }}/>
      <h2 className="text-sm font-medium text-[var(--text-secondary)]">No {objectType} yet</h2>
      <p className="mt-1 max-w-sm text-sm text-[var(--text-faint)]">Create a record to get started.</p>
    </div>
  );

  function renderRow(record: NodeRecord, rowIdx: number) {
    return (
      <tr
        key={record.id}
        className={`group transition-colors ${selected.has(record.id) ? "bg-stone-50 dark:bg-stone-500/[.05]" : rowIdx % 2 === 1 ? "bg-stone-50/60 dark:bg-[var(--surface-hover)]" : "bg-white dark:bg-transparent"} hover:bg-stone-50 dark:hover:bg-[var(--surface-hover)] ${rowAccent(record)}`}
      >
        <td className={`w-8 min-w-[32px] max-w-[32px] px-2 py-1.5 border-b border-b-[var(--border-faint)] sticky left-0 z-10 ${selected.has(record.id) ? "bg-stone-50 group-hover:bg-stone-100 dark:bg-[#130d0d] dark:group-hover:bg-[#170f0f]" : "bg-white group-hover:bg-[#f8fbff] dark:bg-[var(--surface-page)] dark:group-hover:bg-[var(--surface-card)]"}`}>
          <div
            onClick={() => toggleSelectRow(record.id)}
            className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${selected.has(record.id) ? "bg-stone-500 border-stone-500" : "border-stone-300 opacity-0 group-hover:opacity-100 hover:border-stone-400 dark:border-[var(--border-soft)] dark:hover:border-[var(--border-soft)]"}`}
          >
            {selected.has(record.id) && <Check size={10} className="text-[var(--text-primary)]" strokeWidth={3}/>}
          </div>
        </td>
        {hasRecordIdCol && (
          <td className={`w-20 min-w-[80px] max-w-[80px] px-3 py-1.5 border-b border-b-[var(--border-faint)] sticky left-8 z-10 ${selected.has(record.id) ? "bg-stone-50 group-hover:bg-stone-100 dark:bg-[#130d0d] dark:group-hover:bg-[#170f0f]" : "bg-white group-hover:bg-[#f8fbff] dark:bg-[var(--surface-page)] dark:group-hover:bg-[var(--surface-card)]"}`}>
            <RecordIdCell id={record.id}/>
          </td>
        )}
        {orderedColumns.map((col, colIdx) => (
          <td
            key={col}
            style={{ width: effectiveWidth(col), minWidth: effectiveWidth(col), maxWidth: effectiveWidth(col) }}
            className={`px-4 py-1.5 text-stone-900 dark:text-[var(--text-secondary)] border-b border-b-[var(--border-faint)] overflow-hidden whitespace-nowrap ${isNumericCol(col) ? "text-right tabular-nums font-mono text-stone-500 dark:text-[var(--text-secondary)]" : ""} ${colIdx === 0 ? `sticky ${nameLeft} z-10 border-r border-r-[var(--border-soft)] font-medium text-stone-900 dark:text-[var(--text-secondary)] ` + (selected.has(record.id) ? "bg-stone-50 group-hover:bg-stone-100 dark:bg-[#130d0d] dark:group-hover:bg-[#170f0f]" : "bg-white group-hover:bg-[#f8fbff] dark:bg-[var(--surface-page)] dark:group-hover:bg-[var(--surface-card)]") : ""}`}
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
            {colIdx === 0 ? (
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">{renderCell(col, record)}</div>
                {dupCountOf(record) > 1 && (
                  <span className="shrink-0 rounded-sm border border-[var(--status-warn)]/30 px-1 text-[9px] leading-4 text-[var(--status-warn)]"
                    title={`${dupCountOf(record)} records share this exact name — possible duplicates`}>×{dupCountOf(record)}</span>
                )}
              </div>
            ) : renderCell(col, record)}
          </td>
        ))}
        <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-stone-500 dark:text-[var(--text-secondary)] tabular-nums border-b border-b-[var(--border-faint)]">
          {fmtDate(record.updated_at)}
        </td>
        <td className="border-b border-b-[var(--border-faint)] w-10 px-2">
          <div className="flex items-center gap-1">
          {healthOf(record).length > 0 && (
            <Link to={`/objects/${objectType}/${record.id}`}
              title={`Needs attention:\n· ${healthOf(record).join("\n· ")}\n\nOpen the record to review or enrich.`}
              className="flex h-6 w-6 items-center justify-center rounded-sm">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--status-warn)" }}/>
            </Link>
          )}
          <button
            onClick={() => deleteRow(record)}
            className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-6 w-6 rounded-sm text-stone-400 dark:text-stone-400 hover:text-stone-600 dark:hover:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-500/10 transition-all"
            title="Delete row"
          >
            <Trash2 size={12}/>
          </button>
          </div>
        </td>
      </tr>
    );
  }

  // Toolbar button styles — clean clickable pills with real borders in light mode
  const TB = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-medium transition-colors duration-150 select-none border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]";
  const TB_IDLE = `${TB} border-[#dfe3ea] bg-white text-[#374151] hover:bg-[#f8fafc] hover:border-[#cbd5e1] dark:border-transparent dark:bg-transparent dark:text-stone-300 dark:hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-hover)] dark:hover:border-[var(--border-soft)]`;
  const TB_ON   = `${TB} border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] dark:border-[var(--border-strong)] dark:bg-transparent`;   // hairline active state — no filled tint
  const TB_DOT  = "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-stone-200 px-1 text-[9px] font-semibold text-[var(--accent)] dark:bg-[var(--surface-hover)] dark:text-stone-300";
  const TB_DOT_ACTIVE = "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-stone-500/70 px-1 text-[9px] font-semibold text-[var(--text-primary)]";

  return (
    <>
    <section className="flex flex-col h-full bg-white dark:bg-transparent">
      {pendingLoss && <LossReasonModal pending={pendingLoss} onClose={() => setPendingLoss(null)} />}
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-[var(--border-soft)] shrink-0">
        {/* Search — always visible, left-anchored, quiet until focused. */}
        <div className="mr-2 flex items-center gap-1.5">
          <Search size={11} className="shrink-0 text-[var(--text-faint)]"/>
          <input
            value={toolbarSearch}
            onChange={e => setToolbarSearch(e.target.value)}
            placeholder="Search records…"
            className="w-40 bg-transparent text-[11.5px] text-[var(--text-primary)] placeholder-[var(--text-faint)] outline-none focus:w-56 transition-all"
          />
          {toolbarSearch && (
            <button onClick={() => setToolbarSearch("")} aria-label="Clear search" className="text-[var(--text-faint)] hover:text-[var(--text-primary)]"><X size={10}/></button>
          )}
        </div>
        {(conditions.length > 0 || toolbarSearch || sortRules.length > 0) && (
          <span className="text-[11px] text-[#9ca3af] dark:text-[var(--text-secondary)] tabular-nums mr-2">{visibleRows.length} of {totalOfType}</span>
        )}
        {truncated && (
          <span
            className="mr-2 rounded-sm border border-[var(--status-warn)]/30 px-1.5 py-px text-[10px] text-[var(--status-warn)]"
            title={`This view holds the first ${records.length} of ${totalOfType} records. Search and filters query ALL records; sorting and export apply to what is loaded.`}
          >first {records.length} of {totalOfType}</span>
        )}
        {flaggedCount > 0 && (
          <button onClick={() => setShowFlaggedOnly(v => !v)}
            title="Rule-based checks: malformed email/link, duplicate name, stale record, won deal with no value. Click to show only flagged rows."
            className={`mr-2 flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10.5px] transition-colors ${showFlaggedOnly ? "border-[var(--status-warn)]/50 text-[var(--status-warn)]" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--status-warn)" }}/>
            {flaggedCount} need attention
          </button>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {/* Columns (was "View") */}
          <button onClick={() => setOpenPanel(p => p === "view" ? null : "view")}
            className={openPanel === "view" ? TB_ON : TB_IDLE}>
            <Settings2 size={11}/>
            <span>Columns</span>
            {hiddenCols.size > 0 && <span className={TB_DOT}>{allColumnsWithCustom.filter(c => !hiddenCols.has(c)).length}</span>}
          </button>

          <div className="w-px h-3 bg-[var(--surface-hover)] mx-1"/>

          {/* Filter */}
          <button onClick={() => setOpenPanel(p => p === "filter" ? null : "filter")}
            className={openPanel === "filter" || conditions.length > 0 ? TB_ON : TB_IDLE}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 2.5h10M3 6h6M5 9.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <span>Filter</span>
            {conditions.length > 0 && <span className={TB_DOT_ACTIVE}>{conditions.length}</span>}
          </button>

          {/* Sort */}
          <button onClick={() => setOpenPanel(p => p === "sort" ? null : "sort")}
            className={openPanel === "sort" || activeSortCount > 0 ? TB_ON : TB_IDLE}>
            <ArrowUpDown size={11}/>
            <span>Sort</span>
            {activeSortCount > 0 && <span className={TB_DOT}>{activeSortCount}</span>}
          </button>

          {/* ⋯ — the occasional tools fold behind one menu (Group / Ask / Export / Saved).
              Seven equal buttons implied seven equally-daily tools; Search + Filter + Sort are
              the daily three. An ACTIVE occasional tool surfaces its own chip so its state is
              never hidden behind the menu. */}
          {groupByCol && (
            <button onClick={() => setOpenPanel(p => p === "groupby" ? null : "groupby")} className={TB_ON}>
              <Rows3 size={11}/><span>Group</span><span className={TB_DOT}>{colLabel(groupByCol)}</span>
            </button>
          )}
          {nlpActive && (
            <button onClick={() => setOpenPanel(p => p === "ask" ? null : "ask")} className={TB_ON}>
              <LogoMark size={11}/><span>Ask</span><span className={TB_DOT}>on</span>
            </button>
          )}
          <div className="relative">
            <button onClick={() => setMoreOpen(o => !o)}
              className={["groupby", "ask", "export", "views"].includes(openPanel ?? "") || moreOpen ? TB_ON : TB_IDLE}
              aria-label="More tools">
              <MoreHorizontal size={13}/>
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}/>
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-1">
                  {([
                    ["groupby", Rows3, "Group", groupByCol ? colLabel(groupByCol) : null],
                    ["ask", LogoMark, "Ask", nlpActive ? "on" : null],
                    ["export", Download, "Export", null],
                    ["views", BookmarkCheck, "Saved views", savedViews.length ? String(savedViews.length) : null],
                  ] as const).map(([panel, Icon, label, badge]) => (
                    <button key={panel} onClick={() => { setOpenPanel(p => p === panel ? null : panel); setMoreOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                      <Icon size={11}/>{label}
                      {badge && <span className="ml-auto text-[10px] text-[var(--text-faint)]">{badge}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Columns inline bar ── */}
      {openPanel === "view" && (
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0 overflow-x-auto">
          <span className="text-body text-[var(--text-secondary)] shrink-0 mr-2">Columns</span>
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
        <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0">
          <span className="text-body text-[var(--text-secondary)] shrink-0">Sort by</span>
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          {sortRules.length === 0 && (
            <span className="text-[11px] text-[var(--text-secondary)]">No sorts — add one below</span>
          )}
          {sortRules.map((rule, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1 shrink-0">
              <FieldSelect value={rule.col} onChange={v => setSortRules(r => r.filter((x, idx) => idx === i || x.col !== v).map((x, idx) => idx === i ? { ...x, col: v } : x))}
                ariaLabel="Sort column" className="capitalize max-w-[120px]"
                options={[...allColumnsWithCustom, "__updated_at"].filter(c => c === rule.col || !sortRules.some(x => x.col === c)).map(c => ({ value: c, label: colLabel(c) }))} />
              <button onClick={() => setSortRules(r => r.map((x, idx) => idx === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x))}
                className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap bg-transparent ${rule.dir === "asc" ? "border-[#717784]/40 text-[#717784]" : "border-[#c6892e]/40 text-[#c6892e]"}`}>
                {rule.dir === "asc" ? <><ChevronUp size={9}/>A→Z</> : <><ChevronDown size={9}/>Z→A</>}
              </button>
              <button onClick={() => setSortRules(r => r.filter((_, idx) => idx !== i))} className="text-[var(--text-secondary)] hover:text-stone-400"><X size={10}/></button>
            </div>
          ))}
          <button onClick={() => { const unused = [...allColumnsWithCustom, "__updated_at"].find(c => !sortRules.some(r => r.col === c)); if (unused) setSortRules(r => [...r, { col: unused, dir: "asc" }]); }}
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-100 transition-colors shrink-0 whitespace-nowrap">
            <Plus size={11}/> Add sort
          </button>
          {sortRules.length > 0 && (
            <button onClick={() => setSortRules([])} className="text-[10px] text-stone-400/50 hover:text-stone-400 transition-colors shrink-0 whitespace-nowrap">
              Clear
            </button>
          )}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0 pl-2"><X size={13}/></button>
        </div>
      )}

      {/* ── Group inline bar ── */}
      {openPanel === "groupby" && (
        <div className="flex items-center gap-1.5 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0 overflow-x-auto">
          <span className="text-body text-[var(--text-secondary)] shrink-0 mr-1">Group by</span>
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
        <div className="flex items-center gap-3 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0">
          <span className="text-body text-[var(--text-secondary)] shrink-0">Export</span>
          <div className="h-3 w-px bg-[var(--surface-hover)] shrink-0"/>
          <button onClick={exportCSV} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <Download size={11}/> Export as CSV
            {/* server-side: exports ALL matching records (filters applied), not the loaded page */}
            <span className="text-[10px] text-[var(--text-secondary)] ml-1">(all matching records)</span>
          </button>
          {exportErr && <span className="text-[10px] text-[var(--status-error)]">{exportErr}</span>}
          <button onClick={() => setOpenPanel(null)} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-secondary)] shrink-0"><X size={13}/></button>
        </div>
      )}

      {/* ── Ask (natural-language commands) inline bar ── */}
      {openPanel === "ask" && (
        <div className="px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0">
          <NLPCommandBar
            // ALL columns, not the visible subset — with only visible names the model couldn't
            // reference a hidden column ("high confidence" → confidence_label was hidden), so its
            // structured conditions were rejected and it degraded to a useless text search.
            columns={allColumnsWithCustom}
            onApply={handleNLPApply}
            onClear={() => { setToolbarSearch(""); setConditions([]); setSortRules([]); setNlpActive(false); }}
            hasActive={nlpActive}
          />
        </div>
      )}

      {/* ── Saved views inline bar ── */}
      {openPanel === "views" && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0 overflow-x-auto">
          <span className="text-body text-[var(--text-secondary)] shrink-0">Saved</span>
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
      {/* ── Filter bar: active condition chips + "+ Filter" builder (2026-07-31 redesign).
             Replaces the permanent dropdown-per-column row — you only see chips for filters you
             actually applied, and conditions run in SQL over ALL records, not the loaded page. ── */}
      {openPanel === "filter" && (
        <FilterBar
          records={records}
          columns={[...allColumnsWithCustom.filter(c => c !== LAST_ACTIVITY), LAST_ACTIVITY]}
          customCols={customCols}
          conditions={conditions}
          onChange={setConditions}
          onClose={() => setOpenPanel(null)}
        />
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-[var(--border-soft)] bg-transparent shrink-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
            <div className="h-4 w-4 rounded-md bg-stone-500 flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)]">{selected.size}</div>
            selected
          </span>
          <div className="h-3 w-px bg-[var(--surface-hover)]" />

          {/* Set field — bulk stage/status/priority change on the selection */}
          {bulkEditableCols.length > 0 && (
            <div className="relative">
              <button onClick={() => { setSetFieldOpen(o => !o); setSetFieldCol(null); setListPickerOpen(false); setAssignPickerOpen(false); }}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <Tag size={12}/> Set field
              </button>
              {setFieldOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setSetFieldOpen(false); setSetFieldCol(null); }}/>
                  <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-1">
                    {!setFieldCol ? bulkEditableCols.map(col => (
                      <button key={col} onClick={() => setSetFieldCol(col)}
                        className="flex w-full items-center rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors first-letter:uppercase hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                        {colLabel(col)}
                      </button>
                    )) : (
                      <>
                        <p className="px-2.5 py-1 text-[10px] text-[var(--text-faint)] first-letter:uppercase">{colLabel(setFieldCol)} →</p>
                        {[...new Set([
                          ...(/stage/.test(setFieldCol.toLowerCase()) ? DEFAULT_STAGE_OPTIONS : /status/.test(setFieldCol.toLowerCase()) ? DEFAULT_STATUS_OPTIONS : []),
                          ...records.map(r => String(cellValue(r, setFieldCol) ?? "")).filter(v => v && v.length <= 24),
                        ])].slice(0, 14).map(v => (
                          <button key={v} onClick={() => void bulkSetField(setFieldCol, v)}
                            className="flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                            <span className={`h-1.5 w-1.5 rounded-full ${stageStyle(v).dot}`}/>{v}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Add to list */}
          <div className="relative">
            <button
              onClick={() => { setListPickerOpen(o => !o); setAssignPickerOpen(false); setSetFieldOpen(false); }}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <List size={12} /> Add to list
            </button>
            {listPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setListPickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border-soft)]">
                    <p className="text-body text-[var(--text-secondary)]">Add {selected.size} to list</p>
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
                    <p className="text-body text-[var(--text-secondary)] mb-2">Assign {selected.size} records</p>
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
                      <p className="text-body text-[var(--text-secondary)] flex-1">Edit {selected.size} records</p>
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
              <th className="w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[var(--border-soft)] sticky left-0 z-30">
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
                <th className="w-20 min-w-[80px] max-w-[80px] px-3 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[var(--border-soft)] sticky left-8 z-30">
                  <span className="text-[11.5px] font-medium text-[var(--text-secondary)] first-letter:uppercase">ID</span>
                </th>
              )}
              {orderedColumns.map((col, colIdx) => {
                const w = effectiveWidth(col);
                return (
                  <th
                    key={col}
                    style={{ width: w, minWidth: w, maxWidth: w }}
                    className={`group/th relative px-4 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[var(--border-soft)] select-none ${colIdx === 0 ? `sticky ${nameLeft} z-30 border-r border-r-[var(--border-soft)]` : ""}`}
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
                        className={`flex items-center gap-1.5 text-[#64748b] hover:text-[#111827] dark:text-stone-400 dark:hover:text-stone-100 transition-colors min-w-0 flex-1 ${isNumericCol(col) ? "ml-auto" : ""}`}>
                        {getColumnIcon(col)}
                        <span className="whitespace-nowrap text-[11.5px] font-medium text-[var(--text-secondary)] first-letter:uppercase">{colLabel(col)}</span>
                        {colMeta[col]?.required && <span className="text-stone-400/70 text-[10px] leading-none">*</span>}
                        <SortIcon col={col}/>
                      </button>
                      {/* Visible column menu — the context menu (remove/hide/type) existed ONLY on
                          right-click, which nobody discovers. Same menu, visible affordance. */}
                      <button
                        onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setColCtxMenu({ col, x: r.left, y: r.bottom + 4 }); }}
                        className="shrink-0 rounded-sm p-0.5 text-[var(--text-faint)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover/th:opacity-100"
                        aria-label={`Column options for ${colLabel(col)}`}>
                        <ChevronDown size={10}/>
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
              <th className="px-4 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[var(--border-soft)]">
                <button onClick={() => handleHeaderSort("__updated_at")} className="flex items-center gap-1.5 text-[#64748b] hover:text-[#111827] dark:text-stone-400 dark:hover:text-stone-100 transition-colors">
                  <Calendar size={11}/>
                  <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Updated</span>
                  <SortIcon col="__updated_at"/>
                </button>
              </th>
              {/* Add column */}
              <th
                ref={addColHeaderRef}
                className="w-10 px-3 py-2.5 bg-[#f8fafc] dark:bg-[var(--surface-page)] border-b border-b-[var(--border-soft)] relative"
              >
                <button
                  onClick={() => setOpenPanel(p => p === "addcol" ? null : "addcol")}
                  className="flex h-6 w-6 items-center justify-center rounded-sm text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)] dark:hover:bg-[var(--surface-hover)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]"
                  title="Add column" aria-label="Add a column"
                >
                  <Plus size={13}/>
                </button>
                {openPanel === "addcol" && (
                  <AddColumnDropdown
                    objectTypeForFormula={objectType}
                    onAdd={(key, type, meta) => {
                      saveCustomCols([...customCols, { key, type, ...(meta ? { meta } : {}) }]);
                      // ALSO persist the type to object_definitions — the server type is what other
                      // devices and teammates resolve through effectiveType(). localStorage alone made
                      // every column type this-browser-only, which is how a Country column rendered
                      // as generic (number-formatted) text everywhere else. Fire-and-forget: the local
                      // preset already applies here; the server copy is for everyone else.
                      const def = objectDefsForTypes.find(o => o.slug === objectType);
                      if (def?.id && !serverAttrType.has(key)) {
                        apiClient.post(`/settings/objects/${def.id}/attributes`, { name: key, type })
                          .then(() => qc.invalidateQueries({ queryKey: ["object-defs"] }))
                          .catch(err => console.warn("[columns] could not persist column type to the schema:", err));
                      }
                      setOpenPanel(null);
                    }}
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
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 3 + (hasRecordIdCol ? 1 : 0)} className="px-4 py-14 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                  No results{toolbarSearch ? ` for "${toolbarSearch}"` : conditions.length ? " for the active filters" : ""}
                </td>
              </tr>
            ) : (() => {
              // Build row list — optionally grouped
              const rowsToRender: React.ReactNode[] = [];
              if (groupByCol) {
                // Date columns bucket by MONTH — grouping by exact day/timestamp produced a wall
                // of one-row groups that helped nobody.
                const isDateGroup = inferColKind(records, groupByCol, customCols.find(cc => cc.key === groupByCol)?.type) === "date";
                const groupKeyOfRow = (r: NodeRecord): string => {
                  const raw = String(cellValue(r, groupByCol) ?? "—");
                  if (!isDateGroup || raw === "—" || !/^\d{4}-\d{2}/.test(raw)) return raw;
                  return raw.slice(0, 7);   // YYYY-MM
                };
                const groups = new Map<string, NodeRecord[]>();
                for (const r of visibleRows) {
                  const key = groupKeyOfRow(r);
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(r);
                }
                // Largest first: by server subtotal when a calc is active, else by row count —
                // insertion order was arbitrary (whatever order rows arrived in).
                const orderedGroups = [...groups.entries()].sort((a, b) => {
                  const sa = groupSubtotals.get(a[0])?.value; const sb = groupSubtotals.get(b[0])?.value;
                  if (sa != null && sb != null && sa !== sb) return sb - sa;
                  return b[1].length - a[1].length;
                });
                for (const [groupVal, groupRows] of orderedGroups) {
                  const ss = stageStyle(groupVal);
                  const isCollapsed = collapsedGroups.has(groupVal);
                  rowsToRender.push(
                    <tr key={`grp-${groupVal}`} onClick={() => setCollapsedGroups(prev => { const n = new Set(prev); n.has(groupVal) ? n.delete(groupVal) : n.add(groupVal); return n; })} className="cursor-pointer select-none">
                      <td colSpan={columns.length + 3 + (hasRecordIdCol ? 1 : 0)} className="px-4 py-2 bg-stone-50 dark:bg-[var(--surface-hover)] border-y border-stone-200 dark:border-[var(--border-soft)]">
                        <div className="flex items-center gap-2">
                          <ChevronDown size={11} className={`shrink-0 text-[var(--text-muted)] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}/>
                          <span className={`h-2 w-2 rounded-full ${ss.dot}`}/>
                          <span className="text-[11px] font-semibold text-stone-600 dark:text-[var(--text-secondary)] capitalize">{groupVal}</span>
                          <span className="text-[10px] text-stone-400 dark:text-[var(--text-secondary)] ml-1">{groupRows.length}</span>
                          {/* Excel-style per-group subtotal for the primary calc'd column — server value
                              when available, else an honest client per-group calc over the shown rows. */}
                          {groupCalcCol && groupCalcOp && (() => {
                            const srv = groupSubtotals.get(groupVal);
                            const str = srv
                              ? fmtGroupVal(groupCalcKind, groupCalcOp, srv.value, groupAggCurrency, srv.unconverted)
                              : calcResultTyped(groupCalcOp, groupCalcCol, groupRows, groupCalcKind, { display: wsDisplay, rates: fxRates, base: wsBase });
                            return (
                              <span title={srv ? "Group subtotal (full table)" : "Group subtotal (this view)"}
                                className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10px] font-mono tabular-nums"
                                style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                                <span className="first-letter:uppercase" style={{ color: "var(--text-faint)" }}>{colLabel(groupCalcCol)} · {groupCalcOp}</span>{str}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                  if (!isCollapsed) groupRows.forEach((record, rowIdx) => rowsToRender.push(renderRow(record, rowIdx)));
                }
              } else {
                visibleRows.forEach((record, rowIdx) => rowsToRender.push(renderRow(record, rowIdx)));
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
                  className={`px-3 py-3 bg-stone-50 dark:bg-[var(--surface-card)] border-t border-t-zinc-200 dark:border-t-zinc-800/60 text-[12px] text-stone-900 dark:text-inherit ${isNumeric(col) ? "text-right" : ""} ${colIdx === 0 ? `sticky ${nameLeft} z-50 border-r border-r-[var(--border-soft)]` : "border-r border-r-zinc-200 dark:border-r-zinc-800/15"}`}
                >
                  <div
                    ref={el => { if (el) calcWrapRefs.current.set(col, el); else calcWrapRefs.current.delete(col); }}
                    className={`inline-block ${isNumericCol(col) ? "ml-auto" : ""}`}
                  >
                    {openCalcCol === col && (
                      <CalcDropdown col={col} current={calculations[col] ?? null} kind={effectiveType(col)}
                        onSelect={op => setCalculations(prev => ({ ...prev, [col]: op }))}
                        onClose={() => setOpenCalcCol(null)}
                        triggerRef={{ current: calcWrapRefs.current.get(col) ?? null }}
                      />
                    )}
                    {calculations[col] ? (
                      <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)} aria-label={`Change ${calculations[col]} total for ${colLabel(col)}`}
                        className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-[var(--text-primary)] transition-colors tabular-nums font-mono rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]">
                        <span className="mr-0.5 text-body first-letter:uppercase text-[var(--text-faint)]">{calculations[col]}</span>
                        {(() => {
                          const fSrc = customCols.find(cc => cc.key === col && cc.type === "formula")?.meta?.formula;
                          const clientStr = calcResultTyped(calculations[col], col, visibleRows, effectiveType(col), { display: wsDisplay, rates: fxRates, base: wsBase }, fSrc);
                          if (effectiveType(col) === "formula") return <><CompactTotal text={clientStr}/><TotalNote text="loaded rows" /></>;
                          // Which active filters can the server reproduce EXACTLY? Only plain equality
                          // equality conditions on non-owner columns (owner cells resolve via display-name
                          // state the server can't see; date-range __from/__to and free-text search
                          // aren't equality). If the whole active filter set is representable we send
                          // it so the server total matches the filtered view; otherwise we keep the
                          // honest client subtotal over the visible rows — LABELLED "this view" so it's
                          // never mistaken for the authoritative full-table server total.
                          const reprFilters = serverFilters(conditions);
                          const allRepresentable = !toolbarSearch.trim() && reprFilters.length === conditions.length;
                          if (!allRepresentable) return <><CompactTotal text={clientStr}/><TotalNote text="this view" /></>;
                          return <ServerTotalValue objectType={objectType} col={col} op={calculations[col]} kind={effectiveType(col)} display={wsDisplay} fallback={clientStr} filters={reprFilters} />;
                        })()}
                      </button>
                    ) : (
                      <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)} aria-label={`Add a total for ${colLabel(col)}`}
                        className="flex items-center gap-1 text-[11px] text-stone-700 hover:text-stone-400 transition-colors group rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]">
                        <Plus size={10} className="group-hover:text-stone-400 transition-colors"/>
                        <span>Calculate</span>
                      </button>
                    )}
                  </div>
                </td>
              ))}
              <td className="px-3 py-3 text-[12px] text-stone-700 tabular-nums bg-[var(--surface-card)] border-t border-t-zinc-800/60">{visibleRows.length} rows</td>
              <td className="bg-[var(--surface-card)] border-t border-t-zinc-800/60 border-l border-l-zinc-800/20 w-8"/>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    {/* Undo delete toast */}
    {cellTip && <CellTipPortal text={cellTip.text} x={cellTip.x} y={cellTip.y}/>}

    {undoToast && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-4 py-3">
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
      <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-sm border bg-[var(--surface-card)] px-4 py-3"
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
          style={{ left: Math.max(8, Math.min(colCtxMenu.x, window.innerWidth - 180)), top: Math.max(8, Math.min(colCtxMenu.y, window.innerHeight - 220)) }}
        >
          <div className="px-3 py-1.5 text-body text-[var(--text-secondary)] border-b border-[var(--border-soft)] mb-1">
            {colLabel(colCtxMenu.col)}
          </div>
          {customCols.some(c => c.key === colCtxMenu.col) && (
            <button
              onClick={() => {
                const col = colCtxMenu.col;
                // Workspace-wide removal of the column DEFINITION (row values stay in data) —
                // confirmed explicitly; for built-in columns this menu offers Hide only (the old
                // Remove was identical to Hide there, two buttons doing one thing).
                if (!window.confirm(`Remove the "${colLabel(col)}" column for the whole workspace? Values already stored on records are kept.`)) return;
                saveCustomCols(customCols.filter(c => c.key !== col));
                setColCtxMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-stone-400 hover:bg-stone-500/10 transition-colors"
            >
              <Trash2 size={12}/> Remove column
            </button>
          )}
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
