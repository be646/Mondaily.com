/**
 * Text sanitisation + prompt-injection detection — shared, unit-tested utilities
 * used by the training-data exporter and untrusted-context handling.
 */

/** Strip control characters (keep \t and \n) and normalise unicode line separators. */
export function stripControlChars(text: string): string {
  return (text ?? "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[\u2028\u2029]/g, "\n");
}

/** Collapse an untrusted free-text value to a single safe line (inline use). */
export function neutralizeUntrusted(text: string): string {
  return stripControlChars(text).replace(/\s+/g, " ").trim();
}

/** Normalise a string for the training corpus (strip control chars + dedupe spaces). */
export function sanitizeForTraining(text: string): string {
  return stripControlChars(text).replace(/[ \t]{2,}/g, " ").trim();
}

/** Known prompt-injection patterns (heuristic — catches common vectors). */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(the\s+)?(previous|above|system|prior)/i,
  /\byou\s+are\s+now\b/i,
  /^\s*system\s*:/im,
  /override\s+(the\s+)?(score|instructions?|system|rules?)/i,
  /output\s+an?\b.*\bscore\s+of\s+\d+/i,
];

/** True if the text carries a known prompt-injection pattern. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text ?? ""));
}
