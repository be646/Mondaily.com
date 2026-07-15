import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FieldSelect } from "../../../components/ui/controls";
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
  amount_cents: number;
  currency: string;
  status: QuoteStatus;
  expires_at?: string;
  notes?: string;
  created_at: string;
}

const STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:    { label: "Draft",    color: "text-stone-400 bg-stone-400/10",     icon: ReceiptText   },
  sent:     { label: "Sent",     color: "text-[#717784] bg-[#717784]/10",     icon: Send          },
  accepted: { label: "Accepted", color: "text-[#2f9e6b] bg-[#2f9e6b]/10", icon: CheckCircle2 },
  declined: { label: "Declined", color: "text-[#d1524a] bg-[#d1524a]/10",       icon: XCircle       },
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

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
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
      <div className="w-full max-w-md rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-[#717784]/10 flex items-center justify-center"><ReceiptText size={12} className="text-[#717784]"/></div>
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
                className="key-input h-8 flex-1 text-[12px]"/>
              <AIButton variant="subtle" size="sm" loading={drafting} disabled={!brief.trim()} onClick={aiDraft}>Draft</AIButton>
            </div>
            {draftNote && <p className="mt-1.5 text-[10px] text-[var(--text-faint)]">{draftNote}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Client name</label>
              <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                placeholder="Acme Corp" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Amount</label>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00" type="number" min="0" step="0.01" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Currency</label>
              <FieldSelect value={form.currency} onChange={v => setForm(f => ({ ...f, currency: v }))} ariaLabel="Currency"
                options={currencyOptions(currencies)} />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Expires</label>
              <input value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                type="date" className="key-input w-full text-sm"/>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Additional details…" className="key-input w-full text-sm resize-none"/>
            </div>
          </div>
          {error && <p className="text-[11px] text-[var(--text-faint)] bg-stone-400/10 rounded-lg px-3 py-2">{error}</p>}
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
  const q$ = (q: Quote) => ({ amount: q.amount_cents / 100, currency: q.currency });
  const totalAccepted = sumInDisplay(quotes.filter(q => q.status === "accepted").map(q$)).value;
  const totalPending  = sumInDisplay(quotes.filter(q => q.status === "sent").map(q$)).value;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader icon={ReceiptText} callsign="QUOTES" title="Quotes" subtitle="Manage proposals and client quotes"
          action={
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
              <Plus size={13}/> New Quote
            </button>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><Send size={11} className="text-[#717784]"/><span className="text-[11px] text-[var(--text-muted)]">Sent</span></div>
            <div className="text-[17px] font-semibold text-[#717784]">{formatMoney(totalPending, currency)}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{quotes.filter(q => q.status === "sent").length} quotes awaiting response</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-[#2f9e6b]"/><span className="text-[11px] text-[var(--text-muted)]">Accepted</span></div>
            <div className="text-[17px] font-semibold text-[#2f9e6b]">{formatMoney(totalAccepted, currency)}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{quotes.filter(q => q.status === "accepted").length} accepted</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><ReceiptText size={11} className="text-[var(--text-muted)]"/><span className="text-[11px] text-[var(--text-muted)]">Total quotes</span></div>
            <div className="text-[17px] font-semibold text-[var(--text-primary)]">{quotes.length}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">all statuses</div>
          </div>
        </div>

        {/* Filters + search — shared finance toolbar (identical on every finance list page) */}
        <FinanceListToolbar tabs={FILTERS} activeTab={statusFilter} onTab={setStatusFilter}
          search={search} onSearch={setSearch} placeholder="Search by client…" />
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-[var(--text-secondary)]">Loading…</div>
        ) : isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">Couldn't load quotes. <button onClick={() => refetch()} className="underline">Retry</button></div>
        ) : quotes.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <ReceiptText size={32} className="text-[var(--text-secondary)]"/>
            <div className="text-[13px] text-[var(--text-muted)]">No quotes {statusFilter ? `with status "${statusFilter}"` : "yet"}</div>
            <button onClick={() => setShowNew(true)} className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-faint)] transition-colors">Create your first quote</button>
          </div>
        ) : (
          <table className="minimal-table">
            <thead>
              <tr className="border-b border-[var(--border-soft)]">
                {["Number", "Client", "Amount", "Status", "Expires", "Created"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-secondary)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => {
                const cfg = STATUS_CONFIG[q.status] ?? STATUS_CONFIG.draft;
                const Icon = cfg.icon;
                return (
                  <tr key={q.id}
                    className="border-b border-[var(--border-soft)] hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-[12px] font-mono text-[var(--text-faint)]">{q.number}</td>
                    <td className="px-4 py-3 text-[12px] font-medium text-[var(--text-primary)]">{q.client_name}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-[var(--text-primary)]">{fmt(q.amount_cents, q.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                        <Icon size={10}/>{cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                      {q.expires_at ? new Date(q.expires_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                      {new Date(q.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
