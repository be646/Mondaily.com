import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Clock, CheckCircle2, XCircle, Inbox, ArrowRight, Loader2, Zap, ExternalLink, Sparkles, Send, ChevronDown, History, PlayCircle, UserPlus, MessageSquare } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { PageSkeleton } from "../../components/ui/page-state";
import { MenuSelect, LiveSectionHeader } from "../../components/ui/controls";
import { SourceCard } from "../../components/ai/ask-shared";
import { useCockpitDecisions, mapEvidence, type Decision } from "../../components/ai/decision-queue";
import { agentByRaw } from "../../lib/agents";
import { useLanguage } from "../../hooks/useLanguage";

const RISK_DOT: Record<Decision["risk_level"], string> = { high: "#9c6b72", medium: "#97824f", low: "#5f8169" };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Member { user_id: string; name?: string | null; email?: string | null }
interface DecisionComment { id: string; author_id: string; author_name: string | null; body: string; created_at: string }
const memberLabel = (members: Member[], id?: string | null, email?: string | null) => {
  if (!id && !email) return null;
  const m = members.find(x => x.user_id === id);
  return m?.name || m?.email || email || "Assigned";
};

function relTime(iso?: string | null) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
const exactTime = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

// The four cockpit lanes → real decision statuses.
type LaneKey = "approval" | "context" | "approved" | "rejected";
const LANES: { key: LaneKey; label: string; statuses: string[]; open: boolean }[] = [
  { key: "approval", label: "Needs approval", statuses: ["pending"], open: true },
  { key: "context", label: "Needs more context", statuses: ["snoozed"], open: true },
  { key: "approved", label: "Approved / resolved", statuses: ["approved", "completed"], open: false },
  { key: "rejected", label: "Rejected / dismissed", statuses: ["rejected"], open: false },
];

/**
 * Human Approval Cockpit — the real "agents recommend, humans approve" surface. Four lanes over the
 * live decision_queue, filters by agent/type/risk, a full dossier per decision (evidence, exact
 * execution, AI reasoning, audit trail, grounded Ask), and safe bulk actions. Every action calls the
 * SAME backend handlers (approve/reject/snooze/bulk) — nothing about execution or capture changed.
 */
export function DecisionsPage() {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const { data: decisions, isLoading, isError } = useCockpitDecisions();
  const [lane, setLane] = useState<LaneKey>("approval");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<Decision["risk_level"] | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const { data: members } = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<Member[]>("/members"), staleTime: 300_000 });
  const memberList = members ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<{ id: string; action: string } | null>(null);
  const [banner, setBanner] = useState<{ kind: "approved" | "rejected" | "snoozed" } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("id");

  const items = useMemo(() => decisions ?? [], [decisions]);
  const laneDef = LANES.find(l => l.key === lane)!;
  const laneItems = useMemo(() => items.filter(d => laneDef.statuses.includes(d.status)), [items, lane]); // eslint-disable-line
  const agents = useMemo(() => Array.from(new Set(laneItems.map(d => d.agent_name))), [laneItems]);
  const types = useMemo(() => Array.from(new Set(laneItems.map(d => d.source_type))), [laneItems]);
  const assignees = useMemo(() => Array.from(new Set(laneItems.map(d => d.assignee_id).filter((x): x is string => !!x))), [laneItems]);
  const visible = laneItems.filter(d =>
    (!agentFilter || d.agent_name === agentFilter) &&
    (!typeFilter || d.source_type === typeFilter) &&
    (!riskFilter || d.risk_level === riskFilter) &&
    (!assigneeFilter || (assigneeFilter === "__none" ? !d.assignee_id : d.assignee_id === assigneeFilter)));

  const laneCount = (k: LaneKey) => items.filter(d => LANES.find(l => l.key === k)!.statuses.includes(d.status)).length;

  // A notification deep-link (?id=) jumps to that decision's lane + selection.
  useEffect(() => {
    if (focusId) {
      const d = items.find(x => x.id === focusId);
      if (d) { const l = LANES.find(ln => ln.statuses.includes(d.status)); if (l) setLane(l.key); setSelectedId(focusId); return; }
    }
    if (!selectedId || !visible.some(d => d.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [focusId, decisions, lane, agentFilter, typeFilter, riskFilter, assigneeFilter]); // eslint-disable-line

  useEffect(() => { setChecked(new Set()); }, [lane, agentFilter, typeFilter, riskFilter, assigneeFilter]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["decisions"] }); qc.invalidateQueries({ queryKey: ["agent-registry"] }); };
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) => apiClient.post(`/decisions/${id}/${action}`, {}) });
  const bulk = useMutation({ mutationFn: ({ ids, action }: { ids: string[]; action: "approve" | "reject" }) => apiClient.post(`/decisions/bulk`, { ids, action }) });

  const selected = items.find(d => d.id === selectedId) ?? null;

  async function resolve(d: Decision, action: "approve" | "reject" | "snooze") {
    if (acting) return;
    const idx = visible.findIndex(x => x.id === d.id);
    const next = visible[idx + 1]?.id ?? visible[idx - 1]?.id ?? null;
    setActing({ id: d.id, action });
    try {
      await act.mutateAsync({ id: d.id, action });
      setBanner({ kind: action === "approve" ? "approved" : action === "reject" ? "rejected" : "snoozed" });
      await sleep(600);
    } finally { setBanner(null); setActing(null); setSelectedId(next); invalidate(); }
  }

  // Bulk approve is limited to SAFE (advisory, no side-effect) decisions — side-effecting ones
  // (emails, record creation) must be approved individually so we never mass-fire outward actions.
  const checkedList = visible.filter(d => checked.has(d.id));
  const safeToApprove = checkedList.filter(d => !d.execution_preview?.side_effect);
  const needsReview = checkedList.length - safeToApprove.length;

  async function bulkApproveSafe() {
    if (safeToApprove.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try { await bulk.mutateAsync({ ids: safeToApprove.map(d => d.id), action: "approve" }); await sleep(400); }
    finally { setBulkBusy(false); setChecked(new Set()); invalidate(); }
  }
  async function bulkDismiss() {
    if (checkedList.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try { await bulk.mutateAsync({ ids: checkedList.map(d => d.id), action: "reject" }); await sleep(400); }
    finally { setBulkBusy(false); setChecked(new Set()); invalidate(); }
  }

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <LiveSectionHeader icon={ShieldAlert} title="Decisions" kicker="approval cockpit" liveLabel="Live queue" />
      <p className="mb-4 mt-[-0.5rem] text-[12px]" style={{ color: "var(--text-muted)" }}>Your agents propose; you approve. Review the full impact — evidence, exact action, and audit trail — before it runs.</p>

      {/* Lane tabs */}
      <div className="mb-3 flex flex-wrap gap-1 border-b" style={{ borderColor: "var(--border-soft)" }}>
        {LANES.map(l => {
          const on = lane === l.key; const n = laneCount(l.key);
          return (
            <button key={l.key} onClick={() => setLane(l.key)}
              className="relative px-3 py-2 text-[12.5px] font-medium transition-colors"
              style={{ color: on ? "var(--text-primary)" : "var(--text-muted)", borderBottom: on ? "2px solid var(--section-accent)" : "2px solid transparent", marginBottom: -1 }}>
              {l.label} <span className="tabular-nums opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      {isError ? (
        <div className="surface-card rounded-sm p-5 text-[13px]" style={{ color: "var(--text-faint)" }}>Couldn't load the Decision Queue right now. Refresh, or check back shortly.</div>
      ) : (
        <>
          {/* Filter bar — compact dropdown groups; active selections echo as small removable chips.
              (Replaces the old wall of agent/type/risk chip buttons; every option is still reachable.) */}
          {laneItems.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
              <FilterSelect label="Agent" value={agentFilter} options={agents.map(a => ({ v: a, l: agentByRaw(a).name.replace(" Agent", "") }))} onChange={setAgentFilter} />
              <FilterSelect label="Type" value={typeFilter} options={types.map(t => ({ v: t, l: t.replace(/_/g, " ") }))} onChange={setTypeFilter} />
              <FilterSelect label="Risk" value={riskFilter} options={[{ v: "high", l: "High" }, { v: "medium", l: "Medium" }, { v: "low", l: "Low" }]} onChange={(v) => setRiskFilter(v as Decision["risk_level"] | null)} dot={(v) => RISK_DOT[v as Decision["risk_level"]]} />
              {(assignees.length > 0) && (
                <FilterSelect label="Reviewer" value={assigneeFilter} onChange={setAssigneeFilter}
                  options={[{ v: "__none", l: "Unassigned" }, ...assignees.map(a => ({ v: a, l: memberLabel(memberList, a) ?? "Assigned" }))]} />
              )}
              {(agentFilter || typeFilter || riskFilter || assigneeFilter) && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {agentFilter && <ActiveFilterChip label={agentByRaw(agentFilter).name.replace(" Agent", "")} onClear={() => setAgentFilter(null)} />}
                  {typeFilter && <ActiveFilterChip label={typeFilter.replace(/_/g, " ")} onClear={() => setTypeFilter(null)} />}
                  {riskFilter && <ActiveFilterChip label={riskFilter} dot={RISK_DOT[riskFilter]} onClear={() => setRiskFilter(null)} />}
                  {assigneeFilter && <ActiveFilterChip label={assigneeFilter === "__none" ? "Unassigned" : (memberLabel(memberList, assigneeFilter) ?? "Assigned")} onClear={() => setAssigneeFilter(null)} />}
                </span>
              )}
            </div>
          )}

          {/* Bulk bar — only in the open "Needs approval" lane */}
          {laneDef.key === "approval" && checkedList.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <span style={{ color: "var(--text-secondary)" }}>{checkedList.length} selected</span>
              <div className="flex-1" />
              <button onClick={bulkApproveSafe} disabled={bulkBusy || safeToApprove.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-colors disabled:opacity-50"
                style={{ borderColor: "color-mix(in srgb, #5f8169 55%, transparent)", color: "#5f8169" }}>
                {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} {t("decisions.approve_safe")} ({safeToApprove.length})
              </button>
              <button onClick={bulkDismiss} disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-colors disabled:opacity-50"
                style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
                <XCircle size={12} /> Dismiss {checkedList.length}
              </button>
              {needsReview > 0 && <span className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>{needsReview} run an action — review individually</span>}
            </div>
          )}

          {laneItems.length === 0 ? (
            <LaneEmpty lane={laneDef.key} />
          ) : (
            <div className="flex h-[calc(100vh-260px)] min-h-[440px] flex-col gap-4 md:flex-row">
              {/* LEFT — lane list */}
              <div className="h-2/5 w-full shrink-0 overflow-y-auto rounded-sm border md:h-auto md:w-[40%]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", scrollbarGutter: "stable" }}>
                {visible.map((d, i) => {
                  const a = agentByRaw(d.agent_name); const on = selectedId === d.id;
                  return (
                    <div key={d.id} className="flex items-center gap-2 px-2 py-2.5"
                      style={{ borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined, borderLeft: `2px solid ${on ? RISK_DOT[d.risk_level] : "transparent"}`, background: on ? "color-mix(in srgb, var(--section-accent) 7%, transparent)" : "transparent" }}>
                      {laneDef.key === "approval" && (
                        <input type="checkbox" checked={checked.has(d.id)} onChange={(e) => { const s = new Set(checked); e.target.checked ? s.add(d.id) : s.delete(d.id); setChecked(s); }}
                          className="ml-1 h-3.5 w-3.5 shrink-0 accent-[var(--section-accent)]" onClick={(e) => e.stopPropagation()} />
                      )}
                      <button onClick={() => setSelectedId(d.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_DOT[d.risk_level] }} title={`${d.risk_level} risk`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }} title={d.title}>{d.title}</p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <a.Icon size={11} style={{ color: "var(--text-faint)" }} />
                            <span className="truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                              {a.name.replace(" Agent", "")} · {laneDef.open ? `${relTime(d.created_at)} ago` : `resolved ${relTime(d.resolved_at)} ago`}
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {visible.length === 0 && <div className="px-4 py-10 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>No decisions match these filters.</div>}
              </div>

              {/* RIGHT — dossier */}
              <div className="relative min-w-0 flex-1 overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
                {selected ? <Dossier key={selected.id} d={selected} lane={laneDef} acting={acting} onResolve={resolve} members={memberList} onChanged={invalidate} /> : (
                  <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "var(--text-muted)" }}>Select a decision to review it.</div>
                )}
                {banner && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--surface-card) 70%, transparent)" }}>
                    <div className="flex items-center gap-2.5 rounded-sm border px-5 py-3 text-[14px] font-semibold shadow-lg"
                      style={banner.kind === "approved"
                        ? { borderColor: "#5f8169", color: "#5f8169", background: "color-mix(in srgb, #5f8169 12%, var(--surface-card))" }
                        : { borderColor: banner.kind === "rejected" ? "#9c6b72" : "var(--text-faint)", color: banner.kind === "rejected" ? "#9c6b72" : "var(--text-muted)", background: "var(--surface-card)" }}>
                      {banner.kind === "approved" ? <><CheckCircle2 size={18} /> Approved &amp; running</> : banner.kind === "rejected" ? <><XCircle size={18} /> Rejected</> : <><Clock size={18} /> Snoozed for 24h</>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Compact filter group — a small labelled dropdown instead of a wall of chips. Every option stays
 * reachable. Uses the shared MenuSelect (custom .ui-menu popover) so the OPENED list matches the
 * app in both modes — native <select> option lists can't be themed. Active selections are echoed
 * as removable chips by ActiveFilterChip next to the bar.
 */
function FilterSelect<T extends string>({ label, value, options, onChange, dot }: { label: string; value: T | null; options: { v: T; l: string }[]; onChange: (v: T | null) => void; dot?: (v: T) => string }) {
  if (options.length <= 1) return null;
  return (
    <MenuSelect
      label={label}
      value={value ?? ""}
      options={options.map(o => ({ value: o.v, label: o.l, dot: dot?.(o.v) }))}
      onChange={(v) => onChange((v || null) as T | null)}
      maxWidth={170}
    />
  );
}

/** A small removable chip echoing one active filter. */
function ActiveFilterChip({ label, dot, onClear }: { label: string; dot?: string; onClear: () => void }) {
  return (
    <button onClick={onClear} title="Clear filter"
      className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--surface-hover)]"
      style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
      <span className="capitalize">{label}</span>
      <XCircle size={10} style={{ color: "var(--text-faint)" }} />
    </button>
  );
}

function Dossier({ d, lane, acting, onResolve, members, onChanged }: { d: Decision; lane: { key: LaneKey; open: boolean }; acting: { id: string; action: string } | null; onResolve: (d: Decision, a: "approve" | "reject" | "snooze") => void; members: Member[]; onChanged: () => void }) {
  const a = agentByRaw(d.agent_name);
  const sources = mapEvidence(d.evidence ?? []);
  const target = (d.evidence ?? [])[0];
  const busy = acting?.id === d.id;
  const currentState = target?.match_reason || (d.summary ? d.summary.split(",")[0] : "current state");
  const proposed = d.recommended_action || "Apply the agent's recommendation";
  const [showReasoning, setShowReasoning] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" style={{ scrollbarGutter: "stable" }}>
        {/* header */}
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm" style={{ background: "color-mix(in srgb, var(--section-accent) 12%, transparent)" }}><a.Icon size={17} style={{ color: "var(--section-accent)" }} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>{a.name}</span>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${RISK_DOT[d.risk_level]}1a`, color: RISK_DOT[d.risk_level] }}>
                {d.risk_level === "high" && <ShieldAlert size={10} />} {d.risk_level} risk
              </span>
              {/* Confidence only when the backend actually computed one — else honest "source-backed". */}
              {d.confidence != null ? <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{d.confidence}% confidence</span> : <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>source-backed</span>}
            </div>
            <h2 className="mt-1 break-words text-[16px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{d.title}</h2>
            <p className="mt-0.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Raised {exactTime(d.created_at)}{!lane.open && d.resolved_at ? ` · ${d.status} ${exactTime(d.resolved_at)}` : ""}</p>
          </div>
        </div>

        {/* Proposed transformation */}
        <div className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--section-accent) 3%, transparent)" }}>
          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}><Zap size={12} style={{ color: "var(--section-accent)" }} /> Proposed transformation</div>
          {target?.node_id && (
            <Link to={`/objects/${encodeURIComponent(target.object_type ?? "deals")}/${target.node_id}`} className="mb-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              Target: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{target.title || "record"}</span><ExternalLink size={11} style={{ color: "var(--text-faint)" }} />
            </Link>
          )}
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", borderLeft: "2px solid #97824f" }}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "#97824f" }}>Current</div>
              <div className="mt-1 break-words text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{currentState}</div>
            </div>
            <div className="flex shrink-0 items-center"><ArrowRight size={18} style={{ color: "var(--text-faint)" }} /></div>
            <div className="min-w-0 flex-1 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", borderLeft: "2px solid #5f8169" }}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "#5f8169" }}>Proposed</div>
              <div className="mt-1 break-words text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{proposed}</div>
            </div>
          </div>
        </div>

        {/* Exactly what approving does (real, mirrors backend execution) */}
        {d.execution_preview && (
          <div className="flex items-start gap-2 rounded-sm border p-3" style={{ borderColor: d.execution_preview.side_effect ? "#97824f55" : "var(--border-soft)", background: d.execution_preview.side_effect ? "#97824f0d" : "transparent" }}>
            <PlayCircle size={14} className="mt-0.5 shrink-0" style={{ color: d.execution_preview.side_effect ? "#97824f" : "var(--text-faint)" }} />
            <div>
              <div className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>If approved{d.execution_preview.side_effect ? " · runs an action" : " · advisory"}</div>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>{d.execution_preview.text}</p>
            </div>
          </div>
        )}

        {/* Why */}
        {d.summary && (
          <div className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)" }}>
            <div className="mb-1 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>Why your agent raised this</div>
            <p className="break-words text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>
          </div>
        )}

        {/* Evidence */}
        {sources.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>Evidence</div>
            <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s} />)}</div>
          </div>
        )}

        {/* AI reasoning — only when the decision was LLM-generated (generation_context present) */}
        {d.generation_context?.user_prompt && (
          <div className="rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            <button onClick={() => setShowReasoning(s => !s)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>Why the AI chose this</span>
              <ChevronDown size={13} style={{ color: "var(--text-faint)", transform: showReasoning ? "rotate(180deg)" : "none" }} />
            </button>
            {showReasoning && (
              <div className="border-t px-4 py-3 text-[11.5px] leading-relaxed" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                <pre className="whitespace-pre-wrap break-words font-sans">{d.generation_context.user_prompt.slice(0, 1200)}</pre>
              </div>
            )}
          </div>
        )}

        {/* Audit trail */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}><History size={12} /> Audit trail</div>
          <div className="space-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <div>Created {exactTime(d.created_at)} by {a.name}.</div>
            {d.status === "snoozed" && d.snoozed_until && <div>Snoozed until {exactTime(d.snoozed_until)}.</div>}
            {(d.status === "approved" || d.status === "rejected" || d.status === "completed") && d.resolved_at && (
              <div className="capitalize">{d.status} {exactTime(d.resolved_at)}{d.resolved_by ? ` · by a workspace member` : ""}.</div>
            )}
          </div>
        </div>

        {/* Assigned reviewer */}
        <AssigneePicker d={d} members={members} onChanged={onChanged} />

        {/* Comments thread */}
        <DecisionComments decision={d} />

        {/* Grounded Ask */}
        <DecisionAsk decision={d} />
      </div>

      {/* Action bar — preserved handlers. Open lanes act; resolved lanes show read-only status. */}
      {lane.open ? (
        <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: "var(--border-soft)" }}>
          <button onClick={() => onResolve(d, "approve")} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-60"
            style={{ borderColor: "color-mix(in srgb, #5f8169 55%, transparent)", background: "color-mix(in srgb, #5f8169 14%, transparent)", color: "#5f8169" }}>
            {busy && acting?.action === "approve" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve &amp; run
          </button>
          <button onClick={() => onResolve(d, "reject")} disabled={busy} className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60"
            style={{ borderColor: "var(--border-strong)", background: "var(--surface-selected)", color: "var(--text-secondary)" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c6b72"; e.currentTarget.style.color = "#9c6b72"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
            {busy && acting?.action === "reject" ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
          </button>
          {d.status === "pending" && (
            <button onClick={() => onResolve(d, "snooze")} disabled={busy} title="Snooze 24h — needs more context" className="flex items-center gap-1.5 rounded-lg border px-3.5 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-selected)", color: "var(--text-muted)" }}>
              {busy && acting?.action === "snooze" ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />} Snooze
            </button>
          )}
        </div>
      ) : (
        <div className="border-t p-3 text-center text-[12px] capitalize" style={{ borderColor: "var(--border-soft)", color: d.status === "approved" || d.status === "completed" ? "#5f8169" : "#9c6b72" }}>
          {d.status} · resolved {relTime(d.resolved_at)} ago
        </div>
      )}
    </div>
  );
}

/** Assigned reviewer — pick a member (or unassign). Persists via POST /decisions/:id/assign. */
function AssigneePicker({ d, members, onChanged }: { d: Decision; members: Member[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const assign = useMutation({
    mutationFn: (m: { assignee_id: string | null; assignee_email?: string | null }) => apiClient.post(`/decisions/${d.id}/assign`, m),
    onSuccess: () => { setOpen(false); onChanged(); },
  });
  const current = memberLabel(members, d.assignee_id, d.assignee_email);
  return (
    <div className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}><UserPlus size={12} /> Assigned reviewer</div>
        <button onClick={() => setOpen(o => !o)} className="text-[11px]" style={{ color: "var(--section-accent)" }}>{current ? "Change" : "Assign"}</button>
      </div>
      <div className="mt-1 text-[12px]" style={{ color: current ? "var(--text-primary)" : "var(--text-faint)" }}>{current ?? "Unassigned"}</div>
      {open && (
        <div className="mt-2 space-y-0.5 rounded-sm border p-1" style={{ borderColor: "var(--border-soft)" }}>
          {d.assignee_id && (
            <button onClick={() => assign.mutate({ assignee_id: null })} disabled={assign.isPending} className="block w-full rounded px-2 py-1 text-left text-[11.5px] hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-muted)" }}>Unassign</button>
          )}
          {members.map(m => (
            <button key={m.user_id} onClick={() => assign.mutate({ assignee_id: m.user_id, assignee_email: m.email ?? null })} disabled={assign.isPending}
              className="block w-full truncate rounded px-2 py-1 text-left text-[11.5px] hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>
              {m.name || m.email || m.user_id}
            </button>
          ))}
          {members.length === 0 && <div className="px-2 py-1 text-[11px]" style={{ color: "var(--text-faint)" }}>No members to assign.</div>}
        </div>
      )}
    </div>
  );
}

/** Comments thread — real decision_comments rows + an add-comment form. */
function DecisionComments({ decision }: { decision: Decision }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: ["decision-comments", decision.id], queryFn: () => apiClient.get<DecisionComment[]>(`/decisions/${decision.id}/comments`), retry: false });
  const add = useMutation({
    mutationFn: (body: string) => apiClient.post(`/decisions/${decision.id}/comments`, { body }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["decision-comments", decision.id] }); },
  });
  const comments = q.data ?? [];
  return (
    <div className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)" }}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}><MessageSquare size={12} /> Comments{comments.length > 0 ? ` · ${comments.length}` : ""}</div>
      {comments.length > 0 && (
        <div className="mb-2 space-y-2">
          {comments.map(cm => (
            <div key={cm.id}>
              <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{cm.author_name || "Member"}</span> · {exactTime(cm.created_at)}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px]" style={{ color: "var(--text-secondary)" }}>{cm.body}</p>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(text.trim()); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" className="key-input h-8 flex-1 px-2.5 text-[12px]" />
        <button type="submit" disabled={add.isPending || !text.trim()} className="flex items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {add.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      </form>
    </div>
  );
}

const QUICK_ASKS = ["Explain this decision", "What happens if I approve?", "Show me the evidence"];
interface AskResp { answer: string; sources: { title: string; relevance?: string }[]; sufficient: boolean }
function DecisionAsk({ decision }: { decision: Decision }) {
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: (question: string) => apiClient.post<AskResp>(`/decisions/${decision.id}/ask`, { question }) });
  return (
    <div className="rounded-sm border p-3" style={{ borderColor: "var(--border-soft)" }}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}><Sparkles size={12} style={{ color: "var(--section-accent)" }} /> Ask about this decision</div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask.mutate(q.trim()); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about this decision…" className="key-input h-8 flex-1 px-2.5 text-[12px]" />
        <button type="submit" disabled={ask.isPending || !q.trim()} className="flex items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {ask.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      </form>
      {!ask.data && !ask.isPending && (
        <div className="mt-1.5 flex flex-wrap gap-1">{QUICK_ASKS.map(s => <button key={s} onClick={() => ask.mutate(s)} className="rounded-full border px-2 py-0.5 text-[10px] transition-colors" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{s}</button>)}</div>
      )}
      {ask.data && (
        <div className="mt-2">
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{ask.data.answer}</p>
          {!ask.data.sufficient && <p className="mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>Not enough recorded detail — nothing invented.</p>}
        </div>
      )}
    </div>
  );
}

function LaneEmpty({ lane }: { lane: LaneKey }) {
  const copy: Record<LaneKey, { title: string; sub: string }> = {
    approval: { title: "You're all caught up", sub: "No decisions are waiting for approval. Agents will queue items here when they need you." },
    context: { title: "Nothing snoozed", sub: "Decisions you snooze for more context appear here." },
    approved: { title: "No recent approvals", sub: "Approved and completed decisions from the last while show here." },
    rejected: { title: "Nothing rejected", sub: "Decisions you dismiss appear here." },
  };
  const c = copy[lane];
  return (
    <div className="surface-card rounded-sm px-5 py-16 text-center">
      <Inbox size={22} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{c.title}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{c.sub}</p>
    </div>
  );
}
