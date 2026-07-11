import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { supabase } from "@mondaily/db/client";
import type { OutboundMessage } from "../lib/mail";

// Capture what would be sent; toggle provider availability per test.
const sendMock = vi.fn<[OutboundMessage], Promise<boolean>>();
vi.mock("../lib/mail", () => ({ sendTransactionalEmail: (m: OutboundMessage) => sendMock(m) }));

import { sendPendingPlanEmail } from "../lib/pending-plan-email";

function stubOwner(email: string | null, name?: string) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b,
    maybeSingle: () => Promise.resolve({ data: email ? { email, name } : null }),
  };
  vi.spyOn(supabase, "from").mockReturnValue(b as never);
}

beforeEach(() => { vi.restoreAllMocks(); sendMock.mockReset(); sendMock.mockResolvedValue(true); });

describe("sendPendingPlanEmail — copy", () => {
  it("Command: correct subject, Scout-until-checkout wording, Complete-checkout CTA + billing link", async () => {
    stubOwner("owner@example.com", "Ada");
    const ok = await sendPendingPlanEmail("ws1", "u1", "command");
    expect(ok).toBe(true);
    const msg = sendMock.mock.calls[0]![0];
    expect(msg.subject).toBe("Complete your Mondaily Command setup");
    expect(msg.to).toEqual([{ email: "owner@example.com", name: "Ada" }]);
    expect(msg.body).toMatch(/selected the <strong>Command<\/strong> plan during onboarding/);
    expect(msg.body).toMatch(/free <strong>Scout<\/strong> tier until you complete\s+checkout/);
    expect(msg.body).toMatch(/Command isn’t active yet/);           // never claims active
    expect(msg.body).toMatch(/Complete checkout/);
    expect(msg.body).toMatch(/\/settings\/billing/);
  });

  it("Sovereign: correct subject, custom/not-instant wording, Talk-to-us CTA", async () => {
    stubOwner("owner@example.com");
    const ok = await sendPendingPlanEmail("ws1", "u1", "sovereign");
    expect(ok).toBe(true);
    const msg = sendMock.mock.calls[0]![0];
    expect(msg.subject).toBe("Let’s set up your Mondaily Sovereign workspace");
    expect(msg.body).toMatch(/selected the <strong>Sovereign<\/strong> plan during onboarding/);
    expect(msg.body).toMatch(/custom, private setup/);
    expect(msg.body).toMatch(/no\s+instant checkout/);
    expect(msg.body).toMatch(/free <strong>Scout<\/strong> tier until/);
    expect(msg.body).toMatch(/Talk to us/);
    expect(msg.body).toMatch(/\/settings\/billing/);
    expect(msg.body).not.toMatch(/active/);                          // never claims active
  });
});

describe("sendPendingPlanEmail — fail-safe", () => {
  it("returns false (no throw) when the mail provider is missing / declines", async () => {
    stubOwner("owner@example.com");
    sendMock.mockResolvedValue(false);                              // e.g. no RESEND_API_KEY
    await expect(sendPendingPlanEmail("ws1", "u1", "command")).resolves.toBe(false);
  });

  it("returns false (no send) when the owner has no email on file", async () => {
    stubOwner(null);
    const ok = await sendPendingPlanEmail("ws1", "u1", "command");
    expect(ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("swallows unexpected errors — never throws into onboarding", async () => {
    vi.spyOn(supabase, "from").mockImplementation(() => { throw new Error("db down"); });
    await expect(sendPendingPlanEmail("ws1", "u1", "sovereign")).resolves.toBe(false);
  });
});

describe("wiring + isolation (source guards)", () => {
  const onboarding = readFileSync(fileURLToPath(new URL("../routes/onboarding.ts", import.meta.url)), "utf8");
  const lib = readFileSync(fileURLToPath(new URL("../lib/pending-plan-email.ts", import.meta.url)), "utf8");

  it("email fires ONLY for a newly-set paid pending_plan (not Scout/Operator, not on re-run)", () => {
    expect(onboarding).toMatch(/if \(requiresPayment && _p !== chosen\) \{\s*\n\s*void sendPendingPlanEmail\(ws, userId, chosen as "command" \| "sovereign"\)/);
  });

  it("the email helper mutates NO tier/credits/Stripe/trial state (read + send only)", () => {
    expect(lib).not.toMatch(/\.update\(|account_tier|grantCredits|grantTierCredits|stripe|trial_ends_at|remaining_credits/);
    expect(lib).toMatch(/sendTransactionalEmail/);
  });

  it("send is fire-and-forget so it never blocks or breaks onboarding completion", () => {
    expect(onboarding).toMatch(/void sendPendingPlanEmail\([^)]*\)\.catch\(\(\) => \{\}\)/);
  });
});
