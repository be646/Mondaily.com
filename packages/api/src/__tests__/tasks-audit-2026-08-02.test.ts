import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isOverdue, overdueCutoffISO, localStartOfTodayISO } from "@mondaily/shared/dates";

/**
 * Tasks/Decisions audit. The finding: "overdue" had two definitions — the chip counted against the
 * viewer's midnight, the SQL filter against UTC midnight. Identical only at UTC+0.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("one definition of overdue", () => {
  it("local and UTC midnight are genuinely different instants away from UTC+0", () => {
    // Not a style point: in Warsaw they are two hours apart, which is a real window of tasks.
    const now = new Date();
    const local = Date.parse(localStartOfTodayISO(now));
    const utc = Date.parse(overdueCutoffISO(now));
    expect(Math.abs(local - utc)).toBe(Math.abs(now.getTimezoneOffset()) * 60_000);
  });

  it("the client's cutoff matches what isOverdue uses to count", () => {
    // A task due exactly at the cutoff is NOT overdue; a millisecond earlier is.
    const now = new Date();
    const cutoff = localStartOfTodayISO(now);
    expect(isOverdue(cutoff, now)).toBe(false);
    expect(isOverdue(new Date(Date.parse(cutoff) - 1).toISOString(), now)).toBe(true);
  });

  it("the client sends its own midnight with the overdue filter", () => {
    const ui = read("apps/app/src/routes/dashboard/tasks.tsx");
    expect(ui).toMatch(/filter === "overdue" \? `&before=\$\{encodeURIComponent\(localStartOfTodayISO\(\)\)\}`/);
  });

  it("the server honours it, and still works when it is absent", () => {
    const src = read("packages/api/src/routes/tasks.ts");
    expect(src).toMatch(/const asked = c\.req\.query\("before"\)/);
    expect(src).toMatch(/const cutoff = withinADay \? new Date\(parsed\)\.toISOString\(\) : utcCutoff/);
  });

  it("a caller cannot widen the filter arbitrarily", () => {
    // Otherwise ?before=2099 returns every task as 'overdue'.
    expect(read("packages/api/src/routes/tasks.ts")).toMatch(/Math\.abs\(parsed - Date\.parse\(utcCutoff\)\) <= 36 \* 3600_000/);
  });

  it("junk is ignored rather than throwing or matching everything", () => {
    const src = read("packages/api/src/routes/tasks.ts");
    expect(src).toMatch(/\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\/\.test\(asked\)/);
  });
});

describe("completed and status cannot drift apart", () => {
  it("the server mirrors each onto the other", () => {
    const src = read("packages/api/src/routes/tasks.ts");
    expect(src).toMatch(/if \(updateBody\.status === "done"\) updateBody\.completed = true/);
    expect(src).toMatch(/if \(updateBody\.completed === true && updateBody\.status === undefined\) updateBody\.status = "done"/);
    expect(src).toMatch(/if \(updateBody\.completed === false && updateBody\.status === undefined\) updateBody\.status = "todo"/);
  });
});

describe("task reviews are ownership-checked before any write", () => {
  it("every handler asserts the task belongs to the workspace", () => {
    const src = read("packages/api/src/routes/task-reviews.ts");
    const handlers = src.split(/router\.(get|post|patch|delete)\(/).slice(1);
    const bodies = handlers.filter((_, i) => i % 2 === 1);
    for (const b of bodies) {
      expect(b.slice(0, 400)).toMatch(/assertTaskOwnership/);
    }
  });

  it("the review update is scoped to that task, not just the review id", () => {
    expect(read("packages/api/src/routes/task-reviews.ts"))
      .toMatch(/\.eq\("id", c\.req\.param\("reviewId"\)\)\s*\n?\s*\.eq\("task_id", c\.req\.param\("id"\)\)/);
  });
});
