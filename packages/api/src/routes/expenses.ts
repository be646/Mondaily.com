import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireModuleRW } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { aiGateway, gatewayEnv } from "../lib/ai-gateway";

type Variables = { userId: string; workspaceId: string; role: string };

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);
router.use("*", requireModuleRW("finance")); // per-member Finance & Billing access

const EXPENSE_CATEGORIES = ["travel", "software", "hardware", "meals", "marketing", "professional_services", "office", "other"] as const;

const expenseBodySchema = z.object({
  description: z.string().min(1),
  amount_cents: z.number().int().min(0),
  currency: z.string().default("GBP"),
  category: z.enum(EXPENSE_CATEGORIES).default("other"),
  date: z.string().optional(),
  vendor: z.string().optional(),
  receipt_url: z.string().url().optional(),
  linked_record_id: z.string().uuid().optional(),
  status: z.enum(["draft", "submitted", "approved", "rejected"]).default("draft"),
});

router.get("/", async (c) => {
  const category = c.req.query("category");
  const status = c.req.query("status");
  const linkedRecordId = c.req.query("linked_record_id");
  // The UI has always sent ?search; this route ignored it, so typing returned unfiltered rows
  // with no sign that filtering had failed. Matches the invoices/quotes/credit-notes routes.
  const search = (c.req.query("search") ?? "").trim().toLowerCase();

  let query = supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("vertical", "finance")
    .eq("object_type", "expense")
    .order("created_at", { ascending: false });

  if (category) query = query.eq("data->>category", category);
  if (status) query = query.eq("data->>status", status);
  if (linkedRecordId) query = query.eq("data->>linked_record_id", linkedRecordId);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const rows = (data ?? []).filter(row => {
    if (!search) return true;
    const d = row.data as Record<string, unknown>;
    return (
      String(d.merchant ?? "").toLowerCase().includes(search) ||
      String(d.description ?? "").toLowerCase().includes(search) ||
      String(d.category ?? "").toLowerCase().includes(search)
    );
  });

  return c.json(rows.map(row => ({ id: row.id, ...row.data, created_at: row.created_at, updated_at: row.updated_at, created_by: row.created_by })));
});

router.get("/:id", async (c) => {
  const { data, error } = await supabase
    .from("nodes")
    .select("id,data,created_at,updated_at,created_by")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "expense")
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Not found" }, 404);
  return c.json({ id: data.id, ...data.data, created_at: data.created_at, updated_at: data.updated_at, created_by: data.created_by });
});

router.post("/", zValidator("json", expenseBodySchema), async (c) => {
  const body = c.req.valid("json");

  const expenseData = {
    description: body.description,
    amount_cents: body.amount_cents,
    currency: body.currency,
    category: body.category,
    date: body.date ?? new Date().toISOString().split("T")[0],
    vendor: body.vendor ?? null,
    receipt_url: body.receipt_url ?? null,
    status: body.status,
    ...(body.linked_record_id ? { linked_record_id: body.linked_record_id } : {}),
  };

  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: c.get("workspaceId"),
      vertical: "finance",
      object_type: "expense",
      data: expenseData,
      created_by: c.get("userId"),
    })
    .select("id,data,created_at,created_by")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data.id, ...data.data, created_at: data.created_at, created_by: data.created_by }, 201);
});

router.patch("/:id", zValidator("json", expenseBodySchema.partial()), async (c) => {
  const { data: existing, error: fetchErr } = await supabase
    .from("nodes")
    .select("id,data")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "expense")
    .maybeSingle();

  if (fetchErr) return c.json({ error: fetchErr.message }, 500);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = c.req.valid("json");
  const current = existing.data as Record<string, unknown>;
  const updatedData = { ...current, ...body };

  const { data, error } = await supabase
    .from("nodes")
    .update({ data: updatedData, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select("id,data,updated_at")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data.id, ...data.data, updated_at: data.updated_at });
});

router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .eq("vertical", "finance")
    .eq("object_type", "expense");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── AI: suggest a category from the description/vendor ───────────────────────
// Classifier only — returns one of the fixed EXPENSE_CATEGORIES (never invents one),
// plus a short rationale. The client applies it; nothing is persisted here.
router.post("/categorize", zValidator("json", z.object({
  description: z.string().min(1).max(500),
  vendor: z.string().max(200).optional(),
  amount_cents: z.number().int().min(0).optional(),
})), async (c) => {
  const env = gatewayEnv();
  if (!env.baseURL || !env.apiKey) return c.json({ error: "AI isn't available right now." }, 503);
  const { description, vendor, amount_cents } = c.req.valid("json");

  const system = `You classify a business expense into EXACTLY ONE of these categories: ${EXPENSE_CATEGORIES.join(", ")}. Reply with ONLY a compact JSON object {"category":"<one of the list>","rationale":"<max 12 words>"}. If unsure, use "other". Never invent a category outside the list.`;
  const prompt = `Description: ${description}${vendor ? `\nVendor: ${vendor}` : ""}${amount_cents != null ? `\nAmount: ${(amount_cents / 100).toFixed(2)}` : ""}`;

  try {
    const res = await aiGateway({ system, prompt, maxTokens: 80, workspaceId: c.get("workspaceId"), userId: c.get("userId"), feature: "expense_categorize" });
    const raw = (res.text ?? "").trim();
    if (!raw || res.provider === "none") return c.json({ error: "Couldn't suggest a category (check your AI credits)." }, 200);
    let category = "other", rationale = "";
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : {};
      if (typeof parsed.category === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(parsed.category)) category = parsed.category;
      if (typeof parsed.rationale === "string") rationale = parsed.rationale.slice(0, 120);
    } catch { /* fall back to "other" if the model didn't return clean JSON */ }
    return c.json({ category, rationale });
  } catch { return c.json({ error: "Couldn't suggest a category — please try again." }, 200); }
});

export { router as expensesRouter };
