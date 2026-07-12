import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { useCurrency, formatMoney } from "../../../hooks/useCurrency";
import { FieldSelect } from "../../../components/ui/controls";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, DollarSign, Clock, MinusCircle, FileText, ReceiptText, BarChart2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
}

interface CreditNote {
  id: string;
  amount_cents: number;
  currency: string;
  credit_reason: "refund" | "billing_error" | "goodwill" | "contract_discount";
  status: string;
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
  paid: "text-[#5f8169]",
  overdue: "text-[#97824f]",
  cancelled: "text-stone-400 dark:text-stone-600",
};

const REASON_LABELS: Record<string, string> = {
  refund: "Refund",
  billing_error: "Billing Error",
  goodwill: "Goodwill",
  contract_discount: "Contract Discount",
};

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

  useQuery({
    queryKey: ["expenses-all"],
    queryFn: async () => {
      try { return await apiClient.get("/expenses"); } catch { return []; }
    },
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
  const { display, currencies, ratesAsOf, hasRates, setDisplay, sumInDisplay } = useCurrency();
  const currency = display;
  const inv$ = (i: Invoice) => ({ amount: i.total, currency: i.currency });
  const cn$ = (cn: CreditNote) => ({ amount: cn.amount_cents / 100, currency: cn.currency });

  // Summary
  const totalRevenue = sumInDisplay(invoices.filter(i => i.status === "paid").map(inv$)).value;
  const outstanding = sumInDisplay(invoices.filter(i => ["sent", "viewed", "overdue"].includes(i.status)).map(inv$)).value;
  const creditsIssued = sumInDisplay(creditNotes.filter(cn => cn.status === "executed").map(cn$)).value;
  const netRevenue = totalRevenue - creditsIssued;

  // How many amounts couldn't be converted (missing rate) — surfaced honestly to the user.
  const unconverted = sumInDisplay([...invoices.map(inv$), ...creditNotes.map(cn$)]).missing;
  const mixedCurrency = new Set([...invoices.map(i => i.currency), ...creditNotes.map(c => c.currency)]).size > 1;

  // Monthly chart data
  const months = getLastNMonths(6);
  const monthlyData = months.map(m => {
    const monthInvoices = invoices.filter(i => i.created_at.slice(0, 7) === m.key);
    const billed = sumInDisplay(monthInvoices.map(inv$)).value;
    const collected = sumInDisplay(monthInvoices.filter(i => i.status === "paid").map(inv$)).value;
    return { name: m.label, Billed: Math.round(billed * 100) / 100, Collected: Math.round(collected * 100) / 100 };
  });

  // Top clients
  const clientMap: Record<string, { billed: number; paid: number; count: number }> = {};
  for (const inv of invoices) {
    if (!clientMap[inv.client_name]) clientMap[inv.client_name] = { billed: 0, paid: 0, count: 0 };
    clientMap[inv.client_name]!.billed += sumInDisplay([inv$(inv)]).value;
    if (inv.status === "paid") clientMap[inv.client_name]!.paid += sumInDisplay([inv$(inv)]).value;
    clientMap[inv.client_name]!.count++;
  }
  const topClients = Object.entries(clientMap)
    .map(([name, d]) => ({ name, ...d, outstanding: d.billed - d.paid }))
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

  return (
    <div className="flex h-full flex-col bg-[var(--surface-card)] text-[var(--text-primary)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-soft)] px-6 py-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Finance Reports</h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Revenue overview, client breakdown and credit analysis
            {mixedCurrency && (
              <> · shown in <span className="font-medium text-[var(--text-secondary)]">{display}</span>
                {hasRates && ratesAsOf ? <> at ECB rate, {new Date(ratesAsOf).toLocaleDateString()}</> : ""}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">Show in</span>
          <div className="w-28">
            <FieldSelect value={display} onChange={v => setDisplay.mutate(v)} ariaLabel="Display currency"
              options={currencies.map(c => ({ value: c, label: c }))} />
          </div>
        </div>
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
          <div className="telemetry-strip">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp size={11} className="text-[#5f8169]"/>
                <span className="text-[11px] text-[var(--text-muted)]">Total Revenue</span>
              </div>
              <div className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">{fmt(totalRevenue, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">from paid invoices</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={11} className="text-[#97824f]"/>
                <span className="text-[11px] text-[var(--text-muted)]">Outstanding</span>
              </div>
              <div className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">{fmt(outstanding, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">sent / viewed / overdue</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <MinusCircle size={11} className="text-[var(--text-faint)]"/>
                <span className="text-[11px] text-[var(--text-muted)]">Credits Issued</span>
              </div>
              <div className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">{fmt(creditsIssued, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">executed credit notes</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign size={11} className="text-[var(--text-faint)]"/>
                <span className="text-[11px] text-[var(--text-muted)]">Net Revenue</span>
              </div>
              <div className={`text-[20px] font-semibold tracking-tight ${netRevenue >= 0 ? "text-[var(--text-primary)]" : "text-[#97824f]"}`}>{fmt(netRevenue, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">after credits</div>
            </div>
          </div>

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
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => fmt(v, currency)}/>
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
                <table className="minimal-table">
                  <thead>
                    <tr>
                      {["Client", "Billed", "Paid", "Outstanding", "#"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topClients.map(c => (
                      <tr key={c.name}>
                        <td className="max-w-[100px] truncate px-3 py-2.5 text-[11px] font-medium text-[var(--text-primary)]">{c.name}</td>
                        <td className="px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">{fmt(c.billed, currency)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">{fmt(c.paid, currency)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-[#97824f]">{fmt(c.outstanding, currency)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-[var(--text-faint)]">{c.count}</td>
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
