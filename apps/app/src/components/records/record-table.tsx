import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageSkeleton } from "../ui/page-state";

interface NodeRecord { id: string; data: Record<string, unknown>; updated_at: string; ai_summary?: string }

function display(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RecordTable({ objectType }: { objectType: string }) {
  const query = useQuery({ queryKey: ["records", objectType], queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(objectType)}`) });
  const records = query.data ?? [];
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record.data)))).slice(0, 8);
  if (query.isLoading) return <div className="mt-6"><PageSkeleton /></div>;
  if (!records.length) return <div className="mt-6"><EmptyState icon={Database} title={`No ${objectType}`} description="Create a record manually or ask Mondaily to build this collection." /></div>;
  return <section className="mt-6 overflow-auto rounded-lg border border-white/10"><table className="min-w-full border-collapse text-left text-sm"><thead><tr className="border-b border-white/10 bg-white/[.025]">{columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 text-xs font-medium capitalize text-slate-500">{column.replaceAll("_", " ")}</th>)}<th className="px-4 py-3 text-xs font-medium text-slate-500">Updated</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-b border-white/10 hover:bg-white/[.025]">{columns.map((column, index) => <td key={column} className="max-w-72 truncate px-4 py-3 text-slate-300">{index === 0 ? <Link to={`/objects/${objectType}/${record.id}`} className="font-medium text-white hover:text-red-400">{display(record.data[column])}</Link> : display(record.data[column])}</td>)}<td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{new Date(record.updated_at).toLocaleDateString()}</td></tr>)}</tbody></table></section>;
}
