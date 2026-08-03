/**
 * A deal's VALUE and OWNER — resolved once, like its stage.
 *
 * Same disease, two more facts. Measured in prod (44 deals, 2026-08-03):
 *
 *   value:  deal_value 27,  amount 5,  value 0,  arr 0
 *   owner:  deal_owner 44,  owner 32,  assigned_to 3,  assignee 0
 *
 * The record page read `data.deal_value` alone, so the five deals that store their figure under
 * `amount` showed "Not set" on the Deal Value card while the AI score panel and the forecast on the
 * SAME SCREEN both showed $6,000 and every report counted the money. The owner chains were worse:
 * one call site preferred `owner`, another `deal_owner`, another `assignee ?? assigned_to` — three
 * orderings over three fields that do not agree per record.
 *
 * `value`, `arr` and `assignee` are kept in the chains despite zero occurrences here. They are
 * harmless, and absence in ONE workspace is not evidence they are unused everywhere. Contrast
 * `status`, which was removed from the stage chain — that one had demonstrated harm, not just
 * absence.
 */

/** Parse a money-ish cell without inventing a number. Returns null when there is nothing to read. */
function numish(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * The deal's value, or null when the record genuinely has none.
 *
 * Null rather than 0: a deal worth nothing and a deal that never said are different facts, and
 * summing the second as zero hides how much of a pipeline figure is actually unknown.
 */
export function dealValueOf(d: Record<string, unknown> | null | undefined): number | null {
  const data = d ?? {};
  for (const k of ["deal_value", "value", "amount", "arr"]) {
    const n = numish(data[k]);
    if (n !== null) return n;
  }
  return null;
}

/** Which key holds the value, so an edit lands where the rest of the app reads it. */
export function dealValueKey(d: Record<string, unknown> | null | undefined): string {
  const data = d ?? {};
  for (const k of ["deal_value", "value", "amount", "arr"]) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== "") return k;
  }
  return "deal_value";
}

/**
 * The deal's owner as WRITTEN on the record — a display string, never a member identity.
 *
 * Ordered by measured coverage, not by which name reads most official: `deal_owner` is on every
 * deal, `owner` on 32, `assigned_to` on 3 — and of those three only one resolves to an actual
 * member (the others are a raw UUID and a misspelt name). Callers that need a real member must
 * resolve it against the roster; this returns text, and a field NAMED like an owner is not one.
 */
export function dealOwnerOf(d: Record<string, unknown> | null | undefined): string {
  const data = d ?? {};
  for (const k of ["deal_owner", "owner", "assigned_to", "assignee"]) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function dealOwnerKey(d: Record<string, unknown> | null | undefined): string {
  const data = d ?? {};
  for (const k of ["deal_owner", "owner", "assigned_to", "assignee"]) {
    if (data[k] !== undefined && String(data[k] ?? "").trim() !== "") return k;
  }
  return "deal_owner";
}
