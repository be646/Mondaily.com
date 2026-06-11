import { useQuery } from "@tanstack/react-query";
import { Database, User, Hash, Calendar, Tag, Mail, Phone, Globe, Building2, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import { EmptyState, ErrorState, PageSkeleton } from "../ui/page-state";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string; ai_summary?: string }

function display(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getColumnIcon(col: string) {
  const lower = col.toLowerCase();
  if (lower.includes("name") || lower.includes("person") || lower.includes("contact")) return <User size={12} className="text-slate-500"/>;
  if (lower.includes("email")) return <Mail size={12} className="text-slate-500"/>;
  if (lower.includes("phone")) return <Phone size={12} className="text-slate-500"/>;
  if (lower.includes("company") || lower.includes("org")) return <Building2 size={12} className="text-slate-500"/>;
  if (lower.includes("date") || lower.includes("created") || lower.includes("updated")) return <Calendar size={12} className="text-slate-500"/>;
  if (lower.includes("tag") || lower.includes("label") || lower.includes("status")) return <Tag size={12} className="text-slate-500"/>;
  if (lower.includes("url") || lower.includes("website") || lower.includes("link")) return <Globe size={12} className="text-slate-500"/>;
  if (lower.includes("amount") || lower.includes("price") || lower.includes("value") || lower.includes("count")) return <Hash size={12} className="text-slate-500"/>;
  return <Database size={12} className="text-slate-500"/>;
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

export function RecordTable({ objectType }: { objectType: string }) {
  const query = useQuery({ queryKey: ["records", objectType], queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`) });
  const records = query.data ?? [];
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record.data)))).slice(0, 8);

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
                <div className={`flex items-center gap-1.5 ${isNumeric(col) ? "justify-end" : ""}`}>
                  {getColumnIcon(col)}
                  <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">{col.replaceAll("_", " ")}</span>
                </div>
              </th>
            ))}
            <th className="whitespace-nowrap px-4 py-2 border-b border-white/[.05]">
              <div className="flex items-center gap-1.5">
                <Calendar size={11} className="text-slate-600"/>
                <span className="text-[11px] font-medium tracking-wide text-slate-600 uppercase">Updated</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
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
      </table>
    </section>
  );
}
