import { supabase } from "@mondaily/db/client";
import { insertTrialWorkspace } from "./trial";

/**
 * Native workspace bootstrap (no Clerk org). Returns the user's existing workspace if they
 * already belong to one, otherwise creates a fresh trial workspace and binds the user as its
 * owner. Atomic: if the owner-membership insert fails for a just-created workspace, the
 * workspace is rolled back so we never leave an orphaned, member-less workspace.
 */
export async function ensureWorkspaceForUser(userId: string, name = "My Workspace"): Promise<{ workspaceId: string; isNew: boolean }> {
  const { data: existing } = await supabase
    .from("workspace_members").select("workspace_id")
    .eq("user_id", userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (existing?.workspace_id) return { workspaceId: existing.workspace_id as string, isNew: false };

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 7);
  const ws = await insertTrialWorkspace({ name, slug });

  const { error } = await supabase.from("workspace_members").upsert(
    { workspace_id: ws.id, user_id: userId, role: "owner" },
    { onConflict: "workspace_id,user_id" },
  );
  if (error) {
    await supabase.from("workspaces").delete().eq("id", ws.id).then(() => {}, () => {});
    throw new Error(`Workspace bootstrap failed: ${error.message}`);
  }
  return { workspaceId: ws.id, isNew: true };
}
