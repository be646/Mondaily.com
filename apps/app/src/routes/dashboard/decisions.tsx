import { useEffect, useState } from "react";
import type { ElementType } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, Clock, CheckCircle2, XCircle, Inbox, ArrowRight, Loader2, Zap, ExternalLink } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { PageSkeleton } from "../../components/ui/page-state";
import { SourceCard } from "../../components/ai/ask-shared";
import { useDecisionQueue, mapEvidence, RISK_STYLE, type Decision } from "../../components/ai/decision-queue";
import { agentByRaw } from "../../lib/agents";

const RISK_DOT: Record<Decision["risk_level"], string> = { high: "#dc2626", medium: "#d97706", low: "#10b981" };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function relTime(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Decision Queue — "Autonomous AI Mission Deck". A 40/60 split: a dense decision
 * stream on the left, a full Impact Canvas on the right. Every field is real
 * (decision_queue + its evidence); the transformation widget maps the REAL current
 * state → the REAL recommended action — no fabricated stage drifts. Actions show an
 * inline spinner, a confirmation banner (600ms), then slide to the next item.
 */
export function DecisionsPage() {
  const qc = useQueryClient();
  const { data: decisions, isLoading, isError } = useDecisionQueue();
  const [riskFilter, setRiskFilter] = useState<Decision["risk_level"] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; action: string } | null>(null);
  const [banner, setBanner] = useState<{ kind: "approved" | "rejected" | "snoozed" } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searchParams] = useSearchParams();

  const items = decisions ?? [];
  const visible = items.filter(d => !riskFilter || d.risk_level === riskFilter);

  // Keep a valid selection as the list changes.
  const focusId = searchParams.get("id");
  useEffect(() => {
    if (focusId && items.some(d => d.id === focusId)) { setSelectedId(focusId); return; }
    if (!selectedId || !visible.some(d => d.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [focusId, decisions, riskFilter]); // eslint-disable-line

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["agent-registry"] });
  };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "snooze" }) => apiClient.post(`/decisions/${id}/${action}`, {}),
  });
  const bulk = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "approve" | "reject" | "snooze" }) => apiClient.post(`/decisions/bulk`, { ids, action }),
  });

  const selected = visible.find(d => d.id === selectedId) ?? null;

  // Action with the full verification loop: spinner → banner → 600ms → advance.
  async function resolve(d: Decision, action: "approve" | "reject" | "snooze") {
    if (acting) return;
    const idx = visible.findIndex(x => x.id === d.id);
    const next = visible[idx + 1]?.id ?? visible[idx - 1]?.id ?? null;
    setActing({ id: d.id, action });
    try {
      await act.mutateAsync({ id: d.id, action });
      setBanner({ kind: action === "approve" ? "approved" : action === "reject" ? "rejected" : "snoozed" });
      await sleep(600);
    } finally {
      setBanner(null);
      setActing(null);
      setSelectedId(next);
      invalidate();
    }
  }

  async function bulkApproveLow() {
    const lowIds = visible.filter(d => d.risk_level === "low").map(d => d.id);
    if (lowIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try { await bulk.mutateAsync({ ids: lowIds, action: "approve" }); await sleep(500); }
    finally { setBulkBusy(false); invalidate(); }
  }

  if (isLoading) return <PageSkeleton />;

  const counts = {
    all: items.length,
    high: items.filter(d => d.risk_level === "high").length,
    medium: items.filter(d => d.risk_level === "medium").length,
    low: items.filter(d => d.risk_level === "low").length,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 font-mono sm:px-6">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--section-accent)" }}>// AUTONOMOUS MISSION DECK · live</p>
        <h1 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Decision Deck</h1>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>Your agents' proposed actions. Pick one on the left; review and approve its full impact on the right.</p>
      </div>

      {isError ? (
        <div className="surface-card rounded-sm p-5 text-[13px]" style={{ color: "var(--text-faint)" }}>Couldn't load the Decision Queue right now. Refresh, or check back shortly.</div>
      ) : items.length === 0 ? (
        <EmptyDeck />
      ) : (
        <>
          {/* Risk filter + bulk */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-sm border p-0.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              {([{ k: null, l: "All", n: counts.all }, { k: "high" as const, l: "High", n: counts.high }, { k: "medium" as const, l: "Med", n: counts.medium }, { k: "low" as const, l: "Low", n: counts.low }]).map(s => {
                const on = riskFilter === s.k;
                return (
                  <button key={s.l} onClick={() => setRiskFilter(s.k)} className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs transition-colors"
                    style={on ? { background: "color-mix(in srgb, var(--section-accent) 12%, transparent)", color: "var(--section-accent)" } : { color: "var(--text-muted)" }}>
                    {s.k && <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_DOT[s.k] }} />}{s.l}<span className="tabular-nums opacity-60">{s.n}</span>
                  </button>
                );
              })}
            </div>
            {counts.low > 0 && (
              <button onClick={bulkApproveLow} disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: "#10b981" }}>
                {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Approve {counts.low} low-risk
              </button>
            )}
          </div>

          {/* Split deck */}
          <div className="flex h-[calc(100vh-230px)] min-h-[460px] gap-4">
            {/* LEFT — dense stream (40%) */}
            <div className="w-[40%] shrink-0 overflow-y-auto rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <AnimatePresence initial={false}>
                {visible.map((d, i) => {
                  const a = agentByRaw(d.agent_name);
                  const on = selectedId === d.id;
                  return (
                    <motion.button key={d.id} layout
                      initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }} onClick={() => setSelectedId(d.id)}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors"
                      style={{ borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined, borderLeft: `2px solid ${on ? RISK_DOT[d.risk_level] : "transparent"}`, background: on ? "color-mix(in srgb, var(--section-accent) 7%, transparent)" : "transparent" }}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_DOT[d.risk_level] }} title={`${d.risk_level} risk`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{d.title}</p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <a.Icon size={11} style={{ color: "var(--text-faint)" }} />
                          <span className="truncate text-[10.5px]" style={{ color: "var(--text-faint)" }}>{a.name.replace(" Agent", "")} · {relTime(d.created_at)} ago</span>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
              {visible.length === 0 && <div className="px-4 py-10 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>No {riskFilter} decisions.</div>}
            </div>

            {/* RIGHT — Impact Canvas (60%) */}
            <div className="relative flex-1 overflow-y-auto rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              {selected ? <ImpactCanvas key={selected.id} d={selected} acting={acting} onResolve={resolve} /> : (
                <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "var(--text-muted)" }}>Select a decision to review its impact.</div>
              )}
              {/* verification banner */}
              <AnimatePresence>
                {banner && (
                  <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                    className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--surface-card) 70%, transparent)" }}>
                    <div className="flex items-center gap-2.5 rounded-sm border px-5 py-3 text-[14px] font-semibold tracking-wide shadow-2xl"
                      style={banner.kind === "approved"
                        ? { borderColor: "#10b981", color: "#10b981", background: "color-mix(in srgb, #10b981 12%, var(--surface-card))", boxShadow: "0 0 30px color-mix(in srgb, #10b981 35%, transparent)" }
                        : { borderColor: banner.kind === "rejected" ? "#ef4444" : "var(--text-faint)", color: banner.kind === "rejected" ? "#ef4444" : "var(--text-muted)", background: "var(--surface-card)" }}>
                      {banner.kind === "approved" ? <><CheckCircle2 size={18} /> ✓ AUTOMATION INJECTED SECURELY</>
                        : banner.kind === "rejected" ? <><XCircle size={18} /> ✕ DISMISSED</>
                        : <><Clock size={18} /> ⏳ SNOOZED 24H</>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ImpactCanvas({ d, acting, onResolve }: { d: Decision; acting: { id: string; action: string } | null; onResolve: (d: Decision, a: "approve" | "reject" | "snooze") => void }) {
  const a = agentByRaw(d.agent_name);
  const sources = mapEvidence(d.evidence ?? []);
  const target = (d.evidence ?? [])[0];
  const busy = acting?.id === d.id;
  // Real "current state" from the evidence match_reason / summary (never fabricated).
  const currentState = target?.match_reason || (d.summary ? d.summary.split(",")[0] : "current state");
  const proposed = d.recommended_action || "Apply the agent's recommendation";

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        {/* header */}
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm" style={{ background: "color-mix(in srgb, var(--section-accent) 12%, transparent)" }}>
            <a.Icon size={17} style={{ color: "var(--section-accent)" }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium" style={{ color: "var(--section-accent)" }}>{a.name}</span>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${RISK_DOT[d.risk_level]}1a`, color: RISK_DOT[d.risk_level] }}>
                {d.risk_level === "high" && <ShieldAlert size={10} />} {d.risk_level} risk
              </span>
              {d.confidence != null && <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{d.confidence}% confidence</span>}
            </div>
            <h2 className="mt-1 text-[16px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{d.title}</h2>
          </div>
        </div>

        {/* Proposed transformation widget — real target · real current → real proposed action */}
        <div className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--section-accent) 3%, transparent)" }}>
          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            <Zap size={12} style={{ color: "var(--section-accent)" }} /> Proposed transformation
          </div>
          {target?.node_id && (
            <Link to={`/objects/${encodeURIComponent(target.object_type ?? "deals")}/${target.node_id}`} className="mb-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors hover:-translate-y-px" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              Target: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{target.title || "record"}</span>
              <ExternalLink size={11} style={{ color: "var(--text-faint)" }} />
            </Link>
          )}
          <div className="flex items-stretch gap-2">
            <div className="flex-1 rounded-sm border px-3 py-2.5" style={{ borderColor: "#d9770633", background: "#d977060d" }}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "#d97706" }}>Current</div>
              <div className="mt-1 text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{currentState}</div>
            </div>
            <div className="flex shrink-0 items-center"><ArrowRight size={18} style={{ color: "var(--text-faint)" }} /></div>
            <div className="flex-1 rounded-sm border px-3 py-2.5" style={{ borderColor: "#10b98133", background: "#10b9810d" }}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: "#10b981" }}>Proposed</div>
              <div className="mt-1 text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{proposed}</div>
            </div>
          </div>
        </div>

        {/* why (clean, not shouty uppercase) */}
        {d.summary && (
          <div className="rounded-sm border p-4" style={{ borderColor: "var(--border-soft)" }}>
            <div className="mb-1 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>Why your agent raised this</div>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{d.summary}</p>
          </div>
        )}

        {/* evidence */}
        {sources.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>Evidence</div>
            <div className="flex flex-wrap gap-1.5">{sources.map((s, i) => <SourceCard key={i} source={s} />)}</div>
          </div>
        )}
      </div>

      {/* action bar — tactical slate triggers, emerald/crimson border pulse on hover */}
      <div className="flex flex-wrap items-center gap-2 border-t p-4" style={{ borderColor: "var(--border-soft)" }}>
        <ActionBtn label="[ APPROVE AND COMMIT SYSTEM CLAIM ]" Icon={CheckCircle2} loading={busy && acting?.action === "approve"} disabled={busy} onClick={() => onResolve(d, "approve")} hoverColor="var(--section-accent)" />
        <ActionBtn label="[ REJECT MISSION PROTOCOL ]" Icon={XCircle} loading={busy && acting?.action === "reject"} disabled={busy} onClick={() => onResolve(d, "reject")} hoverColor="#f43f5e" />
        <ActionBtn label="[ SNOOZE ]" Icon={Clock} loading={busy && acting?.action === "snooze"} disabled={busy} onClick={() => onResolve(d, "snooze")} />
      </div>
    </motion.div>
  );
}

function ActionBtn({ label, Icon, loading, disabled, onClick, hoverColor }: { label: string; Icon: ElementType; loading: boolean; disabled: boolean; onClick: () => void; hoverColor?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-60"
      style={{ borderColor: "var(--border-strong)", background: "var(--surface-selected)", color: "var(--text-secondary)" }}
      onMouseEnter={e => { if (hoverColor) e.currentTarget.style.borderColor = hoverColor; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {label}
    </button>
  );
}

function EmptyDeck() {
  return (
    <div className="surface-card rounded-sm px-5 py-16 text-center">
      <Inbox size={22} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>You're all caught up</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>No decisions are waiting. Agents will queue items here when they need your approval.</p>
    </div>
  );
}
