import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/**
 * Guards for the account-type / billing invariants. Each corresponds to a verified hole:
 * a replayable credit faucet, unenforced seat caps, and purchased credits being consumed to
 * satisfy a plan's included allotment.
 */

describe("credit grants are idempotent (no replay faucet)", () => {
  it("onboarding reconciles against GRANT rows, never the spendable balance", () => {
    const src = read("routes/onboarding.ts");
    // The old code did `creditStatus(ws)` → `target - balance`. Balance is grants + purchases −
    // usage, so it FALLS as credits are spent: grant 1M → spend it → balance ≈ 0 → re-grant 1M.
    // POST /onboarding/complete was therefore an unlimited, unauthenticated-by-role credit faucet.
    expect(src).toMatch(/reconcileIncludedCredits\(ws, \{ enrollIfEmpty: true \}\)/);
    expect(src).not.toMatch(/const \{ balance \} = await creditStatus\(ws\)/);
    expect(src).not.toMatch(/const delta = target - balance/);
  });

  it("tier activation tops up from grant rows, so purchased credits are never absorbed", () => {
    const src = read("lib/credits.ts");
    // grantTierCredits measured against `balance`, so buying a 400k pack then subscribing to
    // Operator (1M included) granted only 600k — the customer's purchased credits silently paid
    // for part of the plan's included allotment.
    expect(src).toMatch(/export async function grantTierCredits/);
    expect(src).toMatch(/const \{ granted \} = await ledgerBreakdown\(workspaceId\)/);
    expect(src).toMatch(/const delta = target - granted/);
  });

  it("the Operator trial is once per workspace", () => {
    const src = read("routes/onboarding.ts");
    // trial_used was WRITTEN here but never READ, so re-running onboarding minted a fresh 14-day
    // Operator trial every time.
    expect(src).toMatch(/const trialAlreadyUsed = Boolean\(preSettings\.trial_used\)/);
    expect(src).toMatch(/trialExhausted/);
  });

  it("onboarding cannot re-tier a workspace with an active subscription", () => {
    const src = read("routes/onboarding.ts");
    // The route preserves billing_status/stripe_subscription_id but rewrites account_tier, so an
    // empty-body POST would drop a paying Command workspace to Scout while billing stayed active.
    expect(src).toMatch(/preSettings\.stripe_subscription_id && preSettings\.billing_status === "active"/);
  });
});

describe("seat limits are enforced, not just advertised", () => {
  it("a shared helper resolves capacity from the entitlement", () => {
    const src = read("lib/seats.ts");
    expect(src).toMatch(/getEntitlement\(workspaceId\)/);        // never re-derive the tier
    expect(src).toMatch(/PLAN_TIERS\[tier\]\.seats/);            // cap comes from the catalog
    // Pending invites count, so a burst of invites can't collectively overshoot the cap.
    expect(src).toMatch(/workspace_invites/);
  });

  it("every path that consumes a seat checks capacity", () => {
    const src = read("routes/invites.ts");
    // POST /invites, POST /invites/link and POST /invites/accept all wrote to workspace_members
    // with no capacity check at all — a 1-seat Scout workspace could onboard unlimited people.
    const checks = src.match(/seatUsage\(/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(3);
    // accept is THE chokepoint: one shareable link row can be redeemed unlimited times, so a
    // send-time check alone would not bound the member count.
    expect(src).toMatch(/const acceptSeats = await seatUsage\(invite\.workspace_id\)/);
    expect(src).toMatch(/acceptSeats\.members >= acceptSeats\.limit/);
  });
});

describe("tier is resolved in exactly one place", () => {
  it("no surface re-derives the tier from raw settings", () => {
    // `account_tier ?? track` is the original divergence bug: an expired trial keeps
    // account_tier "operator", so these surfaces claimed a tier the resolver denies.
    expect(read("routes/usage.ts")).not.toMatch(/settings\.account_tier as string\) \?\? \(settings\.track/);
    expect(read("routes/usage.ts")).toMatch(/getEntitlement\(ws\)/);
    // auto-refill drives the purchased-pack BONUS off the tier — reading raw account_tier handed
    // an expired trial a bonus it is no longer entitled to.
    expect(read("lib/auto-refill.ts")).toMatch(/await getEntitlement\(workspaceId\)\)\.tier/);
    expect(read("lib/auto-refill.ts")).not.toMatch(/normalizeTierId\(\(settings as \{ account_tier/);
  });
});
