/**
 * Grounding validation — CODE COUNTS, AI NARRATES, THEN CODE CHECKS THE NARRATION.
 *
 * Born on the Owner Memo, where prompt rules alone did not hold: told "never compute, never
 * convert", the model converted 368,516 PLN to "85,393.7 EUR" by itself and narrated a percentage
 * delta as an amount. The fix that worked was not a better prompt — it was validating the output
 * against the input and shipping the deterministic fallback on any violation.
 *
 * Generalized here so every prose-from-numbers surface (owner memo, oversight insight, future
 * digests) uses ONE validator instead of each growing its own.
 */

/** Every finite number in a payload, recursively — the set a grounded text may draw from. */
export function numbersIn(x: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof x === "number" && Number.isFinite(x)) out.add(Math.abs(x));
  else if (typeof x === "string") {
    // Digests are often STRINGS ("AI credits used: 745180") — their embedded numbers are grounded
    // facts too, or a text-payload surface could never pass its own numbers back.
    for (const m of x.matchAll(/\d[\d,.]*\d|\d/g)) {
      const n = parseFloat(m[0].replace(/,/g, ""));
      if (Number.isFinite(n)) out.add(Math.abs(n));
    }
  }
  else if (Array.isArray(x)) for (const v of x) numbersIn(v, out);
  else if (x && typeof x === "object") for (const v of Object.values(x)) numbersIn(v, out);
  return out;
}

/**
 * Violations in `text` relative to `payload`:
 *  - any number above `minMagnitude` (default 100) that does not exist in the payload
 *    (0.5% tolerance for the model's rounding). Small numbers are exempt — counts and
 *    percentages are unverifiable noise, and rejecting "3 sentences" is crying wolf.
 *  - when `base` is given: any OTHER currency code/symbol (the model converting on its own).
 */
export function groundingViolations(text: string, payload: unknown, opts: { base?: string; minMagnitude?: number } = {}): string[] {
  const violations: string[] = [];
  const minMag = opts.minMagnitude ?? 100;

  if (opts.base) {
    const KNOWN = ["EUR", "USD", "GBP", "CHF", "PLN", "AED", "SAR"];
    const foreign = KNOWN.filter(code => code !== opts.base && new RegExp(`\\b${code}\\b`).test(text));
    for (const [sym, code] of [["€", "EUR"], ["$", "USD"], ["£", "GBP"]] as const) {
      if (text.includes(sym) && code !== opts.base) foreign.push(code);
    }
    if (foreign.length) violations.push(`foreign currency: ${[...new Set(foreign)].join(", ")}`);
  }

  const allowed = numbersIn(payload);
  for (const m of text.matchAll(/\d[\d,. ]*\d|\d/g)) {
    const n = parseFloat(m[0].replace(/[ ,]/g, ""));
    if (!Number.isFinite(n) || n <= minMag) continue;
    const grounded = [...allowed].some(a => Math.abs(a - n) <= Math.max(0.5, a * 0.005));
    if (!grounded) violations.push(`ungrounded number: ${m[0].trim()}`);
  }
  return violations;
}
