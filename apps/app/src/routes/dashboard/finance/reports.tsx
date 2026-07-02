import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, DollarSign, Clock, MinusCircle } from "lucide-react";

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

function fmt(amount: number, currency = "GBP") {
  return amount.toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
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
  paid: "text-emerald-600 dark:text-emerald-400",
  overdue: "text-amber-600 dark:text-amber-400",
  cancelled: "text-stone-400 dark:text-stone-600",
};

const REASON_LABELS: Record<string, string> = {
  refund: "Refund",
  billing_error: "Billing Error",
  goodwill: "Goodwill",
  contract_discount: "Contract Discount",
};

export function FinanceReportsPage() {
  const { data: invoices = [] } = useQuery<Invoice[]>({
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

  const currency = invoices[0]?.currency ?? "GBP";

  // Summary
  const totalRevenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.total, 0);
  const outstanding = invoices.filter(i => ["sent", "viewed", "overdue"].includes(i.status)).reduce((s, i) => s + i.total, 0);
  const creditsIssued = creditNotes.filter(cn => cn.status === "executed").reduce((s, cn) => s + cn.amount_cents / 100, 0);
  const netRevenue = totalRevenue - creditsIssued;

  // Monthly chart data
  const months = getLastNMonths(6);
  const monthlyData = months.map(m => {
    const monthInvoices = invoices.filter(i => i.created_at.slice(0, 7) === m.key);
    const billed = monthInvoices.reduce((s, i) => s + i.total, 0);
    const collected = monthInvoices.filter(i => i.status === "paid").reduce((s, i) => s + i.total, 0);
    return { name: m.label, Billed: Math.round(billed * 100) / 100, Collected: Math.round(collected * 100) / 100 };
  });

  // Top clients
  const clientMap: Record<string, { billed: number; paid: number; count: number }> = {};
  for (const inv of invoices) {
    if (!clientMap[inv.client_name]) clientMap[inv.client_name] = { billed: 0, paid: 0, count: 0 };
    clientMap[inv.client_name]!.billed += inv.total;
    if (inv.status === "paid") clientMap[inv.client_name]!.paid += inv.total;
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
    total: invoices.filter(i => i.status === s).reduce((acc, i) => acc + i.total, 0),
  })).filter(s => s.count > 0);

  // Credit note impact by reason
  const reasonMap: Record<string, number> = {};
  for (const cn of creditNotes.filter(cn => cn.status === "executed")) {
    reasonMap[cn.credit_reason] = (reasonMap[cn.credit_reason] ?? 0) + cn.amount_cents / 100;
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-card)] text-[var(--text-primary)]">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Finance Reports</h1>
        <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Revenue overview, client breakdown and credit analysis</p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">

          {/* Summary cards */}
          <div className="telemetry-strip">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp size={11} className="text-emerald-600 dark:text-emerald-400"/>
                <span className="text-[11px] text-[var(--text-muted)]">Total Revenue</span>
              </div>
              <div className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">{fmt(totalRevenue, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">from paid invoices</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={11} className="text-amber-400"/>
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
              <div className={`text-[20px] font-semibold tracking-tight ${netRevenue >= 0 ? "text-[var(--text-primary)]" : "text-amber-600 dark:text-amber-400"}`}>{fmt(netRevenue, currency)}</div>
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
          <div className="grid grid-cols-2 gap-4">
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
                        <td className="px-3 py-2.5 text-[11px] text-amber-600 dark:text-amber-400">{fmt(c.outstanding, currency)}</td>
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
