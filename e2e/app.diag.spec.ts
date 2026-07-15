import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
test("sem final", async ({ page }) => {
  await page.goto("https://app.mondaily.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem("mondaily_workspace_id") || "";
    const B = "https://api.mondaily.com/api/v1", H = { "Content-Type": "application/json", "X-Workspace-Id": ws };
    const j = async (q:string)=>{const r=await fetch(B+"/search/semantic",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({query:q,limit:5})});const d=await r.json();return {n:(d.results||[]).length, dbg:d.debug, top:(d.results||[]).slice(0,3).map((x:any)=>({name:x.data?.name, reason:x.reason}))};};
    return { skin: await j("skin care businesses in Poland"), overdue: await j("companies I should follow up with") };
  });
  console.log("SEMF " + JSON.stringify(out));
});
