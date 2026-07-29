import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FieldSelect } from "../../../components/ui/controls";
import { DataTable, type DataTableColumn } from "../../../components/ui/data-table";
import { FinanceListToolbar, FinanceHeader } from "../../../components/finance/finance-toolbar";
import { AIButton } from "../../../components/ui/ai-button";
import { apiClient } from "../../../lib/api-client";
import { useCurrency, formatMoney, currencyOptions } from "../../../hooks/useCurrency";
import {
  Plus, ReceiptText, Clock, CheckCircle2, XCircle, Send,
} from "lucide-react";

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

function fmt(amount: number, currency: string) {
  return (amount ?? 0).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
}

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
const QUOTE_COLUMNS: DataTableColumn<Quote>[] = [
  { key: "number",  header: "Number", cellClassName: "text-body font-mono text-[var(--text-faint)]",    cell: (q) => q.number },
  { key: "client",  header: "Client", cellClassName: "text-body font-medium text-[var(--text-primary)]", cell: (q) => q.client_name },
  { key: "amount",  header: "Amount", cellClassName: "text-row font-semibold text-[var(--text-primary)]", cell: (q) => fmt(q.total, q.currency) },
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
              className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-body font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
              <Plus size={13}/> New Quote
            </button>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><Send size={11} className="text-status-neutral"/><span className="text-label text-[var(--text-muted)]">Sent</span></div>
            <div className="text-stat font-semibold text-status-neutral">{approx(pendingSum.missing)}{formatMoney(totalPending, currency)}</div>
            <div className="text-caption text-[var(--text-secondary)] mt-0.5">{quotes.filter(q => q.status === "sent").length} quotes awaiting response</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-status-ok"/><span className="text-label text-[var(--text-muted)]">Accepted</span></div>
            <div className="text-stat font-semibold text-status-ok">{approx(acceptedSum.missing)}{formatMoney(totalAccepted, currency)}</div>
            <div className="text-caption text-[var(--text-secondary)] mt-0.5">{quotes.filter(q => q.status === "accepted").length} accepted</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><ReceiptText size={11} className="text-[var(--text-muted)]"/><span className="text-label text-[var(--text-muted)]">Total quotes</span></div>
            <div className="text-stat font-semibold text-[var(--text-primary)]">{quotes.length}</div>
            <div className="text-caption text-[var(--text-secondary)] mt-0.5">all statuses</div>
          </div>
        </div>

        {/* Filters + search — shared finance toolbar (identical on every finance list page) */}
        <FinanceListToolbar tabs={FILTERS} activeTab={statusFilter} onTab={setStatusFilter}
          search={search} onSearch={setSearch} placeholder="Search by client…" />
      </div>

      <div className="flex-1 overflow-auto">
        {/* Presentational shell only — every cell below is still rendered by this page, so all
            formatting, the status badge, and the money value are unchanged. Rows are intentionally
            non-navigating (matches the prior behaviour); no row click was added. */}
        <DataTable<Quote>
          columns={QUOTE_COLUMNS}
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
