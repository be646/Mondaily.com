import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stalledDeals } from "../routes/owner";
import type { NodeRow } from "../lib/money";

const owner = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
const NOW = Date.parse("2026-07-30T00:00:00Z");
const deal = (o: Partial<NodeRow>): NodeRow => ({ id: o.id ?? "d", data: o.data ?? {}, created_at: o.created_at ?? "2026-01-01T00:00:00Z", updated_at: o.updated_at ?? "2026-01-01T00:00:00Z" });

/** The Owner Console: one payload, money definitions borrowed — never re-derived. */
describe("stalled deals — the money going cold", () => {
  it("counts only OPEN deals untouched for 30+ days", () => {
    const rows = [
      deal({ data: { stage: "Negotiation", deal_value: 100, name: "Cold" }, updated_at: "2026-05-01T00:00:00Z" }),
      deal({ data: { stage: "Negotiation", deal_value: 50, name: "Warm" }, updated_at: "2026-07-25T00:00:00Z" }),
      deal({ data: { stage: "Closed Won", deal_value: 999, name: "Done" }, updated_at: "2026-01-01T00:00:00Z" }),   // closed ≠ stalled
      deal({ data: { stage: "Closed Lost", deal_value: 999 }, updated_at: "2026-01-01T00:00:00Z" }),
    ];
    const s = stalledDeals(rows, NOW);
    expect(s.count).toBe(1);
    expect(s.value).toBe(100);
    expect(s.top[0]).toMatchObject({ name: "Cold", days_stale: 90 });
  });

  it("ranks the top list by value, capped", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      deal({ id: `d${i}`, data: { stage: "Lead", deal_value: i * 10, name: `D${i}` }, updated_at: "2026-01-01T00:00:00Z" }));
    const s = stalledDeals(rows, NOW);
    expect(s.top).toHaveLength(6);
    expect(s.top[0].name).toBe("D9");   // highest value first
  });
});

describe("the console borrows the money model, gated, bounded", () => {
  it("is admin/owner only", () => {
    expect(owner).toMatch(/router\.get\("\/console", requireAdminRole/);
  });
  it("imports every money number from lib/money — none re-derived", () => {
    for (const fn of ["closedWonIn", "pipelineCreatedIn", "openPipeline", "weightedForecast", "closersIn", "invoiceMetrics"]) {
      expect(owner).toContain(fn);
    }
    expect(owner).toMatch(/from "\.\.\/lib\/money"/);
  });
  it("AGGREGATION reads nodes only through pagedNodes", () => {
    expect(owner).toMatch(/pagedNodes\(ws, \{ eq: "invoice" \}\)/);
    expect(owner).toMatch(/pagedNodes\(ws, \{ ilike: "%deal%" \}\)/);
    // Scoped to the /console handler: assign-deal below it legitimately reads ONE node by id.
    // The original whole-file version of this guard was right until that endpoint existed.
    const consoleHandler = owner.slice(owner.indexOf('router.get("/console"'), owner.indexOf('router.post("/assign-deal"'));
    expect(consoleHandler).not.toMatch(/from\("nodes"\)/);
  });
  it("surfaces the circuit breaker's live state", () => {
    expect(owner).toMatch(/AUTONOMY_HOURLY_CAP/);
    expect(owner).toMatch(/autonomyUsageLastHour/);
  });
});

describe("the console page reads fields that exist", () => {
  it("reads the readiness payload's `group` key — singular, as the API returns it", () => {
    const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/owner-console.tsx"), "utf8");
    const api = readFileSync(join(__dirname, "../routes/admin-readiness.ts"), "utf8");
    expect(api).toMatch(/^    group,$/m);                       // what the API actually sends
    expect(page).toMatch(/readiness\.data\?\.group \?\? \{\}/); // what the page reads
    expect(page).not.toMatch(/readiness\.data\?\.groups/);      // the typo that hid the System section
  });
});

describe("money goal metrics — the owner's targets speak the money model's language", () => {
  const activities = readFileSync(join(__dirname, "../routes/activities.ts"), "utf8");
  const metrics = readFileSync(join(__dirname, "../lib/oversight-metrics.ts"), "utf8");

  it("deals_won_value and revenue_collected are registered goal metrics", () => {
    expect(metrics).toMatch(/"deals_won_value", "revenue_collected"\] as const/);
  });

  it("both compute through lib/money, never re-derived", () => {
    expect(activities).toMatch(/closedWonIn\(rows, range\)\.value/);
    expect(activities).toMatch(/invoiceMetrics\(rows, conv\.toBase, conv\.base, range\)\.collected/);
    expect(activities).toMatch(/pagedMoneyNodes/);   // paged reads, not a bounded select
  });

  it("revenue_collected refuses member scope — invoices carry no per-member attribution", () => {
    expect(metrics).toMatch(/TEAM_ONLY_GOAL_METRICS: readonly GoalMetric\[\] = \["revenue_collected"\]/);
    expect(activities).toMatch(/can't be attributed to one member/);
  });

  it("member deals_won_value joins on the member's NAME and matches nothing when unnamed", () => {
    // deals carry owner NAMES, not user ids; an empty name must not match every deal.
    expect(activities).toMatch(/if \(!name\) return 0;/);
    expect(activities).toMatch(/moneyDealOwner\(r\.data\)\.toLowerCase\(\) !== name/);
  });

  it("pace is deterministic thresholds on a fully-elapsed rolling window", () => {
    expect(activities).toMatch(/>= 100 \? "ahead"/);
    expect(activities).toMatch(/>= 70 \? "on"/);
  });
});

describe("assignments & actions — verbs without new capabilities", () => {
  const ownerSrc = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
  const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/owner-console.tsx"), "utf8");

  it("assign-deal merges server-side — a raw node PATCH would erase the deal", () => {
    // updateNode/PATCH /nodes replaces `data` wholesale; assigning with a partial body through it
    // destroys every other field. The endpoint must read-merge-write and touch only deal_owner.
    expect(ownerSrc).toMatch(/const merged = \{ \.\.\.\(\(node\.data as Record<string, unknown>\) \?\? \{\}\), deal_owner: ownerName \}/);
    expect(ownerSrc).toMatch(/router\.post\("\/assign-deal", requireAdminRole/);
    // and it refuses non-deals, so the console can never rename a person's owner field by mistake
    expect(ownerSrc).toMatch(/if \(!String\(node\.object_type \?\? ""\)\.toLowerCase\(\)\.includes\("deal"\)\)/);
  });

  it("assignment is audited on the deal's own timeline", () => {
    expect(ownerSrc).toMatch(/diff: \{ assigned_owner: ownerName, via: "owner_console" \}/);
  });

  it("unassigned queue is OPEN deals only, ranked by value", () => {
    expect(ownerSrc).toMatch(/isOpen\(dealStage\(r\.data\)\) && !dealOwner\(r\.data\)/);
  });

  it("the page reuses the decisions endpoints — no parallel approval path", () => {
    expect(page).toMatch(/apiClient\.post\(`\/decisions\/\$\{id\}\/\$\{action\}`/);
    expect(page).toMatch(/apiClient\.post\("\/owner\/assign-deal"/);
    expect(page).not.toMatch(/apiClient\.patch\(`\/nodes/);   // the wholesale-replace trap stays out
  });
});

describe("agent controls — the dial is gated, the spend is real and paged", () => {
  const decisionsSrc = readFileSync(join(__dirname, "../routes/decisions.ts"), "utf8");
  const ownerSrc2 = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
  const page2 = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/owner-console.tsx"), "utf8");

  it("PATCH /decisions/autonomy is admin-only — it decides whether agents write unattended", () => {
    // Found while wiring the dial: only requireAuth gated it, so ANY member could flip the
    // workspace to autonomous.
    expect(decisionsSrc).toMatch(/router\.patch\("\/autonomy", requireAdminRole/);
  });

  it("AI spend aggregates ai_usage with PAGED reads", () => {
    expect(ownerSrc2).toMatch(/from\("ai_usage"\)[\s\S]{0,200}\.range\(from, from \+ PAGE - 1\)/);
  });

  it("switching to autonomous requires an explicit confirm", () => {
    expect(page2).toMatch(/l\.key === "autonomous" && !window\.confirm/);
    expect(page2).toMatch(/apiClient\.patch\("\/decisions\/autonomy"/);
  });
});

describe("the owner memo — code counts, AI narrates", () => {
  const src = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
  const page3 = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/owner-console.tsx"), "utf8");

  it("is grounded in the console's own payload builder — same numbers, structurally", () => {
    const memo = src.slice(src.indexOf('router.post("/memo"'));
    expect(memo).toMatch(/await buildConsolePayload\(ws\)/);
    expect(memo).toMatch(/prompt: JSON\.stringify\(payload\)/);   // the payload IS the only context
    expect(src).toMatch(/router\.post\("\/memo", requireAdminRole/);
  });

  it("forbids the model from computing — only numbers in the JSON", () => {
    expect(src).toMatch(/Never compute, extrapolate, or invent a figure/);
  });

  it("degrades to the deterministic memo, flagged honestly", () => {
    expect(src).toMatch(/export function deterministicMemo/);
    expect(src).toMatch(/return c\.json\(\{ memo: fallback, ai: false/);
  });

  it("is metered and attributed", () => {
    expect(src).toMatch(/feature: "owner_memo"/);
  });

  it("is a POST behind a button — never auto-fired on page load", () => {
    expect(page3).toMatch(/useMutation<\{ memo: string; ai: boolean/);
    expect(page3).not.toMatch(/useQuery[^)]*owner\/memo/);
  });
});

describe("chain-of-thought never ships as an answer", () => {
  it("aiGatewayComplete returns empty on empty content — not the reasoning channel", () => {
    // The first live memo shipped "We need to produce 3 short paragraphs…" — the model's raw
    // thinking — because content was empty (token budget exhausted mid-thought) and the fallback
    // returned `reasoning`. Empty is honest; every caller has a deterministic fallback.
    const gw = readFileSync(join(__dirname, "../lib/ai-gateway.ts"), "utf8");
    expect(gw).toMatch(/return m\?\.content\?\.trim\(\) \? m\.content : "";/);
    expect(gw).not.toMatch(/m\?\.reasoning \?\? ""/);
  });
  it("the memo gives the reasoning model headroom to finish thinking", () => {
    const src2 = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
    expect(src2).toMatch(/maxTokens: 2500/);
  });
});
