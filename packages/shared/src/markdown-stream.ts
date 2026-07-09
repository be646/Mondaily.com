/**
 * Streaming-Markdown sanitizer.
 *
 * While an assistant reply streams in token-by-token, a half-arrived inline token — an unclosed
 * `**bold`, `` `code ``, or `[link` — renders its RAW symbols until the closer arrives, so the
 * message visibly flashes `**` / backticks / brackets. This trims ONLY that trailing, still-open
 * token so the incomplete markup is hidden until it completes. It never alters already-closed
 * markup, and once streaming ends the full (untrimmed) text is rendered — so nothing is lost.
 *
 * Pure + deterministic → fully unit-testable without a live stream.
 */
export function sanitizeStreamingMarkdown(text: string): string {
  let t = text ?? "";

  // 1. Unclosed inline code: an odd number of backticks means the last one is still open.
  const backticks = (t.match(/`/g) || []).length;
  if (backticks % 2 === 1) t = t.slice(0, t.lastIndexOf("`"));

  // 2. Unclosed link: a trailing "[label](partial" or "[label" with no completed "](url)" after it.
  const lb = t.lastIndexOf("[");
  if (lb !== -1 && !/\]\([^)]*\)/.test(t.slice(lb))) t = t.slice(0, lb);

  // 3. Unclosed bold: an odd number of "**" markers means the last one is still open.
  const bold = (t.match(/\*\*/g) || []).length;
  if (bold % 2 === 1) t = t.slice(0, t.lastIndexOf("**"));

  // 4. Unclosed single-* italic (ignoring the ** we've already balanced): trim a dangling opener.
  const singles = [...t.matchAll(/(?<!\*)\*(?!\*)/g)];
  if (singles.length % 2 === 1) t = t.slice(0, singles[singles.length - 1]!.index);

  return t;
}
