import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Mobile Workspace UX Pass — source guards. Assert the responsive affordances stay in place so a
 * future edit can't silently regress mobile usability on the four high-value pages. Source-level
 * (className) checks; no runtime/DOM.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../apps/app/src/routes/dashboard/${p}`, import.meta.url)), "utf8");
const pipeline = read("pipeline.tsx");
const calendar = read("calendar.tsx");
const tasks = read("tasks.tsx");
const messages = read("messages.tsx");

describe("Pipeline mobile", () => {
  it("kanban columns are near-full-width + snap on phones, 220px from sm+", () => {
    expect(pipeline).toMatch(/w-\[85vw\] max-w-\[240px\] snap-start sm:w-\[220px\] sm:max-w-none/);
    expect(pipeline).toMatch(/snap-x snap-mandatory scroll-px-4 sm:snap-none/);
  });
});

describe("Calendar mobile", () => {
  it("time rail is slim on mobile, wider from sm+", () => {
    expect(calendar).toMatch(/w-9 shrink-0 sm:w-12/);
  });
  it("multi-day columns get a mobile min-width so week view scrolls instead of crushing", () => {
    expect(calendar).toMatch(/single \? "min-w-0" : "min-w-\[6\.5rem\] sm:min-w-0"/);
  });
  it("meeting detail/brief remains reachable on mobile via the drawer", () => {
    expect(calendar).toMatch(/lg:hidden"><EventDrawer/);
  });
});

describe("Tasks mobile", () => {
  it("row actions are visible on touch, hover-reveal only from sm+", () => {
    expect(tasks).toMatch(/opacity-100 sm:opacity-0 sm:group-hover:opacity-100/);
  });
  it("secondary columns (Created/Labels) hide below md to reduce crush", () => {
    // The sheet now renders through the shared DataTable; Created + Labels use the shell's
    // responsive `hideBelow: "md"` (which emits `hidden md:table-cell`), replacing the old inline markup.
    expect(tasks).toMatch(/key: "created", header: "Created", hideBelow: "md"/);
    expect(tasks).toMatch(/key: "labels", header: "Labels", hideBelow: "md"/);
  });
});

describe("Inbox mobile", () => {
  it("conversation list single-panes when a thread is open", () => {
    expect(messages).toMatch(/\(active \|\| activeGroup\) \? "hidden lg:flex" : "flex"/);
  });
  it("thread + group panes have a mobile back button", () => {
    expect((messages.match(/onClick=\{onBack\} className="btn-icon h-7 w-7 lg:hidden"/g) ?? []).length).toBe(2);
  });
  it("message-bubble actions are tap-visible on mobile", () => {
    expect((messages.match(/opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100/g) ?? []).length).toBe(3);
  });
});
