import type { Page } from "@playwright/test";
import { test } from "@playwright/test";

/**
 * e2e safety rails. The suite runs against PRODUCTION, so it must never take a side effect —
 * no real emails, payments, subscriptions, ticket creation, agent runs, sends, or bulk writes.
 *
 *  - The authenticated smoke is READ-ONLY: it navigates and observes. `attachReadOnlyGuard` proves
 *    it by failing the test if a request to a known side-effecting endpoint fires.
 *  - Any future MUTATION test must be wrapped in `mutationSuite`, which is SKIPPED unless
 *    TEST_ALLOW_MUTATIONS=1 is set (intended only against a disposable, non-prod target).
 */

export const MUTATIONS_ALLOWED = process.env.TEST_ALLOW_MUTATIONS === "1";

// Side-effecting endpoints (money, mail, tickets, agent runs, writes). A mutating HTTP method to any
// of these during the read-only smoke is a hard failure. Conservative denylist → no false positives
// on ordinary GET reads that pages make on load.
export const SIDE_EFFECT_RE =
  /\/(billing\/(checkout|subscribe|credits-checkout|setup-intent|confirm-subscription)|discovery\/(save|save-batch|bulk-|enrich|run|trigger|monitors)|support\/tickets|messages$|messages\/|onboarding\/complete|invites|agents\/.*\/run|cron\/|calendar\/events|lists\/.*\/entries|workflows\/.*\/run)/;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Attach to a page BEFORE navigation; returns a getter for any side-effect violations observed. */
export function attachReadOnlyGuard(page: Page): () => string[] {
  const violations: string[] = [];
  page.on("request", (req) => {
    const method = req.method().toUpperCase();
    if (MUTATING_METHODS.has(method) && SIDE_EFFECT_RE.test(req.url())) {
      violations.push(`${method} ${req.url()}`);
    }
  });
  return () => violations;
}

/** Wrap write/mutation tests so they are SKIPPED unless explicitly enabled on a safe target. */
export function mutationSuite(title: string, fn: () => void): void {
  test.describe(title, () => {
    test.skip(!MUTATIONS_ALLOWED, "Mutation e2e disabled — set TEST_ALLOW_MUTATIONS=1 on a disposable (non-prod) target to enable");
    fn();
  });
}
