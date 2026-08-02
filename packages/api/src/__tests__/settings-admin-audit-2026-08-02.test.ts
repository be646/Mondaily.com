import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Settings/Admin audit — the privilege pass. The danger here is not reading the wrong data but
 * acquiring the wrong permission, which then unlocks everything else.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const members = () => read("packages/api/src/routes/members.ts");

describe("a member update cannot write arbitrary columns", () => {
  it("fields are whitelisted, not passed through from the request body", () => {
    // `.update(body)` wrote whatever the request contained — the TS annotation is compile-time
    // only. workspace_id was reachable, which would move a member's row to another workspace.
    const s = members();
    expect(s).not.toMatch(/\.update\(body\)/);
    expect(s).toMatch(/const patch: Record<string, unknown> = \{\};/);
    expect(s).toMatch(/\.update\(patch\)/);
  });

  it("only the three intended fields are copied", () => {
    const s = members();
    const block = s.slice(s.indexOf("const patch:"), s.indexOf(".update(patch)"));
    expect(block).toMatch(/patch\.position =/);
    expect(block).toMatch(/patch\.name =/);
    expect(block).toMatch(/patch\.role = body\.role;/);
    expect(block).not.toMatch(/patch\.workspace_id|patch\.user_id/);
  });
});

describe("privilege cannot be self-granted", () => {
  it("the role value is checked against the roles RBAC actually understands", () => {
    const s = members();
    expect(s).toMatch(/if \(!ROLES\.includes\(body\.role as WorkspaceRole\)\)/);
    expect(s).toMatch(/const ROLES: WorkspaceRole\[\] = \["owner", "admin", "member", "viewer"\]/);
  });

  it("only an owner can grant or revoke ownership — an admin cannot promote themselves", () => {
    const s = members();
    expect(s).toMatch(/if \(\(grantingOwner \|\| revokingOwner\) && requesterRole !== "owner"\)/);
  });

  it("the last owner cannot be demoted — a workspace with none is unadministerable", () => {
    expect(members()).toMatch(/A workspace must keep at least one owner/);
  });

  it("the endpoint still requires owner/admin at all", () => {
    expect(members()).toMatch(/if \(!\["owner", "admin"\]\.includes\(requesterRole\)\)/);
  });

  it("the write stays scoped to the workspace and the named member", () => {
    const s = members();
    const tail = s.slice(s.indexOf(".update(patch)"));
    expect(tail.slice(0, 300)).toMatch(/\.eq\("workspace_id", c\.get\("workspaceId"\)\)/);
    expect(tail.slice(0, 300)).toMatch(/\.eq\("user_id", c\.req\.param\("userId"\)\)/);
  });
});
