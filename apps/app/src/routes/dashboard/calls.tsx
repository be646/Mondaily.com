import { useQuery } from "@tanstack/react-query";
import { Clock3, Phone, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "../../components/ui/page-state";
import { apiClient } from "../../lib/api-client";

type CallFilter = "all" | "mine" | "week" | "month";

interface CallListItem {
  id: string;
  contact_name: string;
  company_name?: string;
  occurred_at: string;
  duration_seconds: number;
  direction: "inbound" | "outbound";
  status: "processed" | "processing" | "failed";
  ai_summary?: string;
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function CallSkeletons() {
  return <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex gap-4 p-4"><div className="h-10 w-10 animate-pulse rounded-full bg-white/[.05]" /><div className="flex-1 space-y-2"><div className="h-3 w-1/3 animate-pulse rounded bg-white/[.05]" /><div className="h-3 w-3/4 animate-pulse rounded bg-white/[.035]" /><div className="h-3 w-1/2 animate-pulse rounded bg-white/[.035]" /></div></div>)}</div>;
}

export function CallsPage() {
  const [filter, setFilter] = useState<CallFilter>("all");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["calls", filter, search],
    queryFn: () => apiClient.get<CallListItem[]>(`/calls?filter=${filter}&search=${encodeURIComponent(search)}`)
  });
  const calls = query.data ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Calls" description="Recorded conversations analyzed by Mondaily." />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-white/10 p-1">
          {(["all", "mine", "week", "month"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${filter === item ? "bg-white/10 text-white" : "text-stone-500 hover:text-stone-300"}`}>{{ all: "All", mine: "Mine", week: "This week", month: "This month" }[item]}</button>)}
        </div>
        <label className="relative block sm:w-64"><Search className="absolute left-3 top-2.5 text-stone-600" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contact or company" className="h-9 w-full rounded-md border border-white/10 bg-transparent pl-9 pr-3 text-sm outline-none focus:border-white/20" /></label>
      </div>
      {query.isLoading ? <CallSkeletons /> : calls.length === 0 ? <EmptyState icon={Phone} title="No calls recorded yet" description="Install the Mondaily Chrome extension to record calls." /> : (
        <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
          {calls.map((call) => <Link key={call.id} to={`/calls/${call.id}`} className="flex flex-col gap-3 p-4 hover:bg-white/[.025] sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initials(call.contact_name)}</div>
              <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{call.contact_name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${call.direction === "inbound" ? "bg-blue-500/10 text-blue-400" : "bg-violet-500/10 text-violet-400"}`}>{call.direction === "inbound" ? "Inbound" : "Outbound"}</span></div><p className="mt-0.5 truncate text-xs text-stone-500">{call.company_name || "No linked company"}</p><p className="mt-2 truncate text-sm text-stone-400">{call.ai_summary || "Mondaily is preparing the call summary."}</p></div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-5 pl-13 text-xs text-stone-500 sm:pl-0">
              <span>{new Date(call.occurred_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <span className="flex items-center gap-1"><Clock3 size={11} /> {Math.max(1, Math.round(call.duration_seconds / 60))} min</span>
              <span className={`rounded-full px-2 py-1 capitalize ${call.status === "processed" ? "bg-emerald-500/10 text-emerald-400" : call.status === "failed" ? "bg-indigo-500/10 text-indigo-400" : "bg-amber-500/10 text-amber-400"}`}>{call.status}</span>
            </div>
          </Link>)}
        </div>
      )}
    </div>
  );
}
