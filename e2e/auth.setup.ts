import { test as setup } from "@playwright/test";
import fs from "node:fs";

/**
 * Signs in through the REAL shadow-login UI and saves storageState for the authenticated
 * project. HONESTLY SKIPPED when MONDAILY_TEST_EMAIL / MONDAILY_TEST_PASSWORD are absent —
 * the authenticated suite then skips too (never a fake pass).
 */
const EMAIL = process.env.MONDAILY_TEST_EMAIL;
const PASSWORD = process.env.MONDAILY_TEST_PASSWORD;

setup("authenticate", async ({ page }) => {
  setup.skip(!EMAIL || !PASSWORD, "Set MONDAILY_TEST_EMAIL + MONDAILY_TEST_PASSWORD to run the authenticated suite");
  await page.goto("/auth/shadow-login");
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
  await page.locator('input[type="password"]').first().fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click();
  await page.waitForURL(/\/(home|onboarding|auth\/workspace-select)/, { timeout: 30_000 });
  fs.mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: "e2e/.auth/state.json" });
});
