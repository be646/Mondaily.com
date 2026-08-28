/**
 * Natural-language quick-add for the calendar — "lunch with Omar tomorrow 1pm".
 *
 * DETERMINISTIC by design, not a model call: quick-add must work instantly, offline from the AI
 * engine, and identically every time — a scheduling box that sometimes mis-hears you is worse than
 * a form. The parser consumes date/time/duration tokens and leaves everything else as the title.
 * Everything it understood is returned as a human-readable `when` so the UI can SHOW the
 * interpretation before anything is created — the user confirms meaning, never trusts magic.
 *
 * Understood (case-insensitive):
 *   dates      today · tomorrow/tmrw · weekday names (next occurrence) · "next <weekday>" (+7)
 *              · "30 aug" / "aug 30" · "30/8" & "30.8" (day/month) · 2026-08-30
 *   times      1pm · 1.30pm · 13:00 · "at 5" (1–7 → afternoon, 8–12 → morning) · noon · midnight
 *   ranges     1-2pm · 13:00-14:30 (range wins over duration)
 *   duration   "for 45m" · "for 2h" · "for 1.5h" · "1h30"
 * Defaults: time-less date → 09:00; duration → 30 minutes. No date AND no time → null (the full
 * form opens instead — a guess about "when" is the one thing this must never make).
 */

export interface QuickEvent {
  title: string;
  start: Date;
  end: Date;
  /** What the parser understood, for the confirmation preview (e.g. "Tue 25 Aug, 13:00–14:00"). */
  when: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

interface TimeToken { h: number; m: number }

/** "1pm" | "1.30pm" | "13:00" | bare "5" (biased to working hours) — null when not a time. */
function parseTimeToken(raw: string, meridiem?: string): TimeToken | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const mer = (meridiem ?? "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  // Bare small hours ("at 5") mean the working afternoon, not dawn — the macOS-calendar bias.
  if (!mer && m[2] === undefined && h >= 1 && h <= 7) h += 12;
  return { h, m: min };
}

export function parseQuickEvent(input: string, now: Date = new Date()): QuickEvent | null {
  let text = ` ${input.trim()} `;
  if (!text.trim()) return null;

  let date: Date | null = null;
  let time: TimeToken | null = null;
  let endTime: TimeToken | null = null;
  let durationMin: number | null = null;

  const consume = (re: RegExp, apply: (m: RegExpExecArray) => boolean | void): void => {
    const m = re.exec(text);
    if (m && apply(m) !== false) text = text.replace(m[0], " ");
  };

  // ── explicit dates first (most specific wins) ──
  consume(/\b(\d{4})-(\d{2})-(\d{2})\b/, m => {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return false;
    date = d;
  });
  if (!date) consume(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})[a-z]*\\b`, "i"), m => {
    date = new Date(now.getFullYear(), MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)), Number(m[1]));
    if (date < now) date.setFullYear(date.getFullYear() + 1);   // "30 aug" said in September means next year
  });
  if (!date) consume(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"), m => {
    date = new Date(now.getFullYear(), MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)), Number(m[2]));
    if (date < now) date.setFullYear(date.getFullYear() + 1);
  });
  // day/month numerals — "30/8", "30.8" (the workspace convention is day-first)
  if (!date) consume(/\s(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\s/, m => {
    const day = Number(m[1]), mon = Number(m[2]);
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return false;
    const year = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    date = new Date(year, mon - 1, day);
    if (!m[3] && date < now) date.setFullYear(date.getFullYear() + 1);
  });
  if (!date) consume(/\b(today|tonight)\b/i, () => { date = new Date(now); });
  if (!date) consume(/\b(tomorrow|tmrw)\b/i, () => { date = new Date(now); date.setDate(date.getDate() + 1); });
  if (!date) consume(new RegExp(`\\b(next\\s+)?(${WEEKDAYS.join("|")})\\b`, "i"), m => {
    const target = WEEKDAYS.indexOf(m[2]!.toLowerCase());
    const d = new Date(now);
    let ahead = (target - d.getDay() + 7) % 7;
    if (ahead === 0 && !m[1]) ahead = 7;          // bare "monday" on a Monday = next week's
    if (m[1]) ahead += ahead === 0 ? 7 : 7;       // "next monday" = the week after the coming one
    d.setDate(d.getDate() + ahead);
    date = d;
  });

  // ── time range ("1-2pm", "13:00-14:30") before single time ──
  consume(/\b(\d{1,2}(?:[:.]\d{2})?)\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2}(?:[:.]\d{2})?)\s*(am|pm)?\b/i, m => {
    const endTok = parseTimeToken(m[3]!, m[4] ?? undefined);
    const startTok = parseTimeToken(m[1]!, m[2] ?? m[4] ?? undefined);   // "1-2pm" → both pm
    if (!startTok || !endTok) return false;
    time = startTok; endTime = endTok;
  });
  if (!time) consume(/\b(?:at\s+)?(\d{1,2}[:.]\d{2}|\d{1,2})\s*(am|pm)\b/i, m => {
    const t = parseTimeToken(m[1]!, m[2]);
    if (!t) return false;
    time = t;
  });
  if (!time) consume(/\bat\s+(\d{1,2}(?:[:.]\d{2})?)\b/i, m => {
    const t = parseTimeToken(m[1]!);
    if (!t) return false;
    time = t;
  });
  if (!time) consume(/\b(\d{1,2}[:.]\d{2})\b/, m => {
    const t = parseTimeToken(m[1]!);
    if (!t) return false;
    time = t;
  });
  if (!time) consume(/\bnoon\b/i, () => { time = { h: 12, m: 0 }; });
  if (!time) consume(/\bmidnight\b/i, () => { time = { h: 0, m: 0 }; });

  // ── duration ──
  consume(/\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i, m => {
    const n = Number(m[1]);
    durationMin = /^h/i.test(m[2]!) ? Math.round(n * 60) : Math.round(n);
  });
  if (durationMin == null) consume(/\b(\d+)h(\d{2})\b/i, m => { durationMin = Number(m[1]) * 60 + Number(m[2]); });

  // A guess about "when" is the one thing quick-add must never make.
  if (!date && !time) return null;

  const start = new Date((date ?? now).getTime());
  const t: TimeToken = time ?? { h: 9, m: 0 };
  start.setHours(t.h, t.m, 0, 0);
  // Time-only input pointing at a past moment today → they mean tomorrow.
  if (!date && start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);

  const end = new Date(start.getTime());
  const et = endTime as TimeToken | null;
  if (et) {
    end.setHours(et.h, et.m, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
  } else {
    end.setMinutes(end.getMinutes() + (durationMin ?? 30));
  }

  const title = text.replace(/\s+/g, " ").replace(/\b(at|on|from)\s*$/i, "").trim() || "Untitled event";
  const sameDay = start.toDateString() === end.toDateString();
  const fmtT = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const when = `${start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${fmtT(start)}–${sameDay ? "" : end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + " "}${fmtT(end)}`;

  return { title: title[0]!.toUpperCase() + title.slice(1), start, end, when };
}
