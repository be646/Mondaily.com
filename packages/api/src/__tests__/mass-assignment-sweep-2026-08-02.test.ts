import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sweep after the members.ts finding: a TypeScript annotation on a request body is not runtime
 * validation. Every write that took a parsed request object directly was re-checked.
 *
 * Two distinct failures show up, and a route can have either:
 *   • mass assignment — unlisted columns (workspace_id, task_id, user_id) reachable from the body
 *   • a child row identified by its own id alone, so proving you own the PARENT proves nothing
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const taskDetails = () => read("packages/api/src/routes/task-details.ts");
const tasks = () => read("packages/api/src/routes/tasks.ts");

describe("child rows are scoped to the verified parent, not just their own id", () => {
  it("checklist update and delete both require the item to belong to the task", () => {
    const s = taskDetails();
    // assertTaskOwnership proves the caller owns `taskId`; itemId is a separate supplied value.
    const patch = s.slice(s.indexOf('router.patch("/:id/checklist/:itemId"'), s.indexOf('router.delete("/:id/checklist/:itemId"'));
    expect(patch).toMatch(/\.eq\("id", c\.req\.param\("itemId"\)\)\s*\n?\s*\.eq\("task_id", taskId\)/);
    const del = s.slice(s.indexOf('router.delete("/:id/checklist/:itemId"'));
    expect(del.slice(0, 400)).toMatch(/\.eq\("task_id", taskId\)/);
  });

  it("attachment delete is scoped to the task as well as the uploader", () => {
    const del = taskDetails().slice(taskDetails().indexOf('router.delete("/:id/attachments/:attachmentId"'));
    expect(del.slice(0, 400)).toMatch(/\.eq\("task_id", taskId\)/);
  });

  it("a checklist item on another task reports not found", () => {
    expect(taskDetails()).toMatch(/Checklist item not found on this task/);
  });
});

describe("no write takes an unfiltered request body", () => {
  it("the assignee upsert lists its fields and puts the scope keys LAST", () => {
    // `{ task_id, workspace_id, ...body }` let the body override both — and the conflict target is
    // (task_id, user_id), so a crafted task_id wrote onto a task the caller never proved they own.
    const s = taskDetails();
    expect(s).not.toMatch(/\{ task_id: taskId, workspace_id: workspaceId, \.\.\.body \}/);
    expect(s).toMatch(/permission: body\.permission \?\? "edit",\s*\n\s*task_id: taskId,\s*\n\s*workspace_id: workspaceId,/);
  });

  it("task updates are whitelisted — workspace_id is not writable from the body", () => {
    const s = tasks();
    expect(s).not.toMatch(/const \{ _user_name, \.\.\.updateBody \} = body;/);
    expect(s).toMatch(/const EDITABLE = \[/);
    expect(s).toMatch(/for \(const k of EDITABLE\) if \(k in body\) updateBody\[k\] = body\[k\];/);
    const editable = s.slice(s.indexOf("const EDITABLE = ["), s.indexOf("] as const;"));
    for (const forbidden of ["workspace_id", "created_by", '"id"']) {
      expect(editable, forbidden).not.toContain(forbidden);
    }
  });

  it("an empty patch is rejected rather than issuing a no-op write", () => {
    expect(tasks()).toMatch(/Nothing to update/);
    expect(taskDetails()).toMatch(/Nothing to update/);
  });
});
