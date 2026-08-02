import { computeWindow } from "./row-window";

/**
 * The sheet's keyboard model.
 *
 * A spreadsheet that can only be driven with a mouse is a table. What makes a sheet a sheet is that
 * your hands stay on the keys: move with the arrows, open the cell with Enter, leave it with
 * Escape, and select a run with Shift. Every rule here is separated from React on purpose — the
 * movement is arithmetic, and arithmetic can be tested without rendering 900 rows.
 *
 * Clamping (never wrapping) at the edges is deliberate: wrapping from the last column of one row to
 * the first of the next is a spreadsheet convention for Tab, which commits a value and moves on,
 * but not for the arrows, where it would fling you a screen away from what you were reading.
 */

export interface CellFocus { row: number; col: number }

export interface GridDims { rows: number; cols: number }

export interface KeyIntent {
  key: string;
  /** Cmd on macOS, Ctrl elsewhere — jump to the far edge. */
  meta?: boolean;
  shift?: boolean;
}

/** How many rows a PageUp/PageDown moves. Deliberately less than a full screen so context carries. */
export const PAGE_ROWS = 12;

/**
 * Where the focus goes, or null when this key is not a movement (so the caller can let it through
 * to the browser instead of swallowing it).
 */
export function nextFocus(cur: CellFocus, intent: KeyIntent, dims: GridDims): CellFocus | null {
  if (dims.rows <= 0 || dims.cols <= 0) return null;
  const clampRow = (r: number) => Math.max(0, Math.min(dims.rows - 1, r));
  const clampCol = (c: number) => Math.max(0, Math.min(dims.cols - 1, c));
  const at = (row: number, col: number): CellFocus => ({ row: clampRow(row), col: clampCol(col) });

  switch (intent.key) {
    case "ArrowDown":  return intent.meta ? at(dims.rows - 1, cur.col) : at(cur.row + 1, cur.col);
    case "ArrowUp":    return intent.meta ? at(0, cur.col) : at(cur.row - 1, cur.col);
    case "ArrowRight": return intent.meta ? at(cur.row, dims.cols - 1) : at(cur.row, cur.col + 1);
    case "ArrowLeft":  return intent.meta ? at(cur.row, 0) : at(cur.row, cur.col - 1);
    case "PageDown":   return at(cur.row + PAGE_ROWS, cur.col);
    case "PageUp":     return at(cur.row - PAGE_ROWS, cur.col);
    // Home/End are ROW-scoped on their own and SHEET-scoped with the modifier, which is how every
    // spreadsheet behaves and what muscle memory expects.
    case "Home":       return intent.meta ? at(0, 0) : at(cur.row, 0);
    case "End":        return intent.meta ? at(dims.rows - 1, dims.cols - 1) : at(cur.row, dims.cols - 1);
    case "Tab":        {
      // Tab DOES wrap — it means "next cell", and at the end of a row the next cell is on the next
      // row. At the very last cell it stays put rather than trapping focus in a wrap to the top.
      const forward = !intent.shift;
      const flat = cur.row * dims.cols + cur.col + (forward ? 1 : -1);
      if (flat < 0 || flat >= dims.rows * dims.cols) return null;
      return { row: Math.floor(flat / dims.cols), col: flat % dims.cols };
    }
    default: return null;
  }
}

/** Pixel offset of a plan index from the top of the scroll container. */
export function offsetOfIndex(heights: number[], index: number): number {
  let acc = 0;
  const stop = Math.max(0, Math.min(heights.length, index));
  for (let i = 0; i < stop; i++) acc += heights[i]!;
  return acc;
}

/**
 * The scrollTop that brings `index` into view, or null when it already is.
 *
 * Returning null rather than the current value matters: with windowing, assigning scrollTop on
 * every keystroke re-anchors the container and fights any smooth scrolling in progress.
 */
export function scrollTopToReveal(
  heights: number[],
  index: number,
  scrollTop: number,
  viewport: number,
  margin = 2,
): number | null {
  if (index < 0 || index >= heights.length) return null;
  const top = offsetOfIndex(heights, index);
  const bottom = top + (heights[index] ?? 0);
  const marginPx = margin * (heights[index] ?? 0);
  if (top - marginPx < scrollTop) return Math.max(0, top - marginPx);
  if (bottom + marginPx > scrollTop + viewport) return bottom + marginPx - viewport;
  return null;
}

/**
 * The inclusive index range Shift-select covers, from the anchor to the current row.
 *
 * The anchor is where the selection STARTED, not the previous row — so shrinking a range by
 * shift-arrowing back toward the anchor deselects, rather than growing a second range behind you.
 */
export function selectionRange(anchor: number, cur: number): { from: number; to: number } {
  return anchor <= cur ? { from: anchor, to: cur } : { from: cur, to: anchor };
}

/**
 * Whether a keystroke should reach the sheet at all.
 *
 * While a cell editor, the toolbar search, or any dialog has focus, the arrows belong to THAT
 * control — stealing them is how a keyboard model becomes unusable in exactly the moments a
 * keyboard matters most.
 */
export function shouldHandleKey(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return true;
  if (el.isContentEditable) return false;
  return !el.closest("input, textarea, select, [role='dialog'], [contenteditable='true']");
}

/** Re-exported so callers need only one import to drive the windowed grid. */
export { computeWindow };
