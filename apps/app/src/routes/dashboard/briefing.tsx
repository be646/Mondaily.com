import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Sparkles, ShieldCheck, Clock, Receipt, CheckSquare, TrendingUp, GitBranch, Trophy, ArrowRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { PageSkeleton, ErrorState } from "../../components/ui/page-state";
import { formatMoney } from "../../hooks/useCurrency";

interface Brief {
  base: string;
  needs_you: { pending: number; high_risk: number; overdue_tasks: number; overdue_invoices: { count: number; total: number } };
  handled: { auto_approved_today: number };
  pulse: { revenue_month: number; outstanding: number; open_pipeline: number; new_deals_week: number };
  top_decisions: { id: string; title: string; risk: string; agent: string }[];
}

const RISK_TONE: Record<string, string> = { high: "#d1524a", medium: "#c6892e", low: "#717784" };

export function BriefingPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery<Brief>({
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

  const pulse = [
    { icon: TrendingUp, tone: "#2f9e6b", label: "Revenue", value: cur(data.pulse.revenue_month), sub: "collected this month" },
    { icon: Clock, tone: "#c6892e", label: "Outstanding", value: cur(data.pulse.outstanding), sub: "unpaid, as of today" },
    { icon: GitBranch, tone: "#717784", label: "Open pipeline", value: cur(data.pulse.open_pipeline), sub: `${data.pulse.new_deals_week} new this week` },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <CommandPageHeader
        icon={Sparkles}
        callsign="DAILY BRIEF"
        title={`${greeting} — here's your brief`}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        status={[{ label: "real data only", kind: "complete" }]}
        primaryAction={<button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>Refresh</button>}
      />

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

      {/* Pulse */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Workspace pulse</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {pulse.map(p => (
          <div key={p.label} className="rounded-sm border px-4 py-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
            <div className="mb-1.5 flex items-center gap-1.5"><p.icon size={12} style={{ color: p.tone }} /><span className="text-[11px] text-[var(--text-muted)]">{p.label}</span></div>
            <div className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">{p.value}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{p.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
