import { useQuery } from "@tanstack/react-query";
import { Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2, ChevronDown, ChevronUp, ChevronsUpDown, Plus, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { apiClient } from "../../lib/api-client";
import { EmptyState, ErrorState, PageSkeleton } from "../ui/page-state";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string; ai_summary?: string }
type CalcOp = "sum" | "avg" | "min" | "max" | "count" | "filled" | null;

function display(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getColumnIcon(col: string) {
  const lower = col.toLowerCase();
  if (lower.includes("name") || lower.includes("person") || lower.includes("contact")) return <User size={12} className="text-slate-600"/>;
  if (lower.includes("email")) return <Mail size={12} className="text-slate-600"/>;
  if (lower.includes("phone")) return <Phone size={12} className="text-slate-600"/>;
  if (lower.includes("company") || lower.includes("org")) return <Building2 size={12} className="text-slate-600"/>;
  if (lower.includes("date") || lower.includes("created") || lower.includes("updated")) return <Calendar size={12} className="text-slate-600"/>;
  if (lower.includes("tag") || lower.includes("label") || lower.includes("status")) return <Tag size={12} className="text-slate-600"/>;
  if (lower.includes("url") || lower.includes("website") || lower.includes("link")) return <Globe size={12} className="text-slate-600"/>;
  if (lower.includes("amount") || lower.includes("price") || lower.includes("value") || lower.includes("count")) return <Hash size={12} className="text-slate-600"/>;
  return <Database size={12} className="text-slate-600"/>;
}

function isNumeric(col: string) {
  const lower = col.toLowerCase();
  return lower.includes("amount") || lower.includes("price") || lower.includes("value") || lower.includes("count") || lower.includes("number");
}

function RowLogo({ name }: { name: string }) {
  const initials = String(name).split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-red-500/20 text-red-400", "bg-blue-500/20 text-blue-400", "bg-emerald-500/20 text-emerald-400", "bg-purple-500/20 text-purple-400", "bg-amber-500/20 text-amber-400"];
  const color = colors[initials.charCodeAt(0) % colors.length];
  return (
    <div className={`h-6 w-6 rounded shrink-0 flex items-center justify-center text-[10px] font-semibold ${color}`}>
      {initials || "?"}
    </div>
  );
}

// --- Calculation engine ---
function calcResult(op: CalcOp, col: string, records: NodeRecord[]): string {
  if (!op) return "";
  const vals = records.map(r => r.data[col]);

  if (op === "count") return String(vals.length);

  if (op === "filled") {
    const filled = vals.filter(v => v != null && v !== "" && v !== "—").length;
    return `${Math.round((filled / vals.length) * 100)}% filled`;
  }

  const nums = vals.map(v => parseFloat(String(v).replace(/[^0-9.-]/g, ""))).filter(n => !isNaN(n));
  if (!nums.length) return "—";

  if (op === "sum") {
    const s = nums.reduce((a, b) => a + b, 0);
    return s % 1 === 0 ? s.toLocaleString() : s.toFixed(2);
  }
  if (op === "avg") {
    const a = nums.reduce((a, b) => a + b, 0) / nums.length;
    return a % 1 === 0 ? a.toLocaleString() : a.toFixed(2);
  }
  if (op === "min") return String(Math.min(...nums));
  if (op === "max") return String(Math.max(...nums));
  return "—";
}

// --- Calc dropdown ---
function CalcDropdown({ col, current, onSelect, onClose }: { col: string; current: CalcOp; onSelect: (op: CalcOp) => void; onClose: () => void }) {
  const numeric = isNumeric(col);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const options: { op: CalcOp; label: string }[] = numeric
    ? [
        { op: "sum",   label: "Sum" },
        { op: "avg",   label: "Average" },
        { op: "min",   label: "Min" },
        { op: "max",   label: "Max" },
        { op: "count", label: "Count" },
        { op: "filled",label: "% Filled" },
      ]
    : [
        { op: "count",  label: "Count" },
        { op: "filled", label: "% Filled" },
      ];

  return (
    <div ref={ref} className="dropdown-panel absolute bottom-full left-0 mb-1 w-36 z-50">
      {options.map(({ op, label }) => (
        <button key={op} onClick={() => { onSelect(op); onClose(); }}
          className={`dropdown-item w-full ${current === op ? "dropdown-item-active" : ""}`}>
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

export function RecordTable({ objectType }: { objectType: string }) {
  const query = useQuery({ queryKey: ["records", objectType], queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`) });
  const records = query.data ?? [];
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record.data)))).slice(0, 8);

  // Sorting
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Calculations
  const [calculations, setCalculations] = useState<Record<string, CalcOp>>({});
  const [openCalcCol, setOpenCalcCol] = useState<string | null>(null);

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sorted = [...records].sort((a, b) => {
    if (!sortCol) return 0;
    const av = sortCol === "__updated_at" ? a.updated_at : display(a.data[sortCol]);
    const bv = sortCol === "__updated_at" ? b.updated_at : display(b.data[sortCol]);
    const an = parseFloat(av.replace(/[^0-9.-]/g, ""));
    const bn = parseFloat(bv.replace(/[^0-9.-]/g, ""));
    const numCompare = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
    return sortDir === "asc" ? numCompare : -numCompare;
  });

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) return <ChevronsUpDown size={10} className="text-slate-700 ml-1 shrink-0"/>;
    return sortDir === "asc"
      ? <ChevronUp size={10} className="text-red-400 ml-1 shrink-0"/>
      : <ChevronDown size={10} className="text-red-400 ml-1 shrink-0"/>;
  }

  if (query.isLoading) return <div className="mt-6"><PageSkeleton /></div>;
  if (query.isError) return <div className="mt-6"><ErrorState error={query.error as Error} onRetry={() => query.refetch()} /></div>;
  if (!records.length) return <div className="mt-6"><EmptyState icon={Database} title={`No ${objectType}`} description="Create a record manually or ask Mondaily to build this collection." /></div>;

  return (
    <section className="mt-6 overflow-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} className="whitespace-nowrap px-4 py-2 border-b border-white/[.05]">
                <button onClick={() => handleSort(col)}
                  className={`flex items-center gap-1.5 hover:text-slate-300 transition-colors ${isNumeric(col) ? "ml-auto" : ""}`}>
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
          {sorted.map((record) => (
            <tr key={record.id} className="border-b border-white/[.04] hover:bg-white/[.015] transition-colors">
              {columns.map((col, index) => (
                <td key={col} className={`px-4 py-2.5 text-slate-300 text-sm ${isNumeric(col) ? "text-right tabular-nums font-mono text-slate-400" : "max-w-64 truncate"}`}>
                  {index === 0 ? (
                    <Link to={`/objects/${objectType}/${record.id}`} className="flex items-center gap-2.5 font-medium text-white hover:text-red-400 transition-colors">
                      <RowLogo name={display(record.data[col])}/>
                      <span className="truncate">{display(record.data[col])}</span>
                    </Link>
                  ) : display(record.data[col])}
                </td>
              ))}
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                {new Date(record.updated_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>

        {/* Calculation row */}
        <tfoot>
          <tr className="border-t border-white/[.08]">
            {columns.map((col) => (
              <td key={col} className={`px-4 py-2 ${isNumeric(col) ? "text-right" : ""}`}>
                <div className={`relative inline-block ${isNumeric(col) ? "ml-auto" : ""}`}>
                  {openCalcCol === col && (
                    <CalcDropdown
                      col={col}
                      current={calculations[col] ?? null}
                      onSelect={(op) => setCalculations(prev => ({ ...prev, [col]: op }))}
                      onClose={() => setOpenCalcCol(null)}
                    />
                  )}
                  {calculations[col] ? (
                    <button onClick={() => setOpenCalcCol(col === openCalcCol ? null : col)}
                      className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors tabular-nums font-mono">
                      <span className="text-slate-600 uppercase text-[10px] tracking-wide mr-0.5">
                        {calculations[col]}
                      </span>
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
            {/* Updated col — count only */}
            <td className="px-4 py-2 text-[11px] text-slate-700 tabular-nums">
              {sorted.length} rows
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
