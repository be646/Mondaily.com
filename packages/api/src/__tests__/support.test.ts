import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, detectTopic } from "../routes/support";
import { HELP_DOCS, selectHelpDocs, helpDocsBlock } from "../lib/help-docs";
import {
  newSession, isSessionActive, summarizeHistory, latestDiagnostics, type HelpSession,
} from "../../../../apps/app/src/components/help/help-store";

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
  it("reads the wallet through the read-only aggregate, never a write", () => {
    // Previously asserted a literal `.select` on the ledger. The wallet total now goes through the
    // shared server-side aggregate (a JS sum silently truncated past PostgREST's row cap and made
    // the reported balance nondeterministic) — still a pure read, which is what this guards.
    expect(src).toMatch(/ledgerBreakdown\(workspaceId\)/);
    expect(src).not.toMatch(/from\("ai_credits_ledger"\)[\s\S]{0,40}\.(insert|update|delete)/);
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
    const t = src.slice(src.indexOf('async function createSupportTicketFull('), src.indexOf('router.get("/tickets"'));
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
    const fn = src.slice(src.indexOf('async function createSupportTicketFull('), src.indexOf('router.get("/tickets"'));
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
    const fn = src.slice(src.indexOf('async function createSupportTicketFull('), src.indexOf('router.get("/tickets"'));
    expect(fn).toMatch(/requester: \{ name: ctx\.identity\.name, email: ctx\.identity\.email/);
    expect(fn).toMatch(/plan: ctx\.entitlement\.tier/);
    expect(fn).toMatch(/credits_remaining: ctx\.wallet\.remaining/);
    expect(fn).toMatch(/route: args\.route/);
  });
});

describe("PHASE 2.1 — Help launcher moved off the sidebar/user area", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  it("HelpProvider no longer mounts a fixed bottom-left floating button", () => {
    const panel = read("../../../../apps/app/src/components/help/help-panel.tsx");
    expect(panel).not.toMatch(/fixed bottom-5 left-5/);   // the old placement over sidebar identity
    expect(panel).toMatch(/export function HelpTopButton/);
  });
  it("exactly ONE Help launcher, in the right-side global controls (AgentStatusBar)", () => {
    const layout = read("../../../../apps/app/src/routes/dashboard/layout.tsx");
    const agentStatus = read("../../../../apps/app/src/components/ai/agent-status.tsx");
    // The launcher lives in the right-side controls, NOT in the layout's left slot.
    expect(agentStatus).toMatch(/<HelpTopButton \/>/);
    expect(layout).not.toMatch(/<HelpTopButton \/>/);
    // Only one mounted instance across the two header files (no duplicate icon).
    const count = (layout.match(/<HelpTopButton \/>/g) ?? []).length + (agentStatus.match(/<HelpTopButton \/>/g) ?? []).length;
    expect(count).toBe(1);
    // The old static, non-working Help icon (no onClick) is gone.
    expect(agentStatus).not.toMatch(/title="Help"\s*>\s*<HelpCircle/);
  });
  it("HelpTopButton opens the panel via useHelp().open() with a clear aria-label", () => {
    const panel = read("../../../../apps/app/src/components/help/help-panel.tsx");
    const fn = panel.slice(panel.indexOf("export function HelpTopButton"));
    expect(fn).toMatch(/const \{ open \} = useHelp\(\)/);
    expect(fn).toMatch(/onClick=\{\(\) => open\(\)\}/);
    expect(fn).toMatch(/aria-label="Open Help"/);
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

describe("PHASE 2.2 — role-split support UI (admin queue vs my requests)", () => {
  const src = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/settings/support.tsx", import.meta.url)), "utf8");
  it("normal members load ONLY their own tickets; admins load the full queue", () => {
    expect(src).toMatch(/isAdmin \? "\/support\/tickets" : "\/support\/my-tickets"/);
    expect(src).toMatch(/\["owner", "admin"\]\.includes\(role/);
  });
  it("NO workspace user (incl. workspace admins) can change ticket status from the UI — read-only badge for everyone", () => {
    expect(src).not.toMatch(/canManageStatus/);                 // the admin status <select> is gone
    expect(src).not.toMatch(/setStatus/);                       // no status mutation remains
    expect(src).toMatch(/<StatusBadge status=\{d\.status\}/);   // everyone sees the read-only badge
  });
  it("backend PATCH status refuses ALL workspace callers — status belongs to Mondaily's support dashboard", () => {
    const back = readFileSync(fileURLToPath(new URL("../routes/support.ts", import.meta.url)), "utf8");
    const fn = back.slice(back.indexOf('router.patch("/tickets/:id"'), back.indexOf('router.post("/tickets/:id/comments"'));
    expect(fn).toMatch(/Ticket status is managed by Mondaily support/);
    expect(fn).toMatch(/403/);
    expect(fn).not.toMatch(/\.update\(/);                       // no write path remains in the handler
  });
});

describe("PHASE 2.2 — investigate-first diagnostics + suggested actions", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/support.ts", import.meta.url)), "utf8");
  it("detectTopic routes Discovery/credits/billing questions", () => {
    expect(detectTopic("Why is Discovery slow?")).toBe("discovery");
    expect(detectTopic("Is search online?")).toBe("discovery");
    expect(detectTopic("Am I out of credits?")).toBe("credits");
    expect(detectTopic("What plan should I upgrade to?")).toBe("billing");
    expect(detectTopic("hello")).toBe("general");
  });
  it("Discovery diagnostics include real Sovereign Search + Scraper rows", () => {
    const fn = src.slice(src.indexOf("function buildDiagnostics"));
    expect(fn).toMatch(/label: "Sovereign Search", status: d\.sovereign_search \? "ok" : "error"/);
    expect(fn).toMatch(/label: "Scraper", status: d\.sovereign_scrape \? "ok" : "error"/);
    expect(fn).toMatch(/label: "AI credits"/);
    expect(fn).toMatch(/label: "Related requests"/);
  });
  it("the prompt tells the agent to investigate + resolve BEFORE escalating", () => {
    expect(src).toMatch(/INVESTIGATE FIRST/);
    expect(src).toMatch(/Resolve or guide before escalating/);
    expect(src).toMatch(/Only set needs_ticket=true when the problem genuinely needs human action/);
  });
  it("/ask returns diagnostics + suggested_actions (backward-compatible with existing fields)", () => {
    const fn = src.slice(src.indexOf('router.post("/ask"'), src.indexOf('router.get("/context"'));
    expect(fn).toMatch(/diagnostics,\n\s*suggested_actions: buildSuggestedActions/);
    expect(fn).toMatch(/cited_docs: docs\.map/);   // existing fields preserved
  });
  it("suggested actions always include a follow-up; create-ticket only when needed", () => {
    const fn = src.slice(src.indexOf("function buildSuggestedActions"));
    expect(fn).toMatch(/if \(needsTicket\) actions\.push\(\{ label: "Create support request", action: "create_ticket" \}\)/);
    expect(fn).toMatch(/action: "follow_up"/);
  });
});

describe("PHASE 2.2 — Help panel renders diagnostics + actions, explicit ticket only", () => {
  const panel = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/help/help-panel.tsx", import.meta.url)), "utf8");
  it("renders diagnostics rows + suggested-action buttons after each answer", () => {
    expect(panel).toMatch(/m\.diagnostics!\.map/);
    expect(panel).toMatch(/m\.actions!\.map/);
    expect(panel).toMatch(/function DiagRow/);
  });
  it("a ticket is created ONLY on explicit action, and never duplicated in one chat", () => {
    expect(panel).toMatch(/if \(session\.ticketCreated\) return;/);   // guard against silent dupes
    expect(panel).toMatch(/a\.action === "create_ticket"\) createTicket/);
    expect(panel).toMatch(/if \(isTicket && session\.ticketCreated\) return null/);
  });
  it("ticket metadata carries the diagnostics from the case", () => {
    expect(panel).toMatch(/diagnostics: latestDiagnostics\(session\)/);
  });
});

describe("PHASE 3 — persistent help session model", () => {
  it("newSession starts empty + active with the full state model", () => {
    const s = newSession();
    expect(s.messages).toEqual([]);
    expect(s.state).toBe("active");
    expect(s.ticketCreated).toBe(false);
    expect(s.routeHistory).toEqual([]);
    expect(s.rating).toBeNull();
    for (const k of ["id", "subject", "category", "ticketId", "lastRoute", "feedback", "createdAt"]) expect(k in s).toBe(true);
  });
  it("isSessionActive is true once there are messages and not closed", () => {
    const s = newSession();
    expect(isSessionActive(s)).toBe(false);                             // empty → not active
    const withMsg: HelpSession = { ...s, messages: [{ role: "user", content: "hi" }] };
    expect(isSessionActive(withMsg)).toBe(true);
    expect(isSessionActive({ ...withMsg, state: "closed" })).toBe(false); // closed → not active
  });
  it("summarizeHistory + latestDiagnostics capture the case for a ticket", () => {
    const s: HelpSession = { ...newSession(), messages: [
      { role: "user", content: "Discovery is slow" },
      { role: "assistant", content: "Checked search", diagnostics: [{ label: "Sovereign Search", status: "error", detail: "not configured", source: "status" }] },
      { role: "assistant", system: true, content: "I opened Discovery" },
    ] };
    expect(summarizeHistory(s)).toMatch(/User: Discovery is slow/);
    expect(summarizeHistory(s)).toMatch(/System: I opened Discovery/);
    expect(latestDiagnostics(s)[0]?.label).toBe("Sovereign Search");
  });
});

describe("PHASE 3 — persistence + non-destructive navigation (source-read)", () => {
  const provider = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/help/help-panel.tsx", import.meta.url)), "utf8");
  it("HelpProvider holds the session and mirrors it to localStorage on every change", () => {
    // The initializer is now wrapped so a corrupt saved session cannot stop the app starting —
    // this provider sits above the Outlet, so a throw here replaces the WHOLE app with an error
    // card. The intent this test protects (state loaded from storage, falling back to a new
    // session) is unchanged.
    expect(provider).toMatch(/useState<HelpSession>\(\(\) => \{/);
    expect(provider).toMatch(/return loadSession\(key\) \?\? newSession\(\);/);
    expect(provider).toMatch(/useEffect\(\(\) => \{ saveSession\(key, session\); \}, \[key, session\]\)/);
  });
  it("HelpProvider lives above the router Outlet (persists across routes)", () => {
    const layout = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/layout.tsx", import.meta.url)), "utf8");
    expect(layout).toMatch(/<HelpProvider>/);
    expect(layout).toMatch(/<Outlet/);
  });
  it("a navigate action logs the route + adds a guiding note but does NOT clear messages", () => {
    const fn = provider.slice(provider.indexOf("function runAction"), provider.indexOf("function runAction") + 700);
    expect(fn).toMatch(/routeHistory: \[\.\.\.s\.routeHistory, a\.payload!\]/);
    expect(fn).toMatch(/I opened \$\{a\.label\}\. Try it again/);
    expect(fn).toMatch(/messages: \[\.\.\.s\.messages,/);   // history preserved, appended
    expect(fn).not.toMatch(/messages: \[\]/);               // never wiped on navigate
  });
  it("a minimized 'resume Help' pill re-opens the active case (bottom-right, not over the sidebar)", () => {
    expect(provider).toMatch(/isSessionActive\(session\) && <ResumePill/);
    expect(provider).toMatch(/fixed bottom-4 right-4/);
    expect(provider).not.toMatch(/fixed bottom-\d+ left-/);
  });
  it("a 'Start new help inquiry' control exists", () => {
    expect(provider).toMatch(/aria-label="Start new help inquiry"/);
    expect(provider).toMatch(/newInquiry/);
  });
});

describe("PHASE 3 — resolution, rating, and explicit escalation (source-read)", () => {
  const provider = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/help/help-panel.tsx", import.meta.url)), "utf8");
  it("after an answer, Help asks 'Did this solve the issue?' with Fixed / Still / Create request", () => {
    expect(provider).toMatch(/Did this solve the issue\?/);
    expect(provider).toMatch(/>Fixed</);
    expect(provider).toMatch(/>Still having trouble</);
    expect(provider).toMatch(/>Create support request</);
  });
  it("'Fixed' → rating step; rating is stored and closes the case", () => {
    expect(provider).toMatch(/How helpful was this\? \(1–5\)/);
    expect(provider).toMatch(/function submitRating/);
    expect(provider).toMatch(/rating: stars, feedback:.*state: "closed"/);
  });
  it("a ticket is created ONLY on explicit click and never duplicated in a session", () => {
    const fn = provider.slice(provider.indexOf("async function createTicket"), provider.indexOf("async function createTicket") + 1800);
    expect(fn).toMatch(/if \(session\.ticketCreated\) return;/);
    expect(fn).toMatch(/apiClient\.post<\{ id: string \}>\("\/support\/tickets"/);
    expect(provider).toMatch(/if \(isTicket && session\.ticketCreated\) return null/);   // hides dup action
  });
  it("ticket metadata carries diagnostics, route history, summarized history and rating", () => {
    const fn = provider.slice(provider.indexOf("async function createTicket"), provider.indexOf("async function createTicket") + 1800);
    expect(fn).toMatch(/diagnostics: latestDiagnostics\(session\)/);
    expect(fn).toMatch(/route_history: session\.routeHistory/);
    expect(fn).toMatch(/history_summary: message/);   // message = summarizeHistory(session), hoisted to a local
    expect(fn).toMatch(/rating: session\.rating/);
  });
  it("rating/feedback attaches to an existing ticket as a comment (no new table)", () => {
    expect(provider).toMatch(/if \(session\.ticketId\) apiClient\.post\(`\/support\/tickets\/\$\{session\.ticketId\}\/comments`/);
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
