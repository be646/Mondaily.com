import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { periodLabel, type Period } from "../../lib/period";

/**
 * Stepping back through closed periods.
 *
 * Extracted rather than copied onto each surface. This session has now fixed the same class of bug
 * three separate times — a rule written at one call site and reconstructed by hand at another — so
 * a control that has to get the same four edge cases right on six pages is exactly the thing that
 * should exist once:
 *
 *   - The offset RESETS when the period type changes, because "3 months back" and "3 quarters back"
 *     are different places and carrying the number across is a jump nobody asked for.
 *   - It cannot step into the future. There is no data there.
 *   - It is hidden for Today / All time / Custom, which have no meaningful "N periods back".
 *   - The label comes from the SERVER, so no client reconstructs "July 2026" from an offset and
 *     gets it wrong at a year boundary. `serverLabel` is preferred whenever it has arrived.
 */

export function usePeriodOffset(period: Period): [number, (n: number) => void] {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [period]);
  return [offset, setOffset];
}

/** Whether stepping means anything for this period type. */
export function isSteppable(period: Period): boolean {
  return period !== "today" && period !== "all" && period !== "custom";
}

export function PeriodNav({
  period, offset, onOffset, serverLabel, complete,
}: {
  period: Period;
  offset: number;
  onOffset: (n: number) => void;
  /** The window's name as the workspace calendar computed it — always preferred when present. */
  serverLabel?: string | null;
  /** True for a finished period, which is shown IN FULL rather than period-to-date. */
  complete?: boolean;
}) {
  if (!isSteppable(period)) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      {/* No box. The row already has structure; a border around three small controls just adds
          another rectangle to a header that had four stacked hairlines. */}
      <div className="flex items-center gap-0.5">
        <button onClick={() => onOffset(Math.max(-120, offset - 1))}
          aria-label="Previous period" title="Previous period" className="btn-icon">
          <ChevronLeft size={13}/>
        </button>
        <span className="min-w-[84px] whitespace-nowrap text-center font-mono text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
          {serverLabel ?? periodLabel(period)}
        </span>
        <button onClick={() => onOffset(Math.min(0, offset + 1))} disabled={offset >= 0}
          aria-label="Next period" title="Next period" className="btn-icon disabled:opacity-30">
          <ChevronRight size={13}/>
        </button>
        {offset < 0 && (
          <button onClick={() => onOffset(0)} className="ml-0.5 text-[10px]" style={{ color: "var(--section-accent)" }}>now</button>
        )}
      </div>
      {complete && (
        // Said out loud, because otherwise a reader cannot tell a smaller number from less elapsed
        // time: a closed period covers the WHOLE period, the live one only covers what has happened.
        // A dot, not a two-word pill: the text wrapped inside its own badge in a tight strip, and
        // the fact ("this period is finished, so the window is the whole period") is a footnote,
        // not a headline. The title carries the full sentence for anyone who needs it.
        <span title="Closed period — shown in full, not period-to-date"
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px]"
          style={{ color: "var(--text-faint)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-faint)" }} />
          closed
        </span>
      )}
    </div>
  );
}
