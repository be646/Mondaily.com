import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";

const SYSTEM_PROMPT = `You are Mondaily AI — an intelligent business operating system. You help users manage contacts, deals, tasks, pipelines, emails, calls, and all business operations. Be concise, smart, and actionable.

You have tools to take real actions inside Mondaily. When a user asks you to create a task, look up a contact, update a deal, search records, create a list, add records to a list, or build a custom object type — use the appropriate tool. After using a tool, summarize what you did in plain language.

Key tool-chaining patterns:
- "Create a list of [records matching criteria]" → search_records first to find the IDs, then create_list, then add_to_list in sequence.
- "Add X to my Y list" → use list_lists to find the list ID, then search_records to find the record, then add_to_list.
- "Create a new object for tracking X" → use create_object_type with a clear description so fields are generated well.
- For multi-step operations, execute all steps and report the full outcome.

Never mention Claude, Anthropic, OpenAI, or any underlying AI technology. You are simply Mondaily AI.

After every response, append a follow-ups block with 3 short suggested next actions the user might want to take, directly relevant to what you just did or said. Format exactly as:
<followups>["Action one", "Action two", "Action three"]</followups>
Keep each suggestion under 8 words. Make them specific, actionable, and varied — e.g. create tasks, add records to a list, build a new object, set reminders, review items. Never repeat the user's original request.`;

const TOOLS = [
  {
    name: "list_tasks",
    description: "List tasks assigned to or created by the current user. Use for 'what are my tasks', 'show my open tasks', 'what's due today', etc.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["mine", "all", "overdue", "review"],
          description: "Which tasks to return"
        }
      },
      required: []
    }
  },
  {
    name: "create_task",
    description: "Create a new task in Mondaily. Use when the user says 'create a task', 'add a to-do', 'remind me to', etc.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Task priority" },
        due_date: { type: "string", description: "ISO 8601 datetime string, e.g. 2026-06-15T09:00:00" },
        notes: { type: "string", description: "Optional notes or description" }
      },
      required: ["title"]
    }
  },
  {
    name: "update_task",
    description: "Update an existing task's status, priority, or notes. Use when user says 'mark task done', 'complete X', 'set X to urgent', etc.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID to update" },
        completed: { type: "boolean" },
        status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        notes: { type: "string" }
      },
      required: ["task_id"]
    }
  },
  {
    name: "search_records",
    description: "Search contacts, companies, deals, or any record type by name, email, or keyword. Use for 'find contact X', 'show me deals with Y', 'look up company Z'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term — name, email, company, or keyword" },
        object_type: {
          type: "string",
          description: "Optional filter: contacts, companies, deals, or omit to search all"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "create_record",
    description: "Create a new contact, company, deal, or other record. Use when user says 'add a contact', 'create a deal', 'new company', etc.",
    input_schema: {
      type: "object",
      properties: {
        object_type: {
          type: "string",
          description: "Record type: contacts, companies, deals, etc."
        },
        name: { type: "string", description: "Display name" },
        email: { type: "string", description: "Email address (for contacts)" },
        phone: { type: "string", description: "Phone number" },
        company: { type: "string", description: "Company name (for contacts)" },
        amount: { type: "number", description: "Deal value (for deals)" },
        stage: { type: "string", description: "Pipeline stage (for deals)" },
        notes: { type: "string", description: "Any additional notes" }
      },
      required: ["object_type", "name"]
    }
  },
  {
    name: "list_records",
    description: "List records of a specific type. Use for 'show all contacts', 'list my deals', 'show companies', etc.",
    input_schema: {
      type: "object",
      properties: {
        object_type: {
          type: "string",
          description: "Record type: contacts, companies, deals, etc."
        },
        limit: { type: "number", description: "Max records to return (default 10)" }
      },
      required: ["object_type"]
    }
  },
  {
    name: "list_notifications",
    description: "Fetch the user's recent notifications — task assignments, overdue alerts, deal updates, review requests, mentions, agent completions. Use for daily briefs or 'what happened recently'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max notifications to return (default 15)" },
        unread_only: { type: "boolean", description: "Only return unread notifications" }
      },
      required: []
    }
  },
  {
    name: "create_list",
    description: "Create a new named list for grouping and saving records. Use when the user says 'create a list of X', 'make a list called Y', 'build a list for Z contacts/deals/companies'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name, e.g. 'Enterprise Accounts', 'Hot Leads Q2', 'Investors to Contact'" },
        object_type: { type: "string", description: "Record type this list holds: contacts, companies, deals, or any custom object slug" }
      },
      required: ["name", "object_type"]
    }
  },
  {
    name: "list_lists",
    description: "List all saved lists in the workspace. Use when the user asks 'show my lists', or before calling add_to_list so you can match the correct list by name.",
    input_schema: {
      type: "object",
      properties: {
        object_type: { type: "string", description: "Optional: filter to lists of a specific record type" }
      },
      required: []
    }
  },
  {
    name: "add_to_list",
    description: "Add one or more records to an existing list by list name. Use search_records first to get record IDs, then call this tool. Use when user says 'add X to my Y list', 'put these records in list Z'.",
    input_schema: {
      type: "object",
      properties: {
        list_name: { type: "string", description: "Name of the target list (partial match is fine)" },
        node_ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of record IDs to add to the list"
        }
      },
      required: ["list_name", "node_ids"]
    }
  },
  {
    name: "create_object_type",
    description: "Create a brand-new custom object type with AI-generated fields. Use when user says 'create an object for X', 'I need a custom table for Y', 'build me a new object type called Z', 'make a schema for tracking investor meetings / properties / support tickets'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable singular name, e.g. 'Investor Meeting', 'Property', 'Support Ticket'" },
        description: { type: "string", description: "What this object tracks — used to auto-generate relevant fields, e.g. 'Track VC investor meetings including fund size, stage preference, and follow-up status'" }
      },
      required: ["name", "description"]
    }
  }
];

async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: "basic" })
    });
    if (!res.ok) return "";
    const data = await res.json() as any;
    const results = (data.results ?? []).slice(0, 5).map((r: any) => `- ${r.title}: ${r.content}`).join("\n");
    return results ? `\n\nWeb search results for "${query}":\n${results}` : "";
  } catch { return ""; }
}

async function executeTool(
  name: string,
  input: Record<string, any>,
  workspaceId: string,
  userId: string
): Promise<string> {
  try {
    switch (name) {
      case "list_tasks": {
        const filter = input.filter || "mine";
        let taskQuery = supabase
          .from("tasks")
          .select("id, title, priority, status, due_date, completed, assignee_id, created_by")
          .eq("workspace_id", workspaceId)
          .eq("completed", false);

        if (filter === "mine") {
          taskQuery = taskQuery.or(`assignee_id.eq.${userId},created_by.eq.${userId}`);
        }
        if (filter === "overdue") {
          taskQuery = taskQuery
            .or(`assignee_id.eq.${userId},created_by.eq.${userId}`)
            .lt("due_date", new Date().toISOString());
        }

        const { data, error } = await taskQuery
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) return `Error fetching tasks: ${error.message}`;
        if (!data?.length) return "No tasks found.";
        const list = data.map((t: any) =>
          `- [${t.id}] ${t.title} | priority: ${t.priority || "medium"} | status: ${t.status || "todo"}${t.due_date ? ` | due: ${new Date(t.due_date).toLocaleDateString()}` : ""}`
        ).join("\n");
        return `Found ${data.length} task(s):\n${list}`;
      }

      case "create_task": {
        const { data, error } = await supabase
          .from("tasks")
          .insert({
            workspace_id: workspaceId,
            title: input.title,
            assignee_id: userId,
            completed: false,
            priority: input.priority || "medium",
            status: "todo",
            due_date: input.due_date || null,
            notes: input.notes || null,
          })
          .select()
          .single();
        if (error) return `Error creating task: ${error.message}`;
        return `Task created successfully: "${data.title}" (ID: ${data.id}) with priority ${data.priority}.`;
      }

      case "update_task": {
        const updates: Record<string, any> = {};
        if (input.completed !== undefined) updates.completed = input.completed;
        if (input.status) updates.status = input.status;
        if (input.priority) updates.priority = input.priority;
        if (input.notes) updates.notes = input.notes;
        const { data, error } = await supabase
          .from("tasks")
          .update(updates)
          .eq("id", input.task_id)
          .eq("workspace_id", workspaceId)
          .select()
          .single();
        if (error) return `Error updating task: ${error.message}`;
        return `Task "${data.title}" updated successfully.`;
      }

      case "search_records": {
        let query = supabase
          .from("nodes")
          .select("id, object_type, data")
          .eq("workspace_id", workspaceId)
          .limit(8);
        if (input.object_type) {
          query = query.eq("object_type", input.object_type);
        }
        // text search via ilike on the data jsonb field
        query = query.ilike("data->>name", `%${input.query}%`);
        const { data, error } = await query;
        if (error) {
          // fallback: search by email
          const { data: d2 } = await supabase
            .from("nodes")
            .select("id, object_type, data")
            .eq("workspace_id", workspaceId)
            .ilike("data->>email", `%${input.query}%`)
            .limit(8);
          if (!d2?.length) return `No records found matching "${input.query}".`;
          const list = d2.map((r: any) => `- [${r.id}] ${r.data.name || "Untitled"} (${r.object_type})${r.data.email ? ` | ${r.data.email}` : ""}`).join("\n");
          return `Found ${d2.length} record(s):\n${list}`;
        }
        if (!data?.length) return `No records found matching "${input.query}".`;
        const list = data.map((r: any) =>
          `- [${r.id}] ${r.data.name || "Untitled"} (${r.object_type})${r.data.email ? ` | ${r.data.email}` : ""}${r.data.company ? ` | ${r.data.company}` : ""}`
        ).join("\n");
        return `Found ${data.length} record(s):\n${list}`;
      }

      case "create_record": {
        const recordData: Record<string, any> = { name: input.name };
        if (input.email) recordData.email = input.email;
        if (input.phone) recordData.phone = input.phone;
        if (input.company) recordData.company = input.company;
        if (input.amount) recordData.amount = input.amount;
        if (input.stage) recordData.stage = input.stage;
        if (input.notes) recordData.notes = input.notes;
        const { data, error } = await supabase
          .from("nodes")
          .insert({
            workspace_id: workspaceId,
            created_by: userId,
            vertical: "shared",
            object_type: input.object_type,
            data: recordData
          })
          .select()
          .single();
        if (error) return `Error creating record: ${error.message}`;
        return `${input.object_type} record created: "${input.name}" (ID: ${data.id}).`;
      }

      case "list_records": {
        const { data, error } = await supabase
          .from("nodes")
          .select("id, data, updated_at")
          .eq("workspace_id", workspaceId)
          .eq("object_type", input.object_type)
          .order("updated_at", { ascending: false })
          .limit(input.limit || 10);
        if (error) return `Error listing records: ${error.message}`;
        if (!data?.length) return `No ${input.object_type} found.`;
        const list = data.map((r: any) =>
          `- [${r.id}] ${r.data.name || "Untitled"}${r.data.email ? ` | ${r.data.email}` : ""}${r.data.company ? ` | ${r.data.company}` : ""}${r.data.stage ? ` | stage: ${r.data.stage}` : ""}`
        ).join("\n");
        return `${input.object_type} (${data.length}):\n${list}`;
      }

      case "list_notifications": {
        const { data, error } = await supabase
          .from("notifications")
          .select("title, body, type, is_read, created_at")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(input.limit || 15);
        if (error) return `Error fetching notifications: ${error.message}`;
        if (!data?.length) return "No notifications found.";
        const unread = input.unread_only ? data.filter((n: any) => !n.is_read) : data;
        if (!unread.length) return "No unread notifications.";
        const list = unread.map((n: any) =>
          `- [${n.type}] ${n.title}: ${n.body}${n.is_read ? "" : " (unread)"} — ${new Date(n.created_at).toLocaleDateString()}`
        ).join("\n");
        return `${unread.length} notification(s):\n${list}`;
      }

      case "create_list": {
        const { data, error } = await supabase
          .from("lists")
          .insert({
            workspace_id: workspaceId,
            owner_id: userId,
            access_level: "workspace",
            name: input.name,
            object_type: input.object_type,
          })
          .select()
          .single();
        if (error) return `Error creating list: ${error.message}`;
        return `List "${data.name}" created (ID: ${data.id}) for ${data.object_type} records. Use add_to_list to populate it, or the user can open it in the Lists section.`;
      }

      case "list_lists": {
        let q = supabase
          .from("lists")
          .select("id, name, object_type")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(30);
        if (input.object_type) q = q.eq("object_type", input.object_type);
        const { data, error } = await q;
        if (error) return `Error fetching lists: ${error.message}`;
        if (!data?.length) return "No lists found in this workspace.";
        return `Lists (${data.length}):\n${data.map((l: any) => `- [${l.id}] "${l.name}" (${l.object_type})`).join("\n")}`;
      }

      case "add_to_list": {
        const { data: lists } = await supabase
          .from("lists")
          .select("id, name, object_type")
          .eq("workspace_id", workspaceId);
        const needle = (input.list_name as string).toLowerCase();
        const list = (lists ?? []).find((l: any) => l.name.toLowerCase().includes(needle));
        if (!list) return `No list found matching "${input.list_name}". Use list_lists to see available lists.`;

        const results: string[] = [];
        for (const nodeId of (input.node_ids as string[])) {
          const { data: node } = await supabase
            .from("nodes")
            .select("id, object_type, data")
            .eq("workspace_id", workspaceId)
            .eq("id", nodeId)
            .maybeSingle();
          if (!node) { results.push(`❌ Record ${nodeId} not found`); continue; }
          if (node.object_type !== list.object_type) {
            results.push(`❌ "${(node.data as any).name ?? nodeId}" is type "${node.object_type}", but list "${list.name}" expects "${list.object_type}"`);
            continue;
          }
          const { count } = await supabase
            .from("list_entries")
            .select("*", { count: "exact", head: true })
            .eq("list_id", list.id);
          const { error } = await supabase
            .from("list_entries")
            .upsert({ list_id: list.id, node_id: nodeId, position: (count ?? 0) + 1 });
          if (error) results.push(`❌ Failed to add "${(node.data as any).name ?? nodeId}": ${error.message}`);
          else results.push(`✅ Added "${(node.data as any).name ?? nodeId}"`);
        }
        return `Results for list "${list.name}":\n${results.join("\n")}`;
      }

      case "create_object_type": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return "Cannot create object type: AI service not configured.";

        // Generate slug from name
        const slug = (input.name as string)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");

        // Check it doesn't already exist
        const { data: existing } = await supabase
          .from("object_definitions")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("slug", slug)
          .maybeSingle();
        if (existing) return `An object type with slug "${slug}" already exists.`;

        // Use Claude to generate a smart attribute list
        let attributes: Array<{ id: string; name: string; type: string }> = [];
        try {
          const schemaRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 1024,
              tools: [{
                name: "define_attributes",
                description: "Define the fields for a custom object type",
                input_schema: {
                  type: "object",
                  properties: {
                    attributes: {
                      type: "array",
                      minItems: 4,
                      maxItems: 12,
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string", description: "Field name in snake_case, e.g. fund_size, meeting_date, follow_up_status" },
                          type: {
                            type: "string",
                            enum: ["text", "long_text", "number", "currency", "percentage", "date", "datetime", "checkbox", "select", "url", "email", "phone"],
                          },
                        },
                        required: ["name", "type"],
                      },
                    },
                  },
                  required: ["attributes"],
                },
              }],
              tool_choice: { type: "tool", name: "define_attributes" },
              messages: [{
                role: "user",
                content: `Generate 5-10 useful fields for a "${input.name}" object. Context: ${input.description}. Use snake_case names, appropriate types (currency for money, date for dates, select for status fields, checkbox for yes/no). Always include a status or stage select field.`,
              }],
            }),
          });
          if (schemaRes.ok) {
            const schemaData = await schemaRes.json() as any;
            const toolUse = (schemaData.content ?? []).find((b: any) => b.type === "tool_use");
            if (toolUse?.input?.attributes) {
              attributes = (toolUse.input.attributes as any[]).map((a: any) => ({
                id: crypto.randomUUID(),
                name: a.name,
                type: a.type,
              }));
            }
          }
        } catch (_) { /* fallback: create with no attributes, user can add later */ }

        const plural = `${input.name}s`;
        const { data, error } = await supabase
          .from("object_definitions")
          .insert({
            workspace_id: workspaceId,
            vertical: "shared",
            slug,
            name_singular: input.name,
            name_plural: plural,
            attributes,
          })
          .select()
          .single();
        if (error) return `Error creating object type: ${error.message}`;
        const fieldSummary = attributes.length
          ? attributes.map((a) => `${a.name} (${a.type})`).join(", ")
          : "no fields yet — the user can add them in Settings → Objects";
        return `Object type "${input.name}" created (slug: ${data.slug}, ID: ${data.id}) with ${attributes.length} field(s): ${fieldSummary}. It now appears under Objects in the sidebar.`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Tool error: ${err.message}`;
  }
}

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

router.post("/", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().optional(),
  model: z.enum(["auto", "fast", "smart"]).optional(),
  web_search: z.boolean().optional()
})), async (c) => {
  const { message, model: modelPref, web_search } = c.req.valid("json");
  const modelMap: Record<string, string> = {
    fast: "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-6",
    auto: "claude-sonnet-4-6"
  };
  const model = modelMap[modelPref ?? "auto"] ?? "claude-sonnet-4-6";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: "Anthropic API key not configured on server." }, 500);

  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");

  try {
    let webContext = "";
    if (web_search === true || process.env.WEB_SEARCH_DEFAULT === "true") {
      webContext = await searchWeb(message);
    }

    const systemPrompt = SYSTEM_PROMPT + (webContext ? `\n\nWeb context:\n${webContext}` : "");
    const messages: any[] = [{ role: "user", content: message }];

    let reply = "";
    const MAX_TOOL_ROUNDS = 5;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          tools: TOOLS,
          messages
        })
      });

      if (!res.ok) {
        const err = await res.text();
        return c.json({ reply: `AI error: ${err}` }, 500);
      }

      const data = await res.json() as any;
      const stopReason = data.stop_reason;

      // Collect text blocks
      const textBlocks = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text);
      if (textBlocks.length) reply = textBlocks.join("\n");

      // If no tool calls, we're done
      if (stopReason !== "tool_use") break;

      // Process tool calls
      const toolUseBlocks = (data.content ?? []).filter((b: any) => b.type === "tool_use");
      if (!toolUseBlocks.length) break;

      // Add assistant turn with tool calls
      messages.push({ role: "assistant", content: data.content });

      // Execute each tool and collect results
      const toolResults: any[] = [];
      for (const toolCall of toolUseBlocks) {
        const result = await executeTool(toolCall.name, toolCall.input ?? {}, workspaceId, userId);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: result
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (!reply) reply = "Done — I took action on your request.";

    // Extract follow-up suggestions
    let suggestions: string[] = [];
    const followupMatch = reply.match(/<followups>([\s\S]*?)<\/followups>/);
    if (followupMatch) {
      try { suggestions = JSON.parse(followupMatch[1] ?? "[]"); } catch {}
      reply = reply.replace(/<followups>[\s\S]*?<\/followups>/, "").trim();
    }

    // Track usage
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
      await supabase.from("ai_usage").insert({
        workspace_id: workspaceId,
        user_id: userId,
        model,
        message_count: 1,
        period_start: periodStart,
        period_end: periodEnd
      });
    } catch (_) {}

    return c.json({ reply, suggestions, thread_id: null });
  } catch (err: any) {
    return c.json({ reply: `Connection error: ${err.message}` }, 500);
  }
});

router.get("/credits", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const { data, error } = await supabase
    .from("ai_usage")
    .select("message_count")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd);

  if (error) return c.json({ used: 0, limit: 1000, period_end: periodEnd });

  const used = (data ?? []).reduce((sum, row) => sum + row.message_count, 0);
  return c.json({ used, limit: 1000, period_end: periodEnd });
});

router.post("/stream", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().uuid().optional()
})), async (c) => {
  return c.json({ ok: true });
});

router.get("/threads", requireAuth, async (c) => c.json([]));

export { router as askRouter };
