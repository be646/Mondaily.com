import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "@/components/ui/tabs";
import { apiClient } from "../../../lib/api-client";

/**
 * FINANCE SHELL — the tab-shell merge. Six finance surfaces (Invoices, Quotes, Credit notes,
 * Expenses, Reports, Approvals) share one URL space and one tab strip; the pages themselves are
 * UNTOUCHED and render below through the Outlet with every feature, handler and header they had.
 * The strip is navigation, not a title — each page still owns its name — so the merge is routing
 * plus one row of chrome, which is what makes it safe on money surfaces.
 *
 * Counts come from the exact SQL aggregate (/clean/types) and follow the tabs contract: rendered
 * whenever known — including zero — and omitted only while genuinely unknown (query in flight).
 */
const TABS = [
  { key: "invoices", label: "Invoices", path: "/finance/invoices", type: "invoice" },
  { key: "quotes", label: "Quotes", path: "/finance/quotes", type: "quote" },
  { key: "credit-notes", label: "Credit notes", path: "/finance/credit-notes", type: "credit_note" },
  { key: "expenses", label: "Expenses", path: "/finance/expenses", type: "expense" },
  { key: "reports", label: "Reports", path: "/finance/reports", type: null },
  { key: "approvals", label: "Approvals", path: "/finance/approvals", type: null },
] as const;

export function FinanceShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const counts = useQuery<{ types: { object_type: string; n: number }[] }>({
    // Scoped to the finance vertical: an object_type alone spans populations. `expense` is both a
    // Finance document and a row of the user-built "expenses" records sheet, so the unscoped count
    // badged this strip "Expenses 11" over a list of 1.
    queryKey: ["finance-type-counts", "finance"],
    queryFn: () => apiClient.get("/clean/types?vertical=finance"),
    staleTime: 120_000,
    retry: false,
  });
  const countOf = (type: string | null): number | undefined => {
    if (!type || !counts.data) return undefined;   // unknown → no badge, honestly
    return counts.data.types.find(t => t.object_type === type)?.n ?? 0;
  };
  const active = TABS.find(t => location.pathname.startsWith(t.path))?.key ?? "invoices";
  // Detail pages (/finance/invoices/:id) keep the strip — one click back to the sibling lists.

  return (
    <div>
      {/* Bar 2 of the two-bar idiom: the strip IS the page header row. Each page's title is
          redundant with its active tab, so FinanceHeader folds away and portals the page's
          primary action into the slot on the right — one hairline row, not three stacked bars. */}
      <div className="flex items-stretch px-4 sm:px-6">
        <Tabs
          className="min-w-0"
          items={TABS.map(t => ({ id: t.key, label: t.label, count: countOf(t.type) }))}
          active={active}
          onChange={(id) => { const t = TABS.find(x => x.key === id); if (t) navigate(t.path); }}
        />
        {/* Same border-b as Tabs, so the hairline runs unbroken under tabs AND actions. */}
        <div id="finance-shell-actions" className="flex min-w-0 flex-1 items-center justify-end gap-2 border-b border-[var(--border-soft)] pl-3"/>
      </div>
      <Outlet />
    </div>
  );
}
