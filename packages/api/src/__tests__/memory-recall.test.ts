import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { supabase } from "@mondaily/db/client";
import { recallContext, memoryEnabled } from "../lib/memory-recall";

const recallSrc = readFileSync(fileURLToPath(new URL("../lib/memory-recall.ts", import.meta.url)), "utf8");
const routeSrc = readFileSync(fileURLToPath(new URL("../routes/memory.ts", import.meta.url)), "utf8");
const askSrc = readFileSync(fileURLToPath(new URL("../routes/ask.ts", import.meta.url)), "utf8");

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

/**
 * A chainable, thenable supabase stub. `tables` maps table name → rows to return. Query builders
 * accumulate .eq/.or filters; the terminal await resolves { data }. Records which workspace_ids
 * were filtered so we can prove scoping.
 */
function stubDb(tables: Record<string, Record<string, unknown>[]>, filters: { table: string; col: string; val: unknown }[]) {
  vi.spyOn(supabase, "from").mockImplementation((table: string) => {
    let rows = tables[table] ?? [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => { filters.push({ table, col, val }); if (col === "workspace_id") rows = rows.filter((r) => r.workspace_id === val); return b; },
      or: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
      then: (ok: (v: { data: unknown[] }) => void) => { ok({ data: rows }); },
    });
    return b as never;
  });
}

describe("Phase 2A — memory recall (shadow)", () => {
  it("flag defaults OFF: recall returns enabled:false + empties and does no source query", async () => {
    const filters: { table: string; col: string; val: unknown }[] = [];
    stubDb({ workspaces: [{ id: "ws1", settings: {} }] }, filters);   // no memory_enabled
    const r = await recallContext("ws1", "overdue invoice");
    expect(r.enabled).toBe(false);
    expect(r.candidates).toHaveLength(0);
    expect(r.candidate_count).toBe(0);
    // Only the flag lookup ran — no data-source table was queried.
    expect(filters.some((f) => ["nodes", "tasks", "decision_queue", "internal_messages"].includes(f.table))).toBe(false);
  });

  it("env kill-switch forces OFF even when the workspace flag is on", async () => {
    process.env.MEMORY_RECALL_DISABLED = "1";
    stubDb({ workspaces: [{ id: "ws1", settings: { memory_enabled: true } }] }, []);
    expect(await memoryEnabled("ws1")).toBe(false);
  });

  it("workspace isolation: recall only reads THIS workspace's rows (every source .eq workspace_id)", async () => {
    const filters: { table: string; col: string; val: unknown }[] = [];
    stubDb({
      workspaces: [{ id: "wsA", settings: { memory_enabled: true } }],
      nodes: [
        { id: "n1", object_type: "deal", data: { name: "Acme overdue invoice" }, workspace_id: "wsA", updated_at: "2026-07-10" },
        { id: "n2", object_type: "deal", data: { name: "Acme overdue invoice" }, workspace_id: "wsB", updated_at: "2026-07-10" }, // other workspace
      ],
      tasks: [], decision_queue: [], internal_messages: [],
    }, filters);
    const r = await recallContext("wsA", "acme overdue");
    // Only wsA's node comes back.
    expect(r.candidates.map((c) => c.source.id)).toEqual(["n1"]);
    // Every data-source query filtered by workspace_id = wsA.
    const wsFilters = filters.filter((f) => f.col === "workspace_id");
    expect(wsFilters.length).toBeGreaterThan(0);
    for (const f of wsFilters) expect(f.val).toBe("wsA");
  });

  it("every recalled fact carries a resolvable {type,id} source ref", async () => {
    stubDb({
      workspaces: [{ id: "ws", settings: { memory_enabled: true } }],
      nodes: [{ id: "n9", object_type: "company", data: { name: "Onboarding widget co" }, workspace_id: "ws", updated_at: "2026-07-10" }],
      tasks: [{ id: "t9", title: "Onboarding call", description: "", status: "open", workspace_id: "ws", updated_at: "2026-07-10" }],
      decision_queue: [], internal_messages: [],
    }, []);
    const r = await recallContext("ws", "onboarding");
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.source.type).toBeTruthy();
      expect(c.source.id).toBeTruthy();
    }
    expect(r.source_count).toBe(r.candidates.length);
  });

  it("no relevant facts → empty result (never fabricates context)", async () => {
    stubDb({
      workspaces: [{ id: "ws", settings: { memory_enabled: true } }],
      nodes: [{ id: "n1", object_type: "deal", data: { name: "Zephyr project" }, workspace_id: "ws", updated_at: "2026-07-10" }],
      tasks: [], decision_queue: [], internal_messages: [],
    }, []);
    const r = await recallContext("ws", "quarterly tax filing");
    expect(r.enabled).toBe(true);
    expect(r.candidates).toHaveLength(0);
  });

  it("messages are participant-scoped to the asking user (never another pair's DMs)", () => {
    // The message query ANDs workspace_id with an OR on sender/recipient = the caller.
    expect(recallSrc).toMatch(/\.from\("internal_messages"\)[\s\S]*?\.eq\("workspace_id", workspaceId\)[\s\S]*?\.or\(`sender_id\.eq\.\$\{scope\.userId\},recipient_id\.eq\.\$\{scope\.userId\}`\)/);
    // Messages only run when a userId is supplied.
    expect(recallSrc).toMatch(/if \(want\("message"\) && scope\.userId\)/);
  });

  it("snippets are redacted (secrets never surface in recalled context)", () => {
    expect(recallSrc).toMatch(/import \{ redactSecrets \} from "\.\/ai-gateway"/);
    expect(recallSrc).toMatch(/redactSecrets\(s\.replace/);
  });
});

describe("Phase 2A — admin gating + pure-read (recall library itself unchanged in 2B)", () => {
  // NOTE: as of Phase 2B, Ask DOES use recallContext — but ONLY behind the OFF-by-default flag via
  // buildAskMemory (empty ⇒ Ask identical to today). The Phase-2B wiring/gating is covered by
  // ask-memory-2b.test.ts. The recall LIBRARY remains a pure, flag-gated read (asserted below).
  it("Ask uses recall only through the flag-gated buildAskMemory (not a raw always-on call)", () => {
    // Shape changed in the speed pass: the three independent pre-flight reads (web search,
    // workspace profile, memory recall) now run in one Promise.all instead of in sequence. The
    // point of this guard — recall reaches Ask ONLY through the flag-gated helper, never as a raw
    // always-on call — is unchanged, so it asserts the call rather than its await position.
    expect(askSrc).toMatch(/buildAskMemory\(workspaceId, userId, message\)/);
    expect(askSrc).toMatch(/const \[webContext, profileBlock, memory\] = await Promise\.all\(/);
  });

  it("the recall + toggle endpoints are admin-gated", () => {
    expect(routeSrc).toMatch(/router\.get\("\/recall", requireAdminRole/);
    expect(routeSrc).toMatch(/router\.post\("\/settings", requireAdminRole/);
  });

  it("recall reads only existing source tables — it never writes or injects", () => {
    // No inserts/updates/deletes in the recall library (pure read).
    expect(recallSrc).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    // No LLM/gateway call in recall — shadow mode injects nothing.
    expect(recallSrc).not.toMatch(/aiGateway|aiGatewayToolUse|aiGatewayAgent/);
  });
});
