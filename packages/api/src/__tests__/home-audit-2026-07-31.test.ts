import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the 2026-07-31 Home audit — truth, tenant isolation, and dead wiring.
 *
 * Each test below encodes a defect that was actually shipped, so a regression re-breaks the test
 * rather than quietly re-breaking the product. Source-read style (like the sibling suites): these
 * assert the contract in the code, not runtime behaviour against a live database.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Home audit 2026-07-31 — counts must be counted, never inferred from a page", () => {
  it("/nodes exposes an exact counts endpoint scoped to the workspace", () => {
    const nodes = read("packages/api/src/routes/nodes.ts");
    expect(nodes).toMatch(/router\.get\("\/counts", requireAuth/);
    expect(nodes).toMatch(/count: "exact", head: true \}\)\.eq\("workspace_id", workspaceId\)/);
    // per-type counts come from the SQL aggregate, not a tally over fetched rows
    expect(nodes).toMatch(/supabase\.rpc\("object_type_counts", \{ ws: workspaceId \}\)/);
    // declared before "/:id/..." or the literal path loses the route match
    expect(nodes.indexOf('router.get("/counts"')).toBeLessThan(nodes.indexOf('router.get("/:id/related"'));
  });

  it("the pulse reads real totals instead of the length of a 500-row page", () => {
    const dock = read("apps/app/src/components/ai/agent-dock.tsx");
    expect(dock).toMatch(/records: countsQ\.data\?\.total \?\? 0/);
    expect(dock).not.toMatch(/records: nodes\.length/);
    expect(dock).not.toMatch(/"\/nodes\?limit=500"/);
  });

  it("risk-alert generation tells the model exact totals, not truncated page sizes", () => {
    const gen = read("packages/api/src/routes/generate.ts");
    expect(gen).toMatch(/Total open tasks: \$\{openTaskCount\.count \?\? tasks\.length\}/);
    expect(gen).toMatch(/Total graph records: \$\{recordCount\.count \?\? nodes\.length\}/);
    // figures derived from the capped arrays must say so
    expect(gen).toMatch(/most recently updated records sampled/);
    expect(gen).not.toMatch(/`Total open tasks: \$\{tasks\.length\}`/);
  });

  it("deal counts match by stem — 'deal' and 'deals' both count", () => {
    expect(read("packages/api/src/routes/workspaces.ts")).toMatch(/ilike\("object_type", "%deal%"\)/);
    expect(read("packages/api/src/routes/generate.ts")).toMatch(/String\(n\.object_type\)\.toLowerCase\(\)\.includes\("deal"\)/);
  });
});

describe("Home audit 2026-07-31 — tenant isolation", () => {
  it("the task pre-read is workspace-scoped like the update that follows it", () => {
    const tasks = read("packages/api/src/routes/tasks.ts");
    expect(tasks).toMatch(/select\("status,priority,assignee_id,assignee_email,completed,completed_at"\)\.eq\("id", id\)\.eq\("workspace_id", workspaceId\)/);
  });

  it("notification read-writes are scoped to the caller, not just the workspace", () => {
    const appData = read("packages/api/src/routes/app-data.ts");
    // The property, not the old filter string: these writes now go through lib/notification-reads,
    // which resolves ownership from the row (and gives a broadcast per-user read state instead of
    // writing the shared row). The caller's id must still reach it.
    expect(appData).toMatch(/markRead\(c\.get\("workspaceId"\), c\.get\("userId"\), c\.req\.param\("id"\)\)/);
    expect(appData).toMatch(/markAllRead\(c\.get\("workspaceId"\), c\.get\("userId"\)\)/);
    expect(read("packages/api/src/lib/notification-reads.ts")).toMatch(/if \(row\.user_id !== userId\) return false;/);
    // the shadowed, user-unscoped GET duplicate is gone
    expect(appData).not.toMatch(/router\.get\("\/notifications", async \(c\) => c\.json\(await rows\("notifications"/);
  });

  it("resolve_decision carries the tenant guard on the write", () => {
    const ask = read("packages/api/src/routes/ask.ts");
    expect(ask).toMatch(/\.eq\("id", decisionId\)\s*\n\s*\.eq\("workspace_id", workspaceId\)/);
  });

  it("the OAuth popup listener only trusts messages from our own API origin", () => {
    expect(read("apps/app/src/routes/dashboard/home.tsx"))
      .toMatch(/if \(e\.origin !== new URL\(BASE_URL, window\.location\.href\)\.origin\) return;/);
  });
});

describe("Home audit 2026-07-31 — nothing claims to be live that isn't", () => {
  const home = () => read("apps/app/src/routes/dashboard/home.tsx");

  it("no fabricated agent attribution on answers", () => {
    // the badge named an agent inferred by regex from the user's own prompt, while the reply
    // always came from the generic /ask endpoint
    expect(home()).not.toMatch(/data-status="draft_ready"/);
    expect(home()).not.toMatch(/\{meta\.agent\.name\}/);
  });

  it("thinking text is the engine's real tool phase, not a timed script", () => {
    expect(home()).toMatch(/streamStatus \?\? "Thinking"/);
    expect(home()).not.toMatch(/GRAPH_REASONING_STEPS\[thinkingStep\]/);
  });

  it("the tasks widget does not claim AI sorting it never does", () => {
    expect(home()).not.toMatch(/AI sorted/);
  });

  it("pulse tiles draw a flat baseline when no real history exists", () => {
    const cc = read("apps/app/src/components/ai/command-center.tsx");
    expect(cc).toMatch(/d="M0,26 L100,26"/);
    expect(cc).not.toMatch(/M0,26 C30,26 50,\$\{endY\} 100,\$\{endY\}/);
    // the tile whose value mixes invoices + pending decisions is labelled for what it is
    expect(cc).toMatch(/label: "finance signals"/);
  });

  it("no invented business records sit in the seed path", () => {
    const appData = read("packages/api/src/routes/app-data.ts");
    expect(appData).not.toMatch(/const SEED_NODES/);
    expect(appData).not.toMatch(/funding_raised:/);
  });

  it("the AI credit limit comes from the entitlement resolver", () => {
    const ask = read("packages/api/src/routes/ask.ts");
    expect(ask).toMatch(/const limit = entitlement\.includedMonthlyCredits/);
    expect(ask).not.toMatch(/limit: 1000, period_end/);
  });
});

describe("Home audit 2026-07-31 — wires actually connected", () => {
  it("record search sends the key the API validates", () => {
    expect(read("apps/app/src/routes/dashboard/home.tsx")).toMatch(/"\/search", \{ query: attachQuery\.trim\(\) \}/);
    expect(read("apps/app/src/components/ai/use-attachments.tsx")).toMatch(/"\/search", \{ query: query\.trim\(\) \}/);
    expect(read("packages/api/src/routes/search.ts")).toMatch(/query: z\.string\(\)\.min\(1\)/);
  });

  it("/meetings/today reads the object_type that real meetings are stored as", () => {
    const appData = read("packages/api/src/routes/app-data.ts");
    expect(appData).toMatch(/\.eq\("object_type", "calendar_event"\)/);
    expect(appData).not.toMatch(/objectType: "meeting"/);
  });

  it("internal meeting rooms stay in the SPA", () => {
    expect(read("apps/app/src/routes/dashboard/home.tsx")).toMatch(/m\.url\?\.startsWith\("\/"\) \? \(/);
  });

  it("the needs-you panel's CTAs are wired to a real handler", () => {
    expect(read("apps/app/src/routes/dashboard/home.tsx")).toMatch(/onAskMondaily=\{prefill\}/);
  });
});
