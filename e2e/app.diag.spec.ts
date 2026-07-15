import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
test("dbg2", async ({ page }) => {
  await page.goto("https://app.mondaily.com/home", { waitUntil: "networkidle" });
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem("mondaily_workspace_id") || "";
    const B = "https://api.mondaily.com/api/v1", H = { "Content-Type": "application/json", "X-Workspace-Id": ws };
    const r = await fetch(B+"/search/semantic",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({query:"skin",limit:5})});
    return await r.json();
  });
  console.log("DBG2 " + JSON.stringify(out).slice(0,500));
});
