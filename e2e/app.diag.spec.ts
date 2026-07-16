import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
test("autoembed", async ({ page }) => {
  await page.goto("https://app.mondaily.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem("mondaily_workspace_id") || "";
    const B = "https://api.mondaily.com/api/v1", H = { "Content-Type":"application/json","X-Workspace-Id":ws };
    // 1. create a distinctive new record
    const created = await (await fetch(B+"/nodes",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({vertical:"shared",object_type:"person",data:{name:"Zephyr Quantum Yoga Retreat Lisbon",notes:"boutique wellness and meditation studio"}})})).json();
    // 2. incremental reconcile (embeds new/edited)
    const rec = await (await fetch(B+"/search/reconcile",{method:"POST",credentials:"include",headers:H,body:"{}"})).json();
    // 3. vector search for it by MEANING (not the exact name)
    const s = await (await fetch(B+"/search/semantic",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({query:"wellness and meditation studio",limit:5})})).json();
    return { created_id: created?.id ?? created, reconcile: rec, mode: s.mode, found: (s.results||[]).map((x:any)=>String(x.data?.name||"").slice(0,40)) };
  });
  console.log("AUTOEMBED " + JSON.stringify(out));
});
