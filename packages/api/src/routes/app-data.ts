import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

type AppVariables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: AppVariables }>();
router.use("*", requireAuth);

async function rows(table: string, workspaceId: string, options?: { objectType?: string; limit?: number }) {
  let query = supabase.from(table).select("*").eq("workspace_id", workspaceId);
  if (options?.objectType) query = query.eq("object_type", options.objectType);
  const { data } = await query.limit(options?.limit ?? 100);
  return data ?? [];
}

async function workspaceSettings(workspaceId: string) {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).single();
  return (data?.settings ?? {}) as Record<string, unknown>;
}

async function mergeWorkspaceSettings(workspaceId: string, updates: Record<string, unknown>) {
  const current = await workspaceSettings(workspaceId);
  const settings = { ...current, ...updates };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", workspaceId);
  if (error) throw new Error(error.message);
  return settings;
}

router.get("/objects", async (c) => {
  const data = await rows("object_definitions", c.get("workspaceId"));
  return c.json(data);
});

router.get("/notifications", async (c) => c.json(await rows("notifications", c.get("workspaceId"))));
router.post("/notifications/:id/read", async (c) => {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id"));
  return c.json({ ok: true });
});
router.post("/notifications/read-all", async (c) => {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("workspace_id", c.get("workspaceId")).is("read_at", null);
  return c.json({ ok: true });
});

router.get("/tasks", async (c) => {
  const nodes = await rows("nodes", c.get("workspaceId"), { objectType: "task" });
  return c.json(nodes.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })));
});
router.get("/meetings/today", async (c) => {
  const nodes = await rows("nodes", c.get("workspaceId"), { objectType: "meeting" });
  const today = new Date().toISOString().slice(0, 10);
  return c.json(nodes.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })).filter((meeting: Record<string, unknown>) => String(meeting.start_time ?? "").startsWith(today)));
});
router.post("/tasks", zValidator("json", z.object({ title: z.string().min(1), due_date: z.string().optional(), assignee_id: z.string().optional() })), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "tasks", object_type: "task", data: { ...body, completed: false }, created_by: c.get("userId") }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "created", diff: body });
  return c.json({ id: data.id, ...data.data }, 201);
});
router.patch("/tasks/:id", async (c) => {
  const updates = await c.req.json<Record<string, unknown>>();
  const { data: existing } = await supabase.from("nodes").select("data").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).single();
  const { data, error } = await supabase.from("nodes").update({ data: { ...(existing?.data ?? {}), ...updates } }).eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({ node_id: data.id, workspace_id: c.get("workspaceId"), actor_type: "human", actor_id: c.get("userId"), action: "updated", diff: updates });
  return c.json({ id: data.id, ...data.data });
});

router.post("/emails/send", zValidator("json", z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
})), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: c.get("workspaceId"),
    vertical: "sales",
    object_type: "email_outbox",
    data: { ...body, status: "queued", requested_at: new Date().toISOString() },
    created_by: c.get("userId")
  }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  await supabase.from("activities").insert({
    node_id: data.id,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: "email_queued",
    diff: { to: body.to, subject: body.subject }
  });
  return c.json({ id: data.id, status: "queued" }, 202);
});

for (const objectType of ["email_thread", "call"]) {
  const path = objectType === "email_thread" ? "/emails" : "/calls";
  router.get(path, async (c) => {
    const nodes = await rows("nodes", c.get("workspaceId"), { objectType });
    return c.json(nodes.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })));
  });
  router.get(`${path}/:id`, async (c) => {
    const { data } = await supabase.from("nodes").select("*").eq("workspace_id", c.get("workspaceId")).eq("object_type", objectType).eq("id", c.req.param("id")).single();
    if (!data) return c.json({ error: "Not found" }, 404);
    return c.json({ id: data.id, ...data.data });
  });
}

router.get("/reports", async (c) => {
  const reports = await rows("nodes", c.get("workspaceId"), { objectType: "report" });
  return c.json({ charts: [], reports: reports.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })) });
});
router.get("/automations", async (c) => {
  const data = await rows("nodes", c.get("workspaceId"), { objectType: "automation" });
  return c.json(data.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })));
});
router.get("/automations/sequences/:id", async (c) => {
  if (c.req.param("id") === "new") return c.json({ id: "new", name: "Untitled sequence", status: "draft", steps: [], enrollments: [] });
  const { data } = await supabase.from("nodes").select("*").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).single();
  return data ? c.json({ id: data.id, ...data.data }) : c.json({ error: "Not found" }, 404);
});
router.patch("/automations/sequences/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const { data, error } = await supabase.from("nodes").upsert({ id: c.req.param("id") === "new" ? undefined : c.req.param("id"), workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "automation", data: { ...body, type: "sequence" }, created_by: c.get("userId") }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ id: data.id, ...data.data });
});

router.get("/settings/account", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const userPreferences = ((settings.user_preferences as Record<string, unknown> | undefined)?.[c.get("userId")] ?? {}) as Record<string, unknown>;
  return c.json({
    email_notifications: userPreferences.email_notifications ?? true,
    agent_notifications: userPreferences.agent_notifications ?? true,
    task_notifications: userPreferences.task_notifications ?? true,
    appearance: userPreferences.appearance ?? "dark",
    connected_accounts: userPreferences.connected_accounts ?? []
  });
});
router.patch("/settings/account", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  const preferences = (settings.user_preferences ?? {}) as Record<string, unknown>;
  await mergeWorkspaceSettings(c.get("workspaceId"), {
    user_preferences: { ...preferences, [c.get("userId")]: body }
  });
  return c.json({ ok: true });
});
router.delete("/settings/account/connections/:id", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const preferences = (settings.user_preferences ?? {}) as Record<string, Record<string, unknown>>;
  const current = preferences[c.get("userId")] ?? {};
  const accounts = Array.isArray(current.connected_accounts) ? current.connected_accounts as { id: string }[] : [];
  await mergeWorkspaceSettings(c.get("workspaceId"), {
    user_preferences: {
      ...preferences,
      [c.get("userId")]: { ...current, connected_accounts: accounts.filter((account) => account.id !== c.req.param("id")) }
    }
  });
  return c.json({ ok: true });
});
router.get("/settings/workspace", async (c) => {
  const { data } = await supabase.from("workspaces").select("name, settings").eq("id", c.get("workspaceId")).single();
  return c.json({ name: data?.name ?? "", timezone: data?.settings?.timezone ?? "UTC" });
});
router.patch("/settings/workspace", async (c) => {
  const body = await c.req.json<{ name?: string; timezone?: string }>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  await supabase.from("workspaces").update({ name: body.name, settings: { ...settings, timezone: body.timezone } }).eq("id", c.get("workspaceId"));
  return c.json({ ok: true });
});
router.get("/settings/members", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [{ data: members }, { data: teams }, invites] = await Promise.all([
    supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId),
    supabase.from("teams").select("*, team_members(user_id)").eq("workspace_id", workspaceId),
    rows("nodes", workspaceId, { objectType: "workspace_invitation" })
  ]);
  return c.json({
    members: (members ?? []).map((member) => ({ id: member.user_id, name: member.user_id, email: "", role: member.role, status: "active" })),
    invitations: invites.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })),
    teams: (teams ?? []).map((team) => ({ id: team.id, name: team.name, member_count: team.team_members?.length ?? 0, member_ids: team.team_members?.map((item: { user_id: string }) => item.user_id) ?? [] }))
  });
});
router.patch("/settings/members/:id", async (c) => {
  const body = await c.req.json<{ role: string }>();
  const { error } = await supabase.from("workspace_members").update({ role: body.role }).eq("workspace_id", c.get("workspaceId")).eq("user_id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});
router.delete("/settings/members/:id", async (c) => {
  await supabase.from("workspace_members").delete().eq("workspace_id", c.get("workspaceId")).eq("user_id", c.req.param("id"));
  return c.json({ ok: true });
});
router.post("/settings/teams", zValidator("json", z.object({ name: z.string().min(1), member_ids: z.array(z.string()) })), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase.from("teams").insert({ workspace_id: c.get("workspaceId"), name: body.name }).select().single();
  if (error) return c.json({ error: error.message }, 400);
  if (body.member_ids.length) await supabase.from("team_members").insert(body.member_ids.map((user_id) => ({ team_id: data.id, user_id })));
  return c.json({ id: data.id, name: data.name, member_count: body.member_ids.length, member_ids: body.member_ids }, 201);
});
router.get("/settings/objects", async (c) => c.json(await rows("object_definitions", c.get("workspaceId"))));
router.post("/settings/objects", async (c) => {
  const body = await c.req.json<{ name: string; slug: string }>();
  const { data, error } = await supabase.from("object_definitions").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", slug: body.slug, name_singular: body.name, name_plural: body.name, attributes: [] }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});
router.post("/settings/objects/:id/attributes", zValidator("json", z.object({
  name: z.string().min(1),
  type: z.enum(["text", "number", "date", "select", "relation"])
})), async (c) => {
  const body = c.req.valid("json");
  const { data: object } = await supabase.from("object_definitions").select("attributes").eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).single();
  if (!object) return c.json({ error: "Object not found" }, 404);
  const attributes = [...(Array.isArray(object.attributes) ? object.attributes : []), { id: crypto.randomUUID(), ...body }];
  const { data, error } = await supabase.from("object_definitions").update({ attributes }).eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id")).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json(data, 201);
});
router.get("/settings/integrations", async (c) => {
  const workspaceId = c.get("workspaceId");
  const settings = await workspaceSettings(workspaceId);
  const connected = (settings.integrations ?? {}) as Record<string, boolean>;
  const [{ data: keys }, webhookNodes] = await Promise.all([
    supabase.from("api_keys").select("id, name, key_prefix, created_at").eq("workspace_id", workspaceId),
    rows("nodes", workspaceId, { objectType: "webhook" })
  ]);
  return c.json({
    integrations: ["gmail", "outlook", "slack", "zapier"].map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), connected: Boolean(connected[id]) })),
    api_keys: (keys ?? []).map((key) => ({ id: key.id, name: key.name, prefix: key.key_prefix, created_at: key.created_at })),
    webhooks: webhookNodes.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })),
    mcp_token: settings.mcp_token
  });
});
router.patch("/settings/integrations/:id", async (c) => {
  const body = await c.req.json<{ connected: boolean }>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  const integrations = (settings.integrations ?? {}) as Record<string, boolean>;
  await mergeWorkspaceSettings(c.get("workspaceId"), { integrations: { ...integrations, [c.req.param("id")]: body.connected } });
  return c.json({ ok: true });
});
router.post("/settings/integrations/api-keys", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const secret = `md_live_${crypto.randomUUID().replaceAll("-", "")}`;
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const { data, error } = await supabase.from("api_keys").insert({ workspace_id: c.get("workspaceId"), name: body.name ?? "API key", key_hash: hash, key_prefix: secret.slice(0, 12), created_by: c.get("userId") }).select("id, name, key_prefix, created_at").single();
  return error ? c.json({ error: error.message }, 400) : c.json({ id: data.id, name: data.name, prefix: data.key_prefix, secret }, 201);
});
router.delete("/settings/integrations/api-keys/:id", async (c) => {
  await supabase.from("api_keys").delete().eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id"));
  return c.json({ ok: true });
});
router.post("/settings/integrations/webhooks", async (c) => {
  const body = await c.req.json<{ url: string; events: string[] }>();
  const { data, error } = await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "webhook", data: body, created_by: c.get("userId") }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json({ id: data.id, ...data.data }, 201);
});
router.delete("/settings/integrations/webhooks/:id", async (c) => {
  await supabase.from("nodes").delete().eq("workspace_id", c.get("workspaceId")).eq("object_type", "webhook").eq("id", c.req.param("id"));
  return c.json({ ok: true });
});
router.post("/settings/integrations/mcp-token", async (c) => {
  const token = `mcp_${crypto.randomUUID().replaceAll("-", "")}`;
  await mergeWorkspaceSettings(c.get("workspaceId"), { mcp_token: token });
  return c.json({ token }, 201);
});
router.get("/settings/security", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  return c.json({
    saml_enabled: settings.saml_enabled ?? false,
    saml_domain: settings.saml_domain ?? "",
    export_restricted: settings.export_restricted ?? false,
    protected_recipients: settings.protected_recipients ?? [],
    sessions: []
  });
});
router.patch("/settings/security", async (c) => {
  const updates = await c.req.json<Record<string, unknown>>();
  await mergeWorkspaceSettings(c.get("workspaceId"), updates);
  return c.json({ ok: true });
});
router.delete("/settings/security/sessions/:id", (c) => c.json({ ok: true }));
router.get("/settings/email", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const integrations = (settings.integrations ?? {}) as Record<string, boolean>;
  return c.json({ providers: [{ id: "gmail", name: "Gmail", connected: Boolean(integrations.gmail) }, { id: "outlook", name: "Outlook", connected: Boolean(integrations.outlook) }] });
});
router.get("/billing", async (c) => {
  const { data } = await supabase.from("workspaces").select("plan").eq("id", c.get("workspaceId")).single();
  return c.json({ plan: data?.plan ?? "free", seats_used: 1, seats_limit: 3, invoices: [] });
});

router.post("/invites", async (c) => {
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", c.get("workspaceId")).eq("user_id", c.get("userId")).single();
  if (!membership || !["owner", "admin"].includes(membership.role)) return c.json({ error: "Admin authorization required." }, 403);
  const body = await c.req.json<{ email: string; role: string }>();
  const token = crypto.randomUUID();
  const invitation = { email: body.email, role: body.role, status: "pending", token, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
  const { data, error } = await supabase.from("nodes").insert({ workspace_id: c.get("workspaceId"), vertical: "shared", object_type: "workspace_invitation", data: invitation, created_by: c.get("userId") }).select().single();
  return error ? c.json({ error: error.message }, 400) : c.json({ id: data.id, ...invitation }, 201);
});
export { router as appDataRouter };
