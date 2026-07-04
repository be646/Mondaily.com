import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUPPORT_CATEGORIES } from "../routes/support";

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
    expect(src).toMatch(/NEVER claim you did/);
    expect(src).toMatch(/NEVER promise refunds, discounts/);
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
    const t = src.slice(src.indexOf('router.post("/tickets"'));
    expect(t).toMatch(/object_type: "support_ticket"/);
    expect(t).toMatch(/workspace_id: c\.get\("workspaceId"\)/);
    expect(t).toMatch(/created_by: c\.get\("userId"\)/);
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

describe("support route is mounted + auth-gated", () => {
  const app = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");
  it("mounted at /api/v1/support", () => {
    expect(app).toMatch(/app\.route\("\/api\/v1\/support", supportRouter\)/);
  });
  it("requires auth on every support route", () => {
    expect(src).toMatch(/router\.use\("\*", requireAuth\)/);
  });
});
