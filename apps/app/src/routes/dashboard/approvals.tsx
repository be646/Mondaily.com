import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, Sparkles,
  ReceiptText, ChevronRight, AlertTriangle,
} from "lucide-react";

type CreditStatus = "draft" | "pending_review" | "manager_approved" | "executed" | "void";
type CreditReason = "refund" | "billing_error" | "goodwill" | "contract_discount";

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
}

const REASON_LABELS: Record<CreditReason, string> = {
  refund: "Refund", billing_error: "Billing Error", goodwill: "Goodwill", contract_discount: "Contract Discount",
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
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function CreditNoteCard({ cn, onTransition, busy }: {
  cn: CreditNote;
  onTransition: (id: string, status: CreditStatus) => void;
  busy: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const isPending  = cn.status === "pending_review";
  const isApproved = cn.status === "manager_approved";

  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-4 hover:border-white/[.09] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
            <ReceiptText size={15} className="text-violet-400"/>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-white">{fmt(cn.amount_cents, cn.currency)}</div>
            <div className="text-[11px] text-zinc-500">{cn.client_name ?? "Unknown client"} · {REASON_LABELS[cn.credit_reason]}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isPending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 text-[10px] font-medium text-amber-400">
              <Clock size={9}/> Pending
            </span>
          )}
          {isApproved && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/10 border border-blue-400/20 px-2.5 py-0.5 text-[10px] font-medium text-blue-400">
              <CheckCircle2 size={9}/> Approved
            </span>
          )}
          <span className="text-[10px] text-zinc-700">{relativeTime(cn.created_at)}</span>
        </div>
      </div>

      {cn.ai_summary && (
        <div className="flex items-start gap-1.5 rounded-lg bg-violet-500/[.04] border border-violet-500/10 px-3 py-2 mb-3">
          <Sparkles size={10} className="text-violet-400 mt-0.5 shrink-0"/>
          <p className="text-[11px] text-zinc-400 leading-relaxed">{cn.ai_summary}</p>
        </div>
      )}
      {cn.notes && !cn.ai_summary && (
        <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed line-clamp-2">{cn.notes}</p>
      )}

      {error && (
        <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[.05] px-3 py-2 text-[11px] text-red-400 mb-3">
          <AlertTriangle size={10} className="shrink-0"/>{error}
        </div>
      )}

      <div className="flex items-center gap-2">
        {isPending && (
          <>
            <button
              onClick={() => { setError(null); onTransition(cn.id, "manager_approved"); }}
              disabled={busy}
              className="flex-1 rounded-lg border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[12px] font-medium text-blue-300 hover:bg-blue-400/20 transition-colors disabled:opacity-40">
              {busy ? "Processing…" : "Approve"}
            </button>
            <button
              onClick={() => { setError(null); onTransition(cn.id, "void"); }}
              disabled={busy}
              className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2 text-[12px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[.04] transition-colors disabled:opacity-40">
              Void
            </button>
          </>
        )}
        {isApproved && (
          <>
            <button
              onClick={() => { setError(null); onTransition(cn.id, "executed"); }}
              disabled={busy}
              className="flex-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[12px] font-medium text-emerald-300 hover:bg-emerald-400/20 transition-colors disabled:opacity-40">
              {busy ? "Processing…" : "Execute credit"}
            </button>
            <button
              onClick={() => { setError(null); onTransition(cn.id, "void"); }}
              disabled={busy}
              className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2 text-[12px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[.04] transition-colors disabled:opacity-40">
              Void
            </button>
          </>
        )}
        <Link to={`/finance/credit-notes/${cn.id}`}
          className="ml-auto flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors">
          Details <ChevronRight size={11}/>
        </Link>
      </div>
    </div>
  );
}

export function ApprovalsPage() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "approved">("pending");

  const { data: allNotes = [], isLoading } = useQuery<CreditNote[]>({
    queryKey: ["approvals"],
    queryFn: () => apiClient.get<CreditNote[]>("/credit-notes"),
    refetchInterval: 30_000,
  });

  const pending  = allNotes.filter(n => n.status === "pending_review");
  const approved = allNotes.filter(n => n.status === "manager_approved");
  const executed = allNotes.filter(n => n.status === "executed");

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CreditStatus }) =>
      apiClient.patch<CreditNote>(`/credit-notes/${id}`, { status }),
    onMutate: ({ id }) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["credit-notes"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const shown = tab === "pending" ? pending : approved;
  const currency = allNotes[0]?.currency ?? "GBP";
  const totalPending  = pending.reduce((s, n) => s + n.amount_cents, 0);
  const totalApproved = approved.reduce((s, n) => s + n.amount_cents, 0);
  const totalExecuted = executed.reduce((s, n) => s + n.amount_cents, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-white/[.06] px-6 py-4 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-7 w-7 rounded-xl bg-red-500/15 flex items-center justify-center">
            <ShieldCheck size={14} className="text-red-400"/>
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-white">Approval Dashboard</h1>
            <p className="text-[12px] text-zinc-500">Review and authorise credit notes across the workspace</p>
          </div>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-1.5 mb-1"><Clock size={11} className="text-amber-400"/><span className="text-[11px] text-zinc-500">Awaiting approval</span></div>
            <div className="text-[17px] font-semibold text-amber-400">{fmt(totalPending, currency)}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{pending.length} note{pending.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-blue-400"/><span className="text-[11px] text-zinc-500">Approved, not executed</span></div>
            <div className="text-[17px] font-semibold text-blue-400">{fmt(totalApproved, currency)}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{approved.length} note{approved.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-emerald-400"/><span className="text-[11px] text-zinc-500">Executed this period</span></div>
            <div className="text-[17px] font-semibold text-emerald-400">{fmt(totalExecuted, currency)}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{executed.length} note{executed.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 border-b border-white/[.04] -mb-4">
          {([["pending", `Pending (${pending.length})`], ["approved", `Approved (${approved.length})`]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative px-3.5 py-2.5 text-[12px] font-medium transition-colors ${tab === key ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
              {label}
              {tab === key && <span className="absolute bottom-0 left-0 right-0 h-px bg-red-500"/>}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading && <div className="flex h-40 items-center justify-center text-[12px] text-zinc-600">Loading…</div>}
        {!isLoading && shown.length === 0 && (
          <div className="flex h-56 flex-col items-center justify-center gap-3">
            {tab === "pending"
              ? <><Clock size={32} className="text-zinc-700"/><div className="text-[13px] text-zinc-500">No credit notes pending approval</div></>
              : <><CheckCircle2 size={32} className="text-zinc-700"/><div className="text-[13px] text-zinc-500">No approved credit notes awaiting execution</div></>
            }
            <Link to="/finance/credit-notes" className="text-[12px] text-red-400 hover:text-red-300 transition-colors">View all credit notes →</Link>
          </div>
        )}
        <div className="space-y-3 max-w-2xl">
          {shown.map(cn => (
            <CreditNoteCard
              key={cn.id}
              cn={cn}
              busy={busyId === cn.id}
              onTransition={(id, status) => transitionMutation.mutate({ id, status })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
