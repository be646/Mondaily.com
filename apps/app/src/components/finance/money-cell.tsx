import { readMoney } from "@mondaily/shared/money";
import { useCurrency, formatMoney, convertAmount } from "../../hooks/useCurrency";

/**
 * A money value shown as what the client was actually charged, with its value in the reporting
 * currency underneath.
 *
 * The charged amount is the primary line and never changes — it is what appears on the document.
 * The second line is the reporting value, and it says HOW it was arrived at, because those two
 * cases are not equally trustworthy:
 *
 *   1,148.50 PLN   — frozen at the rate on the transaction date. Reproducible.
 *   ≈1,148.50 PLN  — no stored rate, converted at today's. Moves with the market.
 *
 * A single "≈" is doing real work: without it, a figure that drifts every morning looks identical
 * to one that is fixed forever, and the reader has no way to tell which they are quoting.
 */
export function MoneyCell({ row, align = "left" }: {
  row: Record<string, unknown> | null | undefined;
  align?: "left" | "right";
}) {
  const { base, display, rates } = useCurrency();
  const m = readMoney(row);
  if (!m.currency && !m.amount) return <span style={{ color: "var(--text-faint)" }}>—</span>;

  const primary = formatMoney(m.amount, m.currency);
  const charged = (m.currency || "").toUpperCase();
  // The second line reports in the workspace BASE currency, not the display selector. The base is
  // the ledger — it is what amount_base was frozen in and what every total is computed in — while
  // the display currency is a per-user viewing preference. A EUR invoice must show its USD value
  // because USD is what this business reports in, whether or not someone is currently looking at
  // the page in PLN. Tying it to the selector meant the same invoice showed a different second
  // line to two colleagues.
  const target = (base || display || "").toUpperCase();

  // Same currency: a second line would just repeat the first.
  if (charged === target) {
    return <div className={align === "right" ? "text-right" : undefined}>{primary}</div>;
  }

  let secondary: string | null = null;
  let frozen = false;
  let title = "";

  if (m.modelled && m.base_amount != null && m.base_currency) {
    const storedIn = m.base_currency.toUpperCase();
    if (storedIn === target) {
      secondary = formatMoney(m.base_amount, storedIn);
      frozen = true;
      title = `Fixed at the rate on the transaction date${m.rate ? ` (1 ${charged} = ${m.rate.toFixed(4)} ${storedIn})` : ""}.`;
    } else {
      // Frozen in one currency, viewed in another: the valuation still holds, only the last hop is
      // live. Marked as approximate because the displayed number does move.
      const reexpressed = convertAmount(m.base_amount, storedIn, target, rates);
      if (reexpressed != null) {
        secondary = formatMoney(reexpressed, target);
        title = `Fixed at ${formatMoney(m.base_amount, storedIn)} on the transaction date, shown in ${target} at today's rate.`;
      }
    }
  }

  if (secondary == null) {
    const live = convertAmount(m.amount, charged, target, rates);
    if (live != null) {
      secondary = formatMoney(live, target);
      title = `No rate is stored for this record, so this is converted at today's rate and will change as rates move.`;
    }
  }

  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <div>{primary}</div>
      {secondary
        ? (
          <div className="font-mono text-[10px] tabular-nums leading-tight" style={{ color: "var(--text-faint)" }} title={title}>
            {frozen ? "" : "≈"}{secondary}
          </div>
        )
        : (
          // Never silently show nothing: an unconvertible amount is a real state the reader needs.
          <div className="font-mono text-[10px] leading-tight" style={{ color: "var(--status-warn)" }}
            title={`No ${charged}→${target} rate is stored, so this cannot be shown in ${target}.`}>
            no {target} rate
          </div>
        )}
    </div>
  );
}
