import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { recallContext, memoryEnabled } from "../lib/memory-recall";

/**
 * Phase 2A — workspace memory (SHADOW mode). Two admin-only endpoints:
 *   GET  /memory/recall?q=…  — run source-backed recall and SEE what WOULD be recalled. It reads
 *                              only existing rows, injects nothing anywhere, and changes no answer.
 *   POST /memory/settings    — toggle the per-workspace flag (default OFF). Turning it ON only
 *                              unlocks this shadow view; it does NOT wire recall into Ask/agents.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

// GET /memory/recall — admin-only shadow view. When the flag is off, returns enabled:false + empties.
router.get("/recall", requireAdminRole, async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ enabled: await memoryEnabled(c.get("workspaceId")), candidates: [], candidate_count: 0, source_count: 0, latency_ms: 0, scanned: 0, note: "provide ?q=" });
  const result = await recallContext(c.get("workspaceId"), q, { userId: c.get("userId") });
  return c.json(result);
});

// GET /memory/settings — current flag state (any member can read; only admins can change).
router.get("/settings", async (c) => c.json({ enabled: await memoryEnabled(c.get("workspaceId")) }));

// POST /memory/settings { enabled } — admin toggle of settings.memory_enabled.
router.post("/settings", requireAdminRole, zValidator("json", z.object({ enabled: z.boolean() })), async (c) => {
  const ws = c.get("workspaceId");
  const { data: row } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = { ...((row?.settings ?? {}) as Record<string, unknown>), memory_enabled: c.req.valid("json").enabled };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", ws);
  if (error) return c.json({ error: "Could not update the memory setting." }, 500);
  return c.json({ ok: true, enabled: c.req.valid("json").enabled });
});

export { router as memoryRouter };
