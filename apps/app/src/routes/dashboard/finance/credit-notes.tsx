import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useCurrency, formatMoney, currencyOptions } from "../../../hooks/useCurrency";
import { FieldSelect } from "../../../components/ui/controls";
import { DataTable, type DataTableColumn } from "../../../components/ui/data-table";
import { FinanceListToolbar, FinanceHeader } from "../../../components/finance/finance-toolbar";
import { KPIGrid, KPITile } from "../../../components/ui/kpi";
import { EmptyState, ErrorState, ConsoleSkeleton, DelayedLoading } from "../../../components/ui/page-state";
import {
  Plus, ReceiptText, Clock, CheckCircle2,
  XCircle, ChevronRight,
} from "lucide-react";
import { MoneyCell } from "../../../components/finance/money-cell";
import { Modal, ModalActions } from "@/components/ui/modal";

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
  draft:          { label: "Draft",          color: "text-[var(--text-secondary)] bg-stone-400/10",   icon: ReceiptText   },
  pending_review: { label: "Pending Review", color: "text-status-warn bg-status-warn/10",   icon: Clock         },
  verified:       { label: "Verified",       color: "text-status-neutral bg-status-neutral/10",   icon: CheckCircle2  },
  rejected:       { label: "Rejected",       color: "text-status-error bg-status-error/10",   icon: XCircle       },
  executed:       { label: "Executed",       color: "text-status-ok bg-status-ok/10",   icon: CheckCircle2  },
  void:           { label: "Void",           color: "text-[var(--text-faint)] bg-stone-600/10",   icon: XCircle       },
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
    <Modal title="New Credit Note" onClose={onClose} footer={
      <ModalActions onCancel={onClose}>
        <button onClick={submit} disabled={loading}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 text-label font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-50">
          {loading ? "Creating…" : "Create"}
        </button>
      </ModalActions>
    }>
      <div className="space-y-3">
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
            <div>
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Reason</label>
              <FieldSelect value={form.credit_reason} onChange={v => setForm(f => ({ ...f, credit_reason: v as CreditReason }))} ariaLabel="Reason"
                options={Object.entries(REASON_LABELS).map(([k, v]) => ({ value: k, label: v as string }))} />
            </div>
            <div>
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Initial status</label>
              <FieldSelect value={form.status} onChange={v => setForm(f => ({ ...f, status: v as CreditStatus }))} ariaLabel="Initial status"
                options={[{ value: "draft", label: "Draft" }, { value: "pending_review", label: "Submit for review" }]} />
            </div>
            <div className="col-span-2">
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Reason details…"
                className="key-input w-full text-sm resize-none"/>
            </div>
          </div>
          {error && <p className="text-label rounded-sm px-3 py-2" style={{ color: "#d1524a", background: "color-mix(in srgb, #d1524a 10%, transparent)" }}>{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const cnDateGB = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// Column model for the shared DataTable. Every cell renderer — the reason pill, status badge,
// AI-summary block, money formatting (fmt, unchanged) and date — stays HERE, so the shell knows
// no finance logic. Only the table markup moved; amount still reads cn.amount_cents as before.
const CREDIT_NOTE_COLUMNS: DataTableColumn<CreditNote>[] = [
  { key: "client", header: "Client", cell: (cn) => (
      <div className="text-body font-medium text-[var(--text-primary)]">{cn.client_name ?? "—"}</div>
    ) },
  { key: "reason", header: "Reason", cell: (cn) => (
      <span className="text-label text-[var(--text-faint)] rounded-full bg-[var(--surface-hover)] px-2 py-0.5">{REASON_LABELS[cn.credit_reason]}</span>
    ) },
  { key: "status", header: "Status", cell: (cn) => {
      const cfg = STATUS_CONFIG[cn.status] ?? STATUS_CONFIG.draft;
      const Icon = cfg.icon;
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium ${cfg.color}`}>
          <Icon size={10} />{cfg.label}
        </span>
      );
    } },
  { key: "ai_summary", header: "AI Summary", cellClassName: "max-w-[220px]", cell: (cn) => (
      cn.ai_summary ? (
        <div className="flex items-start gap-1.5">
          <LogoMark size={10} className="text-[var(--text-faint)] mt-0.5 shrink-0" />
          <span className="text-label text-[var(--text-muted)] truncate">{cn.ai_summary}</span>
        </div>
      ) : <span className="text-label text-[var(--text-secondary)]">—</span>
    ) },
  { key: "amount", header: "Amount", align: "right", cellClassName: "text-row font-semibold tabular-nums text-[var(--text-primary)]", cell: (cn) => <MoneyCell row={cn as unknown as Record<string, unknown>} align="right"/> },
  { key: "created", header: "Created", cellClassName: "text-label text-[var(--text-secondary)]", cell: (cn) => cnDateGB(cn.created_at) },
  { key: "chevron", header: "", cell: () => <ChevronRight size={13} className="text-[var(--text-secondary)] transition-colors" /> },
];

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
  const pendingSum  = sumInDisplay(creditNotes.filter(n => n.status === "pending_review").map(cn$));
  const executedSum = sumInDisplay(creditNotes.filter(n => n.status === "executed").map(cn$));
  const totalPending  = pendingSum.value;
  const totalExecuted = executedSum.value;
  // Retain `missing`: unlike currencies with no FX rate are summed at FACE VALUE, so the
  // figure must not be presented as exact.
  const approx = (n: number) => (n > 0 ? "~" : "");

  const currency      = display;
  const mixedCurrency = new Set(creditNotes.map(n => n.currency)).size > 1;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader icon={ReceiptText} callsign="CREDITS" title="Credit Notes" subtitle="Manage refunds, billing corrections and goodwill credits"
          action={
            <button onClick={() => setShowNew(true)}
              className="btn-primary h-7 shrink-0 gap-2 px-3 text-body font-semibold">
              <Plus size={13}/> New Credit Note
            </button>
          }
        />

        {/* Key totals — the same telemetry-strip 3-card KPI used across the finance pages
            (Quotes / Expenses / Approvals), so credit notes no longer look like the odd one out. */}
        {creditNotes.length > 0 && (
          <KPIGrid className="mb-4">
            <KPITile icon={Clock} iconColor="var(--status-warn)" valueColor={totalPending > 0 ? "#c6892e" : undefined} label="Pending review"
              value={<>{approx(pendingSum.missing)}{formatMoney(totalPending, currency)}</>}
              sub={<>{creditNotes.filter(n => n.status === "pending_review").length} awaiting review</>} />
            <KPITile icon={CheckCircle2} iconColor="var(--status-ok)" valueColor={totalExecuted > 0 ? "#2f9e6b" : undefined} label="Executed"
              value={<>{approx(executedSum.missing)}{formatMoney(totalExecuted, currency)}</>}
              sub={<>{creditNotes.filter(n => n.status === "executed").length} credit issued</>} />
            <KPITile icon={ReceiptText} label="All notes" value={creditNotes.length}
              sub={mixedCurrency ? `shown in ${display}` : "all statuses"} />
          </KPIGrid>
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
                <button onClick={() => setShowNew(true)} className="btn-primary font-semibold"><Plus size={13} /> New credit note</button>
              ) : undefined}
            />
          </div>
        ) : (
          // Presentational shell only — cell rendering, the status badge, the money value and the
          // row → detail navigation are all still owned by this page (below), unchanged.
          <DataTable<CreditNote>
            columns={CREDIT_NOTE_COLUMNS}
            rows={creditNotes}
            rowKey={(cn) => cn.id}
            onRowClick={(cn) => navigate(`/finance/credit-notes/${cn.id}`)}
          />
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
