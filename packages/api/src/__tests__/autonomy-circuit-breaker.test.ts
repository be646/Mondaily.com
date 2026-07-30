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

/**
 * Readiness must report EVIDENCE, not claims. `sovereign_mail_configured` (env presence) read true
 * for a day while SOVEREIGN_MAIL_SEND_URL pointed at an unreachable host and every send fell back
 * to Gmail. A status page that can't tell those apart is a guess.
 */
describe("readiness probes the mail relay instead of trusting env presence", () => {
  const readiness = readFileSync(join(SRC, "routes/admin-readiness.ts"), "utf8");

  it("reports reachability separately from configuration", () => {
    // Must be in the RESPONSE, not merely computed. Matching the whole file passed even with the
    // field deleted from the payload, because the local variable still existed — presence of a name
    // somewhere is not evidence that a caller can see it.
    const payload = readiness.slice(readiness.indexOf("sovereign_mail_configured,"));
    expect(payload).toMatch(/^\s*sovereign_mail_reachable,$/m);
    expect(payload).toMatch(/^\s*sovereign_mail_checkable,$/m);
    // configured must NOT be redefined as reachable — the two must stay distinguishable
    expect(readiness).toMatch(/const sovereign_mail_configured = has\("SOVEREIGN_MAIL_SEND_URL"\) && has\("SOVEREIGN_MAIL_SECRET"\)/);
  });

  it("grades a configured-but-dead relay as partial, not ready", () => {
    expect(readiness).toMatch(/sovereign_mail_configured && !sovereign_mail_reachable \? "partial"/);
  });

  it("keeps the probe OUT of the readiness route", () => {
    // That route is guarded against reading env VALUES and against calling fetch at all — both
    // guards caught the first version of this change, correctly. The probe belongs beside the sender.
    expect(readiness).not.toMatch(/fetch\(/);
    expect(readiness).not.toMatch(/process\.env\.SOVEREIGN_MAIL/);
    expect(readiness).toMatch(/sovereignRelayStatus\(\)/);
  });
});

describe("the relay liveness probe", () => {
  it("is GET /health only — never sends mail and never signs anything", () => {
    const fn = mail.slice(mail.indexOf("export async function sovereignRelayStatus"));
    expect(fn).toMatch(/"\/health"/);
    expect(fn).not.toMatch(/\/send/);
    expect(fn).not.toMatch(/createHmac|signature/);
    expect(fn).not.toMatch(/method: "POST"/);
  });

  it("is bounded, passes the signal, and cannot throw", () => {
    const fn = mail.slice(mail.indexOf("export async function sovereignRelayStatus"));
    expect(fn).toMatch(/AbortController/);
    // The signal must actually be PASSED to fetch — asserting only that a controller exists passed
    // with `signal:` deleted, i.e. a timeout that does nothing.
    // `[^)]*` broke on the nested `url.replace(/\/$/, "")` inside the call — match up to the options
    // object across anything instead of assuming no parentheses appear first.
    expect(fn).toMatch(/fetch\([\s\S]*?signal: ctrl\.signal/);
    expect(fn).toMatch(/clearTimeout\(timer\)/);
    expect(fn).toMatch(/catch \{/);
  });

  it("does not claim certainty when the probe failed", () => {
    // A network blip and a dead appliance are indistinguishable from here; reporting checkable:true
    // would repeat the original mistake in the other direction.
    const fn = mail.slice(mail.indexOf("export async function sovereignRelayStatus"));
    expect(fn).toMatch(/return \{ configured: true, reachable: false, checkable: false \}/);
  });
});
