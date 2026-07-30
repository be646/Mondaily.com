import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Sparkles, ShieldCheck, Receipt, CheckSquare, Trophy, ArrowRight, RefreshCw } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { PageSkeleton, ErrorState } from "../../components/ui/page-state";
import { formatMoney } from "../../hooks/useCurrency";

interface Brief {
  base: string;
  needs_you: { pending: number; high_risk: number; overdue_tasks: number; overdue_invoices: { count: number; total: number } };
  handled: { auto_approved_today: number };
  money?: {
    closed_won: { value: number; count: number; delta: number | null };
    cash: { collected: number; invoiced: number; delta: number | null };
    pipeline_created: { value: number; count: number; delta: number | null };
    forecast: { value: number; open_count: number; open_value: number };
    closers: { owner: string; count: number; value: number }[];
    overdue_aging: { bucket: string; count: number; total: number }[];
  };
  pulse: { revenue_month: number; outstanding: number; open_pipeline: number; new_deals_week: number };
  top_decisions: { id: string; title: string; risk: string; agent: string }[];
}

/** Month-over-month delta pill — same-point comparison, so mid-month never reads as a collapse. */
function DeltaPill({ delta }: { delta: number | null | undefined }) {
  if (delta === undefined) return null;   // metric has no comparison by design (forecast)
  if (delta === null) return <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>first month</span>;
  const up = delta >= 0;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums"
      style={{ color: up ? "#2f9e6b" : "#d1524a", background: up ? "rgba(47,158,107,.1)" : "rgba(209,82,74,.1)" }}>
      {up ? "▲" : "▼"} {Math.abs(delta)}%
    </span>
  );
}

const RISK_TONE: Record<string, string> = { high: "#d1524a", medium: "#c6892e", low: "#717784" };

export function BriefingPage() {
  const navigate = useNavigate();
  const cos = useQuery<{ priorities: { title: string; why: string; action: string; decision_id: string | null; agent_name: string | null }[]; count: number }>({
    queryKey: ["chief-of-staff"], queryFn: () => apiClient.get("/decisions/chief-of-staff"), staleTime: 120_000, retry: false,
  });
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Brief>({
    queryKey: ["briefing"], queryFn: () => apiClient.get<Brief>("/briefing"), staleTime: 60_000,
  });

  if (isLoading) return <div className="mx-auto max-w-4xl px-6 py-8"><PageSkeleton label="Preparing your brief…" /></div>;
  if (isError || !data) return <div className="mx-auto max-w-4xl px-6 py-8"><ErrorState error={new Error("Couldn't load your brief.")} onRetry={() => refetch()} /></div>;

  const cur = (v: number) => formatMoney(v, data.base);
  const ny = data.needs_you;
  const needsAnything = ny.pending > 0 || ny.overdue_tasks > 0 || ny.overdue_invoices.count > 0;
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; })();

  // "Needs you" action cards — only the ones that actually have something.
  const attention = [
    ny.pending > 0 ? { icon: ShieldCheck, tone: ny.high_risk > 0 ? "#d1524a" : "#c6892e", label: `${ny.pending} decision${ny.pending === 1 ? "" : "s"} to review`, sub: ny.high_risk > 0 ? `${ny.high_risk} high-risk` : "awaiting your approval", to: "/decisions" } : null,
    ny.overdue_invoices.count > 0 ? { icon: Receipt, tone: "#d1524a", label: `${ny.overdue_invoices.count} invoice${ny.overdue_invoices.count === 1 ? "" : "s"} overdue`, sub: cur(ny.overdue_invoices.total), to: "/finance/invoices" } : null,
    ny.overdue_tasks > 0 ? { icon: CheckSquare, tone: "#c6892e", label: `${ny.overdue_tasks} overdue task${ny.overdue_tasks === 1 ? "" : "s"}`, sub: "past their due date", to: "/tasks" } : null,
  ].filter(Boolean) as { icon: React.ElementType; tone: string; label: string; sub: string; to: string }[];

  // The four numbers the page exists for — month-to-date, each vs the same point last month.
  const m = data.money;
  const lead: { label: string; value: string; delta: number | null | undefined; sub: string }[] = m ? [
    { label: "Closed won", value: cur(m.closed_won.value), delta: m.closed_won.delta, sub: `${m.closed_won.count} deal${m.closed_won.count === 1 ? "" : "s"} this month` },
    { label: "Cash collected", value: cur(m.cash.collected), delta: m.cash.delta, sub: `${cur(m.cash.invoiced)} invoiced · ${cur(data.pulse.outstanding)} outstanding` },
    { label: "Pipeline created", value: cur(m.pipeline_created.value), delta: m.pipeline_created.delta, sub: `${m.pipeline_created.count} new deal${m.pipeline_created.count === 1 ? "" : "s"}` },
    { label: "Forecast", value: cur(m.forecast.value), delta: undefined as number | null | undefined, sub: `weighted, over ${m.forecast.open_count} open (${cur(m.forecast.open_value)})` },
  ] : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <CommandPageHeader
        icon={Sparkles}
        callsign="DAILY BRIEF"
        title={`${greeting} — here's your brief`}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        status={[{ label: "real data only", kind: "complete" }]}
        primaryAction={<button onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-60" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><RefreshCw size={11} className={isFetching ? "animate-spin" : ""} /> {isFetching ? "Refreshing…" : "Refresh"}</button>}
      />

      {/* THE MONEY ROW — the four numbers this page exists for. Big numerals, same-point
          month-over-month deltas, everything else on the page ranks below this. */}
      {lead.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {lead.map(t => (
            <div key={t.label} className="rounded-sm border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--text-muted)]">{t.label}</span>
                <DeltaPill delta={t.delta} />
              </div>
              <div className="mt-1 text-[24px] font-semibold tracking-tight tabular-nums text-[var(--text-primary)]">{t.value}</div>
              <div className="mt-0.5 truncate text-[10.5px] text-[var(--text-faint)]">{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Who closed — the table an owner actually reads. Only renders when someone did. */}
      {(m?.closers.length ?? 0) > 0 && (
        <div className="mb-6 overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: "var(--border-soft)" }}>
            <Trophy size={12} style={{ color: "#c6892e" }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Who closed this month</span>
          </div>
          {m!.closers.map(cl => (
            <div key={cl.owner} className="flex items-center justify-between border-b px-4 py-2 text-[12.5px] last:border-0" style={{ borderColor: "var(--border-soft)" }}>
              <span style={{ color: "var(--text-primary)" }}>{cl.owner}</span>
              <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{cl.count} deal{cl.count === 1 ? "" : "s"} · <strong style={{ color: "var(--text-primary)" }}>{cur(cl.value)}</strong></span>
            </div>
          ))}
        </div>
      )}

      {/* Chief of Staff — the meta-agent's top-3 priorities, reasoned across every agent's queue. */}
      {(cos.data?.priorities?.length ?? 0) > 0 && (
        <div className="mb-6 overflow-hidden rounded-sm border" style={{ borderColor: "var(--section-accent-line)", background: "var(--section-accent-soft)" }}>
          <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--section-accent-line)" }}>
            <Sparkles size={13} style={{ color: "var(--section-accent)" }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--section-accent)" }}>Chief of Staff · what needs you most</span>
          </div>
          {cos.data!.priorities.map((p, i) => (
            <button key={i} onClick={() => navigate(p.decision_id ? `/decisions?id=${p.decision_id}` : "/decisions")}
              className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)" }}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold tabular-nums" style={{ background: "var(--section-accent)", color: "var(--surface-page)" }}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{p.title}</p>
                {p.why && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>{p.why}</p>}
                {p.action && <p className="mt-1 text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>→ {p.action}</p>}
              </div>
              <ArrowRight size={13} className="mt-1 shrink-0" style={{ color: "var(--text-faint)" }} />
            </button>
          ))}
        </div>
      )}

      {/* What agents handled for you */}
      {data.handled.auto_approved_today > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-sm border px-4 py-2.5 text-[12.5px]" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 5%, transparent)", color: "var(--text-secondary)" }}>
          <Sparkles size={13} style={{ color: "var(--section-accent)" }} />
          Your agents auto-handled <strong style={{ color: "var(--text-primary)" }}>{data.handled.auto_approved_today}</strong> low-risk decision{data.handled.auto_approved_today === 1 ? "" : "s"} today — no action needed.
        </div>
      )}

      {/* Needs you */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Needs you</p>
      {needsAnything ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          {attention.map((a, i) => (
            <button key={i} onClick={() => navigate(a.to)} className="block rounded-sm border px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
              <div className="mb-1.5 flex items-center gap-1.5"><a.icon size={12} style={{ color: a.tone }} /><span className="text-[11px] text-[var(--text-muted)]">{a.label}</span></div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{a.sub}</span>
                <ArrowRight size={13} className="text-[var(--text-faint)]" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-8 flex items-center gap-2 rounded-sm border px-4 py-3 text-[12.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          <CheckSquare size={14} style={{ color: "#2f9e6b" }} /> You're all caught up — nothing needs your attention right now.
        </div>
      )}

      {/* Top decisions */}
      {data.top_decisions.length > 0 && (
        <>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Top of your queue</p>
          <div className="mb-8 overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            {data.top_decisions.map(d => (
              <button key={d.id} onClick={() => navigate(`/decisions?id=${d.id}`)} className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)" }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RISK_TONE[d.risk] ?? "#717784" }} />
                <span className="flex-1 truncate text-[12.5px]" style={{ color: "var(--text-primary)" }}>{d.title}</span>
                <span className="text-[10.5px] capitalize" style={{ color: "var(--text-faint)" }}>{String(d.agent).replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* The old "Workspace pulse" tiles are gone — the money row at the top supersedes them
          (revenue → Cash collected, outstanding → its sub-line, open pipeline → Forecast). */}
    </div>
  );
}
