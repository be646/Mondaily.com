import { useQuery } from "@tanstack/react-query";
import { Plus, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Automation { id: string; name: string; type: "workflow" | "sequence"; status: string; updated_at: string }

export function AutomationsPage() {
  const query = useQuery({ queryKey: ["automations"], queryFn: () => apiClient.get<Automation[]>("/automations") });
  const items = query.data ?? [];
  return <div className="mx-auto max-w-5xl px-6 py-8"><PageHeader title="Automations" description="Sequences and workflows run by Mondaily agents." action={<Link to="/automations/sequences/new" className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm"><Plus size={14} /> New automation</Link>} />{query.isLoading ? <PageSkeleton /> : query.isError ? <ErrorState error={query.error as Error} onRetry={() => query.refetch()} /> : items.length === 0 ? <EmptyState icon={Zap} title="No automations" description="Create a sequence or workflow to let agents handle repeatable work." /> : <div className="divide-y divide-white/10 rounded-lg border border-white/10">{items.map((item) => <Link key={item.id} to={`/automations/${item.type}s/${item.id}`} className="flex items-center justify-between p-4 hover:bg-white/[.03]"><div><p className="text-sm font-medium">{item.name}</p><p className="mt-1 text-xs capitalize text-slate-500">{item.type}</p></div><span className="text-xs capitalize text-slate-400">{item.status}</span></Link>)}</div>}</div>;
}
