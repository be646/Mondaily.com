/**
 * Shared indicator vocabulary — delta pills and semantic tone maps.
 *
 * These existed as THREE independent copies (Brief, Owner Console ×2, plus per-page risk maps),
 * each hardcoding the same hexes the theme already defines as --status-* tokens. One drifting copy
 * means one page's "behind" turns a different red. Extraction is ZERO visual change: the token
 * values are byte-identical to the hexes the copies used (--status-ok = #2f9e6b, etc.).
 *
 * Color rule from the design contract: color belongs to DATA — status, deltas, risk — never chrome.
 */

export const TONE = {
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
  neutral: "var(--status-neutral)",
} as const;

/** Decision risk → tone. The one mapping, used by the Brief, Decisions, and the Owner Console. */
export const RISK_TONE: Record<string, string> = {
  high: TONE.error,
  medium: TONE.warn,
  low: TONE.neutral,
};

/** Goal pacing → tone (ahead / on / behind). */
export const PACE_TONE: Record<string, string> = {
  ahead: TONE.ok,
  on: TONE.neutral,
  behind: TONE.error,
};

/** Readiness verdicts → tone (ready / partial / missing). */
export const READY_TONE: Record<string, string> = {
  ready: TONE.ok,
  partial: TONE.warn,
  missing: TONE.error,
};

/**
 * Month-over-month delta pill — same-point comparison semantics live with the data; this only
 * renders. Three states, all deliberate:
 *   undefined → nothing (the metric has no comparison by design, e.g. a forecast)
 *   null      → "first month" (no prior data; a delta from nothing is noise, not 0%)
 *   number    → ▲/▼ pill, green up / red down
 */
export function DeltaPill({ delta }: { delta: number | null | undefined }) {
  if (delta === undefined) return null;
  if (delta === null) return <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>first month</span>;
  const up = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums"
      style={{
        color: up ? TONE.ok : TONE.error,
        background: up ? "rgb(var(--status-ok-rgb) / 0.1)" : "rgb(var(--status-error-rgb) / 0.1)",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)}%
    </span>
  );
}
