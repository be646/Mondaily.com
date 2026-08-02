import { useCallback, useEffect, useState } from "react";

/**
 * Row windowing for the sheet.
 *
 * The table rendered every row it had loaded. At 900 records that is ~900 <tr> and, because each
 * row renders one <td> per visible column, tens of thousands of DOM nodes — every one of which the
 * browser re-lays-out on a column resize, a sort, or a theme change. The cost is not the data; it
 * is the DOM.
 *
 * This is deliberately NOT a general virtualizer. It is a pure offset calculation plus a scroll
 * subscription, so it composes with the things the sheet already does that generic libraries break:
 * sticky columns, a sticky <tfoot>, colSpan'd group headers, and a real <table> layout (the column
 * widths must stay shared between header and body, which absolutely-positioned rows destroy).
 *
 * Heights are per-row rather than a single constant because group headers and data rows are
 * different heights, and a wrong constant does not degrade gracefully — it drifts, and the drift
 * compounds down the list until the scrollbar lies.
 */

export interface RowWindow {
  /** First index to render (inclusive). */
  start: number;
  /** Last index to render (exclusive). */
  end: number;
  /** Pixel height of the spacer standing in for everything before `start`. */
  padTop: number;
  /** Pixel height of the spacer standing in for everything after `end`. */
  padBottom: number;
}

/**
 * Which slice of `heights` intersects the viewport, plus the spacer heights that keep the
 * scrollbar honest.
 *
 * Pure and total: any scrollTop, including negative (rubber-band scrolling on macOS) or past the
 * end (a list that shrank under the scroll position), returns a valid in-range window.
 */
export function computeWindow(
  heights: number[],
  scrollTop: number,
  viewport: number,
  overscan: number,
): RowWindow {
  const n = heights.length;
  if (n === 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };

  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(0, viewport);

  let start = 0;
  let acc = 0;
  while (start < n && acc + heights[start]! <= top) { acc += heights[start]!; start += 1; }

  let end = start;
  let visible = acc;
  while (end < n && visible < bottom) { visible += heights[end]!; end += 1; }

  // Overscan by ROWS, then recompute the pads from the same array — deriving the pad from the
  // unexpanded offset would leave a gap exactly the size of the overscan.
  const startOv = Math.max(0, start - overscan);
  const endOv = Math.min(n, end + overscan);

  let padTop = 0;
  for (let i = 0; i < startOv; i++) padTop += heights[i]!;
  let padBottom = 0;
  for (let i = endOv; i < n; i++) padBottom += heights[i]!;

  return { start: startOv, end: endOv, padTop, padBottom };
}

/**
 * Track a scroll container and report the visible window.
 *
 * `enabled` exists so a short sheet renders exactly as it always did: below the threshold there is
 * nothing to win, and windowing a 30-row table only adds a way for it to be wrong.
 */
export function useRowWindow(opts: {
  heights: number[];
  enabled: boolean;
  overscan?: number;
  /** Scroll container. Falls back to the nearest `.record-scroll` ancestor's element. */
  containerRef: React.RefObject<HTMLElement | null>;
}): RowWindow {
  const { heights, enabled, containerRef } = opts;
  const overscan = opts.overscan ?? 8;
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewport: 0 });

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setMetrics(prev => {
      const next = { scrollTop: el.scrollTop, viewport: el.clientHeight };
      // Re-rendering the whole sheet on a scroll that moved nothing is its own performance bug;
      // only publish when the numbers actually changed.
      return prev.scrollTop === next.scrollTop && prev.viewport === next.viewport ? prev : next;
    });
  }, [containerRef]);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    // Measured straight off the scroll event, NOT inside requestAnimationFrame. rAF is throttled
    // (and in a background tab, suspended entirely), so a coalescing frame that never runs leaves
    // the window frozen at whatever it last was while the container scrolls underneath it — the
    // sheet keeps showing row 1 while the scrollbar sits at the bottom. Browsers already fire
    // scroll at most once per frame, and the equality check above absorbs the rest.
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [enabled, containerRef, measure]);

  if (!enabled) {
    return { start: 0, end: heights.length, padTop: 0, padBottom: 0 };
  }
  // Before the first measurement the viewport is 0, which would render nothing at all and flash an
  // empty sheet. Assume a screen's worth until the real number arrives.
  const viewport = metrics.viewport || 800;
  return computeWindow(heights, metrics.scrollTop, viewport, overscan);
}
