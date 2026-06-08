import { useQuery } from "@tanstack/react-query";
import { Clock3, Phone } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../components/ui/page-state";

interface Call { id: string; contact_name: string; occurred_at: string; duration_seconds: number; ai_summary: string; transcript?: string; action_items?: string[]; record_name?: string }

export function CallsPage() {
  const [selected, setSelected] = useState<string>();
  const query = useQuery({ queryKey: ["calls"], queryFn: () => apiClient.get<Call[]>("/calls") });
  const detail = useQuery({ queryKey: ["call", selected], queryFn: () => apiClient.get<Call>(`/calls/${selected}`), enabled: Boolean(selected) });
  const calls = query.data ?? [];
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader title="Calls" description="Recorded conversations with AI summaries and action items." />
      {query.isLoading ? <PageSkeleton /> : calls.length === 0 ? <EmptyState icon={Phone} title="No recorded calls" description="Connect your calling provider to receive transcripts and AI follow-up notes." /> : (
        <div className="grid grid-cols-[1fr_1.2fr] gap-5"><div className="space-y-2">{calls.map((call) => <button key={call.id} onClick={() => setSelected(call.id)} className={`w-full rounded-lg border p-4 text-left ${selected === call.id ? "border-red-500/40 bg-red-500/5" : "border-white/10"}`}><div className="flex justify-between"><p className="text-sm font-medium">{call.contact_name}</p><span className="flex items-center gap-1 text-xs text-slate-500"><Clock3 size={11} />{Math.round(call.duration_seconds / 60)}m</span></div><p className="mt-2 line-clamp-2 text-sm text-slate-500">{call.ai_summary}</p><p className="mt-2 text-xs text-slate-600">{new Date(call.occurred_at).toLocaleString()}</p></button>)}</div><aside className="rounded-lg border border-white/10 p-5">{!selected ? <EmptyState icon={Phone} title="Select a call" description="Review its summary, action items, and transcript." /> : detail.isLoading ? <PageSkeleton /> : <div><h2 className="text-lg font-semibold">{detail.data?.contact_name}</h2><h3 className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-500">AI summary</h3><p className="text-sm leading-6 text-slate-300">{detail.data?.ai_summary}</p><h3 className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-500">Action items</h3><ul className="space-y-2 text-sm text-slate-300">{detail.data?.action_items?.map((item) => <li key={item}>• {item}</li>)}</ul><h3 className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-500">Transcript</h3><p className="whitespace-pre-wrap text-sm leading-6 text-slate-400">{detail.data?.transcript}</p></div>}</aside></div>
      )}
    </div>
  );
}
