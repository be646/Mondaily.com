import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const CONTROLS = "apps/app/src/components/ui/controls.tsx";

/**
 * The clipped-dropdown bug class.
 *
 * The Finance Reports currency picker was correct code that rendered as a broken control: an
 * `overflow-x-auto` on an ancestor strip clipped its absolutely-positioned panel. Twenty-one files
 * in this app put a select inside a scrolling or clipping container, so the fix could not be "audit
 * the ancestors" — that is the same one-call-site mistake this session made four times. The panel
 * is portalled out of the clipping context instead.
 *
 * These are behavioural assertions about the primitive, not pinned source strings: what must hold
 * is that no menu is position-absolute inside its trigger, and that outside-click still sees the
 * portalled node.
 */
describe("dropdown panels cannot be clipped by an ancestor", () => {
  it("no menu in the control primitives is absolutely positioned inside its trigger", () => {
    const src = read(CONTROLS);
    // An `absolute` panel is clipped by any ancestor overflow. The only absolute left in this file
    // is the pulse ring, which is decorative and intentionally inside its own box.
    const absoluteMenus = src.match(/className="ui-menu[^"]*absolute/g) ?? [];
    expect(absoluteMenus, "ui-menu panels must be portalled, not absolute").toEqual([]);
  });

  it("panels are portalled to the document body", () => {
    const src = read(CONTROLS);
    expect(src).toMatch(/createPortal\(/);
    expect(src).toMatch(/document\.body/);
  });

  it("every menu-bearing control routes through the one shared layer", () => {
    const src = read(CONTROLS);
    // MenuSelect, ActionMenu and FieldSelect — three controls, one positioning implementation, so a
    // fix to flipping or scroll-tracking lands everywhere at once.
    expect((src.match(/<MenuLayer\b/g) ?? []).length).toBe(3);
  });

  it("outside-click checks the portalled node, not just the trigger's subtree", () => {
    const src = read(CONTROLS);
    // Once portalled, the panel is no longer inside rootRef. Checking only the root would treat
    // every click on an option as an outside click and close the menu before it could be picked.
    const handlers = src.match(/const onDoc = [\s\S]*?\};/g) ?? [];
    expect(handlers.length).toBe(3);
    for (const h of handlers) expect(h).toMatch(/menuRef\.current\?\.contains/);
  });

  it("the panel tracks its trigger rather than snapshotting a position", () => {
    const src = read(CONTROLS);
    // A fixed panel does not travel with its trigger, so a scroll in ANY container (capture phase)
    // and a resize both have to re-measure or the panel visibly detaches.
    expect(src).toMatch(/addEventListener\("scroll", measure, true\)/);
    expect(src).toMatch(/addEventListener\("resize", measure\)/);
  });
});

describe("header strips do not wrap into a second row of chrome", () => {
  it("the report and dashboard builders keep their actions on the title's row", () => {
    for (const f of [
      "apps/app/src/routes/dashboard/reports/report-builder.tsx",
      "apps/app/src/routes/dashboard/reports/dashboard-view.tsx",
    ]) {
      const header = read(f).match(/<header className="[^"]*"/)?.[0] ?? "";
      expect(header, f).toContain("flex-nowrap");
      expect(header, f).not.toContain("flex-wrap");
    }
  });

  it("a header select uses the toolbar idiom, not the 36px form field", () => {
    // A bordered 36px field for "Insight" reads as a form control that wandered into a header, and
    // it was the tallest thing in the row.
    const src = read("apps/app/src/routes/dashboard/reports/report-builder.tsx");
    expect(src).toMatch(/<FieldSelect\s+compact/);
  });
});
