import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { getTrainingPolicy, sanitizeExportRow, type ExportRow } from "../lib/training-ledger";

/**
 * Training-data controls — visible, per-workspace, opt-in governance for the AI training ledger.
 * Capture is OFF by default (see training-ledger.ts). Everything here is workspace-isolated:
 * a workspace only ever sees / exports / deletes its OWN ai_training_logs rows.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

/** GET /training/policy — current opt-in state, retention, capture count, and last activity. */
router.get("/policy", async (c) => {
  const ws = c.get("workspaceId");
  const policy = await getTrainingPolicy(ws);
  const { count } = await supabase.from("ai_training_logs").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  // Last captured example (most recent row) — honest "last capture" state, no fabrication.
  const { data: latest } = await supabase.from("ai_training_logs").select("created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(1).maybeSingle();
  // Last export/purge timestamps live in settings.training_policy (stamped by the handlers below).
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const tp = (wsRow?.settings as { training_policy?: { last_export_at?: string; last_purge_at?: string; updated_at?: string } } | null)?.training_policy ?? {};
  return c.json({
    ...policy,
    captured: count ?? 0,
    last_capture_at: latest?.created_at ?? null,
    last_export_at: tp.last_export_at ?? null,
    last_purge_at: tp.last_purge_at ?? null,
    updated_at: tp.updated_at ?? null,
  });
});

/** Merge a patch into settings.training_policy without dropping other policy fields. */
async function stampPolicy(ws: string, patch: Record<string, unknown>): Promise<void> {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  const tp = (settings.training_policy as Record<string, unknown>) ?? {};
  settings.training_policy = { ...tp, ...patch };
  await supabase.from("workspaces").update({ settings }).eq("id", ws).then(() => {}, () => {});
}

/** POST /training/policy — opt in/out + set retention. Owner/admin only. */
router.post("/policy", requireAdminRole, zValidator("json", z.object({ enabled: z.boolean(), retention_days: z.number().int().min(7).max(3650).optional() })), async (c) => {
  const ws = c.get("workspaceId");
  const body = c.req.valid("json");
  const { data } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = {
    ...((data?.settings as Record<string, unknown>) ?? {}),
    training_policy: { enabled: body.enabled, retention_days: body.retention_days ?? 365, updated_at: new Date().toISOString() },
  };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", ws);
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

/** GET /training/export — download THIS workspace's training rows (JSON). Owner/admin only. */
router.get("/export", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const { data, error } = await supabase
    .from("ai_training_logs")
    .select("agent_name, system_prompt, user_prompt, model_output, user_action, edited_output, created_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: true })
    .limit(50000);
  if (error) return c.json({ error: error.message }, 400);
  // Sanitize on export: drop empty examples, truncate oversized fields, neutralize prompt-injection,
  // and re-run PII redaction (defense-in-depth for any legacy/pre-opt-in row).
  const rows = (data ?? [])
    .map((r) => sanitizeExportRow(r as ExportRow))
    .filter((r): r is ExportRow => r !== null);
  const exportedAt = new Date().toISOString();
  await stampPolicy(ws, { last_export_at: exportedAt });
  return c.json({ workspace_id: ws, exported_at: exportedAt, count: rows.length, rows });
});

/** DELETE /training — purge THIS workspace's training rows. Owner/admin only. */
router.delete("/", requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const { error } = await supabase.from("ai_training_logs").delete().eq("workspace_id", ws);
  if (error) return c.json({ error: error.message }, 400);
  await stampPolicy(ws, { last_purge_at: new Date().toISOString() });
  return c.json({ ok: true });
});

export { router as trainingRouter };
