import { createHash } from "node:crypto";
import { supabase } from "@mondaily/db/client";

/**
 * Persisted Proof-of-Work claims. Each row is absolute cryptographic evidence that a user's
 * session solved the SHA-256 zero-nonce puzzle — the ABI matrix reads these to verify operator
 * legitimacy instead of proxying off a live session. Fire-and-forget: never throws, and no-ops
 * cleanly if the pow_claims table isn't present yet (pre-migration).
 */
export function logPowClaim(userId: string | null | undefined, challenge: string, nonce: string, context: string): void {
  if (!userId || !challenge || !nonce) return;
  const challenge_hash = createHash("sha256").update(challenge).digest("hex");
  void supabase.from("pow_claims").insert({ user_id: userId, challenge_hash, nonce, context }).then(() => {}, () => {});
}

/** Set of user_ids that have a verified PoW claim within the given window (default 30 days). */
export async function verifiedPowUserIds(sinceMs = 30 * 24 * 60 * 60 * 1000): Promise<Set<string>> {
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  const { data, error } = await supabase.from("pow_claims").select("user_id").gte("created_at", sinceIso);
  if (error || !data) return new Set();
  return new Set(data.map(r => String(r.user_id ?? "")));
}
