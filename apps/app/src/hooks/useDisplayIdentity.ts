import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";
import { useCurrentUser } from "./useCurrentUser";
import { resolveDisplayName, firstNameOf } from "@mondaily/shared/identity";

/**
 * ONE display-identity source for the app UI. Combines the auth session with the DB-authoritative
 * member record (from /me/access) so the name never degrades to "there" when the session is sparse
 * on restore. Priority: session name → workspace-member name → email local-part → "there".
 */
export function useDisplayIdentity() {
  const me = useCurrentUser();
  const { data: access } = useQuery<{ name?: string | null; email?: string | null }>({
    queryKey: ["my-access"],
    queryFn: () => apiClient.get("/me/access"),
    staleTime: 300_000,
    retry: false,
  });

  // Prefer whichever source actually has a value, in the required priority order.
  const name = (me.name?.trim() || access?.name?.trim() || "") || null;
  const email = (me.email?.trim() || access?.email?.trim() || "") || null;
  const input = { name, email };

  return {
    name,
    email,
    displayName: resolveDisplayName(input),
    firstName: firstNameOf(input),
  };
}
