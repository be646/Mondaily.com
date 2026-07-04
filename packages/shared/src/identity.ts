/**
 * DISPLAY IDENTITY — one resolver for "what do we call this person", used by the Home greeting, the
 * sidebar, the Help context bundle, and support-ticket requester metadata.
 *
 * Resolution order: explicit full name → the email's local-part (title-cased) → "there".
 * Names/emails are the user's own data — never translated or altered beyond casing the local-part.
 */

export interface IdentityInput { name?: string | null; email?: string | null }

/** Title-case an email local-part: "bassem.epra" → "Bassem Epra"; "j_doe" → "J Doe". */
function humanizeLocalPart(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Full display name: real name if present, else a humanized email local-part, else "there". */
export function resolveDisplayName(u: IdentityInput | null | undefined): string {
  const name = (u?.name ?? "").trim();
  if (name) return name;
  const local = (u?.email ?? "").split("@")[0]?.trim() ?? "";
  const humanized = local ? humanizeLocalPart(local) : "";
  return humanized || "there";
}

/** First name for greetings — the first token of the resolved display name. */
export function firstNameOf(u: IdentityInput | null | undefined): string {
  const dn = resolveDisplayName(u);
  return dn === "there" ? "there" : (dn.split(/\s+/)[0] || "there");
}
