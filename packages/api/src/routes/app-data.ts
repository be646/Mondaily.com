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

// ─── Workspace bootstrap ──────────────────────────────────────────────────────
// Called the first time /objects is fetched for a workspace.
// If no object_definitions exist yet, seeds 3 standard objects + 20 nodes each.

const BOOTSTRAP_OBJECTS = [
  {
    slug: "companies", name_singular: "Company", name_plural: "Companies", icon: "building2", color: "blue",
    attributes: [
      { id: "a1", name: "Company Name",  type: "text"   },
      { id: "a2", name: "Description",   type: "text"   },
      { id: "a3", name: "Estimated ARR", type: "number" },
      { id: "a4", name: "Funding Raised",type: "number" },
      { id: "a5", name: "Employee Range",type: "text"   },
      { id: "a6", name: "Country",       type: "text"   },
    ],
  },
  {
    slug: "people", name_singular: "Person", name_plural: "People", icon: "users", color: "purple",
    attributes: [
      { id: "b1", name: "Name",                  type: "text"   },
      { id: "b2", name: "Email",                 type: "text"   },
      { id: "b3", name: "Job Title",             type: "text"   },
      { id: "b4", name: "Twitter Follower Count",type: "number" },
      { id: "b5", name: "LinkedIn",              type: "text"   },
    ],
  },
  {
    slug: "deals", name_singular: "Deal", name_plural: "Deals", icon: "trending-up", color: "green",
    attributes: [
      { id: "c1", name: "Deal Name",  type: "text"   },
      { id: "c2", name: "Deal Stage", type: "text"   },
      { id: "c3", name: "Deal Value", type: "number" },
      { id: "c4", name: "Deal Owner", type: "text"   },
    ],
  },
] as const;

const SEED_NODES: Record<string, Array<Record<string, unknown>>> = {
  companies: [
    { name:"Stripe",       description:"Payments infrastructure for the internet",      arr:1_400_000_000, funding_raised:2_200_000_000, employee_range:"4001–7000",  country:"USA"         },
    { name:"Vercel",       description:"Frontend cloud & edge deployment platform",     arr:  150_000_000, funding_raised:  313_000_000, employee_range:"201–500",   country:"USA"         },
    { name:"Linear",       description:"Issue tracking for modern software teams",      arr:   40_000_000, funding_raised:   52_000_000, employee_range:"51–200",    country:"USA"         },
    { name:"Retool",       description:"Low-code platform for internal tools",          arr:   55_000_000, funding_raised:  145_000_000, employee_range:"201–500",   country:"USA"         },
    { name:"Figma",        description:"Collaborative interface design tool",           arr:  400_000_000, funding_raised:  333_000_000, employee_range:"501–1000",  country:"USA"         },
    { name:"Notion",       description:"All-in-one connected workspace",               arr:  320_000_000, funding_raised:  343_000_000, employee_range:"501–1000",  country:"USA"         },
    { name:"Supabase",     description:"Open source Firebase alternative",             arr:   30_000_000, funding_raised:  116_000_000, employee_range:"51–200",    country:"Singapore"   },
    { name:"Loom",         description:"Async video messaging for work",               arr:   90_000_000, funding_raised:  203_000_000, employee_range:"201–500",   country:"USA"         },
    { name:"Planetscale",  description:"Serverless MySQL-compatible database",          arr:   25_000_000, funding_raised:  105_000_000, employee_range:"51–200",    country:"USA"         },
    { name:"Clerk",        description:"Authentication & user management APIs",        arr:   18_000_000, funding_raised:   67_000_000, employee_range:"51–200",    country:"USA"         },
    { name:"Resend",       description:"Email API for developers",                     arr:    8_000_000, funding_raised:   20_000_000, employee_range:"11–50",     country:"USA"         },
    { name:"Railway",      description:"Deploy code, databases and apps instantly",    arr:   12_000_000, funding_raised:   24_000_000, employee_range:"11–50",     country:"Canada"      },
    { name:"Miro",         description:"Online collaborative whiteboard platform",      arr:  450_000_000, funding_raised:  476_000_000, employee_range:"1001–2000", country:"Netherlands" },
    { name:"Descript",     description:"AI-powered video and podcast editor",          arr:   35_000_000, funding_raised:  100_000_000, employee_range:"201–500",   country:"USA"         },
    { name:"Hex",          description:"Modern data workspace for teams",              arr:   22_000_000, funding_raised:   56_000_000, employee_range:"51–200",    country:"USA"         },
    { name:"Airbyte",      description:"Open-source data integration platform",        arr:   45_000_000, funding_raised:  181_000_000, employee_range:"201–500",   country:"USA"         },
    { name:"Hasura",       description:"Instant GraphQL & REST APIs on your database", arr:   30_000_000, funding_raised:  100_000_000, employee_range:"201–500",   country:"USA"         },
    { name:"Tally",        description:"Beautifully simple form builder",              arr:    5_000_000, funding_raised:    2_500_000, employee_range:"11–50",     country:"Belgium"     },
    { name:"Raycast",      description:"Supercharged Mac productivity launcher",       arr:   15_000_000, funding_raised:   30_000_000, employee_range:"51–200",    country:"Germany"     },
    { name:"Cal.com",      description:"Open-source scheduling infrastructure",        arr:    6_000_000, funding_raised:   32_000_000, employee_range:"11–50",     country:"USA"         },
  ],
  people: [
    { name:"Guillermo Rauch",  email:"g@vercel.com",           job_title:"CEO & Co-founder",          twitter_followers:420_000, linkedin:"linkedin.com/in/rauchg"            },
    { name:"Patrick Collison", email:"patrick@stripe.com",     job_title:"CEO & Co-founder",          twitter_followers:380_000, linkedin:"linkedin.com/in/patrickcollison"   },
    { name:"Dylan Field",      email:"dylan@figma.com",        job_title:"CEO & Co-founder",          twitter_followers:210_000, linkedin:"linkedin.com/in/dylanfield"        },
    { name:"Ivan Zhao",        email:"ivan@notion.so",         job_title:"CEO & Co-founder",          twitter_followers: 95_000, linkedin:"linkedin.com/in/ivanhzhao"         },
    { name:"Karri Saarinen",   email:"karri@linear.app",       job_title:"CEO & Co-founder",          twitter_followers:130_000, linkedin:"linkedin.com/in/karrisaarinen"     },
    { name:"Paul Copplestone", email:"paul@supabase.io",       job_title:"CEO & Co-founder",          twitter_followers: 72_000, linkedin:"linkedin.com/in/paulcopplestone"   },
    { name:"David Hsu",        email:"david@retool.com",       job_title:"CEO & Co-founder",          twitter_followers: 41_000, linkedin:"linkedin.com/in/david-hsu-retool"  },
    { name:"Sarah Chen",       email:"s.chen@vercel.com",      job_title:"VP of Engineering",         twitter_followers: 18_400, linkedin:"linkedin.com/in/sarahchen"         },
    { name:"Marcus Rivera",    email:"m.rivera@linear.app",    job_title:"Head of Product",           twitter_followers:  9_200, linkedin:"linkedin.com/in/mrivera"           },
    { name:"Priya Nair",       email:"priya@notion.so",        job_title:"Growth Lead",               twitter_followers:  6_700, linkedin:"linkedin.com/in/priyanair"         },
    { name:"Tom Eriksson",     email:"tom@figma.com",          job_title:"Senior Product Designer",   twitter_followers: 24_100, linkedin:"linkedin.com/in/tomeriksson"       },
    { name:"Yuki Tanaka",      email:"yuki@retool.com",        job_title:"Solutions Engineer",        twitter_followers:  3_900, linkedin:"linkedin.com/in/yukitanaka"        },
    { name:"Amara Osei",       email:"amara@supabase.io",      job_title:"Developer Advocate",        twitter_followers: 11_500, linkedin:"linkedin.com/in/amaraosei"         },
    { name:"Jake Whitmore",    email:"jake@loom.com",          job_title:"Account Executive",         twitter_followers:  2_300, linkedin:"linkedin.com/in/jakewhitmore"      },
    { name:"Diana Popescu",    email:"diana@planetscale.com",  job_title:"Engineering Manager",       twitter_followers:  7_800, linkedin:"linkedin.com/in/dianapopescu"      },
    { name:"James Liu",        email:"james@clerk.dev",        job_title:"Developer Relations Lead",  twitter_followers: 15_200, linkedin:"linkedin.com/in/jamesliu"          },
    { name:"Nina Braun",       email:"nina@raycast.com",       job_title:"Head of Design",            twitter_followers:  8_900, linkedin:"linkedin.com/in/ninabraun"         },
    { name:"Léa Fontaine",     email:"lea@cal.com",            job_title:"Community Manager",         twitter_followers:  4_100, linkedin:"linkedin.com/in/leafontaine"       },
    { name:"Ravi Sharma",      email:"ravi@airbyte.com",       job_title:"Senior Data Engineer",      twitter_followers:  5_600, linkedin:"linkedin.com/in/ravisharma"        },
    { name:"Chloe Andersen",   email:"chloe@hex.tech",         job_title:"Product Marketing Manager", twitter_followers:  3_300, linkedin:"linkedin.com/in/chloeandersen"     },
  ],
  deals: [
    { name:"Stripe Enterprise Expansion",    deal_stage:"Closed Won",  deal_value:480_000, deal_owner:"Sarah Chen"     },
    { name:"Figma Design Ops Bundle",        deal_stage:"Negotiation", deal_value:240_000, deal_owner:"Priya Nair"     },
    { name:"Vercel Pro Fleet Upgrade",       deal_stage:"Proposal",    deal_value:185_000, deal_owner:"Marcus Rivera"  },
    { name:"Notion Workspace Scale",         deal_stage:"In Progress", deal_value:120_000, deal_owner:"Jake Whitmore"  },
    { name:"Linear Dev Team Expansion",      deal_stage:"Qualified",   deal_value: 56_000, deal_owner:"Marcus Rivera"  },
    { name:"Retool Internal Tools Rollout",  deal_stage:"In Progress", deal_value: 98_500, deal_owner:"Amara Osei"     },
    { name:"Supabase Scale-Up Plan",         deal_stage:"Lead",        deal_value: 42_000, deal_owner:"Tom Eriksson"   },
    { name:"Loom Video Platform",            deal_stage:"Closed Won",  deal_value:115_000, deal_owner:"Jake Whitmore"  },
    { name:"Planetscale DB Migration",       deal_stage:"Closed Lost", deal_value: 88_000, deal_owner:"Diana Popescu"  },
    { name:"Clerk Auth Integration",         deal_stage:"Lead",        deal_value: 28_000, deal_owner:"James Liu"      },
    { name:"Miro Whiteboard Enterprise",     deal_stage:"Proposal",    deal_value:310_000, deal_owner:"Priya Nair"     },
    { name:"Airbyte Data Pipeline",          deal_stage:"In Progress", deal_value: 74_000, deal_owner:"Ravi Sharma"    },
    { name:"Raycast Team Licence",           deal_stage:"Lead",        deal_value: 18_500, deal_owner:"Nina Braun"     },
    { name:"Resend Transactional Email",     deal_stage:"Closed Won",  deal_value: 32_000, deal_owner:"Chloe Andersen" },
    { name:"Hex Analytics Workspace",        deal_stage:"Qualified",   deal_value: 55_000, deal_owner:"Ravi Sharma"    },
    { name:"Cal.com Scheduling Suite",       deal_stage:"Negotiation", deal_value: 22_000, deal_owner:"Léa Fontaine"   },
    { name:"Hasura GraphQL Platform",        deal_stage:"Closed Lost", deal_value: 67_000, deal_owner:"Sarah Chen"     },
    { name:"Descript Podcast Toolkit",       deal_stage:"In Progress", deal_value: 48_000, deal_owner:"Jake Whitmore"  },
    { name:"Tally Forms Enterprise",         deal_stage:"Closed Won",  deal_value: 15_000, deal_owner:"Léa Fontaine"   },
    { name:"Railway Infrastructure Upgrade", deal_stage:"Lead",        deal_value: 38_000, deal_owner:"Marcus Rivera"  },
  ],
};

async function bootstrapWorkspace(workspaceId: string, createdBy: string) {
  // Only runs if this workspace has zero object_definitions
  const { count } = await supabase
    .from("object_definitions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if ((count ?? 0) > 0) return; // already bootstrapped

  // Insert the 3 object definitions
  const { data: defs, error: defErr } = await supabase
    .from("object_definitions")
    .insert(
      BOOTSTRAP_OBJECTS.map(obj => ({
        workspace_id: workspaceId,
        vertical: "shared",
        slug: obj.slug,
        name_singular: obj.name_singular,
        name_plural: obj.name_plural,
        icon: obj.icon,
        color: obj.color,
        is_standard: true,
        attributes: obj.attributes,
      }))
    )
    .select();

  if (defErr || !defs?.length) return; // silently skip on error
  // New workspaces start empty — no demo seed data inserted.
}

router.get("/objects", async (c) => {
  await bootstrapWorkspace(c.get("workspaceId"), c.get("userId"));
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
  // Insert first to get the ID, then inject tracking pixel referencing that ID
  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: c.get("workspaceId"),
    vertical: "sales",
    object_type: "email_outbox",
    data: { ...body, status: "queued", requested_at: new Date().toISOString(), opens: [], clicks: [] },
    created_by: c.get("userId")
  }).select().single();
  if (error) return c.json({ error: error.message }, 400);

  const apiBase = process.env.API_BASE_URL ?? "https://mondaily-api.onrender.com";
  const pixel = `<img src="${apiBase}/api/v1/emails/track/${data.id}/open.gif" width="1" height="1" style="display:block;width:1px;height:1px;opacity:0;" alt=""/>`;
  const trackedBody = body.body.includes("</body>")
    ? body.body.replace("</body>", `${pixel}</body>`)
    : body.body + pixel;
  // Update with tracked body
  await supabase.from("nodes").update({ data: { ...body, status: "queued", requested_at: new Date().toISOString(), opens: [], clicks: [], tracked_body: trackedBody } }).eq("id", data.id);

  await supabase.from("activities").insert({
    node_id: data.id,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: "email_queued",
    diff: { to: body.to, subject: body.subject }
  });
  return c.json({ id: data.id, status: "queued", tracked_body: trackedBody }, 202);
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
  const { data } = await supabase
    .from("nodes")
    .select("id,data,updated_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "automation")
    .order("updated_at", { ascending: false });
  return c.json((data ?? []).map((node) => ({
    id: node.id,
    updated_at: node.updated_at,
    ...(node.data as Record<string, unknown>),
  })));
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
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  return c.json({
    name: data?.name ?? "",
    timezone: settings.timezone ?? "UTC",
    modules: (settings.modules as string[] | undefined) ?? ["crm"],
  });
});
router.patch("/settings/workspace", async (c) => {
  const body = await c.req.json<{ name?: string; timezone?: string; modules?: string[] }>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  await supabase.from("workspaces").update({
    name: body.name,
    settings: {
      ...settings,
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.modules !== undefined ? { modules: body.modules } : {}),
    },
  }).eq("id", c.get("workspaceId"));
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
router.delete("/settings/objects/:id", async (c) => {
  const id = c.req.param("id");
  const wid = c.get("workspaceId");
  // Get the slug so we can delete all nodes of that object_type
  const { data: obj } = await supabase.from("object_definitions").select("slug").eq("workspace_id", wid).eq("id", id).single();
  if (!obj) return c.json({ error: "Object not found" }, 404);
  // Delete all nodes of this type, then the definition
  await supabase.from("nodes").delete().eq("workspace_id", wid).eq("object_type", obj.slug);
  const { error } = await supabase.from("object_definitions").delete().eq("workspace_id", wid).eq("id", id);
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
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
router.get("/settings/tax-codes", requireAuth, async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const defaults = [
    { id: "vat_20", name: "VAT 20%", rate: 20 },
    { id: "vat_5",  name: "VAT 5%",  rate: 5  },
    { id: "exempt", name: "Exempt",   rate: 0  },
    { id: "zero",   name: "Zero rated", rate: 0 },
  ];
  const custom = (settings.tax_codes as { id: string; name: string; rate: number }[] | undefined) ?? [];
  return c.json([...defaults, ...custom]);
});
router.post("/settings/tax-codes", requireAuth, async (c) => {
  const body = await c.req.json<{ name: string; rate: number }>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  const existing = (settings.tax_codes as { id: string; name: string; rate: number }[] | undefined) ?? [];
  const newCode = { id: `custom_${Date.now()}`, name: body.name, rate: body.rate };
  await supabase.from("workspaces").update({ settings: { ...settings, tax_codes: [...existing, newCode] } }).eq("id", c.get("workspaceId"));
  return c.json(newCode, 201);
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
