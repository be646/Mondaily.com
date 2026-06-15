import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

type Variables = { userId: string; workspaceId: string; role: string };

const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

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

  return c.json((data ?? []).map(row => ({ id: row.id, ...row.data, created_at: row.created_at, updated_at: row.updated_at, created_by: row.created_by })));
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

export { router as expensesRouter };
