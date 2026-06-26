import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireRole, requireAdminRole, denyViewerWrites, isWorkspaceAdmin } from "../middleware/rbac";
import type { MiddlewareHandler } from "hono";

// Builds a tiny app that injects a workspace `role` then runs the middleware
// under test on /x, so we exercise the REAL Hono request pipeline (integration
// of the middleware), not just the function in isolation.
function appWithRole(role: string, mw: MiddlewareHandler, method: "GET" | "POST" = "GET") {
  const app = new Hono<{ Variables: { role: string } }>();
  app.use("*", async (c, next) => { c.set("role", role); await next(); });
  app.on(method, "/x", mw, (c) => c.text("ok"));
  return app;
}
const hit = (app: Hono, method: "GET" | "POST" = "GET") => app.request("/x", { method });

describe("requireAdminRole", () => {
  it("allows owner and admin", async () => {
    for (const r of ["owner", "admin"]) {
      expect((await hit(appWithRole(r, requireAdminRole))).status).toBe(200);
    }
  });
  it("403s member and viewer", async () => {
    for (const r of ["member", "viewer"]) {
      expect((await hit(appWithRole(r, requireAdminRole))).status).toBe(403);
    }
  });
});

describe("denyViewerWrites", () => {
  it("blocks a viewer write (POST)", async () => {
    expect((await hit(appWithRole("viewer", denyViewerWrites, "POST"), "POST")).status).toBe(403);
  });
  it("allows a viewer read (GET)", async () => {
    expect((await hit(appWithRole("viewer", denyViewerWrites, "GET"))).status).toBe(200);
  });
  it("allows a member write (POST)", async () => {
    expect((await hit(appWithRole("member", denyViewerWrites, "POST"), "POST")).status).toBe(200);
  });
});

describe("requireRole", () => {
  it("enforces the exact allowed set", async () => {
    expect((await hit(appWithRole("member", requireRole("owner")))).status).toBe(403);
    expect((await hit(appWithRole("owner", requireRole("owner", "member")))).status).toBe(200);
  });
});

describe("isWorkspaceAdmin", () => {
  it("is true only for owner/admin", () => {
    expect(isWorkspaceAdmin("owner")).toBe(true);
    expect(isWorkspaceAdmin("admin")).toBe(true);
    expect(isWorkspaceAdmin("member")).toBe(false);
    expect(isWorkspaceAdmin("viewer")).toBe(false);
    expect(isWorkspaceAdmin(undefined)).toBe(false);
  });
});
