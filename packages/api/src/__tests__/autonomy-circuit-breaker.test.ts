import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoApproves, AUTONOMY_HOURLY_CAP } from "../lib/autonomy";

const SRC = join(__dirname, "..");
const autonomy = readFileSync(join(SRC, "lib/autonomy.ts"), "utf8");
const mail = readFileSync(join(SRC, "lib/mail.ts"), "utf8");

/**
 * The real defect behind ~450 unattended record writes was not that an agent decided — it was that
 * it decided the same thing every 4 hours forever, with no ceiling and an audit trail that silently
 * wrote nothing. Autonomy stays on; these are the guards that make it survivable.
 */
describe("autonomy risk policy", () => {
  it("HIGH never auto-runs, at any level", () => {
    for (const l of ["manual", "assisted", "autonomous"] as const) {
      expect(autoApproves(l, "high"), `${l} auto-approved HIGH`).toBe(false);
    }
  });

  it("medium is the assisted/autonomous boundary", () => {
    expect(autoApproves("assisted", "medium")).toBe(false);   // record creation now lands here
    expect(autoApproves("assisted", "low")).toBe(true);
    expect(autoApproves("autonomous", "medium")).toBe(true);  // explicit opt-in to unattended writes
    expect(autoApproves("manual", "low")).toBe(false);
  });
});

describe("circuit breaker on unattended execution", () => {
  it("has a finite hourly ceiling", () => {
    expect(AUTONOMY_HOURLY_CAP).toBeGreaterThan(0);
    expect(AUTONOMY_HOURLY_CAP).toBeLessThan(500);   // 450 writes must not fit under it
  });

  it("checks the ceiling BEFORE executing the action", () => {
    const fn = autonomy.slice(autonomy.indexOf("export async function maybeAutoApprove"));
    expect(fn.indexOf("autonomyUsageLastHour")).toBeLessThan(fn.indexOf("executeApprovedAction"));
  });

  it("counts from the database, not memory — a serverless counter would never fire", () => {
    expect(autonomy).toMatch(/from\("decision_queue"\)[\s\S]{0,200}resolved_by", "autonomy"/);
    expect(autonomy).toMatch(/gte\("resolved_at", since\)/);
    // no module-level mutable counter pretending to be state
    expect(autonomy).not.toMatch(/^let [a-zA-Z]+Count = 0/m);
  });

  it("leaves the decision PENDING rather than rejecting it", () => {
    const fn = autonomy.slice(autonomy.indexOf("export async function maybeAutoApprove"));
    const capBlock = fn.slice(fn.indexOf("if (used >= AUTONOMY_HOURLY_CAP)"), fn.indexOf("executeApprovedAction"));
    expect(capBlock).toMatch(/return false;/);
    expect(capBlock).not.toMatch(/status: "rejected"/);
  });

  it("notifies once per breach, not once per blocked decision", () => {
    // 450 notifications is not an improvement on 450 silent writes.
    expect(autonomy).toMatch(/if \(used === AUTONOMY_HOURLY_CAP\)/);
  });
});

describe("the auto-approval audit actually lands", () => {
  it("never inserts an activities row it knows will be rejected", () => {
    // activities.node_id is NOT NULL and discovery sets source_id = null, so the old
    // `node_id: decision.source_id ?? null` row failed for every discovery auto-approval — with the
    // error swallowed by `.then(() => {}, () => {})`.
    expect(autonomy).not.toMatch(/node_id: decision\.source_id \?\? null/);
    expect(autonomy).toMatch(/if \(decision\.source_id\)/);
  });

  it("does not swallow the audit error", () => {
    const fn = autonomy.slice(autonomy.indexOf("export async function maybeAutoApprove"));
    expect(fn).not.toMatch(/from\("activities"\)[\s\S]{0,300}\.then\(\(\) => \{\}, \(\) => \{\}\)/);
    expect(fn).toMatch(/audit row failed/);
  });
});

describe("the sovereign mail relay is bounded", () => {
  it("aborts instead of stalling every send on an unreachable appliance", () => {
    // SOVEREIGN_MAIL_SEND_URL pointed at :8095, which is not reachable from the public internet.
    // With no timeout, each send waited out a TCP connect before falling through to Gmail —
    // long enough to exceed the serverless limit and fail a send that would otherwise work.
    const fn = mail.slice(mail.indexOf("async function sendViaSovereignRelay"));
    expect(fn).toMatch(/AbortController/);
    expect(fn).toMatch(/signal: ctrl\.signal/);
    expect(fn).toMatch(/clearTimeout\(timer\)/);
  });

  it("still falls through to the other tiers", () => {
    expect(mail).toMatch(/if \(await sendViaSovereignRelay\(workspaceId, msg\)\) return true;\s*\n\s*if \(await sendViaGoogle/);
  });
});
