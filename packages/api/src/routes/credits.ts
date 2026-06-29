import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string; financeRole: string } }>();
router.use("*", requireAuth);

// GET /credits/balance — current wallet state for the sidebar bar + billing summary.
router.get("/balance", async (c) => {
  const ws = c.get("workspaceId");
  const { data: rows } = await supabase
    .from("ai_credits_ledger").select("amount, transaction_type").eq("workspace_id", ws);
  const list = rows ?? [];
  const granted = list.filter(r => r.transaction_type !== "usage").reduce((s, r) => s + Number(r.amount), 0);
  const usedNeg = list.filter(r => r.transaction_type === "usage").reduce((s, r) => s + Number(r.amount), 0); // ≤ 0
  const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = (wsRow?.settings ?? {}) as Record<string, unknown>;
  return c.json({
    enrolled: list.length > 0,
    balance: granted + usedNeg,
    granted,
    used: Math.abs(usedNeg),
    account_tier: (settings.track as string) ?? "personal",
    trial_ends_at: (settings.trial_ends_at as string) ?? null,
  });
});

// GET /credits/ledger — recent transaction history for the billing ledger card.
router.get("/ledger", async (c) => {
  const ws = c.get("workspaceId");
  const { data } = await supabase
    .from("ai_credits_ledger")
    .select("id, amount, transaction_type, description, created_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(100);
  return c.json({ ledger: data ?? [] });
});

export { router as creditsRouter };
