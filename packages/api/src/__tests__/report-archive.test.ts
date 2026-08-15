import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The report archive + dashboard workspace widgets (2026-08-15, "go" on the last recommendations).
 *
 * The archive answers a different question than the live exports: not "what are the numbers"
 * but "what did the August 1st email actually SAY". Filed bytes, never recomputed — a backdated
 * correction may move the live ledger, and the receipt must not move with it.
 */

const sched = readFileSync(join(__dirname, "../lib/report-schedule.ts"), "utf8");
const reports = readFileSync(join(__dirname, "../routes/reports.ts"), "utf8");
const auth = readFileSync(join(__dirname, "../middleware/auth.ts"), "utf8");
const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/index.tsx"), "utf8");
const dash = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/dashboard-view.tsx"), "utf8");

describe("every real scheduled send is archived, exactly as sent", () => {
  it("the archive renders from the SAME bundle the email was built from — no second composition", () => {
    // archiveSend receives the bundle; recomposing inside it would file different bytes than were mailed.
    expect(sched).toMatch(/archiveSend\(wsId, cadence, key, bundle, subject\)/);
    expect(sched).not.toMatch(/archiveSend[\s\S]{0,600}composeWorkspaceReport/);
  });

  it("archiving is non-fatal and archives only AFTER the transport accepted", () => {
    const sendIdx = sched.indexOf("await sendWorkspaceEmail(");
    const archIdx = sched.indexOf("await archiveSend(");
    expect(archIdx).toBeGreaterThan(sendIdx);
    expect(sched).toContain("the email is the deliverable, the archive is the receipt");
  });

  it("a cron retry updates the existing receipt for (cadence, period) instead of shelving a duplicate", () => {
    expect(sched).toMatch(/eq\("data->>cadence", cadence\)\.eq\("data->>period_key", key\)/);
    expect(sched).toMatch(/if \(existing\) await supabase\.from\("nodes"\)\.update/);
  });

  it("send-test does NOT archive — a test is not a receipt", () => {
    const testBlock = reports.slice(reports.indexOf('router.post("/schedule/send-test"'), reports.indexOf('router.post("/", zValidator'));
    expect(testBlock).not.toContain("archiveSend");
  });
});

describe("archived files download as link clicks, workspace-scoped", () => {
  it("list + per-format download routes exist, registered before /:id", () => {
    expect(reports.indexOf('router.get("/archive"')).toBeGreaterThan(-1);
    expect(reports.indexOf('router.get("/archive/:id/:fmt"')).toBeLessThan(reports.indexOf('router.get("/:id"'));
  });

  it("the download re-verifies workspace ownership of the node before touching storage", () => {
    const block = reports.slice(reports.indexOf('router.get("/archive/:id/:fmt"'));
    expect(block.slice(0, 700)).toMatch(/eq\("workspace_id", c\.get\("workspaceId"\)\)/);
  });

  it("the nav carve-out covers archive paths — these are link clicks too", () => {
    expect(auth).toContain('archive\\/[\\w-]+\\/(xlsx|pdf)');
  });

  it("the Reports page lists past sends with per-format links carrying ?ws=", () => {
    expect(page).toContain("function PastReports()");
    expect(page).toContain('apiClient.get("/reports/archive")');
    expect(page).toMatch(/\/api\/v1\/reports\/archive\/\$\{a\.id\}\/\$\{f\}\?ws=/);
    expect(page).toContain("exactly as emailed, never recomputed");
  });
});

describe("dashboards pin the bundle's charts — one composition, every surface", () => {
  it("bundle.json exists so widgets render the SAME numbers the files carry", () => {
    expect(reports).toContain('router.get("/bundle.json"');
    expect(dash).toContain("/reports/bundle.json?period=");
  });

  it("the workspace widget type renders trend (projection separated) and stages", () => {
    expect(dash).toContain('interface WorkspaceWidget');
    expect(dash).toContain('function WorkspaceWidgetCard');
    expect(dash).toMatch(/forecastFrom=\{widget\.metric === "trend" \? \(q\.data\?\.forecastFrom \?\? undefined\) : undefined\}/);
    expect(dash).toMatch(/if \(w\.type === "workspace"\) return !w\.metric;/);   // broken-widget honesty
  });

  it("the add-widget modal offers both charts across four periods", () => {
    expect(dash).toContain('{ id: "workspace" as const, label: "Workspace"');
    expect(dash).toContain('metric: "trend" as const');
    expect(dash).toContain('metric: "stages" as const');
  });
});
