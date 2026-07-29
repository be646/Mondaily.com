import { useCallback, useSyncExternalStore } from "react";

/**
 * Shared reporting-period system. The ledger is ALWAYS cumulative — nothing is ever reset;
 * this only scopes the *view*. FLOW metrics (revenue, expenses, new deals) are counted within
 * the range; BALANCE metrics (outstanding, pipeline) are read as-of and ignore the range.
 *
 * One source of truth so every KPI surface in the app reads the same way.
 */
export type Period = "today" | "week" | "month" | "quarter" | "year" | "all" | "custom";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "today",   label: "Today" },
  { key: "week",    label: "Week" },
  { key: "month",   label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year",    label: "Year" },
  { key: "all",     label: "All" },
];

export interface DateRange { start: Date; end: Date }
export interface CustomRange { start?: string; end?: string }

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

/** The date range for a period, relative to `ref` (defaults to now). */
export function periodRange(p: Period, ref: Date = new Date(), custom?: CustomRange): DateRange {
  const end = endOfDay(ref);
  const s = new Date(ref);
  switch (p) {
    case "today":   return { start: startOfDay(ref), end };
    case "week": {  // week starts Sunday
      s.setDate(s.getDate() - s.getDay());
      return { start: startOfDay(s), end };
    }
    case "month":   return { start: startOfDay(new Date(s.getFullYear(), s.getMonth(), 1)), end };
    case "quarter": return { start: startOfDay(new Date(s.getFullYear(), Math.floor(s.getMonth() / 3) * 3, 1)), end };
    case "year":    return { start: startOfDay(new Date(s.getFullYear(), 0, 1)), end };
    case "custom":  return {
      start: custom?.start ? startOfDay(new Date(custom.start)) : new Date(0),
      end:   custom?.end ? endOfDay(new Date(custom.end)) : end,
    };
    case "all":
    default:        return { start: new Date(0), end };
  }
}

/** Shift a reference date back by exactly one period unit (calendar-aware for month/quarter/year). */
function shiftBackOnePeriod(ref: Date, p: Period): Date {
  const d = new Date(ref);
  switch (p) {
    case "today":   d.setDate(d.getDate() - 1); break;
    case "week":    d.setDate(d.getDate() - 7); break;
    case "month":   d.setMonth(d.getMonth() - 1); break;
    case "quarter": d.setMonth(d.getMonth() - 3); break;
    case "year":    d.setFullYear(d.getFullYear() - 1); break;
  }
  return d;
}

/**
 * The comparable prior window for period-over-period deltas — a true "same point in the prior
 * period" comparison (e.g. Jul 1–15 vs Jun 1–15), not a fixed-span shift. Null for all/custom.
 */
export function previousRange(p: Period, ref: Date = new Date()): DateRange | null {
  if (p === "all" || p === "custom") return null;
  return periodRange(p, shiftBackOnePeriod(ref, p));
}

export function inRange(dateISO: string | null | undefined, range: DateRange): boolean {
  if (!dateISO) return false;
  // A date-only value ("2026-07-29") is parsed by Date.parse as UTC midnight, but it MEANS that
  // calendar day where the user is. Ranges are built from local day boundaries, so west of UTC a
  // row dated the first day of the period sorted before range.start and was silently dropped —
  // understating expenses and therefore overstating Net. Expenses store both shapes (the API
  // defaults to date-only, the UI sends a full ISO instant), so normalise here rather than at one
  // writer. Appending T00:00:00 with no Z parses as LOCAL midnight.
  const raw = dateISO.trim();
  const t = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`).getTime() : Date.parse(raw);
  if (Number.isNaN(t)) return false;
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** Percentage change current-vs-previous. null when there is no comparable base. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function periodLabel(p: Period): string {
  return PERIODS.find(x => x.key === p)?.label ?? "Custom";
}

// ── usePeriod: a tiny localStorage-backed store so the selection persists per surface ──
const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function usePeriod(storageKey = "mondaily_period", initial: Period = "month") {
  const getSnapshot = () => {
    const v = (typeof localStorage !== "undefined" && localStorage.getItem(storageKey)) as Period | null;
    return v && PERIODS.some(p => p.key === v) ? v : initial;
  };
  const period = useSyncExternalStore(subscribe, getSnapshot, () => initial);
  const setPeriod = useCallback((p: Period) => {
    try { localStorage.setItem(storageKey, p); } catch { /* private mode */ }
    emit();
  }, [storageKey]);
  return [period, setPeriod] as const;
}
