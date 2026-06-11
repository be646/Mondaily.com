import { useQuery } from "@tanstack/react-query";
import {
  Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2,
  ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check, Search, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect, useMemo } from "react";
import { apiClient } from "../../lib/api-client";
import { ErrorState, PageSkeleton } from "../ui/page-state";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string }
type CalcOp = "sum" | "avg" | "min" | "max" | "count" | "filled" | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function display(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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

function RowLogo({ name }: { name: string }) {
  const initials = String(name).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-red-500/20 text-red-400","bg-blue-500/20 text-blue-400","bg-emerald-500/20 text-emerald-400","bg-purple-500/20 text-purple-400","bg-amber-500/20 text-amber-400"];
  const color = colors[(initials.charCodeAt(0) || 0) % colors.length];
  return (
    <div className={`h-6 w-6 rounded shrink-0 flex items-center justify-center text-[10px] font-semibold ${color}`}>
      {initials || "?"}
    </div>
  );
}

function StagePill({ value }: { value: string }) {
  const map: Record<string, string> = {
    "Lead":        "bg-slate-500/15 text-slate-400",
    "Qualified":   "bg-blue-500/15 text-blue-400",
    "In Progress": "bg-blue-500/15 text-blue-400",
    "Proposal":    "bg-purple-500/15 text-purple-400",
    "Negotiation": "bg-amber-500/15 text-amber-400",
    "Closed Won":  "bg-emerald-500/15 text-emerald-400",
    "Closed Lost": "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${map[value] ?? "bg-slate-500/15 text-slate-400"}`}>
      {value}
    </span>
  );
}

// ─── Calculation engine ───────────────────────────────────────────────────────
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
function CalcDropdown({ col, current, onSelect, onClose }: {
  col: string; current: CalcOp; onSelect: (op: CalcOp) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const options: { op: CalcOp; label: string }[] = isNumeric(col)
    ? [{ op:"sum",label:"Sum" },{ op:"avg",label:"Average" },{ op:"min",label:"Min" },{ op:"max",label:"Max" },{ op:"count",label:"Count" },{ op:"filled",label:"% Filled" }]
    : [{ op:"count",label:"Count" },{ op:"filled",label:"% Filled" }];

  return (
    <div ref={ref} className="dropdown-panel absolute bottom-full left-0 mb-1 w-36 z-50">
      {options.map(({ op, label }) => (
        <button
          key={op}
          onClick={() => { onSelect(op); onClose(); }}
          className={`dropdown-item w-full ${current === op ? "dropdown-item-active" : ""}`}
        >
          {label}
          {current === op && <Check size={11} className="ml-auto text-red-400"/>}
        </button>
      ))}
      {current && (
        <>
          <div className="mx-2 my-1 border-t border-white/[.06]"/>
          <button onClick={() => { onSelect(null); onClose(); }} className="dropdown-item w-full text-slate-500">
            Clear
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main table ───────────────────────────────────────────────────────────────
export function RecordTable({ objectType }: { objectType: string }) {
  const query = useQuery({
    queryKey: ["records", objectType],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`),
  });

  const records = query.data ?? [];
  const columns = useMemo(
    () => Array.from(new Set(records.flatMap(r => Object.keys(r.data)))).slice(0, 8),
    [records],
  );

  // ── Filter state ──
  const [filterText, setFilterText] = useState("");

  // ── Sort state ──
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── Calculation state ──
  const [calculations, setCalculations] = useState<Record<string, CalcOp>>({});
  const [openCalcCol, setOpenCalcCol] = useState<string | null>(null);

  // Reset filter when objectType changes
  useEffect(() => { setFilterText(""); setSortCol(null); }, [objectType]);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  // ── Filter then sort pipeline ──
  const filtered = useMemo(() => {
    if (!filterText.trim()) return records;
    const q = filterText.toLowerCase();
    return records.filter(r =>
      Object.values(r.data).some(v => String(v ?? "").toLowerCase().includes(q))
    );
  }, [records, filterText]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const av = sortCol === "__updated_at" ? a.updated_at : display(a.data[sortCol]);
      const bv = sortCol === "__updated_at" ? b.updated_at : display(b.data[sortCol]);
      const an = typeof a.data[sortCol] === "number" ? (a.data[sortCol] as number) : parseFloat(av.replace(/[^0-9.-]/g, ""));
      const bn = typeof b.data[sortCol] === "number" ? (b.data[sortCol] as number) : parseFloat(bv.replace(/[^0-9.-]/g, ""));
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) return <ChevronsUpDown size={10} className="text-slate-700 ml-1 shrink-0"/>;
    return sortDir === "asc"
      ? <ChevronUp size={10} className="text-red-400 ml-1 shrink-0"/>
      : <ChevronDown size={10} className="text-red-400 ml-1 shrink-0"/>;
  }

  function renderCell(col: string, record: NodeRecord, colIndex: number) {
    const val = record.data[col];
    if (col.toLowerCase().includes("stage") && typeof val === "string") return <StagePill value={val}/>;
    if (colIndex === 0) {
      return (
        <Link to={`/objects/${objectType}/${record.id}`} className="flex items-center gap-2.5 font-medium text-white hover:text-red-400 transition-colors">
          <RowLogo name={display(val)}/>
          <span className="truncate">{display(val)}</span>
        </Link>
      );
    }
    return <span className="truncate">{display(val)}</span>;
  }

  // ── States ──
  if (query.isLoading) return <div className="mt-4"><PageSkeleton /></div>;
  if (query.isError)   return <div className="mt-4"><ErrorState error={query.error as Error} onRetry={() => query.refetch()} /></div>;
  if (!records.length) return (
    <div className="mt-4 flex min-h-64 flex-col items-center justify-center rounded-lg border border-white/[.05] bg-white/[.01] px-6 text-center">
      <Database className="mb-3 text-slate-700" size={26}/>
      <h2 className="text-sm font-medium text-slate-300">No {objectType} yet</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-600">Create a record to get started.</p>
    </div>
  );

  return (
    <section className="flex flex-col gap-3">
      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/>
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder={`Filter ${objectType}…`}
            className="key-input w-full py-1.5 pl-8 pr-8 text-xs"
          />
          {filterText && (
            <button
              onClick={() => setFilterText("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white transition-colors"
            >
              <X size={12}/>
            </button>
          )}
        </div>
        {filterText && (
          <span className="text-xs text-slate-600 tabular-nums">
            {sorted.length} of {records.length}
          </span>
        )}
      </div>

      {/* ── Table ── */}
      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col} className="whitespace-nowrap px-4 py-2 border-b border-white/[.05]">
                  <button
                    onClick={() => handleSort(col)}
                    className={`flex items-center gap-1.5 hover:text-slate-300 transition-colors ${isNumeric(col) ? "ml-auto" : ""}`}
                  >
                    {getColumnIcon(col)}
                    <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">{col.replaceAll("_", " ")}</span>
                    <SortIcon col={col}/>
                  </button>
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-2 border-b border-white/[.05]">
                <button onClick={() => handleSort("__updated_at")} className="flex items-center gap-1.5 hover:text-slate-300 transition-colors">
                  <Calendar size={11} className="text-slate-600"/>
                  <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">Updated</span>
                  <SortIcon col="__updated_at"/>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-sm text-slate-600">
                  No results for "{filterText}"
                </td>
              </tr>
            ) : (
              sorted.map(record => (
                <tr key={record.id} className="border-b border-white/[.04] hover:bg-white/[.015] transition-colors">
                  {columns.map((col, i) => (
                    <td
                      key={col}
                      className={`px-4 py-2.5 text-sm text-slate-300 ${isNumeric(col) ? "text-right tabular-nums font-mono text-slate-400" : "max-w-64"}`}
                    >
                      {renderCell(col, record, i)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                    {new Date(record.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/[.08]">
              {columns.map(col => (
                <td key={col} className={`px-4 py-2 ${isNumeric(col) ? "text-right" : ""}`}>
                  <div className={`relative inline-block ${isNumeric(col) ? "ml-auto" : ""}`}>
                    {openCalcCol === col && (
                      <CalcDropdown
                        col={col}
                        current={calculations[col] ?? null}
                        onSelect={op => setCalculations(prev => ({ ...prev, [col]: op }))}
                        onClose={() => setOpenCalcCol(null)}
                      />
                    )}
                    {calculations[col] ? (
                      <button
                        onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors tabular-nums font-mono"
                      >
                        <span className="text-slate-600 uppercase text-[10px] tracking-wide mr-0.5">{calculations[col]}</span>
                        {calcResult(calculations[col], col, sorted)}
                      </button>
                    ) : (
                      <button
                        onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                        className="flex items-center gap-1 text-[11px] text-slate-700 hover:text-slate-400 transition-colors group"
                      >
                        <Plus size={10} className="group-hover:text-red-400 transition-colors"/>
                        <span>Calculate</span>
                      </button>
                    )}
                  </div>
                </td>
              ))}
              <td className="px-4 py-2 text-[11px] text-slate-700 tabular-nums">
                {sorted.length} rows
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
