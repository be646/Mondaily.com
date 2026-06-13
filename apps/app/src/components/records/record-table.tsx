import { useQuery } from "@tanstack/react-query";
import {
  Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2,
  ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check, Search, X,
  Sparkles, Command, Settings2, ArrowUpDown, Download, GripVertical,
  UserCircle2, Type, ToggleLeft,
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
      className={`fixed z-[9999] rounded-lg border border-white/[.08] bg-[#13151a] shadow-[0_8px_32px_rgba(0,0,0,0.7),0_1px_0_rgba(255,255,255,0.04)_inset] p-1 ${className}`}
      style={style}
    >
      {children}
    </div>,
    document.body
  );
}

function RowLogo({ name, enriched }: { name: string; enriched?: boolean }) {
  const initials = String(name).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-zinc-800/70 text-zinc-300","bg-zinc-700/50 text-zinc-200","bg-zinc-800/50 text-zinc-400","bg-zinc-900/60 text-zinc-300","bg-zinc-800/60 text-zinc-400"];
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
                {isActive && <Check size={11} className="ml-auto text-red-400 shrink-0"/>}
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
  triggerRef: React.RefObject<HTMLElement | null>;
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

  const apply = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setStatus("thinking");
    setTimeout(() => {
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
    }, 600);
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
export function RecordTable({ objectType, enrichedIds = [], filterQuery = "" }: { objectType: string; enrichedIds?: string[]; filterQuery?: string }) {
  const query = useQuery({
    queryKey: ["records", objectType],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`),
  });

  const records = query.data ?? [];

  const allColumns = useMemo(() => {
    const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
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
  const addColWrapRef = useRef<HTMLDivElement>(null);

  // ── Calc footer trigger refs (dynamic columns) ──
  const calcWrapRefs = useRef(new Map<string, HTMLDivElement>());

  // ── Custom columns (appended by user) ──
  const [customCols, setCustomCols] = useState<{ key: string; type: string }[]>([]);
  const allColumnsWithCustom = useMemo(() => [...allColumns, ...customCols.map(c => c.key)], [allColumns, customCols]);
  const columns = useMemo(() => allColumnsWithCustom.filter(c => !hiddenCols.has(c)), [allColumnsWithCustom, hiddenCols]);

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

  function renderCell(col: string, record: NodeRecord) {
    const val = record.data[col];
    const isEnriched = enrichedIds.includes(record.id);

    // Owner column
    const customDef = customCols.find(c => c.key === col);
    if (customDef?.type === "owner" || col === "owner" || col === "assignee") {
      return (
        <OwnerCell
          value={String(owners[record.id] ?? val ?? "")}
          members={members}
          onSelect={name => setOwners(prev => ({ ...prev, [record.id]: name }))}
        />
      );
    }

    // Custom column — empty by default, show placeholder
    if (customDef) {
      return <span className="text-slate-700 text-xs">—</span>;
    }

    // Categories column — render color-coded badges
    if (col === "categories") return <CategoryBadges value={val}/>;

    // Owner/assignee/assigned_to columns — all render as OwnerCell
    if (col === "assigned_to" || col === "deal_owner" || col === "owner" || col === "assignee") {
      return (
        <OwnerCell
          value={String(owners[record.id] ?? val ?? "")}
          members={members}
          onSelect={name => setOwners(prev => ({ ...prev, [record.id]: name }))}
        />
      );
    }

    if (col.toLowerCase().includes("stage") && typeof val === "string") return <StagePill value={val}/>;
    if (col === nameCol) return (
      <Link to={`/objects/${objectType}/${record.id}`} className="flex items-center gap-2.5 font-medium text-white hover:text-red-400 transition-colors">
        <RowLogo name={display(val)} enriched={isEnriched}/>
        <span className="truncate">{display(val)}</span>
        {isEnriched && (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-sm bg-zinc-800/60 border border-zinc-700/50 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 shrink-0">
            <Sparkles size={8}/> AI
          </span>
        )}
      </Link>
    );
    return <span className="block truncate max-w-[180px] overflow-hidden text-xs">{display(val)}</span>;
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

          {/* Add column */}
          <div ref={addColWrapRef}>
            <button
              onClick={() => setOpenPanel(p => p === "addcol" ? null : "addcol")}
              className={openPanel === "addcol" ? TOOL_BTN_ON : TOOL_BTN_IDLE}
            >
              <Plus size={12}/>
              <span className="hidden sm:inline">Column</span>
            </button>
            {openPanel === "addcol" && (
              <AddColumnDropdown
                onAdd={(key, type) => setCustomCols(prev => [...prev, { key, type }])}
                onClose={() => setOpenPanel(null)}
                triggerRef={addColWrapRef}
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

      {/* ── Table — edge-to-edge, flex-fills remaining height ── */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto border-t border-zinc-800/40">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-20 bg-[#0d0f13] will-change-transform transform-gpu backface-hidden">
            <tr>
              {columns.map((col, colIdx) => (
                <th key={col} className={`whitespace-nowrap px-4 py-2 border-b border-zinc-800/60 bg-[#0d0f13] ${colIdx === 0 ? "sticky left-0 z-30 border-r border-r-zinc-800/40 will-change-transform transform-gpu" : ""}`}>
                  <button onClick={() => handleHeaderSort(col)}
                    className={`flex items-center gap-1.5 hover:text-slate-300 transition-colors ${isNumeric(col) ? "ml-auto" : ""}`}>
                    {getColumnIcon(col)}
                    <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">{col.replaceAll("_", " ")}</span>
                    <SortIcon col={col}/>
                  </button>
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-2 border-b border-zinc-800/60 bg-[#0d0f13]">
                <button onClick={() => handleHeaderSort("__updated_at")} className="flex items-center gap-1.5 hover:text-slate-300 transition-colors">
                  <Calendar size={11} className="text-slate-600"/>
                  <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">Updated</span>
                  <SortIcon col="__updated_at"/>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-sm text-slate-600">No results for "{filterText || filterQuery}"</td></tr>
            ) : (
              sorted.map(record => (
                <tr key={record.id} className="group border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                  {columns.map((col, colIdx) => (
                    <td key={col} className={`px-3 py-2.5 text-sm text-slate-300 overflow-hidden ${isNumeric(col) ? "text-right tabular-nums font-mono text-slate-400 max-w-[140px]" : "max-w-[200px]"} ${colIdx === 0 ? "sticky left-0 z-10 bg-[#0d0f13] group-hover:bg-[#111318] border-r border-r-zinc-800/40 will-change-transform transform-gpu" : ""}`}>
                      {renderCell(col, record)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                    {new Date(record.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 bg-[#0d0f13] will-change-transform transform-gpu">
            <tr className="border-t border-zinc-800/60">
              {columns.map(col => (
                <td key={col} className={`px-4 py-2 bg-[#0d0f13] ${isNumeric(col) ? "text-right" : ""}`}>
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
                        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors tabular-nums font-mono">
                        <span className="text-slate-600 uppercase text-[10px] tracking-wide mr-0.5">{calculations[col]}</span>
                        {calcResult(calculations[col], col, sorted)}
                      </button>
                    ) : (
                      <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                        className="flex items-center gap-1 text-[11px] text-slate-700 hover:text-slate-400 transition-colors group">
                        <Plus size={10} className="group-hover:text-red-400 transition-colors"/>
                        <span>Calculate</span>
                      </button>
                    )}
                  </div>
                </td>
              ))}
              <td className="px-4 py-2 text-[11px] text-slate-700 tabular-nums bg-[#0d0f13]">{sorted.length} rows</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
