import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { verifyAiCredits } from "../lib/credits";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";
import { sovereignWebContext } from "../lib/sovereign-search";
import { isOverdue } from "@mondaily/shared/dates";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

/**
 * Internal helper — routes structured tool-use calls through the AI gateway.
 * Accepts the same shape callers already construct so zero call-site changes.
 * Returns `any` to preserve the loose typing all 14 call-sites rely on.
 * Model is determined by AI_PROVIDER_MODEL env var (gateway owns routing).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callGatewayTool(body: any, ctx?: { workspaceId?: string; userId?: string; feature?: string }): Promise<any> {
  const tool = body.tools?.[0];
  const lastMsg = body.messages?.[body.messages.length - 1];
  if (!tool || !lastMsg) throw new Error("Invalid AI request body");

  // workspaceId is what makes this METERED. Without it the gateway skips assertCreditsOk (no
  // credit gate) AND skips recordAiUsage (no token accounting) — so all 14 endpoints here were
  // free, ungated AI that never appeared in the wallet or the usage page.
  const input = await aiGatewayToolUse({
    prompt: lastMsg.content as string,
    toolName: tool.name as string,
    toolDescription: tool.description as string,
    toolSchema: tool.input_schema as GatewayToolRequest["toolSchema"],
    maxTokens: body.max_tokens as number,
    ...(body.system ? { system: body.system as string } : {}),
    ...(ctx?.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    feature: ctx?.feature ?? "generate",
  });

  return { content: [{ type: "tool_use", name: tool.name, input }] };
}

// ─── Schema generation via tool_use (guarantees valid JSON) ───────────────────
router.post("/schema", requireAuth, verifyAiCredits, zValidator("json", z.object({ prompt: z.string().min(1) })), async (c) => {
  const { prompt } = c.req.valid("json");
  try {
    const data = await callGatewayTool({
      max_tokens: 2048,
      system: [
        "You are Mondaily's schema architect. Design a PRECISE, domain-accurate object schema for exactly what the user describes.",
        "HARD RULES:",
        "1. Every column MUST be directly relevant to the stated domain. NEVER add generic contact or social fields (twitter/linkedin/instagram followers, etc.) UNLESS the domain is explicitly about people, influencers, or social accounts.",
        "2. The FIRST attribute must be the record's primary label — a 'text' field named for the domain (e.g. 'Ticker' for a stock tracker, 'Property Address' for real estate, 'Company Name' for companies, 'Deal Name' for deals).",
        "3. Choose the MOST precise type: currency for money, percentage for rates/returns/allocations, date/datetime for time, select/multi_select for fixed categories (ALWAYS provide realistic `options` for these), checkbox for yes/no, number for counts, url/email/phone where apt.",
        "4. Include 6–12 columns a real professional in that domain would actually use.",
        "5. Give every attribute a short `description` of what it holds.",
        "Example — 'finance investing dashboard' → Ticker(text), Asset Class(select: Equity/Bond/Crypto/ETF/Cash), Sector(select), Position Size(number), Entry Price(currency), Current Price(currency), Market Value(currency), Unrealized P&L(currency), Return %(percentage), Purchase Date(date), Conviction(select: High/Medium/Low). NOT social metrics.",
      ].join("\n"),
      tools: [{
        name: "create_object_schema",
        description: "Create a Mondaily object schema with attributes for the described use case",
        input_schema: {
          type: "object",
          properties: {
            singular: { type: "string", description: "Singular name e.g. Investment" },
            plural:   { type: "string", description: "Plural name e.g. Investments" },
            vertical: { type: "string", enum: ["sales","finance","hr","realestate","investments","shared"] },
            color:    { type: "string", enum: ["red","orange","amber","emerald","cyan","blue","violet","pink"] },
            description: { type: "string", description: "One-line description of what this tracks" },
            attributes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Column name in Title Case" },
                  type: { type: "string", enum: ["text","long_text","number","currency","percentage","date","datetime","checkbox","select","multi_select","url","email","phone"] },
                  description: { type: "string", description: "One short line: what this column holds" },
                  options: { type: "array", items: { type: "string" }, description: "For select/multi_select ONLY: the realistic choice values" }
                },
                required: ["name","type"]
              },
              minItems: 6,
              maxItems: 14
            },
            sample_records: {
              type: "array",
              description: "2–3 realistic ILLUSTRATIVE example rows demonstrating the schema (clearly examples the user will edit/delete). Each is an object keyed by the column names above, using plausible domain values. Omit if the domain is about real specific people/companies where invented data would mislead.",
              items: { type: "object", additionalProperties: true },
              maxItems: 3
            }
          },
          required: ["singular","plural","vertical","color","attributes"]
        }
      }],
      tool_choice: { type: "tool", name: "create_object_schema" },
      messages: [{
        role: "user",
        content: `Design the object schema for: "${prompt}". Return domain-specific columns only — no generic social/contact fields unless the domain is about people. Put the primary label column first.`
      }]
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No schema generated" }, 500);
    return c.json(toolUse.input);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── NLP command parsing ──────────────────────────────────────────────────────
router.post("/nlp", requireAuth, verifyAiCredits, zValidator("json", z.object({
  query: z.string().min(1),
  columns: z.array(z.string()),
})), async (c) => {
  const { query, columns } = c.req.valid("json");
  try {
    // Use the configured gateway (gpt-oss via Cerebras), NOT Anthropic — this
    // app runs on Cerebras and has no Anthropic key, so callGatewayTool here was
    // failing and silently degrading NL sort to the regex fallback.
    const input = await aiGatewayToolUse({
      maxTokens: 512,
      system: "You parse natural-language table commands into structured filter/sort/calc operations.",
      prompt: `Available columns: ${columns.join(", ")}\n\nParse this command: "${query}"\n\nOnly include fields that are clearly requested. sortCol MUST exactly match one of the available columns — map synonyms (e.g. "AI score" or "lead score" → "lead_score"; "value"/"amount" → the closest column). filterText should be the value to search for, not the column name.`,
      toolName: "parse_table_command",
      toolDescription: "Parse a natural language command into table filter/sort/calc operations",
      toolSchema: {
        type: "object",
        properties: {
          filterText: { type: "string", description: "Text to filter rows by (substring match)" },
          sortCol:    { type: "string", description: `Column to sort by. Must be one of: ${columns.join(", ")}` },
          sortDir:    { type: "string", enum: ["asc", "desc"] },
          calcOps: {
            type: "object",
            description: "Aggregation operations per column",
            additionalProperties: { type: "string", enum: ["sum", "avg", "min", "max", "count"] },
          },
        },
      },
    });

    if (!input || Object.keys(input).length === 0) return c.json({ filterText: "", sortCol: null, sortDir: "asc", calcOps: {} });
    return c.json({ filterText: "", sortCol: null, sortDir: "asc", calcOps: {}, ...input });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Company enrichment via the sovereign SearXNG appliance + sovereign AI gateway ────────────
router.post("/enrich/company", requireAuth, verifyAiCredits, zValidator("json", z.object({ name: z.string() })), async (c) => {
  const { name } = c.req.valid("json");
  // Sovereign web context: our own SearXNG + scraper appliance (no Tavily).
  const webContext = await sovereignWebContext(`${name} company funding employees ARR revenue headquarters`);
  try {
    // Sovereign inference: our Cerebras gateway with tool-use (no Anthropic).
    const fields = await aiGatewayToolUse({
      toolName: "enrich_company",
      toolDescription: "Extract company data fields strictly from the provided web context",
      toolSchema: {
        type: "object",
        properties: {
          description:    { type: "string" },
          country:        { type: "string" },
          employee_range: { type: "string", description: "e.g. 1-10, 11-50, 51-200, 201-500, 500-1000, 1000+" },
          arr:            { type: "number", description: "Annual recurring revenue in USD" },
          funding_raised: { type: "number", description: "Total funding raised in USD" },
          website:        { type: "string" },
          industry:       { type: "string" },
        },
      },
      system: "You extract verifiable company facts. Only fill a field if the web context supports it — never guess or fabricate numbers. Omit anything you cannot ground in the context.",
      prompt: `Company: "${name}"\n\n${webContext ? `Web context:\n${webContext}` : "No web context was available."}`,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
    }) as Record<string, unknown>;
    const clean = Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => v != null && v !== ""));
    return c.json({ fields: clean, source: webContext ? "web" : "ai" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Person enrichment ────────────────────────────────────────────────────────
router.post("/enrich/person", requireAuth, verifyAiCredits, zValidator("json", z.object({ email: z.string() })), async (c) => {
  const { email } = c.req.valid("json");
  const domain = email.split("@")[1] ?? "";
  const webContext = domain ? await sovereignWebContext(`${email} ${domain} linkedin job title company`) : "";
  try {
    const fields = await aiGatewayToolUse({
      toolName: "enrich_person",
      toolDescription: "Extract person data fields strictly from the provided web context",
      toolSchema: {
        type: "object",
        properties: {
          company:   { type: "string" },
          job_title: { type: "string" },
          linkedin:  { type: "string" },
          location:  { type: "string" },
          twitter:   { type: "string" },
        },
      },
      system: "You extract verifiable facts about a person. Only fill a field if the web context supports it — never fabricate. Company may be inferred from the email domain; everything else must be grounded in the context.",
      prompt: `Person email: "${email}" (domain "${domain}")\n\n${webContext ? `Web context:\n${webContext}` : "No web context was available."}`,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
    }) as Record<string, unknown>;
    const clean = Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => v != null && v !== ""));
    return c.json({ fields: clean, source: webContext ? "web" : "ai" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Bulk record generation ───────────────────────────────────────────────────
// Create records from the LIVE WEB — 100% real, source-backed data. This NEVER fabricates: it
// searches + scrapes the sovereign web pipeline and extracts only entities that genuinely appear,
// each with a source_url. If the web yields nothing, it returns an empty set with a reason (it must
// never invent placeholder people/values). Records are tagged with the source so the UI can mark
// them as agent-discovered.
router.post("/records", requireAuth, verifyAiCredits, zValidator("json", z.object({
  objectType: z.string().min(1),
  columns: z.array(z.string()).min(1),
  prompt: z.string().min(1),
  count: z.number().int().min(1).max(50).default(10),
})), async (c) => {
  const { objectType, columns, prompt, count } = c.req.valid("json");
  try {
    // 1) Pull REAL web content for the request (search + scrape several pages).
    const webContext = await sovereignWebContext(`${prompt} ${objectType}`, 5);
    if (!webContext || webContext.trim().length < 40) {
      return c.json({ records: [], reason: "No real web data found for that request. Try a more specific query (a sector, place, or named source)." });
    }

    // 2) Extract ONLY grounded records — every field must appear in the web context; nothing invented.
    const extracted = await aiGatewayToolUse({
      toolName: "extract_records",
      toolDescription: "Extract real, source-backed records from web content",
      maxTokens: 4096,
      toolSchema: {
        type: "object",
        properties: {
          records: {
            type: "array",
            description: `Up to ${count} REAL ${objectType} found in the web content. Empty if none genuinely appear.`,
            items: {
              type: "object",
              description: "Keys must match the provided columns. Include source_url.",
              properties: { source_url: { type: "string", description: "URL where this entity was found (required)" } },
              additionalProperties: { type: "string" },
            },
          },
        },
        required: ["records"],
      },
      system:
        `You extract REAL ${objectType} records from web content for a workspace database. ABSOLUTE RULE: never invent. ` +
        `Only include an entity that genuinely appears in the content, and only fill a column if the content actually supports it — otherwise leave it "". ` +
        `NEVER fabricate names, values, follower counts, revenue, emails, or phones. Every record MUST have a real source_url copied from the content. ` +
        `Return an empty array if the content contains no genuine ${objectType}. Do not pad to reach the count.`,
      prompt: `Object type: ${objectType}. Request: "${prompt}". Columns to fill (only when grounded): ${columns.join(", ")}.\n\nWeb content:\n${webContext.slice(0, 12000)}`,
    }).catch(() => ({ records: [] as Record<string, unknown>[] }));

    const records = Array.isArray((extracted as { records?: unknown }).records)
      ? (extracted as { records: Record<string, unknown>[] }).records
      : [];
    // Tag each with the discovery source so the frontend can mark it as agent-added.
    const tagged = records.map((r) => ({ ...r, _discovered: true }));
    return c.json({ records: tagged, reason: tagged.length ? undefined : "No real records could be verified from the web for that request." });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI task suggestions ──────────────────────────────────────────────────────
router.post("/tasks", requireAuth, verifyAiCredits, zValidator("json", z.object({
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
    const data = await callGatewayTool({
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
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json({ tasks: toolUse?.input?.tasks ?? [] });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI insights ──────────────────────────────────────────────────────────────
router.post("/insights", requireAuth, verifyAiCredits, zValidator("json", z.object({
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
    const data = await callGatewayTool({
      max_tokens: 2048,
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
                  category: { type: "string", enum: ["performance","risk","opportunity","summary"] },
                  action: { type: "string", description: "One specific, concrete action the user should take based on this insight. Start with a verb. E.g. 'Re-engage the 3 deals that haven\\'t moved in 14+ days' or 'Increase outreach to companies in the Technology sector which shows 40% higher conversion'" }
                },
                required: ["title","value","description","category","action"]
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
        content: `Analyze the ${Math.min(records.length, 50)} ${objectType} records below${records.length > 50 ? ` — a SAMPLE of ${records.length} total, so any count or total you state is from the sample and must be described that way` : ""} and generate 4-6 business insights. ABSOLUTE RULE: only state numbers you actually compute from the records below — never estimate, round-invent, or extrapolate a figure that isn't grounded in this exact sample. If the sample is too thin for a reliable stat (e.g. under 5 records), say so in the insight rather than presenting a guess as fact.\n\nSample records (${sample ? records.length : 0} of ${records.length} shown):\n${sample}\n\nFocus on: totals, averages, distributions, patterns, anomalies, opportunities, and risks — computed from the data above only. Be specific with real numbers.\n\nFor each insight, also provide a concrete, specific action the user should take right now based on that finding. Actions must start with a verb and be immediately actionable, not generic advice.`
      }]
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json({ insights: toolUse?.input?.insights ?? [] });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI sequence generator ────────────────────────────────────────────────────
router.post("/sequence", requireAuth, verifyAiCredits, zValidator("json", z.object({
  prompt: z.string().min(1),
  steps: z.number().int().min(2).max(8).default(4),
})), async (c) => {
  const { prompt, steps } = c.req.valid("json");
  try {
    const data = await callGatewayTool({
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
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No sequence generated" }, 500);
    return c.json(toolUse.input);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI list name + object type picker ───────────────────────────────────────
router.post("/list-name", requireAuth, verifyAiCredits, zValidator("json", z.object({
  prompt: z.string().min(1),
  objectTypes: z.array(z.string()),
})), async (c) => {
  const { prompt, objectTypes } = c.req.valid("json");
  try {
    const data = await callGatewayTool({
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
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json(toolUse?.input ?? { name: "New List", object_type: objectTypes[0] ?? "companies" });
  } catch {
    return c.json({ name: "New List", object_type: objectTypes[0] ?? "companies" });
  }
});

// ─── AI list-entry selector ───────────────────────────────────────────────────
router.post("/list-entries", requireAuth, verifyAiCredits, zValidator("json", z.object({
  prompt: z.string().min(1),
  objectType: z.string().min(1),
  records: z.array(z.object({ id: z.string(), data: z.record(z.unknown()) })),
})), async (c) => {
  const { prompt, objectType, records } = c.req.valid("json");
  if (!records.length) return c.json({ selectedIds: [] });
  try {
    const recordSummary = records.map(r => `ID:${r.id} | ${Object.entries(r.data).slice(0,5).map(([k,v])=>`${k}=${v}`).join(", ")}`).join("\n");
    const data = await callGatewayTool({
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
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    return c.json({ selectedIds: toolUse?.input?.selectedIds ?? [], reason: toolUse?.input?.reason ?? "" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI workflow generator ────────────────────────────────────────────────────
router.post("/workflow", requireAuth, verifyAiCredits, zValidator("json", z.object({
  prompt: z.string().min(1),
})), async (c) => {
  const { prompt } = c.req.valid("json");
  const TRIGGER_TYPES = ["record_created","record_updated","deal_stage_change","email_received","form_submitted"];
  const CONDITION_TYPES = ["field_equals","field_contains","field_gt","field_lt","field_changed","time_elapsed"];
  const ACTION_TYPES = ["send_email","create_task","assign_owner","add_to_sequence","send_notification","update_field","draft_quote","create_record"];

  const TRIGGER_LABELS: Record<string,string> = {
    record_created: "Record created", record_updated: "Record updated",
    deal_stage_change: "Deal stage changed", email_received: "Email received", form_submitted: "Form submitted"
  };
  const CONDITION_LABELS: Record<string,string> = {
    field_equals: "Field equals", field_contains: "Field contains",
    field_gt: "Number greater than", field_lt: "Number less than",
    field_changed: "Field changed", time_elapsed: "Time elapsed"
  };
  const ACTION_LABELS: Record<string,string> = {
    send_email: "Send email", create_task: "Create task", assign_owner: "Assign owner",
    add_to_sequence: "Add to sequence", send_notification: "Send notification", update_field: "Update field",
    draft_quote: "Draft quote", create_record: "Create record"
  };

  try {
    const data = await callGatewayTool({
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
                  label: { type: "string", description: "Human-readable label for this node" },
                  config: {
                    type: "object",
                    description: "Fill in the concrete parameters so this node runs WITHOUT further editing. Only set the keys relevant to this node's type.",
                    properties: {
                      object_type: { type: "string", description: "For triggers: the record type to watch (e.g. deal, contact, invoice). Lowercase singular." },
                      field: { type: "string", description: "For field_* conditions and update_field: the record field name (e.g. stage, status, lead_score, amount)." },
                      value: { type: "string", description: "For conditions: the value to compare against (e.g. Won, 50000). For update_field: the new value." },
                      operator: { type: "string", enum: ["equals","contains","gt","lt"], description: "Comparison operator for field conditions." },
                      amount: { type: "string", description: "For time_elapsed: the numeric amount." },
                      unit: { type: "string", enum: ["hours","days","weeks"], description: "For time_elapsed: the unit." },
                      message: { type: "string", description: "For send_notification/send_email: the message or subject line to draft." }
                    }
                  }
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
        content: `Design a workflow automation for: "${prompt}"\n\nRules:\n- First node must be a trigger (kind=trigger)\n- Then optional conditions (kind=condition)\n- Then actions (kind=action) — at least one action\n- Pick the most appropriate types from the available options\n- Use clear, descriptive labels\n- CRITICAL: fill each node's "config" with the concrete parameters implied by the request so the workflow runs without manual editing. E.g. "when a deal is Won" → trigger record_updated {object_type:"deal"} + condition field_equals {field:"stage", value:"Won", operator:"equals"}; "notify the team" → send_notification {message:"..."}; "deals over $50k" → field_gt {field:"amount", value:"50000", operator:"gt"}.\n- Ground every value in the user's request; never invent field values that weren't asked for.\n\nExample: Deal stage changed → Field equals "Won" → Send email, Create task`
      }]
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });
    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No workflow generated" }, 500);

    // Normalize labels + carry the concrete config through so the generated
    // workflow is runnable on apply (the builder previously discarded config,
    // leaving an empty skeleton the user had to re-fill by hand).
    const ALLOWED_CONFIG = new Set(["object_type","field","value","operator","amount","unit","message"]);
    const nodes = (toolUse.input.nodes as any[]).map((n: any) => {
      const labelMap = n.kind === "trigger" ? TRIGGER_LABELS : n.kind === "condition" ? CONDITION_LABELS : ACTION_LABELS;
      const config: Record<string, string> = {};
      if (n.config && typeof n.config === "object") {
        for (const [k, v] of Object.entries(n.config)) {
          if (ALLOWED_CONFIG.has(k) && v != null && v !== "") config[k] = String(v).slice(0, 200);
        }
      }
      return { kind: n.kind, type: n.type, label: n.label || labelMap[n.type] || n.type, config };
    });
    return c.json({ name: toolUse.input.name, nodes });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI revenue / pipeline forecast ──────────────────────────────────────────
router.post("/forecast", requireAuth, verifyAiCredits, zValidator("json", z.object({
  objectType:  z.string().min(1),
  valueCol:    z.string().nullable(),
  stageCol:    z.string().nullable(),
  period:      z.string(),
  stats: z.object({
    wonValue:       z.number(),
    openValue:      z.number(),
    wonCount:       z.number(),
    openCount:      z.number(),
    totalCount:     z.number(),
    completionRate: z.number(),
    avgVal:         z.number(),
  }),
  prevStats: z.object({
    wonValue:       z.number(),
    wonCount:       z.number(),
    completionRate: z.number(),
  }),
  trendData: z.array(z.object({ label: z.string(), revenue: z.number(), count: z.number() })),
})), async (c) => {
  const { objectType, valueCol, stageCol, period, stats, prevStats, trendData } = c.req.valid("json");

  const hasValue = !!valueCol;
  const trendSummary = trendData.map(d =>
    hasValue ? `${d.label}: ${d.revenue} value, ${d.count} records` : `${d.label}: ${d.count} records`
  ).join(" | ");

  const prompt = `You are a business analyst. Analyse the following ${objectType} pipeline data and generate a forecast.

Period: ${period}
${hasValue ? `Value column: "${valueCol}"` : "No numeric value column detected — counting records only"}
${stageCol ? `Stage column: "${stageCol}"` : "No stage column detected"}

CURRENT PERIOD STATS:
- ${hasValue ? `Won/closed value: $${stats.wonValue.toLocaleString()}` : `Completed records: ${stats.wonCount}`}
- Open pipeline: ${hasValue ? `$${stats.openValue.toLocaleString()} across ${stats.openCount} records` : `${stats.openCount} open records`}
- Win rate: ${stats.completionRate}%
- Average ${hasValue ? "deal value" : "records per period"}: ${hasValue ? `$${stats.avgVal.toLocaleString()}` : stats.avgVal}
- Total records this period: ${stats.totalCount}

PREVIOUS PERIOD (for comparison):
- ${hasValue ? `Won value: $${prevStats.wonValue.toLocaleString()}` : `Completed: ${prevStats.wonCount}`}
- Win rate: ${prevStats.completionRate}%

TREND DATA (recent periods):
${trendSummary}

Based on this data, generate a forecast. ABSOLUTE RULE: you were given AGGREGATE stats only (no
per-stage or per-record breakdown) — never state a specific count, name, or stage that isn't one of
the numbers given above. Reference only stats.openCount, stats.wonCount, etc. as given; do not
invent "N deals in stage X" or similar specifics you were not actually given. Consider:
1. Current open pipeline × win rate = expected closures
2. Trend momentum (is the business accelerating or decelerating?)
3. Win rate change vs previous period
4. Average deal size trend`;

  try {
    const data = await callGatewayTool({
      max_tokens: 2048,
      tools: [{
        name: "generate_forecast",
        description: "Generate a business forecast with projected value and narrative analysis",
        input_schema: {
          type: "object",
          properties: {
            projectedValue: {
              type: "number",
              description: hasValue
                ? "Projected total value to be won/closed by end of this period, in same units as input"
                : "Projected number of records to be completed by end of this period"
            },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "Confidence level based on data quality and consistency" },
            headline: { type: "string", description: "One short sentence headline, e.g. 'On track for a strong month' or 'Pipeline looks thin — expect a slower close'" },
            narrative: { type: "string", description: "2-3 sentences explaining the forecast. Be specific with numbers. Mention trend, win rate, and pipeline." },
            risks: { type: "string", description: "One sentence about the key risk to this forecast, or 'None identified' if data looks healthy." },
            actions: {
              type: "array",
              description: "3-5 specific, concrete actions the user should take right now to hit or exceed the forecast. Each should be actionable today, not generic advice. Reference only the aggregate numbers actually given (e.g. the real openCount) — never invent a per-stage or per-record count you weren't given.",
              items: {
                type: "object",
                properties: {
                  action: { type: "string", description: "Short imperative action grounded in the real stats given, e.g. 'Review the {openCount} open records to prioritize the highest-value ones' — never a fabricated stage/count breakdown" },
                  impact: { type: "string", enum: ["high", "medium", "low"], description: "Expected impact on hitting the forecast" },
                  why: { type: "string", description: "One sentence explaining why this action matters now" }
                },
                required: ["action", "impact", "why"]
              },
              minItems: 3,
              maxItems: 5
            }
          },
          required: ["projectedValue", "confidence", "headline", "narrative", "risks", "actions"]
        }
      }],
      tool_choice: { type: "tool", name: "generate_forecast" },
      messages: [{ role: "user", content: prompt }]
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    if (!toolUse?.input) return c.json({ error: "No forecast generated" }, 500);
    return c.json(toolUse.input);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI Risk Alerts ───────────────────────────────────────────────────────────
router.post("/risk-alerts", requireAuth, verifyAiCredits, async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const now = new Date();
  const cutoff14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Pull relevant data. NOTE the two exact counts below: the model is told real totals, while the
  // task/node arrays are only the most recent 100 rows. Previously the prompt asserted
  // "Total open tasks: ${tasks.length}" from those capped arrays, so any workspace past 100 was
  // told its total was exactly 100 — and the model wrote that false figure into a real ai_risk
  // notification the user reads as fact.
  const [tasksRes, nodesRes, existingRes, openTaskCount, recordCount] = await Promise.all([
    supabase.from("tasks")
      .select("id, title, priority, status, due_date, completed, created_at")
      .eq("workspace_id", workspaceId)
      .eq("completed", false)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("nodes")
      .select("id, object_type, data, updated_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase.from("notifications")
      .select("title")
      .eq("workspace_id", workspaceId)
      .eq("type", "ai_risk")
      .gte("created_at", cutoff24h),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("completed", false),
    supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);

  const tasks = tasksRes.data ?? [];
  const nodes = nodesRes.data ?? [];
  const recentTitles = new Set((existingRes.data ?? []).map((n: any) => n.title));

  // Build context summary
  const overdueTasks = tasks.filter(t => isOverdue(t.due_date, now));
  const urgentTasks = tasks.filter(t => t.priority === "urgent");
  const staleNodes = nodes.filter(n => n.updated_at && new Date(n.updated_at) < new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000));
  // Match the object_type by stem, like routes/nodes.ts — workspaces carry either "deal" or
  // "deals" depending on how the object was defined, and the exact-match literal silently
  // reported zero open deals on half of them.
  const dealNodes = nodes.filter(n => String(n.object_type).toLowerCase().includes("deal"));
  const highValueStaleDeals = dealNodes.filter(n => {
    const val = parseFloat((n.data as any)?.value ?? (n.data as any)?.amount ?? "0");
    return val > 0 && n.updated_at && new Date(n.updated_at) < new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  });

  // Totals come from exact COUNTs; everything derived from the arrays is labelled as a sample of
  // the most recent rows, so the model can never present a page size as a total.
  const sampled = `of the ${nodes.length} most recently updated records sampled`;
  const sampledTasks = `of the ${tasks.length} most recent open tasks sampled`;
  const context = [
    `Total open tasks: ${openTaskCount.count ?? tasks.length}`,
    `Overdue tasks (${sampledTasks}): ${overdueTasks.length}${overdueTasks.length ? " — titles: " + overdueTasks.slice(0,5).map(t=>t.title).join(", ") : ""}`,
    `Urgent tasks (${sampledTasks}): ${urgentTasks.length}`,
    `Total graph records: ${recordCount.count ?? nodes.length}`,
    `Stale records, no update in 14d (${sampled}): ${staleNodes.length}`,
    `Open deals (${sampled}): ${dealNodes.length}`,
    `High-value stale deals (no activity 14d): ${highValueStaleDeals.length}${highValueStaleDeals.length ? " — " + highValueStaleDeals.slice(0,3).map(n=>(n.data as any)?.name ?? "unnamed").join(", ") : ""}`,
    `Old open tasks (created > 14d ago, still open): ${tasks.filter(t => new Date(t.created_at) < new Date(cutoff14d)).length}`,
  ].join("\n");

  if (!context.trim()) return c.json({ created: 0 });

  try {
    const data = await callGatewayTool({
      max_tokens: 1024,
      tools: [{
        name: "generate_risk_alerts",
        description: "Identify business risks from graph and task data and return actionable alerts",
        input_schema: {
          type: "object",
          properties: {
            alerts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short alert title, max 60 chars, e.g. '3 deals going cold'" },
                  body: { type: "string", description: "1-2 sentence description of the risk and recommended action" },
                  severity: { type: "string", enum: ["high", "medium", "low"] }
                },
                required: ["title", "body", "severity"]
              },
              minItems: 0,
              maxItems: 4
            }
          },
          required: ["alerts"]
        }
      }],
      tool_choice: { type: "tool", name: "generate_risk_alerts" },
      messages: [{
        role: "user",
        content: `Analyze this workspace data and identify 0-4 genuine business risks worth alerting on. Only flag real problems — if everything looks healthy, return 0 alerts.\n\nWorkspace snapshot:\n${context}\n\nToday: ${now.toDateString()}\n\nFocus on: overdue tasks, stale high-value deals, urgent items piling up, or patterns suggesting something important is being missed. Skip minor issues. Be specific with numbers.`
      }]
    }, { workspaceId: c.get("workspaceId"), userId: c.get("userId") });

    const toolUse = data.content?.find((b: any) => b.type === "tool_use");
    const alerts: Array<{ title: string; body: string; severity: string }> = toolUse?.input?.alerts ?? [];

    // Write new alerts, skipping any already sent in last 24h (by title)
    let created = 0;
    for (const alert of alerts) {
      if (recentTitles.has(alert.title)) continue;
      await supabase.from("notifications").insert({
        workspace_id: workspaceId,
        user_id: userId,
        title: alert.title,
        body: `[${alert.severity.toUpperCase()}] ${alert.body}`,
        type: "ai_risk",
        is_read: false,
      });
      created++;
    }

    return c.json({ created, total: alerts.length });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export { router as generateRouter };
