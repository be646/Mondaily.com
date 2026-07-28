import { useState } from "react";
import { Link } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { FinanceHeader } from "../../components/finance/finance-toolbar";
import { useCurrency, formatMoney } from "../../hooks/useCurrency";
import {
  ShieldCheck, Clock, CheckCircle2, XCircle,
  ReceiptText, ChevronRight, AlertTriangle, UserCircle2, ShieldAlert } from "lucide-react";

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
        <div key={i} className="flex items-start gap-2 text-[11px] text-[var(--text-muted)]">
          <UserCircle2 size={12} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
          <span>
            <span className="text-[var(--text-faint)]">{entry.user_id.slice(0, 8)}</span>
            {" "}
            <span className={
              entry.action === "verified" ? "text-status-neutral" :
              entry.action === "executed" ? "text-status-ok" :
              entry.action === "rejected" ? "text-stone-400" :
              "text-stone-500"
            }>{entry.action}</span>
            {" · "}{relativeTime(entry.at)}
            {entry.note && <span className="block pl-3.5 text-[var(--text-secondary)] italic">"{entry.note}"</span>}
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
    <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-4 text-[var(--text-primary)] transition-colors hover:border-[var(--border-soft)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)]">
            <ReceiptText size={15} className="text-[var(--text-faint)]"/>
          </div>
          <div>
            <div className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{fmt(cn.amount_cents, cn.currency)}</div>
            <div className="text-[11px] text-[var(--text-muted)]">{cn.client_name ?? "Unknown client"} · {REASON_LABELS[cn.credit_reason]}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {cn.status === "pending_review" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-warn/10 border border-status-warn/25 px-2.5 py-0.5 text-[10px] font-medium text-status-warn">
              <Clock size={9}/> Needs Review
            </span>
          )}
          {cn.status === "verified" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-neutral/10 border border-status-neutral/25 px-2.5 py-0.5 text-[10px] font-medium text-status-neutral">
              <CheckCircle2 size={9}/> Verified
            </span>
          )}
          {cn.status === "rejected" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-stone-400/10 border border-stone-400/20 px-2.5 py-0.5 text-[10px] font-medium text-stone-400">
              <XCircle size={9}/> Rejected
            </span>
          )}
          <span className="text-[10px] text-[var(--text-faint)]">{relativeTime(cn.created_at)}</span>
        </div>
      </div>

      {cn.ai_summary && (
        <div className="mb-3 flex items-start gap-1.5 rounded-sm border border-stone-200 bg-stone-50 px-3 py-2 dark:border-[var(--section-accent)]/20 dark:bg-[var(--section-accent)]/[.04]">
          <LogoMark size={10} className="text-[var(--text-faint)] mt-0.5 shrink-0"/>
          <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{cn.ai_summary}</p>
        </div>
      )}
      {cn.notes && !cn.ai_summary && (
        <p className="mb-3 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">{cn.notes}</p>
      )}

      <ApprovalTrail approvals={cn.approvals} />

      {error && (
        <div className="flex items-center gap-1.5 rounded-lg border border-stone-500/30 bg-stone-600/[.05] px-3 py-2 text-[11px] text-stone-400 mb-3">
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
              className="btn-ai !px-3 !py-1.5 !text-[12px] disabled:opacity-40">
              Confirm Reject
            </button>
            <button onClick={() => setRejectOpen(false)} className="btn-secondary !px-3 !py-1.5 !text-[12px]">
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
              className="btn-ai flex-1 !px-3 !py-2 !text-[12px] disabled:opacity-40">
              {busy ? "Processing…" : "Approve → Verified"}
            </button>
            {!rejectOpen && (
              <button
                onClick={() => setRejectOpen(true)}
                disabled={busy}
                className="btn-secondary !px-3 !py-2 !text-[12px] disabled:opacity-40">
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
              className="btn-ai flex-1 !px-3 !py-2 !text-[12px] disabled:opacity-40">
              {busy ? "Processing…" : "Execute credit"}
            </button>
            {!rejectOpen && (
              <button
                onClick={() => setRejectOpen(true)}
                disabled={busy}
                className="btn-secondary !px-3 !py-2 !text-[12px] disabled:opacity-40">
                Reject
              </button>
            )}
          </>
        )}
        {tab === "rejected" && (
          <button
            onClick={() => doTransition("pending_review")}
            disabled={busy}
            className="btn-secondary !px-3 !py-2 !text-[12px] disabled:opacity-40">
            {busy ? "Processing…" : "Resubmit"}
          </button>
        )}
        <Link to={`/finance/credit-notes/${cn.id}`}
          className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
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

  const { data: allNotes = [], isLoading, isError, refetch } = useQuery<CreditNote[]>({
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
  // Totals normalized to the workspace display currency via FX — mixed-currency notes sum honestly
  // instead of being mislabeled with the first note's currency (matches the Credit Notes page).
  const { display, sumInDisplay } = useCurrency();
  const cn$ = (n: CreditNote) => ({ amount: n.amount_cents / 100, currency: n.currency });
  const pendingSum  = sumInDisplay(pending.map(cn$));
  const verifiedSum = sumInDisplay(verified.map(cn$));
  const executedSum = sumInDisplay(executed.map(cn$));
  const totalPending  = pendingSum.value;
  const totalVerified = verifiedSum.value;
  const totalExecuted = executedSum.value;
  // Retain `missing`: unlike currencies with no FX rate are summed at FACE VALUE, so the
  // figure must not be presented as exact.
  const approx = (n: number) => (n > 0 ? "~" : "");


  return (
    <div className="flex h-full flex-col bg-[var(--surface-card)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader icon={ShieldCheck} callsign="APPROVALS" title="Approval Dashboard" subtitle="Review and authorise credit notes across the workspace" />

        {/* Summary row */}
        <div className="telemetry-strip mb-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1"><Clock size={11} className="text-status-warn"/><span className="text-[11px] text-[var(--text-muted)]">Needs review</span></div>
            <div className="text-[17px] font-semibold text-status-warn">{approx(pendingSum.missing)}{formatMoney(totalPending, display)}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{pending.length} note{pending.length !== 1 ? "s" : ""}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-status-neutral"/><span className="text-[11px] text-[var(--text-muted)]">Verified, not executed</span></div>
            <div className="text-[17px] font-semibold text-status-neutral">{approx(verifiedSum.missing)}{formatMoney(totalVerified, display)}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{verified.length} note{verified.length !== 1 ? "s" : ""}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-status-ok"/><span className="text-[11px] text-[var(--text-muted)]">Executed this period</span></div>
            <div className="text-[17px] font-semibold text-status-ok">{approx(executedSum.missing)}{formatMoney(totalExecuted, display)}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{executed.length} note{executed.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* Tab strip */}
        <div className="-mb-4 flex items-center gap-1 border-b border-[var(--border-soft)]">
          {TABS.map(({ key, label }) => {
            const count = key === "pending_review" ? pending.length : key === "verified" ? verified.length : rejected.length;
            return (
              <button key={key} onClick={() => setTab(key)}
                className={`relative px-3.5 py-2.5 text-[12px] font-medium transition-colors ${tab === key ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                {label} ({count})
                {tab === key && <span className="absolute bottom-0 left-0 right-0 h-px bg-stone-500"/>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab description */}
      <div className="shrink-0 px-6 pb-1 pt-3">
        <p className="text-[11px] text-[var(--text-muted)]">{TABS.find(t => t.key === tab)?.desc}</p>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-auto p-6 pt-3">
        {isLoading && <div className="flex h-40 items-center justify-center text-[12px] text-[var(--text-muted)]">Loading…</div>}
        {/* A failed fetch used to fall through to "Nothing in this queue" — an approval queue
            that failed to load looked identical to an empty one. Say what actually happened. */}
        {!isLoading && isError && (
          <div className="flex h-56 flex-col items-center justify-center gap-3">
            <ShieldAlert size={32} style={{ color: "#c6892e" }}/>
            <div className="text-[13px] text-[var(--text-primary)]">Could not load the approval queue</div>
            <div className="text-[12px] text-[var(--text-muted)]">This is a load failure, not an empty queue.</div>
            <button onClick={() => refetch()} className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">Try again</button>
          </div>
        )}
        {!isLoading && !isError && shown.length === 0 && (
          <div className="flex h-56 flex-col items-center justify-center gap-3">
            <Clock size={32} className="text-[var(--text-faint)]"/>
            <div className="text-[13px] text-[var(--text-muted)]">Nothing in this queue</div>
            <Link to="/finance/credit-notes" className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">View all credit notes →</Link>
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
