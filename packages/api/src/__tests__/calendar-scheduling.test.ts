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
