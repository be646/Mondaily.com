import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, ShieldCheck, Users, Zap, AlertTriangle, Activity, Target, X, Plus, CheckSquare, Sparkles } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { PageSkeleton, ErrorState } from "../../components/ui/page-state";
import { formatMoney } from "../../hooks/useCurrency";
import { DeltaPill, RISK_TONE, PACE_TONE, READY_TONE } from "../../components/ui/indicators";

/**
 * OWNER CONSOLE — the operating view. Design rules (deliberate, from the chrome contract):
 *   - Row one is four numbers, large, with deltas. It is the reason the page exists.
 *   - Everything below is TABLES, not tiles — tile soup gives twenty equal-weight cards and an
 *     owner none the wiser. Tables respect the reader.
 *   - Money, People, Agents and Pipeline health share one scroll; no tabs hiding the glance.
 *   - Every number comes from the API's lib/money — the same definitions as the Brief.
 */

interface Console {
  base: string;
  money: {
    closed_won: { value: number; count: number; delta: number | null };
    cash: { collected: number; invoiced: number; outstanding: number; delta: number | null };
    pipeline_created: { value: number; count: number; delta: number | null };
    forecast: { value: number; open_count: number; open_value: number };
    overdue: { count: number; total: number; aging: { bucket: string; count: number; total: number }[] };
  };
  people: { owner: string; closed_count: number; closed_value: number; created_count: number; created_value: number; open_value: number }[];
  members: { user_id: string; name: string | null; email: string | null; role: string }[];
  agents: {
    rows: { agent: string; auto: number; human: number; pending: number }[];
    autonomy_level: string;
    breaker: { used_last_hour: number; cap: number };
    spend_30d: { feature: string; total_tokens: number; calls: number }[];
  };
  actions: {
    unassigned_deals: { id: string; name: string; value: number; stage: string }[];
    pending_decisions: { count: number; top: { id: string; title: string; risk: string; agent: string }[] };
  };
  pipeline_health: {
    stalled: { count: number; value: number; top: { name: string; value: number; stage: string; days_stale: number }[] };
    on_hold: { count: number; value: number };
  };
  audit: { when: string; what: string }[];
}

// Delta pill + tone maps live in components/ui/indicators — the one copy.

function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-8 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
      <Icon size={11} /> {children}
    </p>
  );
}

interface Goal {
  id: string; scope: string; target_user_id: string | null; metric: string;
  target_value: number; window_days: number; label: string | null;
  actual: number; attainment_pct: number; pace: "ahead" | "on" | "behind";
}
const METRIC_LABEL: Record<string, string> = {
  tasks_completed: "Tasks completed", decisions_resolved: "Decisions resolved", deals_won: "Deals won",
  records_touched: "Records touched", ai_credits: "AI credits",
  deals_won_value: "Closed-won value", revenue_collected: "Revenue collected",
};
const MONEY_METRICS = new Set(["deals_won_value", "revenue_collected"]);


/**
 * Goals & Targets — the owner SETS targets here; attainment and pace are computed server-side
 * against the same lib/money definitions as the money row above, so a goal can never disagree
 * with the number it sits next to. Rolling windows: attainment IS the pace (the window is always
 * fully elapsed), so pace is thresholds, not time-proportion.
 */
function GoalsSection({ members, cur }: { members: Console["members"]; cur: (v: number) => string }) {
  const qc = useQueryClient();
  const goalsQ = useQuery<{ goals: Goal[]; available: boolean }>({
    queryKey: ["owner-goals"], queryFn: () => apiClient.get("/activities/goals"), staleTime: 60_000, retry: false,
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ metric: "deals_won_value", scope: "team", target_user_id: "", target_value: "", window_days: "30", label: "" });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["owner-goals"] });
  const create = useMutation({
    mutationFn: () => apiClient.post("/activities/goals", {
      metric: form.metric, scope: form.scope,
      target_user_id: form.scope === "member" ? form.target_user_id : null,
      target_value: Number(form.target_value), window_days: Number(form.window_days),
      label: form.label || undefined,
    }),
    onSuccess: () => { setAdding(false); setForm(f => ({ ...f, target_value: "", label: "" })); invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/activities/goals/${id}`), onSuccess: invalidate });
  const teamOnly = form.metric === "revenue_collected";
  const memberName = (uid: string | null) => members.find(m => m.user_id === uid)?.name ?? "member";

  const goals = goalsQ.data?.goals ?? [];
  return (
    <>
      <div className="mt-8 mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]"><Target size={11} /> Goals & targets</p>
        <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[10.5px] transition-colors hover:border-[var(--border-strong)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {adding ? <X size={10} /> : <Plus size={10} />} {adding ? "Cancel" : "Set target"}
        </button>
      </div>
      <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
        {adding && (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
            <select value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value, scope: e.target.value === "revenue_collected" ? "team" : f.scope }))} className="rounded-sm border bg-transparent px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>
              {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} disabled={teamOnly} className="rounded-sm border bg-transparent px-2 py-1 text-[11.5px] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>
              <option value="team">Whole team</option>
              <option value="member">One member</option>
            </select>
            {form.scope === "member" && !teamOnly && (
              <select value={form.target_user_id} onChange={e => setForm(f => ({ ...f, target_user_id: e.target.value }))} className="rounded-sm border bg-transparent px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>
                <option value="">Pick a member…</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email}</option>)}
              </select>
            )}
            <input value={form.target_value} onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))} placeholder="Target" inputMode="numeric" className="w-24 rounded-sm border bg-transparent px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <select value={form.window_days} onChange={e => setForm(f => ({ ...f, window_days: e.target.value }))} className="rounded-sm border bg-transparent px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>
              <option value="7">per 7 days</option><option value="30">per 30 days</option><option value="90">per 90 days</option>
            </select>
            <button onClick={() => create.mutate()} disabled={!(Number(form.target_value) > 0) || (form.scope === "member" && !form.target_user_id) || create.isPending}
              className="rounded-sm px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-50" style={{ background: "var(--section-accent)", color: "var(--surface-page)" }}>
              {create.isPending ? "Saving…" : "Save"}
            </button>
            {create.isError && <span className="text-[10.5px]" style={{ color: "#d1524a" }}>{String((create.error as Error)?.message ?? "Couldn't save")}</span>}
          </div>
        )}
        {goals.length === 0 && !adding && (
          <div className="px-4 py-3 text-[12px] text-[var(--text-muted)]">No targets set. "Set target" — closed-won value per month is the one most owners start with.</div>
        )}
        {goals.map(g => (
          <div key={g.id} className="border-b px-4 py-2.5 last:border-0" style={{ borderColor: "var(--border-soft)" }}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                {g.label || METRIC_LABEL[g.metric] || g.metric}
                <span className="ml-1.5 font-normal text-[var(--text-faint)]">· {g.scope === "team" ? "team" : memberName(g.target_user_id)} · {g.window_days}d</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[11.5px] tabular-nums text-[var(--text-muted)]">
                  {MONEY_METRICS.has(g.metric) ? cur(g.actual) : g.actual.toLocaleString()} / {MONEY_METRICS.has(g.metric) ? cur(g.target_value) : g.target_value.toLocaleString()}
                </span>
                <span className="rounded-full px-1.5 py-px text-[10px] font-semibold capitalize" style={{ color: PACE_TONE[g.pace], background: `color-mix(in srgb, ${PACE_TONE[g.pace]} 10%, transparent)` }}>{g.pace}</span>
                <button onClick={() => remove.mutate(g.id)} title="Remove target" className="text-[var(--text-faint)] transition-colors hover:text-[#d1524a]"><X size={11} /></button>
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
              <div className="h-full rounded-full" style={{ width: `${g.attainment_pct}%`, background: PACE_TONE[g.pace] }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Assignments & Actions — the cross-app pending-work queue, each row carrying its verb.
 * Approve/Reject call the SAME decision endpoints the Decisions page uses; Assign goes through
 * /owner/assign-deal, which merges server-side (a raw PATCH /nodes would replace `data` wholesale
 * and destroy the deal). Nothing here is a new capability — only existing verbs, surfaced.
 */
function ActionsSection({ actions, members, cur }: { actions: Console["actions"]; members: Console["members"]; cur: (v: number) => string }) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["owner-console"] }); qc.invalidateQueries({ queryKey: ["decisions"] }); };
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => apiClient.post(`/decisions/${id}/${action}`, {}),
    onSuccess: refresh,
  });
  const assign = useMutation({
    mutationFn: ({ id, owner }: { id: string; owner: string }) => apiClient.post("/owner/assign-deal", { node_id: id, owner }),
    onSuccess: refresh,
  });
  const RISK = RISK_TONE;
  const hasWork = actions.pending_decisions.count > 0 || actions.unassigned_deals.length > 0;

  return (
    <>
      <SectionLabel icon={CheckSquare}>Assignments & actions{actions.pending_decisions.count > 0 ? ` — ${actions.pending_decisions.count} pending` : ""}</SectionLabel>
      <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
        {!hasWork && <div className="px-4 py-3 text-[12px] text-[var(--text-muted)]">Nothing waiting — decisions are resolved and every open deal has an owner.</div>}

        {actions.pending_decisions.top.map(d => (
          <div key={d.id} className="flex items-center gap-3 border-b px-4 py-2 last:border-0" style={{ borderColor: "var(--border-soft)" }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RISK[d.risk] ?? "#717784" }} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">{d.title}</span>
            <span className="shrink-0 text-[10px] capitalize text-[var(--text-faint)]">{String(d.agent ?? "").replace(/_/g, " ")}</span>
            <span className="flex shrink-0 gap-1">
              <button onClick={() => decide.mutate({ id: d.id, action: "approve" })} disabled={decide.isPending}
                className="rounded-sm border px-2 py-0.5 text-[10.5px] font-medium transition-colors hover:border-[#2f9e6b] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "#2f9e6b" }}>Approve</button>
              <button onClick={() => decide.mutate({ id: d.id, action: "reject" })} disabled={decide.isPending}
                className="rounded-sm border px-2 py-0.5 text-[10.5px] transition-colors hover:border-[#d1524a] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>Reject</button>
            </span>
          </div>
        ))}

        {actions.unassigned_deals.map(d => (
          <div key={d.id} className="flex items-center gap-3 border-b px-4 py-2 last:border-0" style={{ borderColor: "var(--border-soft)", background: "color-mix(in srgb, var(--section-accent) 3%, transparent)" }}>
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">{d.name} <span className="text-[var(--text-faint)]">· {d.stage || "no stage"} · unassigned</span></span>
            <span className="shrink-0 text-[11.5px] tabular-nums font-medium text-[var(--text-primary)]">{cur(d.value)}</span>
            <select defaultValue="" disabled={assign.isPending}
              onChange={e => { if (e.target.value) assign.mutate({ id: d.id, owner: e.target.value }); }}
              className="shrink-0 rounded-sm border bg-transparent px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <option value="" disabled>Assign to…</option>
              {members.filter(mb => mb.name).map(mb => <option key={mb.user_id} value={mb.name!}>{mb.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The autonomy dial, writable — manual / assisted / autonomous, via the SAME endpoint the
 * decisions page uses (PATCH /decisions/autonomy, admin-gated server-side as of this change: the
 * dial decides whether agents write unattended, and it was open to any member). "Autonomous" gets
 * a confirm, because it is explicit consent to unattended writes.
 */
function AutonomyDial({ level, breaker }: { level: string; breaker: { used_last_hour: number; cap: number } }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (l: string) => apiClient.patch("/decisions/autonomy", { level: l }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-console"] }),
  });
  const levels: { key: string; label: string }[] = [
    { key: "manual", label: "Manual" }, { key: "assisted", label: "Assisted" }, { key: "autonomous", label: "Autonomous" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
      <span className="flex items-center gap-1.5">
        <span className="text-[10.5px] text-[var(--text-muted)]">Autonomy</span>
        <span className="inline-flex overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
          {levels.map(l => (
            <button key={l.key} disabled={set.isPending || l.key === level}
              onClick={() => {
                if (l.key === "autonomous" && !window.confirm("Autonomous lets agents execute low- AND medium-risk decisions with nobody watching — including creating records. The 50/hour safety limit stays on. Continue?")) return;
                set.mutate(l.key);
              }}
              className="px-2 py-0.5 text-[10.5px] transition-colors disabled:cursor-default"
              style={l.key === level
                ? { background: "var(--section-accent)", color: "var(--surface-page)", fontWeight: 600 }
                : { color: "var(--text-muted)" }}>
              {l.label}
            </button>
          ))}
        </span>
        {set.isError && <span className="text-[10px]" style={{ color: "#d1524a" }}>couldn't change</span>}
      </span>
      <span className="text-[10.5px] tabular-nums text-[var(--text-muted)]">Safety limit: {breaker.used_last_hour}/{breaker.cap} auto-approvals this hour</span>
    </div>
  );
}

/**
 * The Owner Memo — on demand (a button, never auto-fired: it spends tokens), written by the
 * gateway from the console's own payload. CODE COUNTS, AI NARRATES: the server hands the model
 * the same numbers this page renders and instructs it to use nothing else; when the gateway is
 * down the deterministic template memo arrives instead, flagged honestly.
 */
function MemoSection() {
  const memo = useMutation<{ memo: string; ai: boolean; generated_at: string }>({
    mutationFn: () => apiClient.post("/owner/memo", {}),
  });
  return (
    <div className="mt-4 overflow-hidden rounded-sm border" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: memo.data ? "1px solid var(--section-accent-line)" : "none" }}>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--section-accent)" }}>
          <Sparkles size={11} /> Owner memo
          {memo.data && !memo.data.ai && <span className="normal-case tracking-normal font-normal text-[var(--text-faint)]">— template (AI unavailable)</span>}
        </span>
        <button onClick={() => memo.mutate()} disabled={memo.isPending}
          className="rounded-sm border px-2 py-0.5 text-[10.5px] transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-60"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          {memo.isPending ? "Writing…" : memo.data ? "Rewrite" : "Write memo"}
        </button>
      </div>
      {memo.data && (
        <div className="space-y-2 px-4 py-3">
          {memo.data.memo.split(/\n+/).filter(Boolean).map((para, i) => (
            <p key={i} className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-primary)" }}>{para}</p>
          ))}
        </div>
      )}
      {memo.isError && <div className="px-4 py-3 text-[11.5px]" style={{ color: "#d1524a" }}>Couldn't write the memo — try again.</div>}
    </div>
  );
}

const cell = "px-3 py-2 text-[12px]";
const th = "px-3 py-1.5 text-left text-[10.5px] font-medium text-[var(--text-muted)] first-letter:uppercase";

export function OwnerConsolePage() {
  const { data, isLoading, isError, refetch } = useQuery<Console>({
    queryKey: ["owner-console"], queryFn: () => apiClient.get("/owner/console"), staleTime: 60_000,
  });
  const readiness = useQuery<{ group?: Record<string, string> }>({
    queryKey: ["admin-readiness"], queryFn: () => apiClient.get("/admin/readiness"), staleTime: 300_000, retry: false,
  });

  if (isLoading) return <div className="mx-auto max-w-5xl px-6 py-8"><PageSkeleton label="Assembling the console…" /></div>;
  if (isError || !data) return <div className="mx-auto max-w-5xl px-6 py-8"><ErrorState error={new Error("Couldn't load the console — owner/admin access required.")} onRetry={() => refetch()} /></div>;

  const cur = (v: number) => formatMoney(v, data.base);
  const m = data.money;
  const lead = [
    { label: "Closed won", value: cur(m.closed_won.value), delta: m.closed_won.delta as number | null | undefined, sub: `${m.closed_won.count} deal${m.closed_won.count === 1 ? "" : "s"} this month` },
    { label: "Cash collected", value: cur(m.cash.collected), delta: m.cash.delta as number | null | undefined, sub: `${cur(m.cash.invoiced)} invoiced · ${cur(m.cash.outstanding)} outstanding` },
    { label: "Pipeline created", value: cur(m.pipeline_created.value), delta: m.pipeline_created.delta as number | null | undefined, sub: `${m.pipeline_created.count} new deal${m.pipeline_created.count === 1 ? "" : "s"}` },
    { label: "Forecast", value: cur(m.forecast.value), delta: undefined as number | null | undefined, sub: `weighted, over ${m.forecast.open_count} open (${cur(m.forecast.open_value)})` },
  ];
  const overdueTotal = m.overdue.total > 0;
  // The readiness payload key is `group`, SINGULAR — verified against the live response, because
  // typing the wrong key here compiles fine and just silently hides the whole System section
  // (the same failure shape as the relation picker reading obj.label that never existed).
  const groups = readiness.data?.group ?? {};


  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <CommandPageHeader
        icon={Crown}
        callsign="CONSOLE"
        title="Owner Console"
        subtitle="Money, people, agents, and pipeline health — month to date, same definitions as the Brief."
      />

      {/* Row one — the reason the page exists */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {lead.map(t => (
          <div key={t.label} className="rounded-sm border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--text-muted)]">{t.label}</span>
              <DeltaPill delta={t.delta} />
            </div>
            <div className="mt-1 text-[26px] font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">{t.value}</div>
            <div className="mt-0.5 truncate text-[10.5px] text-[var(--text-faint)]">{t.sub}</div>
          </div>
        ))}
      </div>

      <MemoSection />

      {/* Overdue AR — only when there is any; an empty aging table is noise */}
      {overdueTotal && (
        <div className="mt-3 overflow-hidden rounded-sm border" style={{ borderColor: "rgba(209,82,74,.35)" }}>
          <div className="flex items-center justify-between px-4 py-2" style={{ background: "rgba(209,82,74,.06)" }}>
            <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#d1524a" }}><AlertTriangle size={11} /> Overdue AR — {m.overdue.count} invoice{m.overdue.count === 1 ? "" : "s"}, {cur(m.overdue.total)}</span>
            <span className="text-[10.5px] tabular-nums text-[var(--text-muted)]">
              {m.overdue.aging.filter(a => a.count > 0).map(a => `${a.bucket}: ${cur(a.total)}`).join(" · ")}
            </span>
          </div>
        </div>
      )}

      <GoalsSection members={data.members} cur={cur} />

      <ActionsSection actions={data.actions} members={data.members} cur={cur} />

      {/* People — money facts per member, no invented scores */}
      <SectionLabel icon={Users}>People — who is closing</SectionLabel>
      <div className="overflow-x-auto rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
        <table className="w-full border-collapse">
          <thead><tr className="border-b" style={{ borderColor: "var(--border-soft)" }}>
            <th className={th}>member</th><th className={`${th} text-right`}>closed</th><th className={`${th} text-right`}>closed value</th><th className={`${th} text-right`}>created</th><th className={`${th} text-right`}>open pipeline</th>
          </tr></thead>
          <tbody>
            {data.people.length === 0 && <tr><td colSpan={5} className={`${cell} text-[var(--text-muted)]`}>No deals carry an owner yet — assign deal owners and this table fills itself.</td></tr>}
            {data.people.map(p => (
              <tr key={p.owner} className="border-b last:border-0" style={{ borderColor: "var(--border-soft)" }}>
                <td className={`${cell} font-medium text-[var(--text-primary)]`}>{p.owner}</td>
                <td className={`${cell} text-right tabular-nums`}>{p.closed_count}</td>
                <td className={`${cell} text-right tabular-nums font-medium text-[var(--text-primary)]`}>{cur(p.closed_value)}</td>
                <td className={`${cell} text-right tabular-nums`}>{p.created_count}</td>
                <td className={`${cell} text-right tabular-nums text-[var(--text-muted)]`}>{cur(p.open_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agents — unattended work this week + the circuit breaker's live state */}
      <SectionLabel icon={Zap}>Agents — last 7 days</SectionLabel>
      <div className="overflow-x-auto rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
        <table className="w-full border-collapse">
          <thead><tr className="border-b" style={{ borderColor: "var(--border-soft)" }}>
            <th className={th}>agent</th><th className={`${th} text-right`}>auto-approved</th><th className={`${th} text-right`}>human-resolved</th><th className={`${th} text-right`}>pending now</th>
          </tr></thead>
          <tbody>
            {data.agents.rows.length === 0 && <tr><td colSpan={4} className={`${cell} text-[var(--text-muted)]`}>No agent decisions this week.</td></tr>}
            {data.agents.rows.map(a => (
              <tr key={a.agent} className="border-b last:border-0" style={{ borderColor: "var(--border-soft)" }}>
                <td className={`${cell} font-medium capitalize text-[var(--text-primary)]`}>{a.agent.replace(/_/g, " ")}</td>
                <td className={`${cell} text-right tabular-nums`}>{a.auto}</td>
                <td className={`${cell} text-right tabular-nums`}>{a.human}</td>
                <td className={`${cell} text-right tabular-nums`}>{a.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <AutonomyDial level={data.agents.autonomy_level} breaker={data.agents.breaker} />
        {data.agents.spend_30d.length > 0 && (
          <div className="border-t px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-widest text-[var(--text-faint)]">AI spend — 30 days, real tokens</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {data.agents.spend_30d.map(sp => (
                <span key={sp.feature} className="text-[10.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                  <span className="capitalize">{sp.feature.replace(/[_-]/g, " ")}</span>: <strong style={{ color: "var(--text-secondary)" }}>{sp.total_tokens >= 1_000_000 ? `${(sp.total_tokens / 1_000_000).toFixed(1)}M` : sp.total_tokens >= 1000 ? `${Math.round(sp.total_tokens / 1000)}k` : sp.total_tokens}</strong> tok · {sp.calls} calls
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pipeline health — the money going cold */}
      <SectionLabel icon={Activity}>Pipeline health</SectionLabel>
      <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b px-4 py-2.5 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
          <span><strong className="tabular-nums text-[var(--text-primary)]">{data.pipeline_health.stalled.count}</strong> open deals untouched 30+ days ({cur(data.pipeline_health.stalled.value)})</span>
          <span><strong className="tabular-nums text-[var(--text-primary)]">{data.pipeline_health.on_hold.count}</strong> on hold ({cur(data.pipeline_health.on_hold.value)})</span>
        </div>
        {data.pipeline_health.stalled.top.map(d => (
          <div key={d.name} className="flex items-center justify-between border-b px-4 py-2 text-[12px] last:border-0" style={{ borderColor: "var(--border-soft)" }}>
            <span className="min-w-0 truncate text-[var(--text-primary)]">{d.name} <span className="text-[var(--text-faint)]">· {d.stage}</span></span>
            <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{cur(d.value)} · {d.days_stale}d idle</span>
          </div>
        ))}
      </div>

      {/* System — the readiness inspector's verdicts, one line each */}
      {Object.keys(groups).length > 0 && (
        <>
          <SectionLabel icon={ShieldCheck}>System</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {Object.entries(groups).filter(([, v]) => typeof v === "string").map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] capitalize" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: READY_TONE[String(v)] ?? "var(--text-faint)" }} />
                {k.replace(/_/g, " ")}: {String(v)}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Audit — recent consequential events, not a raw feed */}
      {data.audit.length > 0 && (
        <>
          <SectionLabel icon={ShieldCheck}>Recent audit</SectionLabel>
          <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            {data.audit.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b px-4 py-2 text-[11.5px] last:border-0" style={{ borderColor: "var(--border-soft)" }}>
                <span className="min-w-0 truncate text-[var(--text-secondary)]">{a.what}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-faint)]">{new Date(a.when).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
