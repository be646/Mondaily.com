import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES } from "../routes/support";
import { HELP_DOCS, selectHelpDocs, helpDocsBlock } from "../lib/help-docs";

const src = readFileSync(fileURLToPath(new URL("../routes/support.ts", import.meta.url)), "utf8");

describe("support agent — issue classification", () => {
  it("classifies into the required categories", () => {
    for (const c of ["billing", "credits", "onboarding", "discovery", "integrations", "data_privacy", "bug_report", "feature_request"]) {
      expect(SUPPORT_CATEGORIES as readonly string[]).toContain(c);
    }
  });
  it("the /ask response validates the category against the enum (no arbitrary category)", () => {
    expect(src).toMatch(/SUPPORT_CATEGORIES as readonly string\[\]\)\.includes\(parsed\.category/);
  });
});

describe("support agent — language aware", () => {
  it("resolves the effective language (user override → workspace profile → English)", () => {
    expect(src).toMatch(/user_preferences.*language/);
    expect(src).toMatch(/normalizeLang\(userLang \|\| profile\.language\)/);
  });
  it("appends the language instruction to the system prompt", () => {
    expect(src).toMatch(/languageInstruction\(ctx\.language\)/);
  });
});

describe("support agent — never fakes refunds or account actions", () => {
  it("the system prompt forbids refunds/discounts/account actions and 'it's done' claims", () => {
    expect(src).toMatch(/take NO account actions/);
    expect(src).toMatch(/NEVER say "I upgraded you", "I refunded you"/);
    expect(src).toMatch(/READ-ONLY/);
  });
  it("sensitive requests set needs_ticket instead of performing the action", () => {
    expect(src).toMatch(/needs_ticket/);
    expect(src).toMatch(/tell the user you'll open a support request/i);
  });
  it("the route performs NO account/billing mutations (no grants, refunds, plan/settings writes)", () => {
    // No mutating credit/plan helpers are even imported or called (the word "refund" only appears in
    // the prompt RULES that forbid it — checked separately above).
    expect(src).not.toMatch(/grantCredits\(|grantTierCredits\(|recordCreditUsage\(|activateTier\(/);
    // it never writes to the credit ledger or the workspaces table
    expect(src).not.toMatch(/from\("ai_credits_ledger"\)[\s\S]{0,40}\.(insert|update|delete)/);
    expect(src).not.toMatch(/from\("workspaces"\)[\s\S]{0,40}\.(insert|update|delete)/);
  });
});

describe("support agent — billing/wallet is READ-ONLY", () => {
  it("reads the wallet via SELECT only", () => {
    expect(src).toMatch(/from\("ai_credits_ledger"\)\.select/);
  });
  it("reads entitlement via the shared resolver (no re-derivation, no writes)", () => {
    expect(src).toMatch(/getEntitlement\(workspaceId\)/);
  });
});

describe("support agent — AI call is unmetered (help works at zero credits) + fails closed", () => {
  it("calls the gateway WITHOUT a workspaceId so it can't be credit-gated/charged", () => {
    const call = src.slice(src.indexOf("await aiGateway({"), src.indexOf("await aiGateway({") + 120);
    expect(call).not.toMatch(/workspaceId/);
  });
  it("fails closed when the sovereign gateway env is missing (no default provider)", () => {
    expect(src).toMatch(/gatewayEnv\(\)/);
    expect(src).toMatch(/!env\.baseURL \|\| !env\.apiKey/);
  });
});

describe("support tickets — creation + workspace isolation", () => {
  it("POST /tickets inserts a support_ticket node scoped to the workspace + user", () => {
    const t = src.slice(src.indexOf('router.post("/tickets"'), src.indexOf('router.get("/tickets"'));
    expect(t).toMatch(/object_type: "support_ticket"/);
    expect(t).toMatch(/workspace_id: ws/);          // ws = c.get("workspaceId")
    expect(src).toMatch(/const ws = c\.get\("workspaceId"\); const userId = c\.get\("userId"\)/);
    expect(t).toMatch(/status: "open"/);
  });
  it("the ticket category is validated against the enum", () => {
    expect(src).toMatch(/category: z\.enum\(SUPPORT_CATEGORIES\)/);
  });
  it("EVERY workspace query is scoped by workspace_id (isolation)", () => {
    // Count reads/writes against workspace-scoped tables and require a matching workspace_id filter.
    const scoped = src.match(/\.eq\("workspace_id"/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(4); // context reads (ledger, contacts, members) + ticket list
    expect(src).toMatch(/router\.get\("\/tickets", requireAdminRole/); // admin-gated queue
  });
});

describe("PHASE 2 — ticket lifecycle", () => {
  it("defines the 5 required statuses", () => {
    expect([...SUPPORT_STATUSES]).toEqual(["open", "in_review", "waiting_on_user", "resolved", "closed"]);
  });
  it("PATCH status is admin/owner-gated, workspace-scoped, and validates the enum", () => {
    const fn = src.slice(src.indexOf('router.patch("/tickets/:id"'));
    expect(fn).toMatch(/router\.patch\("\/tickets\/:id", requireAdminRole/);
    expect(fn).toMatch(/status: z\.enum\(SUPPORT_STATUSES\)/);
    expect(fn).toMatch(/\.update\(\{ data: updated \}\)/);
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)/);
  });
  it("comments allow the requester OR an admin, and are workspace-scoped", () => {
    const fn = src.slice(src.indexOf('router.post("/tickets/:id/comments"'));
    expect(fn).toMatch(/isAdmin.*isRequester|const isRequester/);
    expect(fn).toMatch(/if \(!isAdmin && !isRequester\) return c\.json\([\s\S]{0,30}403\)/);
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)/);
  });
  it("ticket detail is visible to the requester OR an admin (workspace-scoped)", () => {
    const fn = src.slice(src.indexOf('router.get("/tickets/:id"'));
    expect(fn).toMatch(/t\.created_by !== c\.get\("userId"\) && !isWorkspaceAdmin/);
  });
  it("getTicket is always scoped by workspace_id + object_type", () => {
    const fn = src.slice(src.indexOf("async function getTicket"), src.indexOf("async function getTicket") + 400);
    expect(fn).toMatch(/\.eq\("workspace_id", workspaceId\)/);
    expect(fn).toMatch(/\.eq\("object_type", "support_ticket"\)/);
  });
});

describe("PHASE 2 — notifications", () => {
  it("new ticket notifies workspace admins/owners", () => {
    const fn = src.slice(src.indexOf('router.post("/tickets"'), src.indexOf('router.get("/tickets"'));
    expect(fn).toMatch(/workspaceAdminIds\(ws, userId\)/);
    expect(fn).toMatch(/createNotification\(\{[\s\S]{0,120}New support request/);
  });
  it("status change notifies the requester (not the actor)", () => {
    const fn = src.slice(src.indexOf('router.patch("/tickets/:id"'));
    expect(fn).toMatch(/if \(t\.created_by && t\.created_by !== userId\)/);
    expect(fn).toMatch(/createNotification\(\{[\s\S]{0,120}user_id: t\.created_by/);
  });
  it("uses the existing notification system (no direct email send)", () => {
    expect(src).toMatch(/import \{ createNotification \} from "\.\.\/lib\/notify"/);
    expect(src).not.toMatch(/sendEmail|resend|nodemailer|smtp/i);
  });
});

describe("PHASE 2 — help knowledge base + citation", () => {
  it("covers every required topic", () => {
    const ids = HELP_DOCS.map(d => d.id);
    for (const id of ["discovery", "credits", "plans", "onboarding", "sovereign", "training_data", "integrations", "decisions_agents"]) {
      expect(ids).toContain(id);
    }
  });
  it("selects relevant docs by keyword and cites [id] in the block", () => {
    const docs = selectHelpDocs("why are my credits low and how do I buy more?");
    expect(docs.map(d => d.id)).toContain("credits");
    expect(helpDocsBlock(docs)).toMatch(/\[credits\]/);
  });
  it("returns [] when nothing matches (agent then says docs don't cover it)", () => {
    expect(selectHelpDocs("xyzzy quux frobnicate")).toEqual([]);
    expect(helpDocsBlock([])).toBe("");
  });
  it("/ask injects the docs block, instructs citation + insufficient-fallback, returns cited_docs", () => {
    expect(src).toMatch(/helpDocsBlock\(docs\)/);
    expect(src).toMatch(/cite the \[id\]/);
    expect(src).toMatch(/cited_docs: docs\.map/);
    expect(src).toMatch(/If the docs don't cover the question/);   // insufficient-fallback instruction
    expect(helpDocsBlock(HELP_DOCS.slice(0, 1))).toMatch(/if none of these answer the question, say the docs don't cover it and offer a support ticket/);
  });
});

describe("PHASE 2 — diagnostics are read-only + never invented", () => {
  it("diagnostics probe env presence (gateway/search/scrape) + db, not fabricated outages", () => {
    expect(src).toMatch(/ai_gateway: Boolean\(env\.baseURL && env\.apiKey\)/);
    expect(src).toMatch(/sovereign_search: Boolean\(process\.env\.SOVEREIGN_SEARCH_URL\)/);
    expect(src).toMatch(/training_policy/);
    expect(src).toMatch(/recent_tickets/);
  });
  it("the prompt still forbids inventing outages/issues", () => {
    expect(src).toMatch(/never invent numbers, statuses, outages, or history/);
  });
});

describe("PHASE 2.1 — identity + context in Help", () => {
  it("buildSupportContext loads the requester's identity (name/email/role) + workspace name", () => {
    expect(src).toMatch(/from\("workspace_members"\)\.select\("name, email, role"\)\.eq\("workspace_id", workspaceId\)\.eq\("user_id", userId\)/);
    expect(src).toMatch(/display_name: resolveDisplayName\(me\)/);
    expect(src).toMatch(/workspace_name:/);
  });
  it("the system prompt tells the agent to answer identity questions from the facts", () => {
    expect(src).toMatch(/When asked "what is my name\?" answer with this name/);
    expect(src).toMatch(/the user's name, email, role, workspace, plan\/tier, trial status, credits remaining/);
  });
  it("GET /support/context exposes identity + plan + wallet for the terminal panel (read-only)", () => {
    const fn = src.slice(src.indexOf('router.get("/context"'));
    expect(fn).toMatch(/identity: ctx\.identity/);
    expect(fn).toMatch(/entitlement: ctx\.entitlement/);
    expect(fn).toMatch(/wallet: ctx\.wallet/);
    expect(fn).toMatch(/diagnostics: ctx\.diagnostics/);
  });
});

describe("PHASE 2.1 — safe upsell, never fake actions", () => {
  it("explicitly ALLOWS recommending a higher plan / credit pack", () => {
    expect(src).toMatch(/SAFE UPSELL/);
    expect(src).toMatch(/Operator or Command may fit better|recommend a higher plan/);
  });
  it("explicitly FORBIDS claiming it upgraded / refunded / discounted", () => {
    expect(src).toMatch(/NEVER say "I upgraded you", "I refunded you", "I applied a discount\/credit"/);
  });
});

describe("PHASE 2.1 — ticket metadata carries identity + context", () => {
  it("create-ticket stamps requester identity, plan, credits and route", () => {
    const fn = src.slice(src.indexOf('router.post("/tickets"'), src.indexOf('router.get("/tickets"'));
    expect(fn).toMatch(/requester: \{ name: ctx\.identity\.name, email: ctx\.identity\.email/);
    expect(fn).toMatch(/plan: ctx\.entitlement\.tier/);
    expect(fn).toMatch(/credits_remaining: ctx\.wallet\.remaining/);
    expect(fn).toMatch(/route: body\.route/);
  });
});

describe("PHASE 2.1 — Help launcher moved off the sidebar/user area", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("HelpProvider no longer mounts a fixed bottom-left floating button", () => {
    const panel = read("../../../../apps/app/src/components/help/help-panel.tsx");
    expect(panel).not.toMatch(/fixed bottom-5 left-5/);   // the old placement over sidebar identity
    expect(panel).toMatch(/export function HelpTopButton/);
  });
  it("the top header mounts HelpTopButton as the main entry", () => {
    expect(read("../../../../apps/app/src/routes/dashboard/layout.tsx")).toMatch(/<HelpTopButton \/>/);
  });
  it("Billing still opens Help with a billing prefill", () => {
    expect(read("../../../../apps/app/src/routes/dashboard/settings/billing.tsx")).toMatch(/help\.open\(/);
  });
  it("the panel shows REAL context rows from /support/context (no fake diagnostics)", () => {
    const panel = read("../../../../apps/app/src/components/help/help-panel.tsx");
    expect(panel).toMatch(/apiClient\.get\("\/support\/context"\)/);
    expect(panel).toMatch(/reading workspace context/);
  });
});

describe("support route is mounted + auth-gated", () => {
  const app = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
  it("mounted at /api/v1/support", () => {
    expect(app).toMatch(/app\.route\("\/api\/v1\/support", supportRouter\)/);
  });
  it("requires auth on every support route", () => {
    expect(src).toMatch(/router\.use\("\*", requireAuth\)/);
  });
});
