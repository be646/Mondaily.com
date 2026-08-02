import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FieldSelect } from "../../../components/ui/controls";
import { DataTable, type DataTableColumn } from "../../../components/ui/data-table";
import { FinanceListToolbar, FinanceHeader } from "../../../components/finance/finance-toolbar";
import { KPIGrid, KPITile } from "../../../components/ui/kpi";
import { AIButton } from "../../../components/ui/ai-button";
import { apiClient } from "../../../lib/api-client";
import { useCurrency, formatMoney, currencyOptions } from "../../../hooks/useCurrency";
import {
  Plus, ReceiptText, Clock, CheckCircle2, XCircle, Send, FileOutput,
} from "lucide-react";
import { MoneyCell } from "../../../components/finance/money-cell";

type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";

interface Quote {
  id: string;
  number: string;
  client_name: string;
  // The API returns the quote total in MAJOR units as `total` (with subtotal/tax_total).
  // (Older code read a non-existent `amount_cents`, which rendered £NaN.)
  total: number;
  currency: string;
  status: QuoteStatus;
  converted_to_invoice_id?: string | null;
  expires_at?: string;
  notes?: string;
  created_at: string;
}

const STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:    { label: "Draft",    color: "text-stone-400 bg-stone-400/10",     icon: ReceiptText   },
  sent:     { label: "Sent",     color: "text-status-neutral bg-status-neutral/10",     icon: Send          },
  accepted: { label: "Accepted", color: "text-status-ok bg-status-ok/10", icon: CheckCircle2 },
  declined: { label: "Declined", color: "text-status-error bg-status-error/10",       icon: XCircle       },
  expired:  { label: "Expired",  color: "text-stone-600 bg-stone-600/10",     icon: Clock         },
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "draft",    label: "Draft"    },
  { key: "sent",     label: "Sent"     },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "expired",  label: "Expired"  },
];

function NewQuoteModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const { base, currencies } = useCurrency();
  const [form, setForm] = useState({
    client_name: "",
    amount: "",
    currency: "",
    expires_at: "",
    notes: "",
  });
  useEffect(() => { setForm(f => (f.currency ? f : { ...f, currency: base })); }, [base]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI draft — turn a short brief (e.g. a deal description) into client/amount/notes the user
  // reviews before creating. Grounded in the brief; nothing is auto-submitted.
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  async function aiDraft() {
    if (!brief.trim()) return;
    setDrafting(true); setDraftNote(null);
    try {
      const res = await apiClient.post<{ client_name?: string; amount?: number; notes?: string; error?: string }>("/quotes/draft", { brief: brief.trim(), currency: form.currency || undefined });
      if (res.error) { setDraftNote(res.error); return; }
      setForm(f => ({
        ...f,
        client_name: res.client_name || f.client_name,
        amount: res.amount ? String(res.amount) : f.amount,
        notes: res.notes || f.notes,
      }));
      setDraftNote("Drafted — review and edit before creating.");
    } catch { setDraftNote("Couldn't draft that."); }
    finally { setDrafting(false); }
  }

  async function submit() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!form.client_name || isNaN(cents) || cents <= 0) {
      setError("Client name and a valid amount are required.");
      return;
    }
    setLoading(true); setError(null);
    try {
      // Backend requires line_items (not amount_cents) — build a single line
      // item from the simple amount field so the quote validates and totals.
      await apiClient.post("/quotes", {
        client_name: form.client_name,
        line_items: [{ description: form.notes?.trim() || `Quote for ${form.client_name}`, quantity: 1, unit_price: parseFloat(form.amount), tax_rate: 0 }],
        currency: form.currency,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
        notes: form.notes || undefined,
        status: "draft",
      });
      onCreate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-status-neutral/10 flex items-center justify-center"><ReceiptText size={12} className="text-status-neutral"/></div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">New Quote</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          {/* AI draft — optional: describe the deal and let AI pre-fill the fields to review. */}
          <div className="rounded-sm border border-[var(--section-accent-line)] bg-[color-mix(in_srgb,var(--section-accent)_4%,transparent)] p-2.5">
            <div className="flex items-center gap-2">
              <input value={brief} onChange={e => setBrief(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); aiDraft(); } }}
                placeholder="Describe the deal — e.g. Annual Design Ops bundle for Acme, 3 seats…"
                className="key-input h-8 flex-1"/>
              <AIButton variant="subtle" size="sm" loading={drafting} disabled={!brief.trim()} onClick={aiDraft}>Draft</AIButton>
            </div>
            {draftNote && <p className="mt-1.5 text-caption text-[var(--text-faint)]">{draftNote}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Client name</label>
              <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                placeholder="Acme Corp" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Amount</label>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00" type="number" min="0" step="0.01" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Currency</label>
              <FieldSelect value={form.currency} onChange={v => setForm(f => ({ ...f, currency: v }))} ariaLabel="Currency"
                options={currencyOptions(currencies)} />
            </div>
            <div className="col-span-2">
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Expires</label>
              <input value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                type="date" className="key-input w-full text-sm"/>
            </div>
            <div className="col-span-2">
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Additional details…" className="key-input w-full text-sm resize-none"/>
            </div>
          </div>
          {error && <p className="text-label text-[var(--text-faint)] bg-stone-400/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">Cancel</button>
            <button onClick={submit} disabled={loading}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors disabled:opacity-50">
              {loading ? "Creating…" : "Create Quote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const dateGB = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// Column model for the shared DataTable. Cell rendering + money formatting + the status badge
// stay HERE (the shared shell knows no finance logic); only the table markup moved.
// The Convert column is appended in the page component, which owns the mutation.
const QUOTE_COLUMNS: DataTableColumn<Quote>[] = [
  { key: "number",  header: "Number", cellClassName: "text-body font-mono text-[var(--text-faint)]",    cell: (q) => q.number },
  { key: "client",  header: "Client", cellClassName: "text-body font-medium text-[var(--text-primary)]", cell: (q) => q.client_name },
  { key: "amount",  header: "Amount", cellClassName: "text-row font-semibold text-[var(--text-primary)]", cell: (q) => <MoneyCell row={q as unknown as Record<string, unknown>}/> },
  { key: "status",  header: "Status", cell: (q) => {
      const cfg = STATUS_CONFIG[q.status] ?? STATUS_CONFIG.draft;
      const Icon = cfg.icon;
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium ${cfg.color}`}>
          <Icon size={10} />{cfg.label}
        </span>
      );
    } },
  { key: "expires", header: "Expires", cellClassName: "text-label text-[var(--text-secondary)]", cell: (q) => q.expires_at ? dateGB(q.expires_at) : "—" },
  { key: "created", header: "Created", cellClassName: "text-label text-[var(--text-secondary)]", cell: (q) => dateGB(q.created_at) },
];

export function QuotesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  const { data: quotes = [], isLoading, isError, refetch } = useQuery<Quote[]>({
    queryKey: ["quotes", statusFilter, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter) p.set("status", statusFilter);
      if (search) p.set("search", search);
      return apiClient.get<Quote[]>(`/quotes?${p}`);
    },
  });

  // Unfiltered fetch just for the segment counts — the list above is server-filtered by status,
  // so counting IT would show "Draft 0" the moment you filtered to Sent. Counts must describe the
  // whole set or they lie.
  const { data: allQuotes = [] } = useQuery<Quote[]>({
    queryKey: ["quotes", "", ""],
    queryFn: () => apiClient.get<Quote[]>("/quotes?"),
    staleTime: 60_000,
  });

  // Quote → invoice. The endpoint was fully built and hardened (idempotent: a quote converts
  // exactly once and a repeat returns the existing invoice) but NOTHING called it — the central
  // step of the quoting workflow had no button, so an accepted quote had to be retyped as an
  // invoice by hand.
  const [convertErr, setConvertErr] = useState<string | null>(null);
  const convert = useMutation({
    mutationFn: (id: string) => apiClient.post<{ id: string; number?: string; already_converted?: boolean }>(`/quotes/${id}/convert`, {}),
    onSuccess: (inv) => {
      setConvertErr(null);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/finance/invoices/${inv.id}`);
    },
    onError: (e) => setConvertErr(e instanceof Error ? e.message : "Could not convert this quote."),
  });

  const quoteColumns: DataTableColumn<Quote>[] = [
    ...QUOTE_COLUMNS,
    {
      key: "convert",
      header: "",
      cell: (q) => {
        if (q.converted_to_invoice_id) {
          return (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/finance/invoices/${q.converted_to_invoice_id}`); }}
              className="text-caption text-[var(--text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--text-primary)]">
              View invoice
            </button>
          );
        }
        // Only a live quote can become an invoice — a declined or expired one is not billable.
        if (q.status === "declined") return null;
        const busy = convert.isPending && convert.variables === q.id;
        return (
          <button
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              if (!window.confirm(`Convert ${q.number} into a draft invoice for ${q.client_name}?\n\nThe quote is marked accepted. It can only be converted once.`)) return;
              convert.mutate(q.id);
            }}
            className="flex items-center gap-1 rounded-sm border border-dashed border-[var(--border-soft)] px-2 py-0.5 text-caption text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50">
            <FileOutput size={10}/>{busy ? "Converting…" : "To invoice"}
          </button>
        );
      },
    },
  ];

  const { display, sumInDisplay } = useCurrency();
  const currency = display;
  const q$ = (q: Quote) => ({ amount: q.total ?? 0, currency: q.currency });
  const acceptedSum = sumInDisplay(quotes.filter(q => q.status === "accepted").map(q$));
  const pendingSum  = sumInDisplay(quotes.filter(q => q.status === "sent").map(q$));
  const totalAccepted = acceptedSum.value;
  const totalPending  = pendingSum.value;
  // Retain `missing`: unlike currencies with no FX rate are summed at FACE VALUE, so the
  // figure must not be presented as exact.
  const approx = (n: number) => (n > 0 ? "~" : "");


  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader icon={ReceiptText} callsign="QUOTES" title="Quotes" subtitle="Manage proposals and client quotes"
          action={
            <button onClick={() => setShowNew(true)}
              className="btn-primary h-7 shrink-0 gap-2 px-3 text-body font-semibold">
              <Plus size={13}/> New Quote
            </button>
          }
        />

        {/* One KPI strip (shared KPIGrid/KPITile) — was three separate telemetry cards. */}
        <KPIGrid className="mb-4">
          <KPITile icon={Send} iconColor="var(--status-neutral)" valueColor="var(--status-neutral)" label="Sent"
            value={<>{approx(pendingSum.missing)}{formatMoney(totalPending, currency)}</>}
            sub={<>{quotes.filter(q => q.status === "sent").length} quotes awaiting response</>} />
          <KPITile icon={CheckCircle2} iconColor="var(--status-ok)" valueColor="var(--status-ok)" label="Accepted"
            value={<>{approx(acceptedSum.missing)}{formatMoney(totalAccepted, currency)}</>}
            sub={<>{quotes.filter(q => q.status === "accepted").length} accepted</>} />
          <KPITile icon={ReceiptText} label="Total quotes" value={quotes.length} sub="all statuses" />
        </KPIGrid>

        {/* Filters + search — shared finance toolbar (identical on every finance list page) */}
        <FinanceListToolbar tabs={FILTERS} activeTab={statusFilter} onTab={setStatusFilter}
          counts={allQuotes.reduce<Record<string, number>>((acc, q) => { const k = String(q.status ?? "draft"); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})}
          search={search} onSearch={setSearch} placeholder="Search by client…" />
        {convertErr && (
          <p className="mt-2 text-caption" style={{ color: "var(--status-error)" }} role="alert">{convertErr}</p>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {/* Presentational shell only — every cell below is still rendered by this page, so all
            formatting, the status badge, and the money value are unchanged. Rows are intentionally
            non-navigating (matches the prior behaviour); no row click was added. */}
        <DataTable<Quote>
          columns={quoteColumns}
          rows={quotes}
          rowKey={(q) => q.id}
          state={{
            isLoading, isError, onRetry: () => refetch(),
            loadingLabel: "Loading…",
            errorLabel: "Couldn’t load quotes.",
            empty: (
              <div className="flex h-60 flex-col items-center justify-center gap-3">
                <ReceiptText size={32} className="text-[var(--text-secondary)]"/>
                <div className="text-row text-[var(--text-muted)]">No quotes {statusFilter ? `with status "${statusFilter}"` : "yet"}</div>
                <button onClick={() => setShowNew(true)} className="text-body text-[var(--text-faint)] hover:text-[var(--text-faint)] transition-colors">Create your first quote</button>
              </div>
            ),
          }}
        />
      </div>

      {showNew && (
        <NewQuoteModal
          onClose={() => setShowNew(false)}
          onCreate={() => { qc.invalidateQueries({ queryKey: ["quotes"] }); setShowNew(false); }}
        />
      )}
    </div>
  );
}
