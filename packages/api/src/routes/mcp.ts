// Mondaily MCP server — exposes a single workspace's graph to external AI clients
// (Claude Desktop, IDEs, etc.) over the MCP Streamable-HTTP transport (JSON-RPC
// 2.0 over POST). Auth is a per-workspace `msk_…` key in the Authorization header
// — NOT Clerk — so this router does its own auth and is mounted outside requireAuth.
import { Hono } from "hono";
import { supabase } from "@mondaily/db/client";
import { orFilterValue } from "../lib/pgrst-filter";
import { verifyMcpToken } from "../lib/mcp-token";

const router = new Hono();

const TOOLS = [
  {
    name: "search_records",
    description: "Search the workspace graph (contacts, companies, deals, tasks, invoices, notes, etc.) by keyword. Returns matching records with their id, type, and name.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Keyword(s) to search for" }, limit: { type: "number", description: "Max results (default 10, max 50)" } }, required: ["query"] },
  },
  {
    name: "get_record",
    description: "Fetch a single record from the workspace graph by its id, including its full data.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_recent",
    description: "List the most recently updated records, optionally filtered by object_type (e.g. 'contact', 'deal', 'task', 'invoice').",
    inputSchema: { type: "object", properties: { object_type: { type: "string" }, limit: { type: "number" } }, required: [] },
  },
];

type Node = { id: string; object_type: string; vertical?: string; data: Record<string, unknown>; updated_at?: string; lead_score?: number | null; relationship_health?: number | null };

function summarize(n: Node) {
  const d = (n.data ?? {}) as Record<string, unknown>;
  return { id: n.id, type: n.object_type, name: d.name ?? d.title ?? d.full_name ?? d.company ?? null, updated_at: n.updated_at };
}
// Defang PostgREST OR-filter metacharacters so a query can't break out of the filter.
// Was a local strip of the same PostgREST grammar that search.ts handled differently and
// emails.ts not at all. One helper now, so the fourth call site cannot get it wrong.
const clean = (s: string) => orFilterValue(s);

async function runTool(workspaceId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "search_records") {
    const q = clean(String(args.query ?? ""));
    const limit = Math.min(Number(args.limit) || 10, 50);
    if (!q) return [];
    const { data } = await supabase.from("nodes")
      .select("id,object_type,vertical,data,updated_at")
      .eq("workspace_id", workspaceId)
      .or(`data->>name.ilike.%${orFilterValue(q)}%,data->>title.ilike.%${orFilterValue(q)}%,data->>company.ilike.%${orFilterValue(q)}%,data->>full_name.ilike.%${orFilterValue(q)}%`)
      .order("updated_at", { ascending: false }).limit(limit);
    return (data ?? []).map((n) => summarize(n as Node));
  }
  if (name === "get_record") {
    const { data } = await supabase.from("nodes")
      .select("id,object_type,vertical,data,updated_at,lead_score,relationship_health")
      .eq("workspace_id", workspaceId).eq("id", String(args.id ?? "")).maybeSingle();
    if (!data) return { error: "Record not found in this workspace" };
    return { ...summarize(data as Node), lead_score: (data as Node).lead_score ?? null, data: (data as Node).data };
  }
  if (name === "list_recent") {
    const limit = Math.min(Number(args.limit) || 10, 50);
    let q = supabase.from("nodes").select("id,object_type,vertical,data,updated_at").eq("workspace_id", workspaceId);
    if (args.object_type) q = q.ilike("object_type", `%${clean(String(args.object_type))}%`);
    const { data } = await q.order("updated_at", { ascending: false }).limit(limit);
    return (data ?? []).map((n) => summarize(n as Node));
  }
  throw new Error(`Unknown tool: ${name}`);
}

interface RpcMsg { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

router.post("/", async (c) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const workspaceId = verifyMcpToken(token);
  const body = await c.req.json().catch(() => null) as RpcMsg | RpcMsg[] | null;

  const handle = async (msg: RpcMsg | null): Promise<object | null> => {
    const id = msg?.id ?? null;
    const method = msg?.method;
    const isNotification = msg?.id === undefined || msg?.id === null;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      if (method === "initialize") {
        return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mondaily", version: "1.0.0" } });
      }
      if (method?.startsWith("notifications/")) return null; // notifications get no response
      if (method === "ping") return reply({});
      // Everything below touches workspace data → require a valid key.
      if (!workspaceId) return fail(-32001, "Unauthorized: invalid or missing MCP key");
      if (method === "tools/list") return reply({ tools: TOOLS });
      if (method === "tools/call") {
        const out = await runTool(workspaceId, String(msg?.params?.name ?? ""), (msg?.params?.arguments as Record<string, unknown>) ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      }
      if (isNotification) return null;
      return fail(-32601, `Method not found: ${method}`);
    } catch (e) {
      return fail(-32603, e instanceof Error ? e.message : String(e));
    }
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const res = await handle(body);
  return res ? c.json(res) : c.body(null, 202);
});

// Some clients probe the endpoint with GET first.
router.get("/", (c) => c.json({ name: "mondaily-mcp", transport: "streamable-http", protocolVersion: "2024-11-05" }));

export { router as mcpRouter };
