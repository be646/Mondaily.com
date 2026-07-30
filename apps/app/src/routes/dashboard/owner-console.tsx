import { useQuery } from "@tanstack/react-query";
import { Crown, ShieldCheck, Users, Zap, AlertTriangle, Activity } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { PageSkeleton, ErrorState } from "../../components/ui/page-state";
import { formatMoney } from "../../hooks/useCurrency";

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
  members: { name: string | null; email: string | null; role: string }[];
  agents: { rows: { agent: string; auto: number; human: number; pending: number }[]; autonomy_level: string; breaker: { used_last_hour: number; cap: number } };
  pipeline_health: {
    stalled: { count: number; value: number; top: { name: string; value: number; stage: string; days_stale: number }[] };
    on_hold: { count: number; value: number };
  };
  audit: { when: string; what: string }[];
}

function Delta({ d }: { d: number | null }) {
  if (d === null) return <span className="text-[10px] text-[var(--text-faint)]">first month</span>;
  const up = d >= 0;
  return <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums" style={{ color: up ? "#2f9e6b" : "#d1524a", background: up ? "rgba(47,158,107,.1)" : "rgba(209,82,74,.1)" }}>{up ? "▲" : "▼"} {Math.abs(d)}%</span>;
}

function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-8 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
      <Icon size={11} /> {children}
    </p>
  );
}

const cell = "px-3 py-2 text-[12px]";
const th = "px-3 py-1.5 text-left text-[10.5px] font-medium text-[var(--text-muted)] first-letter:uppercase";

export function OwnerConsolePage() {
  const { data, isLoading, isError, refetch } = useQuery<Console>({
    queryKey: ["owner-console"], queryFn: () => apiClient.get("/owner/console"), staleTime: 60_000,
  });
  const readiness = useQuery<{ groups?: Record<string, string> }>({
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
  const groups = readiness.data?.groups ?? {};
  const READY_TONE: Record<string, string> = { ready: "#2f9e6b", partial: "#c6892e", missing: "#d1524a" };

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
              {t.delta !== undefined && <Delta d={t.delta} />}
            </div>
            <div className="mt-1 text-[26px] font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">{t.value}</div>
            <div className="mt-0.5 truncate text-[10.5px] text-[var(--text-faint)]">{t.sub}</div>
          </div>
        ))}
      </div>

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
        <div className="flex items-center justify-between border-t px-3 py-2 text-[10.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          <span>Autonomy: <strong className="capitalize text-[var(--text-primary)]">{data.agents.autonomy_level}</strong></span>
          <span className="tabular-nums">Safety limit: {data.agents.breaker.used_last_hour}/{data.agents.breaker.cap} auto-approvals this hour</span>
        </div>
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
