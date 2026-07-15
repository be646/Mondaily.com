import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
test("debug search", async ({ page }) => {
  await page.goto("https://app.mondaily.com/home", { waitUntil: "networkidle" });
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem("mondaily_workspace_id") || "";
    const B = "https://api.mondaily.com/api/v1", H = { "Content-Type": "application/json", "X-Workspace-Id": ws };
    // plain keyword search
    const kr = await fetch(B+"/search",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({query:"skin",limit:5})});
    const kd = await kr.json();
    // semantic with a single strong keyword
    const sr = await fetch(B+"/search/semantic",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({query:"skin",limit:5})});
    const sd = await sr.json();
    return { keyword_n: (Array.isArray(kd)?kd:[]).length, keyword_top: (Array.isArray(kd)?kd:[]).slice(0,2).map((x:any)=>x.data?.name), semantic_n: (sd.results||[]).length, semantic_top: (sd.results||[]).slice(0,2).map((x:any)=>x.data?.name) };
  });
  console.log("DBG " + JSON.stringify(out));
});
