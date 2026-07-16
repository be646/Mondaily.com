import { test } from "@playwright/test";
test.use({ storageState: "e2e/.auth/state.json" });
test("react", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("https://app.mondaily.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem("mondaily_workspace_id") || "";
    const B = "https://api.mondaily.com/api/v1", H = { "Content-Type":"application/json","X-Workspace-Id":ws };
    const due = new Date(Date.now() - 15*86400000).toISOString();
    const t = await (await fetch(B+"/tasks",{method:"POST",credentials:"include",headers:H,body:JSON.stringify({title:"Escalate stalled onboarding for SkinCare.pl before contract renewal",priority:"urgent",status:"todo",due_date:due})})).json();
    await fetch(B+"/agents/operations/run",{method:"POST",credentials:"include",headers:H,body:"{}"});
    await new Promise(s=>setTimeout(s,3000));
    const decs = await (await fetch(B+"/decisions?limit=50",{credentials:"include",headers:H})).json();
    const list = Array.isArray(decs)?decs:(decs.decisions||[]);
    const d = list.find((x:any)=> x.source_id === t.id);
    const rat = (d?.evidence||[]).find((e:any)=>e.type==="rationale");
    return { task_id: t.id, title: d?.title, action: (d?.recommended_action||"").slice(0,180), confidence: rat?.confidence, rationale: (rat?.match_reason||"").slice(0,160) };
  });
  console.log("REACT " + JSON.stringify(out));
});
