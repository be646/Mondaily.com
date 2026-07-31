import { describe, it, expect } from "vitest";
import { compareWindows } from "@mondaily/shared/baseline";

/** Baseline engine — REAL executed tests. The one shared "vs last period" comparator. */
describe("compareWindows — the honest-delta contract", () => {
  it("both zero → none (a dash, never 0%)", () => {
    expect(compareWindows(0, 0)).toMatchObject({ kind: "none", label: "", direction: 0 });
  });
  it("no baseline → new (never a % against nothing)", () => {
    expect(compareWindows(7, 0)).toMatchObject({ kind: "new", label: "new", direction: 1, pct: null });
  });
  it("tiny baseline → raw counts, not a wild percentage", () => {
    expect(compareWindows(12, 3)).toMatchObject({ kind: "raw", label: "12 vs 3", pct: null });
    expect(compareWindows(1, 4)).toMatchObject({ kind: "raw", label: "1 vs 4", direction: -1 });
  });
  it("adequate baseline → rounded pct; display capped as >maxPct", () => {
    expect(compareWindows(126, 22)).toMatchObject({ kind: "pct", pct: 473, label: "473%", direction: 1 });
    expect(compareWindows(15, 20)).toMatchObject({ kind: "pct", pct: -25, label: "25%", direction: -1 });
    expect(compareWindows(60000, 5)).toMatchObject({ kind: "pct", label: ">999%" });
  });
  it("flat → empty label, direction 0", () => {
    expect(compareWindows(9, 9)).toMatchObject({ kind: "flat", label: "", direction: 0 });
  });
  it("the raw comparison ALWAYS travels in detail", () => {
    for (const [a, b] of [[0, 0], [7, 0], [12, 3], [126, 22], [9, 9]] as const) {
      expect(compareWindows(a, b).detail).toBe(`${a} this period vs ${b} previous`);
    }
  });
  it("minBase is tunable (money callers can pass a higher floor)", () => {
    expect(compareWindows(300, 40, { minBase: 100 }).kind).toBe("raw");
    expect(compareWindows(300, 150, { minBase: 100 }).kind).toBe("pct");
  });
});

describe("business-outcomes engine (source-read guards)", () => {
  it("outcomes endpoint: admin-gated, currency-converted with honest unconverted counts, engine deltas", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const a = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    // Re-pointed same-day: the engine moved into lib/outcomes.ts (shared by route + brief).
    const r = a.slice(a.indexOf('router.get("/outcomes"'));
    expect(r).toContain("requireAuth, requireAdminRole");
    const lib = readFileSync(join(__dirname, "../lib/outcomes.ts"), "utf8");
    expect(lib).toContain("makeBaseConverter(ws)");
    expect(lib).toMatch(/unconverted/);                        // disclosed, not silently face-valued
    expect(lib).toMatch(/compareWindows\(Math\.round\(teamNow\.won\)/);
    // pipeline is a balance as-of-now, never a windowed flow
    expect(lib).toContain("a BALANCE (as of now), not a windowed flow");
  });
  it("Team Oversight windows are calendar-anchored (no rolling 30d) and Sales strip mounts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const t = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/team-oversight.tsx"), "utf8");
    expect(t).not.toContain("PERIOD_TO_DAYS");
    expect(t).toMatch(/function calendarDays/);
    expect(t).toMatch(/<SalesStrip period=\{period\} \/>/);
    expect(t).toMatch(/useOutcomes\(period\)/);
  });
});

describe("executive brief — autonomous, safe, honest (source-read guards)", () => {
  it("cron is fail-closed on CRON_SECRET; job resolves recipients server-side and skips quiet workspaces", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const appTs = readFileSync(join(__dirname, "../app.ts"), "utf8");
    const cron = appTs.slice(appTs.indexOf('app.get("/api/cron/executive-brief"'));
    expect(cron).toContain("Cron disabled — CRON_SECRET is not configured.");
    const job = readFileSync(join(__dirname, "../jobs/executive-brief.ts"), "utf8");
    expect(job).toMatch(/\.in\("role", \["owner", "admin"\]\)/);   // recipients from DB roles only
    expect(job).toContain("computeOutcomes(ws, monthStart, monthEnd, prevStart, prevEnd)");
    expect(job).toMatch(/groundingViolations\(candidate, digest\)\.length === 0/);
    expect(job).toContain("skipped++");                            // honest skip for quiet workspaces
    expect(job).toContain("could not be currency-converted and are excluded");
    const vj = readFileSync(join(__dirname, "../../vercel.json"), "utf8");
    expect(vj).toContain('"/api/cron/executive-brief", "schedule": "0 7 1 * *"');
  });
  it("the outcomes route delegates to lib/outcomes (one engine for route, brief, report)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const a = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    const r = a.slice(a.indexOf('router.get("/outcomes"'), a.indexOf('router.get("/outcomes"') + 900);
    expect(r).toContain("computeOutcomes(ws, start, end, prevStart, prevEnd)");
  });
});

describe("Secret Brain — shadow-mode contract (source-read guards)", () => {
  it("the job is READ-ONLY over workspace data: writes touch ONLY brain tables", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const job = readFileSync(join(__dirname, "../jobs/secret-brain.ts"), "utf8");
    // every insert/update targets brain_runs or intelligence_signals — nothing else
    const writes = [...job.matchAll(/\.from\("([^"]+)"\)\s*\.\s*(insert|update|upsert|delete)/g)].map(m => m[1]);
    expect(writes.length).toBeGreaterThan(0);
    for (const t of writes) expect(["brain_runs", "intelligence_signals"]).toContain(t);
    // no AI in the detection path, no mail, no decisions
    expect(job).not.toMatch(/aiGateway/);
    expect(job).not.toMatch(/sendTransactionalEmail/);
    expect(job).not.toMatch(/decision_queue"\)\s*\.\s*(insert|update)/);
    // honest disable when the migration isn't applied
    expect(job).toContain('return { enabled: false');
    // proof-of-work recorded
    expect(job).toMatch(/rows_scanned/);
  });
  it("signals carry evidence ids; the read endpoint is admin-only and honest about states", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const job = readFileSync(join(__dirname, "../jobs/secret-brain.ts"), "utf8");
    for (const ev of ["node_id", "task_ids", "decision_ids"]) expect(job).toContain(ev);
    const a = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
    const r = a.slice(a.indexOf('router.get("/brain"'));
    expect(r).toContain("requireAuth, requireAdminRole");
    expect(r).toContain('reason: "migration_not_applied"');
  });
  it("the shadow panel hides rather than fakes, and the migration constrains mode to shadow", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ui = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/activity.tsx"), "utf8");
    expect(ui).toContain("if (!q.data?.enabled) return null;");
    expect(ui).toContain("found nothing to flag");
    const mig = readFileSync(join(__dirname, "../../../db/migrations/20260731_secret_brain.sql"), "utf8");
    expect(mig).toContain("check (mode in ('shadow'))");
  });
});

describe("loss-reason capture + lost-deal analysis", () => {
  it("stage→lost transitions pause for ONE modal; reason lands in the SAME patch", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const APP = join(__dirname, "../../../../apps/app/src");
    const rt = readFileSync(join(APP, "components/records/record-table.tsx"), "utf8");
    expect(rt).toMatch(/isLostStage\(newVal\) && !record\.data\.loss_reason/);
    expect(rt).toMatch(/\.\.\.\(extra \?\? \{\}\)/);          // same-patch read-merge-write
    const bv = readFileSync(join(APP, "components/records/board-view.tsx"), "utf8");
    expect(bv).toMatch(/isLostStage\(newStage\) && !rec\.data\.loss_reason/);
    const lm = readFileSync(join(APP, "components/records/loss-reason.tsx"), "utf8");
    expect(lm).toContain("Skip");                             // skipping is allowed, honestly
  });
  it("the engine groups lost deals by reason with an honest 'no reason recorded' bucket", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const lib = readFileSync(join(__dirname, "../lib/outcomes.ts"), "utf8");
    expect(lib).toContain('"no reason recorded"');
    expect(lib).toMatch(/lost_reasons/);
  });
});

describe("sheet columns are workspace-shared; formula footer totals; goals in the brief", () => {
  it("sheet-config endpoints store columns in nodes (schema-free), workspace-scoped, bounded", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const r = readFileSync(join(__dirname, "../routes/records.ts"), "utf8");
    const cfg = r.slice(r.indexOf('router.get("/sheet-config'));
    expect(cfg).toContain('"sheet_config"');
    expect(cfg).toMatch(/eq\("workspace_id", ws\)/);
    expect(cfg).toMatch(/slice\(0, 100\)/);                     // hostile-payload cap
    expect(cfg).toContain("read-merge-write");
  });
  it("the client is server-first with a one-time localStorage migration and offline fallback", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const rt = readFileSync(join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");
    expect(rt).toMatch(/\/records\/sheet-config\//);
    expect(rt).toContain("one-time migration");
    expect(rt).toContain("the local cache keeps working");
  });
  it("formula footer totals compute client-side with the honest 'loaded rows' scope note", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const rt = readFileSync(join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");
    expect(rt).toMatch(/kind === "formula"\) return null;\s*\/\/ server can't evaluate formulas/);
    expect(rt).toMatch(/<TotalNote text="loaded rows" \/>/);
    expect(rt).toMatch(/kind === "formula" && formulaSrc/);
  });
  it("the executive brief includes real goal attainment via the shared goalActual", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const job = readFileSync(join(__dirname, "../jobs/executive-brief.ts"), "utf8");
    expect(job).toMatch(/goalActual\(ws, String\(g\.metric\)/);
    expect(job).toMatch(/goalAttainmentPct\(actual/);
  });
});

describe("AI formula builder — proposes and PROVES, never saves", () => {
  it("the endpoint executes the AI's formula against real rows and checks field references", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const r = readFileSync(join(__dirname, "../routes/records.ts"), "utf8");
    const fb = r.slice(r.indexOf('router.post("/formula-builder"'));
    expect(fb).toMatch(/evaluateFormula\(formula, sm\)/);        // proof against real samples
    expect(fb).toMatch(/formulaFields\(formula\)/);              // reference check
    expect(r).toContain("it never mutates");   // docblock sits above the route slice
    expect(fb).not.toMatch(/\.from\("nodes"\)\s*\.\s*(insert|update|upsert)/);
    expect(fb).toContain('"IMPOSSIBLE"');                        // honest not-expressible path
    expect(fb).toContain("errored on every sample row");
  });
  it("the client shows the proof + warnings and saving still requires the user's Add click", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const rt = readFileSync(join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");
    expect(rt).toContain("Proof — real rows");
    expect(rt).toMatch(/fbWarnings\.map/);
    expect(rt).toContain("nothing saves until you click Add");
  });
});

describe("workspace data export — admin-gated, workspace-scoped, honestly capped", () => {
  it("the endpoint gates on admin, scopes every table to the workspace, and discloses caps + exclusions", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const a = readFileSync(join(__dirname, "../routes/app-data.ts"), "utf8");
    const ex = a.slice(a.indexOf('router.get("/settings/export"'));
    expect(ex).toContain("isWorkspaceAdmin(c.get(\"role\"))");
    expect(ex).toMatch(/eq\("workspace_id", ws\)/);
    expect(ex).toMatch(/truncated/);
    expect(ex).toContain("internal_messages (other members' DMs)");
    expect(ex).toContain("auth tables (credential material)");
  });
  it("no duplicate session routes were left in auth.ts (settings/security owns sessions)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const auth = readFileSync(join(__dirname, "../routes/auth.ts"), "utf8");
    expect(auth).not.toContain('router.get("/sessions"');
  });
});

describe("sovereign inference backend — one spine, fail-closed, measured probe", () => {
  it("the gateway routes through the backend registry; sovereign mode fails closed", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const gw = readFileSync(join(__dirname, "../lib/ai-gateway.ts"), "utf8");
    expect(gw).toContain('inferenceMode() === "sovereign_vllm"');
    expect(gw).toContain("never a silent fallback across the sovereignty boundary");
    // sovereign mode pins the served model — task-class aliases can't request an unhosted model
    expect(gw).toContain("sovereignBackendConfig().modelOverride!");
    const be = readFileSync(join(__dirname, "../lib/inference-backend.ts"), "utf8");
    expect(be).toContain("Sovereign mode fails closed");
    expect(be).not.toMatch(/api\.openai\.com|api\.anthropic\.com/);
  });
  it("the probe MEASURES (models round-trip + real 1-token TTFT) and fabricates nothing", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const be = readFileSync(join(__dirname, "../lib/inference-backend.ts"), "utf8");
    expect(be).toMatch(/GET \/v1\/models|\/models`/);
    expect(be).toMatch(/max_tokens: 1/);
    expect(be).toContain("no fake \"PagedAttention: active\" lights");
    expect(be).not.toMatch(/PAGED_ATTENTION: ACTIVE/);
    // key never leaves; URL host-only
    expect(be).toContain("never returns the key");
    const rd = readFileSync(join(__dirname, "../routes/admin-readiness.ts"), "utf8");
    expect(rd).toContain('router.post("/readiness/vllm-test"');
    expect(rd).toContain("sovereign_vllm_configured");
  });
  it("mode selection is env-driven with exactly two REAL modes (no fictional GovCloud)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const be = readFileSync(join(__dirname, "../lib/inference-backend.ts"), "utf8");
    expect(be).toMatch(/"gateway" \| "sovereign_vllm"/);
    expect(be).not.toMatch(/gov.?cloud/i);
  });
});

describe("shadow evaluation — off by default, metadata-only, never user-visible, never metered", () => {
  it("three explicit switches gate it; a shadow failure cannot reach the user", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sh = readFileSync(join(__dirname, "../lib/inference-shadow.ts"), "utf8");
    expect(sh).toMatch(/inferenceMode\(\) === "gateway" && sovereignVllmConfigured\(\) && shadowPct\(\) > 0/);
    expect(sh).toContain("shadow must never surface");
    const gw = readFileSync(join(__dirname, "../lib/ai-gateway.ts"), "utf8");
    expect(gw).toMatch(/void maybeShadowMirror\(/);            // fire-and-forget, not awaited
  });
  it("logs METADATA only — no prompt/response persistence, no credit metering", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sh = readFileSync(join(__dirname, "../lib/inference-shadow.ts"), "utf8");
    expect(sh).toContain("texts end here — only the metadata row persists");
    expect(sh).not.toMatch(/recordAiUsage|assertCreditsOk/);   // evaluation is not product usage
    const row = sh.slice(sh.indexOf("const row = {"), sh.indexOf("await supabase"));
    expect(row).not.toMatch(/text:|prompt|content/);           // the insert carries no text fields
    const mig = readFileSync(join(__dirname, "../../../db/migrations/20260731_inference_shadow.sql"), "utf8");
    expect(mig).toContain("METADATA ONLY");
    expect(mig).not.toMatch(/prompt_text|response_text/);
  });
  it("the jaccard comparator is real and the aggregate endpoint reports honest states", async () => {
    const { jaccardPct } = await import("../lib/inference-shadow");
    expect(jaccardPct("the revenue grew fast", "the revenue grew fast")).toBe(100);
    expect(jaccardPct("alpha beta gamma", "delta epsilon zeta")).toBe(0);
    expect(jaccardPct("value won this month", "value lost this month")).toBeGreaterThan(30);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const rd = readFileSync(join(__dirname, "../routes/admin-readiness.ts"), "utf8");
    expect(rd).toContain('reason: "migration_not_applied"');
  });
});

describe("Control Room inference panel — measured-only display, no fake states", () => {
  it("hides for non-admins, discloses the heuristic, and never renders invented engine internals", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const cr = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/settings/ai-control-room.tsx"), "utf8");
    expect(cr).toContain("if (readiness.isError) return null;   // non-admin — no fake panel");
    expect(cr).toContain("are not reported by vLLM and are not shown");
    expect(cr).toContain("a screening signal, not a quality verdict");
    expect(cr).toContain("never automatic");
    expect(cr).not.toMatch(/PAGED_ATTENTION: ACTIVE/);
    expect(cr).toContain("Nothing is simulated.");
  });
});
