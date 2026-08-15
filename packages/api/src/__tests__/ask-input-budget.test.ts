import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { budgetHistory } from "../routes/ask";

/**
 * The prompt-cost fixes of 2026-08-15, audited by running them. Measured cause: a one-line
 * question cost 7,981 input tokens, and one real thread re-sent 23,409 for a single new message.
 */
describe("history is budgeted by size, newest first, whole turns only", () => {
  const turn = (content: string) => ({ role: "user", content });

  it("keeps everything when the budget is not reached", () => {
    const t = [turn("a"), turn("b"), turn("c")];
    expect(budgetHistory(t)).toEqual(t);
  });

  it("drops the OLDEST turns when over budget", () => {
    const big = "x".repeat(10_000);
    const t = [turn(big), turn(big), turn(big), turn("newest")];
    const out = budgetHistory(t);
    expect(out[out.length - 1]!.content).toBe("newest");
    expect(out.length).toBeLessThan(t.length);
    // Never truncated mid-message — every kept turn is intact.
    for (const k of out) expect([big, "newest"]).toContain(k.content);
  });

  it("never returns empty — one oversized newest turn is still sent", () => {
    // The 23k thread must be capped, but the user's own latest context must survive.
    const out = budgetHistory([turn("x".repeat(50_000))]);
    expect(out.length).toBe(1);
  });
});

describe("the census cache and the cancellation path", () => {
  const ASK = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");
  const CAL = readFileSync(join(__dirname, "../routes/calendar.ts"), "utf8");

  it("the object-type census is cached, not swept per question", () => {
    expect(ASK).toMatch(/typesCensusCache/);
    expect(ASK).toMatch(/Date\.now\(\) - cached\.at < 60_000/);
  });

  it("cancelling a meeting reaches the GUESTS, not only the members", () => {
    // Found auditing my own work: notifyAttendees is in-app only, so a guest kept a live calendar
    // entry — join link and all — for a dead meeting.
    const del = CAL.slice(CAL.indexOf('router.delete("/events/:id"'));
    expect(del).toMatch(/void inviteGuests\(/);
    expect(del).toMatch(/"cancelled",/);
    // SEQUENCE must advance past the invite's 0 or clients ignore the cancellation.
    expect(del).toMatch(/sequence: 1/);
  });
});
