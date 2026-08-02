import { useCurrency } from "../../hooks/useCurrency";

/**
 * Says which currency the page is showing, when that is not the one the business reports in.
 *
 * The workspace has a base currency — the one every stored valuation is frozen in and the one the
 * books are kept in. "Show in" is a per-person viewing preference layered on top. When they differ,
 * every figure on the page is a re-expression at today's rate, and nothing previously said so: a
 * USD business could sit and read PLN totals for weeks, quote them to someone, and never learn that
 * the numbers were neither the charged amounts nor the reported ones.
 *
 * Deliberately not a warning — choosing another currency is legitimate. It states the fact and
 * makes going back one click, which is the difference between an informed choice and a silent one.
 */
export function CurrencyBasisNotice() {
  const { base, display, setDisplay } = useCurrency();
  const b = (base || "").toUpperCase();
  const d = (display || "").toUpperCase();
  if (!b || !d || b === d) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6 py-1.5 text-[11px]"
      style={{ color: "var(--text-muted)" }}>
      <span>
        Showing <span className="font-mono" style={{ color: "var(--text-primary)" }}>{d}</span> at today’s rate.
        This workspace reports in <span className="font-mono" style={{ color: "var(--text-primary)" }}>{b}</span>.
      </span>
      <button
        onClick={() => setDisplay.mutate(b)}
        disabled={setDisplay.isPending}
        className="rounded-sm border border-[var(--border-soft)] px-1.5 py-0.5 transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50">
        {setDisplay.isPending ? "Switching…" : `Show ${b}`}
      </button>
    </div>
  );
}
