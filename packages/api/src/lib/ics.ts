/**
 * iCalendar (RFC 5545) for meeting invitations.
 *
 * WHY THIS EXISTS: guests were emailed a nicely formatted message about a meeting, which is not the
 * same thing as an invitation. Without a calendar part the recipient must retype the time into
 * their own calendar, and most never will — so the meeting exists for the organiser and nobody
 * else. This is the difference between an email about a meeting and a meeting.
 *
 * It also delivers RSVP for free: a `text/calendar; method=REQUEST` part is what makes Gmail and
 * Outlook render Accept / Decline / Maybe directly in the message. We do not have to build a
 * response UI for people who have no account — their own mail client already has one.
 *
 * Deliberately hand-written rather than a dependency. The format is small, we emit one event type,
 * and a calendar invite that silently breaks because a library changed its escaping is worse than
 * one whose rules are visible here.
 */

export interface IcsEvent {
  /** STABLE across updates — this is what makes an edit replace the invite instead of duplicating it. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  organizer: { name?: string; email: string };
  attendees?: { name?: string; email: string }[];
  /** Bumped on every edit. A client ignores an update whose SEQUENCE has not advanced. */
  sequence?: number;
  method?: "REQUEST" | "CANCEL";
  /** A join link, surfaced where calendar clients look for one. */
  url?: string;
}

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become the literal \n. */
function esc(v: string): string {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC basic format — 20260814T153000Z. Local times would need a VTIMEZONE we do not ship. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error(`ics: unusable date ${iso}`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Lines longer than 75 octets MUST be folded, and a client that meets an unfolded long line can
 * reject the whole calendar. Folding is a CRLF followed by one space, and the space is not part of
 * the value.
 */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) { parts.push(" " + rest.slice(0, 72)); rest = rest.slice(72); }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

export function buildIcs(ev: IcsEvent): string {
  const method = ev.method ?? "REQUEST";
  const now = stamp(new Date().toISOString());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mondaily//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${esc(ev.uid)}`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(ev.startAt)}`,
    `DTEND:${stamp(ev.endAt)}`,
    `SEQUENCE:${Number.isFinite(ev.sequence) ? ev.sequence : 0}`,
    `SUMMARY:${esc(ev.title)}`,
    // CANCEL must say so in the event itself, not only in METHOD — some clients read only this.
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${esc(ev.organizer.name || ev.organizer.email)}:mailto:${ev.organizer.email}`,
  ];

  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  if (ev.url) lines.push(`URL:${esc(ev.url)}`);

  for (const a of ev.attendees ?? []) {
    // RSVP=TRUE is what asks the client to show Accept / Decline.
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${esc(a.name || a.email)}:mailto:${a.email}`,
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  // CRLF throughout: RFC 5545 requires it, and Outlook is the one that enforces it.
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * A stable UID for a Mondaily meeting.
 *
 * Derived from the event id so an update or cancellation lands on the SAME entry in the guest's
 * calendar. A random UID per send would leave a trail of duplicate meetings, each needing manual
 * deletion — the failure mode people remember.
 */
export function icsUid(eventId: string, domain: string): string {
  return `${eventId}@${(domain || "mondaily.com").replace(/^.*@/, "")}`;
}
