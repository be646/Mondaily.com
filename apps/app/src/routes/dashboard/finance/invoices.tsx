import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { Plus, Search, FileText, Clock, CheckCircle, AlertTriangle, XCircle, Send, DollarSign } from "lucide-react";

type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "cancelled";

interface Invoice {
  id: string;
  number: string;
  client_name: string;
  client_email?: string;
  total: number;
  currency: string;
  status: InvoiceStatus;
  due_date?: string;
  sent_at?: string;
  paid_at?: string;
  created_at: string;
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Draft",     color: "text-zinc-400 bg-zinc-400/10",     icon: FileText },
  sent:      { label: "Sent",      color: "text-blue-400 bg-blue-400/10",     icon: Send },
  viewed:    { label: "Viewed",    color: "text-purple-400 bg-purple-400/10", icon: Clock },
  paid:      { label: "Paid",      color: "text-emerald-400 bg-emerald-400/10", icon: CheckCircle },
  overdue:   { label: "Overdue",   color: "text-red-400 bg-red-400/10",       icon: AlertTriangle },
  cancelled: { label: "Cancelled", color: "text-zinc-600 bg-zinc-600/10",     icon: XCircle },
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
];

export function InvoicesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", statusFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      return apiClient.get<Invoice[]>(`/invoices?${params}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post<Invoice>("/invoices", {
        client_name: "New Client",
        line_items: [{ description: "Service", quantity: 1, unit_price: 0, tax_rate: 20 }],
        currency: "GBP",
        status: "draft",
      }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/finance/invoices/${inv.id}`);
    },
  });

  const totalOwed = invoices
    .filter(i => ["sent", "viewed", "overdue"].includes(i.status))
    .reduce((s, i) => s + i.total, 0);

  const totalPaid = invoices
    .filter(i => i.status === "paid")
    .reduce((s, i) => s + i.total, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-white/[.06] px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[15px] font-semibold text-white">Invoices</h1>
            <p className="text-[12px] text-zinc-500 mt-0.5">Create, send, and track invoices</p>
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 rounded-xl border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-400 transition-colors disabled:opacity-50"
          >
            <Plus size={13}/> New Invoice
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={12} className="text-zinc-500"/>
              <span className="text-[11px] text-zinc-500">Outstanding</span>
            </div>
            <div className="text-[18px] font-semibold text-white">{formatCurrency(totalOwed, "GBP")}</div>
          </div>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle size={12} className="text-emerald-400"/>
              <span className="text-[11px] text-zinc-500">Collected</span>
            </div>
            <div className="text-[18px] font-semibold text-emerald-400">{formatCurrency(totalPaid, "GBP")}</div>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-white/[.06] bg-white/[.02] p-1">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${statusFilter === f.key ? "bg-white/[.07] text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoices…"
              className="key-input w-full pl-7 text-[12px]"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-zinc-600">Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <FileText size={32} className="text-zinc-700"/>
            <div className="text-[13px] text-zinc-500">No invoices yet</div>
            <button
              onClick={() => createMutation.mutate()}
              className="text-[12px] text-red-400 hover:text-red-300 transition-colors"
            >
              Create your first invoice
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[.04]">
                {["Invoice", "Client", "Amount", "Status", "Due Date", ""].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-zinc-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const cfg = STATUS_CONFIG[inv.status];
                const Icon = cfg.icon;
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-white/[.03] hover:bg-white/[.02] transition-colors cursor-pointer"
                    onClick={() => navigate(`/finance/invoices/${inv.id}`)}
                  >
                    <td className="px-4 py-3 text-[12px] font-medium text-white">{inv.number}</td>
                    <td className="px-4 py-3">
                      <div className="text-[12px] text-white">{inv.client_name}</div>
                      {inv.client_email && <div className="text-[11px] text-zinc-600">{inv.client_email}</div>}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-white">
                      {formatCurrency(inv.total, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                        <Icon size={10}/>{cfg.label}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-[12px] ${inv.status === "overdue" ? "text-red-400" : "text-zinc-400"}`}>
                      {formatDate(inv.due_date)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/finance/invoices/${inv.id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
