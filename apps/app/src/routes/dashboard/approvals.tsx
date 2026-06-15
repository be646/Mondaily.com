import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, Sparkles,
  ReceiptText, ChevronRight, AlertTriangle, UserCircle2,
} from "lucide-react";

type CreditStatus = "draft" | "pending_review" | "verified" | "rejected" | "executed" | "void";
type CreditReason = "refund" | "billing_error" | "goodwill" | "contract_discount";

interface ApprovalEntry {
  user_id: string;
  action: string;
  note: string | null;
  at: string;
}

interface CreditNote {
  id: string;
  amount_cents: number;
  currency: string;
  credit_reason: CreditReason;
  status: CreditStatus;
  client_name?: string;
  ai_summary?: string;
  notes?: string;
  approvals?: ApprovalEntry[];
  created_at: string;
  updated_at: string;
  created_by?: string;
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

function ApprovalTrail({ approvals }: { approvals?: ApprovalEntry[] }) {
  if (!approvals?.length) return null;
  return (
    <div className="mb-3 space-y-1.5">
      {approvals.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px] text-zinc-500">
          <UserCircle2 size={12} className="mt-0.5 shrink-0 text-zinc-600" />
          <span>
            <span className="text-zinc-400">{entry.user_id.slice(0, 8)}</span>
            {" "}
            <span className={
              entry.action === "verified" ? "text-blue-400" :
              entry.action === "executed" ? "text-emerald-400" :
              entry.action === "rejected" ? "text-red-400" :
              "text-zinc-500"
            }>{entry.action}</span>
            {" · "}{relativeTime(entry.at)}
            {entry.note && <span className="block pl-3.5 text-zinc-600 italic">"{entry.note}"</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

type TabKey = "pending_review" | "verified" | "rejected";

function CreditNoteCard({ cn, tab, onTransition, busy }: {
  cn: CreditNote;
  tab: TabKey;
  onTransition: (id: string, status: CreditStatus, note?: string) => void;
  busy: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  function doTransition(status: CreditStatus, note?: string) {
    setError(null);
    onTransition(cn.id, status, note);
  }

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
          {cn.status === "pending_review" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 text-[10px] font-medium text-amber-400">
              <Clock size={9}/> Needs Review
            </span>
          )}
          {cn.status === "verified" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/10 border border-blue-400/20 px-2.5 py-0.5 text-[10px] font-medium text-blue-400">
              <CheckCircle2 size={9}/> Verified
            </span>
          )}
          {cn.status === "rejected" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-400/10 border border-red-400/20 px-2.5 py-0.5 text-[10px] font-medium text-red-400">
              <XCircle size={9}/> Rejected
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

      <ApprovalTrail approvals={cn.approvals} />

      {error && (
        <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[.05] px-3 py-2 text-[11px] text-red-400 mb-3">
          <AlertTriangle size={10} className="shrink-0"/>{error}
        </div>
      )}

      {rejectOpen && (
        <div className="mb-3">
          <textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder="Reason for rejection (optional)"
            rows={2}
            className="key-input w-full resize-none px-3 py-2 text-[12px]"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => { doTransition("rejected", rejectNote || undefined); setRejectOpen(false); }}
              disabled={busy}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40">
              Confirm Reject
            </button>
            <button onClick={() => setRejectOpen(false)} className="rounded-lg border border-white/[.06] px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {tab === "pending_review" && (
          <>
            <button
              onClick={() => doTransition("verified")}
              disabled={busy}
              className="flex-1 rounded-lg border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[12px] font-medium text-blue-300 hover:bg-blue-400/20 transition-colors disabled:opacity-40">
              {busy ? "Processing…" : "Approve → Verified"}
            </button>
            {!rejectOpen && (
              <button
                onClick={() => setRejectOpen(true)}
                disabled={busy}
                className="rounded-lg border border-red-500/20 bg-red-500/[.05] px-3 py-2 text-[12px] text-red-400 hover:bg-red-500/[.1] transition-colors disabled:opacity-40">
                Reject
              </button>
            )}
          </>
        )}
        {tab === "verified" && (
          <>
            <button
              onClick={() => doTransition("executed")}
              disabled={busy}
              className="flex-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[12px] font-medium text-emerald-300 hover:bg-emerald-400/20 transition-colors disabled:opacity-40">
              {busy ? "Processing…" : "Execute credit"}
            </button>
            {!rejectOpen && (
              <button
                onClick={() => setRejectOpen(true)}
                disabled={busy}
                className="rounded-lg border border-red-500/20 bg-red-500/[.05] px-3 py-2 text-[12px] text-red-400 hover:bg-red-500/[.1] transition-colors disabled:opacity-40">
                Reject
              </button>
            )}
          </>
        )}
        {tab === "rejected" && (
          <button
            onClick={() => doTransition("pending_review")}
            disabled={busy}
            className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-white/[.04] transition-colors disabled:opacity-40">
            {busy ? "Processing…" : "Resubmit"}
          </button>
        )}
        <Link to={`/finance/credit-notes/${cn.id}`}
          className="ml-auto flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors">
          Details <ChevronRight size={11}/>
        </Link>
      </div>
    </div>
  );
}

const TABS: { key: TabKey; label: string; desc: string }[] = [
  { key: "pending_review", label: "Needs Review",   desc: "Awaiting reviewer sign-off" },
  { key: "verified",       label: "Needs Approval", desc: "Awaiting final execution" },
  { key: "rejected",       label: "Rejected",       desc: "Bounced back for revision" },
];

export function ApprovalsPage() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("pending_review");

  const { data: allNotes = [], isLoading } = useQuery<CreditNote[]>({
    queryKey: ["approvals"],
    queryFn: () => apiClient.get<CreditNote[]>("/credit-notes"),
    refetchInterval: 30_000,
  });

  const pending  = allNotes.filter(n => n.status === "pending_review");
  const verified = allNotes.filter(n => n.status === "verified");
  const rejected = allNotes.filter(n => n.status === "rejected");
  const executed = allNotes.filter(n => n.status === "executed");

  const transitionMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: CreditStatus; note?: string }) =>
      apiClient.patch<CreditNote>(`/credit-notes/${id}`, { status, ...(note ? { note } : {}) }),
    onMutate: ({ id }) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["credit-notes"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const shown = tab === "pending_review" ? pending : tab === "verified" ? verified : rejected;
  const currency = allNotes[0]?.currency ?? "GBP";
  const totalPending  = pending.reduce((s, n) => s + n.amount_cents, 0);
  const totalVerified = verified.reduce((s, n) => s + n.amount_cents, 0);
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
            <div className="flex items-center gap-1.5 mb-1"><Clock size={11} className="text-amber-400"/><span className="text-[11px] text-zinc-500">Needs review</span></div>
            <div className="text-[17px] font-semibold text-amber-400">{fmt(totalPending, currency)}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{pending.length} note{pending.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-blue-400"/><span className="text-[11px] text-zinc-500">Verified, not executed</span></div>
            <div className="text-[17px] font-semibold text-blue-400">{fmt(totalVerified, currency)}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{verified.length} note{verified.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-emerald-400"/><span className="text-[11px] text-zinc-500">Executed this period</span></div>
            <div className="text-[17px] font-semibold text-emerald-400">{fmt(totalExecuted, currency)}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{executed.length} note{executed.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 border-b border-white/[.04] -mb-4">
          {TABS.map(({ key, label }) => {
            const count = key === "pending_review" ? pending.length : key === "verified" ? verified.length : rejected.length;
            return (
              <button key={key} onClick={() => setTab(key)}
                className={`relative px-3.5 py-2.5 text-[12px] font-medium transition-colors ${tab === key ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
                {label} ({count})
                {tab === key && <span className="absolute bottom-0 left-0 right-0 h-px bg-red-500"/>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab description */}
      <div className="px-6 pt-3 pb-1 shrink-0">
        <p className="text-[11px] text-zinc-600">{TABS.find(t => t.key === tab)?.desc}</p>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-auto p-6 pt-3">
        {isLoading && <div className="flex h-40 items-center justify-center text-[12px] text-zinc-600">Loading…</div>}
        {!isLoading && shown.length === 0 && (
          <div className="flex h-56 flex-col items-center justify-center gap-3">
            <Clock size={32} className="text-zinc-700"/>
            <div className="text-[13px] text-zinc-500">Nothing in this queue</div>
            <Link to="/finance/credit-notes" className="text-[12px] text-red-400 hover:text-red-300 transition-colors">View all credit notes →</Link>
          </div>
        )}
        <div className="space-y-3 max-w-2xl">
          {shown.map(cn => (
            <CreditNoteCard
              key={cn.id}
              cn={cn}
              tab={tab}
              busy={busyId === cn.id}
              onTransition={(id, status, note) => transitionMutation.mutate({ id, status, note })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
