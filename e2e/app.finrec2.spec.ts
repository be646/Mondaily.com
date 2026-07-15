import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
const OUT = "/private/tmp/claude-501/-Users-dannynicolaos/e8d9227e-514e-4da6-9e9a-bff082577bb0/scratchpad";
test("record-finance", async ({ page }) => {
  const fails: string[] = [];
  page.on("response", r => { if (r.url().includes("/api/") && r.status()>=400) fails.push(`${r.status()} ${r.url().split("/api/")[1]}`); });
  await page.goto("https://app.mondaily.com/objects/companies", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByText("Mondaily", { exact: true }).first().click().catch(()=>{});
  await page.waitForTimeout(2500);
  console.log("URL", page.url());
  const fin = page.getByText(/^Finance$/).first();
  if (await fin.count()) { await fin.click(); await page.waitForTimeout(1800); }
  console.log("APIFAIL", JSON.stringify([...new Set(fails)].slice(0,6)));
  await page.screenshot({ path: `${OUT}/record-finance2.png`, fullPage: true });
});
