import { test, expect } from "@playwright/test";
import { attachReadOnlyGuard } from "./_safety";

/**
 * Authenticated app smoke — the automated form of docs/qa-smoke-checklist.md §2.
 * Runs only when auth.setup.ts produced a storageState (requires MONDAILY_TEST_EMAIL/PASSWORD).
 * Each route must load without an error boundary or blank screen. READ-ONLY: no writes, and the
 * per-test read-only guard fails the test if any side-effecting request (mail/payment/ticket/agent/
 * bulk write) fires during a load. See e2e/_safety.ts.
 */
const hasCreds = Boolean(process.env.MONDAILY_TEST_EMAIL && process.env.MONDAILY_TEST_PASSWORD);
test.skip(!hasCreds, "Set MONDAILY_TEST_EMAIL + MONDAILY_TEST_PASSWORD to run the authenticated suite");

const ROUTES: { path: string; expects: RegExp }[] = [
  { path: "/home", expects: /./ },
  { path: "/ask", expects: /ask|workspace|graph/i },
  { path: "/tasks", expects: /task/i },
  { path: "/calendar", expects: /calendar|meeting|today/i },
  { path: "/messages", expects: /inbox|message/i },
  { path: "/decisions", expects: /decision/i },
  { path: "/discovery", expects: /discovery|search/i },
  { path: "/activity", expects: /agent/i },
  { path: "/reports", expects: /report/i },
  { path: "/finance/invoices", expects: /invoice/i },
  { path: "/finance/reports", expects: /finance/i },
  { path: "/team/oversight", expects: /team|intelligence|owner/i },
  { path: "/settings/billing", expects: /plan|billing|credit/i },
  { path: "/settings/support", expects: /support|help|ticket|request/i },
  { path: "/settings/workspace", expects: /workspace/i },
];

for (const r of ROUTES) {
  test(`route loads: ${r.path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const violations = attachReadOnlyGuard(page);   // guard BEFORE navigation
    await page.goto(r.path);
    // Still authenticated (no bounce to login) and the page shows its real content.
    await expect(page).not.toHaveURL(/auth\/shadow-login/);
    await expect(page.locator("body")).toContainText(r.expects, { timeout: 20_000 });
    expect(errors, `uncaught errors on ${r.path}: ${errors.join("; ")}`).toHaveLength(0);
    // Loading a page must never take a side effect (no mail/payment/ticket/agent/bulk write).
    expect(violations(), `unexpected side-effecting request on ${r.path}`).toHaveLength(0);
  });
}

test("sidebar renders with core navigation", async ({ page }) => {
  await page.goto("/home");
  for (const label of [/task/i, /calendar/i, /report/i]) {
    await expect(page.locator("nav, aside").first()).toContainText(label);
  }
});
