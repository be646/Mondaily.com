import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { graphDedupeKey, buildLeadTask, buildLeadDecision } from "../lib/discovery-pipeline";

describe("graphDedupeKey — domain-or-name entity resolution", () => {
  it("prefers the domain (host, www-stripped, lowercased)", () => {
    expect(graphDedupeKey("Acme Inc", "https://www.Acme.com/x")).toBe("acme.com");
    expect(graphDedupeKey("Acme", undefined, "http://acme.com/page")).toBe("acme.com");
  });
  it("falls back to the normalized name when no URL", () => {
    expect(graphDedupeKey("  Acme Inc  ")).toBe("acme inc");
  });
  it("two records for the same domain collide (dedupe)", () => {
    expect(graphDedupeKey("Acme", "acme.com")).toBe(graphDedupeKey("Acme Corp", "https://acme.com/contact"));
  });
  it("empty when nothing usable", () => {
    expect(graphDedupeKey()).toBe("");
    expect(graphDedupeKey("", "", "")).toBe("");
  });
});

describe("buildLeadTask — follow-up task payload", () => {
  it("defaults title, assignee, priority, status and links the record", () => {
    const t = buildLeadTask({ workspaceId: "ws1", userId: "u1", name: "Acme", node_id: "n1", source_url: "https://acme.com" });
    expect(t.workspace_id).toBe("ws1");
    expect(t.title).toBe("Follow up on Acme");
    expect(t.assignee_id).toBe("u1");         // defaults to creator
    expect(t.priority).toBe("medium");
    expect(t.status).toBe("todo");
    expect(t.completed).toBe(false);
    expect(t.record_id).toBe("n1");
    expect(t.notes).toMatch(/acme\.com/);
  });
  it("honors an explicit assignee, title, due date and priority", () => {
    const t = buildLeadTask({ workspaceId: "ws1", userId: "u1", name: "Acme", assignee_id: "u2", title: "Call them", due_date: "2026-08-01", priority: "high" });
    expect(t.assignee_id).toBe("u2");
    expect(t.title).toBe("Call them");
    expect(t.due_date).toBe("2026-08-01");
    expect(t.priority).toBe("high");
    expect(t.record_id).toBeNull();
  });
});

describe("buildLeadDecision — discovered-lead decision payload", () => {
  it("uses the discovery agent + discovered_lead source and grounds evidence in the lead", () => {
    const d = buildLeadDecision({ workspaceId: "ws1", name: "Acme", node_id: "n1", email: "a@acme.com", source_url: "https://acme.com", summary: "asked for a quote" });
    expect(d.agent_name).toBe("discovery");
    expect(d.source_type).toBe("discovered_lead");
    expect(d.source_id).toBe("n1");
    expect(d.title).toBe("Review lead: Acme");
    expect(d.risk_level).toBe("low");
    const ev = (d.evidence as Array<Record<string, any>>)[0];
    expect(ev.type).toBe("discovered_lead");
    expect(ev.lead.email).toBe("a@acme.com");
    expect(ev.lead.source_url).toBe("https://acme.com");
  });
  it("does not fabricate contact fields (null when absent)", () => {
    const d = buildLeadDecision({ workspaceId: "ws1", name: "Acme" });
    const ev = (d.evidence as Array<Record<string, any>>)[0];
    expect(ev.lead.email).toBeNull();
    expect(ev.lead.phone).toBeNull();
  });
});

describe("workspace isolation + wiring (source-read guards)", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/discovery.ts", import.meta.url)), "utf8");
  it("/save dedupes against the workspace's graph before creating", () => {
    expect(src).toMatch(/const key = graphDedupeKey\(b\.name, website, b\.source_url\)/);
    expect(src).toMatch(/from\("nodes"\)\.select\("id, data"\)\.eq\("workspace_id", workspaceId\)\.eq\("object_type", b\.object_type\)/);
    expect(src).toMatch(/existed: true/);
  });
  it("/save sets a real owner (param or the saver)", () => {
    expect(src).toMatch(/owner_id: b\.owner_id \|\| userId/);
  });
  it("addToList is workspace-scoped", () => {
    expect(src).toMatch(/from\("lists"\)\.select\("id"\)\.eq\("workspace_id", workspaceId\)\.eq\("id", listId\)/);
  });
  it("lead-task and lead-decision endpoints exist and use the pure builders", () => {
    expect(src).toMatch(/router\.post\("\/lead-task"/);
    expect(src).toMatch(/buildLeadTask\(\{ workspaceId: c\.get\("workspaceId"\), userId: c\.get\("userId"\)/);
    expect(src).toMatch(/router\.post\("\/lead-decision"/);
    expect(src).toMatch(/buildLeadDecision\(\{ workspaceId: c\.get\("workspaceId"\)/);
  });
  it("save-batch reports already_existed with node ids (via partitionSaveBatch)", () => {
    // Classification moved into the pure, unit-tested partitionSaveBatch helper.
    expect(src).toMatch(/partitionSaveBatch\(leads, existingByKey\)/);
    const lib = readFileSync(fileURLToPath(new URL("../lib/discovery-pipeline.ts", import.meta.url)), "utf8");
    expect(lib).toMatch(/already_existed\.push\(\{ name: b\.name, node_id: existingByKey\.get\(k\)! \}\)/);
  });
  it("save-batch adds BOTH created and already-existing matches to the list", () => {
    expect(src).toMatch(/for \(const id of \[\.\.\.ids, \.\.\.already_existed\.map\(\(a\) => a\.node_id\)\]\) await addToList/);
  });
});

describe("bulk task/decision endpoints — per-lead status + isolation (source-read)", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/discovery.ts", import.meta.url)), "utf8");
  it("bulk-task creates one task per lead and reports per-lead ok/error", () => {
    expect(src).toMatch(/router\.post\("\/bulk-task"/);
    expect(src).toMatch(/buildLeadTask\(\{ workspaceId, userId, name: b\.name/);
    expect(src).toMatch(/\{ name: b\.name, ok: false, error: error\.message \}/);
    // created/failed tally moved into the pure, unit-tested bulkOutcome helper.
    expect(src).toMatch(/return c\.json\(\{ \.\.\.bulkOutcome\(results\), results \}\)/);
  });
  it("bulk-decision creates one decision per lead with per-lead status", () => {
    expect(src).toMatch(/router\.post\("\/bulk-decision"/);
    expect(src).toMatch(/buildLeadDecision\(\{ workspaceId, name: b\.name/);
  });
  it("assign-owner updates a saved node's owner, workspace-scoped", () => {
    expect(src).toMatch(/router\.post\("\/assign-owner"/);
    expect(src).toMatch(/from\("nodes"\)\.select\("id, data"\)\.eq\("workspace_id", workspaceId\)\.eq\("id", node_id\)/);
    expect(src).toMatch(/\.update\(\{ data: nextData \}\)\.eq\("workspace_id", workspaceId\)\.eq\("id", node_id\)/);
    expect(src).toMatch(/owner_id: owner_id \?\? null/);
  });
  it("bulk endpoints are workspace-scoped (workspaceId from context, not client)", () => {
    // Both pull workspaceId from c.get, never from the request body.
    const bulk = src.slice(src.indexOf('router.post("/bulk-task"'));
    expect(bulk).toMatch(/const workspaceId = c\.get\("workspaceId"\)/);
    expect(bulk).not.toMatch(/workspace_id:\s*b\./);
  });
});
