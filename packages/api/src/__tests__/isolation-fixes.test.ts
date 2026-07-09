import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Regression guards for the four REAL cross-workspace holes found in the 2026-07-09 manual review
 * of every workspace-isolation-scan flag (see scripts/audit/workspace-isolation-scan.mjs header).
 * These are source assertions in the house style — if someone removes a guard, the matching test
 * names exactly which leak reopens.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const prospecting = read("../routes/prospecting.ts");
const status = read("../routes/status.ts");
const taskDetails = read("../routes/task-details.ts");
const taskReviews = read("../routes/task-reviews.ts");

describe("prospecting — destination_list_id cannot target another workspace's list", () => {
  it("verifies the list belongs to the workspace before any list_entries write", () => {
    expect(prospecting).toMatch(/async function verifyListInWorkspace\(workspaceId: string, listId: string \| undefined\)/);
    expect(prospecting).toMatch(/from\("lists"\)\.select\("id"\)\.eq\("id", listId\)\.eq\("workspace_id", workspaceId\)/);
  });
  it("runProspecting resolves the caller-supplied id through the guard before the loop", () => {
    const runBody = prospecting.slice(prospecting.indexOf("export async function runProspecting"));
    const guardAt = runBody.indexOf("verifyListInWorkspace(workspaceId, input.destination_list_id)");
    const firstAdd = runBody.indexOf("addNodeToList(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstAdd).toBeGreaterThan(guardAt); // guard runs before any list write
  });
});

describe("status — global project_log writes are platform-admin only", () => {
  it("POST /log and PATCH /log/:id both check isPlatformAdmin (fail-closed allowlist)", () => {
    const post = status.slice(status.indexOf('router.post("/log"'));
    const patch = status.slice(status.indexOf('router.patch("/log/:id"'));
    expect(post).toMatch(/isPlatformAdmin\(c\.get\("userId"\)\)/);
    expect(patch).toMatch(/isPlatformAdmin\(c\.get\("userId"\)\)/);
  });
  it("reads stay open to any authenticated user (public status page content)", () => {
    const get = status.slice(status.indexOf('router.get("/log"'), status.indexOf('router.post("/log"'));
    expect(get).not.toMatch(/isPlatformAdmin/);
  });
});

describe("task comment reactions — commentId is bound to the ownership-verified task", () => {
  it("assertCommentOnTask exists and checks the comment↔task pair", () => {
    expect(taskDetails).toMatch(/async function assertCommentOnTask\(commentId: string, taskId: string\)/);
    expect(taskDetails).toMatch(/from\("task_comments"\)\.select\("id"\)\.eq\("id", commentId\)\.eq\("task_id", taskId\)/);
  });
  it("both reaction routes call the guard after task ownership", () => {
    const get = taskDetails.slice(taskDetails.indexOf('router.get("/:id/comments/:commentId/reactions"'));
    const post = taskDetails.slice(taskDetails.indexOf('router.post("/:id/comments/:commentId/reactions"'));
    expect(get).toMatch(/assertCommentOnTask\(/);
    expect(post).toMatch(/assertCommentOnTask\(/);
  });
  it("comment delete is scoped to the verified task, not just the author", () => {
    const del = taskDetails.slice(taskDetails.indexOf('router.delete("/:id/comments/:commentId"'), taskDetails.indexOf("// ── Comment Reactions"));
    expect(del).toMatch(/\.eq\("task_id", taskId\)/);
  });
});

describe("task reviews — a review row can only be completed through its own task", () => {
  it("the PATCH update filters by BOTH review id and the ownership-verified task id, and 404s on mismatch", () => {
    const patch = taskReviews.slice(taskReviews.indexOf('router.patch("/:id/reviews/:reviewId"'));
    const updateBlock = patch.slice(0, patch.indexOf("// Post auto-comment"));
    expect(updateBlock).toMatch(/\.eq\("id", c\.req\.param\("reviewId"\)\)/);
    expect(updateBlock).toMatch(/\.eq\("task_id", c\.req\.param\("id"\)\)/);
    expect(updateBlock).toMatch(/Review not found on this task/);
  });
});
