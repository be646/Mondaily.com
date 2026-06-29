import { Hono } from "hono";
import { sign } from "hono/jwt";
import { requireAuth } from "../middleware/auth";

/**
 * Clerk → Supabase Realtime bridge. The SPA authenticates with Clerk, not Supabase
 * Auth, so it can't open a Realtime channel directly (RLS would reject it). This mints
 * a short-lived Supabase-compatible JWT (HS256, signed with the project's JWT secret)
 * carrying the caller's workspace_id as a claim — an RLS policy on agent_jobs keyed on
 * that claim then scopes the channel to the user's workspace.
 *
 * GRACEFUL: if SUPABASE_JWT_SECRET / SUPABASE_ANON_KEY aren't set, returns { enabled:false }
 * and the client transparently keeps its adaptive polling — nothing breaks.
 */
const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

router.get("/token", async (c) => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!secret || !url || !anonKey) return c.json({ enabled: false });

  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      sub: userId,
      role: "authenticated",
      workspace_id: workspaceId,   // custom claim → RLS: workspace_id = auth.jwt()->>'workspace_id'
      iat: now,
      exp: now + 60 * 60,          // 1 hour; the client refreshes on reconnect
    },
    secret,
  );
  return c.json({ enabled: true, token, url, anonKey, workspaceId });
});

export { router as realtimeRouter };
