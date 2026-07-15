import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

router.post("/", requireAuth, zValidator("json", z.object({
  query: z.string().min(1),
  verticals: z.array(z.string()).optional(),
  object_types: z.array(z.string()).optional(),
  limit: z.number().max(50).default(20)
})), async (c) => {
  const body = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const q = body.query;

  // Sanitized copy for the PostgREST .or() filter, whose grammar uses commas/parens as separators.
  const orQ = q.replace(/[(),]/g, " ").trim();

  const [nameResults, emailResults, financeResults, taskResults] = await Promise.all([
    supabase.from("nodes")
      .select("id, object_type, vertical, data, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("data->>name", `%${q}%`)
      .limit(body.limit),
    supabase.from("nodes")
      .select("id, object_type, vertical, data, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("data->>email", `%${q}%`)
      .limit(10),
    // Finance nodes store client_name / invoice number, not "name", so they were invisible to
    // search. Index them by client + number so "Acme invoices" and "INV-0007" both resolve.
    supabase.from("nodes")
      .select("id, object_type, vertical, data, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("vertical", "finance")
      .or(`data->>client_name.ilike.%${orQ}%,data->>number.ilike.%${orQ}%`)
      .limit(10),
    supabase.from("tasks")
      .select("id, title, priority, status, due_date, updated_at")
      .eq("workspace_id", workspaceId)
      .ilike("title", `%${q}%`)
      .limit(10)
  ]);

  // Merge node results, deduplicate by id
  const seen = new Set<string>();
  const nodeItems = [...(nameResults.data ?? []), ...(emailResults.data ?? [])]
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .map(r => ({ id: r.id, object_type: r.object_type, data: r.data, updated_at: r.updated_at }));

  // Finance items carry a display name (number · client) so the palette shows something legible.
  const financeItems = (financeResults.data ?? [])
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .map((r: any) => {
      const d = r.data ?? {};
      const name = [d.number, d.client_name].filter(Boolean).join(" · ") || d.description || "Finance item";
      return { id: r.id, object_type: r.object_type, data: { ...d, name }, updated_at: r.updated_at };
    });

  const taskItems = (taskResults.data ?? []).map((t: any) => ({
    id: t.id,
    object_type: "task",
    data: { name: t.title, status: t.status, priority: t.priority, due_date: t.due_date },
    updated_at: t.updated_at
  }));

  return c.json([...nodeItems, ...financeItems, ...taskItems]);
});

export { router as searchRouter };
