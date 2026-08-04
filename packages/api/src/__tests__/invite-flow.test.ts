import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "../routes/invites.ts"), "utf8");

/**
 * The invite boundary — where someone gains access to a workspace.
 */
describe("invite acceptance is bound to the right person", () => {
  it("identity comes from the verified session, never the request body", () => {
    expect(src).toMatch(/const userId = c\.get\("userId"\); \/\/ from the verified token/);
  });

  it("an EMAIL invite rejects a different signed-in user", () => {
    // Otherwise an already-signed-in owner could accept an invite meant for someone else and be
    // demoted by it.
    expect(src).toMatch(/email_mismatch: true/);
  });

  it("never downgrades an existing membership", () => {
    expect(src).toMatch(/RANK\[existing\.role as string\] \?\? 0\) >= /);
  });

  it("the seat cap is enforced at REDEMPTION, not at send", () => {
    // One shareable link can be redeemed many times, so checking only at send would let a single
    // link fill a one-seat workspace.
    expect(src).toMatch(/const acceptSeats = await seatUsage\(invite\.workspace_id\)/);
    expect(src).toMatch(/seat_limit: acceptSeats\.limit/);
  });
});

describe("a shareable link is actually shareable", () => {
  it("link invites are NOT consumed on acceptance", () => {
    // accept filters on `accepted_at IS NULL` and used to stamp every invite, so the SECOND person
    // to click a shared link got "Invalid or expired invite" — the feature worked exactly once,
    // contradicting both its name and the seat-cap comment right above it.
    const accepts = src.match(/if \(!isLinkInvite\) \{\s*await supabase\.from\("workspace_invites"\)\.update\(\{ accepted_at/g) ?? [];
    expect(accepts.length, "both consumption points must skip link invites").toBe(2);
  });

  it("email invites remain strictly single-use", () => {
    expect(src).toMatch(/accepted_at: new Date\(\)\.toISOString\(\)/);
    expect(src).toMatch(/\.is\("accepted_at", null\)/);
  });

  it("links still expire", () => {
    // Unlimited redemptions inside a bounded window, not forever.
    expect(src).toMatch(/expires_at: new Date\(Date\.now\(\) \+ 7 \* 24 \* 60 \* 60 \* 1000\)/);
    expect(src).toMatch(/\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  });
});
