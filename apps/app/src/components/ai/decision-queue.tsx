import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Clock, ChevronDown, ShieldAlert } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { SourceCard, type SourceCardData, type SourceType } from "./ask-shared";

/**
 * Decision Queue — the real "agents recommend, humans approve" surface.
 * Every row is a real backend record (packages/api/src/routes/decisions.ts,
 * table `decision_queue`) created by a real signal (overdue invoice,
 * credit note dispute, etc.) — nothing here is fabricated, and confidence
 * is only shown when the backend actually set one.
 */

interface DecisionEvidence { type: string; title: string; node_id?: string; object_type?: string; relationship?: string; match_reason?: string; timestamp?: string; }
interface Decision {
  id: string; source_type: string; source_id: string | null; agent_name: string;
  title: string; summary: string | null; recommended_action: string | null;
  risk_level: "low" | "medium" | "high"; confidence: number | null;
  evidence: DecisionEvidence[]; status: string; created_at: string;
}

const RISK_STYLE: Record<Decision["risk_level"], string> = {
  low: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  high: "text-rose-600 dark:text-rose-400",
};

function mapEvidence(raw: DecisionEvidence[]): SourceCardData[] {
  return raw.map(e => ({
    type: (e.type === "related_object" ? "record" : e.type) as SourceType,
    title: e.title,
    timestamp: e.timestamp,
    relevance: e.relationship ?? e.match_reason,
    href: e.object_type && e.node_id ? `/objects/${e.object_type}/${e.node_id}` : undefined,
  }));
}

export function useDecisionQueue() {
  return useQuery({
    queryKey: ["decisions", "pending"],
    queryFn: () => apiClient.get<Decision[]>("/decisions?status=pending"),
    staleTime: 30_000,
    // The decision_queue table only exists once migration 0016 has been
    // applied — if it 404s/500s on a workspace that hasn't run it yet,
    // treat that as "no decisions" rather than breaking the page.
    retry: false,
  });
}

export function DecisionQueuePanel() {
  const { data, isLoading, isError } = useDecisionQueue();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) =>
      apiClient.post(`/decisions/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions"] }),
  });

  if (isError) return null; // migration not applied yet — fail quiet, not loud
  const decisions = data ?? [];

  return (
    <section className="mb-8">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Decision queue</h2>
        {decisions.length > 0 && (
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{decisions.length} awaiting approval</span>
        )}
      </div>
      <p className="mb-3 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
        Mondaily's source-backed signals — every row here is a real recommendation from an agent, with the records behind it. See the bell icon for lower-priority notifications.
      </p>

      {isLoading ? (
        <div className="skeleton-shimmer h-16 rounded-xl"/>
      ) : decisions.length === 0 ? (
        <div className="surface-card rounded-xl p-4 text-[12px]" style={{ color: "var(--text-faint)" }}>
          No decisions waiting — agents will queue a recommendation here when they find something that needs your approval.
        </div>
      ) : (
        <div className="surface-card divide-y rounded-xl overflow-hidden" style={{ borderColor: "var(--border-soft)" }}>
          {decisions.map(d => {
            const open = openId === d.id;
            const sources = mapEvidence(d.evidence ?? []);
            return (
              <div key={d.id} className="p-3" style={{ borderColor: "var(--border-soft)" }}>
                <button onClick={() => setOpenId(open ? null : d.id)} className="flex w-full items-start gap-2.5 text-left">
                  {d.risk_level === "high" ? (
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-rose-500"/>
                  ) : (
                    <Clock size={14} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }}/>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{d.title}</p>
                    <p className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                      {d.agent_name.replace(/_/g, " ")} · <span className={RISK_STYLE[d.risk_level]}>{d.risk_level} risk</span>
                    </p>
                  </div>
                  <ChevronDown size={12} className={`mt-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }}/>
                </button>

                {open && (
                  <div className="mt-2.5 pl-6 space-y-2.5">
                    {d.summary && <p className="text-[12px] leading-snug" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>}
                    {d.recommended_action && (
                      <p className="text-[11.5px] font-medium" style={{ color: "var(--accent)" }}>→ {d.recommended_action}</p>
                    )}
                    <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {d.confidence != null ? `${d.confidence}% confidence` : "Source-backed"}
                    </p>
                    {sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {sources.map((s, i) => <SourceCard key={i} source={s}/>)}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 pt-1">
                      <button onClick={() => act.mutate({ id: d.id, action: "approve" })} disabled={act.isPending}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white transition-colors disabled:opacity-50" style={{ background: "#10b981" }}>
                        <CheckCircle2 size={11}/> Approve
                      </button>
                      <button onClick={() => act.mutate({ id: d.id, action: "reject" })} disabled={act.isPending}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                        <XCircle size={11}/> Reject
                      </button>
                      <button onClick={() => act.mutate({ id: d.id, action: "snooze" })} disabled={act.isPending}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ color: "var(--text-faint)" }}>
                        <Clock size={11}/> Snooze
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
