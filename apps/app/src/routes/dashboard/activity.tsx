import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle, Activity as ActivityIcon, RefreshCw } from "lucide-react";
import { apiClient } from "../../lib/api-client";

type ActivityItem = {
  id: string;
  agent: string;
  trigger: string;
  status: string;
  summary: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

const agentLabel = (a: string) => a.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

function relTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 size={15} style={{ color: "var(--accent)" }}/>;
  if (status === "failed") return <XCircle size={15} className="text-red-500"/>;
  return <Loader2 size={15} className="animate-spin" style={{ color: "var(--text-muted)" }}/>;
}

export function AgentActivityPage() {
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["agent-activity", agentFilter],
    queryFn: () => apiClient.get<{ activity: ActivityItem[] }>(`/agents/activity${agentFilter ? `?agent=${encodeURIComponent(agentFilter)}` : ""}`),
    refetchInterval: 30_000,
  });
  const activity = data?.activity ?? [];
  const agents = Array.from(new Set(activity.map(a => a.agent))).sort();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>
            <ActivityIcon size={18} style={{ color: "var(--accent)" }}/>
          </span>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Agent activity</h1>
            <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>What your agents have been doing — live proof of work.</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:-translate-y-px" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""}/> Refresh
        </button>
      </div>

      {/* Agent filter chips */}
      {agents.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button onClick={() => setAgentFilter(null)} className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors" style={{ borderColor: agentFilter === null ? "var(--accent)" : "var(--border-soft)", background: "var(--surface-card)", color: agentFilter === null ? "var(--accent)" : "var(--text-secondary)" }}>All</button>
          {agents.map(a => (
            <button key={a} onClick={() => setAgentFilter(a)} className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors" style={{ borderColor: agentFilter === a ? "var(--accent)" : "var(--border-soft)", background: "var(--surface-card)", color: agentFilter === a ? "var(--accent)" : "var(--text-secondary)" }}>{agentLabel(a)}</button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin"/> Loading agent activity…</div>
      ) : activity.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center text-sm" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>No agent activity yet — your agents run on schedule and on events. Check back soon.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          {activity.map((a, i) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3" style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
              <span className="mt-0.5 shrink-0"><StatusDot status={a.status}/></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{agentLabel(a.agent)}</span>
                  <span className="rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wide" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{a.trigger}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] break-words" style={{ color: a.status === "failed" ? "#ef4444" : "var(--text-secondary)" }}>{a.error || a.summary}</p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{relTime(a.started_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
