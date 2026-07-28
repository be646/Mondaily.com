import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { AIButton } from "@/components/ui/ai-button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import {
  ChevronLeft, ReceiptText, Clock, CheckCircle2, XCircle,
  Link2, User, FileText, AlertTriangle, RefreshCcw,
} from "lucide-react";
import { FieldSelect } from "../../../components/ui/controls";

type CreditReason = "refund" | "billing_error" | "goodwill" | "contract_discount";
// Mirrors the backend state machine (packages/api/src/routes/credit-notes.ts):
// draft → pending_review → verified → executed, with rejected + void as branches.
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
  created_by?: string;
  edges?: Record<string, string>;
}

const STATUS_CONFIG: Record<CreditStatus, { label: string; color: string; dot: string; icon: React.ElementType }> = {
  draft:            { label: "Draft",          color: "text-stone-400",   dot: "bg-stone-400",   icon: ReceiptText   },
  pending_review:   { label: "Pending Review", color: "text-status-warn",   dot: "bg-status-warn",   icon: Clock         },
  verified:         { label: "Verified",       color: "text-status-neutral",   dot: "bg-status-neutral",   icon: CheckCircle2  },
  rejected:         { label: "Rejected",       color: "text-status-error",   dot: "bg-status-error",   icon: XCircle       },
  executed:         { label: "Executed",       color: "text-status-ok",   dot: "bg-status-ok",   icon: CheckCircle2  },
  void:             { label: "Void",           color: "text-stone-600",   dot: "bg-stone-600",   icon: XCircle       },
};

const REASON_LABELS: Record<CreditReason, string> = {
  refund:            "Refund",
  billing_error:     "Billing Error",
  goodwill:          "Goodwill",
  contract_discount: "Contract Discount",
};

// State machine — mirrors the backend's VALID_TRANSITIONS. Only the moves the API
// accepts are offered, so no button ever produces a 422/400.
const VOID_ACTION = { to: "void" as const, label: "Void", style: "text-[var(--text-muted)] bg-[var(--surface-hover)] border-[var(--border-soft)] hover:bg-[var(--surface-hover)]" };
const REJECT_ACTION = { to: "rejected" as const, label: "Reject", style: "text-status-error bg-status-error/10 border-status-error/25 hover:bg-status-error/20" };
const TRANSITIONS: Record<CreditStatus, { to: CreditStatus; label: string; style: string }[]> = {
  draft:          [{ to: "pending_review", label: "Submit for review", style: "text-status-warn bg-status-warn/10 border-status-warn/25 hover:bg-status-warn/20" }, VOID_ACTION],
  pending_review: [{ to: "verified", label: "Approve", style: "text-status-neutral bg-status-neutral/10 border-status-neutral/25 hover:bg-status-neutral/20" }, REJECT_ACTION, VOID_ACTION],
  verified:       [{ to: "executed", label: "Execute credit", style: "text-status-ok bg-status-ok/10 border-status-ok/25 hover:bg-status-ok/20" }, REJECT_ACTION, VOID_ACTION],
  rejected:       [{ to: "pending_review", label: "Re-open for review", style: "text-status-warn bg-status-warn/10 border-status-warn/25 hover:bg-status-warn/20" }, VOID_ACTION],
  executed:       [],
  void:           [],
};

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function CreditNoteDetailPage() {
  const { creditNoteId } = useParams<{ creditNoteId: string }>();
  const qc = useQueryClient();
  const [transitioning, setTransitioning] = useState<CreditStatus | null>(null);
  const [linkInvoiceId, setLinkInvoiceId] = useState("");
  const [linkingInvoice, setLinkingInvoice] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const { data: cn, isLoading, isError } = useQuery<CreditNote>({
    queryKey: ["credit-note", creditNoteId],
    queryFn: () => apiClient.get<CreditNote>(`/credit-notes/${creditNoteId}`),
  });

  const { data: invoices = [] } = useQuery<{ id: string; number: string; client_name: string }[]>({
    queryKey: ["invoices"],
    queryFn: () => apiClient.get("/invoices"),
    staleTime: 60_000,
  });

  const patchMutation = useMutation({
    mutationFn: (body: Partial<CreditNote>) => apiClient.patch<CreditNote>(`/credit-notes/${creditNoteId}`, body),
    onSuccess: (updated) => {
      qc.setQueryData(["credit-note", creditNoteId], updated);
      qc.invalidateQueries({ queryKey: ["credit-notes"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setTransitioning(null);
      setTransitionError(null);
    },
    onError: (e: Error) => { setTransitionError(e.message); setTransitioning(null); },
  });

  // On-demand AI summary — grounded in the note's real fields, persisted server-side.
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summarize = useMutation({
    mutationFn: () => apiClient.post<{ ai_summary?: string; error?: string }>(`/credit-notes/${creditNoteId}/summarize`, {}),
    onSuccess: (res) => {
      if (res.error) { setSummaryError(res.error); return; }
      setSummaryError(null);
      qc.setQueryData<CreditNote>(["credit-note", creditNoteId], prev => prev ? { ...prev, ai_summary: res.ai_summary } : prev);
      qc.invalidateQueries({ queryKey: ["credit-notes"] });
    },
    onError: (e: Error) => setSummaryError(e.message),
  });

  async function applyToInvoice() {
    if (!linkInvoiceId) return;
    setLinkingInvoice(true);
    try {
      await apiClient.post(`/credit-notes/${creditNoteId}/apply-to-invoice`, { invoice_id: linkInvoiceId });
      qc.invalidateQueries({ queryKey: ["credit-note", creditNoteId] });
    } finally { setLinkingInvoice(false); }
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-body text-[var(--text-secondary)]">Loading…</div>;
  if (isError || !cn) return <div className="flex h-full items-center justify-center text-body text-[var(--text-faint)]">Credit note not found.</div>;

  const cfg = STATUS_CONFIG[cn.status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  const transitions = TRANSITIONS[cn.status] ?? [];
  const linkedInvoice = invoices.find(i => i.id === cn.edges?.["APPLIED_TO"]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-6 py-3 shrink-0">
        <Link to="/finance/credit-notes" className="flex items-center gap-1 text-body text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronLeft size={13}/> Credit Notes
        </Link>
        <span className="text-[var(--text-secondary)]">/</span>
        <span className="text-body text-[var(--text-faint)]">{cn.client_name ?? cn.id.slice(0, 8)}</span>
        <div className="ml-auto flex items-center gap-2">
          {patchMutation.isPending && <span className="text-label text-[var(--text-secondary)] animate-pulse">Saving…</span>}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Left panel ── */}
        <aside className="w-[260px] shrink-0 border-r border-[var(--border-soft)] flex flex-col overflow-y-auto">
          <div className="p-5 space-y-5 border-b border-[var(--border-soft)]">
            {/* Icon + amount */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-sm bg-stone-500/15 flex items-center justify-center shrink-0">
                <ReceiptText size={18} className="text-[var(--text-faint)]"/>
              </div>
              <div>
                <div className="text-stat font-bold text-[var(--text-primary)]">{fmt(cn.amount_cents, cn.currency)}</div>
                <div className="text-label text-[var(--text-muted)]">{cn.client_name ?? "No client"}</div>
              </div>
            </div>

            {/* Status pill */}
            <div>
              <p className="text-caption font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-1.5">Status</p>
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-label font-medium ${cfg.color} border-current/20 bg-current/5`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}/>
                <Icon size={11}/>{cfg.label}
              </div>
            </div>

            {/* Reason */}
            <div>
              <p className="text-caption font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-1">Reason</p>
              <span className="text-body text-[var(--text-faint)]">{REASON_LABELS[cn.credit_reason]}</span>
            </div>

            {/* Dates */}
            <div className="space-y-2">
              <div>
                <p className="text-caption font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5">Created</p>
                <span className="text-label text-[var(--text-muted)]">{relativeTime(cn.created_at)}</span>
              </div>
              <div>
                <p className="text-caption font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5">Last updated</p>
                <span className="text-label text-[var(--text-muted)]">{relativeTime(cn.updated_at)}</span>
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="p-4 space-y-4 border-b border-[var(--border-soft)]">
            <div>
              <p className="text-caption font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2">Linked invoice</p>
              {linkedInvoice ? (
                <Link to={`/finance/invoices/${linkedInvoice.id}`}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-2 text-body text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:border-[var(--border-soft)] transition-colors">
                  <FileText size={11} className="text-[var(--text-secondary)] shrink-0"/>
                  <span className="truncate">{linkedInvoice.number} · {linkedInvoice.client_name}</span>
                </Link>
              ) : (
                <div className="space-y-1.5">
                  <FieldSelect
                    value={linkInvoiceId}
                    onChange={v => setLinkInvoiceId(v)}
                    ariaLabel="Link invoice"
                    placeholder="Select invoice…"
                    options={invoices.map(i => ({ value: i.id, label: `${i.number} · ${i.client_name}` }))}
                  />
                  <button onClick={applyToInvoice} disabled={!linkInvoiceId || linkingInvoice}
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-1.5 text-label text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40">
                    <Link2 size={10}/>{linkingInvoice ? "Linking…" : "Apply to invoice"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* State machine actions */}
          {transitions.length > 0 && (
            <div className="p-4 space-y-2">
              <p className="text-caption font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2">Actions</p>
              {transitions.map(t => (
                <button key={t.to}
                  onClick={() => { setTransitioning(t.to); patchMutation.mutate({ status: t.to }); }}
                  disabled={patchMutation.isPending}
                  className={`w-full rounded-lg border px-3 py-2 text-body font-medium transition-colors disabled:opacity-40 ${t.style}`}>
                  {transitioning === t.to && patchMutation.isPending ? "Processing…" : t.label}
                </button>
              ))}
              {transitionError && (
                <div className="flex items-start gap-1.5 rounded-lg border border-stone-500/30 bg-stone-600/[.06] px-3 py-2 text-label text-[var(--text-faint)]">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                  {transitionError}
                </div>
              )}
            </div>
          )}
          {cn.status === "executed" && (
            <div className="p-4">
              <div className="flex items-center gap-2 rounded-lg border border-status-ok/25 bg-status-ok/[.06] px-3 py-2.5 text-label text-status-ok">
                <CheckCircle2 size={13} className="shrink-0"/><span>This credit note has been executed and is final.</span>
              </div>
            </div>
          )}
        </aside>

        {/* ── Right panel ── */}
        <main className="flex-1 overflow-auto p-6 space-y-6 max-w-2xl">
          {/* AI summary — generated on demand from the note's real fields, persisted server-side. */}
          <div className="rounded-sm border border-stone-500/30 bg-stone-600/[.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <LogoMark size={12} className="text-[var(--text-faint)]"/>
              <span className="text-label font-semibold text-[var(--text-faint)] uppercase tracking-wider">AI Summary</span>
              <AIButton variant="subtle" size="sm" className="ml-auto" loading={summarize.isPending} onClick={() => summarize.mutate()}>
                {cn.ai_summary ? "Regenerate" : "Generate"}
              </AIButton>
            </div>
            {cn.ai_summary ? (
              <p className="text-row text-[var(--text-faint)] leading-relaxed">{cn.ai_summary}</p>
            ) : (
              <p className="text-body text-[var(--text-secondary)]">No summary yet — generate a grounded one-line recap from this note's amount, reason, and status.</p>
            )}
            {summaryError && <p className="mt-2 text-label text-status-error">{summaryError}</p>}
          </div>

          {/* Notes */}
          <div>
            <p className="text-label font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-3">Notes</p>
            <NoteEditor
              initialValue={cn.notes ?? ""}
              onSave={v => patchMutation.mutate({ notes: v })}
            />
          </div>

          {/* Edit amount/reason for draft */}
          {cn.status === "draft" && (
            <div>
              <p className="text-label font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-3">Edit details</p>
              <DraftEditor creditNote={cn} onSave={body => patchMutation.mutate(body)}/>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function NoteEditor({ initialValue, onSave }: { initialValue: string; onSave: (v: string) => void }) {
  const [val, setVal] = useState(initialValue);
  return (
    <textarea
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => { if (val !== initialValue) onSave(val); }}
      placeholder="Add internal notes here…"
      rows={5}
      className="w-full resize-none rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-3 text-row text-[var(--text-faint)] placeholder-stone-700 outline-none focus:border-[var(--border-soft)] leading-relaxed transition-colors"
    />
  );
}

function DraftEditor({ creditNote: cn, onSave }: { creditNote: CreditNote; onSave: (b: Partial<CreditNote>) => void }) {
  const [amount, setAmount] = useState(String(cn.amount_cents / 100));
  const [reason, setReason] = useState<CreditReason>(cn.credit_reason);
  const [clientName, setClientName] = useState(cn.client_name ?? "");

  function save(reasonOverride?: CreditReason) {
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents <= 0) return;
    onSave({ amount_cents: cents, credit_reason: reasonOverride ?? reason, client_name: clientName || undefined });
  }

  return (
    <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Client name</label>
          <input value={clientName} onChange={e => setClientName(e.target.value)} onBlur={() => save()} className="key-input w-full"/>
        </div>
        <div>
          <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Amount ({cn.currency})</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => save()} type="number" min="0" step="0.01" className="key-input w-full"/>
        </div>
        <div className="col-span-2">
          <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Credit reason</label>
          <FieldSelect
            value={reason}
            onChange={v => { setReason(v as CreditReason); save(v as CreditReason); }}
            ariaLabel="Reason"
            options={[
              { value: "refund", label: "Refund" },
              { value: "billing_error", label: "Billing Error" },
              { value: "goodwill", label: "Goodwill" },
              { value: "contract_discount", label: "Contract Discount" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
