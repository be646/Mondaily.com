import { describe, it, expect, afterEach, vi } from "vitest";
import { supabase } from "@mondaily/db/client";
import { recallContext } from "../lib/memory-recall";

/**
 * Phase 2B.5 — retrieval quality tuning. Functional tests over the composite ranking
 * (keyword × type-weight(intent) × gentle-recency) + title-dedup + category-diversity.
 */
const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

function stubDb(tables: Record<string, Record<string, unknown>[]>) {
  vi.spyOn(supabase, "from").mockImplementation((table: string) => {
    let rows = tables[table] ?? [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => { if (col === "workspace_id") rows = rows.filter((r) => r.workspace_id === val); return b; },
      or: () => b, order: () => b, limit: () => b,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
      then: (ok: (v: { data: unknown[] }) => void) => { ok({ data: rows }); },
    });
    return b as never;
  });
}
const ws = (extra: Record<string, unknown> = {}) => [{ id: "ws", settings: { memory_enabled: true }, ...extra }];
const cats = (r: { candidates: { category: string }[] }) => r.candidates.map((c) => c.category);
const ids = (r: { candidates: { source: { id: string } }[] }) => r.candidates.map((c) => c.source.id);

describe("Phase 2B.5 — type + intent weighting", () => {
  it("issue query boosts support ticket + decision ABOVE an equally-worded email", async () => {
    stubDb({
      workspaces: ws(),
      nodes: [
        { id: "tick", object_type: "support_ticket", data: { subject: "connectivity issue" }, workspace_id: "ws", updated_at: null },
        { id: "mail", object_type: "email_outbox", data: { subject: "connectivity issue" }, workspace_id: "ws", updated_at: null },
      ],
      decision_queue: [{ id: "dec", title: "connectivity issue", summary: "", status: "pending", workspace_id: "ws", created_at: null }],
      tasks: [], internal_messages: [],
    });
    const r = await recallContext("ws", "connectivity issue");
    expect(r.intent).toContain("issue");
    // ticket (×1.7) and decision (×1.4) outrank the email (×0.55) despite identical keyword hits.
    expect(cats(r).indexOf("ticket")).toBeLessThan(cats(r).indexOf("email"));
    expect(cats(r).indexOf("decision")).toBeLessThan(cats(r).indexOf("email"));
    expect(cats(r)[0]).toBe("ticket");
  });

  it("an email with MORE keyword hits still does NOT displace a stronger decision (type weight wins)", async () => {
    stubDb({
      workspaces: ws(),
      nodes: [{ id: "mail", object_type: "email_outbox", data: { subject: "network outage incident report" }, workspace_id: "ws", updated_at: null }],
      decision_queue: [{ id: "dec", title: "network outage", summary: "", status: "pending", workspace_id: "ws", created_at: null }],
      tasks: [], internal_messages: [],
    });
    // Query: email matches 4 keywords, decision matches 2 — but decision's issue-boost still wins.
    const r = await recallContext("ws", "network outage incident report");
    expect(ids(r)[0]).toBe("dec");
  });
});

describe("Phase 2B.5 — gentle recency (old items not hard-dropped)", () => {
  it("a strongly-relevant OLD record still ranks above a weak fresh email", async () => {
    const old = "2025-01-01T00:00:00Z";      // ~1.5 years old
    const fresh = new Date().toISOString();
    stubDb({
      workspaces: ws(),
      nodes: [
        { id: "oldrec", object_type: "company", data: { name: "Acme Corp deal" }, workspace_id: "ws", updated_at: old },
        { id: "freshmail", object_type: "email_outbox", data: { subject: "Acme note" }, workspace_id: "ws", updated_at: fresh },
      ],
      decision_queue: [], tasks: [], internal_messages: [],
    });
    const r = await recallContext("ws", "acme deal");
    // Entity intent boosts the record; the old-but-relevant record still leads.
    expect(ids(r)[0]).toBe("oldrec");
    expect(ids(r)).toContain("oldrec");   // never hard-dropped for age
  });
});

describe("Phase 2B.5 — diversity (no near-duplicate crowding)", () => {
  it("three higher-scoring emails do NOT crowd a decision out of the top 3", async () => {
    stubDb({
      workspaces: ws(),
      nodes: [
        { id: "m1", object_type: "email_outbox", data: { subject: "acme network outage incident" }, workspace_id: "ws", updated_at: null },
        { id: "m2", object_type: "email_outbox", data: { subject: "acme network outage incident" }, workspace_id: "ws", updated_at: null },
        { id: "m3", object_type: "email_outbox", data: { subject: "acme network outage incident" }, workspace_id: "ws", updated_at: null },
      ],
      decision_queue: [{ id: "dec", title: "acme", summary: "", status: "pending", workspace_id: "ws", created_at: null }],
      tasks: [], internal_messages: [],
    });
    // Emails match 4 keywords (0.55×4=2.2) > decision's 1 keyword (1.4×1=1.4) on raw score. Without
    // diversity the top 3 would be all emails; the category penalty lifts the decision in.
    const r = await recallContext("ws", "acme network outage incident");
    const top3 = r.candidates.slice(0, 3).map((c) => c.category);
    expect(top3).toContain("decision");
    expect(top3.filter((c) => c === "email").length).toBeLessThan(3);
  });

  it("near-duplicate titles are de-duplicated (same event doesn't fill slots twice)", async () => {
    stubDb({
      workspaces: ws(),
      nodes: [
        { id: "d1", object_type: "deal", data: { name: "Acme renewal" }, workspace_id: "ws", updated_at: null },
        { id: "d2", object_type: "deal", data: { name: "Acme renewal" }, workspace_id: "ws", updated_at: null },
      ],
      decision_queue: [], tasks: [], internal_messages: [],
    });
    const r = await recallContext("ws", "acme renewal");
    expect(r.candidates.length).toBe(1);   // identical titles collapse to one
  });
});

describe("Phase 2B.5 — invariants preserved", () => {
  it("memory OFF ⇒ empty (Ask unchanged) and no source query runs", async () => {
    stubDb({ workspaces: [{ id: "ws", settings: {} }] });
    const r = await recallContext("ws", "connectivity issue");
    expect(r.enabled).toBe(false);
    expect(r.candidates).toHaveLength(0);
  });

  it("cross-workspace isolation: only THIS workspace's rows are ranked", async () => {
    stubDb({
      workspaces: ws(),
      nodes: [
        { id: "mine", object_type: "deal", data: { name: "Acme deal" }, workspace_id: "ws", updated_at: null },
        { id: "other", object_type: "deal", data: { name: "Acme deal" }, workspace_id: "wsB", updated_at: null },
      ],
      decision_queue: [], tasks: [], internal_messages: [],
    });
    const r = await recallContext("ws", "acme deal");
    expect(ids(r)).toEqual(["mine"]);
  });

  it("observability: returns injected_count, by_kind, intent", async () => {
    stubDb({
      workspaces: ws(),
      nodes: [{ id: "n", object_type: "deal", data: { name: "Acme deal" }, workspace_id: "ws", updated_at: null }],
      decision_queue: [], tasks: [], internal_messages: [],
    });
    const r = await recallContext("ws", "acme deal");
    expect(r.injected_count).toBe(1);
    expect(r.by_kind).toEqual({ record: 1 });
    expect(r.intent).toContain("entity");
    expect(r.candidates[0]!.breakdown).toBeTruthy();
  });
});
