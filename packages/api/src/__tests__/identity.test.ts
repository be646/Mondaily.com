import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveDisplayName, firstNameOf } from "@mondaily/shared/identity";

describe("display-identity resolver — name → email local-part → 'there'", () => {
  it("prefers an explicit full name", () => {
    expect(resolveDisplayName({ name: "Bassem Epra", email: "b@x.com" })).toBe("Bassem Epra");
    expect(firstNameOf({ name: "Bassem Epra", email: "b@x.com" })).toBe("Bassem");
  });
  it("falls back to a humanized email local-part when there's no name", () => {
    expect(resolveDisplayName({ name: "", email: "bassem.epra@gmail.com" })).toBe("Bassem Epra");
    expect(firstNameOf({ name: null, email: "bassem.epra@gmail.com" })).toBe("Bassem");
    expect(resolveDisplayName({ email: "j_doe@x.com" })).toBe("J Doe");
  });
  it("falls back to 'there' only when there's neither name nor email", () => {
    expect(resolveDisplayName({})).toBe("there");
    expect(resolveDisplayName(null)).toBe("there");
    expect(firstNameOf(undefined)).toBe("there");
  });
  it("never returns an empty string", () => {
    for (const u of [{}, { name: "" }, { email: "" }, { name: "  " }, null, undefined]) {
      expect(resolveDisplayName(u as any).length).toBeGreaterThan(0);
      expect(firstNameOf(u as any).length).toBeGreaterThan(0);
    }
  });
});

describe("identity is used consistently (source-read)", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("Home greeting uses the identity hook, not `me.name?.split`", () => {
    const src = read("../../../../apps/app/src/routes/dashboard/home.tsx");
    expect(src).toMatch(/useDisplayIdentity\(\)/);
    expect(src).not.toMatch(/me\.name\?\.split\(" "\)\[0\]/);   // the old "Good morning, there" bug
  });
  it("sidebar identity uses the resolver", () => {
    expect(read("../../../../apps/app/src/components/layout/sidebar.tsx")).toMatch(/resolveDisplayName\(me\)/);
  });
  it("support context resolves the requester via the shared resolver", () => {
    expect(read("../routes/support.ts")).toMatch(/resolveDisplayName\(me\)/);
  });
});

describe("DB-authoritative fallback chain (session → member record → email → 'there')", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("/me/access returns the member's name + email (DB-authoritative)", () => {
    const src = read("../routes/app-data.ts");
    const fn = src.slice(src.indexOf('router.get("/me/access"'), src.indexOf('router.get("/me/access"') + 1300);
    expect(fn).toMatch(/from\("workspace_members"\)\.select\("name, email"\)\.eq\("workspace_id", workspaceId\)\.eq\("user_id", c\.get\("userId"\)\)/);
    expect(fn).toMatch(/name: \(member[\s\S]*?\?\.name \?\? null/);
    expect(fn).toMatch(/email: \(member[\s\S]*?\?\.email \?\? null/);
  });
  it("useDisplayIdentity combines the session with /me/access, in priority order", () => {
    const src = read("../../../../apps/app/src/hooks/useDisplayIdentity.ts");
    expect(src).toMatch(/apiClient\.get\("\/me\/access"\)/);
    expect(src).toMatch(/me\.name\?\.trim\(\) \|\| access\?\.name\?\.trim\(\)/);
    expect(src).toMatch(/me\.email\?\.trim\(\) \|\| access\?\.email\?\.trim\(\)/);
    expect(src).toMatch(/firstNameOf\(input\)/);
  });
  it("Home uses the combined identity hook (not the session-only resolver)", () => {
    const src = read("../../../../apps/app/src/routes/dashboard/home.tsx");
    expect(src).toMatch(/useDisplayIdentity\(\)/);
    expect(src).not.toMatch(/\{firstName \|\| "there"\}/);   // redundant fallback removed
  });
  it("Help /ask forwards the current route as context (never acted on)", () => {
    expect(read("../routes/support.ts")).toMatch(/route: z\.string\(\)\.max\(200\)\.optional\(\)/);
    expect(read("../../../../apps/app/src/components/help/help-panel.tsx")).toMatch(/route: window\.location\.pathname/);
  });
});
