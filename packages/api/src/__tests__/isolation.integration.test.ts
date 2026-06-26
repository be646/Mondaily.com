/**
 * Cross-tenant isolation — REAL DB integration test (the IDOR proof).
 *
 * Opt-in only: runs solely when RUN_ISOLATION_TESTS=1 and SUPABASE creds are
 * present, so it never executes in CI or touches a database by accident. It
 * spins up two throwaway workspaces, then proves the ubc node accessors deny
 * cross-tenant access by id and only succeed within the owning workspace.
 *
 * Run:  RUN_ISOLATION_TESTS=1 SUPABASE_URL=… SUPABASE_SERVICE_KEY=… npx vitest run isolation
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// Relative imports (not the @mondaily/db alias) so vitest needs no path config.
import { createNode, getNode, updateNode, deleteNode } from "../../../db/src/ubc";
import { supabase } from "../../../db/src/client";

const RUN = process.env.RUN_ISOLATION_TESTS === "1" && !!process.env.SUPABASE_SERVICE_KEY;

describe.skipIf(!RUN)("cross-tenant isolation (integration)", () => {
  let wsA = "";
  let wsB = "";
  let nodeA = "";

  beforeAll(async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const a = await supabase.from("workspaces").insert({ name: "iso-test-A", slug: `iso-a-${stamp}`, plan: "free" }).select("id").single();
    const b = await supabase.from("workspaces").insert({ name: "iso-test-B", slug: `iso-b-${stamp}`, plan: "free" }).select("id").single();
    wsA = a.data!.id as string;
    wsB = b.data!.id as string;
    const n = await createNode({ workspace_id: wsA, vertical: "shared", object_type: "iso_probe", data: { secret: "A-only" } });
    nodeA = n.id!;
  });

  afterAll(async () => {
    if (wsA || wsB) await supabase.from("workspaces").delete().in("id", [wsA, wsB].filter(Boolean)); // cascade removes the node
  });

  it("same-tenant read succeeds", async () => {
    const n = await getNode(nodeA, wsA);
    expect(n).not.toBeNull();
    expect((n!.data as Record<string, unknown>).secret).toBe("A-only");
  });

  it("cross-tenant read is DENIED (returns null)", async () => {
    expect(await getNode(nodeA, wsB)).toBeNull();
  });

  it("cross-tenant update does NOT modify the row", async () => {
    await expect(updateNode(nodeA, wsB, { data: { secret: "HACKED" } })).rejects.toThrow();
    const n = await getNode(nodeA, wsA);
    expect((n!.data as Record<string, unknown>).secret).toBe("A-only"); // untouched
  });

  it("cross-tenant delete does NOT remove the row", async () => {
    await deleteNode(nodeA, wsB); // matches 0 rows → no-op
    expect(await getNode(nodeA, wsA)).not.toBeNull(); // still present
  });
});
