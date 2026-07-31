/**
 * THE numeric-string parser for user-entered and stored values — shared by the record table's
 * cells (write path!), the client footer calcs, and the server aggregate engine, so all three
 * always read the same number from the same string.
 *
 * Exists because every call site used `parseFloat(s.replace(/[^0-9.-]/g, ""))`, which corrupts
 * real-world input — and on the CELL WRITE PATH that stored the corrupted number permanently:
 *   "1.200,50"  (European)        → parsed 1.2      (correct: 1200.50)
 *   "1,5"       (European)        → parsed 15       (correct: 1.5)
 *   "€1.2M"                       → parsed 1.2      (correct: 1_200_000)
 *   "(500)"     (accounting neg)  → parsed +500     (correct: -500)
 */
export function parseNumeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || s === "—") return null;

  // Accounting negatives: (500) → -500
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) { negative = true; s = paren[1]!; }
  if (/^-/.test(s)) { negative = true; }

  // Magnitude suffix: 1.2k / 3M / 1.5bn / 2b (word boundary at the end, case-insensitive)
  let mult = 1;
  const suffix = s.match(/([kKmMbB]|bn|BN|Bn)\s*$/);
  if (suffix) {
    const t = suffix[1]!.toLowerCase();
    mult = t === "k" ? 1e3 : t === "m" ? 1e6 : 1e9; // b / bn → billion
    s = s.slice(0, -suffix[1]!.length);
  }

  // Strip currency symbols/codes/spaces, keep digits + separators
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;

  // Decimal separator: the LAST of "." or "," is the decimal point when it's followed by 1-2
  // digits OR when the other separator also appears; all other separators are thousands marks.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const dec = Math.max(lastDot, lastComma);
    const decChar = s[dec]!;
    s = s.split(decChar === "." ? "," : ".").join("");
    const i = s.lastIndexOf(decChar);
    s = s.slice(0, i).replace(/[.,]/g, "") + "." + s.slice(i + 1);
  } else if (lastComma !== -1) {
    // Only commas: "1,5" is decimal; "1,200" / "1,200,300" are thousands.
    const frac = s.length - lastComma - 1;
    const manyCommas = (s.match(/,/g) ?? []).length > 1;
    s = (frac === 3 && (manyCommas || s.length > 4)) || manyCommas
      ? s.replace(/,/g, "")
      : s.replace(",", ".");
  } else if (lastDot !== -1) {
    // Only dots: "1.200.300" is thousands; "1.5" / "1200.50" are decimals.
    const manyDots = (s.match(/\./g) ?? []).length > 1;
    if (manyDots) s = s.replace(/\./g, "");
  }

  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return (negative ? -n : n) * mult;
}
