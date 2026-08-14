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

/**
 * Read an RSVP that came back by email.
 *
 * When a guest clicks Accept in Gmail or Outlook, their client mails a `text/calendar;
 * method=REPLY` part back to the ORGANIZER. Those replies were already arriving at our inbound
 * server — verified in the receiver log — and nothing read them, so a guest could accept an
 * invitation and the meeting in Mondaily still showed them as not having answered.
 *
 * Parsing is deliberately narrow: the UID identifies the meeting, and the single ATTENDEE line
 * carries who replied and what they said. Anything else in the payload is ignored.
 */
export interface IcsReply {
  uid: string;
  attendeeEmail: string;
  response: "accepted" | "declined" | "tentative";
}

/** Undo RFC 5545 line folding — a CRLF followed by one space is a continuation, not a new line. */
const unfold = (ics: string): string => ics.replace(/\r?\n[ \t]/g, "");

export function parseIcsReply(raw: string): IcsReply | null {
  const text = unfold(String(raw ?? ""));
  if (!/METHOD:REPLY/i.test(text)) return null;

  const uid = /^UID:(.+)$/im.exec(text)?.[1]?.trim();
  if (!uid) return null;

  // The replying attendee is the one carrying PARTSTAT — the organiser line has none.
  const line = text.split(/\r?\n/).find(l => /^ATTENDEE/i.test(l) && /PARTSTAT=/i.test(l));
  if (!line) return null;

  const partstat = /PARTSTAT=([A-Z-]+)/i.exec(line)?.[1]?.toUpperCase();
  const email = /mailto:([^\s;:>]+)/i.exec(line)?.[1]?.trim().toLowerCase();
  if (!email) return null;

  const response =
    partstat === "ACCEPTED" ? "accepted" :
    partstat === "DECLINED" ? "declined" :
    partstat === "TENTATIVE" ? "tentative" : null;
  // NEEDS-ACTION and DELEGATED are not answers — recording them as one would invent a decision.
  if (!response) return null;

  return { uid, attendeeEmail: email, response };
}

/** The Mondaily event id encoded in a UID we issued, or null when the UID is not ours. */
export function eventIdFromUid(uid: string): string | null {
  const local = String(uid ?? "").split("@")[0]?.trim();
  // Our UIDs are `<event uuid>@<domain>`; anything else came from another system.
  return local && /^[0-9a-f-]{16,}$/i.test(local) ? local : null;
}
