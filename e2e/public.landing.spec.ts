import { test, expect } from "@playwright/test";

/**
 * Public smoke — no credentials needed. Every assertion is a real page observation
 * against production; nothing here can be faked green.
 */

test("landing renders with pricing and working primary CTA", async ({ page }) => {
  await page.goto("https://mondaily.com/");
  await expect(page).toHaveTitle(/Mondaily/i);
  // Pricing section exists with the catalog plan names (packages/shared/src/pricing.ts).
  for (const plan of ["Scout", "Operator", "Command", "Sovereign"]) {
    await expect(page.locator(`text=${plan}`).first()).toBeVisible();
  }
  // Primary CTA leads to signup/registration, not a dead link.
  const cta = page.locator('a[href*="sign-up"], a[href*="register"], a[href*="app.mondaily.com"]').first();
  await expect(cta).toBeVisible();
});

test("landing links resolve (no 404s)", async ({ page, request }) => {
  await page.goto("https://mondaily.com/", { waitUntil: "networkidle" });
  // All same-site links anywhere on the page (nav/footer/CTAs), excluding pure in-page anchors.
  const hrefs = await page.locator("a[href]").evaluateAll((as) =>
    [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]
      .filter((h) => (h.startsWith("https://mondaily.com") || h.startsWith("https://app.mondaily.com")) && !h.includes("#")),
  );
  expect(hrefs.length).toBeGreaterThan(2);
  for (const href of hrefs.slice(0, 15)) {
    const res = await request.get(href, { maxRedirects: 5 });
    expect(res.status(), href).toBeLessThan(400);
  }
});

test("SEO basics present", async ({ page }) => {
  await page.goto("https://mondaily.com/");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{30,}/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /.+/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /mondaily\.com/);
});

test("app login page renders and unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto("/auth/shadow-login", { waitUntil: "networkidle" });
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 });
  // Protected route bounces to login when signed out.
  await page.goto("/home");
  await page.waitForURL(/auth|login/, { timeout: 15_000 });
});

test("api health is live and reports a commit", async ({ request }) => {
  const res = await request.get("https://api.mondaily.com/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(String(body.commit)).toMatch(/^[0-9a-f]{7,40}$/);
});
