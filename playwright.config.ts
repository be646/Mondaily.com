import { defineConfig } from "@playwright/test";

/**
 * Mondaily e2e — runs against PRODUCTION (the deploy-review loop's environment of record).
 *
 *   npx playwright test                      → public smoke (landing + auth surfaces), no creds needed
 *   MONDAILY_TEST_EMAIL=… MONDAILY_TEST_PASSWORD=… npx playwright test
 *                                            → also runs the authenticated app smoke
 *
 * The authenticated project is HONESTLY SKIPPED (not faked green) when credentials are absent.
 * Use a dedicated low-privilege test workspace account — never a real customer's.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://app.mondaily.com",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "public", testMatch: /public\..*\.spec\.ts/ },
    {
      name: "authenticated",
      testMatch: /app\..*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "e2e/.auth/state.json" },
    },
    { name: "setup", testMatch: /auth\.setup\.ts/ },
  ],
});
