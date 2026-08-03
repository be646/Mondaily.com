import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Clock, DollarSign, GitBranch, Trophy, Sparkles, Users, LayoutGrid } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { CommandPageHeader } from "../../components/ui/controls";
import { KPITile } from "../../components/ui/kpi";
import { PeriodSelector } from "../../components/ui/period-selector";
import { PeriodNav, usePeriodOffset } from "../../components/ui/period-nav";
import { usePeriod, periodRange, previousRange, inRange, deltaPct, periodLabel, type DateRange } from "../../lib/period";
import { useResolvedPeriod } from "../../lib/period-bounds";
import { useCurrency, formatMoney } from "../../hooks/useCurrency";
import { isOutstanding } from "@mondaily/shared/finance";

interface Invoice { id: string; total: number; currency: string; status: string; paid_at?: string | null; created_at: string }
interface CreditNote { amount_cents: number; currency: string; status: string; updated_at?: string; created_at?: string }
interface Expense { amount_cents: number; currency: string; status: string; date?: string; created_at?: string }
interface DealNode { id: string; data: Record<string, unknown>; created_at: string; updated_at: string }

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isWon = (s: string) => /won|closed won|complete/i.test(s);
const isOpenStage = (s: string) => !/won|lost|closed/i.test(s);

function Delta({ pct, goodUp = true }: { pct: number | null; goodUp?: boolean }) {
  if (pct == null) return null;
  const positive = pct >= 0;
  const good = positive === goodUp;
  const color = pct === 0 ? "var(--text-faint)" : good ? "var(--status-ok)" : "var(--status-error)";
  const abs = Math.abs(pct);
  return <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>{positive ? "▲" : "▼"} {abs > 999 ? ">999" : abs}%</span>;
}

function KpiCard({ icon: Icon, tone, label, value, sub, delta, goodUp, onClick }: {
  icon: React.ElementType; tone: string; label: string; value: string; sub?: string;
  delta?: number | null; goodUp?: boolean; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`block rounded-sm border px-4 py-3 text-left transition-colors ${onClick ? "hover:border-[var(--border-strong)]" : "cursor-default"}`}
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      {/* Shared KPITile body — same recipe as the finance strips; the card adds click + delta. */}
      <KPITile icon={Icon as never} iconColor={tone} label={label} value={value} sub={sub}
        delta={<Delta pct={delta ?? null} goodUp={goodUp} />} />
    </button>
  );
}

export function InsightsPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = usePeriod("mondaily_insights_period", "month");
  const [periodOffset, setPeriodOffset] = usePeriodOffset(period);
  // Window resolved by the WORKSPACE (timezone + week start), not by this browser's clock.
  const { range, previous: prev, label: periodName, complete: periodComplete } = useResolvedPeriod(period, undefined, periodOffset);
  const scope = period === "all" ? "all time" : period === "today" ? "today" : `this ${periodLabel(period).toLowerCase()}`;
  const { display, sumInDisplay } = useCurrency();

  const invoicesQ = useQuery<Invoice[]>({ queryKey: ["insights-invoices"], queryFn: () => apiClient.get("/invoices") });
  const creditsQ  = useQuery<CreditNote[]>({ queryKey: ["insights-credits"], queryFn: () => apiClient.get("/credit-notes") });
  const expensesQ = useQuery<Expense[]>({ queryKey: ["insights-expenses"], queryFn: () => apiClient.get("/expenses") });
  const dealsQ    = useQuery<DealNode[]>({ queryKey: ["insights-deals"], queryFn: () => apiClient.get("/nodes?object_type=deals&limit=1000") });
  // Admin-only; fail-quiet (non-admins just don't see the agent card).
  const oversightQ = useQuery<{ totals?: { tokens: number; operators: number; active_sessions: number } }>({
    queryKey: ["insights-oversight", period], retry: false,
    queryFn: () => apiClient.get(`/activities/oversight-matrix?days=${period === "all" ? 365 : period === "today" ? 1 : period === "week" ? 7 : period === "quarter" ? 90 : period === "year" ? 365 : 30}`),
  });

  const invoices = invoicesQ.data ?? [];
  const credits = creditsQ.data ?? [];
  const expenses = expensesQ.data ?? [];
  const deals = dealsQ.data ?? [];

  const inv$ = (i: Invoice) => ({ amount: i.total, currency: i.currency });
  const revenueIn = (r: DateRange) => sumInDisplay(invoices.filter(i => i.status === "paid" && inRange(i.paid_at ?? i.created_at, r)).map(inv$)).value;
  const creditsIn = (r: DateRange) => sumInDisplay(credits.filter(c => c.status === "executed" && inRange(c.updated_at ?? c.created_at, r)).map(c => ({ amount: c.amount_cents / 100, currency: c.currency }))).value;
  const expensesIn = (r: DateRange) => sumInDisplay(expenses.filter(e => e.status === "approved" && inRange(e.date ?? e.created_at, r)).map(e => ({ amount: e.amount_cents / 100, currency: e.currency }))).value;
  const netIn = (r: DateRange) => revenueIn(r) - creditsIn(r) - expensesIn(r);

  const revenue = revenueIn(range);
  const net = netIn(range);
  const outstandingSum = sumInDisplay(invoices.filter(i => isOutstanding(i.status)).map(inv$));
  const outstanding = outstandingSum.value;
  // sumInDisplay adds unlike currencies at FACE VALUE when a rate is missing and reports it via
  // `missing`. Every caller here discarded it, so mixed-currency KPIs were shown as exact.
  const revenueSum = sumInDisplay(invoices.filter(i => i.status === "paid" && inRange(i.paid_at ?? i.created_at, range)).map(inv$));

  // Pipeline (as-of open value) + deals won (flow, by updated_at as the close proxy) + new deals (flow)
  // Deal values carry their own currency. These used to `reduce` the raw numbers with NO
  // conversion and then render through cur() — so a workspace with EUR and USD deals got one
  // symbol stamped on a raw EUR+USD sum. Route them through sumInDisplay like every other
  // money figure, and keep the `missing` flag so an unconvertible mix isn't shown as exact.
  const deal$ = (d: DealNode) => ({ amount: num(d.data.deal_value), currency: String(d.data.currency ?? "") || display });
  const pipelineSum = sumInDisplay(deals.filter(d => isOpenStage(String(d.data.deal_stage ?? "Lead"))).map(deal$));
  const pipelineValue = pipelineSum.value;
  const wonSum = (r: DateRange) => sumInDisplay(deals.filter(d => isWon(String(d.data.deal_stage ?? "")) && inRange(d.updated_at, r)).map(deal$));
  const wonIn = (r: DateRange) => wonSum(r).value;
  const newDealsIn = (r: DateRange) => deals.filter(d => inRange(d.created_at, r)).length;
  const dealsWon = wonIn(range);
  const unconverted = revenueSum.missing + outstandingSum.missing + pipelineSum.missing + wonSum(range).missing;
  const approx = (n: number) => (n > 0 ? "~" : "");

  const newDeals = newDealsIn(range);

  const aiCredits = oversightQ.data?.totals?.tokens ?? null;
  const activeMembers = oversightQ.data?.totals?.operators ?? null;

  // Deltas vs prior equivalent period
  const revDelta = prev ? deltaPct(revenue, revenueIn(prev)) : null;
  const netDelta = prev ? deltaPct(net, netIn(prev)) : null;
  const wonDelta = prev ? deltaPct(dealsWon, wonIn(prev)) : null;
  const newDealsDelta = prev ? deltaPct(newDeals, newDealsIn(prev)) : null;

  // Record counts by object (new this period) — from the deals we have + a light objects overview
  const objectsQ = useQuery<Array<{ slug: string; name_plural: string; icon?: string }>>({ queryKey: ["insights-objects"], queryFn: () => apiClient.get("/objects") });
  const objectSlugs = useMemo(() => (objectsQ.data ?? []).map(o => o.slug).filter(s => !["deals"].includes(s)).slice(0, 6), [objectsQ.data]);

  const loading = invoicesQ.isLoading || dealsQ.isLoading;
  const cur = (v: number) => formatMoney(v, display);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:px-6">
      <CommandPageHeader
        variant="bar"
        icon={LayoutGrid}
        callsign="INSIGHTS"
        title="Workspace Insights"
        subtitle="One cross-object view — finance, pipeline, and agents, on a single period lens."
        status={[{ label: "real data only", kind: "complete" }]}
        primaryAction={
          <div className="flex items-center gap-1.5">
            <PeriodSelector value={period} onChange={setPeriod} />
            <PeriodNav period={period} offset={periodOffset} onOffset={setPeriodOffset} serverLabel={periodName} complete={periodComplete} />
          </div>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="telemetry-strip h-[86px] animate-pulse" />)}</div>
      ) : (
        <>
          {/* Finance */}
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Finance · {scope}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <KpiCard icon={TrendingUp} tone="var(--status-ok)" label="Revenue" value={`${approx(revenueSum.missing)}${cur(revenue)}`} sub={`collected · ${scope}${revenueSum.missing > 0 ? ` · ${revenueSum.missing} unconverted` : ""}`} delta={revDelta} onClick={() => navigate("/finance/reports")} />
            <KpiCard icon={Clock} tone="var(--status-warn)" label="Outstanding" value={`${approx(outstandingSum.missing)}${cur(outstanding)}`} sub={`unpaid · as of today${outstandingSum.missing > 0 ? ` · ${outstandingSum.missing} unconverted` : ""}`} onClick={() => navigate("/finance/invoices")} />
            <KpiCard icon={DollarSign} tone="var(--text-faint)" label="Net" value={`${approx(unconverted)}${cur(net)}`} sub="after credits & expenses" delta={netDelta} onClick={() => navigate("/finance/reports")} />
          </div>

          {/* Pipeline + agents */}
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Pipeline &amp; agents · {scope}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <KpiCard icon={GitBranch} tone="var(--status-neutral)" label="Open pipeline" value={`${approx(pipelineSum.missing)}${cur(pipelineValue)}`} sub={`open deals · as of today${pipelineSum.missing > 0 ? ` · ${pipelineSum.missing} unconverted` : ""}`} onClick={() => navigate("/pipeline")} />
            <KpiCard icon={Trophy} tone="var(--status-ok)" label="Deals won" value={`${approx(wonSum(range).missing)}${cur(dealsWon)}`} sub={`${newDeals} new · ${scope}`} delta={wonDelta} onClick={() => navigate("/pipeline")} />
            {aiCredits != null ? (
              <KpiCard icon={Sparkles} tone="var(--section-accent)" label="AI credits used" value={aiCredits.toLocaleString()} sub={`${activeMembers ?? "—"} members · ${scope}`} onClick={() => navigate("/team/oversight")} />
            ) : (
              <KpiCard icon={GitBranch} tone="var(--status-neutral)" label="New deals" value={String(newDeals)} sub={scope} delta={newDealsDelta} onClick={() => navigate("/pipeline")} />
            )}
          </div>

          {/* Records by object */}
          {objectSlugs.length > 0 && (
            <>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Records</p>
              <div className="flex flex-wrap gap-2">
                {(objectsQ.data ?? []).filter(o => objectSlugs.includes(o.slug)).map(o => (
                  <button key={o.slug} onClick={() => navigate(`/objects/${o.slug}`)}
                    className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] transition-colors hover:border-[var(--border-strong)]"
                    style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                    <LayoutGrid size={12} className="text-[var(--text-faint)]" /> {o.name_plural}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
