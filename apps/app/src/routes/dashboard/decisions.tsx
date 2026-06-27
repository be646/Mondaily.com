import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Clock, CheckCircle2, XCircle, ChevronDown, Inbox } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../components/ui/page-state";
import { SourceCard } from "../../components/ai/ask-shared";
import { useDecisionQueue, mapEvidence, RISK_STYLE } from "../../components/ai/decision-queue";

/**
 * Decision Queue — the full-page "agents recommend, humans approve" surface.
 * Same data + actions as Home's needs-you panel, but a dedicated destination
 * so Ask Mondaily's decision cards have a real place to land (the old link
 * pointed at the finance credit-note approvals page, which isn't the queue).
 */
export function DecisionsPage() {
  const qc = useQueryClient();
  const { data: decisions, isLoading, isError } = useDecisionQueue();
  const [openId, setOpenId] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) =>
      apiClient.post(`/decisions/${id}/${action}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["agent-registry"] });
    },
  });

  if (isLoading) return <PageSkeleton />;

  const items = decisions ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Decision Queue" description="Actions your agents have prepared and are waiting on your approval." />

      {isError ? (
        <div className="surface-card rounded-2xl p-5 text-[13px]" style={{ color: "var(--text-faint)" }}>
          Couldn't load the Decision Queue right now. Refresh, or check back shortly.
        </div>
      ) : items.length === 0 ? (
        <div className="surface-card rounded-2xl px-5 py-10 text-center">
          <Inbox size={20} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>You're all caught up</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>No decisions are waiting. Agents will queue items here when they need your approval.</p>
        </div>
      ) : (
        <div className="surface-card overflow-hidden rounded-2xl">
          {items.map(d => {
            const open = openId === d.id;
            const sources = mapEvidence(d.evidence ?? []);
            return (
              <div key={d.id} className="border-b" style={{ borderColor: "var(--border-soft)" }}>
                <button onClick={() => setOpenId(open ? null : d.id)} className="stream-row w-full text-left" style={{ borderLeft: `2px solid ${d.risk_level === "high" ? "#dc2626" : d.risk_level === "medium" ? "#d97706" : "#10b981"}` }}>
                  {d.risk_level === "high" ? <ShieldAlert size={13} className="mt-0.5 shrink-0 text-rose-500" /> : <Clock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>{d.agent_name.replace(/_/g, " ")}</span> · {d.title}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-faint)" }}><span className={RISK_STYLE[d.risk_level]}>{d.risk_level} risk</span> · awaiting approval</p>
                  </div>
                  <ChevronDown size={12} className={`mt-0.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }} />
                </button>
                {open && (
                  <div className="space-y-2 px-3.5 pb-3 pl-9">
                    {d.summary && <p className="text-[12px] leading-snug" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>}
                    {d.recommended_action && <p className="text-[11.5px] font-medium" style={{ color: "var(--accent)" }}>→ {d.recommended_action}</p>}
                    <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>{d.confidence != null ? `${d.confidence}% confidence` : "Source-backed"}</p>
                    {sources.length > 0 && <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s} />)}</div>}
                    <div className="flex items-center gap-1.5 pt-1">
                      <button onClick={() => act.mutate({ id: d.id, action: "approve" })} disabled={act.isPending}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors disabled:opacity-50" style={{ background: "#10b981" }}>
                        <CheckCircle2 size={11} /> Approve
                      </button>
                      <button onClick={() => act.mutate({ id: d.id, action: "reject" })} disabled={act.isPending}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                        <XCircle size={11} /> Reject
                      </button>
                      <button onClick={() => act.mutate({ id: d.id, action: "snooze" })} disabled={act.isPending}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ color: "var(--text-faint)" }}>
                        <Clock size={11} /> Snooze
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
