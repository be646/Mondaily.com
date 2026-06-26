import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import {
  Plus, Search, ReceiptText, Clock, CheckCircle2, AlertCircle,
  XCircle, Sparkles, DollarSign, ChevronRight, RefreshCcw,
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
  edges?: Record<string, string>;
}

const STATUS_CONFIG: Record<CreditStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:            { label: "Draft",            color: "text-stone-400 bg-stone-400/10",     icon: ReceiptText   },
  pending_review:   { label: "Pending Review",   color: "text-amber-400 bg-amber-400/10",   icon: Clock         },
  manager_approved: { label: "Approved",         color: "text-blue-400 bg-blue-400/10",     icon: CheckCircle2  },
  executed:         { label: "Executed",         color: "text-emerald-400 bg-emerald-400/10", icon: CheckCircle2 },
  void:             { label: "Void",             color: "text-stone-600 bg-stone-600/10",     icon: XCircle       },
};

const REASON_LABELS: Record<CreditReason, string> = {
  refund:             "Refund",
  billing_error:      "Billing Error",
  goodwill:           "Goodwill",
  contract_discount:  "Contract Discount",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "pending_review",   label: "Pending" },
  { key: "manager_approved", label: "Approved" },
  { key: "executed",         label: "Executed" },
  { key: "draft",            label: "Draft" },
  { key: "void",             label: "Void" },
];

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
}

// ─── New credit note modal ────────────────────────────────────────────────────
function NewCreditNoteModal({ onClose, onCreate }: { onClose: () => void; onCreate: (id: string) => void }) {
  const [form, setForm] = useState({
    client_name: "",
    amount: "",
    currency: "GBP",
    credit_reason: "refund" as CreditReason,
    status: "draft" as CreditStatus,
    notes: "",
  });
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
      <div className="w-full max-w-md rounded-2xl border border-white/[.08] bg-[#0f1117] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-violet-500/20 flex items-center justify-center"><ReceiptText size={12} className="text-violet-400"/></div>
            <span className="text-sm font-semibold text-white">New Credit Note</span>
          </div>
          <button onClick={onClose} className="text-stone-600 hover:text-stone-300 transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Client name</label>
              <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                placeholder="Acme Corp" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Amount</label>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00" type="number" min="0" step="0.01" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Currency</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="key-input w-full text-sm">
                {["GBP","USD","EUR","CAD","AUD"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Reason</label>
              <select value={form.credit_reason} onChange={e => setForm(f => ({ ...f, credit_reason: e.target.value as CreditReason }))}
                className="key-input w-full text-sm">
                {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Initial status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as CreditStatus }))}
                className="key-input w-full text-sm">
                <option value="draft">Draft</option>
                <option value="pending_review">Submit for review</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-stone-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Reason details…"
                className="key-input w-full text-sm resize-none"/>
            </div>
          </div>
          {error && <p className="text-[11px] text-indigo-400 bg-indigo-400/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">Cancel</button>
            <button onClick={submit} disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-400/40 bg-indigo-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 transition-colors disabled:opacity-50">
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

  const { data: creditNotes = [], isLoading } = useQuery<CreditNote[]>({
    queryKey: ["credit-notes", statusFilter, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusFilter) p.set("status", statusFilter);
      if (search) p.set("search", search);
      return apiClient.get<CreditNote[]>(`/credit-notes?${p}`);
    },
  });

  const totalPending  = creditNotes.filter(n => n.status === "pending_review").reduce((s, n) => s + n.amount_cents, 0);
  const totalExecuted = creditNotes.filter(n => n.status === "executed").reduce((s, n) => s + n.amount_cents, 0);
  const currency      = creditNotes[0]?.currency ?? "GBP";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-stone-200 dark:border-stone-800 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[15px] font-semibold text-white">Credit Notes</h1>
            <p className="text-[12px] text-stone-500 mt-0.5">Manage refunds, billing corrections and goodwill credits</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-400 transition-colors">
            <Plus size={13}/> New Credit Note
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><Clock size={11} className="text-amber-400"/><span className="text-[11px] text-stone-500">Pending</span></div>
            <div className="text-[17px] font-semibold text-amber-400">{fmt(totalPending, currency)}</div>
            <div className="text-[10px] text-stone-700 mt-0.5">{creditNotes.filter(n => n.status === "pending_review").length} note{creditNotes.filter(n => n.status === "pending_review").length !== 1 ? "s" : ""}</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-emerald-400"/><span className="text-[11px] text-stone-500">Executed</span></div>
            <div className="text-[17px] font-semibold text-emerald-400">{fmt(totalExecuted, currency)}</div>
            <div className="text-[10px] text-stone-700 mt-0.5">{creditNotes.filter(n => n.status === "executed").length} note{creditNotes.filter(n => n.status === "executed").length !== 1 ? "s" : ""}</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><DollarSign size={11} className="text-stone-500"/><span className="text-[11px] text-stone-500">Total credit issued</span></div>
            <div className="text-[17px] font-semibold text-white">{fmt(totalExecuted, currency)}</div>
            <div className="text-[10px] text-stone-700 mt-0.5">this workspace</div>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-white/[.06] bg-white/[.02] p-1">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${statusFilter === f.key ? "bg-white/[.07] text-white" : "text-stone-500 hover:text-stone-300"}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-600"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by client or reason…" className="key-input w-full pl-7 text-[12px]"/>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-stone-600">Loading…</div>
        ) : creditNotes.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <ReceiptText size={32} className="text-stone-700"/>
            <div className="text-[13px] text-stone-500">No credit notes {statusFilter ? `with status "${statusFilter}"` : "yet"}</div>
            <button onClick={() => setShowNew(true)} className="text-[12px] text-indigo-400 hover:text-indigo-300 transition-colors">Create your first credit note</button>
          </div>
        ) : (
          <table className="minimal-table">
            <thead>
              <tr className="border-b border-white/[.04]">
                {["Client", "Amount", "Reason", "Status", "AI Summary", "Created", ""].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-stone-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creditNotes.map(cn => {
                const cfg = STATUS_CONFIG[cn.status];
                const Icon = cfg.icon;
                return (
                  <tr key={cn.id}
                    className="border-b border-white/[.03] hover:bg-white/[.015] transition-colors cursor-pointer"
                    onClick={() => navigate(`/finance/credit-notes/${cn.id}`)}>
                    <td className="px-4 py-3">
                      <div className="text-[12px] font-medium text-white">{cn.client_name ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-white">{fmt(cn.amount_cents, cn.currency)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] text-stone-400 rounded-full bg-white/[.04] px-2 py-0.5">{REASON_LABELS[cn.credit_reason]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                        <Icon size={10}/>{cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {cn.ai_summary ? (
                        <div className="flex items-start gap-1.5">
                          <Sparkles size={10} className="text-violet-400 mt-0.5 shrink-0"/>
                          <span className="text-[11px] text-stone-500 truncate">{cn.ai_summary}</span>
                        </div>
                      ) : <span className="text-[11px] text-stone-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-stone-600">
                      {new Date(cn.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight size={13} className="text-stone-700 hover:text-stone-400 transition-colors"/>
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
