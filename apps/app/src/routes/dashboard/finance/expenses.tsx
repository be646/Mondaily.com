import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { FieldSelect, FilterButton, FilterStrip } from "../../../components/ui/controls";
import { DataTable, type DataTableColumn } from "../../../components/ui/data-table";
import { FinanceHeader } from "../../../components/finance/finance-toolbar";
import { PeriodSelector } from "../../../components/ui/period-selector";
import { PeriodNav, usePeriodOffset } from "../../../components/ui/period-nav";
import { KPIGrid, KPITile } from "../../../components/ui/kpi";
import { usePeriod, periodRange, inRange, periodLabel } from "../../../lib/period";
import { useResolvedPeriod } from "../../../lib/period-bounds";
import { AIButton } from "../../../components/ui/ai-button";
import { useCurrency, formatMoney, currencyOptions } from "../../../hooks/useCurrency";
import { parseNumeric } from "@mondaily/shared/numbers";
import { dialogs } from "../../../components/ui/dialog-service";
import {
  Plus, Search, Car, Monitor, Coffee, Zap, Briefcase, Building2, MoreHorizontal, Receipt,
  CheckCircle2, XCircle, Clock, Trash2,
} from "lucide-react";
import { MoneyCell } from "../../../components/finance/money-cell";
import { DateField } from "@/components/ui/date-picker";
import { Modal, ModalActions } from "@/components/ui/modal";

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
  travel:               { color: "text-[#717784]",    icon: Car,           label: "Travel"               },
  software:             { color: "text-[var(--text-secondary)]",  icon: Monitor,       label: "Software"             },
  hardware:             { color: "text-[var(--section-accent)]",    icon: Monitor,       label: "Hardware"             },
  meals:                { color: "text-[#c6892e]",   icon: Coffee,        label: "Meals"                },
  marketing:            { color: "text-[#717784]",    icon: Zap,           label: "Marketing"            },
  professional_services:{ color: "text-[#2f9e6b]", icon: Briefcase,     label: "Professional Services"},
  office:               { color: "text-[var(--text-secondary)]",   icon: Building2,     label: "Office"              },
  other:                { color: "text-[var(--text-muted)]",    icon: MoreHorizontal,label: "Other"                },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Draft",     color: "text-[var(--text-secondary)] bg-stone-400/10",     icon: Receipt      },
  submitted: { label: "Submitted", color: "text-[#717784] bg-[#717784]/10",     icon: Clock        },
  approved:  { label: "Approved",  color: "text-[#2f9e6b] bg-[#2f9e6b]/10", icon: CheckCircle2 },
  rejected:  { label: "Rejected",  color: "text-[#d1524a] bg-[#d1524a]/10",       icon: XCircle      },
};

const CATEGORIES = Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ key: k, label: v.label }));

function fmt(cents: number, currency: string) {
  return (cents / 100).toLocaleString("en-GB", { style: "currency", currency, minimumFractionDigits: 2 });
}

function LogExpenseModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const { base, currencies } = useCurrency();
  const [form, setForm] = useState({
    description: "",
    amount: "",
    currency: "",
    category: "other",
    date: new Date().toISOString().slice(0, 10),
    vendor: "",
  });
  useEffect(() => { setForm(f => (f.currency ? f : { ...f, currency: base })); }, [base]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI category suggestion — grounded in the typed description/vendor/amount; applies the
  // returned category and shows the model's short rationale. Never invents a category.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  async function suggestCategory() {
    if (!form.description.trim()) return;
    setSuggesting(true); setSuggestNote(null);
    try {
      const cents = Math.round(parseFloat(form.amount) * 100);
      const res = await apiClient.post<{ category?: string; rationale?: string; error?: string }>("/expenses/categorize", {
        description: form.description.trim(),
        vendor: form.vendor || undefined,
        amount_cents: isNaN(cents) ? undefined : cents,
      });
      if (res.error) { setSuggestNote(res.error); return; }
      if (res.category) setForm(f => ({ ...f, category: res.category! }));
      setSuggestNote(res.rationale ? `AI: ${res.rationale}` : null);
    } catch { setSuggestNote("Couldn't suggest a category."); }
    finally { setSuggesting(false); }
  }

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
    <Modal title="Log Expense" onClose={onClose} footer={
      <ModalActions onCancel={onClose}>
        <button onClick={submit} disabled={loading}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 text-label font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-50">
          {loading ? "Saving…" : "Log Expense"}
        </button>
      </ModalActions>
    }>
      <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Flight to London" className="key-input w-full text-sm"/>
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Category</label>
                <AIButton variant="subtle" size="sm" loading={suggesting} disabled={!form.description.trim()}
                  title="Suggest a category from the description" onClick={suggestCategory}>
                  Suggest
                </AIButton>
              </div>
              <FieldSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} ariaLabel="Category"
                options={CATEGORIES.map(c => ({ value: c.key, label: c.label }))} />
              {suggestNote && <p className="mt-1 text-caption text-[var(--text-faint)]">{suggestNote}</p>}
            </div>
            <div>
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Date</label>
              <DateField value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} className="w-full"/>
            </div>
            <div className="col-span-2">
              <label className="block text-caption font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Vendor (optional)</label>
              <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                placeholder="e.g. British Airways" className="key-input w-full text-sm"/>
            </div>
          </div>
          {error && <p className="text-label text-[var(--text-faint)] bg-stone-400/10 rounded-lg px-3 py-2">{error}</p>}
      </div>
    </Modal>
  );
}

// Column model for the shared DataTable. Every cell renderer — the DECORATIVE category label
// (its own identity colour, NOT a status token), the status pill, money (fmt) and the date —
// stays HERE, so the shell knows no finance logic. Amount still reads e.amount_cents as before.
const EXPENSE_COLUMNS: DataTableColumn<Expense>[] = [
  { key: "date", header: "Date", cellClassName: "text-label text-[var(--text-secondary)]",
    cell: (e) => new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) },
  { key: "description", header: "Description", cellClassName: "text-body font-medium text-[var(--text-primary)]", cell: (e) => e.description },
  { key: "vendor", header: "Vendor", cellClassName: "text-label text-[var(--text-muted)]", cell: (e) => e.vendor ?? "—" },
  { key: "category", header: "Category", cell: (e) => {
      const catCfg = CATEGORY_CONFIG[e.category] ?? CATEGORY_CONFIG["other"]!;
      const CatIcon = catCfg.icon;
      // catCfg.color is a decorative category-identity colour — intentionally NOT a status token.
      return (
        <span className={`inline-flex items-center gap-1.5 text-caption font-medium ${catCfg.color}`}>
          <CatIcon size={10} />{catCfg.label}
        </span>
      );
    } },
  { key: "amount", header: "Amount", cellClassName: "text-row font-semibold text-[var(--text-primary)]", cell: (e) => <MoneyCell row={e as unknown as Record<string, unknown>}/> },
  { key: "status", header: "Status", cell: (e) => {
      const stsCfg = STATUS_CONFIG[e.status] ?? STATUS_CONFIG["draft"]!;
      const StsIcon = stsCfg.icon;
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium ${stsCfg.color}`}>
          <StsIcon size={10} />{stsCfg.label}
        </span>
      );
    } },
];

export function ExpensesPage() {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const { display, sumInDisplay } = useCurrency();

  const { data: expenses = [], isLoading, isError, refetch } = useQuery<Expense[]>({
    queryKey: ["expenses", categoryFilter, search],
    // No try/catch swallow — a real failure must surface as isError (the error state),
    // not masquerade as an empty "No expenses yet".
    queryFn: () => {
      const p = new URLSearchParams();
      if (categoryFilter) p.set("category", categoryFilter);
      if (search) p.set("search", search);
      return apiClient.get<Expense[]>(`/expenses?${p}`);
    },
  });

  // Expenses could be CREATED but never edited or deleted: PATCH and DELETE existed on the API
  // with no caller anywhere, so a mistyped amount or a duplicate entry was permanent and kept
  // counting toward the approved/logged totals. Editing is limited to documents that have not been
  // decided — changing the amount of an already-approved expense would rewrite a decision someone
  // else made.
  const [rowErr, setRowErr] = useState<string | null>(null);
  const editable = (e: Expense) => e.status === "draft" || e.status === "rejected";

  const patchExpense = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Expense> }) =>
      apiClient.patch(`/expenses/${id}`, patch),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ["expenses"] }); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : "Could not update that expense."),
  });
  const deleteExpense = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/expenses/${id}`),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ["expenses"] }); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : "Could not delete that expense."),
  });

  const expenseColumns: DataTableColumn<Expense>[] = [
    ...EXPENSE_COLUMNS,
    {
      key: "actions",
      header: "",
      cell: (e) => (
        <div className="flex items-center justify-end gap-2">
          {editable(e) ? (
            <button
              onClick={async (ev) => {
                ev.stopPropagation();
                const next = await dialogs.prompt({
                  title: `Edit amount — ${e.description}`,
                  description: `Charged in ${e.currency}. The reporting value is recalculated at the rate for ${String(e.date ?? "").slice(0, 10) || "the expense date"}.`,
                  defaultValue: String(e.amount_cents / 100),
                  inputMode: "number",
                  confirmLabel: "Save",
                  // Validated in the dialog so a typo is corrected in place rather than dismissing
                  // the box and reporting the failure somewhere else on the page.
                  validate: (v) => {
                    const n = parseNumeric(v);
                    if (n == null) return "That isn’t a number.";
                    if (n < 0) return "An expense can’t be negative.";
                    return null;
                  },
                });
                if (next == null) return;
                const major = parseNumeric(next);
                if (major == null || major < 0) return;
                patchExpense.mutate({ id: e.id, patch: { amount_cents: Math.round(major * 100) } });
              }}
              className="text-caption text-[var(--text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--text-primary)]">
              Edit
            </button>
          ) : (
            <span className="text-caption" style={{ color: "var(--text-faint)" }} title={`A ${e.status} expense can no longer be edited.`}>—</span>
          )}
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              if (!window.confirm(`Delete the ${fmt(e.amount_cents, e.currency)} expense "${e.description}"?\n\nThis permanently removes it and cannot be undone.`)) return;
              deleteExpense.mutate(e.id);
            }}
            className="text-caption text-[var(--text-muted)] transition-colors hover:text-[var(--status-error)]"
            aria-label={`Delete ${e.description}`}>
            <Trash2 size={11}/>
          </button>
        </div>
      ),
    },
  ];

  const currency = display;
  const e$ = (e: Expense) => ({ amount: e.amount_cents / 100, currency: e.currency });
  const [period, setPeriod] = usePeriod("mondaily_expenses_period", "all");
  const [periodOffset, setPeriodOffset] = usePeriodOffset(period);
  // Period lens (default All for a list page). Submitted is a pending BALANCE (as-of); Approved and
  // the period total are FLOWs counted within the window on the expense date.
  const { range, label: periodName, complete: periodComplete } = useResolvedPeriod(period, undefined, periodOffset);
  const inPeriod = (e: Expense) => period === "all" || inRange(e.date ?? "", range);
  // The window's NAME wins when the server has one — see reports.tsx. "this month" over a
  // stepped-back window is a label contradicting its own number.
  const periodScope = period === "all" ? "all time"
    : periodName ? periodName
    : period === "today" ? "today"
    : `this ${periodLabel(period).toLowerCase()}`;
  const submittedSum = sumInDisplay(expenses.filter(e => e.status === "submitted").map(e$));
  const approvedSum  = sumInDisplay(expenses.filter(e => e.status === "approved" && inPeriod(e)).map(e$));
  // "Total logged" = real spend in the window: exclude rejected AND draft (neither is committed spend).
  const loggedSum    = sumInDisplay(expenses.filter(e => inPeriod(e) && e.status !== "rejected" && e.status !== "draft").map(e$));
  const totalSubmitted = submittedSum.value, totalApproved = approvedSum.value, totalInPeriod = loggedSum.value;
  // If any amount couldn't be converted to the display currency (missing FX rate), we summed at face
  // value — flag it with a "~" so the figure is never presented as an exact cross-currency total.
  const approx = (n: number) => (n > 0 ? "~" : "");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-soft)] px-6 py-4">
        <FinanceHeader
          periodLens={<><PeriodSelector value={period} onChange={setPeriod} />
            <PeriodNav period={period} offset={periodOffset} onOffset={setPeriodOffset} serverLabel={periodName} complete={periodComplete} /></>} icon={Receipt} callsign="EXPENSES" title="Expenses" subtitle="Track and manage business expenses"
          action={
            <>
            <button onClick={() => setShowNew(true)}
              className="btn-primary h-7 shrink-0 gap-2 px-3 text-body font-semibold">
              <Plus size={13}/> Log Expense
            </button>
            </>
          }
        />

        <KPIGrid className="mb-4">
          <KPITile icon={Clock} iconColor="#717784" valueColor="#717784" label="Submitted"
            value={<>{approx(submittedSum.missing)}{formatMoney(totalSubmitted, currency)}</>}
            sub={<>{expenses.filter(e => e.status === "submitted").length} pending approval · as of now</>} />
          <KPITile icon={CheckCircle2} iconColor="#2f9e6b" valueColor="#2f9e6b" label="Approved"
            value={<>{approx(approvedSum.missing)}{formatMoney(totalApproved, currency)}</>}
            sub={<>approved · {periodScope}</>} />
          <KPITile icon={Receipt} label="Total logged"
            value={<>{approx(loggedSum.missing)}{formatMoney(totalInPeriod, currency)}</>}
            sub={<>excl. rejected · {periodScope}{loggedSum.missing > 0 ? ` · ${loggedSum.missing} unconverted` : ""}</>} />
        </KPIGrid>

        {/* Toolbar — records-sheet filter pattern (same as Decisions/Tasks): a Filter button
            toggles a thin category strip below, replacing the old wall of category buttons. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expenses…" className="key-input h-8 w-full pl-8 pr-3"/>
          </div>
          <FilterButton open={filterOpen} onToggle={() => setFilterOpen(o => !o)} activeCount={categoryFilter ? 1 : 0} />
        </div>
        {filterOpen && (
          <FilterStrip
            className="mt-2"
            filters={[{ key: "category", label: "Category", options: CATEGORIES.map(c => ({ value: c.key, label: c.label })) }]}
            values={{ category: categoryFilter }}
            onChange={(_k, v) => setCategoryFilter(v)}
          />
        )}
      </div>

      {rowErr && (
        <p className="px-6 pb-2 text-caption" style={{ color: "var(--status-error)" }} role="alert">{rowErr}</p>
      )}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-body text-[var(--text-secondary)]">Loading…</div>
        ) : isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-body text-[var(--text-muted)]">Couldn't load expenses. <button onClick={() => refetch()} className="underline">Retry</button></div>
        ) : expenses.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <Receipt size={32} className="text-[var(--text-secondary)]"/>
            <div className="text-row text-[var(--text-muted)]">No expenses {categoryFilter ? `in category "${categoryFilter}"` : "yet"}</div>
            <button onClick={() => setShowNew(true)} className="text-body text-[var(--text-faint)] hover:text-[var(--text-faint)] transition-colors">Log your first expense</button>
          </div>
        ) : (
          // Presentational shell only — cell rendering, the decorative category label, the status
          // pill, money value and date are all still owned by this page (above), unchanged. Rows are
          // intentionally non-navigating (matches the prior behaviour); no row click was added.
          <DataTable<Expense>
            columns={expenseColumns}
            rows={expenses}
            rowKey={(e) => e.id}
          />
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
