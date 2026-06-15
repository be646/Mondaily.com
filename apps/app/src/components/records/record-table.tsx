import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2,
  ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check, Search, X,
  Sparkles, Command, Settings2, ArrowUpDown, Download, GripVertical,
  UserCircle2, Type, ToggleLeft, ChevronRight, Trash2, RotateCcw, List,
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

// ─── Category badges (read-only table cells) ──────────────────────────────────
function CategoryBadges({ value }: { value: unknown }) {
  let cats: { name: string; color: string }[] = [];
  if (Array.isArray(value)) {
    cats = value as { name: string; color: string }[];
  } else if (typeof value === "string") {
    try { cats = JSON.parse(value); } catch { return <span className="text-xs text-slate-600">—</span>; }
  }
  if (!cats.length) return <span className="text-xs text-slate-600">—</span>;
  const MAX = 2;
  const overflow = cats.length - MAX;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {cats.slice(0, MAX).map((cat, i) => {
        const t = INDUSTRY_TAXONOMY.find(x => x.border === cat.color || x.name === cat.name) ?? INDUSTRY_TAXONOMY[0]!;
        return (
          <span key={i} style={{ background: t.bg, color: t.text, borderColor: t.border + "55" }}
            className="inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold border whitespace-nowrap">
            {cat.name}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="rounded-full bg-white/[.05] border border-white/[.06] px-1.5 py-0.5 text-[9px] text-slate-500">+{overflow}</span>
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

const DEFAULT_STAGE_OPTIONS = [
  "Lead","Qualified","Proposal","Negotiation","Closed Won","Closed Lost",
  "In Progress","Not Started","Completed","On Hold","Cancelled",
];

function stageStyle(value: string) {
  return STAGE_STYLES[value] ?? { pill: "bg-slate-900/60 text-slate-400 border-slate-700/50", dot: "bg-slate-500" };
}

// Clickable stage pill — opens a dropdown to change the value inline
function StagePill({ value, options, onSelect }: {
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
    const next = rules.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange(next);
  }

  function removeRule(i: number) {
    onChange(rules.filter((_, idx) => idx !== i));
  }

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="left" className="w-72">
      <div className="px-3 py-2 border-b border-white/[.06]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Sort rules</p>
      </div>
      <div className="py-1.5 space-y-1 px-2">
        {rules.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-600">No sort rules. Click '+ Add sort' below.</p>
        )}
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical size={12} className="text-slate-700 shrink-0"/>
            <select
              value={rule.col}
              onChange={e => updateRule(i, { col: e.target.value })}
              className="flex-1 min-w-0 rounded-md border border-white/[.08] bg-[#13151a] px-2 py-1 text-xs text-white outline-none focus:border-red-500/30"
            >
              {columns.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
            <button
              onClick={() => updateRule(i, { dir: rule.dir === "asc" ? "desc" : "asc" })}
              className="flex items-center gap-1 rounded-md border border-white/[.08] bg-white/[.03] px-2 py-1 text-[11px] text-slate-400 hover:text-white transition-colors whitespace-nowrap"
            >
              {rule.dir === "asc" ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
              {rule.dir === "asc" ? "Asc" : "Desc"}
            </button>
            <button onClick={() => removeRule(i)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
              <X size={13}/>
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-white/[.06] px-3 py-2 flex items-center justify-between gap-2">
        <button onClick={addRule} disabled={rules.length >= columns.length}
          className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors disabled:opacity-30">
          <Plus size={11}/> Add sort
        </button>
        {rules.length > 0 && (
          <button onClick={() => onChange([])} className="text-[11px] text-slate-600 hover:text-red-400 transition-colors">
            Clear all
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
          {members.map(m => {
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

// ─── Add column dropdown ───────────────────────────────────────────────────────
// Column type presets — each maps to a clear semantic meaning
const COLUMN_TYPE_PRESETS = [
  { type: "status",   label: "Status",   hint: "Current state (New, In Progress, Done…)",   icon: ToggleLeft, color: "text-sky-400"     },
  { type: "stage",    label: "Stage",    hint: "Pipeline stage (Lead, Proposal, Closed…)",   icon: ChevronRight, color: "text-violet-400" },
  { type: "assignee", label: "Assignee", hint: "Team member responsible for this record",    icon: UserCircle2, color: "text-emerald-400" },
  { type: "owner",    label: "Owner",    hint: "Deal owner or account owner",                icon: User, color: "text-amber-400"        },
  { type: "text",     label: "Text",     hint: "Free text field",                            icon: Type, color: "text-slate-400"        },
  { type: "number",   label: "Number",   hint: "Numeric value, amount, count",               icon: Hash, color: "text-blue-400"         },
  { type: "date",     label: "Date",     hint: "Date or deadline",                           icon: Calendar, color: "text-rose-400"     },
] as const;

type ColPresetType = typeof COLUMN_TYPE_PRESETS[number]["type"];

// Default column names per type
const PRESET_DEFAULTS: Record<ColPresetType, string> = {
  status:   "Status",
  stage:    "Stage",
  assignee: "Assigned To",
  owner:    "Owner",
  text:     "",
  number:   "",
  date:     "",
};

function AddColumnDropdown({ onAdd, onClose, triggerRef }: {
  onAdd: (name: string, type: string) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | HTMLTableCellElement | null>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColPresetType>("status");
  const [hovered, setHovered] = useState<ColPresetType | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

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
        {COLUMN_TYPE_PRESETS.map(({ type: t, label, icon: Icon, color }) => (
          <button key={t} onClick={() => pickType(t)}
            onMouseEnter={() => setHovered(t)} onMouseLeave={() => setHovered(null)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors ${type === t ? "bg-white/[.05] text-white" : "text-slate-400 hover:bg-white/[.03] hover:text-white"}`}>
            <Icon size={13} className={color}/>
            <span className="font-medium">{label}</span>
            {type === t && <Check size={10} className="ml-auto text-red-400 shrink-0"/>}
          </button>
        ))}
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
  const [openPanel, setOpenPanel] = useState<"view"|"sort"|"filter"|"export"|"addcol"|null>(null);

  // ── Toolbar trigger refs (for portal positioning) ──
  const viewWrapRef   = useRef<HTMLDivElement>(null);
  const sortWrapRef   = useRef<HTMLDivElement>(null);
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const exportWrapRef = useRef<HTMLDivElement>(null);
  // Add column lives in the table header now
  const addColHeaderRef = useRef<HTMLTableCellElement>(null);

  // ── Calc footer trigger refs (dynamic columns) ──
  const calcWrapRefs = useRef(new Map<string, HTMLDivElement>());

  // ── Custom columns (appended by user) ──
  const [customCols, setCustomCols] = useState<{ key: string; type: string }[]>([]);
  const allColumnsWithCustom = useMemo(() => [...allColumns, ...customCols.map(c => c.key)], [allColumns, customCols]);
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
  function getOwner(recordId: string, col: string, fallback: unknown) {
    return owners[recordId]?.[col] ?? String(fallback ?? "");
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
      base = base.filter(r => quickFilters.every(f => String(r.data[f.col] ?? "").toLowerCase() === f.value.toLowerCase()));
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

  // Columns suitable for bulk edit
  const bulkEditCols = columns.filter(c =>
    c.toLowerCase().includes("stage") || c === "status" || c === "deal_status" ||
    c === "assigned_to" || c === "deal_owner" || c.toLowerCase().includes("owner") || c.toLowerCase().includes("assignee")
  );

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

  const [listPickerOpen, setListPickerOpen] = useState(false);
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

  function saveCell(record: NodeRecord, col: string, newVal: string) {
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
    if (customDef?.type === "stage" || customDef?.type === "status") {
      const shown = String(val ?? "");
      const existingOptions = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))];
      if (!shown) return <span className="text-slate-700 text-xs cursor-pointer hover:text-slate-400" onClick={() => saveCell(record, col, existingOptions[0] ?? (customDef.type === "stage" ? "Lead" : "New"))}>—</span>;
      return <StagePill value={shown} options={existingOptions.length ? existingOptions : (customDef.type === "stage" ? DEFAULT_STAGE_OPTIONS : ["New","In Progress","Done","On Hold","Cancelled"])} onSelect={v => saveCell(record, col, v)}/>;
    }

    // Custom column — empty by default
    if (customDef) return <span className="text-slate-700 text-xs">—</span>;

    // Categories
    if (col === "categories") return <CategoryBadges value={val}/>;

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

    // Stage pill
    if ((col.toLowerCase().includes("stage") || col === "status" || col === "deal_status") && typeof val === "string") {
      const existingOptions = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))];
      return <StagePill value={val} options={existingOptions} onSelect={v => saveCell(record, col, v)}/>;
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

  const TOOL_BTN_BASE = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-150";
  const TOOL_BTN_IDLE = `${TOOL_BTN_BASE} border-white/[.07] bg-white/[.02] text-white/40 hover:border-white/[.12] hover:text-white/80 hover:bg-white/[.04]`;
  const TOOL_BTN_ON   = `${TOOL_BTN_BASE} border-white/[.12] bg-white/[.06] text-white`;

  return (
    <>
    <section className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-6 py-2 shrink-0">
        {/* Filter */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/>
          <input value={filterText} onChange={e => setFilterText(e.target.value)}
            placeholder={`Filter ${objectType}…`}
            className="key-input w-full py-1.5 pl-8 pr-8 text-xs"/>
          {filterText && (
            <button onClick={() => setFilterText("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white transition-colors">
              <X size={12}/>
            </button>
          )}
        </div>

        {(filterText || filterQuery || quickSortCol || sortRules.length > 0) && (
          <span className="text-xs text-slate-600 tabular-nums">{sorted.length} of {records.length}</span>
        )}
        {nlpActive && (
          <span className="flex items-center gap-1 rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1 text-[10px] text-zinc-400">
            <Sparkles size={9}/> AI active
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* View settings */}
          <div ref={viewWrapRef}>
            <button
              onClick={() => setOpenPanel(p => p === "view" ? null : "view")}
              className={openPanel === "view" ? TOOL_BTN_ON : TOOL_BTN_IDLE}
            >
              <Settings2 size={12}/>
              <span className="hidden sm:inline">View</span>
              {hiddenCols.size > 0 && <span className="rounded-full bg-zinc-700 px-1.5 text-[9px] text-white">{allColumns.length - hiddenCols.size}</span>}
            </button>
            {openPanel === "view" && (
              <ViewSettingsDropdown
                columns={allColumnsWithCustom}
                hidden={hiddenCols}
                onToggle={toggleCol}
                onClose={() => setOpenPanel(null)}
                triggerRef={viewWrapRef}
              />
            )}
          </div>

          {/* Filter panel */}
          <div ref={filterWrapRef}>
            <button
              onClick={() => setOpenPanel(p => p === "filter" ? null : "filter")}
              className={openPanel === "filter" || quickFilters.length > 0 ? TOOL_BTN_ON : TOOL_BTN_IDLE}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 2.5h10M3 6h6M5 9.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              <span className="hidden sm:inline">Filter</span>
              {quickFilters.length > 0 && <span className="rounded-full bg-red-500/80 px-1.5 text-[9px] text-white">{quickFilters.length}</span>}
            </button>
          </div>

          {/* Sort panel */}
          <div ref={sortWrapRef}>
            <button
              onClick={() => setOpenPanel(p => p === "sort" ? null : "sort")}
              className={openPanel === "sort" || activeSortCount > 0 ? TOOL_BTN_ON : TOOL_BTN_IDLE}
            >
              <ArrowUpDown size={12}/>
              <span className="hidden sm:inline">Sort</span>
              {activeSortCount > 0 && <span className="rounded-full bg-zinc-700 px-1.5 text-[9px] text-white">{activeSortCount}</span>}
            </button>
            {openPanel === "sort" && (
              <SortPanel
                columns={[...allColumnsWithCustom, "__updated_at"]}
                rules={sortRules}
                onChange={rules => { setSortRules(rules); setQuickSortCol(null); }}
                onClose={() => setOpenPanel(null)}
                triggerRef={sortWrapRef}
              />
            )}
          </div>

          {/* Export */}
          <div ref={exportWrapRef}>
            <button
              onClick={() => setOpenPanel(p => p === "export" ? null : "export")}
              className={openPanel === "export" ? TOOL_BTN_ON : TOOL_BTN_IDLE}
            >
              <Download size={12}/>
              <span className="hidden sm:inline">Export</span>
            </button>
            {openPanel === "export" && (
              <ExportDropdown
                records={sorted}
                columns={columns}
                objectType={objectType}
                onClose={() => setOpenPanel(null)}
                triggerRef={exportWrapRef}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Filter inline bar — same look as bulk action bar ── */}
      {openPanel === "filter" && (() => {
        const filterableCols = orderedColumns.filter(c =>
          c.toLowerCase().includes("stage") || c === "status" || c === "deal_status" ||
          c === "assigned_to" || c === "deal_owner" || c === "owner" ||
          c.toLowerCase().includes("owner") || c.toLowerCase().includes("assignee") ||
          c === "type" || c === "priority" || c === "industry"
        );
        return (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-white/[.06] bg-white/[.02] shrink-0 overflow-x-auto">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 shrink-0">Filter by</span>
            <div className="h-3 w-px bg-white/[.08] shrink-0"/>
            {filterableCols.length === 0 && (
              <span className="text-xs text-slate-600">No filterable columns in this sheet</span>
            )}
            {filterableCols.map(col => {
              const vals = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort().slice(0, 20);
              if (!vals.length) return null;
              const active = quickFilters.find(f => f.col === col);
              const isStage = col.toLowerCase().includes("stage") || col === "status" || col === "deal_status";
              return (
                <FilterColDropdown
                  key={col}
                  col={col}
                  vals={vals}
                  activeValue={active?.value ?? null}
                  isStage={isStage}
                  onSelect={val => toggleQuickFilter(col, val)}
                />
              );
            })}
            {quickFilters.length > 0 && (
              <>
                <div className="h-3 w-px bg-white/[.08] shrink-0"/>
                <button onClick={() => setQuickFilters([])} className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors shrink-0 whitespace-nowrap">
                  Clear all ({quickFilters.length})
                </button>
              </>
            )}
            <button onClick={() => setOpenPanel(null)} className="ml-auto text-white/20 hover:text-white/60 shrink-0">
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
              onClick={() => setListPickerOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
            >
              <List size={12} /> Add to list
            </button>
            {listPickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setListPickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-white/[.08] bg-[#0f1117] p-1 shadow-xl">
                  {(listsQuery.data ?? []).length === 0 && <p className="px-3 py-2 text-xs text-white/30">No lists yet</p>}
                  {(listsQuery.data ?? []).map(l => (
                    <button key={l.id} onClick={() => { bulkAddToList(l.id); setListPickerOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                      {l.name}
                    </button>
                  ))}
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
                  <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-white/[.08] bg-[#0f1117] p-2 shadow-xl">
                    <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Edit {selected.size} records</p>
                    {bulkEditCols.map(col => {
                      const isStage = col.toLowerCase().includes("stage") || col === "status";
                      const isOwner = col.toLowerCase().includes("owner") || col.toLowerCase().includes("assign");
                      const stageVals = isStage ? [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))] : [];
                      return (
                        <div key={col} className="mb-1">
                          <p className="px-2 py-1 text-[10px] text-slate-600 uppercase tracking-wide">{col.replaceAll("_", " ")}</p>
                          {isStage && stageVals.map(v => (
                            <button key={v} onClick={() => applyBulkEdit(col, v)}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                              <span className={`h-2 w-2 rounded-full ${stageStyle(v).dot}`}/>{v}
                            </button>
                          ))}
                          {isOwner && members.map(m => {
                            const label = m.name || m.email || "?";
                            return (
                              <button key={m.id} onClick={() => applyBulkEdit(col, label)}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/60 hover:bg-white/[.05] hover:text-white transition-colors">
                                <MemberAvatar name={label} size={4}/>{label}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
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
              {/* Checkbox column — tight fit around the 16px checkbox */}
              <th className="w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06] sticky left-0 z-30">
                <div
                  onClick={toggleSelectAll}
                  className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${allSelected ? "bg-red-500 border-red-500" : someSelected ? "border-white/30 bg-white/[.06]" : "border-white/[.10] hover:border-white/30"}`}
                >
                  {allSelected && <Check size={10} className="text-white" strokeWidth={3}/>}
                  {!allSelected && someSelected && <div className="h-1.5 w-1.5 rounded-sm bg-white/60" />}
                </div>
              </th>
              {orderedColumns.map((col, colIdx) => {
                const w = colWidths[col];
                return (
                  <th
                    key={col}
                    style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
                    className={`relative px-4 py-2.5 bg-[#0b0d10] border-b border-b-white/[.06] select-none ${colIdx === 0 ? "sticky left-8 z-30 shadow-[2px_0_8px_rgba(0,0,0,0.4)]" : ""}`}
                    draggable={colIdx > 0}
                    onDragStart={() => { dragColRef.current = col; }}
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
                    onContextMenu={e => { e.preventDefault(); setColCtxMenu({ col, x: e.clientX, y: e.clientY }); }}
                  >
                    <button onClick={() => handleHeaderSort(col)}
                      className={`flex items-center gap-1.5 text-white/30 hover:text-white/70 transition-colors min-w-0 w-full ${isNumeric(col) ? "ml-auto" : ""}`}>
                      {getColumnIcon(col)}
                      <span className="text-[10px] font-semibold tracking-widest uppercase whitespace-nowrap">{col.replaceAll("_", " ")}</span>
                      <SortIcon col={col}/>
                    </button>
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
                    onAdd={(key, type) => { setCustomCols(prev => [...prev, { key, type }]); setOpenPanel(null); }}
                    onClose={() => setOpenPanel(null)}
                    triggerRef={addColHeaderRef}
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
            ) : (
              sorted.map((record, rowIdx) => (
                <tr
                  key={record.id}
                  className={`group transition-colors ${selected.has(record.id) ? "bg-red-500/[.05]" : rowIdx % 2 === 1 ? "bg-white/[.008]" : ""} hover:bg-white/[.03] ${rowAccent(record)}`}
                >
                  {/* Row checkbox */}
                  <td className={`w-8 min-w-[32px] max-w-[32px] px-2 py-2.5 border-b border-b-white/[.04] sticky left-0 z-10 ${selected.has(record.id) ? "bg-[#130d0d] group-hover:bg-[#170f0f]" : "bg-[#0b0d10] group-hover:bg-[#0f1115]"}`}>
                    <div
                      onClick={() => toggleSelectRow(record.id)}
                      className={`h-4 w-4 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${selected.has(record.id) ? "bg-red-500 border-red-500" : "border-white/[.10] opacity-0 group-hover:opacity-100 hover:border-white/30"}`}
                    >
                      {selected.has(record.id) && <Check size={10} className="text-white" strokeWidth={3}/>}
                    </div>
                  </td>
                  {orderedColumns.map((col, colIdx) => (
                    <td
                      key={col}
                      className={`px-4 py-2.5 text-white/70 border-b border-b-white/[.04] overflow-hidden max-w-[240px] ${isNumeric(col) ? "text-right tabular-nums font-mono text-white/50" : ""} ${colIdx === 0 ? "sticky left-8 z-10 shadow-[2px_0_8px_rgba(0,0,0,0.4)] font-medium text-white/90 " + (selected.has(record.id) ? "bg-[#130d0d] group-hover:bg-[#170f0f]" : "bg-[#0b0d10] group-hover:bg-[#0f1115]") : ""}`}
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
              ))
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              {/* Blank checkbox placeholder so name column aligns with body */}
              <td className="w-8 min-w-[32px] max-w-[32px] bg-[#0d0f13] border-t border-t-zinc-800/60 sticky left-0 z-30" />
              {orderedColumns.map((col, colIdx) => (
                <td
                  key={col}
                  className={`px-3 py-3 bg-[#0d0f13] border-t border-t-zinc-800/60 text-[12px] ${isNumeric(col) ? "text-right" : ""} ${colIdx === 0 ? "sticky left-8 z-30 shadow-[2px_0_8px_rgba(0,0,0,0.4)]" : "border-r border-r-zinc-800/15"}`}
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
                setCustomCols(prev => prev.filter(c => c.key !== col));
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
