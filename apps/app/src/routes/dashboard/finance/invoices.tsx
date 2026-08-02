import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { useCurrency } from "../../../hooks/useCurrency";
import { FinanceAgentStrip } from "../../../components/ai/finance-agent-strip";
import { Plus, FileText, Clock, CheckCircle, AlertTriangle, XCircle, Send, DollarSign } from "lucide-react";
import { FinanceListToolbar, FinanceHeader } from "../../../components/finance/finance-toolbar";
import { DataTable, type DataTableColumn } from "../../../components/ui/data-table";
import { PeriodSelector } from "../../../components/ui/period-selector";
import { KPIGrid, KPITile } from "../../../components/ui/kpi";
import { usePeriod, periodRange, inRange, periodLabel } from "../../../lib/period";
import { isOutstanding } from "@mondaily/shared/finance";
import { MoneyCell } from "../../../components/finance/money-cell";

type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "cancelled";

interface Invoice {
  id: string;
  number: string;
  client_name: string;
  client_email?: string;
  total: number;
  currency: string;
  /** Present on the wire (the API spreads the whole data blob) but was never used, so
   *  Outstanding counted the GROSS total of a partly-paid invoice. */
  payments?: { amount: number }[];
  status: InvoiceStatus;
  due_date?: string;
  sent_at?: string;
  paid_at?: string;
  created_at: string;
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Draft",     color: "text-stone-400 bg-stone-400/10",     icon: FileText },
  sent:      { label: "Sent",      color: "text-[#717784] bg-[#717784]/10",     icon: Send },
  viewed:    { label: "Viewed",    color: "text-stone-400 bg-stone-400/10", icon: Clock },
  paid:      { label: "Paid",      color: "text-[#2f9e6b] bg-[#2f9e6b]/10", icon: CheckCircle },
  overdue:   { label: "Overdue",   color: "text-[#c6892e] bg-[#c6892e]/10",       icon: AlertTriangle },
  cancelled: { label: "Cancelled", color: "text-stone-600 bg-stone-600/10",     icon: XCircle },
};

function formatCurrency(amount: number, currency: string) {
  // A blank/invalid code makes Intl throw RangeError and takes down the whole table render.
  // currency lives in free-form JSONB and the create modals default it to "", so this is
  // reachable. Degrade to "12.34 XXX" like lib/currency-format.formatMoney does.
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`;
  }
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

// Column model for the shared DataTable. Every cell renderer — status badge, money (formatCurrency),
// dates (formatDate) and the "Open →" link — stays HERE, so the shell knows no finance logic. Amount
// still reads inv.total (major units) exactly as before. Only the table markup moved.
const INVOICE_COLUMNS: DataTableColumn<Invoice>[] = [
  { key: "number", header: "Invoice", cellClassName: "text-body font-medium text-[var(--text-primary)]", cell: (inv) => inv.number },
  { key: "client", header: "Client", cell: (inv) => (
      <>
        <div className="text-body text-[var(--text-primary)]">{inv.client_name}</div>
        {inv.client_email && <div className="text-label text-[var(--text-secondary)]">{inv.client_email}</div>}
      </>
    ) },
  { key: "amount", header: "Amount", cellClassName: "text-row font-semibold text-[var(--text-primary)]", cell: (inv) => <MoneyCell row={inv as unknown as Record<string, unknown>}/> },
  { key: "status", header: "Status", cell: (inv) => {
      const cfg = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.draft;
      const Icon = cfg.icon;
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium ${cfg.color}`}>
          <Icon size={10} />{cfg.label}
        </span>
      );
    } },
  { key: "due_date", header: "Due Date", cellClassName: "text-label text-[var(--text-faint)]", cell: (inv) => formatDate(inv.due_date) },
  { key: "open", header: "", cell: (inv) => (
      <Link to={`/finance/invoices/${inv.id}`} onClick={(e) => e.stopPropagation()}
        className="text-label text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors">
        Open →
      </Link>
    ) },
];

export function InvoicesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const { display, sumInDisplay } = useCurrency();

  // Page-level finance context for the right-side Ask AI drawer — no
  // specific invoice selected here, just "the invoices page".
  useEffect(() => {
    useAskContextStore.getState().setContext({
      route: "/finance/invoices",
      scope_label: "the Invoices page (finance)",
    });
    return () => useAskContextStore.getState().setContext(null);
  }, []);

  const { data: invoices = [], isLoading, isError, refetch } = useQuery<Invoice[]>({
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
        currency: display,
        status: "draft",
      }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/finance/invoices/${inv.id}`);
    },
  });

  // Period lens (default All for a list page). Outstanding is a point-in-time BALANCE (as-of, never
  // scoped); Collected is a FLOW counted within the window on paid date.
  const [period, setPeriod] = usePeriod("mondaily_invoices_period", "all");
  const range = periodRange(period);
  const inv$ = (i: Invoice) => ({ amount: i.total, currency: i.currency });
  // Outstanding must net off what has already been received; an invoice with 9,000 of 10,000
  // paid was contributing the full 10,000.
  const owed$ = (i: Invoice) => {
    const paid = (i.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    return { amount: Math.max(0, Math.round((i.total - paid) * 100) / 100), currency: i.currency };
  };
  // Keep `missing`: when an FX rate is absent, sumInDisplay adds unlike currencies at FACE
  // VALUE. Presenting that as an exact figure under one symbol is a wrong number, so the
  // card is marked approximate (same treatment expenses already uses).
  const owedSum = sumInDisplay(invoices.filter(i => isOutstanding(i.status)).map(owed$));
  const paidSum = sumInDisplay(invoices.filter(i => i.status === "paid" && (period === "all" || inRange(i.paid_at ?? i.created_at, range))).map(inv$));
  const totalOwed = owedSum.value;
  const totalPaid = paidSum.value;
  const approx = (n: number) => (n > 0 ? "~" : "");
  const unconverted = (n: number) => (n > 0 ? ` · ${n} unconverted` : "");
  const collectedScope = period === "all" ? "all time" : period === "today" ? "today" : `this ${periodLabel(period).toLowerCase()}`;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader icon={FileText} callsign="BILLING" title="Invoices" subtitle="Create, send, and track invoices"
          action={
            <>
              <PeriodSelector value={period} onChange={setPeriod} />
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="btn-primary h-7 shrink-0 gap-2 px-3 text-body font-semibold disabled:opacity-50"
              >
                <Plus size={13}/> New Invoice
              </button>
            </>
          }
        />

        <FinanceAgentStrip/>

        {/* Summary cards */}
        {/* One KPI strip (shared KPIGrid/KPITile) — was two separate telemetry-strips in a grid,
            a local drift from the Finance Reports single-strip idiom. */}
        <KPIGrid className="mb-4">
          <KPITile icon={DollarSign} label="Outstanding"
            value={<>{approx(owedSum.missing)}{formatCurrency(totalOwed, display)}</>}
            sub={<>unpaid · as of today{unconverted(owedSum.missing)}</>} />
          <KPITile icon={CheckCircle} iconColor="#2f9e6b" label="Collected" accent
            value={<>{approx(paidSum.missing)}{formatCurrency(totalPaid, display)}</>}
            sub={<>{collectedScope}{unconverted(paidSum.missing)}</>} />
        </KPIGrid>

        {/* Filters + search — shared finance toolbar (identical on every finance list page) */}
        <FinanceListToolbar tabs={FILTERS} activeTab={statusFilter} onTab={setStatusFilter}
          search={search} onSearch={setSearch} placeholder="Search invoices…" />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-body text-[var(--text-secondary)]">Loading…</div>
        ) : isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-body text-[var(--text-muted)]">Couldn't load invoices. <button onClick={() => refetch()} className="underline">Retry</button></div>
        ) : invoices.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <FileText size={32} className="text-[var(--text-secondary)]"/>
            <div className="text-row text-[var(--text-muted)]">No invoices yet</div>
            <button
              onClick={() => createMutation.mutate()}
              className="text-body text-[var(--text-faint)] hover:text-[var(--text-faint)] transition-colors"
            >
              Create your first invoice
            </button>
          </div>
        ) : (
          // Presentational shell only — cell rendering, status badge, money value, dates, the "Open →"
          // link and the row → detail navigation are all still owned by this page (above), unchanged.
          // `font-mono` preserves the ledger-style numerals; row click navigates exactly as before.
          <DataTable<Invoice>
            className="font-mono"
            columns={INVOICE_COLUMNS}
            rows={invoices}
            rowKey={(inv) => inv.id}
            onRowClick={(inv) => navigate(`/finance/invoices/${inv.id}`)}
          />
        )}
      </div>
    </div>
  );
}
