import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { responseCounts, RSVP_RESPONSES } from "../routes/calendar";
import { t, SUPPORTED_LANGUAGES } from "@mondaily/shared/i18n";

const cal = readFileSync(fileURLToPath(new URL("../routes/calendar.ts", import.meta.url)), "utf8");
const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calendar.tsx", import.meta.url)), "utf8");

describe("responseCounts — attendee RSVP tally", () => {
  it("counts each response and treats missing as no_response (organizer never counted)", () => {
    const c = responseCounts({ attendee_ids: ["a", "b", "c", "d"], responses: { a: "accepted", b: "declined", c: "tentative" } });
    expect(c).toEqual({ accepted: 1, declined: 1, tentative: 1, no_response: 1 });
  });
  it("empty / missing responses → everyone awaiting", () => {
    expect(responseCounts({ attendee_ids: ["a", "b"] })).toEqual({ accepted: 0, declined: 0, tentative: 0, no_response: 2 });
    expect(responseCounts({ attendee_ids: [], responses: {} })).toEqual({ accepted: 0, declined: 0, tentative: 0, no_response: 0 });
  });
  it("ignores stray/unknown response values (never miscounts)", () => {
    const c = responseCounts({ attendee_ids: ["a"], responses: { a: "bogus" as any } });
    expect(c).toEqual({ accepted: 0, declined: 0, tentative: 0, no_response: 1 });
  });
  it("only the three canonical responses exist", () => {
    expect([...RSVP_RESPONSES]).toEqual(["accepted", "declined", "tentative"]);
  });
});

describe("respond route — participant-only, organizer notified, honest", () => {
  it("validates the response enum and is participant-gated (403 for non-participants)", () => {
    const fn = cal.slice(cal.indexOf('router.post("/events/:id/respond"'));
    expect(fn).toMatch(/zValidator\("json", z\.object\(\{ response: z\.enum\(RSVP_RESPONSES\) \}\)\)/);
    expect(fn).toMatch(/if \(!canView\(ev\.data, me\)\) return c\.json\(\{ error: "Not allowed\." \}, 403\)/);
  });
  it("refuses to RSVP to a cancelled meeting (409)", () => {
    const fn = cal.slice(cal.indexOf('router.post("/events/:id/respond"'));
    expect(fn).toMatch(/status === "cancelled".*409/s);
  });
  it("stores the response keyed by the responder and notifies the organizer (not self)", () => {
    const fn = cal.slice(cal.indexOf('router.post("/events/:id/respond"'), cal.indexOf("call-link"));
    expect(fn).toMatch(/responses: \{ \.\.\.\(ev\.data\.responses \?\? \{\}\), \[me\]: response \}/);
    expect(fn).toMatch(/if \(me !== ev\.data\.organizer_id\)/);
    expect(fn).toMatch(/source_agent: "meeting"/);
  });
  it("shape() surfaces per-attendee response + the tally", () => {
    expect(cal).toMatch(/response: responses\[uid\] \?\? null/);
    expect(cal).toMatch(/response_counts: responseCounts\(d\)/);
  });
});

describe("RSVP frontend + i18n", () => {
  it("attendees get Accept/Maybe/Decline; organizer sees a tally", () => {
    expect(page).toMatch(/respond = useMutation/);
    expect(page).toMatch(/respond\.mutate\(r\.key\)/);
    expect(page).toMatch(/e\.response_counts/);
  });
  it("all RSVP labels are translated in every language", () => {
    for (const key of ["cal.your_response", "cal.rsvp_yes", "cal.rsvp_maybe", "cal.rsvp_no", "cal.rsvp_awaiting"]) {
      for (const l of SUPPORTED_LANGUAGES) {
        const v = t(l.code, key);
        expect(v, `${key}/${l.code}`).not.toBe(key);
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});
