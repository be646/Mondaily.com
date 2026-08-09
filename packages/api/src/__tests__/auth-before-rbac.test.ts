import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTES = join(__dirname, "../routes");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * An RBAC gate without requireAuth in front of it is not a gate.
 *
 * requireAuth is what SETS `role`, `workspaceId` and `userId` on the context. A route that reaches
 * for requireAdminRole without it reads an undefined role and refuses EVERYONE — including genuine
 * owners — and, far worse, its handler then reads an undefined workspaceId and can write rows with
 * no tenant at all.
 *
 * Found exactly this way on 2026-08-05: the Salesforce import routes were admin-gated in a router
 * that applies requireAuth per-route rather than globally, so they 403'd a real workspace owner.
 * No unit test would have caught it — the middleware CHAIN is the thing under test, and it only
 * shows up when the route is called with a real session.
 */
const RBAC = /require(AdminRole|Role|FinanceRole|ModuleAccess|PlatformAdmin)/;

describe("RBAC gates sit behind authentication", () => {
  it("no route applies an RBAC gate without requireAuth available to it", () => {
    const offenders: string[] = [];

    for (const f of walk(ROUTES)) {
      const src = readFileSync(f, "utf8");
      // Routers that authenticate globally are fine — the gate always runs after it.
      if (/router\.use\(\s*"\*"\s*,\s*require(Auth|PlatformAdmin)/.test(src)) continue;

      // Walk each route declaration and take the middleware chain up to the handler.
      // Deliberately NOT one regex: the chain routinely contains zValidator("json", z.object({…})),
      // so any pattern that excludes parentheses silently matches nothing — which is exactly how
      // the first version of this test passed while the bug it exists to catch was present.
      for (const m of src.matchAll(/router\.(?:get|post|patch|put|delete)\(\s*"([^"]+)"\s*,/g)) {
        const start = m.index! + m[0].length;
        const rest = src.slice(start, start + 1200);
        // The handler begins at the first `async (c` / `(c)` at the top level of the call.
        const handlerAt = rest.search(/async\s*\(c\b|\(c\)\s*=>/);
        const chain = handlerAt >= 0 ? rest.slice(0, handlerAt) : rest;
        if (!RBAC.test(chain)) continue;
        if (/requireAuth|requirePlatformAdmin/.test(chain)) continue;
        offenders.push(`${f.slice(ROUTES.length + 1)} "${m[1]}"`);
      }
    }

    expect(offenders,
      `These routes gate on a role that requireAuth never set — they refuse everyone, and their ` +
      `handlers read an undefined workspaceId:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
