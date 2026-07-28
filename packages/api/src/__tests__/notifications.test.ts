import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildNotificationPayload, categorizeNotification, extractSource } from "../lib/notify";

/**
 * Notification audit-trail tests: source links are folded/extracted correctly, categorization is
 * deterministic, read/unread + workspace scoping are preserved, and nothing is fabricated.
 */

describe("buildNotificationPayload — source folding + invariants", () => {
  it("folds structured source into metadata and lifts task_id to the top level", () => {
    const p = buildNotificationPayload({
      workspace_id: "ws1", title: "Cold deal", type: "alert",
      source: { source_agent: "signal", agent_job_id: "job1", node_id: "n1", object_type: "deal", task_id: "t1" },
    });
    const meta = p.metadata as Record<string, unknown>;
    expect(meta.source_agent).toBe("signal");
    expect(meta.agent_job_id).toBe("job1");
    expect(meta.node_id).toBe("n1");
    expect(p.task_id).toBe("t1");           // lifted for the deep-link resolver
    expect(p.workspace_id).toBe("ws1");     // always scoped
    expect(p.is_read).toBe(false);          // read/unread behavior preserved
  });

  it("never fabricates a source: empty/absent source → no metadata block", () => {
    const p = buildNotificationPayload({ workspace_id: "ws1", title: "hi" });
    expect(p.metadata).toBeUndefined();
    const p2 = buildNotificationPayload({ workspace_id: "ws1", title: "hi", source: { source_agent: null, node_id: undefined } });
    expect(p2.metadata).toBeUndefined();    // all-empty source is compacted away
  });

  it("explicit metadata wins over a source key of the same name", () => {
    const p = buildNotificationPayload({
      workspace_id: "ws1", title: "x",
      metadata: { node_id: "explicit" }, source: { node_id: "from_source" },
    });
    expect((p.metadata as Record<string, unknown>).node_id).toBe("explicit");
  });

  it("preserves record_name and body", () => {
    const p = buildNotificationPayload({ workspace_id: "ws1", title: "t", body: "b", record_name: "Acme" });
    expect(p.body).toBe("b");
    expect(p.record_name).toBe("Acme");
  });
});

describe("categorizeNotification — the five bell groups", () => {
  const cases: Array<[string, Parameters<typeof categorizeNotification>[0], string]> = [
    ["message → messages", { type: "message" }, "messages"],
    ["decision id → decisions", { type: "agent", metadata: { decision_id: "d1" } }, "decisions"],
    ["alert type → decisions", { type: "alert" }, "decisions"],
    ["task_id → tasks", { type: "agent", task_id: "t1" }, "tasks"],
    ["agent finding → agent", { type: "agent", metadata: { source_agent: "asset" } }, "agent"],
    ["plain agent → agent", { type: "agent" }, "agent"],
    ["system default → system", { type: "system" }, "system"],
    ["readiness → system", { type: "readiness" }, "system"],
  ];
  for (const [name, row, expected] of cases) {
    it(name, () => expect(categorizeNotification(row)).toBe(expected));
  }

  it("precedence: decision beats agent when both signals present", () => {
    expect(categorizeNotification({ type: "agent", metadata: { source_agent: "finance", decision_id: "d1" } })).toBe("decisions");
  });
});

describe("extractSource — compacted audit links, snake/camel tolerant", () => {
  it("reads node/decision/agent links from metadata + top-level task_id", () => {
    const s = extractSource({ task_id: "t9", metadata: { source_agent: "signal", nodeId: "n2", decisionId: "d2", object_type: "deal" } });
    expect(s.source_agent).toBe("signal");
    expect(s.node_id).toBe("n2");        // camelCase tolerated
    expect(s.decision_id).toBe("d2");
    expect(s.task_id).toBe("t9");
    expect(s.object_type).toBe("deal");
  });
  it("returns an empty object (no fabricated keys) when nothing is present", () => {
    expect(extractSource({ metadata: null })).toEqual({});
  });
});

describe("producer source metadata → categorization + deep-link folding", () => {
  // Each entry mirrors exactly what a producer now emits (type + source), and the group the
  // bell/page should file it under. This locks the remaining producers' provenance behavior.
  const producers: Array<{ name: string; type: string; source: Record<string, unknown>; category: string }> = [
    { name: "daily-brief (Insights)",     type: "daily_brief", source: { source_agent: "insights", route: "/home" }, category: "agent" },
    { name: "discovery sweep",            type: "agent",       source: { source_agent: "prospecting", route: "/decisions" }, category: "agent" },
    { name: "discovery monitor",          type: "agent",       source: { source_agent: "prospecting", route: "/discovery" }, category: "agent" },
    { name: "workflow notify",            type: "agent",       source: { source_agent: "workflow", node_id: "n1", object_type: "deal" }, category: "agent" },
    { name: "enrich record",              type: "agent",       source: { source_agent: "graph-enrichment", agent_job_id: "j1", node_id: "n2" }, category: "agent" },
    { name: "cold-deal alert (Signal)",   type: "alert",       source: { source_agent: "signal", decision_id: "d1", node_id: "n3", object_type: "deal" }, category: "decisions" },
    { name: "deal stage change (human)",  type: "deal_stage",  source: { node_id: "n4", object_type: "deal" }, category: "system" },
    { name: "credit note review",         type: "credit_note", source: { node_id: "cn1", object_type: "credit_note" }, category: "system" },
  ];

  for (const p of producers) {
    it(`${p.name} → ${p.category}`, () => {
      const payload = buildNotificationPayload({ workspace_id: "ws1", title: p.name, type: p.type, source: p.source as never });
      // source folded into metadata → categorization sees it
      expect(categorizeNotification(payload as never)).toBe(p.category);
      // audit links survive extraction
      const src = extractSource(payload as never);
      if (p.source.source_agent) expect(src.source_agent).toBe(p.source.source_agent);
      if (p.source.node_id) expect(src.node_id).toBe(p.source.node_id);
    });
  }

  it("cold-deal alert carries decision_id into metadata for deep-linking", () => {
    const payload = buildNotificationPayload({
      workspace_id: "ws1", title: "🥶 Cold deal", type: "alert",
      source: { source_agent: "signal", decision_id: "dec_123", node_id: "n1", object_type: "deal" },
    });
    expect((payload.metadata as Record<string, unknown>).decision_id).toBe("dec_123");
    expect(extractSource(payload as never).decision_id).toBe("dec_123");
    expect(categorizeNotification(payload as never)).toBe("decisions");
  });

  it("a null decision_id (insert failed) does not fabricate a link", () => {
    const payload = buildNotificationPayload({
      workspace_id: "ws1", title: "🥶 Cold deal", type: "alert",
      source: { source_agent: "signal", decision_id: null, node_id: "n1", object_type: "deal" },
    });
    expect((payload.metadata as Record<string, unknown>).decision_id).toBeUndefined();
    expect(extractSource(payload as never).decision_id).toBeUndefined();
  });
});

describe("full page grouping assumptions — every notification lands in exactly one group", () => {
  it("categorize returns one of the five known keys for any input", () => {
    const KEYS = new Set(["agent", "decisions", "messages", "tasks", "system"]);
    const samples = [
      { type: "message" }, { type: "alert" }, { type: "agent", task_id: "t" },
      { type: "agent", metadata: { source_agent: "asset" } }, { type: "daily_brief" },
      { type: "deal_stage" }, { type: "credit_note" }, { type: undefined as unknown as string }, {},
    ];
    for (const s of samples) expect(KEYS.has(categorizeNotification(s as never))).toBe(true);
  });
});

describe("read/unread behavior preserved", () => {
  it("every built payload starts unread with a null read_at", () => {
    const p = buildNotificationPayload({ workspace_id: "ws1", title: "x", type: "agent", source: { source_agent: "signal" } });
    expect(p.is_read).toBe(false);
    expect(p.read_at).toBeNull();
  });
});

describe("workspace isolation — notifications route stays scoped", () => {
  it("every notifications query filters by workspace_id", () => {
    const src = readFileSync(fileURLToPath(new URL("../routes/notifications.ts", import.meta.url)), "utf8");
    // Every notifications table op must be workspace-scoped: reads/updates/deletes via
    // .eq("workspace_id", workspaceId); the insert via a workspace_id: workspaceId payload field.
    const ops = (src.match(/\.from\("notifications"\)/g) ?? []).length;
    const eqGuards = (src.match(/\.eq\("workspace_id", workspaceId\)/g) ?? []).length;
    const insertGuards = (src.match(/workspace_id: workspaceId/g) ?? []).length;
    expect(ops).toBeGreaterThan(0);
    expect(eqGuards + insertGuards).toBeGreaterThanOrEqual(ops); // no op without a workspace scope
  });
});

/**
 * The list route used to hardcode .limit(100) while callers (Home, the agent dock)
 * asked for ?limit=50 — the parameter was silently ignored.
 */
describe("GET /notifications honours ?limit", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../routes/notifications.ts", import.meta.url)),
    "utf8",
  );

  it("reads the limit query param instead of hardcoding a page size", () => {
    expect(src).toMatch(/c\.req\.query\("limit"\)/);
    expect(src).toMatch(/\.limit\(limit\)/);
    expect(src).not.toMatch(/\.limit\(100\)/);
  });

  it("clamps the value so a bad limit can't become an unbounded scan", () => {
    expect(src).toMatch(/Math\.min\(Math\.max\(requested, 1\), 200\)/);
    // callers that omit it keep the previous default
    expect(src).toMatch(/Number\.isFinite\(requested\) \? .* : 100/);
  });
});

/**
 * Tasks surface — field-contract bugs found in the Tasks audit. These were real
 * crashes/500s in production, so they get guards.
 */
describe("Tasks field contracts (audit fixes)", () => {
  const panel = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/tasks/task-detail-panel.tsx", import.meta.url)), "utf8");
  const details = readFileSync(fileURLToPath(new URL("../routes/task-details.ts", import.meta.url)), "utf8");
  const reviewTab = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/tasks/task-review-tab.tsx", import.meta.url)), "utf8");
  const tasksPage = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/tasks.tsx", import.meta.url)), "utf8");

  it("comments use the `body` column end to end (posting used to 500, reading used to crash)", () => {
    expect(panel).toMatch(/interface Comment \{ id: string; body: string;/);
    expect(panel).toMatch(/\/comments`, \{ body: newComment, user_name: userName \}/);
    expect(panel).toMatch(/renderContent\(comment\.body\)/);
    expect(panel).not.toMatch(/comment\.content/);
    expect(details).toMatch(/payload\.body \?\? payload\.content \?\? ""/);
    expect(details).toMatch(/Comment body is required/);
    expect(details).not.toMatch(/body\.body\.slice/);
  });

  it("task views return a resolved user_name and never throw on a missing one", () => {
    expect(details).toMatch(/from\("workspace_members"\)\.select\("user_id, name, email"\)/);
    expect(details).toMatch(/user_name: names\.get\(r\.user_id\) \|\| ""/);
    expect(panel).not.toMatch(/\{v\.user_name\.charAt/);
    expect(panel).toMatch(/\(v\.user_name \|\| "\?"\)\.charAt/);
  });

  it("review timestamps fall back to created_at instead of rendering Invalid Date", () => {
    expect(reviewTab).toMatch(/function reviewWhen/);
    expect(reviewTab).toMatch(/r\.sent_at \?\? r\.created_at/);
    expect(reviewTab).not.toMatch(/new Date\(review\.sent_at\)/);
  });

  it("detail-panel edits invalidate a key that actually matches the list", () => {
    expect(tasksPage).toMatch(/const listKey = \["tasks", filter, labelFilter, priorityFilter, sortBy, sortDir\]/);
    expect(tasksPage).toMatch(/invalidateQueries\(\{ queryKey: \["tasks"\] \}\)/);
  });

  it("task creation records created_by so the `mine` filter can find it", () => {
    const tasksRoute = readFileSync(fileURLToPath(new URL("../routes/tasks.ts", import.meta.url)), "utf8");
    // the filter has always matched assignee OR author...
    expect(tasksRoute).toMatch(/filter === "mine"\) query = query\.or\(`assignee_id\.eq\.\$\{userId\},created_by\.eq\.\$\{userId\}`\)/);
    // ...but the insert never wrote the author until now
    expect(tasksRoute).toMatch(/created_by: userId,/);
  });

  it("board and sheet views surface load errors instead of an empty state", () => {
    const m = tasksPage.match(/query\.isError \? \(\s*<ErrorState/g) ?? [];
    expect(m.length).toBeGreaterThanOrEqual(2);
  });

  it("Enter-to-create respects the same pending guard as the button", () => {
    expect(tasksPage).toMatch(/if \(e\.key === "Enter" && title\.trim\(\) && !create\.isPending\) create\.mutate\(\);/);
  });

  it("task file upload actually exists and is workspace-scoped + signed", () => {
    expect(details).toMatch(/router\.post\("\/:id\/upload"/);
    expect(details).toMatch(/TASK_ATTACH_BUCKET = "task-attachments"/);
    expect(details).toMatch(/router\.get\("\/:id\/attachments\/:attachmentId\/download"/);
    expect(details).toMatch(/createSignedUrl\(path, 120\)/);
  });

  it("attachments use the real column names and surface upload failures", () => {
    expect(panel).toMatch(/interface Attachment \{ id: string; name: string; url: string; size: number;/);
    expect(panel).not.toMatch(/a\.file_url|a\.file_name|a\.file_size/);
    expect(panel).toMatch(/setUploadError/);
  });

  it("due dates round-trip through local time without drifting", () => {
    expect(tasksPage).toMatch(/const toLocalInputValue = /);
    expect(tasksPage).toMatch(/d\.getTime\(\) - d\.getTimezoneOffset\(\) \* 60000/);
    expect(tasksPage).toMatch(/due_date: fromLocalInputValue\(dueDate\)/);
    // the old UTC-into-datetime-local bug and the naive ":00" write are gone
    expect(tasksPage).not.toMatch(/new Date\(task\.due_date\)\.toISOString\(\)\.slice\(0,16\)/);
    expect(tasksPage).not.toMatch(/dueDate \+ ":00"/);
  });

  it("pending decisions are fetched once, not under three separate keys", () => {
    const strip = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/ai/finance-agent-strip.tsx", import.meta.url)), "utf8");
    expect(tasksPage).not.toMatch(/\["decisions", "pending", "task"\]/);
    expect(strip).not.toMatch(/\["decisions", "pending", "finance"\]/);
    expect(tasksPage).toMatch(/queryKey: \["decisions", "pending"\]/);
    expect(strip).toMatch(/queryKey: \["decisions", "pending"\]/);
  });

  it("zero-valued counts never render as a literal 0", () => {
    expect(tasksPage).toMatch(/\{!!f\.badge && filter !== f\.key/);
    expect(tasksPage).toMatch(/\{!!t\.due_days &&/);
  });
});
