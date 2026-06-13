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

// ─── Bulk record generation ───────────────────────────────────────────────────
router.post("/records", requireAuth, zValidator("json", z.object({
  objectType: z.string().min(1),
  columns: z.array(z.string()).min(1),
  prompt: z.string().min(1),
  count: z.number().int().min(1).max(50).default(10),
})), async (c) => {
  const { objectType, columns, prompt, count } = c.req.valid("json");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      tools: [{
        name: "generate_records",
        description: "Generate realistic sample records for a database table",
        input_schema: {
          type: "object",
          properties: {
            records: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "object",
                description: "A single record. Keys must exactly match the provided columns.",
                additionalProperties: { type: "string" }
              }
            }
          },
          required: ["records"]
        }
      }],
      tool_choice: { type: "tool", name: "generate_records" },
      messages: [{
        role: "user",
        content: `Generate ${count} realistic ${objectType} records.\n\nContext: ${prompt}\n\nColumns to fill: ${columns.join(", ")}\n\nRules:\n- Every record must have a "name" field\n- Use realistic values appropriate for the object type and context\n- For currency/number columns use numeric strings (no symbols)\n- For date columns use YYYY-MM-DD format\n- For checkbox columns use "true" or "false"\n- For select columns pick a realistic category value\n- Leave optional fields empty string if not applicable\n- Make records varied and realistic, not just placeholders`
      }]
    });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input?.records) return c.json({ error: "No records generated" }, 500);
    return c.json({ records: toolUse.input.records });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI task suggestions ──────────────────────────────────────────────────────
router.post("/tasks", requireAuth, zValidator("json", z.object({
  prompt: z.string().min(1),
  count: z.number().int().min(1).max(20).default(5),
  members: z.array(z.object({ email: z.string(), name: z.string() })).optional(),
  records: z.array(z.object({ object_type: z.string(), data: z.record(z.unknown()) })).optional(),
})), async (c) => {
  const { prompt, count, members, records } = c.req.valid("json");
  const memberList = (members ?? []).map(m => `${m.name} <${m.email}>`).join(", ");
  const recordContext = (records ?? []).slice(0, 20).map(r =>
    `[${r.object_type}] ${Object.entries(r.data).slice(0,4).map(([k,v])=>`${k}=${v}`).join(", ")}`
  ).join("\n");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      tools: [{
        name: "suggest_tasks",
        description: "Suggest actionable tasks based on the given context",
        input_schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short actionable task title" },
                  notes: { type: "string", description: "Brief context or description" },
                  priority: { type: "string", enum: ["low","medium","high","urgent"] },
                  due_days: { type: "number", description: "Days from today until due (e.g. 3, 7, 14)" },
                  suggested_assignee_email: { type: "string", description: "Email of the best team member for this task, or empty string" },
                },
                required: ["title","priority"]
              }
            }
          },
          required: ["tasks"]
        }
      }],
      tool_choice: { type: "tool", name: "suggest_tasks" },
      messages: [{
        role: "user",
        content: `Suggest ${count} actionable tasks based on this context: "${prompt}"${recordContext ? `\n\nRelated records:\n${recordContext}` : ""}${memberList ? `\n\nTeam members: ${memberList}` : ""}\n\nMake tasks specific, actionable, and realistic. Set priority based on urgency. Set due_days (days from today) based on realistic timelines.`
      }]
    });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json({ tasks: toolUse?.input?.tasks ?? [] });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI insights ──────────────────────────────────────────────────────────────
router.post("/insights", requireAuth, zValidator("json", z.object({
  objectType: z.string().min(1),
  records: z.array(z.record(z.unknown())),
})), async (c) => {
  const { objectType, records } = c.req.valid("json");
  if (!records.length) return c.json({ insights: [] });
  const sample = records.slice(0, 50).map(r => {
    const d = (r as any).data ?? r;
    return Object.entries(d).slice(0,6).map(([k,v])=>`${k}=${v}`).join(", ");
  }).join("\n");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [{
        name: "generate_insights",
        description: "Analyze records and return business insights",
        input_schema: {
          type: "object",
          properties: {
            insights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  value: { type: "string", description: "The headline metric or finding" },
                  trend: { type: "string", enum: ["up","down","neutral"] },
                  description: { type: "string", description: "1-2 sentence explanation" },
                  category: { type: "string", enum: ["performance","risk","opportunity","summary"] }
                },
                required: ["title","value","description","category"]
              },
              minItems: 3,
              maxItems: 6
            }
          },
          required: ["insights"]
        }
      }],
      tool_choice: { type: "tool", name: "generate_insights" },
      messages: [{
        role: "user",
        content: `Analyze these ${records.length} ${objectType} records and generate 4-6 business insights.\n\nSample records:\n${sample}\n\nFocus on: totals, averages, distributions, patterns, anomalies, opportunities, and risks. Be specific with numbers where possible.`
      }]
    });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json({ insights: toolUse?.input?.insights ?? [] });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI sequence generator ────────────────────────────────────────────────────
router.post("/sequence", requireAuth, zValidator("json", z.object({
  prompt: z.string().min(1),
  steps: z.number().int().min(2).max(8).default(4),
})), async (c) => {
  const { prompt, steps } = c.req.valid("json");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      tools: [{
        name: "create_sequence",
        description: "Create an email outreach sequence with steps",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short descriptive sequence name" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["email"] },
                  subject: { type: "string", description: "Email subject line" },
                  body: { type: "string", description: "Email body in plain text. Use {first_name}, {company} as personalization tokens." },
                  delay_value: { type: "number", description: "Delay amount before sending this step" },
                  delay_unit: { type: "string", enum: ["hours","days"] },
                  send_as: { type: "string", enum: ["new","reply"], description: "Send as new thread or reply to previous" },
                },
                required: ["type","subject","body","delay_value","delay_unit","send_as"]
              },
              minItems: 2,
              maxItems: 8
            }
          },
          required: ["name","steps"]
        }
      }],
      tool_choice: { type: "tool", name: "create_sequence" },
      messages: [{
        role: "user",
        content: `Create a ${steps}-step email outreach sequence for: "${prompt}"\n\nGuidelines:\n- Step 1: delay_value=0 (send immediately), send_as="new"\n- Subsequent steps: reply to the thread (send_as="reply"), space them 2-5 days apart\n- Write conversational, personalized emails using {first_name} and {company} tokens\n- Keep emails short (3-5 sentences). Each email should have a clear purpose and single CTA\n- Last step should be a "closing the loop" breakup email`
      }]
    });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No sequence generated" }, 500);
    return c.json(toolUse.input);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI list name + object type picker ───────────────────────────────────────
router.post("/list-name", requireAuth, zValidator("json", z.object({
  prompt: z.string().min(1),
  objectTypes: z.array(z.string()),
})), async (c) => {
  const { prompt, objectTypes } = c.req.valid("json");
  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      tools: [{
        name: "name_list",
        description: "Generate a list name and pick the most appropriate object type",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short, descriptive list name (3-6 words)" },
            object_type: { type: "string", description: `The object type slug that best fits. Must be one of: ${objectTypes.join(", ")}` },
          },
          required: ["name","object_type"]
        }
      }],
      tool_choice: { type: "tool", name: "name_list" },
      messages: [{
        role: "user",
        content: `Generate a short list name and pick the best object type for: "${prompt}"\n\nAvailable object types: ${objectTypes.join(", ")}`
      }]
    });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json(toolUse?.input ?? { name: "New List", object_type: objectTypes[0] ?? "companies" });
  } catch {
    return c.json({ name: "New List", object_type: objectTypes[0] ?? "companies" });
  }
});

// ─── AI list-entry selector ───────────────────────────────────────────────────
router.post("/list-entries", requireAuth, zValidator("json", z.object({
  prompt: z.string().min(1),
  objectType: z.string().min(1),
  records: z.array(z.object({ id: z.string(), data: z.record(z.unknown()) })),
})), async (c) => {
  const { prompt, objectType, records } = c.req.valid("json");
  if (!records.length) return c.json({ selectedIds: [] });
  try {
    const recordSummary = records.map(r => `ID:${r.id} | ${Object.entries(r.data).slice(0,5).map(([k,v])=>`${k}=${v}`).join(", ")}`).join("\n");
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [{
        name: "select_records",
        description: "Select record IDs that match the user's description",
        input_schema: {
          type: "object",
          properties: {
            selectedIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of record IDs that best match the description"
            },
            reason: { type: "string", description: "Brief explanation of why these were selected" }
          },
          required: ["selectedIds"]
        }
      }],
      tool_choice: { type: "tool", name: "select_records" },
      messages: [{
        role: "user",
        content: `You are selecting ${objectType} records that match this description: "${prompt}"\n\nAvailable records:\n${recordSummary}\n\nSelect the IDs that best match. If none match, return an empty array. Be generous — if a record is a reasonable match, include it.`
      }]
    });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json({ selectedIds: toolUse?.input?.selectedIds ?? [], reason: toolUse?.input?.reason ?? "" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI workflow generator ────────────────────────────────────────────────────
router.post("/workflow", requireAuth, zValidator("json", z.object({
  prompt: z.string().min(1),
})), async (c) => {
  const { prompt } = c.req.valid("json");
  const TRIGGER_TYPES = ["record_created","record_updated","deal_stage_change","email_received","form_submitted"];
  const CONDITION_TYPES = ["field_equals","field_contains","field_changed","time_elapsed"];
  const ACTION_TYPES = ["send_email","create_task","assign_owner","add_to_sequence","send_notification","update_field"];

  const TRIGGER_LABELS: Record<string,string> = {
    record_created: "Record created", record_updated: "Record updated",
    deal_stage_change: "Deal stage changed", email_received: "Email received", form_submitted: "Form submitted"
  };
  const CONDITION_LABELS: Record<string,string> = {
    field_equals: "Field equals", field_contains: "Field contains",
    field_changed: "Field changed", time_elapsed: "Time elapsed"
  };
  const ACTION_LABELS: Record<string,string> = {
    send_email: "Send email", create_task: "Create task", assign_owner: "Assign owner",
    add_to_sequence: "Add to sequence", send_notification: "Send notification", update_field: "Update field"
  };

  try {
    const data = await callAnthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [{
        name: "create_workflow",
        description: "Create a workflow automation with trigger, optional conditions, and actions",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short descriptive workflow name (3-5 words)" },
            nodes: {
              type: "array",
              description: "Workflow nodes in order: first must be a trigger, then optional conditions, then actions",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["trigger","condition","action"] },
                  type: {
                    type: "string",
                    description: `Trigger types: ${TRIGGER_TYPES.join(", ")}. Condition types: ${CONDITION_TYPES.join(", ")}. Action types: ${ACTION_TYPES.join(", ")}`
                  },
                  label: { type: "string", description: "Human-readable label for this node" }
                },
                required: ["kind","type","label"]
              },
              minItems: 2,
              maxItems: 8
            }
          },
          required: ["name","nodes"]
        }
      }],
      tool_choice: { type: "tool", name: "create_workflow" },
      messages: [{
        role: "user",
        content: `Design a workflow automation for: "${prompt}"\n\nRules:\n- First node must be a trigger (kind=trigger)\n- Then optional conditions (kind=condition)\n- Then actions (kind=action) — at least one action\n- Pick the most appropriate types from the available options\n- Use clear, descriptive labels\n\nExample: Deal stage changed → Field equals "Won" → Send email, Create task`
      }]
    });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No workflow generated" }, 500);

    // Normalize labels using our label maps
    const nodes = (toolUse.input.nodes as any[]).map((n: any) => {
      const labelMap = n.kind === "trigger" ? TRIGGER_LABELS : n.kind === "condition" ? CONDITION_LABELS : ACTION_LABELS;
      return { kind: n.kind, type: n.type, label: n.label || labelMap[n.type] || n.type };
    });
    return c.json({ name: toolUse.input.name, nodes });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export { router as generateRouter };
