import { test, expect } from "@playwright/test";
import { MUTATIONS_ALLOWED, SIDE_EFFECT_RE } from "./_safety";

/**
 * Safety posture guard (no creds, no network). Ensures the default run can never take a side effect
 * against production: mutation suites stay OFF unless TEST_ALLOW_MUTATIONS=1 is explicitly set.
 */
test("mutation e2e is OFF by default (opt-in only)", () => {
  expect(MUTATIONS_ALLOWED).toBe(process.env.TEST_ALLOW_MUTATIONS === "1");
  if (!process.env.TEST_ALLOW_MUTATIONS) expect(MUTATIONS_ALLOWED).toBe(false);
});

test("read-only guard denylist covers money/mail/tickets/agent/bulk endpoints", () => {
  for (const path of [
    "https://api.mondaily.com/api/v1/billing/subscribe",
    "https://api.mondaily.com/api/v1/support/tickets",
    "https://api.mondaily.com/api/v1/discovery/save-batch",
    "https://api.mondaily.com/api/v1/discovery/bulk-task",
    "https://api.mondaily.com/api/v1/messages",
    "https://api.mondaily.com/api/v1/onboarding/complete",
    "https://api.mondaily.com/api/v1/agents/meeting/run",
  ]) {
    expect(SIDE_EFFECT_RE.test(path), path).toBe(true);
  }
  // ...but ordinary GET reads are NOT in the denylist (no false positives).
  for (const path of [
    "https://api.mondaily.com/api/v1/billing",
    "https://api.mondaily.com/api/v1/discovery",
    "https://api.mondaily.com/api/health",
  ]) {
    expect(SIDE_EFFECT_RE.test(path), path).toBe(false);
  }
});
