/**
 * THE period core — one definition of "what period is it" for the API and the UI.
 *
 * The client already had `apps/app/src/lib/period.ts`, and the server had nothing: every analytics
 * endpoint answered "this month" by handing rows to the browser and letting it filter. That is the
 * same shape as the bug that made Home report 911 records as 500 — a window applied to a page, not
 * to the data. With closed-period snapshots arriving, that stops being a display error and becomes
 * a REPORTING error, so the definition moves here where both sides read it.
 *
 * Two decisions this module exists to make correctly, both of which are the usual source of
 * "the numbers are wrong on the 1st":
 *
 *  1. TIMEZONE. A period boundary is a wall-clock fact in the workspace's own timezone. Vercel Cron
 *     fires in UTC, so a Warsaw workspace closing "at midnight" closes two hours early and files
 *     two hours of transactions into the wrong month. Every boundary here is computed in the
 *     workspace zone, and `periodKey` is derived from the LOCAL calendar.
 *
 *  2. WEEK START. This product has always started weeks on Sunday. Changing that silently would
 *     move every "this week" number in the app, so it is a per-workspace setting that defaults to
 *     the existing behaviour rather than a constant somebody flips.
 */

export type PeriodType = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
export type Timeframe = "TODAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "ALL_TIME";

/** Sunday = 0 (this product's historical default), Monday = 1. */
export type WeekStart = 0 | 1;

export interface PeriodConfig {
  /** IANA zone, e.g. "Europe/Warsaw". Falls back to UTC — never to the server's local zone, which
   *  is a property of where the code happens to run and would make results non-reproducible. */
  timeZone: string;
  weekStart: WeekStart;
}

export const DEFAULT_PERIOD_CONFIG: PeriodConfig = { timeZone: "UTC", weekStart: 0 };

/** Instant range, half-open [start, end): the only form that tiles without double-counting. */
export interface Bounds {
  start: Date;
  /** EXCLUSIVE. A closed end would count a row at exactly midnight in two adjacent periods. */
  end: Date;
}

// ── Wall-clock helpers ───────────────────────────────────────────────────────
// Intl is the only correct way to do this without shipping a timezone database: it knows DST and
// historical offset changes, which fixed-offset arithmetic does not.

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading of an instant in a zone. */
export function wallClock(at: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
  // Intl renders midnight as hour 24 in some engines; normalise so arithmetic stays sane.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute"), second: get("second") };
}

/** The zone's UTC offset in minutes at a given instant (DST-correct because it asks Intl). */
function offsetMinutes(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return (asUTC - Math.floor(at.getTime() / 1000) * 1000) / 60000;
}

/**
 * The instant at which a given wall-clock time occurs in a zone.
 *
 * Solved by iteration rather than algebra because the offset depends on the answer: guessing UTC,
 * measuring the offset there, and correcting converges in one step except across a DST transition,
 * where the second pass settles it.
 */
export function instantOf(w: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, timeZone: string): Date {
  const target = Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0, w.second ?? 0);
  let guess = new Date(target);
  for (let i = 0; i < 2; i++) {
    guess = new Date(target - offsetMinutes(guess, timeZone) * 60000);
  }
  return guess;
}

/** Day-of-week in the zone, 0 = Sunday. */
function weekdayIn(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

// ── Boundaries ───────────────────────────────────────────────────────────────

/** First instant of the period CONTAINING `at`. */
export function periodStart(at: Date, type: PeriodType, cfg: PeriodConfig): Date {
  const w = wallClock(at, cfg.timeZone);
  switch (type) {
    case "YEARLY":    return instantOf({ year: w.year, month: 1, day: 1 }, cfg.timeZone);
    case "QUARTERLY": return instantOf({ year: w.year, month: Math.floor((w.month - 1) / 3) * 3 + 1, day: 1 }, cfg.timeZone);
    case "MONTHLY":   return instantOf({ year: w.year, month: w.month, day: 1 }, cfg.timeZone);
    case "WEEKLY": {
      const dow = weekdayIn(at, cfg.timeZone);
      // Days to step back to reach the configured first day of the week.
      const back = (dow - cfg.weekStart + 7) % 7;
      const midnight = instantOf({ year: w.year, month: w.month, day: w.day }, cfg.timeZone);
      // Step in whole days from local midnight, then re-resolve: subtracting 24h across a DST
      // change lands an hour off, and the week would start at 23:00 the previous day.
      const stepped = wallClock(new Date(midnight.getTime() - back * 86_400_000 + 3_600_000 * 12), cfg.timeZone);
      return instantOf({ year: stepped.year, month: stepped.month, day: stepped.day }, cfg.timeZone);
    }
  }
}

/** First instant of the period AFTER the one containing `at` — the exclusive end. */
export function periodEnd(at: Date, type: PeriodType, cfg: PeriodConfig): Date {
  const s = wallClock(periodStart(at, type, cfg), cfg.timeZone);
  switch (type) {
    case "YEARLY":    return instantOf({ year: s.year + 1, month: 1, day: 1 }, cfg.timeZone);
    case "QUARTERLY": {
      const m = s.month + 3;
      return instantOf({ year: s.year + (m > 12 ? 1 : 0), month: m > 12 ? m - 12 : m, day: 1 }, cfg.timeZone);
    }
    case "MONTHLY": {
      const m = s.month + 1;
      return instantOf({ year: s.year + (m > 12 ? 1 : 0), month: m > 12 ? 1 : m, day: 1 }, cfg.timeZone);
    }
    case "WEEKLY": {
      const start = periodStart(at, type, cfg);
      const mid = wallClock(new Date(start.getTime() + 7 * 86_400_000 + 3_600_000 * 12), cfg.timeZone);
      return instantOf({ year: mid.year, month: mid.month, day: mid.day }, cfg.timeZone);
    }
  }
}

export function periodBounds(at: Date, type: PeriodType, cfg: PeriodConfig): Bounds {
  return { start: periodStart(at, type, cfg), end: periodEnd(at, type, cfg) };
}

/** The period immediately before the one containing `at`. */
export function previousPeriod(at: Date, type: PeriodType, cfg: PeriodConfig): Bounds {
  const start = periodStart(at, type, cfg);
  // One second inside the previous period, then ask for ITS bounds — calendar-correct for every
  // type without per-type arithmetic, and immune to month lengths and DST.
  return periodBounds(new Date(start.getTime() - 1000), type, cfg);
}

/**
 * The stable identity of a period: '2026-M08', '2026-Q3', '2026-W31', '2026-Y2026'.
 *
 * Derived from the LOCAL calendar, so a workspace's August is its own August. ISO week numbering is
 * deliberately NOT used for the weekly key: ISO weeks always start Monday, and this product lets a
 * workspace start its week on Sunday. The key counts weeks from the workspace's own first week of
 * the year instead, so the key and the bounds can never describe different spans.
 */
export function periodKey(at: Date, type: PeriodType, cfg: PeriodConfig): string {
  const s = wallClock(periodStart(at, type, cfg), cfg.timeZone);
  switch (type) {
    case "YEARLY":    return `${s.year}-Y${s.year}`;
    case "QUARTERLY": return `${s.year}-Q${Math.floor((s.month - 1) / 3) + 1}`;
    case "MONTHLY":   return `${s.year}-M${String(s.month).padStart(2, "0")}`;
    case "WEEKLY": {
      const firstOfYear = instantOf({ year: s.year, month: 1, day: 1 }, cfg.timeZone);
      const firstWeekStart = periodStart(firstOfYear, "WEEKLY", cfg);
      const thisWeekStart = periodStart(at, "WEEKLY", cfg);
      const week = Math.round((thisWeekStart.getTime() - firstWeekStart.getTime()) / (7 * 86_400_000)) + 1;
      return `${s.year}-W${String(week).padStart(2, "0")}`;
    }
  }
}

// ── The reporting lens ───────────────────────────────────────────────────────

/**
 * The window a report should apply, as a half-open range.
 *
 * ALL_TIME returns null rather than an epoch-to-now range: "no filter" and "a filter that happens
 * to include everything" are different instructions to a query planner, and only one of them lets
 * the caller skip the predicate entirely.
 */
export function getPeriodBounds(timeframe: Timeframe, at: Date, cfg: PeriodConfig): Bounds | null {
  switch (timeframe) {
    case "ALL_TIME": return null;
    case "TODAY": {
      const w = wallClock(at, cfg.timeZone);
      const start = instantOf({ year: w.year, month: w.month, day: w.day }, cfg.timeZone);
      const mid = wallClock(new Date(start.getTime() + 86_400_000 + 3_600_000 * 12), cfg.timeZone);
      return { start, end: instantOf({ year: mid.year, month: mid.month, day: mid.day }, cfg.timeZone) };
    }
    case "WEEK":    return { start: periodStart(at, "WEEKLY", cfg), end: at };
    case "MONTH":   return { start: periodStart(at, "MONTHLY", cfg), end: at };
    case "QUARTER": return { start: periodStart(at, "QUARTERLY", cfg), end: at };
    case "YEAR":    return { start: periodStart(at, "YEARLY", cfg), end: at };
  }
}

/**
 * FLOW vs STOCK — the distinction that decides whether a window applies at all.
 *
 * A FLOW metric happened during a span: revenue collected, expenses approved, tasks completed.
 * Windowing it is the whole point. A STOCK metric is a balance as of a moment: outstanding
 * invoices, open pipeline, account balance. Windowing a stock is meaningless and produces the
 * classic bug where "unpaid invoices" drops to zero on the 1st of the month — the invoices did not
 * get paid, the filter just stopped counting them.
 *
 * This is already the rule the Finance report follows; naming it here makes it enforceable rather
 * than a comment each surface has to remember.
 */
export type MetricKind = "FLOW" | "STOCK";

export function windowFor(kind: MetricKind, timeframe: Timeframe, at: Date, cfg: PeriodConfig): Bounds | null {
  return kind === "STOCK" ? null : getPeriodBounds(timeframe, at, cfg);
}

/** Is an instant inside a half-open range? */
export function inBounds(when: string | Date | null | undefined, b: Bounds | null): boolean {
  if (!b) return true;                       // no window = everything qualifies
  if (!when) return false;                   // undated rows cannot be claimed by a window
  const t = (when instanceof Date ? when : new Date(when)).getTime();
  return Number.isFinite(t) && t >= b.start.getTime() && t < b.end.getTime();
}

/** Read a workspace's period config from its settings blob, falling back safely. */
export function periodConfigFrom(settings: unknown): PeriodConfig {
  const s = (settings ?? {}) as Record<string, unknown>;
  const tz = typeof s.timezone === "string" && s.timezone.trim() ? s.timezone.trim() : DEFAULT_PERIOD_CONFIG.timeZone;
  const ws = s.week_start === 1 || s.week_start === "monday" ? 1 : 0;
  // A bad zone must not take reporting down: Intl throws on an unknown zone, so it is probed once
  // here and rejected to UTC rather than at the first boundary computation.
  try { formatterFor(tz).format(new Date()); } catch { return { timeZone: "UTC", weekStart: ws }; }
  return { timeZone: tz, weekStart: ws };
}

/**
 * Every period boundary that elapsed between two instants, oldest first.
 *
 * This is what makes the close worker calendar-driven instead of "close whatever came since the
 * last run". Crons get skipped by deploys and outages and fire twice on retries; asking the
 * calendar which periods ENDED in a span gives the same answer however many times it is asked,
 * and backfills the ones that were missed.
 */
export function elapsedPeriods(since: Date, until: Date, type: PeriodType, cfg: PeriodConfig): { key: string; bounds: Bounds }[] {
  const out: { key: string; bounds: Bounds }[] = [];
  if (until <= since) return out;
  let cursor = periodStart(since, type, cfg);
  // Hard stop: a corrupt `since` (epoch 0) must not spin for 2000 years of weeks.
  for (let guard = 0; guard < 1000; guard++) {
    const bounds = periodBounds(cursor, type, cfg);
    if (bounds.end > until) break;           // still open — nothing to close
    out.push({ key: periodKey(cursor, type, cfg), bounds });
    cursor = bounds.end;
  }
  return out;
}
