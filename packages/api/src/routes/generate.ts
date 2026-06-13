import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

async function callAnthropic(body: object): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Anthropic API key not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
  return res.json();
}

// ─── Schema generation via tool_use (guarantees valid JSON) ───────────────────
router.post("/schema", requireAuth, zValidator("json", z.object({ prompt: z.string().min(1) })), async (c) => {
  const { prompt } = c.req.valid("json");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      tools: [{
        name: "create_object_schema",
        description: "Create a Mondaily object schema with attributes for the described use case",
        input_schema: {
          type: "object",
          properties: {
            singular: { type: "string", description: "Singular name e.g. Invoice" },
            plural:   { type: "string", description: "Plural name e.g. Invoices" },
            vertical: { type: "string", enum: ["sales","finance","hr","realestate","investments","shared"] },
            color:    { type: "string", enum: ["red","orange","amber","emerald","cyan","blue","violet","pink"] },
            description: { type: "string", description: "One-line description of what this tracks" },
            attributes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", enum: ["text","long_text","number","currency","percentage","date","datetime","checkbox","select","multi_select","url","email","phone"] }
                },
                required: ["name","type"]
              },
              minItems: 5,
              maxItems: 14
            }
          },
          required: ["singular","plural","vertical","color","attributes"]
        }
      }],
      tool_choice: { type: "tool", name: "create_object_schema" },
      messages: [{
        role: "user",
        content: `Create a comprehensive Mondaily object schema for: ${prompt}\n\nUse appropriate field types: currency for money, date for dates, checkbox for yes/no, select for status/category, percentage for rates, number for quantities.`
      }]
    });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No schema generated" }, 500);
    return c.json(toolUse.input);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── NLP command parsing ──────────────────────────────────────────────────────
router.post("/nlp", requireAuth, zValidator("json", z.object({
  query: z.string().min(1),
  columns: z.array(z.string()),
})), async (c) => {
  const { query, columns } = c.req.valid("json");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      tools: [{
        name: "parse_table_command",
        description: "Parse a natural language command into table filter/sort/calc operations",
        input_schema: {
          type: "object",
          properties: {
            filterText: { type: "string", description: "Text to filter rows by (substring match)" },
            sortCol:    { type: "string", description: `Column to sort by. Must be one of: ${columns.join(", ")}` },
            sortDir:    { type: "string", enum: ["asc","desc"] },
            calcOps: {
              type: "object",
              description: "Aggregation operations per column",
              additionalProperties: { type: "string", enum: ["sum","avg","min","max","count"] }
            }
          }
        }
      }],
      tool_choice: { type: "tool", name: "parse_table_command" },
      messages: [{
        role: "user",
        content: `Available columns: ${columns.join(", ")}\n\nParse this command: "${query}"\n\nOnly include fields that are clearly requested. sortCol must exactly match one of the available columns. filterText should be the value to search for, not the column name.`
      }]
    });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ filterText: "", sortCol: null, sortDir: "asc", calcOps: {} });
    return c.json({ filterText: "", sortCol: null, sortDir: "asc", calcOps: {}, ...toolUse.input });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Company enrichment via Tavily + Claude ───────────────────────────────────
router.post("/enrich/company", requireAuth, zValidator("json", z.object({ name: z.string() })), async (c) => {
  const { name } = c.req.valid("json");
  const tavilyKey = process.env.TAVILY_API_KEY;

  let webContext = "";
  if (tavilyKey) {
    try {
      const sr = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query: `${name} company funding employees ARR revenue`, max_results: 5, search_depth: "basic" })
      });
      if (sr.ok) {
        const sd = await sr.json() as any;
        webContext = (sd.results ?? []).slice(0, 4).map((r: any) => `${r.title}: ${r.content}`).join("\n");
      }
    } catch {}
  }

  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      tools: [{
        name: "enrich_company",
        description: "Extract company data fields from available information",
        input_schema: {
          type: "object",
          properties: {
            description:    { type: "string" },
            country:        { type: "string" },
            employee_range: { type: "string", description: "e.g. 1-10, 11-50, 51-200, 201-500, 500-1000, 1000+" },
            arr:            { type: "number", description: "Annual recurring revenue in USD" },
            funding_raised: { type: "number", description: "Total funding raised in USD" },
            website:        { type: "string" },
            industry:       { type: "string" }
          }
        }
      }],
      tool_choice: { type: "tool", name: "enrich_company" },
      messages: [{
        role: "user",
        content: `Enrich this company: "${name}"\n\n${webContext ? `Web search results:\n${webContext}\n\n` : ""}Extract what you know or can reasonably infer. Use null for fields you're uncertain about.`
      }]
    });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    const fields = toolUse?.input ?? {};
    // Strip nulls
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
    return c.json({ fields: clean, source: webContext ? "web" : "ai" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Person enrichment ────────────────────────────────────────────────────────
router.post("/enrich/person", requireAuth, zValidator("json", z.object({ email: z.string() })), async (c) => {
  const { email } = c.req.valid("json");
  const tavilyKey = process.env.TAVILY_API_KEY;
  const domain = email.split("@")[1] ?? "";

  let webContext = "";
  if (tavilyKey && domain) {
    try {
      const sr = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query: `${email} linkedin job title company`, max_results: 3, search_depth: "basic" })
      });
      if (sr.ok) {
        const sd = await sr.json() as any;
        webContext = (sd.results ?? []).slice(0, 3).map((r: any) => `${r.title}: ${r.content}`).join("\n");
      }
    } catch {}
  }

  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 384,
      tools: [{
        name: "enrich_person",
        description: "Extract person data fields",
        input_schema: {
          type: "object",
          properties: {
            company:   { type: "string" },
            job_title: { type: "string" },
            linkedin:  { type: "string" },
            location:  { type: "string" },
            twitter:   { type: "string" }
          }
        }
      }],
      tool_choice: { type: "tool", name: "enrich_person" },
      messages: [{
        role: "user",
        content: `Enrich this person: email = "${email}", domain = "${domain}"\n\n${webContext ? `Web context:\n${webContext}\n\n` : ""}Infer what you can from the email domain (company name, likely industry). Use null for unknowns.`
      }]
    });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    const fields = toolUse?.input ?? {};
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
    return c.json({ fields: clean, source: webContext ? "web" : "ai" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export { router as generateRouter };
