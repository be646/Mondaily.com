const PW = '/Users/dannynicolaos/Documents/Codex/2026-05-27/doctype-html-html-lang-en-head/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = require(PW);
(async () => {
  const ctx = await (await chromium.launch()).newContext({ storageState: 'e2e/.auth/state.json' });
  const page = await ctx.newPage();
  await page.goto('https://app.mondaily.com/home', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(2500);
  const out = await page.evaluate(async () => {
    const ws = localStorage.getItem('mondaily_workspace_id');
    const r = await fetch('https://api.mondaily.com/api/v1/agents/signal/run', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json', 'X-Workspace-Id': ws||'' } });
    return { status: r.status, body: (await r.text()).slice(0,300) };
  });
  console.log(JSON.stringify(out));
  await ctx.close(); process.exit(0);
})();
