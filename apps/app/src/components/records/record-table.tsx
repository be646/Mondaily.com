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

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string }
type CalcOp = "sum" | "avg" | "min" | "max" | "count" | "filled" | null;
type SortDir = "asc" | "desc";
interface SortRule { col: string; dir: SortDir }

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

function StagePill({ value }: { value: string }) {
  const map: Record<string, string> = {
    "Lead":        "bg-zinc-900/60 text-zinc-400 border border-zinc-700/50",
    "Qualified":   "bg-amber-950/30 text-amber-400 border border-amber-900/40",
    "In Progress": "bg-amber-950/30 text-amber-400 border border-amber-900/40",
    "Proposal":    "bg-amber-950/30 text-amber-400 border border-amber-900/40",
    "Negotiation": "bg-amber-950/30 text-amber-400 border border-amber-900/40",
    "Closed Won":  "bg-emerald-950/40 text-emerald-400 border border-emerald-900/50",
    "Closed Lost": "bg-rose-950/40 text-rose-400 border border-rose-900/50",
  };
  const dot: Record<string, string> = {
    "Lead": "bg-zinc-500", "Qualified": "bg-amber-400", "In Progress": "bg-amber-400",
    "Proposal": "bg-amber-400", "Negotiation": "bg-amber-400",
    "Closed Won": "bg-emerald-400", "Closed Lost": "bg-rose-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${map[value] ?? "bg-slate-900/80 text-slate-300 border border-slate-700/60"}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot[value] ?? "bg-slate-500"}`}/>
      {value}
    </span>
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
interface Member { id: string; name: string; email: string; avatar_url?: string }

function OwnerCell({ value, members, onSelect }: {
  value: string;
  members: Member[];
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function initials(name: string | null | undefined) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0] ?? "").filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  }

  const assigned = members.find(m => m.name === value || m.email === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 group/owner"
      >
        {assigned ? (
          <>
            <div className="h-5 w-5 rounded-full bg-zinc-700/60 text-zinc-300 flex items-center justify-center text-[9px] font-semibold shrink-0">
              {initials(assigned.name || assigned.email || "")}
            </div>
            <span className="text-xs text-slate-300 truncate max-w-[80px]">{assigned.name || assigned.email || "?"}</span>
          </>
        ) : (
          <div className="flex items-center gap-1 text-slate-700 hover:text-slate-400 transition-colors">
            <UserCircle2 size={14}/>
            <span className="text-[11px]">Assign</span>
          </div>
        )}
      </button>
      {open && (
        <PortalDropdown triggerRef={ref} onClose={() => setOpen(false)} align="left" className="w-44">
          <div className="px-3 py-1.5 border-b border-white/[.06]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Assign to</p>
          </div>
          {members.length === 0 && <p className="px-3 py-2 text-xs text-slate-600">No members yet</p>}
          {members.map(m => {
            const label = m.name || m.email || "Unknown";
            const isActive = m.name === value || m.email === value;
            return (
              <button key={m.id} onClick={() => { onSelect(label); setOpen(false); }}
                className={`dropdown-item w-full gap-2 ${isActive ? "dropdown-item-active" : ""}`}>
                <div className="h-5 w-5 rounded-full bg-zinc-700/50 text-zinc-300 flex items-center justify-center text-[9px] font-semibold shrink-0">
                  {initials(label)}
                </div>
                <span className="truncate">{label}</span>
                {m.role && <span className="ml-auto text-[9px] text-slate-500 capitalize shrink-0">{m.role}</span>}
                {isActive && <Check size={11} className="ml-1 text-red-400 shrink-0"/>}
              </button>
            );
          })}
          {value && (
            <>
              <div className="mx-2 my-1 border-t border-white/[.06]"/>
              <button onClick={() => { onSelect(""); setOpen(false); }} className="dropdown-item w-full text-slate-500">
                Clear
              </button>
            </>
          )}
        </PortalDropdown>
      )}
    </div>
  );
}

// ─── Add column dropdown ───────────────────────────────────────────────────────
const COLUMN_TYPES = [
  { type: "text",   label: "Text",    icon: Type },
  { type: "number", label: "Number",  icon: Hash },
  { type: "toggle", label: "Checkbox",icon: ToggleLeft },
  { type: "date",   label: "Date",    icon: Calendar },
  { type: "owner",  label: "Owner",   icon: UserCircle2 },
] as const;

function AddColumnDropdown({ onAdd, onClose, triggerRef }: {
  onAdd: (name: string, type: string) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | HTMLTableCellElement | null>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit() {
    const slug = name.trim().toLowerCase().replace(/\s+/g, "_");
    if (!slug) return;
    onAdd(slug, type);
    onClose();
  }

  return (
    <PortalDropdown triggerRef={triggerRef} onClose={onClose} align="right" className="w-56 !p-3 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">New column</p>
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
        placeholder="Column name…"
        className="w-full rounded-md border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none focus:border-red-500/30"
      />
      <div className="grid grid-cols-2 gap-1">
        {COLUMN_TYPES.map(({ type: t, label, icon: Icon }) => (
          <button key={t} onClick={() => setType(t)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${type === t ? "border-zinc-600/60 bg-zinc-800/60 text-white" : "border-white/[.06] text-slate-500 hover:text-slate-300"}`}>
            <Icon size={11}/>{label}
          </button>
        ))}
      </div>
      <button onClick={submit} disabled={!name.trim()}
        className="w-full rounded-lg bg-red-500 py-1.5 text-xs font-semibold text-white hover:bg-red-400 transition-colors disabled:opacity-40">
        Add column
      </button>
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

  // ── NLP ──
  const [nlpActive, setNlpActive] = useState(false);

  // ── Toolbar dropdown open state ──
  const [openPanel, setOpenPanel] = useState<"view"|"sort"|"export"|"addcol"|null>(null);

  // ── Toolbar trigger refs (for portal positioning) ──
  const viewWrapRef   = useRef<HTMLDivElement>(null);
  const sortWrapRef   = useRef<HTMLDivElement>(null);
  const exportWrapRef = useRef<HTMLDivElement>(null);
  // Add column lives in the table header now
  const addColHeaderRef = useRef<HTMLTableCellElement>(null);

  // ── Calc footer trigger refs (dynamic columns) ──
  const calcWrapRefs = useRef(new Map<string, HTMLDivElement>());

  // ── Custom columns (appended by user) ──
  const [customCols, setCustomCols] = useState<{ key: string; type: string }[]>([]);
  const allColumnsWithCustom = useMemo(() => [...allColumns, ...customCols.map(c => c.key)], [allColumns, customCols]);
  const columns = useMemo(() => allColumnsWithCustom.filter(c => !hiddenCols.has(c)), [allColumnsWithCustom, hiddenCols]);

  useEffect(() => { onColumnsChange?.(columns); }, [columns]);

  // ── Owner cell state: recordId → owner name ──
  const [owners, setOwners] = useState<Record<string, string>>({});

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
    if (!filterText.trim()) return base;
    const q2 = filterText.toLowerCase();
    return base.filter(r => Object.values(r.data).some(v => String(v ?? "").toLowerCase().includes(q2)));
  }, [records, filterText, filterQuery]);

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

  // ── Bulk selection ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

    // Custom owner column
    if (customDef?.type === "owner" || col === "owner" || col === "assignee") {
      return (
        <OwnerCell
          value={String(owners[record.id] ?? val ?? "")}
          members={members}
          onSelect={name => setOwners(prev => ({ ...prev, [record.id]: name }))}
        />
      );
    }

    // Custom column — empty by default
    if (customDef) return <span className="text-slate-700 text-xs">—</span>;

    // Categories
    if (col === "categories") return <CategoryBadges value={val}/>;

    // Owner/assigned_to columns
    if (col === "assigned_to" || col === "deal_owner") {
      return (
        <OwnerCell
          value={String(owners[record.id] ?? val ?? "")}
          members={members}
          onSelect={name => setOwners(prev => ({ ...prev, [record.id]: name }))}
        />
      );
    }

    // Stage pill (still editable via dropdown in the pill itself)
    if (col.toLowerCase().includes("stage") && typeof val === "string") return <StagePill value={val}/>;

    // Name column — editable text + open link on hover
    if (col === nameCol) return (
      <div className="flex items-center gap-2 min-w-0">
        <RowLogo name={display(val)} enriched={isEnriched}/>
        <EditableCell
          raw={val}
          onSave={v => saveCell(record, col, v)}
          className="flex-1 font-medium text-white"
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

    // All other fields — inline editable
    return (
      <EditableCell
        raw={val}
        numeric={isNumeric(col)}
        onSave={v => saveCell(record, col, v)}
      />
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

  const TOOL_BTN_BASE = "flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs font-medium tracking-wide transition-all duration-200";
  const TOOL_BTN_IDLE = `${TOOL_BTN_BASE} border-zinc-800/80 bg-zinc-900/20 text-zinc-300 hover:border-zinc-700/60 hover:text-white`;
  const TOOL_BTN_ON   = `${TOOL_BTN_BASE} border-zinc-600/60 bg-zinc-800/30 text-white`;

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

      {/* ── Table — edge-to-edge, flex-fills remaining height ─────────────────
            KEY: border-separate + border-spacing-0 prevents the sticky-element
            shaking bug that border-collapse causes in Chromium. Separators are
            handled per-cell so they composite correctly with the GPU layers.   */}
      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-6 py-2 border-b border-white/[.06] bg-red-500/[.04] shrink-0">
          <span className="text-xs font-semibold text-red-400">{selected.size} selected</span>
          <div className="h-3 w-px bg-white/10" />
          {/* Add to list */}
          <div className="relative">
            <button
              onClick={() => setListPickerOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
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

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto [contain:strict]">
        <table className="min-w-full border-separate border-spacing-0 text-left text-[12px]">
          <thead className="sticky top-0 z-20" style={{ transform: "translateZ(0)", willChange: "transform" }}>
            <tr>
              {/* Checkbox column */}
              <th className="w-8 px-2 py-[7px] bg-[#0d0f13] border-b border-b-zinc-800/70 sticky left-0 z-30" style={{ transform: "translateZ(0)", willChange: "transform" }}>
                <button
                  onClick={toggleSelectAll}
                  className={`h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors ${allSelected ? "bg-red-500 border-red-500" : "border-zinc-700 hover:border-zinc-500"}`}
                >
                  {allSelected && <Check size={9} className="text-white" />}
                  {!allSelected && someSelected && <div className="h-1.5 w-1.5 rounded-sm bg-zinc-500" />}
                </button>
              </th>
              {columns.map((col, colIdx) => (
                <th
                  key={col}
                  className={`whitespace-nowrap px-3 py-[7px] bg-[#0d0f13] border-b border-b-zinc-800/70 ${colIdx === 0 ? "sticky left-0 z-30" : "border-r border-r-zinc-800/20"}`}
                  style={colIdx === 0 ? { transform: "translateZ(0)", willChange: "transform", boxShadow: "1px 0 0 0 rgba(63,63,70,0.45)" } : undefined}
                >
                  <button onClick={() => handleHeaderSort(col)}
                    className={`flex items-center gap-1.5 hover:text-zinc-200 transition-colors ${isNumeric(col) ? "ml-auto" : ""}`}>
                    {getColumnIcon(col)}
                    <span className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">{col.replaceAll("_", " ")}</span>
                    <SortIcon col={col}/>
                  </button>
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-[7px] bg-[#0d0f13] border-b border-b-zinc-800/70">
                <button onClick={() => handleHeaderSort("__updated_at")} className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors">
                  <Calendar size={11} className="text-zinc-600"/>
                  <span className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">Updated</span>
                  <SortIcon col="__updated_at"/>
                </button>
              </th>
              {/* Add column — inline last header cell */}
              <th
                ref={addColHeaderRef}
                className="w-8 px-2 py-[7px] bg-[#0d0f13] border-b border-b-zinc-800/70 border-l border-l-zinc-800/20 relative"
              >
                <button
                  onClick={() => setOpenPanel(p => p === "addcol" ? null : "addcol")}
                  className="flex h-5 w-5 items-center justify-center rounded text-zinc-700 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all"
                  title="Add column"
                >
                  <Plus size={12}/>
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
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-[12px] text-zinc-600">
                  No results{(filterText || filterQuery) ? ` for "${filterText || filterQuery}"` : ""}
                </td>
              </tr>
            ) : (
              sorted.map((record, rowIdx) => (
                <tr
                  key={record.id}
                  className={`group hover:bg-zinc-800/25 transition-colors ${rowIdx % 2 === 1 ? "bg-white/[.012]" : ""} ${selected.has(record.id) ? "bg-red-500/[.04]" : ""}`}
                >
                  {/* Row checkbox */}
                  <td className="w-8 px-2 py-[6px] border-b border-b-zinc-800/30 sticky left-0 z-10 bg-[#0d0f13] group-hover:bg-[#101215]" style={{ transform: "translateZ(0)", willChange: "transform" }}>
                    <button
                      onClick={() => toggleSelectRow(record.id)}
                      className={`h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors ${selected.has(record.id) ? "bg-red-500 border-red-500" : "border-zinc-700 opacity-0 group-hover:opacity-100"}`}
                    >
                      {selected.has(record.id) && <Check size={9} className="text-white" />}
                    </button>
                  </td>
                  {columns.map((col, colIdx) => (
                    <td
                      key={col}
                      className={`px-3 py-[6px] text-zinc-300 overflow-hidden border-b border-b-zinc-800/30 ${isNumeric(col) ? "text-right tabular-nums font-mono text-zinc-400 max-w-[140px]" : "max-w-[200px]"} ${colIdx !== 0 ? "border-r border-r-zinc-800/15" : ""} ${colIdx === 0 ? "sticky left-0 z-10 bg-[#0d0f13] group-hover:bg-[#101215]" : ""}`}
                      style={colIdx === 0 ? { transform: "translateZ(0)", willChange: "transform", boxShadow: "1px 0 0 0 rgba(63,63,70,0.45)" } : undefined}
                    >
                      {renderCell(col, record)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-[6px] text-[11px] text-zinc-600 tabular-nums border-b border-b-zinc-800/30">
                    {fmtDate(record.updated_at)}
                  </td>
                  <td className="border-b border-b-zinc-800/30 border-l border-l-zinc-800/20 w-8 px-1">
                    <button
                      onClick={() => deleteRow(record)}
                      className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-5 w-5 rounded text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Delete row"
                    >
                      <Trash2 size={11}/>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-20" style={{ transform: "translateZ(0)", willChange: "transform" }}>
            <tr>
              {columns.map(col => (
                <td
                  key={col}
                  className={`px-3 py-[6px] bg-[#0d0f13] border-t border-t-zinc-800/60 ${isNumeric(col) ? "text-right" : ""} ${col === columns[0] ? "sticky left-0 z-30" : "border-r border-r-zinc-800/15"}`}
                  style={col === columns[0] ? { transform: "translateZ(0)", willChange: "transform", boxShadow: "1px 0 0 0 rgba(63,63,70,0.45)" } : undefined}
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
              <td className="px-3 py-[6px] text-[11px] text-zinc-700 tabular-nums bg-[#0d0f13] border-t border-t-zinc-800/60">{sorted.length} rows</td>
              <td className="bg-[#0d0f13] border-t border-t-zinc-800/60 border-l border-l-zinc-800/20 w-8"/>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    {/* Undo delete toast */}
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
    </>
  );
}
