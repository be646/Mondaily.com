import { supabase } from "@mondaily/db/client";

/**
 * Product-owner allowlist — a small set of exact emails that get the TOP tier and UNMETERED AI with
 * NO payment. This exists only for the product owner's own testing account(s); it is deliberately
 * email-gated (not a wildcard, not a role) so it can never widen to real customers.
 *
 * A workspace qualifies when one of its OWNER members has an allowlisted email. Results are cached
 * for the process lifetime (ownership effectively never changes), so this adds at most one query per
 * workspace per deploy.
 */
export const OWNER_EMAILS = new Set<string>([
  "bassem.epra@gmail.com",
]);

const ownerWorkspaceCache = new Map<string, boolean>();

export async function isOwnerWorkspace(workspaceId?: string | null): Promise<boolean> {
  if (!workspaceId) return false;
  const cached = ownerWorkspaceCache.get(workspaceId);
  if (cached !== undefined) return cached;
  const { data } = await supabase
    .from("workspace_members")
    .select("email")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");
  const owned = (data ?? []).some((m) =>
    OWNER_EMAILS.has(String((m as { email?: string }).email ?? "").trim().toLowerCase()),
  );
  ownerWorkspaceCache.set(workspaceId, owned);
  return owned;
}
