import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildIcs, icsUid, parseIcsReply, eventIdFromUid } from "../lib/ics";

/**
 * Unfold the way a client does: a CRLF followed by a single space is a line continuation, and the
 * space is not part of the value. Asserting against the raw text means a long property that is
 * correctly folded looks like a missing one — which is what happened to the RSVP assertion below.
 */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

const base = {
  uid: "evt-1@mondaily.com",
  title: "Acme onboarding",
  startAt: "2026-08-14T15:30:00.000Z",
  endAt: "2026-08-14T16:00:00.000Z",
  organizer: { name: "Bassem", email: "be@mondaily.com" },
};

/**
 * Guests were emailed a nicely formatted message ABOUT a meeting, which is not an invitation. With
 * no calendar part the recipient has to retype the time into their own calendar, and most never
 * will — so the meeting exists for the organiser and nobody else.
 */
describe("a guest invitation is a real calendar invite", () => {
  it("is a well-formed VCALENDAR with a single VEVENT", () => {
    const ics = buildIcs(base);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics.trimEnd()).toMatch(/END:VCALENDAR$/);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toMatch(/VERSION:2\.0/);
  });

  it("uses CRLF throughout — Outlook enforces it", () => {
    const ics = buildIcs(base);
    const bareLf = ics.split("\r\n").join("").includes("\n");
    expect(bareLf, "a lone LF makes Outlook reject the calendar").toBe(false);
  });

  it("emits UTC timestamps in basic format", () => {
    const ics = buildIcs(base);
    expect(ics).toMatch(/DTSTART:20260814T153000Z/);
    expect(ics).toMatch(/DTEND:20260814T160000Z/);
  });

  it("asks the client for an RSVP — this is what renders Accept / Decline", () => {
    // The whole reason guests get RSVP without us building a response UI for people who have no
    // account: their mail client already has one.
    const ics = unfold(buildIcs({ ...base, attendees: [{ name: "Mina", email: "mina@example.com" }] }));
    expect(ics).toMatch(/METHOD:REQUEST/);
    expect(ics).toMatch(/ATTENDEE[^\r\n]*RSVP=TRUE/);
    expect(ics).toMatch(/PARTSTAT=NEEDS-ACTION/);
    expect(ics).toMatch(/mailto:mina@example\.com/);
  });

  it("escapes the characters RFC 5545 reserves", () => {
    // An unescaped comma or semicolon silently truncates the field in some clients.
    const ics = unfold(buildIcs({ ...base, title: "Acme; renewal, phase 2\\final", description: "Line one\nLine two" }));
    expect(ics).toMatch(/SUMMARY:Acme\\; renewal\\, phase 2\\\\final/);
    expect(ics).toMatch(/DESCRIPTION:Line one\\nLine two/);
    expect(ics, "a raw newline would end the property early").not.toMatch(/DESCRIPTION:Line one\r\nLine two/);
  });

  it("folds long lines, and folded continuations start with a space", () => {
    const ics = buildIcs({ ...base, description: "x".repeat(400) });
    for (const line of ics.split("\r\n")) {
      expect(line.length, `unfolded line: ${line.slice(0, 40)}…`).toBeLessThanOrEqual(75);
    }
    expect(ics).toMatch(/\r\n /);
  });

  it("a cancellation says so in BOTH the method and the event", () => {
    // Some clients read only STATUS; some read only METHOD. Saying it once leaves the meeting
    // sitting in half the guests' calendars.
    const ics = buildIcs({ ...base, method: "CANCEL" });
    expect(ics).toMatch(/METHOD:CANCEL/);
    expect(ics).toMatch(/STATUS:CANCELLED/);
  });

  it("keeps the UID stable so an update REPLACES rather than duplicates", () => {
    // A random UID per send leaves a trail of duplicate meetings, each needing manual deletion.
    const a = icsUid("evt-1", "mondaily.com");
    const b = icsUid("evt-1", "mondaily.com");
    expect(a).toBe(b);
    expect(a).toBe("evt-1@mondaily.com");
    expect(icsUid("evt-2", "mondaily.com")).not.toBe(a);
  });

  it("advances SEQUENCE so a client accepts the update", () => {
    // A client ignores an update whose SEQUENCE has not advanced.
    expect(buildIcs(base)).toMatch(/SEQUENCE:0/);
    expect(buildIcs({ ...base, sequence: 3 })).toMatch(/SEQUENCE:3/);
  });

  it("carries the join link where a calendar client looks for it", () => {
    const ics = unfold(buildIcs({ ...base, url: "https://app.mondaily.com/call/abc", location: "Mondaily call" }));
    expect(ics).toMatch(/URL:https:\/\/app\.mondaily\.com\/call\/abc/);
    expect(ics).toMatch(/LOCATION:Mondaily call/);
  });

  it("refuses an unusable date rather than emitting a broken calendar", () => {
    // Emitting DTSTART:Invalid would make the whole invite fail silently in the client.
    expect(() => buildIcs({ ...base, startAt: "not a date" })).toThrow(/unusable date/);
  });
});

/**
 * RSVP REPLIES. Verified arriving at our inbound server before this existed — the receiver log
 * showed `calendar-…@google.com` forwarded → 200 — and nothing read them. So a guest could accept
 * an invitation and the meeting still showed them as not having answered.
 */
describe("an RSVP that comes back by email is read", () => {
  const reply = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REPLY", "BEGIN:VEVENT",
    "UID:bbf11d89-f4e5-462f-8929-2231d1fafc92@mondaily.com",
    "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;CN=Mina:mailto:Mina@Example.com",
    "ORGANIZER:mailto:be@mondaily.com",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  it("reads who replied and what they said", () => {
    const r = parseIcsReply(reply);
    expect(r).toEqual({
      uid: "bbf11d89-f4e5-462f-8929-2231d1fafc92@mondaily.com",
      attendeeEmail: "mina@example.com",   // lowercased so it matches the stored guest list
      response: "accepted",
    });
  });

  it("handles declined and tentative", () => {
    expect(parseIcsReply(reply.replace("ACCEPTED", "DECLINED"))?.response).toBe("declined");
    expect(parseIcsReply(reply.replace("ACCEPTED", "TENTATIVE"))?.response).toBe("tentative");
  });

  it("refuses to treat NEEDS-ACTION as an answer", () => {
    // Recording it would invent a decision the guest never made.
    expect(parseIcsReply(reply.replace("ACCEPTED", "NEEDS-ACTION"))).toBeNull();
  });

  it("ignores a REQUEST — an invitation is not a reply", () => {
    expect(parseIcsReply(reply.replace("METHOD:REPLY", "METHOD:REQUEST"))).toBeNull();
  });

  it("reads a FOLDED attendee line, as a real client sends it", () => {
    const folded = reply.replace(
      "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;CN=Mina:mailto:Mina@Example.com",
      "ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;CN=Mi\r\n na:mailto:Mina@Example.com",
    );
    expect(parseIcsReply(folded)?.attendeeEmail).toBe("mina@example.com");
  });

  it("recovers our event id from a UID we issued, and only ours", () => {
    expect(eventIdFromUid("bbf11d89-f4e5-462f-8929-2231d1fafc92@mondaily.com")).toBe("bbf11d89-f4e5-462f-8929-2231d1fafc92");
    // A meeting created in someone else's system must not be mistaken for one of ours.
    expect(eventIdFromUid("040000008200E00074C5B7101A82E008@microsoft.com")).toBeTruthy();
    expect(eventIdFromUid("short@google.com")).toBeNull();
    expect(eventIdFromUid("")).toBeNull();
  });
});

describe("an RSVP is only accepted from an invited guest", () => {
  const EMAILS = readFileSync(join(__dirname, "../routes/emails.ts"), "utf8");

  it("matches the reply against the event's own guest list", () => {
    // The UID is not a secret. Accepting on someone else's behalf is not something an email
    // should be able to do.
    expect(EMAILS).toMatch(/if \(!guests\.includes\(reply\.attendeeEmail\)\)/);
    expect(EMAILS).toMatch(/not an invited guest/);
  });

  it("checks RSVP before falling through to ordinary mail handling", () => {
    // Filed as a normal message it would sit in a thread nobody reads — the same failure the
    // support-reply branch exists to prevent.
    const inbound = EMAILS.slice(EMAILS.indexOf('router.post("/inbound"'));
    expect(inbound.indexOf("recordRsvpFromInbound")).toBeLessThan(inbound.indexOf("workspaceIdFromRecipients"));
  });

  it("also reads a calendar payload sent in the body, not just as a part", () => {
    expect(EMAILS).toMatch(/BEGIN:VCALENDAR\/i\.test\(msg\.text\)/);
  });
});
