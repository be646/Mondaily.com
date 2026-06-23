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
    background: "#0f1117",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "8px",
    fontSize: "11px",
    color: "#a1a1aa",
  },
  labelStyle: { color: "#fff", fontWeight: 600 },
};

const STATUS_ORDER: InvoiceStatus[] = ["draft", "sent", "viewed", "paid", "overdue", "cancelled"];
const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", viewed: "Viewed", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};
const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "text-zinc-400", sent: "text-blue-400", viewed: "text-purple-400",
  paid: "text-emerald-400", overdue: "text-indigo-400", cancelled: "text-zinc-600",
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
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
        <h1 className="text-[15px] font-semibold text-white">Finance Reports</h1>
        <p className="text-[12px] text-zinc-500 mt-0.5">Revenue overview, client breakdown and credit analysis</p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="premium-panel p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp size={11} className="text-emerald-400"/>
                <span className="text-[11px] text-zinc-500">Total Revenue</span>
              </div>
              <div className="text-[20px] font-semibold text-emerald-400">{fmt(totalRevenue, currency)}</div>
              <div className="text-[10px] text-zinc-700 mt-0.5">from paid invoices</div>
            </div>
            <div className="premium-panel p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={11} className="text-amber-400"/>
                <span className="text-[11px] text-zinc-500">Outstanding</span>
              </div>
              <div className="text-[20px] font-semibold text-amber-400">{fmt(outstanding, currency)}</div>
              <div className="text-[10px] text-zinc-700 mt-0.5">sent / viewed / overdue</div>
            </div>
            <div className="premium-panel p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <MinusCircle size={11} className="text-violet-400"/>
                <span className="text-[11px] text-zinc-500">Credits Issued</span>
              </div>
              <div className="text-[20px] font-semibold text-violet-400">{fmt(creditsIssued, currency)}</div>
              <div className="text-[10px] text-zinc-700 mt-0.5">executed credit notes</div>
            </div>
            <div className="premium-panel p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign size={11} className="text-white/60"/>
                <span className="text-[11px] text-zinc-500">Net Revenue</span>
              </div>
              <div className={`text-[20px] font-semibold ${netRevenue >= 0 ? "text-white" : "text-indigo-400"}`}>{fmt(netRevenue, currency)}</div>
              <div className="text-[10px] text-zinc-700 mt-0.5">after credits</div>
            </div>
          </div>

          {/* Revenue by month chart */}
          <div className="premium-panel p-4">
            <div className="mb-4">
              <div className="text-[13px] font-medium text-white">Revenue by Month</div>
              <div className="text-[11px] text-zinc-600">Last 6 months — billed vs collected</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barCategoryGap="30%" barGap={3}>
                <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={60}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}/>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => fmt(v, currency)}/>
                <Legend wrapperStyle={{ fontSize: 11, color: "#71717a" }}/>
                <Bar dataKey="Billed" fill="#ef4444" radius={[3, 3, 0, 0]}/>
                <Bar dataKey="Collected" fill="#10b981" radius={[3, 3, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top clients + Status breakdown */}
          <div className="grid grid-cols-2 gap-4">
            {/* Top clients */}
            <div className="rounded-xl border border-white/[.06] bg-white/[.02] overflow-hidden">
              <div className="border-b border-white/[.04] px-4 py-3">
                <div className="text-[12px] font-medium text-white">Top Clients</div>
                <div className="text-[10px] text-zinc-600 mt-0.5">by total billed</div>
              </div>
              {topClients.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-zinc-600">No invoice data</div>
              ) : (
                <table className="minimal-table">
                  <thead>
                    <tr className="border-b border-white/[.04]">
                      {["Client", "Billed", "Paid", "Outstanding", "#"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-zinc-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topClients.map(c => (
                      <tr key={c.name} className="border-b border-white/[.03] hover:bg-white/[.015] transition-colors">
                        <td className="px-3 py-2.5 text-[11px] font-medium text-white max-w-[100px] truncate">{c.name}</td>
                        <td className="px-3 py-2.5 text-[11px] text-zinc-300">{fmt(c.billed, currency)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-emerald-400">{fmt(c.paid, currency)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-amber-400">{fmt(c.outstanding, currency)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-zinc-600">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Status breakdown + credit note impact */}
            <div className="space-y-4">
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] overflow-hidden">
                <div className="border-b border-white/[.04] px-4 py-3">
                  <div className="text-[12px] font-medium text-white">Invoice Status Breakdown</div>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {statusBreakdown.length === 0 ? (
                    <div className="text-[12px] text-zinc-600 py-2 text-center">No invoices yet</div>
                  ) : statusBreakdown.map(s => (
                    <div key={s.status} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium ${STATUS_COLORS[s.status]}`}>{STATUS_LABELS[s.status]}</span>
                        <span className="text-[10px] text-zinc-700">{s.count} invoice{s.count !== 1 ? "s" : ""}</span>
                      </div>
                      <span className="text-[11px] text-zinc-400">{fmt(s.total, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/[.06] bg-white/[.02] overflow-hidden">
                <div className="border-b border-white/[.04] px-4 py-3">
                  <div className="text-[12px] font-medium text-white">Credit Note Impact</div>
                  <div className="text-[10px] text-zinc-600 mt-0.5">by reason (executed only)</div>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {Object.keys(reasonMap).length === 0 ? (
                    <div className="text-[12px] text-zinc-600 py-2 text-center">No executed credits</div>
                  ) : Object.entries(reasonMap).map(([reason, amount]) => (
                    <div key={reason} className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400">{REASON_LABELS[reason] ?? reason}</span>
                      <span className="text-[11px] text-violet-400">{fmt(amount, currency)}</span>
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
