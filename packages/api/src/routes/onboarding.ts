import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

// GET /onboarding/status — returns which steps are complete based on real data
router.get("/status", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");

  const [
    { count: contactCount },
    { count: dealCount },
    { count: memberCount },
    { count: sequenceCount },
    { count: workflowCount },
    { count: reportCount },
    { count: threadCount },
    { count: emailCount },
    { count: importCount },
    { count: integrationCount },
  ] = await Promise.all([
    // contacts: person or company nodes
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("type", ["person", "company"]),
    // deals
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type", "deal"),
    // team members (> 1 means someone else was invited)
    supabase.from("workspace_members").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // sequences
    supabase.from("sequences").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // workflows / automations
    supabase.from("workflows").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // reports
    supabase.from("reports").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // ask AI threads
    supabase.from("ask_threads").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // email connections (synced email accounts)
    supabase.from("email_accounts").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // imports completed
    supabase.from("import_jobs").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "done"),
    // integrations / apps connected
    supabase.from("integrations").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  return c.json({
    workspace:  true,                            // always done — they're logged in
    contact:    (contactCount   ?? 0) > 0,
    email:      (emailCount     ?? 0) > 0,
    import:     (importCount    ?? 0) > 0,
    deal:       (dealCount      ?? 0) > 0,
    member:     (memberCount    ?? 0) > 1,       // > 1 means at least one invite accepted
    extension:  false,                           // detected client-side via localStorage flag
    report:     (reportCount    ?? 0) > 0,
    workflow:   (workflowCount  ?? 0) > 0,
    sequence:   (sequenceCount  ?? 0) > 0,
    ai:         (threadCount    ?? 0) > 0,
    apps:       (integrationCount ?? 0) > 0,
  });
});

export { router as onboardingRouter };
