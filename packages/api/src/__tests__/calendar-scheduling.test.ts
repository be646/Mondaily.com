import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CAL_UI_RAW = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/calendar.tsx"), "utf8");
/**
 * Comments stripped before matching. A guard that greps the raw file trips over the very comment
 * explaining the bug it forbids — which has now happened four times in this codebase. When the rule
 * is about what the code DOES, read the code.
 */
const CAL_UI = CAL_UI_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CAL_API = readFileSync(join(__dirname, "../routes/calendar.ts"), "utf8");
const I18N = readFileSync(join(__dirname, "../../../shared/src/i18n.ts"), "utf8");

/**
 * Scheduling a meeting, reported as "no possibility to set time properly" and "calendar doesn't
 * work" — and these turned out to be the SAME bug as the React #31 crash on /calendar.
 *
 * Clicking a grid slot always prefilled both times. The "New meeting" BUTTON — the most obvious way
 * in — passed null, so the form opened blank, and a blank datetime field emits 00:00 as soon as a
 * date is picked. `end` was optional and fell back to `start`, so the default outcome was a
 * midnight meeting of zero minutes.
 *
 * The API already refuses that (`EventCreate` refines endAfterStart), so it answered 400 with a
 * ZodError — an OBJECT under `error`, which the alert banner rendered as a React child. That is
 * exactly the crash reported on this page. Fixing the form removes the trigger; the alerts
 * hardening removes the crash.
 */
describe("a meeting cannot be scheduled at midnight for zero minutes", () => {
  it("the New meeting button opens on a real time, not a blank form", () => {
    expect(CAL_UI, "openCreate used to pass null, leaving both fields empty").not.toMatch(/const openCreate = \(\) => \{ setCreateInit\(null\)/);
    expect(CAL_UI).toMatch(/setMinutes\(s\.getMinutes\(\) > 30 \? 60 : 30\)/);
  });

  it("moving the start carries the end with it", () => {
    // Otherwise setting a start after the end silently produced a meeting ending before it begins.
    expect(CAL_UI).toMatch(/const changeStart = \(v: string\) => \{/);
    expect(CAL_UI).toMatch(/onChange=\{changeStart\}/);
  });

  it("an end time is REQUIRED and must be after the start", () => {
    expect(CAL_UI).toMatch(/const valid = Boolean\(title\.trim\(\) && start && end && !timeError\)/);
    expect(CAL_UI, "end_at must not silently fall back to start").not.toMatch(/new Date\(end \|\| start\)/);
    expect(CAL_UI).toMatch(/end_at: new Date\(end\)\.toISOString\(\)/);
  });

  it("the user is told why the form is blocked", () => {
    // A disabled button with no explanation is the same dead end as a silent failure.
    expect(CAL_UI).toMatch(/\{timeError && </);
    expect(I18N).toMatch(/"cal\.end_before_start"/);
  });

  it("the API still refuses an inverted range regardless of the UI", () => {
    // The client guard is UX; this is the one that cannot be bypassed.
    expect(CAL_API).toMatch(/endAfterStart/);
  });
});

/**
 * External guests. A meeting tool that can only invite colleagues is not a meeting tool — and until
 * now `attendee_ids` (workspace member ids) was the only way to name anyone.
 */
describe("people outside the workspace can be invited", () => {
  it("the API accepts guest emails, validated as emails", () => {
    expect(CAL_API).toMatch(/guest_emails: z\.array\(z\.string\(\)\.email\(\)\)\.max\(50\)\.optional\(\)/);
  });

  it("guests are normalised and de-duplicated on write", () => {
    expect(CAL_API).toMatch(/new Set\(\(b\.guest_emails \?\? \[\]\)\.map\(\(e\) => e\.trim\(\)\.toLowerCase\(\)\)/);
  });

  it("a guest gets NO workspace access — only an invitation", () => {
    // The security rule that makes this safe: canView keys on attendee_ids, never on guest_emails.
    const canView = /const canView = \([^)]*\) =>[^;]+;/.exec(CAL_API)?.[0] ?? "";
    expect(canView, "canView must exist to be checked").not.toBe("");
    expect(canView, "a guest email must never grant event-read or call-join access").not.toMatch(/guest_emails/);
  });

  it("guests are emailed, because they have no in-app notification to receive", () => {
    expect(CAL_API).toMatch(/async function inviteGuests\(/);
    expect(CAL_API).toMatch(/sendTransactionalEmail\(\{/);
    // Everything they need must be IN the mail — they cannot open the app to look it up.
    expect(CAL_API).toMatch(/timeZone: d\.timezone \|\| "UTC"/);
    expect(CAL_API).toMatch(/label: "When"/);
  });

  it("a failed invite never fails the meeting", () => {
    // Fail-soft, but logged: a silently unsent invitation looks identical to a guest ignoring it.
    expect(CAL_API).toMatch(/\[calendar\] guest invite failed/);
    expect(CAL_API).toMatch(/void inviteGuests\(/);
  });

  it("the form offers the field, with the strings translated", () => {
    expect(CAL_UI).toMatch(/guest_emails: guests/);
    expect(CAL_UI).toMatch(/const addGuest = \(\) =>/);
    for (const key of ["cal.guests", "cal.guest_placeholder", "cal.guest_hint"]) {
      expect(I18N, `${key} must exist`).toContain(`"${key}"`);
    }
  });

  it("every new string is translated into all supported languages, not just English", () => {
    for (const key of ["cal.guests", "cal.guest_hint", "cal.end_before_start"]) {
      const line = new RegExp(`"${key.replace(".", "\\.")}": \\{([^}]*)\\}`).exec(I18N)?.[1] ?? "";
      for (const lang of ["en", "pl", "ru", "uk", "ar", "fr", "de", "es", "pt", "it", "tr", "nl"]) {
        expect(line, `${key} is missing ${lang}`).toMatch(new RegExp(`\\b${lang}:`));
      }
    }
  });
});

/**
 * "I tried to make a test call — it kicked me out and it didn't even save in calls."
 *
 * The second half was exactly true and measurable: `call_sessions` had ZERO rows and exactly one
 * writer — the audio-UPLOAD path. A native call held in the product's own room created no record
 * anywhere, so it could never appear under Calls, and Meeting Memory (which works from
 * call_sessions) could never run for it.
 */
describe("a live call is actually recorded as having happened", () => {
  it("joining a room opens a session row", () => {
    expect(CAL_API).toMatch(/async function ensureCallSession\(/);
    expect(CAL_API).toMatch(/void ensureCallSession\(ws, room, me\)/);
    expect(CAL_API).toMatch(/source: "call_room"/);
  });

  it("one row per ROOM, not per participant", () => {
    // A row per joiner would turn a three-person meeting into three separate "calls".
    expect(CAL_API).toMatch(/\.eq\("room", room\)\.eq\("status", "active"\)/);
  });

  it("bookkeeping NEVER blocks joining a call", () => {
    // Refusing entry to a meeting because we could not file a record is the wrong trade.
    expect(CAL_API).toMatch(/void ensureCallSession/);
    expect(CAL_API).toMatch(/could not record call session/);
  });

  it("attendance is not recording — consent stays separate", () => {
    // `record: true` would start capturing audio because someone joined. Meeting Memory is a
    // separate, consented opt-in and must remain one.
    const fn = CAL_API.slice(CAL_API.indexOf("async function ensureCallSession("), CAL_API.indexOf("async function closeCallSession("));
    expect(fn).toMatch(/record: false/);
  });

  it("ending the meeting closes the row with a real duration", () => {
    expect(CAL_API).toMatch(/async function closeCallSession\(/);
    expect(CAL_API).toMatch(/await closeCallSession\(ws, room\)/);
    expect(CAL_API).toMatch(/duration_sec: Math\.max\(0, Math\.round/);
  });
});

/**
 * The New-meeting window itself. It was eight unrelated controls stacked in one column at four
 * different type sizes, so "when" sat between "where" and "who" with nothing to say they were
 * different questions.
 */
describe("the New meeting window is grouped, not stacked", () => {
  it("asks its questions in named sections separated by a hairline", () => {
    // Count the section HEADINGS, not a layout class: the two-column pass changed how sections are
    // bordered, and a test pinned to one class string would break on every layout change while
    // saying nothing about whether the questions are still grouped.
    const headings = (CAL_UI.match(/text-caption font-medium" style=\{\{ color: "var\(--text-muted\)" \}\}>/g) ?? []).length;
    expect(headings, "when / where / agenda / who / guests / meeting type").toBeGreaterThanOrEqual(5);
    for (const key of ["cal.when", "cal.where", "cal.agenda", "cal.attendees"]) {
      expect(CAL_UI, `${key} should head a section`).toContain(`t("${key}")`);
    }
  });

  it("heads the time group with WHEN, not with the first field's label", () => {
    // A group spanning start AND end cannot be called "Starts".
    expect(CAL_UI).toMatch(/font-medium" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal\.when"\)\}/);
    expect(I18N).toContain('"cal.when"');
    expect(I18N).toContain('"cal.where"');
  });

  it("says the duration back to the user", () => {
    // Two datetime fields make you do arithmetic to answer "how long is this?" — and it is the
    // cheapest possible guard against the zero-minute meeting this form used to create by default.
    expect(CAL_UI).toMatch(/const durationLabel =/);
    expect(CAL_UI).toMatch(/\{durationLabel &&/);
  });

  it("puts the call toggle with the location, because they answer the same question", () => {
    // Scope to CreateModal, and take the NEXT agenda marker AFTER the where marker — cal.agenda
    // also appears earlier in the file, so an unscoped indexOf sliced backwards and produced "".
    const modal = CAL_UI.slice(CAL_UI.indexOf("function CreateModal"));
    const from = modal.indexOf('t("cal.where")');
    expect(from, "the Where section must exist").toBeGreaterThan(-1);
    const to = modal.indexOf('t("cal.agenda")', from);
    const where = modal.slice(from, to > from ? to : undefined);
    expect(where.length, "empty slice means the assertion below proves nothing").toBeGreaterThan(50);
    expect(where, "the Mondaily-call checkbox belongs in the Where group").toMatch(/t\("cal\.add_call"\)/);
  });

  it("the title leads and carries no box", () => {
    expect(CAL_UI).toMatch(/w-full bg-transparent text-\[15px\] font-medium outline-none/);
  });

  it("form labels use the type scale, not arbitrary pixels", () => {
    const modal = CAL_UI.slice(CAL_UI.indexOf("function CreateModal"));
    expect(modal, "the 11px/12.5px form labels were the debt this redesign cleared")
      .not.toMatch(/className="text-\[11px\]" style=\{\{ color: "var\(--text-muted\)" \}\}>\{t\("cal/);
  });
});

/**
 * A guest invitation must be an INVITATION, not an email about a meeting.
 */
describe("guests receive a real calendar invite", () => {
  it("attaches an iCalendar part built from the meeting", () => {
    expect(CAL_API).toMatch(/import \{ buildIcs, icsUid \}/);
    expect(CAL_API).toMatch(/method: cancelled \? "CANCEL" : "REQUEST"/);
    expect(CAL_API).toMatch(/attendees: guests\.map\(\(email\) => \(\{ email \}\)\)/);
  });

  it("uses a STABLE uid so an update replaces the entry", () => {
    // A random uid per send leaves duplicate meetings in the guest's calendar.
    expect(CAL_API).toMatch(/uid: icsUid\(opts\.eventId, organiserEmail\)/);
  });

  it("prefers the join link as the location when there is a call", () => {
    // SUPERSEDED: this used to assert d.call_url, which is the MEMBER route behind sign-in. The
    // calendar entry must carry the account-less guest link — see the guest-invitation suite below.
    expect(CAL_API).toMatch(/location: guestUrl \|\| d\.location \|\| undefined/);
  });

  it("a broken invite never stops the email going out", () => {
    // A guest who receives the details is better off than one who receives nothing.
    expect(CAL_API).toMatch(/could not build the calendar invite/);
    expect(CAL_API).toMatch(/\.\.\.\(ics \? \{ ics \} : \{\}\)/);
  });

  it("the mail layer carries it, and the relay sends it as text/calendar", () => {
    const mail = readFileSync(join(__dirname, "../lib/mail.ts"), "utf8");
    expect(mail).toMatch(/ics\?: string/);
    expect(mail).toMatch(/\.\.\.\(msg\.ics \? \{ ics: msg\.ics \} : \{\}\)/);

    const sender = readFileSync(join(__dirname, "../../../../deploy/mail-appliance/mail/sender.py"), "utf8");
    // As an ALTERNATIVE, not only an attachment — most clients ignore a bare .ics for RSVP.
    expect(sender).toMatch(/add_alternative\(ics, subtype="calendar"\)/);
    expect(sender).toMatch(/set_param\("method", "REQUEST"\)/);
    expect(sender).toMatch(/filename="invite\.ics"/);
  });
});

/**
 * DELIVERABILITY. The first live invite landed in spam with authentication fully correct — SPF
 * (ip4 -all), DKIM signed by an active opendkim milter, DMARC published, rDNS matching. So what is
 * left is reputation and content, and these are the content half.
 */
describe("a guest invitation does not look like bulk mail", () => {
  it("replies reach the HOST, not a void", () => {
    // A no-reply From with no Reply-To is a strong bulk signal — and for an invitation it is simply
    // wrong: the first thing a guest wants to do is answer the person who invited them.
    expect(CAL_API).toMatch(/reply_to: opts\.organiserEmail/);
  });

  it("is sent under the host's name", () => {
    expect(CAL_API).toMatch(/displayName: `\$\{organiserName\} via Mondaily`/);
  });

  it("but keeps the FROM on the domain we can authenticate", () => {
    // Sending as the organiser's own address would fail THEIR domain's SPF and make placement worse.
    const mail = readFileSync(join(__dirname, "../lib/mail.ts"), "utf8");
    expect(mail).toMatch(/localPart: "no-reply"/);
    expect(mail, "only the display name is overridable, never the address")
      .toMatch(/displayName: opts\?\.displayName \|\| "Mondaily"/);
  });
});

/**
 * "The receiver was required to create an account ... but in the email was written you dont need
 * account." Both halves were true at once, which is the worst kind of bug: the invitation embedded
 * `/calls/<id>` — a MEMBER route behind sign-in — directly underneath a sentence promising no
 * account was needed. The account-less path already existed; the invite used the wrong one.
 */
describe("a guest invitation links somewhere a guest can actually go", () => {
  const CALL_UI = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/call-room.tsx"), "utf8");

  it("sends the account-less /join link, not the member /calls route", () => {
    expect(CAL_API).toMatch(/guestUrl = `\$\{appUrl\(\)\}\/join\/\$\{opts\.eventId\}#g=\$\{token\}`/);
    expect(CAL_API).toMatch(/action: \{ label: "Join the call", url: guestUrl \}/);
  });

  it("the calendar entry points at the same usable link", () => {
    // A guest who adds the invite to their calendar clicks the LOCATION, not the email button.
    expect(CAL_API).toMatch(/location: guestUrl \|\| d\.location/);
    expect(CAL_API).toMatch(/url: guestUrl \|\| undefined/);
  });

  it("expiry is tied to the MEETING, not a fixed 24 hours", () => {
    // A link minted today for a meeting next week would be dead on arrival — the same broken
    // promise in slower form.
    expect(CAL_API).toMatch(/Math\.max\(now \+ 24 \* 60 \* 60, \(Number\.isFinite\(endsAt\) \? endsAt : now\) \+ 4 \* 60 \* 60\)/);
  });

  it("only PROMISES no account when that is true", () => {
    expect(CAL_API).toMatch(/footnote: cancelled \|\| !guestUrl \? undefined :/);
  });

  it("a call disconnect records WHY", () => {
    // It discarded the reason and showed "ended", so being dropped mid-call was indistinguishable
    // from the host ending it, and "it kicked me out" left no evidence anywhere.
    expect(CALL_UI).toMatch(/RoomEvent\.Disconnected, \(reason\?: unknown\) =>/);
    expect(CALL_UI).toMatch(/reportCallFailure\(`disconnected: /);
  });

  it("a failed connection is not swallowed by a bare catch", () => {
    expect(CALL_UI).toMatch(/reportCallFailure\(`connect failed: /);
    expect(CALL_UI).toMatch(/keepalive: true/);
  });
});

/**
 * "It kicked me out." Diagnosed by elimination against the LIVE system rather than guessed:
 *
 *   - the token endpoint answers 200 with the correct room
 *   - the engine's signal socket ACCEPTS that token (opened cleanly)
 *   - a call_sessions row exists, so the room WAS reached
 *
 * So connect() was never the failure. The throw came from the two lines AFTER it.
 */
describe("a missing microphone does not end the meeting", () => {
  const CALL_UI = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/call-room.tsx"), "utf8");

  it("attempts each device on its own, outside the connect try", () => {
    // Both used to sit inside the same try as connect(), so a denied mic threw and the catch
    // ejected the user from a call that had already connected successfully.
    expect(CALL_UI).toMatch(/try \{ await room\.localParticipant\.setMicrophoneEnabled\(micOn\); \}/);
    expect(CALL_UI).toMatch(/try \{ await room\.localParticipant\.setCameraEnabled\(camOn\); \}/);
  });

  it("stays in the call and turns the device off in the UI", () => {
    expect(CALL_UI).toMatch(/setMicOn\(false\); denied\.push\("microphone"\)/);
    expect(CALL_UI).toMatch(/setCamOn\(false\); denied\.push\("camera"\)/);
    // setPhase("live") must still be reached when a device fails.
    const after = CALL_UI.slice(CALL_UI.indexOf("await room.connect(url, token)"));
    expect(after.indexOf('setPhase("live")')).toBeGreaterThan(after.indexOf("denied.push"));
  });

  it("tells the user which device it could not get", () => {
    // Otherwise they wonder why nobody can hear them — a working call reading as a broken one.
    expect(CALL_UI).toMatch(/You joined without your \$\{denied\.join\(" or "\)\}/);
    expect(CALL_UI).toMatch(/\{mediaNote && \(/);
  });

  it("records the real reason for a device failure", () => {
    expect(CALL_UI).toMatch(/microphone unavailable: /);
    expect(CALL_UI).toMatch(/camera unavailable: /);
  });
});
