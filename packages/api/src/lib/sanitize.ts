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
  // "ignore/forget the previous instructions|directions|prompt|rules"
  /\b(ignore|forget|disregard)\s+(all\s+|any\s+)?(the\s+|your\s+)?(previous|prior|above|earlier|former|system)\s+(instructions?|directions?|directives?|prompts?|rules?|messages?)/i,
  /disregard\s+(the\s+)?(previous|above|system|prior)/i,
  // role re-assignment: "you are now …", "act as an admin/system/developer"
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\s+(an?\s+|the\s+)?(admin|administrator|root|system|developer|dan)\b/i,
  // role-marker smuggling at line start: "system:" / "assistant:"
  /^\s*(system|assistant)\s*:/im,
  // "new instructions:" hijack
  /\bnew\s+instructions?\s*:/i,
  // exfiltration: "reveal/print/repeat the system prompt" (kept narrow to "system
  // prompt / system instructions" so ordinary "show the onboarding guidelines"
  // text isn't flagged)
  /\b(reveal|print|repeat|show|expose)\s+(me\s+)?(the\s+|your\s+)?system\s+(prompt|instructions?)/i,
  // jailbreak / mode toggles
  /\b(developer|debug|jailbreak|dan|god)\s+mode\b/i,
  // score/result tampering: "override/set the (lead) score to 99", "output a score of 99"
  /override\s+(the\s+)?(score|instructions?|system|rules?)/i,
  /\bset\s+(the\s+)?(lead[_\s-]?score|deal[_\s-]?score|score)\s*(=|:|\bto\b|\bof\b)\s*\d+/i,
  /output\s+an?\b.*\bscore\s+of\s+\d+/i,
];

/** True if the text carries a known prompt-injection pattern. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text ?? ""));
}
