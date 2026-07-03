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
