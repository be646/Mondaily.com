import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

type Variables = { userId: string; workspaceId: string; role: string };
type SequenceData = Record<string, unknown> & { name?: string; settings?: Record<string, unknown>; steps?: Record<string, unknown>[]; enrollments?: Record<string, unknown>[] };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const stepSchema = z.object({
  id: z.string().optional(), type: z.enum(["email", "task"]), label: z.string(), position: z.number(),
  delay_value: z.number().min(0), delay_unit: z.enum(["minutes", "hours", "days"]),
  subject: z.string().optional(), from_account: z.string().optional(), send_as: z.enum(["new", "reply"]).optional(),
  body: z.string().optional(), task_title: z.string().optional(), assignee_id: z.string().optional()
});

const defaultSettings = { stop_on_reply: true, sending_days: ["Mon", "Tue", "Wed", "Thu", "Fri"], send_start: "09:00", send_end: "17:00", daily_limit: 50, timezone: "UTC", unsubscribe: true };

async function getSequence(workspaceId: string, id: string) {
  const { data } = await supabase.from("nodes").select("id,data,created_by,created_at,updated_at").eq("workspace_id", workspaceId).eq("object_type", "automation").eq("id", id).maybeSingle();
  return data;
}

async function context(workspaceId: string, userId: string) {
  const [{ data: workspace }, { data: members }] = await Promise.all([
    supabase.from("workspaces").select("settings").eq("id", workspaceId).single(),
    supabase.from("workspace_members").select("user_id,role").eq("workspace_id", workspaceId)
  ]);
  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  const preferences = (settings.user_preferences ?? {}) as Record<string, Record<string, unknown>>;
  const accounts = Object.values(preferences).flatMap((item) => Array.isArray(item.connected_accounts) ? item.connected_accounts as { id: string; email: string }[] : []);
  return { accounts, members: (members ?? []).map((member) => ({ id: member.user_id, name: member.user_id === userId ? "You" : member.user_id, role: member.role })) };
}

function response(node: { id: string; data: SequenceData }, extra: Awaited<ReturnType<typeof context>>) {
  return { id: node.id, name: node.data.name ?? "Untitled sequence", status: node.data.status ?? "draft", settings: { ...defaultSettings, ...(node.data.settings ?? {}) }, steps: Array.isArray(node.data.steps) ? node.data.steps : [], enrollments: Array.isArray(node.data.enrollments) ? node.data.enrollments : [], ...extra };
}

async function saveData(workspaceId: string, id: string, data: SequenceData) {
  return supabase.from("nodes").update({ data }).eq("workspace_id", workspaceId).eq("object_type", "automation").eq("id", id).select("id,data").single();
}

router.get("/:id", async (c) => {
  const extra = await context(c.get("workspaceId"), c.get("userId"));
  if (c.req.param("id") === "new") return c.json({ id: "new", name: "Untitled sequence", status: "draft", settings: defaultSettings, steps: [], enrollments: [], ...extra });
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  return node ? c.json(response({ id: node.id, data: node.data as SequenceData }, extra)) : c.json({ error: "Sequence not found" }, 404);
});

router.patch("/:id", async (c) => {
  const body = await c.req.json<SequenceData>();
  const workspaceId = c.get("workspaceId");
  let result;
  if (c.req.param("id") === "new") result = await supabase.from("nodes").insert({ workspace_id: workspaceId, vertical: "shared", object_type: "automation", data: { ...body, type: "sequence" }, created_by: c.get("userId") }).select("id,data").single();
  else result = await saveData(workspaceId, c.req.param("id"), { ...body, type: "sequence" });
  if (result.error) return c.json({ error: result.error.message }, 400);
  await supabase.from("activities").insert({ node_id: result.data.id, workspace_id: workspaceId, actor_type: "human", actor_id: c.get("userId"), action: c.req.param("id") === "new" ? "created" : "updated", diff: { sequence: true } });
  return c.json(response({ id: result.data.id, data: result.data.data as SequenceData }, await context(workspaceId, c.get("userId"))));
});

router.get("/:id/steps", async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  return node ? c.json(((node.data as SequenceData).steps ?? []).sort((a, b) => Number(a.position) - Number(b.position))) : c.json({ error: "Sequence not found" }, 404);
});

router.post("/:id/steps", zValidator("json", stepSchema.omit({ id: true })), async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  if (!node) return c.json({ error: "Sequence not found" }, 404);
  const current = node.data as SequenceData;
  const step = { id: crypto.randomUUID(), ...c.req.valid("json") };
  const result = await saveData(c.get("workspaceId"), node.id, { ...current, steps: [...(current.steps ?? []), step] });
  return result.error ? c.json({ error: result.error.message }, 400) : c.json(step, 201);
});

router.patch("/:id/steps/:sid", zValidator("json", stepSchema.partial()), async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  if (!node) return c.json({ error: "Sequence not found" }, 404);
  const current = node.data as SequenceData;
  const steps = (current.steps ?? []).map((step) => step.id === c.req.param("sid") ? { ...step, ...c.req.valid("json") } : step);
  const result = await saveData(c.get("workspaceId"), node.id, { ...current, steps });
  return result.error ? c.json({ error: result.error.message }, 400) : c.json(steps.find((step) => step.id === c.req.param("sid")));
});

router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "automation")
    .eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

router.delete("/:id/steps/:sid", async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  if (!node) return c.json({ error: "Sequence not found" }, 404);
  const current = node.data as SequenceData;
  const steps = (current.steps ?? []).filter((step) => step.id !== c.req.param("sid")).map((step, index) => ({ ...step, position: index + 1 }));
  const result = await saveData(c.get("workspaceId"), node.id, { ...current, steps });
  return result.error ? c.json({ error: result.error.message }, 400) : c.json({ ok: true });
});

router.get("/:id/enrollments", async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  return node ? c.json((node.data as SequenceData).enrollments ?? []) : c.json({ error: "Sequence not found" }, 404);
});

router.post("/:id/enroll", zValidator("json", z.object({ node_ids: z.array(z.string().uuid()).min(1) })), async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  if (!node) return c.json({ error: "Sequence not found" }, 404);
  const { data: contacts } = await supabase.from("nodes").select("id,data").eq("workspace_id", c.get("workspaceId")).in("id", c.req.valid("json").node_ids);
  const current = node.data as SequenceData;
  const existingIds = new Set((current.enrollments ?? []).map((item) => String(item.node_id)));
  const additions = (contacts ?? []).filter((contact) => !existingIds.has(contact.id)).map((contact) => ({ id: crypto.randomUUID(), node_id: contact.id, contact_name: String(contact.data.name ?? "Untitled"), company: String(contact.data.company ?? ""), status: "active", current_step: 1, enrolled_at: new Date().toISOString() }));
  const result = await saveData(c.get("workspaceId"), node.id, { ...current, enrollments: [...(current.enrollments ?? []), ...additions] });
  return result.error ? c.json({ error: result.error.message }, 400) : c.json(additions, 201);
});

router.patch("/:id/enrollments/:eid", zValidator("json", z.object({ action: z.enum(["pause", "resume", "unenroll", "remove"]) })), async (c) => {
  const node = await getSequence(c.get("workspaceId"), c.req.param("id"));
  if (!node) return c.json({ error: "Sequence not found" }, 404);
  const current = node.data as SequenceData;
  const action = c.req.valid("json").action;
  const enrollments = action === "remove" ? (current.enrollments ?? []).filter((item) => item.id !== c.req.param("eid")) : (current.enrollments ?? []).map((item) => item.id === c.req.param("eid") ? { ...item, status: action === "pause" ? "paused" : action === "resume" ? "active" : "unsubscribed" } : item);
  const result = await saveData(c.get("workspaceId"), node.id, { ...current, enrollments });
  return result.error ? c.json({ error: result.error.message }, 400) : c.json({ ok: true });
});

export { router as sequencesRouter };
