import { useEffect, useState } from "react";
import type { ElementType } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Clock, CheckCircle2, XCircle, ChevronDown, Inbox } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../components/ui/page-state";
import { SourceCard } from "../../components/ai/ask-shared";
import { useDecisionQueue, mapEvidence, RISK_STYLE, type Decision } from "../../components/ai/decision-queue";
import { agentByRaw } from "../../lib/agents";

const RISK_DOT: Record<Decision["risk_level"], string> = { high: "#dc2626", medium: "#d97706", low: "#10b981" };

/**
 * Decision Queue — "agents recommend, humans approve". Redesigned from a 300+ item
 * firehose into a triage surface: filter by risk, grouped by the real agent, with
 * bulk approve/dismiss per group + each item showing WHY it's here and WHAT approving
 * does. Every action hits the real backend; nothing is faked.
 */
export function DecisionsPage() {
  const qc = useQueryClient();
  const { data: decisions, isLoading, isError } = useDecisionQueue();
  const [openId, setOpenId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<Decision["risk_level"] | null>(null);
  const [searchParams] = useSearchParams();

  const focusId = searchParams.get("id");
  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId);
    const el = document.getElementById(`decision-${focusId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, decisions]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["agent-registry"] });
  };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) =>
      apiClient.post(`/decisions/${id}/${action}`, {}),
    onSuccess: invalidate,
  });
  const bulk = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "approve" | "reject" | "snooze" }) =>
      apiClient.post(`/decisions/bulk`, { ids, action }),
    onSuccess: invalidate,
  });

  if (isLoading) return <PageSkeleton />;

  const items = decisions ?? [];
  const counts = {
    all: items.length,
    high: items.filter(d => d.risk_level === "high").length,
    medium: items.filter(d => d.risk_level === "medium").length,
    low: items.filter(d => d.risk_level === "low").length,
  };
  const visible = items.filter(d => !riskFilter || d.risk_level === riskFilter);

  // Group by the real agent identity (matches the constellation / ops center).
  const groups = (() => {
    const m: Record<string, { label: string; Icon: ElementType; items: Decision[] }> = {};
    for (const d of visible) {
      const a = agentByRaw(d.agent_name);
      if (!m[a.name]) m[a.name] = { label: a.name, Icon: a.Icon, items: [] };
      m[a.name]!.items.push(d);
    }
    // High-risk groups first, then by size.
    return Object.values(m).sort((x, y) => {
      const xr = x.items.some(d => d.risk_level === "high") ? 1 : 0;
      const yr = y.items.some(d => d.risk_level === "high") ? 1 : 0;
      return yr - xr || y.items.length - x.items.length;
    });
  })();

  const busy = act.isPending || bulk.isPending;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Decision Queue" description="Actions your agents prepared, waiting on your approval. Triage by risk, or clear a whole group at once." />

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
        <>
          {/* Risk filter */}
          <div className="mb-4 inline-flex rounded-xl border p-0.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            {([{ k: null, l: "All", n: counts.all }, { k: "high" as const, l: "High", n: counts.high }, { k: "medium" as const, l: "Medium", n: counts.medium }, { k: "low" as const, l: "Low", n: counts.low }]).map(s => {
              const on = riskFilter === s.k;
              return (
                <button key={s.l} onClick={() => setRiskFilter(s.k)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs transition-colors"
                  style={on ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" } : { color: "var(--text-muted)" }}>
                  {s.k && <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_DOT[s.k] }} />}
                  {s.l}<span className="tabular-nums opacity-60">{s.n}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            {groups.map(g => {
              const groupIds = g.items.map(d => d.id);
              const lowIds = g.items.filter(d => d.risk_level === "low").map(d => d.id);
              return (
                <div key={g.label} className="surface-card overflow-hidden rounded-2xl">
                  {/* Group header + bulk actions */}
                  <div className="flex items-center gap-2.5 border-b px-3.5 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
                      <g.Icon size={14} style={{ color: "var(--accent)" }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{g.label}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{g.items.length} awaiting approval</div>
                    </div>
                    {lowIds.length > 0 && (
                      <button onClick={() => bulk.mutate({ ids: lowIds, action: "approve" })} disabled={busy}
                        className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-white transition-colors disabled:opacity-50" style={{ background: "#10b981" }}>
                        Approve {lowIds.length} low-risk
                      </button>
                    )}
                    <button onClick={() => bulk.mutate({ ids: groupIds, action: "reject" })} disabled={busy}
                      className="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
                      Dismiss all
                    </button>
                  </div>

                  {g.items.map(d => {
                    const open = openId === d.id;
                    const sources = mapEvidence(d.evidence ?? []);
                    return (
                      <div key={d.id} id={`decision-${d.id}`} className="border-b last:border-b-0" style={{ borderColor: "var(--border-soft)" }}>
                        <button onClick={() => setOpenId(open ? null : d.id)} className="stream-row w-full text-left" style={{ borderLeft: `2px solid ${RISK_DOT[d.risk_level]}` }}>
                          {d.risk_level === "high" ? <ShieldAlert size={13} className="mt-0.5 shrink-0 text-rose-500" /> : <Clock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--text-faint)" }} />}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] leading-tight" style={{ color: "var(--text-primary)" }}>{d.title}</p>
                            <p className="text-[10px]" style={{ color: "var(--text-faint)" }}><span className={RISK_STYLE[d.risk_level]}>{d.risk_level} risk</span>{d.confidence != null ? ` · ${d.confidence}% confidence` : ""}</p>
                          </div>
                          <ChevronDown size={12} className={`mt-0.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--text-faint)" }} />
                        </button>
                        {open && (
                          <div className="space-y-2 px-3.5 pb-3 pl-9">
                            {d.summary && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Why this is here</div>
                                <p className="text-[12px] leading-snug" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>
                              </div>
                            )}
                            {d.recommended_action && (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>What approving does</div>
                                <p className="text-[11.5px] font-medium" style={{ color: "var(--accent)" }}>→ {d.recommended_action}</p>
                              </div>
                            )}
                            {sources.length > 0 && <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s} />)}</div>}
                            <div className="flex items-center gap-1.5 pt-1">
                              <button onClick={() => act.mutate({ id: d.id, action: "approve" })} disabled={busy}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white transition-colors disabled:opacity-50" style={{ background: "#10b981" }}>
                                <CheckCircle2 size={11} /> Approve
                              </button>
                              <button onClick={() => act.mutate({ id: d.id, action: "reject" })} disabled={busy}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                                <XCircle size={11} /> Reject
                              </button>
                              <button onClick={() => act.mutate({ id: d.id, action: "snooze" })} disabled={busy}
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
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
