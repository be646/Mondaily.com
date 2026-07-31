/**
 * Baseline engine — THE one place that turns "this window vs the previous window" into an honest,
 * displayable comparison. Every surface that says "vs last period" (Finance Reports, Team
 * Oversight, Insights, the member report, future scheduled briefs) goes through this, so the
 * honesty rules can't drift per page:
 *
 *   • both zero            → kind "none"   (nothing happened; show a dash, not 0%)
 *   • no baseline (prev 0) → kind "new"    (a % against nothing is meaningless)
 *   • tiny baseline        → kind "raw"    ("12 vs 3" — real numbers instead of a wild %)
 *   • equal                → kind "flat"
 *   • otherwise            → kind "pct"    (rounded; display capped at maxPct as ">N%")
 *
 * The exact raw comparison ALWAYS travels along in `detail` for tooltips — the reader can always
 * see the real numbers behind any label. Pure and deterministic: no Date, no locale, no I/O.
 */

export interface BaselineComparison {
  kind: "none" | "new" | "flat" | "raw" | "pct";
  now: number;
  prev: number;
  /** Signed rounded percentage — present ONLY when kind === "pct". */
  pct: number | null;
  /** 1 up · 0 flat · -1 down (direction is meaningful for every kind except "none"). */
  direction: 1 | 0 | -1;
  /** Ready-to-render short label: "new" · "12 vs 3" · "43%" · ">999%" · "" (flat/none). */
  label: string;
  /** The always-honest long form for tooltips: "126 this period vs 22 previous". */
  detail: string;
}

export function compareWindows(
  now: number,
  prev: number,
  opts?: { minBase?: number; maxPct?: number },
): BaselineComparison {
  const minBase = opts?.minBase ?? 5;
  const maxPct = opts?.maxPct ?? 999;
  const detail = `${now} this period vs ${prev} previous`;
  const direction: 1 | 0 | -1 = now > prev ? 1 : now < prev ? -1 : 0;

  if (now === 0 && prev === 0) return { kind: "none", now, prev, pct: null, direction: 0, label: "", detail };
  if (prev === 0) return { kind: "new", now, prev, pct: null, direction, label: "new", detail };
  if (now === prev) return { kind: "flat", now, prev, pct: null, direction: 0, label: "", detail };
  if (Math.abs(prev) < minBase) return { kind: "raw", now, prev, pct: null, direction, label: `${now} vs ${prev}`, detail };

  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100);
  const label = Math.abs(pct) > maxPct ? `>${maxPct}%` : `${Math.abs(pct)}%`;
  return { kind: "pct", now, prev, pct, direction, label, detail };
}
