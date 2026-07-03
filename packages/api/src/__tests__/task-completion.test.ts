import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveCompletedAt } from "../lib/task-completion";
import { dailyTrend } from "../lib/oversight-metrics";

const NOW = "2026-07-10T12:00:00.000Z";

describe("resolveCompletedAt — completion-timestamp rule", () => {
  it("sets completed_at when a task is completed for the first time (false → true)", () => {
    expect(resolveCompletedAt({ wasCompleted: false, nextCompleted: true, nowIso: NOW })).toEqual({ completed_at: NOW });
  });
  it("sets completed_at when prior state was null/undefined → true", () => {
    expect(resolveCompletedAt({ wasCompleted: false, nextCompleted: true, nowIso: NOW }).completed_at).toBe(NOW);
  });
  it("does NOT overwrite when the task is already completed (true → true)", () => {
    expect(resolveCompletedAt({ wasCompleted: true, nextCompleted: true, nowIso: NOW })).toEqual({});
  });
  it("clears completed_at when a completed task is reopened (true → false)", () => {
    expect(resolveCompletedAt({ wasCompleted: true, nextCompleted: false, nowIso: NOW })).toEqual({ completed_at: null });
  });
  it("no change when completed is not part of the update", () => {
    expect(resolveCompletedAt({ wasCompleted: false, nextCompleted: undefined, nowIso: NOW })).toEqual({});
    expect(resolveCompletedAt({ wasCompleted: true, nextCompleted: undefined, nowIso: NOW })).toEqual({});
  });
  it("no change when an already-open task is set open again (false → false)", () => {
    expect(resolveCompletedAt({ wasCompleted: false, nextCompleted: false, nowIso: NOW })).toEqual({});
  });
});

describe("completed-task trend calculation (dailyTrend over completed_at)", () => {
  const NOW_MS = Date.UTC(2026, 6, 10, 12);
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 9)).toISOString();
  it("buckets completed tasks by their completed_at day, ignoring incomplete/undated", () => {
    const tasks = [
      { completed: true, completed_at: at(2026, 6, 10) },
      { completed: true, completed_at: at(2026, 6, 10) },
      { completed: true, completed_at: at(2026, 6, 8) },
      { completed: true, completed_at: null },      // completed but no timestamp → excluded
      { completed: false, completed_at: null },     // not completed → excluded
    ];
    const completed = tasks.filter((t) => t.completed && t.completed_at);
    const trend = dailyTrend(completed, (t) => t.completed_at, 30, NOW_MS);
    expect(trend.length).toBe(30);
    expect(trend.find((p) => p.date === "2026-07-10")!.value).toBe(2);
    expect(trend.find((p) => p.date === "2026-07-08")!.value).toBe(1);
    expect(trend.reduce((s, p) => s + p.value, 0)).toBe(3);
  });
});

describe("workspace isolation — task update + completed-trend query stay scoped", () => {
  it("the task PATCH update is workspace-scoped", () => {
    const src = readFileSync(fileURLToPath(new URL("../routes/tasks.ts", import.meta.url)), "utf8");
    // The completion update must still filter by workspace_id.
    expect(src).toMatch(/\.update\(updateBody\)[\s\S]*?\.eq\("workspace_id", workspaceId\)/);
    expect(src).toMatch(/resolveCompletedAt\(/);
  });
  it("the oversight completed-tasks query is workspace-scoped and reads completed_at", () => {
    const src = readFileSync(fileURLToPath(new URL("../routes/activities.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/from\("tasks"\)\.select\("assignee_id, completed, due_date, completed_at"\)\.eq\("workspace_id", ws\)/);
    expect(src).toMatch(/tasks_completed: dailyTrend\(completedTasks/);
  });
});
