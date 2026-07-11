import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@mondaily/db/client";

// grantTierCredits hits the DB — stub it so activateTier is exercised in isolation.
vi.mock("../lib/credits", () => ({ grantTierCredits: vi.fn().mockResolvedValue(undefined) }));

import { activateTier } from "../lib/billing-tiers";

/**
 * Regression: a successful PAID activation (Stripe subscribe path AND webhook both call activateTier)
 * must clear settings.pending_plan — otherwise the onboarding "you selected X, pay to activate" nudge
 * would keep showing after the user has actually paid. This locks that behavior.
 */
function stubWorkspace(initialSettings: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    maybeSingle: () => Promise.resolve({ data: { settings: initialSettings } }),
    update: (payload: Record<string, unknown>) => { updates.push(payload); return b; },
    // thenable so `await supabase.from().update().eq()` resolves { error: null }
    then: (res: (v: { data: unknown; error: null }) => void) => res({ data: { settings: initialSettings }, error: null }),
  };
  vi.spyOn(supabase, "from").mockReturnValue(b as never);
  return updates;
}

beforeEach(() => vi.restoreAllMocks());

describe("activateTier — paid activation clears pending_plan", () => {
  it("removes pending_plan and sets the paid tier (Command)", async () => {
    const updates = stubWorkspace({ account_tier: "scout", plan: "scout", pending_plan: "command", trial_ends_at: "2099-01-01" });
    await activateTier("ws1", "command", "sub_123");

    // The settings write is the first update payload that carries a `settings` object.
    const settingsWrite = updates.find((u) => u.settings) as { settings: Record<string, unknown> } | undefined;
    expect(settingsWrite).toBeTruthy();
    const s = settingsWrite!.settings;
    expect("pending_plan" in s).toBe(false);        // ← the regression guard
    expect(s.account_tier).toBe("command");
    expect(s.plan).toBe("command");
    expect(s.billing_status).toBe("active");
    expect(s.stripe_subscription_id).toBe("sub_123");
    expect("trial_ends_at" in s).toBe(false);        // paid tier supersedes any trial
  });

  it("is safe when there was no pending_plan (idempotent)", async () => {
    const updates = stubWorkspace({ account_tier: "scout", plan: "scout" });
    await activateTier("ws2", "operator");
    const s = (updates.find((u) => u.settings) as { settings: Record<string, unknown> }).settings;
    expect("pending_plan" in s).toBe(false);
    expect(s.account_tier).toBe("operator");
  });
});
