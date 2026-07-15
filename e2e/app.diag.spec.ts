import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
test("semantic queries", async ({ page }) => {
  await page.goto("https://app.mondaily.com/home", { waitUntil: "networkidle" });
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem("mondaily_workspace_id") || "";
    const B = "https://api.mondaily.com/api/v1";
    const H = { "Content-Type": "application/json", "X-Workspace-Id": ws };
    const j = async (b:any)=>{const r=await fetch(B+"/search/semantic",{method:"POST",credentials:"include",headers:H,body:JSON.stringify(b)});const d=await r.json();return {n:(d.results||[]).length, top:(d.results||[]).slice(0,3).map((x:any)=>({name:x.data?.name, reason:x.reason}))};};
    return {
      founders: await j({query:"startup founders and CEOs", limit:5}),
      cosmetics: await j({query:"cosmetics or skincare related records", limit:5}),
    };
  });
  console.log("SEMQ " + JSON.stringify(out));
});
