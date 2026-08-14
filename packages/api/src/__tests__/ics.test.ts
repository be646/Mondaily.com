import { describe, it, expect } from "vitest";
import { buildIcs, icsUid } from "../lib/ics";

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
