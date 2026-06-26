import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import {
  ChevronLeft, ReceiptText, Clock, CheckCircle2, XCircle,
  Link2, User, FileText, AlertTriangle, RefreshCcw,
} from "lucide-react";

type CreditReason = "refund" | "billing_error" | "goodwill" | "contract_discount";
type CreditStatus = "draft" | "pending_review" | "manager_approved" | "executed" | "void";

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
  draft:            { label: "Draft",            color: "text-stone-400",   dot: "bg-stone-400",   icon: ReceiptText   },
  pending_review:   { label: "Pending Review",   color: "text-amber-400",  dot: "bg-amber-400",  icon: Clock         },
  manager_approved: { label: "Approved",         color: "text-blue-400",   dot: "bg-blue-400",   icon: CheckCircle2  },
  executed:         { label: "Executed",         color: "text-emerald-400",dot: "bg-emerald-400",icon: CheckCircle2  },
  void:             { label: "Void",             color: "text-stone-600",   dot: "bg-stone-600",   icon: XCircle       },
};

const REASON_LABELS: Record<CreditReason, string> = {
  refund:            "Refund",
  billing_error:     "Billing Error",
  goodwill:          "Goodwill",
  contract_discount: "Contract Discount",
};

// State machine — which transitions are available from a given status
const TRANSITIONS: Record<CreditStatus, { to: CreditStatus; label: string; style: string }[]> = {
  draft:            [{ to: "pending_review", label: "Submit for review",  style: "text-amber-300 bg-amber-400/10 border-amber-400/20 hover:bg-amber-400/20" }, { to: "void", label: "Void", style: "text-stone-500 bg-white/[.03] border-white/[.06] hover:bg-white/[.05]" }],
  pending_review:   [{ to: "manager_approved", label: "Approve",         style: "text-blue-300 bg-blue-400/10 border-blue-400/20 hover:bg-blue-400/20" },   { to: "void", label: "Void", style: "text-stone-500 bg-white/[.03] border-white/[.06] hover:bg-white/[.05]" }],
  manager_approved: [{ to: "executed", label: "Execute credit",          style: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20 hover:bg-emerald-400/20" }, { to: "void", label: "Void", style: "text-stone-500 bg-white/[.03] border-white/[.06] hover:bg-white/[.05]" }],
  executed:         [],
  void:             [],
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

  async function applyToInvoice() {
    if (!linkInvoiceId) return;
    setLinkingInvoice(true);
    try {
      await apiClient.post(`/credit-notes/${creditNoteId}/apply-to-invoice`, { invoice_id: linkInvoiceId });
      qc.invalidateQueries({ queryKey: ["credit-note", creditNoteId] });
    } finally { setLinkingInvoice(false); }
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-[12px] text-stone-600">Loading…</div>;
  if (isError || !cn) return <div className="flex h-full items-center justify-center text-[12px] text-stone-400">Credit note not found.</div>;

  const cfg = STATUS_CONFIG[cn.status];
  const Icon = cfg.icon;
  const transitions = TRANSITIONS[cn.status];
  const linkedInvoice = invoices.find(i => i.id === cn.edges?.["APPLIED_TO"]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[.06] px-6 py-3 shrink-0">
        <Link to="/finance/credit-notes" className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-white transition-colors">
          <ChevronLeft size={13}/> Credit Notes
        </Link>
        <span className="text-stone-700">/</span>
        <span className="text-[12px] text-stone-400">{cn.client_name ?? cn.id.slice(0, 8)}</span>
        <div className="ml-auto flex items-center gap-2">
          {patchMutation.isPending && <span className="text-[11px] text-stone-600 animate-pulse">Saving…</span>}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Left panel ── */}
        <aside className="w-[260px] shrink-0 border-r border-white/[.06] flex flex-col overflow-y-auto">
          <div className="p-5 space-y-5 border-b border-white/[.06]">
            {/* Icon + amount */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-stone-500/15 flex items-center justify-center shrink-0">
                <ReceiptText size={18} className="text-stone-400"/>
              </div>
              <div>
                <div className="text-[18px] font-bold text-white">{fmt(cn.amount_cents, cn.currency)}</div>
                <div className="text-[11px] text-stone-500">{cn.client_name ?? "No client"}</div>
              </div>
            </div>

            {/* Status pill */}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-stone-600 mb-1.5">Status</p>
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${cfg.color} border-current/20 bg-current/5`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}/>
                <Icon size={11}/>{cfg.label}
              </div>
            </div>

            {/* Reason */}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-stone-600 mb-1">Reason</p>
              <span className="text-[12px] text-stone-300">{REASON_LABELS[cn.credit_reason]}</span>
            </div>

            {/* Dates */}
            <div className="space-y-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-stone-600 mb-0.5">Created</p>
                <span className="text-[11px] text-stone-500">{relativeTime(cn.created_at)}</span>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-stone-600 mb-0.5">Last updated</p>
                <span className="text-[11px] text-stone-500">{relativeTime(cn.updated_at)}</span>
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="p-4 space-y-4 border-b border-white/[.06]">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-stone-600 mb-2">Linked invoice</p>
              {linkedInvoice ? (
                <Link to={`/finance/invoices/${linkedInvoice.id}`}
                  className="flex items-center gap-2 rounded-lg border border-white/[.06] bg-white/[.02] px-2.5 py-2 text-[12px] text-stone-300 hover:text-white hover:border-white/[.10] transition-colors">
                  <FileText size={11} className="text-stone-600 shrink-0"/>
                  <span className="truncate">{linkedInvoice.number} · {linkedInvoice.client_name}</span>
                </Link>
              ) : (
                <div className="space-y-1.5">
                  <select value={linkInvoiceId} onChange={e => setLinkInvoiceId(e.target.value)}
                    className="key-input w-full text-[11px]">
                    <option value="">Select invoice…</option>
                    {invoices.map(i => <option key={i.id} value={i.id}>{i.number} · {i.client_name}</option>)}
                  </select>
                  <button onClick={applyToInvoice} disabled={!linkInvoiceId || linkingInvoice}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[.07] bg-white/[.02] px-2 py-1.5 text-[11px] text-stone-400 hover:text-white hover:bg-white/[.05] transition-colors disabled:opacity-40">
                    <Link2 size={10}/>{linkingInvoice ? "Linking…" : "Apply to invoice"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* State machine actions */}
          {transitions.length > 0 && (
            <div className="p-4 space-y-2">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-stone-600 mb-2">Actions</p>
              {transitions.map(t => (
                <button key={t.to}
                  onClick={() => { setTransitioning(t.to); patchMutation.mutate({ status: t.to }); }}
                  disabled={patchMutation.isPending}
                  className={`w-full rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-40 ${t.style}`}>
                  {transitioning === t.to && patchMutation.isPending ? "Processing…" : t.label}
                </button>
              ))}
              {transitionError && (
                <div className="flex items-start gap-1.5 rounded-lg border border-stone-500/30 bg-stone-600/[.06] px-3 py-2 text-[11px] text-stone-400">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                  {transitionError}
                </div>
              )}
            </div>
          )}
          {cn.status === "executed" && (
            <div className="p-4">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[.06] px-3 py-2.5 text-[11px] text-emerald-400">
                <CheckCircle2 size={13} className="shrink-0"/><span>This credit note has been executed and is final.</span>
              </div>
            </div>
          )}
        </aside>

        {/* ── Right panel ── */}
        <main className="flex-1 overflow-auto p-6 space-y-6 max-w-2xl">
          {/* AI summary */}
          {cn.ai_summary && (
            <div className="rounded-xl border border-stone-500/30 bg-stone-600/[.04] p-4">
              <div className="flex items-center gap-2 mb-2">
                <LogoMark size={12} className="text-stone-400"/>
                <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">AI Summary</span>
              </div>
              <p className="text-[13px] text-stone-300 leading-relaxed">{cn.ai_summary}</p>
            </div>
          )}

          {/* Notes */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600 mb-3">Notes</p>
            <NoteEditor
              initialValue={cn.notes ?? ""}
              onSave={v => patchMutation.mutate({ notes: v })}
            />
          </div>

          {/* Edit amount/reason for draft */}
          {cn.status === "draft" && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-600 mb-3">Edit details</p>
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
      className="w-full resize-none rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3 text-[13px] text-stone-300 placeholder-stone-700 outline-none focus:border-white/[.12] leading-relaxed transition-colors"
    />
  );
}

function DraftEditor({ creditNote: cn, onSave }: { creditNote: CreditNote; onSave: (b: Partial<CreditNote>) => void }) {
  const [amount, setAmount] = useState(String(cn.amount_cents / 100));
  const [reason, setReason] = useState<CreditReason>(cn.credit_reason);
  const [clientName, setClientName] = useState(cn.client_name ?? "");

  function save() {
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents <= 0) return;
    onSave({ amount_cents: cents, credit_reason: reason, client_name: clientName || undefined });
  }

  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Client name</label>
          <input value={clientName} onChange={e => setClientName(e.target.value)} onBlur={save} className="key-input w-full text-sm"/>
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Amount ({cn.currency})</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} onBlur={save} type="number" min="0" step="0.01" className="key-input w-full text-sm"/>
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Credit reason</label>
          <select value={reason} onChange={e => { setReason(e.target.value as CreditReason); }} onBlur={save} className="key-input w-full text-sm">
            <option value="refund">Refund</option>
            <option value="billing_error">Billing Error</option>
            <option value="goodwill">Goodwill</option>
            <option value="contract_discount">Contract Discount</option>
          </select>
        </div>
      </div>
    </div>
  );
}
