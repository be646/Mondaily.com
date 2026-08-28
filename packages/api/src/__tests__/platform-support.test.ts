import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { platformAdminEmails } from "../middleware/platform-admin";

const mw = readFileSync(fileURLToPath(new URL("../middleware/platform-admin.ts", import.meta.url)), "utf8");
const route = readFileSync(fileURLToPath(new URL("../routes/platform-support.ts", import.meta.url)), "utf8");
const workspaceSupport = readFileSync(fileURLToPath(new URL("../routes/support.ts", import.meta.url)), "utf8");
const appSrc = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
const sidebar = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/layout/sidebar.tsx", import.meta.url)), "utf8");
const supportUi = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/support.tsx", import.meta.url)), "utf8");

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS;
afterEach(() => { if (ORIGINAL === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL; });

describe("Platform admin gate — fail-closed env allowlist", () => {
  it("no env var → NOBODY is a platform admin (fail-closed like every other capability probe)", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(platformAdminEmails()).toEqual([]);
    expect(mw).toMatch(/if \(allow\.length === 0\) return false;\s*\/\/ fail-closed/);
  });
  it("allowlist parsing is comma-separated, trimmed, case-insensitive", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " Ops@Mondaily.com , second@mondaily.com ,, ";
    expect(platformAdminEmails()).toEqual(["ops@mondaily.com", "second@mondaily.com"]);
  });
  it("the middleware checks the REAL auth_credentials email of the session user (no header trust)", () => {
    expect(mw).toMatch(/verifyAccessToken\(at\)/);
    expect(mw).toMatch(/from\("auth_credentials"\)\.select\("email"\)\.eq\("user_id", userId\)/);
    expect(mw).toMatch(/throw new HTTPException\(403/);
  });
});

describe("Platform support routes — the ONLY place ticket status changes", () => {
  it("is mounted at /api/v1/platform/support and hard-gated after the /me probe", () => {
    expect(appSrc).toMatch(/app\.route\("\/api\/v1\/platform\/support", platformSupportRouter\)/);
    // /me is a soft probe (never 403); everything after the use("*") line is gated
    expect(route.indexOf('router.get("/me"')).toBeLessThan(route.indexOf('router.use("*", requirePlatformAdmin)'));
    expect(route.indexOf('router.use("*", requirePlatformAdmin)')).toBeLessThan(route.indexOf('router.get("/tickets"'));
  });
  it("reads ONLY support_ticket nodes (cross-workspace is the product; no other node types touched)", () => {
    // every nodes read/write in this router is object_type=support_ticket
    const reads = route.split('.from("nodes")').length - 1;
    const scoped = route.split('"support_ticket"').length - 1;
    expect(reads).toBeGreaterThan(0);
    expect(scoped).toBeGreaterThanOrEqual(reads);
  });
  it("status PATCH records platform-attributed history and notifies the requester in THEIR workspace", () => {
    const fn = route.slice(route.indexOf('router.patch("/tickets/:id"'));
    expect(fn).toMatch(/by: `platform:\$\{userId\}`/);
    expect(fn).toMatch(/workspace_id: t\.workspace_id, user_id: t\.created_by, type: "support"/);
    expect(fn).toMatch(/\.eq\("workspace_id", t\.workspace_id\)\.eq\("id", t\.id\)\.eq\("object_type", "support_ticket"\)/);
  });
  it("replies are written as author_role 'mondaily' and notify the requester", () => {
    const fn = route.slice(route.indexOf('router.post("/tickets/:id/comments"'));
    expect(fn).toMatch(/author_role: "mondaily"/);
    expect(fn).toMatch(/Mondaily support replied/);
  });
  it("the workspace-side status route STILL refuses everyone (403) — unchanged by this dashboard", () => {
    const fn = workspaceSupport.slice(workspaceSupport.indexOf('router.patch("/tickets/:id"'), workspaceSupport.indexOf('router.post("/tickets/:id/comments"'));
    expect(fn).toMatch(/Ticket status is managed by Mondaily support/);
    expect(fn).toMatch(/403/);
  });
});

describe("Platform support frontend — probe-gated, honest", () => {
  it("the sidebar link renders only when the capability probe returns true", () => {
    expect(sidebar).toMatch(/platform-admin-probe/);
    expect(sidebar).toMatch(/\{platformAdmin && <NavItem to="\/platform\/support"/);
    expect(sidebar).toMatch(/to="\/platform\/support"/);
  });
  it("the workspace support UI labels Mondaily replies as 'Mondaily Support'", () => {
    expect(supportUi).toMatch(/"mondaily" \? "Mondaily Support"/);
  });
});
