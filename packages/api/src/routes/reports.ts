import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const reportType = z.enum(["insight", "funnel", "time_in_stage", "historical"]);
const reportInput = z.object({ name: z.string().min(1), type: reportType, config: z.record(z.unknown()) });

function unpack(node: { id: string; data: Record<string, unknown>; created_by?: string | null; updated_at: string }) {
  return { id: node.id, ...node.data, created_by: node.created_by, updated_at: node.updated_at };
}

router.get("/", async (c) => {
  const { data, error } = await supabase.from("nodes").select("id,data,created_by,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").order("updated_at", { ascending: false });
  return error ? c.json({ error: error.message }, 400) : c.json((data ?? []).map((node) => unpack(node as never)));
});

router.post("/", zValidator("json", reportInput), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "report", data: body, created_by: c.get("userId") }).select("id,data,created_by,updated_at").single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "created", diff: { object_type: "report" } });
  return c.json(unpack(data as never), 201);
});

router.get("/:id", async (c) => {
  const { data } = await supabase.from("nodes").select("id,data,created_by,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").eq("id", c.req.param("id")).maybeSingle();
  return data ? c.json(unpack(data as never)) : c.json({ error: "Report not found" }, 404);
});

router.post("/:id", zValidator("json", reportInput.extend({ id: z.string().optional() })), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").update({ data: { name: body.name, type: body.type, config: body.config } }).eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").eq("id", c.req.param("id")).select("id,data,created_by,updated_at").single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "updated", diff: { report: body } });
  return c.json(unpack(data as never));
});

router.post("/:id/run", async (c) => {
  const input: { type?: string; config?: Record<string, unknown> } = await c.req.json<{ type?: string; config?: Record<string, unknown> }>().catch(() => ({}));
  const { data: reportNode } = await supabase.from("nodes").select("data").eq("workspace_id", c.get("workspaceId")).eq("object_type", "report").eq("id", c.req.param("id")).maybeSingle();
  if (!reportNode) return c.json({ error: "Report not found" }, 404);
  const stored = reportNode.data as { type?: string; config?: Record<string, unknown> };
  const type = input.type ?? stored.type ?? "insight";
  const config = { ...(stored.config ?? {}), ...(input.config ?? {}) };
  const objectType = String(config.object_type ?? "deal");
  const { data: nodes, error } = await supabase.from("nodes").select("id,data,created_at,updated_at").eq("workspace_id", c.get("workspaceId")).eq("object_type", objectType).order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message }, 400);

  if (type === "funnel") {
    const stages: string[] = Array.isArray(config.stages) ? config.stages.map(String) : [];
    const stageField = String(config.stage_field ?? "stage");
    const values = stages.map((stage, index) => {
      const value = (nodes ?? []).filter((node) => String(node.data?.[stageField] ?? "").toLowerCase() === stage.toLowerCase()).length;
      const previous = index === 0 ? value : (nodes ?? []).filter((node) => String(node.data?.[stageField] ?? "").toLowerCase() === stages[index - 1]?.toLowerCase()).length;
      return { label: stage, value, dropoff: previous ? Math.max(0, Math.round((1 - value / previous) * 100)) : 0, average_days: 0 };
    });
    return c.json({ data: values, chart_type: "funnel" });
  }
  if (type === "time_in_stage") {
    const stageField = String(config.stage_field ?? "stage");
    const grouped = new Map<string, number[]>();
    for (const node of nodes ?? []) {
      const stage = String(node.data?.[stageField] ?? "Unknown");
      const days = Math.max(0, (new Date(node.updated_at).getTime() - new Date(node.created_at).getTime()) / 86_400_000);
      grouped.set(stage, [...(grouped.get(stage) ?? []), days]);
    }
    return c.json({ data: [...grouped].map(([label, values]) => ({ label, value: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) })), chart_type: "bar" });
  }
  if (type === "historical") {
    const field = String(config.field ?? "value");
    let activityQuery = supabase.from("activities").select("created_at,diff,node_id").eq("workspace_id", c.get("workspaceId")).order("created_at", { ascending: true });
    if (config.record_id) activityQuery = activityQuery.eq("node_id", String(config.record_id));
    const { data: activities } = await activityQuery;
    const data = (activities ?? []).flatMap((activity) => {
      const diff = activity.diff as Record<string, unknown> | null;
      const raw = diff?.[field] ?? (diff?.data as Record<string, unknown> | undefined)?.[field];
      const value = Number(raw);
      return Number.isFinite(value) ? [{ label: new Date(activity.created_at).toLocaleDateString(), value }] : [];
    });
    return c.json({ data, chart_type: "line" });
  }

  const metric = String(config.metric ?? "count");
  const field = String(config.field ?? "value");
  const groupBy = String(config.group_by ?? "month");
  const groups = new Map<string, number[]>();
  for (const node of nodes ?? []) {
    const date = new Date(node.created_at);
    const label = groupBy === "day" ? date.toISOString().slice(0, 10) : groupBy === "week" ? `${date.getFullYear()} W${Math.ceil(date.getDate() / 7)}` : groupBy === "quarter" ? `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}` : date.toLocaleDateString("en", { month: "short", year: "numeric" });
    groups.set(label, [...(groups.get(label) ?? []), Number(node.data?.[field] ?? 0)]);
  }
  const data = [...groups].map(([label, values]) => ({ label, value: metric === "count" ? values.length : metric === "average" ? Number((values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(2)) : values.reduce((sum, value) => sum + value, 0) }));
  const total = metric === "average" ? Number((data.reduce((sum, item) => sum + item.value, 0) / Math.max(data.length, 1)).toFixed(2)) : data.reduce((sum, item) => sum + item.value, 0);
  return c.json({ data, total, change: 0, chart_type: config.chart_type ?? "line" });
});

export { router as reportsRouter };
