import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Clock, CheckCircle2, XCircle, Inbox, ArrowRight, Loader2, Zap, ExternalLink, Sparkles, Send, ChevronDown, History, PlayCircle, UserPlus, MessageSquare } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { PageSkeleton, DelayedLoading, EmptyState, ErrorState } from "../../components/ui/page-state";
import { MenuSelect, ActionMenu, CommandPageHeader, DossierSection, FilterToolbar, MetricGrid, type ActionMenuItem, type CommandStatusItem, type FilterChip, type MetricItem } from "../../components/ui/controls";
import { SourceCard } from "../../components/ai/ask-shared";
import { useCockpitDecisions, mapEvidence, type Decision } from "../../components/ai/decision-queue";
import { agentByRaw } from "../../lib/agents";
import { useLanguage } from "../../hooks/useLanguage";
import { useTableRealtime } from "../../hooks/useTableRealtime";

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
  const { data: decisions, isLoading, isError, refetch } = useCockpitDecisions();
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
  // AI triage ranking of the pending lane — {id → priority/reason}. Pure view-state; never acts.
  const [triage, setTriage] = useState<Map<string, { priority: string; reason: string }> | null>(null);
  const [triageBusy, setTriageBusy] = useState(false);
  const [triageNote, setTriageNote] = useState("");

  // Realtime: the queue updates live when any agent raises or resolves a decision.
  useTableRealtime("decision_queue", () => { qc.invalidateQueries({ queryKey: ["decisions"] }); });

  const items = useMemo(() => decisions ?? [], [decisions]);
  const laneDef = LANES.find(l => l.key === lane)!;
  const laneItems = useMemo(() => items.filter(d => laneDef.statuses.includes(d.status)), [items, lane]); // eslint-disable-line
  const agents = useMemo(() => Array.from(new Set(laneItems.map(d => d.agent_name))), [laneItems]);
  const types = useMemo(() => Array.from(new Set(laneItems.map(d => d.source_type))), [laneItems]);
  const assignees = useMemo(() => Array.from(new Set(laneItems.map(d => d.assignee_id).filter((x): x is string => !!x))), [laneItems]);
  const visibleUnordered = laneItems.filter(d =>
    (!agentFilter || d.agent_name === agentFilter) &&
    (!typeFilter || d.source_type === typeFilter) &&
    (!riskFilter || d.risk_level === riskFilter) &&
    (!assigneeFilter || (assigneeFilter === "__none" ? !d.assignee_id : d.assignee_id === assigneeFilter)));
  // With an AI triage ranking active, the approval lane orders by priority (high→low) — the
  // ranking is advisory view-state only; every decision stays visible and individually actionable.
  const PRIO = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const visible = (lane === "approval" && triage)
    ? [...visibleUnordered].sort((a, b) => (PRIO[triage.get(a.id)?.priority ?? "medium"] ?? 1) - (PRIO[triage.get(b.id)?.priority ?? "medium"] ?? 1))
    : visibleUnordered;

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
  const act = useMutation({ mutationFn: ({ id, action, body }: { id: string; action: "approve" | "reject" | "snooze"; body?: Record<string, unknown> }) => apiClient.post(`/decisions/${id}/${action}`, body ?? {}) });
  const bulk = useMutation({ mutationFn: ({ ids, action }: { ids: string[]; action: "approve" | "reject" }) => apiClient.post(`/decisions/bulk`, { ids, action }) });

  const selected = items.find(d => d.id === selectedId) ?? null;

  async function resolve(d: Decision, action: "approve" | "reject" | "snooze", opts?: { until?: string; note?: string }) {
    if (acting) return;
    const idx = visible.findIndex(x => x.id === d.id);
    const next = visible[idx + 1]?.id ?? visible[idx - 1]?.id ?? null;
    setActing({ id: d.id, action });
    try {
      // A rejection note lands in the decision's REAL comments thread before resolving —
      // permanent audit of why a human said no.
      if (opts?.note) await apiClient.post(`/decisions/${d.id}/comments`, { body: `Rejected: ${opts.note}` }).catch(() => {});
      await act.mutateAsync({ id: d.id, action, body: opts?.until ? { until: opts.until } : {} });
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

  // AI triage — asks the backend to rank the pending queue (grounded on recorded fields only).
  async function runTriage() {
    if (triageBusy) return;
    setTriageBusy(true); setTriageNote("");
    try {
      const r = await apiClient.post<{ sufficient: boolean; reason?: string; ranked?: { id: string; priority: string; reason: string }[] }>("/decisions/triage", {});
      if (!r.sufficient || !r.ranked) { setTriageNote(r.reason ?? "Nothing to triage."); setTriage(null); }
      else setTriage(new Map(r.ranked.map(x => [x.id, { priority: x.priority, reason: x.reason }])));
    } catch { setTriageNote("AI triage is unavailable right now."); }
    finally { setTriageBusy(false); }
  }

  // Batch adjudication — sequential AI verdicts over the visible pending list (capped), shown as
  // advisory chips per row. Sequential on purpose: bounded cost, no thundering herd.
  const [verdicts, setVerdicts] = useState<Map<string, string>>(new Map());
  const [verdictBusy, setVerdictBusy] = useState<string | null>(null);
  async function adjudicateVisible() {
    if (verdictBusy) return;
    const targets = visible.filter(d => d.status === "pending" && !verdicts.has(d.id)).slice(0, 8);
    for (const d of targets) {
      setVerdictBusy(d.id);
      try {
        const r = await apiClient.post<{ sufficient: boolean; recommendation?: string }>(`/decisions/${d.id}/verdict`, {});
        setVerdicts(prev => new Map(prev).set(d.id, r.sufficient && r.recommendation ? r.recommendation : "insufficient"));
      } catch { setVerdicts(prev => new Map(prev).set(d.id, "error")); }
    }
    setVerdictBusy(null);
  }

  // Keyboard triage — j/k navigate, a approve, r reject, s snooze (open lanes, not while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = visible.findIndex(d => d.id === selectedId);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setSelectedId(visible[Math.min(idx + 1, visible.length - 1)]?.id ?? null); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setSelectedId(visible[Math.max(idx - 1, 0)]?.id ?? null); }
      else if (laneDef.open && selected && !acting) {
        if (e.key === "a") { e.preventDefault(); void resolve(selected, "approve"); }
        else if (e.key === "r") { e.preventDefault(); void resolve(selected, "reject"); }
        else if (e.key === "s" && selected.status === "pending") { e.preventDefault(); void resolve(selected, "snooze"); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-binds each render so it always sees current visible/selected

  // Skeleton, but never a blank/stuck one: after ~8s show "Still loading… / Retry" (the api-client's
  // 45s timeout guarantees a hung request errors into the isError state below rather than hanging).
  if (isLoading) return <DelayedLoading onRetry={() => refetch()}><PageSkeleton /></DelayedLoading>;

  // Queue intelligence — REAL numbers from the live queue (no invention). The header keeps only a
  // calm live-sync + awaiting signal; the richer at-a-glance numbers move into a shared MetricGrid
  // strip below (same primitive as Team Oversight) so the header stays uncrowded.
  const pendingItems = items.filter(d => d.status === "pending");
  const highRisk = pendingItems.filter(d => d.risk_level === "high").length;
  const oldestMs = pendingItems.length ? Math.max(...pendingItems.map(d => Date.now() - new Date(d.created_at).getTime())) : 0;
  const oldestDays = Math.floor(oldestMs / 86_400_000);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const resolved7 = items.filter(d => d.resolved_at && new Date(d.resolved_at).getTime() > weekAgo);
  const approved7 = resolved7.filter(d => d.status === "approved" || d.status === "completed").length;
  const queueStatus: CommandStatusItem[] = items.length === 0
    ? [{ label: "live sync", kind: "complete" }]
    : [
        { label: "live sync", kind: "monitoring" },
        { label: `${pendingItems.length} awaiting`, dot: false },
      ];
  // Real cockpit metrics — every value is counted from the live queue; nothing is estimated. Shown
  // only when there's something in the queue, so an empty workspace never sees fabricated zeros-as-stats.
  const queueMetrics: MetricItem[] = [
    { label: "Awaiting approval", value: pendingItems.length, title: "Pending decisions across all agents" },
    { label: "High risk", value: highRisk, tone: highRisk > 0 ? "#9c6b72" : undefined, title: "Pending decisions flagged high risk" },
    { label: "Oldest pending", value: pendingItems.length ? (oldestDays > 0 ? `${oldestDays}d` : "<1d") : "—", tone: oldestDays >= 7 ? "#97824f" : undefined, title: "Age of the oldest unresolved decision" },
    { label: "Resolved · 7d", value: resolved7.length, title: "Decisions resolved in the last 7 days" },
    { label: "Approved · 7d", value: resolved7.length ? `${Math.round((approved7 / resolved7.length) * 100)}%` : "—", title: "Share of the last 7 days' resolutions that were approved" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* One command header — icon, call-sign, title, honest queue status, keyboard hints. */}
      <CommandPageHeader
        icon={ShieldAlert}
        callsign="GATE"
        title="Decisions"
        subtitle="Agents propose — you approve."
        status={queueStatus}
        rightSummary={<span title="j/k navigate · a approve · r reject · s snooze">keys j·k·a·r·s</span>}
      />

      {/* Cockpit metrics — shared MetricGrid over REAL queue numbers (same primitive as Team
          Oversight). Only when the queue has content, so an empty workspace isn't shown stat noise. */}
      {items.length > 0 && <MetricGrid items={queueMetrics} cols={5} className="mb-4" />}

      {/* Lane tabs */}
      <div className="mb-3 flex flex-wrap gap-1 border-b" style={{ borderColor: "var(--border-soft)" }}>
        {LANES.map(l => {
          const on = lane === l.key; const n = laneCount(l.key);
          return (
            <button key={l.key} onClick={() => setLane(l.key)}
              className="relative rounded-t-sm px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
              style={{ color: on ? "var(--text-primary)" : "var(--text-muted)", borderBottom: `2px solid ${on ? "var(--section-accent)" : "transparent"}`, marginBottom: -1 }}>
              {l.label} <span className="tabular-nums" style={{ color: "var(--text-faint)" }}>{n}</span>
            </button>
          );
        })}
      </div>

      {isError ? (
        // Shared ErrorState with retry — same failure surface as Reports/Discovery/Team Oversight.
        <ErrorState error={new Error("Couldn't load the Decision Queue right now.")} onRetry={() => refetch()} />
      ) : (
        <>
          {/* Shared FilterToolbar — same filter logic as Records/Lists: dropdown filters, an
              advisory AI-tools menu, active selections as removable chips, summary on the right.
              Every option stays reachable; per-row Approve/Reject/Snooze stay visible below. */}
          {laneItems.length > 0 && (() => {
            const filterChips: FilterChip[] = [
              ...(agentFilter ? [{ key: "agent", label: agentByRaw(agentFilter).name.replace(" Agent", ""), onRemove: () => setAgentFilter(null) }] : []),
              ...(typeFilter ? [{ key: "type", label: typeFilter.replace(/_/g, " "), onRemove: () => setTypeFilter(null) }] : []),
              ...(riskFilter ? [{ key: "risk", label: riskFilter, onRemove: () => setRiskFilter(null) }] : []),
              ...(assigneeFilter ? [{ key: "assignee", label: assigneeFilter === "__none" ? "Unassigned" : (memberLabel(memberList, assigneeFilter) ?? "Assigned"), onRemove: () => setAssigneeFilter(null) }] : []),
            ];
            const aiSummary = verdicts.size > 0 && lane === "approval"
              ? `AI: ${[...verdicts.values()].filter(v => v === "approve").length} approve · ${[...verdicts.values()].filter(v => v === "investigate").length} investigate · ${[...verdicts.values()].filter(v => v === "reject").length} reject`
              : (triageNote || undefined);
            return (
              <FilterToolbar
                filters={<>
                  <FilterSelect label="Agent" value={agentFilter} options={agents.map(a => ({ v: a, l: agentByRaw(a).name.replace(" Agent", "") }))} onChange={setAgentFilter} />
                  <FilterSelect label="Type" value={typeFilter} options={types.map(t => ({ v: t, l: t.replace(/_/g, " ") }))} onChange={setTypeFilter} />
                  <FilterSelect label="Risk" value={riskFilter} options={[{ v: "high", l: "High" }, { v: "medium", l: "Medium" }, { v: "low", l: "Low" }]} onChange={(v) => setRiskFilter(v as Decision["risk_level"] | null)} dot={(v) => RISK_DOT[v as Decision["risk_level"]]} />
                  {assignees.length > 0 && (
                    <FilterSelect label="Reviewer" value={assigneeFilter} onChange={setAssigneeFilter}
                      options={[{ v: "__none", l: "Unassigned" }, ...assignees.map(a => ({ v: a, l: memberLabel(memberList, a) ?? "Assigned" }))]} />
                  )}
                </>}
                actionMenu={lane === "approval" && laneItems.length > 1 ? (
                  <ActionMenu triggerLabel={(triageBusy || !!verdictBusy) ? "AI tools…" : "AI tools"} align="left" ariaLabel="AI decision tools"
                    items={([
                      { key: "triage", label: triageBusy ? "Triaging…" : (triage ? "Re-triage queue" : "AI triage"), icon: Sparkles, disabled: triageBusy, onClick: runTriage },
                      ...(triage ? [{ key: "clear", label: "Clear ranking", onClick: () => setTriage(null) }] : []),
                      { key: "adjudicate", label: verdictBusy ? "Adjudicating…" : "Adjudicate visible", icon: ShieldAlert, disabled: !!verdictBusy, onClick: adjudicateVisible },
                    ] as ActionMenuItem[])} />
                ) : undefined}
                chips={filterChips}
                summary={aiSummary}
              />
            );
          })()}

          {/* Bulk bar — only in the open "Needs approval" lane */}
          {laneDef.key === "approval" && checkedList.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-[12px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <span style={{ color: "var(--text-secondary)" }}>{checkedList.length} selected</span>
              <div className="flex-1" />
              <button onClick={bulkApproveSafe} disabled={bulkBusy || safeToApprove.length === 0}
                className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-medium transition-colors disabled:opacity-50"
                style={{ borderColor: "color-mix(in srgb, #5f8169 55%, transparent)", color: "#5f8169" }}>
                {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} {t("decisions.approve_safe")} ({safeToApprove.length})
              </button>
              <button onClick={bulkDismiss} disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-medium transition-colors disabled:opacity-50"
                style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
                <XCircle size={12} /> Dismiss {checkedList.length}
              </button>
              {needsReview > 0 && <span className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>{needsReview} run an action — review individually</span>}
            </div>
          )}

          {laneItems.length === 0 ? (
            <LaneEmpty lane={laneDef.key} />
          ) : (
            <div className="flex h-[calc(100vh-260px)] min-h-[440px] flex-col overflow-hidden rounded-sm border md:flex-row" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              {/* LEFT — lane list (same surface, hairline divider — not a second box) */}
              <div className="h-2/5 w-full shrink-0 overflow-y-auto border-b md:h-auto md:w-[38%] md:border-b-0 md:border-r" style={{ borderColor: "var(--border-soft)", scrollbarGutter: "stable" }}>
                {visible.map((d, i) => {
                  const a = agentByRaw(d.agent_name); const on = selectedId === d.id;
                  return (
                    <div key={d.id} className="flex items-center gap-2 px-2 py-2.5"
                      style={{ borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined, borderLeft: `2px solid ${on ? RISK_DOT[d.risk_level] : "transparent"}`, background: on ? "var(--surface-selected)" : "transparent" }}>
                      {laneDef.key === "approval" && (
                        <input type="checkbox" checked={checked.has(d.id)} onChange={(e) => { const s = new Set(checked); e.target.checked ? s.add(d.id) : s.delete(d.id); setChecked(s); }}
                          className="ml-1 h-3.5 w-3.5 shrink-0 accent-[var(--section-accent)]" onClick={(e) => e.stopPropagation()} />
                      )}
                      <button onClick={() => setSelectedId(d.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_DOT[d.risk_level] }} title={`${d.risk_level} risk`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }} title={d.title}>{d.title}</p>
                            {lane === "approval" && (verdicts.get(d.id) || verdictBusy === d.id) && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wide"
                                title="AI suggestion — advisory only"
                                style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                                <span className="h-1 w-1 rounded-full" style={{ background: verdictBusy === d.id ? "var(--text-faint)" : verdicts.get(d.id) === "approve" ? "#5f8169" : verdicts.get(d.id) === "reject" ? "#9c6b72" : "#97824f" }} />
                                {verdictBusy === d.id ? "…" : verdicts.get(d.id) === "insufficient" || verdicts.get(d.id) === "error" ? "no data" : `ai ${verdicts.get(d.id)}`}
                              </span>
                            )}
                            {lane === "approval" && triage?.get(d.id) && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wide"
                                style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
                                title={triage.get(d.id)!.reason}>
                                <span className="h-1 w-1 rounded-full" style={{ background: triage.get(d.id)!.priority === "high" ? "#9c6b72" : triage.get(d.id)!.priority === "low" ? "var(--text-faint)" : "#97824f" }} />
                                {triage.get(d.id)!.priority}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <a.Icon size={11} style={{ color: "var(--text-faint)" }} />
                            <span className="truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>
                              {lane === "approval" && triage?.get(d.id)?.reason ? triage.get(d.id)!.reason : `${a.name.replace(" Agent", "")} · ${laneDef.open ? `${relTime(d.created_at)} ago` : `resolved ${relTime(d.resolved_at)} ago`}`}
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {visible.length === 0 && <div className="px-4 py-10 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>No decisions match these filters.</div>}
              </div>

              {/* RIGHT — dossier (same surface) */}
              <div className="relative min-w-0 flex-1 overflow-hidden">
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

function Dossier({ d, lane, acting, onResolve, members, onChanged }: { d: Decision; lane: { key: LaneKey; open: boolean }; acting: { id: string; action: string } | null; onResolve: (d: Decision, a: "approve" | "reject" | "snooze", opts?: { until?: string; note?: string }) => void; members: Member[]; onChanged: () => void }) {
  const a = agentByRaw(d.agent_name);
  const sources = mapEvidence(d.evidence ?? []);
  const target = (d.evidence ?? [])[0];
  const busy = acting?.id === d.id;
  const currentState = target?.match_reason || (d.summary ? d.summary.split(",")[0] : "current state");
  const proposed = d.recommended_action || "Apply the agent's recommendation";
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const SNOOZE_PRESETS: { label: string; hours: number }[] = [
    { label: "1 hour", hours: 1 }, { label: "24 hours", hours: 24 }, { label: "3 days", hours: 72 }, { label: "1 week", hours: 168 },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" style={{ scrollbarGutter: "stable" }}>
        {/* header */}
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm" style={{ background: "color-mix(in srgb, var(--section-accent) 12%, transparent)" }}><a.Icon size={17} style={{ color: "var(--section-accent)" }} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>{a.name}</span>
              <span className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_DOT[d.risk_level] }} /> {d.risk_level} risk
              </span>
              {/* Confidence only when the backend actually computed one — else honest "source-backed". */}
              {d.confidence != null ? <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{d.confidence}% confidence</span> : <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>source-backed</span>}
            </div>
            <h2 className="mt-1 break-words text-[16px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{d.title}</h2>
            <p className="mt-0.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Raised {exactTime(d.created_at)}{!lane.open && d.resolved_at ? ` · ${d.status} ${exactTime(d.resolved_at)}` : ""}</p>
          </div>
        </div>

        {/* Proposed change — shared DossierSection (flat, no extra card frame) */}
        <DossierSection icon={Zap} title="Proposed change">
          {target?.node_id && (
            <Link to={`/objects/${encodeURIComponent(target.object_type ?? "deals")}/${target.node_id}`} className="mb-2.5 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] transition-colors" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              Target: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{target.title || "record"}</span><ExternalLink size={11} style={{ color: "var(--text-faint)" }} />
            </Link>
          )}
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", borderLeft: "2px solid #97824f" }}>
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-faint)" }}>Current</div>
              <div className="mt-1 break-words text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{currentState}</div>
            </div>
            <div className="flex shrink-0 items-center"><ArrowRight size={18} style={{ color: "var(--text-faint)" }} /></div>
            <div className="min-w-0 flex-1 rounded-sm border px-3 py-2.5" style={{ borderColor: "var(--border-soft)", borderLeft: "2px solid #5f8169" }}>
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-faint)" }}>Proposed</div>
              <div className="mt-1 break-words text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{proposed}</div>
            </div>
          </div>
        </DossierSection>

        {/* Impact — exactly what approving does (real, mirrors backend execution) */}
        {d.execution_preview && (
          <DossierSection icon={PlayCircle} title={`Impact${d.execution_preview.side_effect ? " · runs an action" : " · advisory"}`}>
            <p className="text-[12px]" style={{ color: "var(--text-secondary)", borderLeft: `2px solid ${d.execution_preview.side_effect ? "#97824f" : "var(--border-strong)"}`, paddingLeft: "0.625rem" }}>{d.execution_preview.text}</p>
          </DossierSection>
        )}

        {/* AI verdict — structured, grounded adjudication (open lanes only) */}
        {lane.open && <DecisionVerdict decision={d} />}

        {/* Why — shared DossierSection block */}
        {d.summary && (
          <DossierSection title="Why your agent raised this">
            <p className="break-words text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>
          </DossierSection>
        )}

        {/* Evidence — shared DossierSection block */}
        {sources.length > 0 && (
          <DossierSection title="Evidence">
            <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s} />)}</div>
          </DossierSection>
        )}

        {/* AI reasoning — shared collapsible DossierSection (only when LLM-generated). */}
        {d.generation_context?.user_prompt && (
          <DossierSection collapsible defaultOpen={false} title="Why the AI chose this">
            <div className="space-y-3 text-[11.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              <div>
                <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>What the agent saw (real captured prompt)</div>
                <pre className="whitespace-pre-wrap break-words font-sans">{d.generation_context.user_prompt.slice(0, 1200)}</pre>
              </div>
              {d.generation_context.model_output != null && (
                <div>
                  <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>What the agent produced (real captured output)</div>
                  <pre className="whitespace-pre-wrap break-words rounded-sm p-2 font-mono text-[10.5px]" style={{ background: "var(--surface-hover)" }}>{(typeof d.generation_context.model_output === "string" ? d.generation_context.model_output : JSON.stringify(d.generation_context.model_output, null, 2)).slice(0, 1500)}</pre>
                </div>
              )}
              <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Captured verbatim when the agent raised this decision — provenance, not a reconstruction.</p>
            </div>
          </DossierSection>
        )}

        {/* Audit trail — shared DossierSection block */}
        <DossierSection icon={History} title="Audit trail">
          <div className="space-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <div>Created {exactTime(d.created_at)} by {a.name}.</div>
            {d.status === "snoozed" && d.snoozed_until && <div>Snoozed until {exactTime(d.snoozed_until)}.</div>}
            {(d.status === "approved" || d.status === "rejected" || d.status === "completed") && d.resolved_at && (
              <div className="capitalize">{d.status} {exactTime(d.resolved_at)}{d.resolved_by ? ` · by ${memberLabel(members, d.resolved_by) ?? "a workspace member"}` : ""}.</div>
            )}
          </div>
        </DossierSection>

        {/* Assigned reviewer */}
        <AssigneePicker d={d} members={members} onChanged={onChanged} />

        {/* Comments thread */}
        <DecisionComments decision={d} />

        {/* Grounded Ask */}
        <DecisionAsk decision={d} />
      </div>

      {/* Action bar — preserved handlers. Open lanes act; resolved lanes show read-only status. */}
      {lane.open ? (
        <div className="border-t" style={{ borderColor: "var(--border-soft)" }}>
          {/* Reject-with-reason — the note lands in the decision's real comments audit before resolving */}
          {rejectOpen && (
            <div className="flex items-end gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, #9c6b72 4%, transparent)" }}>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[10.5px] font-semibold" style={{ color: "#9c6b72" }}>Why reject? (recorded in the audit trail)</div>
                <input autoFocus value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { setRejectOpen(false); onResolve(d, "reject", rejectNote.trim() ? { note: rejectNote.trim() } : undefined); } if (e.key === "Escape") setRejectOpen(false); }}
                  placeholder="Optional — e.g. wrong recipient, stale data…"
                  className="w-full rounded-sm border bg-transparent px-2.5 py-1.5 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
              </div>
              <button onClick={() => { setRejectOpen(false); onResolve(d, "reject", rejectNote.trim() ? { note: rejectNote.trim() } : undefined); }}
                className="shrink-0 rounded-sm border px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: "#9c6b72", color: "#9c6b72" }}>Reject</button>
              <button onClick={() => setRejectOpen(false)} className="btn-icon h-8 w-8 shrink-0"><XCircle size={14} /></button>
            </div>
          )}
          {/* Snooze presets — real `until` timestamps via the existing endpoint */}
          {snoozeOpen && (
            <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
              <span className="text-[10.5px] font-semibold" style={{ color: "var(--text-muted)" }}>Snooze for</span>
              {SNOOZE_PRESETS.map(pr => (
                <button key={pr.hours} onClick={() => { setSnoozeOpen(false); onResolve(d, "snooze", { until: new Date(Date.now() + pr.hours * 3_600_000).toISOString() }); }}
                  className="rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[var(--section-accent)]"
                  style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{pr.label}</button>
              ))}
              <button onClick={() => setSnoozeOpen(false)} className="ml-auto btn-icon h-7 w-7"><XCircle size={13} /></button>
            </div>
          )}
          <div className="flex items-center gap-2 p-3">
            <button onClick={() => onResolve(d, "approve")} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-sm border px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-60"
              style={{ borderColor: "color-mix(in srgb, #5f8169 55%, transparent)", background: "color-mix(in srgb, #5f8169 14%, transparent)", color: "#5f8169" }}>
              {busy && acting?.action === "approve" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve &amp; run
            </button>
            <button onClick={() => setRejectOpen(o => !o)} disabled={busy} className="flex items-center gap-2 rounded-sm border px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-selected)", color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#9c6b72"; e.currentTarget.style.color = "#9c6b72"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
              {busy && acting?.action === "reject" ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
            </button>
            {d.status === "pending" && (
              <button onClick={() => setSnoozeOpen(o => !o)} disabled={busy} title="Snooze — needs more context" className="flex items-center gap-1.5 rounded-sm border px-3.5 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60"
                style={{ borderColor: "var(--border-strong)", background: "var(--surface-selected)", color: "var(--text-muted)" }}>
                {busy && acting?.action === "snooze" ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />} Snooze <ChevronDown size={12} />
              </button>
            )}
          </div>
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
        <button type="submit" disabled={add.isPending || !text.trim()} className="flex items-center gap-1 rounded-sm border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
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
        <button type="submit" disabled={ask.isPending || !q.trim()} className="flex items-center gap-1 rounded-sm border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {ask.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      </form>
      {!ask.data && !ask.isPending && (
        <div className="mt-1.5 flex flex-wrap gap-1">{QUICK_ASKS.map(s => <button key={s} onClick={() => ask.mutate(s)} className="rounded-sm border px-2 py-0.5 text-[10px] transition-colors" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{s}</button>)}</div>
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
  // Shared EmptyState — same empty language as the rest of the app (icon differs by lane intent).
  return <EmptyState icon={lane === "approval" ? CheckCircle2 : Inbox} title={c.title} description={c.sub} />;
}


/**
 * AI verdict — on-demand structured adjudication of one decision. Grounded server-side on the
 * recorded data only; shows its grounding (evidence count, agent context) as proof. Advisory:
 * the buttons below remain the ONLY way anything executes.
 */
function DecisionVerdict({ decision }: { decision: Decision }) {
  const verdict = useMutation({
    mutationFn: () => apiClient.post<{
      sufficient: boolean; reason?: string; recommendation?: "approve" | "reject" | "investigate";
      rationale?: string; risks?: string[]; checks?: string[];
      grounded_on?: { evidence_count: number; has_summary: boolean; has_agent_context: boolean };
    }>(`/decisions/${decision.id}/verdict`, {}),
  });
  const v = verdict.data;
  const TONE: Record<string, string> = { approve: "#5f8169", reject: "#9c6b72", investigate: "#97824f" };
  return (
    // Shared DossierSection — same flat surface as Proposed change / Impact / Evidence / Audit.
    <DossierSection
      icon={Sparkles}
      title="AI verdict"
      action={
        <button onClick={() => verdict.mutate()} disabled={verdict.isPending}
          className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
          style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
          {verdict.isPending ? <Loader2 size={11} className="animate-spin" /> : v ? "Re-adjudicate" : "Adjudicate"}
        </button>
      }
    >
      {verdict.isError && <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>The AI service is unavailable right now — the decision is still fully reviewable above.</p>}
      {v && !v.sufficient && <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>{v.reason ?? "Not enough recorded data to adjudicate."}</p>}
      {v?.sufficient && v.recommendation && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: "var(--border-strong)", color: TONE[v.recommendation] }}>
              {v.recommendation === "approve" ? <CheckCircle2 size={11} /> : v.recommendation === "reject" ? <XCircle size={11} /> : <ShieldAlert size={11} />} {v.recommendation}
            </span>
            {v.grounded_on && (
              <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                grounded on {v.grounded_on.evidence_count} evidence item{v.grounded_on.evidence_count !== 1 ? "s" : ""}{v.grounded_on.has_agent_context ? " + the agent's captured context" : ""}{v.grounded_on.has_summary ? " + summary" : ""}
              </span>
            )}
          </div>
          {v.rationale && <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{v.rationale}</p>}
          {(v.risks ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#9c6b72" }}>Risks of approving</div>
              <ul className="space-y-1">{v.risks!.map((r, i) => <li key={i} className="flex gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "#9c6b72" }} />{r}</li>)}</ul>
            </div>
          )}
          {(v.checks ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#97824f" }}>Verify before acting</div>
              <ul className="space-y-1">{v.checks!.map((r, i) => <li key={i} className="flex gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "#97824f" }} />{r}</li>)}</ul>
            </div>
          )}
          <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Advisory only — nothing runs until you act below.</p>
        </div>
      )}
      {!v && !verdict.isPending && !verdict.isError && (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
          Ask the AI to adjudicate this decision — recommendation, risks, and what to verify, grounded strictly in the recorded evidence. It never acts on its own.
        </p>
      )}
    </DossierSection>
  );
}
