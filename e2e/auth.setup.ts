import { test as setup } from "@playwright/test";
import fs from "node:fs";
import { totpCode } from "../packages/api/src/lib/totp";

/**
 * Signs in through the REAL shadow-login UI and saves storageState for the authenticated
 * project. HONESTLY SKIPPED when MONDAILY_TEST_EMAIL / MONDAILY_TEST_PASSWORD are absent —
 * the authenticated suite then skips too (never a fake pass).
 *
 * 2FA: when the account has TOTP enrolled, the login stops at the code screen — which is the
 * feature working, not a test failure. Set MONDAILY_TEST_TOTP_SECRET (the base32 key from
 * enrollment) and the setup mints a real code with OUR OWN RFC-tested implementation; without
 * it, the authenticated suite skips with a clear message rather than red noise.
 */
const EMAIL = process.env.MONDAILY_TEST_EMAIL;
const PASSWORD = process.env.MONDAILY_TEST_PASSWORD;
const TOTP_SECRET = process.env.MONDAILY_TEST_TOTP_SECRET;

setup("authenticate", async ({ page }) => {
  setup.skip(!EMAIL || !PASSWORD, "Set MONDAILY_TEST_EMAIL + MONDAILY_TEST_PASSWORD to run the authenticated suite");
  await page.goto("/auth/shadow-login");
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  // The form's own submit button, NOT `getByRole("button", {name: /sign in/i}).first()` — that
  // matched "Sign in with Google", which sits ABOVE the password form, so the setup filled in the
  // credentials and then navigated to Google's consent screen and timed out waiting for the app.
  // The failure looked like broken authentication; it was a selector picking the wrong button.
  await page.locator('form button[type="submit"]').first().click();

  // Either we land in the app, or the 2FA screen appears.
  const mfaHeading = page.getByRole("heading", { name: /two-factor code/i });
  await Promise.race([
    page.waitForURL(/\/(home|onboarding|auth\/workspace-select)/, { timeout: 30_000 }),
    mfaHeading.waitFor({ state: "visible", timeout: 30_000 }),
  ]);

  if (await mfaHeading.isVisible().catch(() => false)) {
    setup.skip(!TOTP_SECRET, "Account has 2FA enabled — set MONDAILY_TEST_TOTP_SECRET to run the authenticated suite (or disable 2FA on the test account)");
    await page.locator('input[inputmode="numeric"]').first().fill(totpCode(TOTP_SECRET!));
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForURL(/\/(home|onboarding|auth\/workspace-select)/, { timeout: 30_000 });
  }

  fs.mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: "e2e/.auth/state.json" });
});
