import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { FieldSelect } from "../../../components/ui/controls";
import {
  Plus, Search, Car, Monitor, Coffee, Zap, Briefcase, Building2, MoreHorizontal, Receipt,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";

interface Expense {
  id: string;
  description: string;
  amount_cents: number;
  currency: string;
  category: string;
  date: string;
  vendor?: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  created_at: string;
}

const CATEGORY_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  travel:               { color: "text-blue-400",    icon: Car,           label: "Travel"               },
  software:             { color: "text-stone-400",  icon: Monitor,       label: "Software"             },
  hardware:             { color: "text-[var(--section-accent)]",    icon: Monitor,       label: "Hardware"             },
  meals:                { color: "text-amber-400",   icon: Coffee,        label: "Meals"                },
  marketing:            { color: "text-pink-400",    icon: Zap,           label: "Marketing"            },
  professional_services:{ color: "text-emerald-400", icon: Briefcase,     label: "Professional Services"},
  office:               { color: "text-stone-400",   icon: Building2,     label: "Office"              },
  other:                { color: "text-stone-500",    icon: MoreHorizontal,label: "Other"                },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Draft",     color: "text-stone-400 bg-stone-400/10",     icon: Receipt      },
  submitted: { label: "Submitted", color: "text-blue-400 bg-blue-400/10",     icon: Clock        },
  approved:  { label: "Approved",  color: "text-emerald-400 bg-emerald-400/10", icon: CheckCircle2 },
  rejected:  { label: "Rejected",  color: "text-stone-400 bg-stone-400/10",       icon: XCircle      },
};

const CATEGORIES = Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ key: k, label: v.label }));

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
}

function LogExpenseModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [form, setForm] = useState({
    description: "",
    amount: "",
    currency: "GBP",
    category: "other",
    date: new Date().toISOString().slice(0, 10),
    vendor: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!form.description || isNaN(cents) || cents <= 0) {
      setError("Description and a valid amount are required.");
      return;
    }
    setLoading(true); setError(null);
    try {
      await apiClient.post("/expenses", {
        description: form.description,
        amount_cents: cents,
        currency: form.currency,
        category: form.category,
        date: new Date(form.date).toISOString(),
        vendor: form.vendor || undefined,
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
            <div className="h-6 w-6 rounded-lg bg-amber-500/20 flex items-center justify-center"><Receipt size={12} className="text-amber-400"/></div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Log Expense</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Flight to London" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Amount</label>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00" type="number" min="0" step="0.01" className="key-input w-full text-sm"/>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Currency</label>
              <FieldSelect value={form.currency} onChange={v => setForm(f => ({ ...f, currency: v }))} ariaLabel="Currency"
                options={["GBP", "USD", "EUR", "CAD", "AUD"].map(c => ({ value: c, label: c }))} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Category</label>
              <FieldSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} ariaLabel="Category"
                options={CATEGORIES.map(c => ({ value: c.key, label: c.label }))} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Date</label>
              <input value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                type="date" className="key-input w-full text-sm"/>
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Vendor (optional)</label>
              <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                placeholder="e.g. British Airways" className="key-input w-full text-sm"/>
            </div>
          </div>
          {error && <p className="text-[11px] text-[var(--text-faint)] bg-stone-400/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">Cancel</button>
            <button onClick={submit} disabled={loading}
              className="flex items-center gap-1.5 rounded-sm border border-stone-500/30 bg-stone-600 px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-colors disabled:opacity-50">
              {loading ? "Saving…" : "Log Expense"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExpensesPage() {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  const { data: expenses = [], isLoading, isError, refetch } = useQuery<Expense[]>({
    queryKey: ["expenses", categoryFilter, search],
    queryFn: async () => {
      try {
        const p = new URLSearchParams();
        if (categoryFilter) p.set("category", categoryFilter);
        if (search) p.set("search", search);
        return await apiClient.get<Expense[]>(`/expenses?${p}`);
      } catch {
        return [];
      }
    },
  });

  const currency = expenses[0]?.currency ?? "GBP";

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalSubmitted = expenses.filter(e => e.status === "submitted").reduce((s, e) => s + e.amount_cents, 0);
  const totalApproved  = expenses.filter(e => e.status === "approved").reduce((s, e) => s + e.amount_cents, 0);
  const totalThisMonth = expenses.filter(e => e.date?.slice(0, 7) === thisMonthKey).reduce((s, e) => s + e.amount_cents, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[15px] font-semibold text-[var(--text-primary)]">Expenses</h1>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">Track and manage business expenses</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 rounded-sm border border-stone-500/30 bg-stone-600 px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-colors">
            <Plus size={13}/> Log Expense
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><Clock size={11} className="text-blue-400"/><span className="text-[11px] text-[var(--text-muted)]">Submitted</span></div>
            <div className="text-[17px] font-semibold text-blue-400">{fmt(totalSubmitted, currency)}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{expenses.filter(e => e.status === "submitted").length} pending approval</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><CheckCircle2 size={11} className="text-emerald-400"/><span className="text-[11px] text-[var(--text-muted)]">Approved</span></div>
            <div className="text-[17px] font-semibold text-emerald-400">{fmt(totalApproved, currency)}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{expenses.filter(e => e.status === "approved").length} approved</div>
          </div>
          <div className="telemetry-strip">
            <div className="flex items-center gap-1.5 mb-1"><Receipt size={11} className="text-[var(--text-muted)]"/><span className="text-[11px] text-[var(--text-muted)]">This Month</span></div>
            <div className="text-[17px] font-semibold text-[var(--text-primary)]">{fmt(totalThisMonth, currency)}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">all statuses</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] p-1 flex-wrap">
            <button onClick={() => setCategoryFilter("")}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${categoryFilter === "" ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-faint)]"}`}>
              All
            </button>
            {CATEGORIES.map(c => (
              <button key={c.key} onClick={() => setCategoryFilter(c.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${categoryFilter === c.key ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-faint)]"}`}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expenses…" className="key-input w-full pl-7 text-[12px]"/>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-[12px] text-[var(--text-secondary)]">Loading…</div>
        ) : isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">Couldn't load expenses. <button onClick={() => refetch()} className="underline">Retry</button></div>
        ) : expenses.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <Receipt size={32} className="text-[var(--text-secondary)]"/>
            <div className="text-[13px] text-[var(--text-muted)]">No expenses {categoryFilter ? `in category "${categoryFilter}"` : "yet"}</div>
            <button onClick={() => setShowNew(true)} className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-faint)] transition-colors">Log your first expense</button>
          </div>
        ) : (
          <table className="minimal-table">
            <thead>
              <tr className="border-b border-[var(--border-soft)]">
                {["Date", "Description", "Vendor", "Category", "Amount", "Status"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-[var(--text-secondary)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => {
                const catCfg = CATEGORY_CONFIG[e.category] ?? CATEGORY_CONFIG["other"]!;
                const CatIcon = catCfg.icon;
                const stsCfg = STATUS_CONFIG[e.status] ?? STATUS_CONFIG["draft"]!;
                const StsIcon = stsCfg.icon;
                return (
                  <tr key={e.id} className="border-b border-[var(--border-soft)] hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                      {new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-medium text-[var(--text-primary)]">{e.description}</td>
                    <td className="px-4 py-3 text-[11px] text-[var(--text-muted)]">{e.vendor ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${catCfg.color}`}>
                        <CatIcon size={10}/>{catCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-[var(--text-primary)]">{fmt(e.amount_cents, e.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${stsCfg.color}`}>
                        <StsIcon size={10}/>{stsCfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <LogExpenseModal
          onClose={() => setShowNew(false)}
          onCreate={() => { qc.invalidateQueries({ queryKey: ["expenses"] }); setShowNew(false); }}
        />
      )}
    </div>
  );
}
