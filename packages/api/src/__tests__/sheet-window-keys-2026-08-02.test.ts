import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeWindow } from "../../../../apps/app/src/components/records/row-window";
import {
  nextFocus, offsetOfIndex, scrollTopToReveal, selectionRange, shouldHandleKey, PAGE_ROWS,
} from "../../../../apps/app/src/components/records/sheet-keys";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const table = () => read("apps/app/src/components/records/record-table.tsx");

const uniform = (n: number, h = 29) => Array.from({ length: n }, () => h);

/**
 * Windowing is arithmetic over a list of heights. The tests are behavioural because the failure
 * mode is not a crash — it is a scrollbar that quietly lies about how much list there is.
 */
describe("computeWindow keeps the scrollbar honest", () => {
  it("renders only what the viewport intersects, plus the overscan", () => {
    const w = computeWindow(uniform(900), 0, 800, 0);
    expect(w.start).toBe(0);
    expect(w.end).toBeLessThan(40);        // ~28 rows of 29px, not 900
    expect(w.padTop).toBe(0);
  });

  it("the pads plus the rendered rows always equal the WHOLE list's height", () => {
    const heights = uniform(900);
    const total = heights.reduce((a, b) => a + b, 0);
    for (const scrollTop of [0, 137, 4000, 12_000, 25_000]) {
      const w = computeWindow(heights, scrollTop, 800, 8);
      const rendered = heights.slice(w.start, w.end).reduce((a, b) => a + b, 0);
      expect(w.padTop + rendered + w.padBottom).toBe(total);
    }
  });

  it("derives the pads from the OVERSCANNED bounds — otherwise there is a gap the size of the overscan", () => {
    const heights = uniform(900);
    const w = computeWindow(heights, 5000, 800, 8);
    expect(w.padTop).toBe(offsetOfIndex(heights, w.start));
  });

  it("handles mixed heights, so a group header does not shift everything below it", () => {
    const heights = [35, 29, 29, 35, 29, 29, 29];
    const total = heights.reduce((a, b) => a + b, 0);
    const w = computeWindow(heights, 40, 60, 0);
    const rendered = heights.slice(w.start, w.end).reduce((a, b) => a + b, 0);
    expect(w.padTop + rendered + w.padBottom).toBe(total);
  });

  it("survives a negative scrollTop (macOS rubber-banding) and one past the end (list shrank)", () => {
    expect(() => computeWindow(uniform(50), -400, 800, 4)).not.toThrow();
    const over = computeWindow(uniform(50), 999_999, 800, 4);
    expect(over.start).toBeLessThanOrEqual(50);
    expect(over.end).toBeLessThanOrEqual(50);
    expect(over.padBottom).toBeGreaterThanOrEqual(0);
  });

  it("an empty list renders nothing and pads nothing", () => {
    expect(computeWindow([], 0, 800, 8)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});

describe("the keyboard model moves the way a spreadsheet moves", () => {
  const dims = { rows: 100, cols: 6 };
  const at = (row: number, col: number) => ({ row, col });

  it("arrows move one cell and CLAMP at the edges instead of wrapping", () => {
    expect(nextFocus(at(0, 0), { key: "ArrowUp" }, dims)).toEqual(at(0, 0));
    expect(nextFocus(at(0, 0), { key: "ArrowLeft" }, dims)).toEqual(at(0, 0));
    expect(nextFocus(at(99, 5), { key: "ArrowDown" }, dims)).toEqual(at(99, 5));
    // Wrapping here would fling you a screen away from what you were reading.
    expect(nextFocus(at(3, 5), { key: "ArrowRight" }, dims)).toEqual(at(3, 5));
  });

  it("the modifier jumps to the far edge, not one step", () => {
    expect(nextFocus(at(4, 2), { key: "ArrowDown", meta: true }, dims)).toEqual(at(99, 2));
    expect(nextFocus(at(4, 2), { key: "ArrowRight", meta: true }, dims)).toEqual(at(4, 5));
  });

  it("Home/End are row-scoped alone and sheet-scoped with the modifier", () => {
    expect(nextFocus(at(7, 4), { key: "Home" }, dims)).toEqual(at(7, 0));
    expect(nextFocus(at(7, 4), { key: "End" }, dims)).toEqual(at(7, 5));
    expect(nextFocus(at(7, 4), { key: "Home", meta: true }, dims)).toEqual(at(0, 0));
    expect(nextFocus(at(7, 4), { key: "End", meta: true }, dims)).toEqual(at(99, 5));
  });

  it("Tab DOES wrap to the next row — it means 'next cell' — but stops at the last one", () => {
    expect(nextFocus(at(3, 5), { key: "Tab" }, dims)).toEqual(at(4, 0));
    expect(nextFocus(at(4, 0), { key: "Tab", shift: true }, dims)).toEqual(at(3, 5));
    expect(nextFocus(at(99, 5), { key: "Tab" }, dims)).toBeNull();   // never traps focus
    expect(nextFocus(at(0, 0), { key: "Tab", shift: true }, dims)).toBeNull();
  });

  it("PageUp/PageDown move less than a screen, so context carries across the jump", () => {
    expect(nextFocus(at(40, 1), { key: "PageDown" }, dims)).toEqual(at(40 + PAGE_ROWS, 1));
    expect(PAGE_ROWS).toBeLessThan(28);
  });

  it("returns null for keys it does not own, so typing still reaches the page", () => {
    for (const key of ["a", "Enter", "Escape", " ", "F2"]) {
      expect(nextFocus(at(1, 1), { key }, dims)).toBeNull();
    }
  });

  it("does nothing on an empty grid rather than inventing a cell", () => {
    expect(nextFocus(at(0, 0), { key: "ArrowDown" }, { rows: 0, cols: 0 })).toBeNull();
  });
});

describe("moving focus moves the container, because the row may not be rendered", () => {
  const heights = uniform(900);

  it("scrolls up when the target is above the viewport", () => {
    const top = scrollTopToReveal(heights, 100, 20_000, 800);
    expect(top).not.toBeNull();
    expect(top!).toBeLessThan(20_000);
  });

  it("scrolls down when the target is below it", () => {
    const top = scrollTopToReveal(heights, 500, 0, 800);
    expect(top!).toBeGreaterThan(0);
  });

  it("returns NULL when the row is already comfortably in view — assigning scrollTop every keystroke re-anchors the container", () => {
    expect(scrollTopToReveal(heights, 20, offsetOfIndex(heights, 10), 800)).toBeNull();
  });

  it("never scrolls to a negative offset", () => {
    expect(scrollTopToReveal(heights, 0, 500, 800)).toBe(0);
  });

  it("ignores an out-of-range index instead of scrolling somewhere arbitrary", () => {
    expect(scrollTopToReveal(heights, 5000, 0, 800)).toBeNull();
    expect(scrollTopToReveal(heights, -1, 0, 800)).toBeNull();
  });
});

describe("shift-select ranges anchor where the selection started", () => {
  it("covers the span in either direction", () => {
    expect(selectionRange(5, 9)).toEqual({ from: 5, to: 9 });
    expect(selectionRange(9, 5)).toEqual({ from: 5, to: 9 });
  });

  it("shrinks when you move back toward the anchor, rather than growing a second range", () => {
    expect(selectionRange(5, 6)).toEqual({ from: 5, to: 6 });
    expect(selectionRange(5, 5)).toEqual({ from: 5, to: 5 });
  });
});

describe("the sheet does not steal keys from whatever is being typed into", () => {
  // A stand-in for the DOM surface shouldHandleKey actually touches: whether the node is
  // contenteditable, and whether it sits inside a control that owns its own arrows. No jsdom
  // needed to state the rule.
  const node = (opts: { matches?: string[]; contentEditable?: boolean }) => ({
    isContentEditable: opts.contentEditable ?? false,
    closest: (sel: string) => (opts.matches ?? []).some(m => sel.includes(m)) ? {} : null,
  }) as unknown as EventTarget;

  it("leaves inputs, textareas and selects alone", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(shouldHandleKey(node({ matches: [tag] }))).toBe(false);
    }
  });

  it("leaves anything INSIDE a dialog alone, not just the dialog itself", () => {
    // closest() walking to an ancestor is the whole point — a span in a modal must not move the sheet.
    expect(shouldHandleKey(node({ matches: ["role='dialog'"] }))).toBe(false);
  });

  it("leaves a contenteditable alone", () => {
    expect(shouldHandleKey(node({ contentEditable: true }))).toBe(false);
  });

  it("handles keys on an ordinary cell", () => {
    expect(shouldHandleKey(node({}))).toBe(true);
  });

  it("handles keys when there is no target at all, rather than going dead", () => {
    expect(shouldHandleKey(null)).toBe(true);
  });
});

describe("the table wires the model without regressing what it already did", () => {
  it("only virtualizes past a threshold — a short sheet renders exactly as before", () => {
    const src = table();
    expect(src).toMatch(/const VIRTUALIZE_ABOVE = \d+;/);
    expect(src).toMatch(/if \(rowPlan\.length <= VIRTUALIZE_ABOVE\) return rowPlan\.map/);
  });

  it("pads with real <tr> spacers, so the table keeps ONE column layout with its header", () => {
    // Absolutely-positioned rows are how generic virtualizers break a <table>: the body stops
    // sharing column widths with the header, and the sticky first column detaches.
    const src = table();
    expect(src).toMatch(/<tr key=\{key\} aria-hidden="true" style=\{\{ height: h \}\}>/);
    expect(src).not.toMatch(/position: "absolute"[\s\S]{0,80}transform: `translateY/);
  });

  it("passes the plan index in instead of searching for it in the row loop", () => {
    // indexOf per row is a linear scan per row — the exact quadratic cost this work removes.
    expect(table()).not.toMatch(/renderRow\([\s\S]{0,60}rowPlan\.indexOf/);
  });

  it("keeps the group order rule when the plan moved into a memo", () => {
    const src = table();
    expect(src).toMatch(/const groupSlot = vocabSlotOf\(groupByCol\)/);
    expect(src).toMatch(/vocabSortKey\(groupSlot, a\[0\]\)/);
  });

  it("clears a stale focus when the rows or columns change under it", () => {
    expect(table()).toMatch(/f\.row < planIdxOfDataRow\.length && f\.col < orderedColumns\.length/);
  });

  it("opens a cell with the SAME gesture a mouse uses, not a parallel edit path", () => {
    expect(table()).toMatch(/dispatchEvent\(new MouseEvent\("dblclick", \{ bubbles: true \}\)\)/);
  });
});
