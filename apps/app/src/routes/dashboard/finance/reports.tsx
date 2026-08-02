import { useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { useCurrency, formatMoney, convertAmount } from "../../../hooks/useCurrency";
import { FieldSelect } from "../../../components/ui/controls";
import { PeriodSelector } from "../../../components/ui/period-selector";
import { compareWindows } from "@mondaily/shared/baseline";
import { isBilled, isCollected, isOutstanding, moneyEventDate } from "@mondaily/shared/finance";
import { sumInBase, currencyBreakdown } from "@mondaily/shared/money";
import { KPIGrid, KPITile } from "../../../components/ui/kpi";
import { FinanceHeader } from "../../../components/finance/finance-toolbar";
import { usePeriod, periodRange, previousRange, inRange, deltaPct, periodLabel, type DateRange, type CustomRange } from "../../../lib/period";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, DollarSign, Clock, MinusCircle, FileText, ReceiptText, BarChart2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { EmptyState } from "../../../components/ui/page-state";

type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "cancelled";

interface Invoice {
  id: string;
  number: string;
  client_name: string;
  total: number;
  subtotal: number;
  tax_total: number;
  currency: string;
  status: InvoiceStatus;
  created_at: string;
  paid_at?: string | null;
}

interface CreditNote {
  id: string;
  amount_cents: number;
  currency: string;
  credit_reason: "refund" | "billing_error" | "goodwill" | "contract_discount";
  status: string;
  updated_at?: string;
  created_at?: string;
}

function getLastNMonths(n: number) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
    });
  }
  return months;
}

/** Identity colours for the currency mix — a currency is not a status. */
const SHARE_COLORS = ["var(--section-accent)", "#717784", "#c6892e", "#2f9e6b", "#8b7ec8", "#d1524a"];

function fmt(amount: number, currency: string) {
  return formatMoney(amount, currency);
}

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface-modal)",
    border: "1px solid var(--border-soft)",
    borderRadius: "8px",
    fontSize: "11px",
    color: "var(--text-secondary)",
  },
  labelStyle: { color: "var(--text-primary)", fontWeight: 600 },
};

const STATUS_ORDER: InvoiceStatus[] = ["draft", "sent", "viewed", "paid", "overdue", "cancelled"];
const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", viewed: "Viewed", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};
const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "text-stone-500 dark:text-stone-500",
  sent: "text-stone-700 dark:text-stone-300",
  viewed: "text-stone-700 dark:text-stone-300",
  paid: "text-[#2f9e6b]",
  overdue: "text-[#c6892e]",
  cancelled: "text-stone-400 dark:text-stone-600",
};

const REASON_LABELS: Record<string, string> = {
  refund: "Refund",
  billing_error: "Billing Error",
  goodwill: "Goodwill",
  contract_discount: "Contract Discount",
};

// Period-over-period delta pill. `goodUp` flips the colour for cost-type metrics (where a
// rise is bad). Neutral grey when there's no comparable prior period.
function Delta({ pct, goodUp = true }: { pct: number | null; goodUp?: boolean }) {
  // pct arrives pre-computed from real window sums; the >999 display cap matches the shared
  // baseline engine's maxPct so every surface caps identically.
  if (pct == null) return null;
  const positive = pct >= 0;
  const good = positive === goodUp;
  const color = pct === 0 ? "var(--text-faint)" : good ? "#2f9e6b" : "#d1524a";
  const abs = Math.abs(pct);
  return (
    <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>
      {positive ? "▲" : "▼"} {abs > 999 ? ">999" : abs}%
    </span>
  );
}

export function FinanceReportsPage() {
  const navigate = useNavigate();
  const { data: invoices = [], isError: invoicesError, refetch: refetchInvoices } = useQuery<Invoice[]>({
    queryKey: ["invoices-all"],
    queryFn: () => apiClient.get<Invoice[]>("/invoices"),
  });

  const { data: creditNotes = [] } = useQuery<CreditNote[]>({
    queryKey: ["credit-notes-all"],
    queryFn: () => apiClient.get<CreditNote[]>("/credit-notes"),
  });

  const { data: expenses = [] } = useQuery<{ amount_cents: number; currency: string; status: string; date?: string; created_at?: string }[]>({
    queryKey: ["expenses-all"],
    queryFn: () => apiClient.get("/expenses"),
  });

  const { data: quotes = [] } = useQuery<{ id: string; status: string; created_at: string }[]>({
    queryKey: ["quotes-all"],
    queryFn: () => apiClient.get("/quotes"),
  });

  // Page-level finance report context for the right-side Ask AI drawer.
  useEffect(() => {
    useAskContextStore.getState().setContext({
      report_title: "Finance report",
      route: "/finance/reports",
      scope_label: "the Finance report",
    });
    return () => useAskContextStore.getState().setContext(null);
  }, []);

  // All money is normalized to the caller's DISPLAY currency via sovereign ECB rates, so
  // mixed-currency invoices (EUR/USD/GBP…) sum honestly instead of being mislabeled as one.
  const { display, currencies, ratesAsOf, hasRates, setDisplay, sumInDisplay, rates } = useCurrency();
  const currency = display;
  const inv$ = (i: Invoice) => ({ amount: i.total, currency: i.currency });
  const cn$ = (cn: CreditNote) => ({ amount: cn.amount_cents / 100, currency: cn.currency });
  const exp$ = (e: { amount_cents: number; currency: string }) => ({ amount: e.amount_cents / 100, currency: e.currency });

  // ── Reporting period (cumulative ledger, period-scoped LENS) ──
  // FLOW metrics (revenue collected, credits issued, expenses) are counted within the range on
  // their real event date; BALANCE metrics (outstanding) are read as-of and ignore the range.
  const [period, setPeriod] = usePeriod("mondaily_finance_period");
  const [customRange, setCustomRange] = useState<CustomRange>({});
  const range = periodRange(period, new Date(), customRange);
  const prev = previousRange(period);
  const periodScope = period === "all" ? "all time"
    : period === "custom" ? "selected range"
    : period === "today" ? "today"
    : `this ${periodLabel(period).toLowerCase()}`;
  const paidDate = (i: Invoice) => i.paid_at ?? i.created_at;               // when cash actually landed
  const cnDate = (cn: CreditNote) => cn.updated_at ?? cn.created_at ?? "";  // when it was executed
  const expDate = (e: { date?: string; created_at?: string }) => e.date ?? e.created_at ?? "";

  // Totals come from each record's FROZEN base value where it has one, so a figure computed today
  // and the same figure computed next year agree. Records predating the money model have no frozen
  // value and are converted at today's rate — counted separately, and disclosed below, because a
  // total mixing frozen and live figures is not wrong but must not pretend to be uniform.
  //
  // sumInBase also refuses to add an unconvertible amount at face value. sumInDisplay adds it raw,
  // which is how 1,000 PLN could land in a USD total as "1,000".
  const inBase = useCallback(
    (rows: Record<string, unknown>[]) => sumInBase(rows, {
      base: display,
      convertNow: (amount, from) => convertAmount(amount, from, display, rates),
    }),
    [display, rates],
  );
  const revenueIn = (r: DateRange) => inBase(invoices.filter(i => isCollected(i.status) && inRange(paidDate(i), r)) as unknown as Record<string, unknown>[]).value;
  const creditsIn = (r: DateRange) => inBase(creditNotes.filter(cn => cn.status === "executed" && inRange(cnDate(cn), r)) as unknown as Record<string, unknown>[]).value;
  const expensesIn = (r: DateRange) => inBase(expenses.filter(e => e.status === "approved" && inRange(expDate(e), r)) as unknown as Record<string, unknown>[]).value;

  const totalRevenue = revenueIn(range);
  const creditsIssued = creditsIn(range);
  const totalExpenses = expensesIn(range);
  const netRevenue = totalRevenue - creditsIssued - totalExpenses;
  // Outstanding is a point-in-time balance, not a period flow — always current.
  const outstanding = inBase(invoices.filter(i => isOutstanding(i.status)) as unknown as Record<string, unknown>[]).value;

  // Period-over-period deltas (null when there's no comparable prior window — e.g. "All").
  const revDelta = prev ? deltaPct(totalRevenue, revenueIn(prev)) : null;
  const creditsDelta = prev ? deltaPct(creditsIssued, creditsIn(prev)) : null;
  const expDelta = prev ? deltaPct(totalExpenses, expensesIn(prev)) : null;
  const netDelta = prev ? deltaPct(netRevenue, revenueIn(prev) - creditsIn(prev) - expensesIn(prev)) : null;

  // How many amounts couldn't be converted (missing rate) — surfaced honestly to the user.
  const allMoneyRows = [...invoices, ...creditNotes, ...expenses] as unknown as Record<string, unknown>[];
  const moneyQuality = inBase(allMoneyRows);
  const unconverted = moneyQuality.unconvertible;
  const mixedCurrency = new Set([...invoices.map(i => i.currency), ...creditNotes.map(c => c.currency)]).size > 1;

  // What share of the money was actually charged in each currency, ranked by BASE value — 1,000 JPY
  // is not the same size as 1,000 GBP, and ranking by the printed number would say otherwise.
  const breakdown = useMemo(
    () => currencyBreakdown(allMoneyRows, {
      base: display,
      convertNow: (amount, from) => convertAmount(amount, from, display, rates),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, creditNotes, expenses, display, rates],
  );

  // Monthly chart data. Two corrections (measured on live data 2026-08-02):
  //  • Billed counted DRAFT and CANCELLED invoices, while the server's own rollup excludes them
  //    ("a draft or cancelled invoice was never billed to the client"). Same word, two numbers.
  //  • Collected was bucketed by created_at, so a June invoice paid in July counted as June cash —
  //    £95,801 of July receipts, 93% of the period's money, sat in the wrong bar.
  const months = getLastNMonths(6);
  const monthlyData = months.map(m => {
    const billedInMonth = invoices.filter(i => isBilled(i.status) && i.created_at.slice(0, 7) === m.key);
    const collectedInMonth = invoices.filter(i => isCollected(i.status) && moneyEventDate(i).slice(0, 7) === m.key);
    const billed = sumInDisplay(billedInMonth.map(inv$)).value;
    const collected = sumInDisplay(collectedInMonth.map(inv$)).value;
    return { name: m.label, Billed: Math.round(billed * 100) / 100, Collected: Math.round(collected * 100) / 100 };
  });

  // Top clients — same billing definition as the server rollup and the chart above. Counting
  // drafts here inflated both what a client had been billed and, through billed − paid, what they
  // still owed; a client with an unsent draft appeared to be in arrears.
  const clientMap: Record<string, { billed: number; paid: number; outstanding: number; count: number }> = {};
  for (const inv of invoices) {
    const entry = (clientMap[inv.client_name] ??= { billed: 0, paid: 0, outstanding: 0, count: 0 });
    const amount = sumInDisplay([inv$(inv)]).value;
    if (isBilled(inv.status)) entry.billed += amount;
    if (isCollected(inv.status)) entry.paid += amount;
    if (isOutstanding(inv.status)) entry.outstanding += amount;
    entry.count++;   // every document, so the count still reflects the whole relationship
  }
  const topClients = Object.entries(clientMap)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.billed - a.billed)
    .slice(0, 8);

  // Status breakdown
  const statusBreakdown = STATUS_ORDER.map(s => ({
    status: s,
    count: invoices.filter(i => i.status === s).length,
    total: sumInDisplay(invoices.filter(i => i.status === s).map(inv$)).value,
  })).filter(s => s.count > 0);

  // Credit note impact by reason
  const reasonMap: Record<string, number> = {};
  for (const cn of creditNotes.filter(cn => cn.status === "executed")) {
    reasonMap[cn.credit_reason] = (reasonMap[cn.credit_reason] ?? 0) + sumInDisplay([cn$(cn)]).value;
  }

  // Finance Agent digest — proactive signals computed from REAL data (no AI/credits needed):
  // overdue invoices, quotes gone cold (sent > 14 days ago, still open), and the month-over-month
  // cash direction from the collected series.
  const overdueInvoices = invoices.filter(i => i.status === "overdue");
  const overdueTotal = sumInDisplay(overdueInvoices.map(inv$)).value;
  const COLD_DAYS = 14;
  const coldQuotes = quotes.filter(q => q.status === "sent" && (Date.now() - Date.parse(q.created_at)) > COLD_DAYS * 86_400_000);
  // Cash trend on the SAME paid-date basis as the KPI cards (revenue actually collected this
  // calendar month vs last), so the digest never contradicts the Revenue delta above it.
  const cashCmp = compareWindows(Math.round(revenueIn(periodRange("month"))), Math.round((() => { const p = previousRange("month"); return p ? revenueIn(p) : 0; })()), { minBase: 100 });
  const digestSignals = [
    overdueInvoices.length > 0 ? { tone: "#d1524a", text: `${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? "" : "s"} overdue`, sub: fmt(overdueTotal, currency), to: "/finance/invoices" } : null,
    coldQuotes.length > 0 ? { tone: "#c6892e", text: `${coldQuotes.length} quote${coldQuotes.length === 1 ? "" : "s"} gone cold`, sub: `sent > ${COLD_DAYS}d ago`, to: "/finance/quotes" } : null,
    // Honest memo line via the baseline engine: a % only against a real baseline; otherwise the
    // truthful words ("first collections this month" / raw comparison), never a wild MoM figure.
    cashCmp.kind === "pct" ? { tone: cashCmp.direction >= 0 ? "#2f9e6b" : "#c6892e", text: `Cash ${cashCmp.direction >= 0 ? "up" : "down"} ${cashCmp.label} MoM`, sub: "vs same point last month", to: undefined }
      : cashCmp.kind === "new" ? { tone: "#2f9e6b", text: "First collections this month", sub: "no baseline last month", to: undefined }
      : cashCmp.kind === "raw" ? { tone: cashCmp.direction >= 0 ? "#2f9e6b" : "#c6892e", text: `Cash ${cashCmp.now.toLocaleString()} vs ${cashCmp.prev.toLocaleString()} last month`, sub: "baseline too small for a %", to: undefined }
      : null,
  ].filter(Boolean) as { tone: string; text: string; sub: string; to?: string }[];

  return (
    <div className="flex h-full flex-col bg-[var(--surface-card)] text-[var(--text-primary)]">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader icon={BarChart2} callsign="FINANCE" title="Finance Reports"
          subtitle={<>Revenue overview, client breakdown and credit analysis{mixedCurrency && (<> · shown in <span className="font-medium text-[var(--text-secondary)]">{display}</span>{hasRates && ratesAsOf ? <> at ECB rate, {new Date(ratesAsOf).toLocaleDateString()}</> : ""}</>)}</>}
          action={
            <>
              <PeriodSelector value={period} onChange={setPeriod} custom={customRange} onCustom={setCustomRange} />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-muted)]">Show in</span>
                <div className="w-28">
                  <FieldSelect value={display} onChange={v => setDisplay.mutate(v)} ariaLabel="Display currency"
                    options={currencies.map(c => ({ value: c, label: c }))} />
                </div>
              </div>
            </>
          }
        />
      </div>
      {mixedCurrency && !hasRates && (
        <div className="border-b border-[var(--border-soft)] px-6 py-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          Invoices span multiple currencies, but no FX rates are loaded yet — amounts are shown at face value and are not comparable. Once daily rates sync, totals convert to {display} automatically.
        </div>
      )}
      {mixedCurrency && hasRates && unconverted > 0 && (
        <div className="border-b border-[var(--border-soft)] px-6 py-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          {unconverted} amount{unconverted === 1 ? "" : "s"} couldn't be converted to {display} (no rate for that currency) and are included at face value.
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">

          {/* Finance Agent digest — proactive, data-derived signals (no AI credits needed). */}
          {digestSignals.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border px-4 py-2.5" style={{ borderColor: "var(--section-accent-line)", background: "color-mix(in srgb, var(--section-accent) 4%, transparent)" }}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--section-accent)" }}>
                <LogoMark size={12}/> Finance Agent
              </div>
              {digestSignals.map((s, i) => (
                <button key={i} onClick={() => s.to && navigate(s.to)} disabled={!s.to}
                  className={`flex items-center gap-1.5 text-[12px] ${s.to ? "hover:underline" : "cursor-default"}`}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.tone }}/>
                  <span style={{ color: "var(--text-primary)" }}>{s.text}</span>
                  <span style={{ color: "var(--text-faint)" }}>· {s.sub}</span>
                </button>
              ))}
            </div>
          )}

          {/* If the invoice data failed to load, an all-zeros report would be misleading — say so. */}
          {invoicesError && (
            <div className="flex items-center justify-between rounded-sm border px-4 py-2.5 text-[12px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
              Couldn't load invoice data — the numbers below may be incomplete.
              <button onClick={() => refetchInvoices()} className="underline">Retry</button>
            </div>
          )}

          {/* A dashboard of zeros reads as broken — when there's genuinely no finance data yet,
              guide instead. The full dashboard renders the moment a single invoice/credit exists. */}
          {!invoicesError && invoices.length === 0 && creditNotes.length === 0 && (
            <EmptyState
              icon={BarChart2}
              title="No finance data yet"
              description="Revenue, client breakdown, and credit analysis compute live from your invoices and credit notes — the full dashboard appears with your first document."
              steps={[
                { icon: FileText, label: "Create your first invoice", hint: "Draft, send, and track payment — this report updates instantly.", onClick: () => navigate("/finance") },
                { icon: ReceiptText, label: "Draft a quote", hint: "Quotes convert to invoices when accepted, feeding revenue here.", onClick: () => navigate("/finance/quotes") },
              ]}
            />
          )}

          {/* Summary cards */}
          <KPIGrid>
            <KPITile icon={TrendingUp} iconColor="#2f9e6b" label="Revenue"
              value={fmt(totalRevenue, currency)} delta={<Delta pct={revDelta}/>}
              sub={<>collected · {periodScope}</>} />
            <KPITile icon={Clock} iconColor="#c6892e" label="Outstanding"
              value={fmt(outstanding, currency)} sub="unpaid · as of today" />
            <KPITile icon={MinusCircle} iconColor="var(--text-faint)" label="Credits Issued"
              value={fmt(creditsIssued, currency)} delta={<Delta pct={creditsDelta} goodUp={false}/>}
              sub={<>executed · {periodScope}</>} />
            <KPITile icon={MinusCircle} iconColor="#c6892e" label="Expenses"
              value={fmt(totalExpenses, currency)} delta={<Delta pct={expDelta} goodUp={false}/>}
              sub={<>approved · {periodScope}</>} />
            <KPITile icon={DollarSign} iconColor="var(--text-faint)" label="Net"
              valueColor={netRevenue >= 0 ? undefined : "#c6892e"}
              value={fmt(netRevenue, currency)} delta={<Delta pct={netDelta}/>}
              sub={<>after credits &amp; expenses</>} />
          </KPIGrid>

          {/* Currency mix — share of value by the currency money was actually charged in. */}
          {breakdown.shares.length > 0 && (
            <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-4">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium tracking-tight text-[var(--text-primary)]">Currency mix</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Share of {fmt(breakdown.total, currency)} by the currency charged
                  </div>
                </div>
                {/* Frozen vs live is the one thing a reader cannot infer from the numbers. */}
                {moneyQuality.live > 0 && (
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}
                    title={`${moneyQuality.modelled} record(s) hold a rate fixed at their transaction date. ${moneyQuality.live} predate that and are converted at today's rate, so their contribution moves with the market.`}>
                    {moneyQuality.modelled} fixed · {moneyQuality.live} at today’s rate
                  </span>
                )}
              </div>

              <div className="flex h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-hover)" }}>
                {breakdown.shares.map((s, i) => (
                  <div key={s.currency} title={`${s.currency} — ${fmt(s.base_value, currency)} (${s.count} document${s.count === 1 ? "" : "s"})`}
                    style={{
                      width: `${s.pct}%`,
                      background: SHARE_COLORS[i % SHARE_COLORS.length],
                    }}/>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {breakdown.shares.map((s, i) => (
                  <span key={s.currency} className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums"
                    title={`${s.count} document${s.count === 1 ? "" : "s"} · ${fmt(s.base_value, currency)}`}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }}/>
                    <span style={{ color: "var(--text-primary)" }}>{s.pct}%</span>
                    <span style={{ color: "var(--text-muted)" }}>{s.currency}</span>
                  </span>
                ))}
                {breakdown.unconvertible > 0 && (
                  <span className="font-mono text-[11px]" style={{ color: "var(--status-warn)" }}
                    title="No exchange rate is stored for these, so they are excluded from the mix rather than counted at face value.">
                    {breakdown.unconvertible} unconvertible
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Revenue by month chart */}
          <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-4">
            <div className="mb-4">
              <div className="text-[13px] font-medium tracking-tight text-[var(--text-primary)]">Revenue by Month</div>
              <div className="text-[11px] text-[var(--text-muted)]">Last 6 months — billed vs collected</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barCategoryGap="30%" barGap={3}>
                <XAxis dataKey="name" tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill: "var(--text-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={60}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}/>
                <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "var(--surface-hover)", opacity: 0.5 }} formatter={(v: number) => fmt(v, currency)}/>
                <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-muted)" }}/>
                <Bar dataKey="Billed" fill="var(--text-muted)" radius={[0, 0, 0, 0]}/>
                <Bar dataKey="Collected" fill="var(--text-primary)" radius={[0, 0, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top clients + Status breakdown */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top clients */}
            <div className="overflow-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)]">
              <div className="border-b border-[var(--border-soft)] px-4 py-3">
                <div className="text-[12px] font-medium tracking-tight text-[var(--text-primary)]">Top Clients</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">by total billed</div>
              </div>
              {topClients.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No invoice data</div>
              ) : (
                /* Numbers right-aligned + nowrap + tight padding so wide currency values never clip
                   against the card edge; the low-value count column is dropped so money always fits. */
                <table className="minimal-table w-full">
                  <thead>
                    <tr>
                      <th className="!px-3 !py-2 text-left text-[10px] font-medium">Client</th>
                      <th className="!px-2 !py-2 text-right text-[10px] font-medium">Billed</th>
                      <th className="!px-2 !py-2 text-right text-[10px] font-medium">Paid</th>
                      <th className="!px-3 !py-2 text-right text-[10px] font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topClients.map(c => (
                      <tr key={c.name}>
                        <td className="max-w-[120px] truncate !px-3 !py-2.5 text-[11px] font-medium text-[var(--text-primary)]">{c.name}</td>
                        <td className="!px-2 !py-2.5 text-right text-[11px] tabular-nums whitespace-nowrap text-[var(--text-secondary)]">{fmt(c.billed, currency)}</td>
                        <td className="!px-2 !py-2.5 text-right text-[11px] tabular-nums whitespace-nowrap text-[var(--text-secondary)]">{fmt(c.paid, currency)}</td>
                        <td className="!px-3 !py-2.5 text-right text-[11px] tabular-nums whitespace-nowrap text-[#c6892e]">{fmt(c.outstanding, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Status breakdown + credit note impact */}
            <div className="space-y-4">
              <div className="overflow-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)]">
                <div className="border-b border-[var(--border-soft)] px-4 py-3">
                  <div className="text-[12px] font-medium tracking-tight text-[var(--text-primary)]">Invoice Status Breakdown</div>
                </div>
                <div className="divide-y divide-stone-200 px-4 py-1 dark:divide-stone-800">
                  {statusBreakdown.length === 0 ? (
                    <div className="py-3 text-center text-[12px] text-[var(--text-muted)]">No invoices yet</div>
                  ) : statusBreakdown.map(s => (
                    <div key={s.status} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium ${STATUS_COLORS[s.status]}`}>{STATUS_LABELS[s.status]}</span>
                        <span className="text-[10px] text-[var(--text-faint)]">{s.count} invoice{s.count !== 1 ? "s" : ""}</span>
                      </div>
                      <span className="text-[11px] text-[var(--text-secondary)]">{fmt(s.total, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)]">
                <div className="border-b border-[var(--border-soft)] px-4 py-3">
                  <div className="text-[12px] font-medium tracking-tight text-[var(--text-primary)]">Credit Note Impact</div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">by reason (executed only)</div>
                </div>
                <div className="divide-y divide-stone-200 px-4 py-1 dark:divide-stone-800">
                  {Object.keys(reasonMap).length === 0 ? (
                    <div className="py-3 text-center text-[12px] text-[var(--text-muted)]">No executed credits</div>
                  ) : Object.entries(reasonMap).map(([reason, amount]) => (
                    <div key={reason} className="flex items-center justify-between py-2.5">
                      <span className="text-[11px] text-[var(--text-secondary)]">{REASON_LABELS[reason] ?? reason}</span>
                      <span className="text-[11px] text-[var(--text-primary)]">{fmt(amount, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
