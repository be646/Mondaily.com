import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useCurrency, formatMoney, currencyOptions } from "../../../hooks/useCurrency";
import { FieldSelect } from "../../../components/ui/controls";
import { FinanceListToolbar } from "../../../components/finance/finance-toolbar";
import { EmptyState, ErrorState, ConsoleSkeleton, DelayedLoading } from "../../../components/ui/page-state";
import {
  Plus, ReceiptText, Clock, CheckCircle2,
  XCircle, ChevronRight,
} from "lucide-react";

type CreditReason = "refund" | "billing_error" | "goodwill" | "contract_discount";
// Mirrors the backend state machine: draft → pending_review → verified → executed (+ rejected, void).
type CreditStatus = "draft" | "pending_review" | "verified" | "rejected" | "executed" | "void";

interface CreditNote {
  id: string;
  amount_cents: number;
  currency: string;
  credit_reason: CreditReason;
  status: CreditStatus;
  client_name?: string;
  ai_summary?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  edges?: Record<string, string>;
}

const STATUS_CONFIG: Record<CreditStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:          { label: "Draft",          color: "text-stone-400 bg-stone-400/10",   icon: ReceiptText   },
  pending_review: { label: "Pending Review", color: "text-[#c6892e] bg-[#c6892e]/10",   icon: Clock         },
  verified:       { label: "Verified",       color: "text-[#717784] bg-[#717784]/10",   icon: CheckCircle2  },
  rejected:       { label: "Rejected",       color: "text-[#d1524a] bg-[#d1524a]/10",   icon: XCircle       },
  executed:       { label: "Executed",       color: "text-[#2f9e6b] bg-[#2f9e6b]/10",   icon: CheckCircle2  },
  void:           { label: "Void",           color: "text-stone-600 bg-stone-600/10",   icon: XCircle       },
};

const REASON_LABELS: Record<CreditReason, string> = {
  refund:             "Refund",
  billing_error:      "Billing Error",
  goodwill:           "Goodwill",
  contract_discount:  "Contract Discount",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "pending_review", label: "Pending" },
  { key: "verified",       label: "Verified" },
  { key: "rejected",       label: "Rejected" },
  { key: "executed",       label: "Executed" },
  { key: "draft",          label: "Draft" },
  { key: "void",           label: "Void" },
];

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
}

// ─── New credit note modal ────────────────────────────────────────────────────
function NewCreditNoteModal({ onClose, onCreate }: { onClose: () => void; onCreate: (id: string) => void }) {
  const { base, currencies } = useCurrency();
  const [form, setForm] = useState({
    client_name: "",
    amount: "",
    currency: "",
    credit_reason: "refund" as CreditReason,
    status: "draft" as CreditStatus,
    notes: "",
  });
  // default the new note to the workspace base currency once it's known (user can still change it)
  useEffect(() => { setForm(f => (f.currency ? f : { ...f, currency: base })); }, [base]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!form.client_name || isNaN(cents) || cents <= 0) { setError("Client name and a valid amount are required."); return; }
    setLoading(true); setError(null);
    try {
      const res = await apiClient.post<CreditNote>("/credit-notes", {
        amount_cents: cents,
        currency: form.currency,
        credit_reason: form.credit_reason,
        status: form.status,
        client_name: form.client_name,
        notes: form.notes || undefined,
      });
      onCreate(res.id);
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
            <div className="h-6 w-6 rounded-sm bg-[var(--surface-hover)] flex items-center justify-center"><ReceiptText size={12} className="text-[var(--text-faint)]"/></div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">New Credit Note</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
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
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Reason</label>
              <FieldSelect value={form.credit_reason} onChange={v => setForm(f => ({ ...f, credit_reason: v as CreditReason }))} ariaLabel="Reason"
                options={Object.entries(REASON_LABELS).map(([k, v]) => ({ value: k, label: v as string }))} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Initial status</label>
              <FieldSelect value={form.status} onChange={v => setForm(f => ({ ...f, status: v as CreditStatus }))} ariaLabel="Initial status"
                options={[{ value: "draft", label: "Draft" }, { value: "pending_review", label: "Submit for review" }]} />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Reason details…"
                className="key-input w-full text-sm resize-none"/>
            </div>
          </div>
          {error && <p className="text-[11px] rounded-sm px-3 py-2" style={{ color: "#d1524a", background: "color-mix(in srgb, #d1524a 10%, transparent)" }}>{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">Cancel</button>
            <button onClick={submit} disabled={loading}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors disabled:opacity-50">
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function CreditNotesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const { display, currencies, sumInDisplay } = useCurrency();

  const { data: creditNotes = [], isLoading, isError, refetch } = useQuery<CreditNote[]>({
    queryKey: ["credit-notes", statusFilter, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter) p.set("status", statusFilter);
      if (search) p.set("search", search);
      return apiClient.get<CreditNote[]>(`/credit-notes?${p}`);
    },
  });

  // Totals normalized to the caller's display currency (major units), so mixed-currency
  // credit notes sum honestly instead of being mislabeled with the first note's currency.
  const cn$ = (n: CreditNote) => ({ amount: n.amount_cents / 100, currency: n.currency });
  const totalPending  = sumInDisplay(creditNotes.filter(n => n.status === "pending_review").map(cn$)).value;
  const totalExecuted = sumInDisplay(creditNotes.filter(n => n.status === "executed").map(cn$)).value;
  const currency      = display;
  const mixedCurrency = new Set(creditNotes.map(n => n.currency)).size > 1;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">Credit Notes</h1>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">Manage refunds, billing corrections and goodwill credits</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors">
            <Plus size={13}/> New Credit Note
          </button>
        </div>

        {/* Key totals — the same telemetry-strip 3-card KPI used across the finance pages
            (Quotes / Expenses / Approvals), so credit notes no longer look like the odd one out. */}
        {creditNotes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="telemetry-strip">
              <div className="flex items-center gap-1.5 mb-1"><Clock size={11} className="text-[#c6892e]"/><span className="text-[11px] text-[var(--text-muted)]">Pending review</span></div>
              <div className="text-[17px] font-semibold" style={{ color: totalPending > 0 ? "#c6892e" : "var(--text-primary)" }}>{formatMoney(totalPending, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{creditNotes.filter(n => n.status === "pending_review").length} awaiting review</div>
            </div>
            <div className="telemetry-strip">
              <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-[#2f9e6b]"/><span className="text-[11px] text-[var(--text-muted)]">Executed</span></div>
              <div className="text-[17px] font-semibold" style={{ color: totalExecuted > 0 ? "#2f9e6b" : "var(--text-primary)" }}>{formatMoney(totalExecuted, currency)}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{creditNotes.filter(n => n.status === "executed").length} credit issued</div>
            </div>
            <div className="telemetry-strip">
              <div className="flex items-center gap-1.5 mb-1"><ReceiptText size={11} className="text-[var(--text-muted)]"/><span className="text-[11px] text-[var(--text-muted)]">All notes</span></div>
              <div className="text-[17px] font-semibold text-[var(--text-primary)]">{creditNotes.length}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{mixedCurrency ? `shown in ${display}` : "all statuses"}</div>
            </div>
          </div>
        )}

        {/* Filters + search — shared finance toolbar (identical on every finance list page) */}
        <FinanceListToolbar tabs={FILTERS} activeTab={statusFilter} onTab={setStatusFilter}
          search={search} onSearch={setSearch} placeholder="Search by client or reason…" />
      </div>

      {/* Table — finance reading order: who/why/state on the left, the MONEY right-aligned in
          tabular numerals (the premium finance convention), date last. */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6"><DelayedLoading onRetry={() => refetch()}><ConsoleSkeleton rows={6} cols={5} /></DelayedLoading></div>
        ) : isError ? (
          <div className="p-6"><ErrorState error={new Error("Couldn't load credit notes right now.")} onRetry={() => refetch()} /></div>
        ) : creditNotes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ReceiptText}
              title={statusFilter || search ? "Nothing matches this filter" : "No credit notes yet"}
              description={statusFilter || search
                ? "Clear the search or switch back to All to see every credit note."
                : "Refunds, billing corrections, and goodwill credits are tracked here through review and execution."}
              action={!statusFilter && !search ? (
                <button onClick={() => setShowNew(true)} className="btn-primary text-[12px] font-semibold"><Plus size={13} /> New credit note</button>
              ) : undefined}
            />
          </div>
        ) : (
          <table className="minimal-table">
            <thead>
              <tr className="border-b border-[var(--border-soft)]">
                {(["Client", "Reason", "Status", "AI Summary"] as const).map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-secondary)]">{h}</th>
                ))}
                <th className="px-4 py-2.5 text-right text-[11px] font-medium text-[var(--text-secondary)]">Amount</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-secondary)]">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {creditNotes.map(cn => {
                const cfg = STATUS_CONFIG[cn.status] ?? STATUS_CONFIG.draft;
                const Icon = cfg.icon;
                return (
                  <tr key={cn.id}
                    className="border-b border-[var(--border-soft)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                    onClick={() => navigate(`/finance/credit-notes/${cn.id}`)}>
                    <td className="px-4 py-3">
                      <div className="text-[12.5px] font-medium text-[var(--text-primary)]">{cn.client_name ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-[var(--text-faint)] rounded-full bg-[var(--surface-hover)] px-2 py-0.5">{REASON_LABELS[cn.credit_reason]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                        <Icon size={10}/>{cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {cn.ai_summary ? (
                        <div className="flex items-start gap-1.5">
                          <LogoMark size={10} className="text-[var(--text-faint)] mt-0.5 shrink-0"/>
                          <span className="text-[11px] text-[var(--text-muted)] truncate">{cn.ai_summary}</span>
                        </div>
                      ) : <span className="text-[11px] text-[var(--text-secondary)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{fmt(cn.amount_cents, cn.currency)}</td>
                    <td className="px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                      {new Date(cn.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight size={13} className="text-[var(--text-secondary)] transition-colors"/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewCreditNoteModal
          onClose={() => setShowNew(false)}
          onCreate={id => { qc.invalidateQueries({ queryKey: ["credit-notes"] }); navigate(`/finance/credit-notes/${id}`); }}
        />
      )}
    </div>
  );
}
