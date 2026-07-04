import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { deleteCookie, getCookie } from "hono/cookie";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { makeTrackingToken } from "../lib/tracking";
import { isWorkspaceAdmin } from "../middleware/rbac";
import { ACCESS_COOKIE, REFRESH_COOKIE, sha256 } from "../lib/auth-tokens";
import { MODULE_KEYS, resolveModuleMatrix, enabledModules } from "../lib/modules";
import { reconcileIncludedCredits } from "../lib/credits";
import { PLAN_TIERS } from "@mondaily/shared/pricing";
import { planLimits } from "../lib/plan-limits";
import { resolveEntitlement, getEntitlement } from "../lib/entitlements";
import {
  resolveProfile, mergeProfile, discoverySuggestions, askStarterPrompts, profileObjects, profileTerms,
  discoveryPlaceholder, discoveryNextSuggestions, broadQueryRefinements, deepResearchPhrasing,
  objectCreationExamples, listExamples, tableNlpExamples, importExamples, homeQuickPrompts,
  profileRecommendations, type WorkspaceProfile,
} from "@mondaily/shared/profile";

// Seat limit for a workspace — resolved entitlement tier → catalog seats (the ONE source). Scout 1,
// Operator 5, Command 20, Sovereign 999. Used by both /settings/members (can_invite) and /billing.
const seatLimitFor = (settings: Record<string, unknown> | null | undefined, planColumn?: string | null) =>
  PLAN_TIERS[resolveEntitlement(settings, planColumn).tier].seats;

// Keep only known module keys with a valid level — never trust arbitrary jsonb from the client.
function sanitizeModuleAccess(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of MODULE_KEYS) {
    const v = input[k];
    if (v === "none" || v === "view" || v === "edit") out[k] = v;
  }
  return out;
}

// Parse a coarse device + browser label out of a User-Agent string (no third-party UA lib).
function parseUA(ua: string | null | undefined): { device: string; browser: string } {
  const s = ua ?? "";
  const device = /iphone|ipad|ipod/i.test(s) ? "iOS" : /android/i.test(s) ? "Android"
    : /mac os x|macintosh/i.test(s) ? "macOS" : /windows/i.test(s) ? "Windows"
    : /linux/i.test(s) ? "Linux" : "Unknown device";
  const browser = /edg\//i.test(s) ? "Edge" : /chrome|crios/i.test(s) ? "Chrome"
    : /firefox|fxios/i.test(s) ? "Firefox" : /safari/i.test(s) && !/chrome/i.test(s) ? "Safari"
    : "Browser";
  return { device, browser };
}
// Obfuscate the last octet of an IPv4 (privacy): 192.168.1.42 → 192.168.1.XX. IPv6 → truncate.
function maskIp(ip: string | null | undefined): string {
  if (!ip) return "Hidden";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":…";
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.XX` : ip;
}
function relTime(iso: string | null | undefined): string {
  if (!iso) return "Now";
  const d = new Date(iso); if (isNaN(d.getTime())) return "Now";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 90) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type AppVariables = { userId: string; workspaceId: string; role: string; financeRole: string; moduleAccess: Record<string, string> };
const router = new Hono<{ Variables: AppVariables }>();
router.use("*", requireAuth);

// GET /me/access — the CURRENT user's effective per-module levels + which modules the workspace
// has enabled. The sidebar uses this to hide nav for modules the operator can't reach (so there
// are no dead 403 links), keeping the UI in lockstep with backend enforcement.
router.get("/me/access", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [{ data: wsRow }, { data: member }] = await Promise.all([
    supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
    // DB-authoritative identity (the session name/email can be sparse on restore) — used as a
    // fallback for the display-name resolver so greetings never degrade to "there".
    supabase.from("workspace_members").select("name, email").eq("workspace_id", workspaceId).eq("user_id", c.get("userId")).maybeSingle(),
  ]);
  const settings = (wsRow?.settings as Record<string, unknown> | null) ?? {};
  const wsModules = (settings.modules as string[] | undefined) ?? [];
  const tier = resolveEntitlement(settings).tier;   // single source of truth
  return c.json({
    role: c.get("role"),
    tier,
    name: (member as { name?: string } | null)?.name ?? null,
    email: (member as { email?: string } | null)?.email ?? null,
    limits: planLimits(tier),                 // { maxAutomations, maxAgents } — -1 = unlimited
    seats_limit: seatLimitFor(settings),
    enabled_modules: enabledModules(wsModules).map((m) => m.key),
    access: resolveModuleMatrix(c.get("role"), c.get("moduleAccess"), c.get("financeRole")),
  });
});

// ── Central RBAC gate for workspace-administration settings ───────────────────
// Any WRITE under these /settings/* areas requires owner/admin. Reads stay open,
// and self-service areas (the user's own account / sessions) are exempt. This
// closes the gaps where member/object/integration/webhook mutations were
// callable by any workspace member (privilege escalation).
const ADMIN_SETTINGS_AREAS = [
  "/settings/workspace", "/settings/members", "/settings/teams",
  "/settings/objects", "/settings/integrations", "/settings/security", "/settings/general",
];
router.use("/settings/*", async (c, next) => {
  const m = c.req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  const path = c.req.path;
  // Self-service: a user may always manage their OWN account + sessions.
  if (path.includes("/settings/account") || path.includes("/settings/security/sessions")) return next();
  if (ADMIN_SETTINGS_AREAS.some((p) => path.includes(p)) && !isWorkspaceAdmin(c.get("role"))) {
    return c.json({ error: "Forbidden — owner or admin role required." }, 403);
  }
  return next();
});

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
  // Set BOTH is_read + read_at so the bell's unread count (which keys on is_read) stays in sync.
  await supabase.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id"));
  return c.json({ ok: true });
});
router.post("/notifications/read-all", async (c) => {
  await supabase.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("workspace_id", c.get("workspaceId")).eq("is_read", false);
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

  const apiBase = process.env.API_BASE_URL ?? "https://api.mondaily.com";
  const trackToken = makeTrackingToken(data.id);
  const pixel = `<img src="${apiBase}/api/v1/emails/track/${trackToken}/open.gif" width="1" height="1" style="display:block;width:1px;height:1px;opacity:0;" alt=""/>`;
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
    // Return ALL stored prefs (job_title, notifications map, ai_* personalization, etc.) so every
    // saved field hydrates back — previously only a fixed subset was returned, so job title and the
    // notifications matrix silently reset on reload.
    ...userPreferences,
    email_notifications: userPreferences.email_notifications ?? true,
    agent_notifications: userPreferences.agent_notifications ?? true,
    task_notifications: userPreferences.task_notifications ?? true,
    appearance: userPreferences.appearance ?? "dark",
    language: userPreferences.language ?? null,   // per-user AI language override (falls back to workspace)
    connected_accounts: userPreferences.connected_accounts ?? []
  });
});
router.patch("/settings/account", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  const preferences = (settings.user_preferences ?? {}) as Record<string, unknown>;
  const existing = (preferences[c.get("userId")] ?? {}) as Record<string, unknown>;
  // MERGE into existing prefs (don't replace) so a partial save can't wipe other settings.
  await mergeWorkspaceSettings(c.get("workspaceId"), {
    user_preferences: { ...preferences, [c.get("userId")]: { ...existing, ...body } }
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
  const workspaceId = c.get("workspaceId");
  const [{ data }, { count: memberCount }] = await Promise.all([
    supabase.from("workspaces").select("name, slug, settings, onboarded, timezone, logo_url").eq("id", workspaceId).single(),
    supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  return c.json({
    name: data?.name ?? "",
    slug: (data as Record<string, unknown> | null)?.slug ?? "",
    timezone: (data as Record<string, unknown> | null)?.timezone ?? settings.timezone ?? "UTC",
    logo_url: (data as Record<string, unknown> | null)?.logo_url ?? null,
    onboarded: (data as Record<string, unknown> | null)?.onboarded ?? false,
    member_count: memberCount ?? 1,
    modules: (settings.modules as string[] | undefined) ?? ["crm"],
    // Industry-aware profile — resolved (falls back to legacy onboarding fields for old workspaces).
    profile: resolveProfile(settings),
  });
});

// GET /workspace/suggestions — industry-aware examples/prompts derived from the workspace profile.
// One source for Discovery examples, Ask starter prompts, canonical object nouns and preferred terms.
// Empty/near-empty profiles yield neutral generic suggestions, so it's always safe to render.
router.get("/workspace/suggestions", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const profile = resolveProfile(settings);
  // Effective language: this user's override → workspace profile language → English. Dynamic
  // suggestions are generated in that language (frames translated, profile data kept verbatim).
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[c.get("userId")]?.language;
  const lang = userLang || profile.language || "en";
  return c.json({
    profile,
    language: lang,
    // Discovery
    discovery: discoverySuggestions(profile, 4, lang),
    discovery_placeholder: discoveryPlaceholder(profile, lang),
    discovery_next: discoveryNextSuggestions(profile, 3, lang),
    deep_research: deepResearchPhrasing(profile),
    // Ask + Home
    ask: askStarterPrompts(profile, 4, lang),
    home: homeQuickPrompts(profile, lang),
    // Builders (objects / lists / tables / import)
    objects: profileObjects(profile),
    object_examples: objectCreationExamples(profile),
    list_examples: listExamples(profile),
    table_examples: tableNlpExamples(profile),
    import_examples: importExamples(profile),
    // Terms + recommendations (recommendations are surfaced, never auto-created)
    terms: profileTerms(profile),
    recommendations: profileRecommendations(profile),
  });
});

// GET /workspace/refine?q=... — broad-query refinements for Discovery (narrow by region/customer/signal).
router.get("/workspace/refine", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const profile = resolveProfile(settings);
  const userLang = (settings.user_preferences as Record<string, { language?: string }> | undefined)?.[c.get("userId")]?.language;
  const lang = userLang || profile.language || "en";
  return c.json({ refinements: broadQueryRefinements(profile, c.req.query("q") ?? "", 3, lang) });
});

// Persist a data:-URL logo into Supabase Storage and return its public URL. Login-safe & resilient:
// if the bucket is missing or upload fails, the caller falls back to storing the data URL inline.
async function persistLogo(workspaceId: string, dataUrl: string): Promise<string | null> {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1] ?? "image/png";
  const b64 = m[2] ?? "";
  const ext = contentType.split("/")[1]?.replace("+xml", "").replace("jpeg", "jpg") ?? "png";
  const buffer = new Uint8Array(Buffer.from(b64, "base64"));
  const path = `${workspaceId}/logo.${ext}`;
  const { error } = await supabase.storage.from("workspace-logos").upload(path, buffer, { contentType, upsert: true });
  if (error) return null;
  // Cache-bust so the new logo shows immediately.
  const { data } = supabase.storage.from("workspace-logos").getPublicUrl(path);
  return data?.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : null;
}

router.patch("/settings/workspace", async (c) => {
  const wid = c.get("workspaceId");
  const body = await c.req.json<{ name?: string; slug?: string; timezone?: string; modules?: string[]; logo_url?: string; profile?: Partial<WorkspaceProfile> }>();
  const settings = await workspaceSettings(wid);
  // Merge any profile patch onto the resolved profile so partial edits don't wipe other fields.
  const nextProfile = body.profile !== undefined ? mergeProfile(resolveProfile(settings), body.profile) : undefined;
  const update: Record<string, unknown> = {
    settings: {
      ...settings,
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.modules !== undefined ? { modules: body.modules } : {}),
      ...(nextProfile !== undefined ? { profile: nextProfile } : {}),
    },
  };
  if (body.name !== undefined) update.name = body.name;

  // Slug: normalize, then enforce global uniqueness across tenants before committing.
  if (body.slug !== undefined) {
    const slug = body.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug.length < 2) return c.json({ error: "Workspace URL must be at least 2 characters." }, 400);
    const { data: taken } = await supabase.from("workspaces").select("id").eq("slug", slug).neq("id", wid).maybeSingle();
    if (taken) return c.json({ error: `The URL "${slug}" is already taken. Choose another.` }, 409);
    update.slug = slug;
  }

  // Logo: upload data:-URLs to Storage; keep hosted URLs as-is; clear on empty.
  if (body.logo_url !== undefined) {
    if (body.logo_url?.startsWith("data:")) {
      update.logo_url = (await persistLogo(wid, body.logo_url)) ?? body.logo_url; // fallback: inline data URL
    } else {
      update.logo_url = body.logo_url || null;
    }
  }

  const { error } = await supabase.from("workspaces").update(update).eq("id", wid);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, slug: update.slug ?? undefined, logo_url: update.logo_url ?? undefined });
});

// PATCH /settings/profile — the current user updates THEIR OWN name / avatar. Not an admin
// area (any member may edit their own profile). avatar_url accepts a hosted URL or a data: URL.
// Writes across all of this user's workspace_members rows so the profile is consistent everywhere.
router.patch("/settings/profile", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: string; avatar_url?: string }>().catch(() => ({} as { name?: string; avatar_url?: string }));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.avatar_url === "string") patch.avatar_url = body.avatar_url || null;
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update." }, 400);
  const { error } = await supabase.from("workspace_members").update(patch).eq("user_id", userId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, ...patch });
});

// DELETE /settings/workspace — owner-only. Cascade-purges the workspace's data, deletes the
// workspace, and clears the caller's session cookies. (Admin-area write → middleware already
// requires admin; we additionally require the strict 'owner' role.)
router.delete("/settings/workspace", async (c) => {
  const ws = c.get("workspaceId");
  const userId = c.get("userId");
  const { data: m } = await supabase.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", userId).maybeSingle();
  if (m?.role !== "owner") return c.json({ error: "Only the workspace owner can delete this workspace." }, 403);

  // Best-effort per-table purge (a table that doesn't exist just no-ops), children before parents.
  const tables = [
    "activities", "agent_jobs", "decision_queue", "notifications", "ai_usage", "discovered_leads",
    "chat_threads", "email_connections", "workflows", "sequences", "lists", "notes",
    "invoices", "credit_notes", "quotes", "expenses", "reports", "dashboards",
    "edges", "nodes", "workspace_members",
  ];
  for (const t of tables) {
    await supabase.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
  }
  const { error } = await supabase.from("workspaces").delete().eq("id", ws);
  if (error) return c.json({ error: `Could not delete workspace: ${error.message}` }, 500);

  deleteCookie(c, ACCESS_COOKIE, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/api/v1/auth" });
  return c.json({ ok: true });
});

router.get("/settings/members", async (c) => {
  const workspaceId = c.get("workspaceId");
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: members }, { data: teams }, { data: inviteRows }, { data: usage }, { data: wsRow }] = await Promise.all([
    supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId),
    supabase.from("teams").select("*, team_members(user_id)").eq("workspace_id", workspaceId),
    // Read pending invites from the SAME table POST /invites writes to (workspace_invites) —
    // previously this read from nodes/workspace_invitation, so sent invites never appeared.
    supabase.from("workspace_invites")
      .select("id, email, role, finance_role, created_at, expires_at")
      .eq("workspace_id", workspaceId).is("accepted_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    // Per-operator AI telemetry (30d) so the Members matrix shows real compute consumption.
    supabase.from("ai_usage").select("user_id, total_tokens").eq("workspace_id", workspaceId).gte("created_at", sinceIso),
    supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
  ]);
  // Last-active per member — filtered to THIS workspace's members (was an unfiltered full-table scan
  // of every session system-wide, which made this endpoint slow).
  const memberIds = (members ?? []).map((m) => String(m.user_id));
  const { data: sessions } = memberIds.length
    ? await supabase.from("auth_refresh_tokens").select("user_id, last_active_at").is("revoked_at", null).in("user_id", memberIds)
    : { data: [] as { user_id: string; last_active_at: string | null }[] };
  // Only expose modules this workspace actually has enabled (core + enabled optional) so the
  // Members matrix and the Workspace → Modules toggles stay in lockstep (one taxonomy).
  const wsModules = ((wsRow?.settings as { modules?: string[] } | null)?.modules) ?? [];
  const activeModules = enabledModules(wsModules);
  // Enrich missing profile fields from auth_credentials so a member row never shows a raw usr_ id.
  const emailByUser = new Map<string, string>();
  const missing = (members ?? []).filter((m) => !m.name || !m.email).map((m) => String(m.user_id));
  if (missing.length) {
    const { data: creds } = await supabase.from("auth_credentials").select("user_id, email").in("user_id", missing);
    for (const cr of creds ?? []) { if (cr.email) emailByUser.set(String(cr.user_id), String(cr.email)); }
  }
  // Human display name: real name → email → email local-part → "Operator" (NEVER the usr_ id).
  const displayName = (m: { name?: string | null; email?: string | null; user_id: string }) => {
    const email = m.email || emailByUser.get(String(m.user_id)) || "";
    if (m.name && m.name.trim()) return m.name;
    if (email) return email.split("@")[0]!.replace(/[._]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
    return "Operator";
  };
  const tokensBy = new Map<string, number>();
  for (const u of usage ?? []) { const k = String(u.user_id ?? ""); if (k) tokensBy.set(k, (tokensBy.get(k) ?? 0) + Number(u.total_tokens ?? 0)); }
  const lastActiveBy = new Map<string, string>();
  for (const s of sessions ?? []) {
    const k = String(s.user_id ?? ""); const t = s.last_active_at as string | null;
    if (k && t && (!lastActiveBy.has(k) || t > lastActiveBy.get(k)!)) lastActiveBy.set(k, t);
  }
  return c.json({
    // Authoritative role of the *requesting* user, straight from the auth context — so the UI
    // never has to guess by matching ids/emails (which was hiding the invite bar for owners).
    my_role: c.get("role"),
    // Invites only make sense on multi-operator tiers (Command/Sovereign). Scout/Operator are single.
    can_invite: seatLimitFor(wsRow?.settings as Record<string, unknown> | null) > 1,
    seats_limit: seatLimitFor(wsRow?.settings as Record<string, unknown> | null),
    // Catalog of ENABLED feature-modules so the Members matrix renders columns without hardcoding
    // and never shows a module the workspace has switched off.
    modules: activeModules,
    members: (members ?? []).map((member) => {
      const access = (member as Record<string, unknown>).module_access as Record<string, string> | null;
      return {
        id: member.user_id,
        name: displayName(member),
        email: member.email || emailByUser.get(String(member.user_id)) || "",
        image_url: member.avatar_url ?? null,
        avatar_url: member.avatar_url ?? null,
        role: member.role,
        finance_role: member.finance_role ?? "none",
        // Effective per-module levels (role defaults + finance_role folded in + explicit overrides).
        module_access: resolveModuleMatrix(member.role, access, (member.finance_role ?? "none") as string),
        position: member.position ?? null,
        tokens: tokensBy.get(String(member.user_id)) ?? 0,
        last_active: lastActiveBy.get(String(member.user_id)) ?? null,
        status: "active",
      };
    }),
    invitations: (inviteRows ?? []).map((i) => ({
      id: i.id, email: i.email, role: i.role,
      finance_role: (i as Record<string, unknown>).finance_role ?? "none",
      module_access: resolveModuleMatrix(i.role as string, (i as Record<string, unknown>).module_access as Record<string, string> | null, ((i as Record<string, unknown>).finance_role ?? "none") as string),
      created_at: i.created_at,
    })),
    teams: (teams ?? []).map((team) => ({ id: team.id, name: team.name, member_count: team.team_members?.length ?? 0, member_ids: team.team_members?.map((item: { user_id: string }) => item.user_id) ?? [] }))
  });
});
// Update a member's workspace role and/or finance access (consolidated — the Members page owns both).
router.patch("/settings/members/:id", async (c) => {
  // Only owners/admins can change roles or module access.
  if (!["owner", "admin"].includes(c.get("role"))) return c.json({ error: "Only owners and admins can update members" }, 403);
  const body = await c.req.json<{ role?: string; finance_role?: string; module_access?: Record<string, string>; module?: string; level?: string }>().catch(() => ({} as Record<string, never>));
  const patch: Record<string, unknown> = {};
  if (body.role) patch.role = body.role;
  if (body.finance_role) patch.finance_role = body.finance_role;
  // Accept either a full module_access map, or a single {module, level} cell update (merged in).
  if (body.module_access && typeof body.module_access === "object") {
    patch.module_access = sanitizeModuleAccess(body.module_access);
  } else if (body.module && MODULE_KEYS.includes(body.module) && ["none", "view", "edit"].includes(body.level ?? "")) {
    const { data: cur } = await supabase.from("workspace_members").select("module_access").eq("workspace_id", c.get("workspaceId")).eq("user_id", c.req.param("id")).maybeSingle();
    const merged = { ...((cur?.module_access as Record<string, string>) ?? {}), [body.module]: body.level! };
    patch.module_access = sanitizeModuleAccess(merged);
  }
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to update" }, 400);
  const { error } = await supabase.from("workspace_members").update(patch).eq("workspace_id", c.get("workspaceId")).eq("user_id", c.req.param("id"));
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
// Naive English pluralization fallback — only used if the caller didn't supply a plural. A bare
// `name + "s"` (the old behavior) turned "Company" into "Companys" and "Property" into "Propertys".
function pluralize(word: string): string {
  const w = word.trim();
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + "es";
  return w + "s";
}
router.post("/settings/objects", zValidator("json", z.object({
  name: z.string().min(1),                 // singular (kept for back-compat with older callers)
  singular: z.string().min(1).optional(),
  plural: z.string().min(1).optional(),
  slug: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  vertical: z.enum(["sales", "realestate", "hr", "finance", "investments", "shared"]).optional(),
})), async (c) => {
  const body = c.req.valid("json");
  // The create-object modal collects singular + plural + icon + color + vertical, but this route
  // previously only read `name`/`slug` — icon, color, vertical, and the real singular were silently
  // dropped, and name_plural was set equal to name_singular ("Investments"/"Investments" in prod).
  const singular = body.singular ?? body.name;
  const plural = body.plural ?? pluralize(singular);
  const { data, error } = await supabase.from("object_definitions").insert({
    workspace_id: c.get("workspaceId"),
    vertical: body.vertical ?? "shared",
    slug: body.slug,
    name_singular: singular,
    name_plural: plural,
    icon: body.icon || "circle",
    color: body.color || "gray",
    attributes: [],
  }).select().single();
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
  const profiles = (settings.integration_profiles ?? {}) as Record<string, unknown>;
  return c.json({
    integrations: ["gmail", "outlook", "slack", "zapier", "google-calendar"].map((id) => ({
      id, name: id.charAt(0).toUpperCase() + id.slice(1), connected: Boolean(connected[id]), profile: profiles[id] ?? null,
    })),
    api_keys: (keys ?? []).map((key) => ({ id: key.id, name: key.name, prefix: key.key_prefix, created_at: key.created_at })),
    webhooks: webhookNodes.map((node: Record<string, unknown>) => ({ id: node.id, ...((node.data as Record<string, unknown>) ?? {}) })),
    mcp_token: settings.mcp_token
  });
});
// Plausible scope sets so a connected profile reads like a real OAuth grant.
const MOCK_SCOPES: Record<string, string[]> = {
  gmail: ["mail.read", "mail.send"],
  outlook: ["Mail.ReadWrite", "Calendars.Read"],
  slack: ["chat:write", "channels:read"],
  "google-calendar": ["calendar.events", "calendar.readonly"],
  zapier: ["zap.trigger"],
};
router.patch("/settings/integrations/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ connected: boolean }>();
  const settings = await workspaceSettings(c.get("workspaceId"));
  const integrations = (settings.integrations ?? {}) as Record<string, boolean>;
  const profiles = { ...((settings.integration_profiles ?? {}) as Record<string, unknown>) };
  if (body.connected) {
    // Write a placeholder connection profile so the panel can render "connected as …" detail.
    profiles[id] = {
      account: `${id.replace(/[^a-z0-9]/g, "")}.workspace@${id === "slack" ? "slack" : id === "zapier" ? "zapier" : "connected"}.app`,
      connected_at: new Date().toISOString(),
      scopes: MOCK_SCOPES[id] ?? ["read"],
    };
  } else {
    delete profiles[id];
  }
  await mergeWorkspaceSettings(c.get("workspaceId"), {
    integrations: { ...integrations, [id]: body.connected },
    integration_profiles: profiles,
  });
  return c.json({ ok: true, profile: profiles[id] ?? null });
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
  // Mint a REAL HMAC-signed workspace token (msk_…) — the same minter the MCP server verifies, so
  // the token this panel hands out actually authenticates external LLM clients (the old random
  // `mcp_…` UUID was opaque and would never pass verifyMcpToken).
  const { mintMcpToken } = await import("../lib/mcp-token");
  const token = mintMcpToken(c.get("workspaceId"));
  await mergeWorkspaceSettings(c.get("workspaceId"), { mcp_token: token });
  return c.json({ token }, 201);
});
router.get("/settings/security", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  // Real active sessions = the caller's live (non-revoked, unexpired) refresh tokens.
  const { data: rows } = await supabase
    .from("auth_refresh_tokens")
    .select("id, user_agent, ip_address, created_at, last_active_at, expires_at, token_hash")
    .eq("user_id", c.get("userId"))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  // The current device = the row whose hash matches this request's refresh cookie.
  const rawRt = getCookie(c, REFRESH_COOKIE);
  const currentHash = rawRt ? sha256(rawRt) : null;
  const sessions = (rows ?? []).map((r) => {
    const { device, browser } = parseUA(r.user_agent as string | null);
    const ip = r.ip_address as string | null;
    return {
      id: r.id,
      device,
      browser,
      // No third-party geo lookup (sovereignty) — private ranges are labelled, else region-unknown.
      location: ip && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip) ? "Private network" : ip ? "Unknown region" : "—",
      ip: maskIp(ip),
      last_active: relTime((r.last_active_at as string) ?? (r.created_at as string)),
      current: currentHash != null && r.token_hash === currentHash,
    };
  });
  return c.json({
    saml_enabled: settings.saml_enabled ?? false,
    saml_domain: settings.saml_domain ?? "",
    export_restricted: settings.export_restricted ?? false,
    protected_recipients: settings.protected_recipients ?? [],
    sessions,
  });
});
router.patch("/settings/security", async (c) => {
  const updates = await c.req.json<Record<string, unknown>>();
  await mergeWorkspaceSettings(c.get("workspaceId"), updates);
  return c.json({ ok: true });
});
// Revoke a specific session — delete the matching refresh-token row (scoped to the caller so
// you can only kill your OWN sessions), instantly invalidating that device's refresh on next use.
router.delete("/settings/security/sessions/:id", async (c) => {
  const { error } = await supabase
    .from("auth_refresh_tokens")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", c.get("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});
// Revoke ALL of the caller's other sessions — delete every refresh-token row for this user EXCEPT
// the one backing the current request, forcing every other device to de-authenticate on next use.
router.delete("/settings/security/sessions", async (c) => {
  const rawRt = getCookie(c, REFRESH_COOKIE);
  const keepHash = rawRt ? sha256(rawRt) : null;
  let q = supabase.from("auth_refresh_tokens").delete().eq("user_id", c.get("userId"));
  if (keepHash) q = q.neq("token_hash", keepHash);
  const { error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});
router.get("/settings/email", async (c) => {
  const settings = await workspaceSettings(c.get("workspaceId"));
  const integrations = (settings.integrations ?? {}) as Record<string, boolean>;
  // Source of truth = email_connections (the direct-Google connection lives here).
  const { data: conn } = await supabase
    .from("email_connections")
    .select("email, provider")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("provider", "google")
    .limit(1)
    .maybeSingle();
  const gmailEmail = (conn as { email?: string } | null)?.email;
  return c.json({ providers: [
    { id: "gmail", name: "Gmail", connected: Boolean(gmailEmail) || Boolean(integrations.gmail), email: gmailEmail },
    { id: "outlook", name: "Outlook", connected: Boolean(integrations.outlook) },
  ] });
});
router.get("/billing", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [{ data }, { count: memberCount }] = await Promise.all([
    supabase.from("workspaces").select("plan, settings").eq("id", workspaceId).single(),
    supabase.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);
  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  // ONE resolver — same tier the wallet + sidebar show, so the "Current plan" card can't disagree.
  const ent = resolveEntitlement(settings, (data as { plan?: string } | null)?.plan ?? null);
  const trialDaysLeft = ent.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(ent.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;
  const trialUsed = Boolean(settings.trial_used);
  return c.json({
    plan: ent.tier,                     // resolved entitlement tier (paid / trial-operator / scout)
    source: ent.source,
    // A tier the user selected at onboarding but hasn't paid for yet (Command/Sovereign). Billing
    // surfaces this as "activate <plan> — payment required" rather than granting it for free.
    pending_plan: ent.pendingPlan,
    seats_used: memberCount ?? 1,
    seats_limit: PLAN_TIERS[ent.tier].seats,
    invoices: [],
    trial_ends_at: ent.trialEndsAt,
    trial_days_left: trialDaysLeft,
    trial_used: trialUsed,
    // The 14-day Operator trial is a one-time offer, available anytime UNTIL USED — but only to a
    // free Scout workspace that hasn't already consumed it.
    trial_eligible: !trialUsed && ent.tier === "scout",
  });
});

// POST /start-trial — activate the one-time 14-day Operator trial on demand (the "decide later"
// path). Idempotent-guarded by trial_used so it can never be restarted.
router.post("/start-trial", async (c) => {
  if (!["owner", "admin"].includes(c.get("role"))) return c.json({ error: "Only owners/admins can start the trial." }, 403);
  const ws = c.get("workspaceId");
  const { data } = await supabase.from("workspaces").select("settings").eq("id", ws).single();
  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  // Already used → clear 409 WITH the current resolved state so the UI can settle correctly.
  if (settings.trial_used) {
    const ent = await getEntitlement(ws);
    return c.json({ error: "Your Operator trial has already been used.", trial_used: true, plan: ent.tier, source: ent.source, trial_ends_at: ent.trialEndsAt }, 409);
  }
  if (resolveEntitlement(settings).tier !== "scout") return c.json({ error: "Trials are only available on the free Scout plan." }, 409);
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // CRITICAL: write `settings` (jsonb — the entitlement source of truth) on its OWN update, and
  // CHECK the error. Previously this was combined with a `plan: "operator"` column write; the
  // workspaces_plan_check constraint rejects 'operator', so the WHOLE update was rolled back and the
  // trial markers never persisted — yet the separate credit grant still ran, producing the
  // "1,000,000 credits but tier still Scout" disconnect. Settings must land before we grant anything.
  const { error: settingsErr } = await supabase.from("workspaces").update({
    settings: { ...settings, account_tier: "operator", plan: "operator", track: "business", trial_ends_at: trialEndsAt, trial_used: true },
  }).eq("id", ws);
  if (settingsErr) return c.json({ error: "Could not activate the trial. Please try again." }, 500);

  // Best-effort: keep the top-level `plan` column in lockstep. Tolerated to fail (legacy
  // constraint) — the resolver reads settings.account_tier first, so entitlement is already correct.
  await supabase.from("workspaces").update({ plan: "operator" }).eq("id", ws).then(() => {}, () => {});

  // Now that the trial is truly ACTIVE, top included credits up to the Operator allotment via the
  // SAME grant-row reconciler /credits/balance uses (idempotent, preserves purchased credits).
  await reconcileIncludedCredits(ws, { enrollIfEmpty: true });
  const ent = await getEntitlement(ws);
  return c.json({ ok: true, plan: ent.tier, source: ent.source, trial_ends_at: ent.trialEndsAt, trial_used: true });
});

// NOTE: POST /invites lives in routes/invites.ts (mounted at /api/v1/invites, which shadows this
// path). The old nodes-based invite handler that used to be here was dead code and was removed.

// ─── Finance role: list members with finance_role ─────────────────────────────
router.get("/workspace/members", async (c) => {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, finance_role")
    .eq("workspace_id", c.get("workspaceId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json(
    (data ?? []).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      finance_role: (m as Record<string, unknown>).finance_role ?? "none",
    }))
  );
});

// Full members + pending invitations for the Workspace settings page.
// (The frontend expected /workspace/members-full but it didn't exist, so the
// members section showed nothing.)
router.get("/workspace/members-full", async (c) => {
  const workspaceId = c.get("workspaceId");
  const [membersRes, invitesRes] = await Promise.all([
    supabase.from("workspace_members").select("user_id, email, name, role, finance_role").eq("workspace_id", workspaceId),
    supabase.from("workspace_invites").select("id, email, role, finance_role, created_at, expires_at")
      .eq("workspace_id", workspaceId).is("accepted_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);
  const members = (membersRes.data ?? []).map((m) => ({
    id: m.user_id,
    email: (m as Record<string, unknown>).email ?? "",
    name: (m as Record<string, unknown>).name ?? undefined,
    role: m.role,
    finance_role: (m as Record<string, unknown>).finance_role ?? "none",
  }));
  const invitations = (invitesRes.data ?? []).map((i) => ({
    id: i.id, email: i.email, role: i.role,
    finance_role: (i as Record<string, unknown>).finance_role ?? "none",
    created_at: i.created_at,
  }));
  return c.json({ members, invitations });
});

// ─── Workspace role: change a member's role (admin/owner only) ───────────────
router.patch("/workspace/members/:userId/role", requireAuth, async (c) => {
  const callerRole = c.get("role");
  if (!["admin","owner"].includes(callerRole)) return c.json({ error: "Forbidden" }, 403);
  const { role } = await c.req.json<{ role: string }>();
  const valid = ["admin","member","viewer","guest"];
  if (!valid.includes(role)) return c.json({ error: "Invalid role" }, 422);
  // Prevent demoting the last owner
  if (callerRole === "owner" && role !== "owner") {
    const { count } = await supabase.from("workspace_members").select("id", { count: "exact", head: true })
      .eq("workspace_id", c.get("workspaceId")).eq("role", "owner");
    if ((count ?? 0) <= 1 && c.req.param("userId") === c.get("userId")) {
      return c.json({ error: "Cannot demote the last owner." }, 422);
    }
  }
  const { error } = await supabase.from("workspace_members")
    .update({ role })
    .eq("workspace_id", c.get("workspaceId"))
    .eq("user_id", c.req.param("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── Remove a member (admin/owner only, can't remove last owner) ──────────────
router.delete("/workspace/members/:userId", requireAuth, async (c) => {
  const callerRole = c.get("role");
  if (!["admin","owner"].includes(callerRole)) return c.json({ error: "Forbidden" }, 403);
  const targetId = c.req.param("userId");
  // Check not last owner
  const { data: target } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", c.get("workspaceId")).eq("user_id", targetId).maybeSingle();
  if (target?.role === "owner") {
    const { count } = await supabase.from("workspace_members").select("id", { count: "exact", head: true })
      .eq("workspace_id", c.get("workspaceId")).eq("role", "owner");
    if ((count ?? 0) <= 1) return c.json({ error: "Cannot remove the last owner." }, 422);
  }
  const { error } = await supabase.from("workspace_members")
    .delete().eq("workspace_id", c.get("workspaceId")).eq("user_id", targetId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── Finance role: set for a member (admin/owner only) ────────────────────────
router.patch("/workspace/members/:userId/finance-role", async (c) => {
  const role = c.get("role");
  if (!["admin", "owner"].includes(role)) return c.json({ error: "Forbidden" }, 403);
  const { finance_role } = await c.req.json<{ finance_role: string }>();
  const valid = ["none", "viewer", "member", "reviewer", "approver"];
  if (!valid.includes(finance_role)) return c.json({ error: "Invalid finance_role" }, 422);
  const { error } = await supabase
    .from("workspace_members")
    .update({ finance_role } as Record<string, unknown>)
    .eq("workspace_id", c.get("workspaceId"))
    .eq("user_id", c.req.param("userId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── Complete onboarding ──────────────────────────────────────────────────────
router.post("/settings/complete-onboarding", requireAuth, async (c) => {
  const { error } = await supabase
    .from("workspaces")
    .update({ onboarded: true })
    .eq("id", c.get("workspaceId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// ─── General workspace settings (name, logo_url, timezone) ───────────────────
router.patch("/settings/general", requireAuth, async (c) => {
  const callerRole = c.get("role");
  if (!["admin","owner"].includes(callerRole)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json<{ name?: string; logo_url?: string; timezone?: string }>();
  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url;
  if (body.timezone) updates.timezone = body.timezone;
  const { error } = await supabase.from("workspaces").update(updates).eq("id", c.get("workspaceId"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

export { router as appDataRouter };
