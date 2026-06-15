import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import * as ubc from "@mondaily/db/ubc";
import { inngest } from "../lib/inngest";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

const importBodySchema = z.object({
  headers: z.array(z.string()),
  samples: z.array(z.array(z.string())), // first 3 rows for schema inference
  rows: z.array(z.array(z.string())),    // all rows to insert
  object_type: z.string().min(1),
  vertical: z.enum(["sales", "realestate", "hr", "finance", "investments", "tasks", "shared"]).default("shared"),
});

router.post("/", requireAuth, zValidator("json", importBodySchema), async (c) => {
  const { headers, samples, rows, object_type, vertical } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");

  // ── 1. Claude schema inference ───────────────────────────────────────────────
  let columnTypes: Record<string, string> = {};
  try {
    const sampleText = [headers.join(","), ...samples.map(r => r.join(","))].join("\n");
    const inferRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `You are a data schema expert. Given the following CSV headers and sample rows, classify each column as one of: Text, Number, Email, URL, Date, Status, Currency, Phone, Boolean.

CSV:
${sampleText}

Reply with ONLY a JSON object mapping each header to its type. Example: {"name":"Text","revenue":"Currency","active":"Boolean"}`,
        }],
      }),
    });
    if (inferRes.ok) {
      const inferJson = await inferRes.json() as { content?: Array<{ type: string; text?: string }> };
      const text = inferJson.content?.find(b => b.type === "text")?.text ?? "{}";
      const parsed = JSON.parse(text.trim());
      if (typeof parsed === "object" && parsed !== null) {
        columnTypes = parsed as Record<string, string>;
      }
    }
  } catch {
    // schema inference failed — fall back to Text for everything
  }

  // ── 2. Coerce values per inferred type ───────────────────────────────────────
  function coerce(value: string, type: string): unknown {
    const v = value.trim();
    if (!v) return null;
    switch (type) {
      case "Number":
      case "Currency": {
        const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
        return isNaN(n) ? v : n;
      }
      case "Boolean":
        return /^(true|yes|1|on)$/i.test(v);
      default:
        return v;
    }
  }

  // ── 3. Bulk insert ────────────────────────────────────────────────────────────
  const safeType = object_type.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
  const created: string[] = [];
  const errors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const data: Record<string, unknown> = {};
    headers.forEach((h, j) => {
      const key = h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (key) data[key] = coerce(row[j] ?? "", columnTypes[h] ?? "Text");
    });
    if (!data.name && !data.title && !data.email) {
      data.name = row[0] ?? `Row ${i + 1}`;
    }
    try {
      const node = await ubc.createNode({ workspace_id: workspaceId, created_by: userId, vertical, object_type: safeType, data });
      created.push(node.id!);
    } catch (e: any) {
      errors.push({ row: i + 1, error: e?.message ?? "unknown error" });
    }
  }

  // Auto-enrich enrichable record types after import (non-blocking)
  const ENRICHABLE = ["contact", "person", "people", "lead", "company", "account", "organization"];
  if (ENRICHABLE.some(t => safeType.toLowerCase().includes(t))) {
    for (const nodeId of created) {
      inngest.send({
        name: "crm/record.created",
        data: { workspaceId, nodeId, objectType: safeType, vertical, recordData: {} },
      }).catch(() => {});
    }
  }

  return c.json({ ok: true, created: created.length, errors, column_types: columnTypes, auto_enriching: ENRICHABLE.some(t => safeType.toLowerCase().includes(t)) }, 201);
});

export { router as importRouter };
