/**
 * Canonical "overdue" semantics, shared by the API, the app, and any surface that judges due dates.
 *
 * A task/item is OVERDUE only once its due DATE has fully passed — i.e. it was due on a day BEFORE
 * today. An item due *today* (at any time today) is NOT overdue yet; it becomes overdue at the start
 * of tomorrow. This matches the calendar's long-standing behavior and stops "due today at 00:00" from
 * reading as overdue for the whole day.
 *
 * Note on timezone: each caller judges "today" in its own runtime zone — the server (UTC on Vercel)
 * and the browser (the user's local zone). That's intentional: the API's aggregate counts are UTC-day
 * consistent with each other, while the UI a user sees matches their own calendar day.
 */

/** True when `dueDate` is before the start of today (date-only). Empty/invalid dates are never overdue. */
export function isOverdue(dueDate?: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < startOfToday.getTime();
}

/**
 * The ISO timestamp for the start of today in UTC — the cutoff for a SQL `due_date < cutoff` overdue
 * filter (rows strictly before today's date). Use this instead of `now` so items due today aren't
 * swept in. Server runs in UTC, so this is the server's "today".
 */
export function overdueCutoffISO(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}
