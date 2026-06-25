import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import * as ubc from "@mondaily/db/ubc";
import { runReportData } from "./reports";
import { runProspecting } from "./prospecting";
import { executeApprovedAction } from "./decisions";
import { aiGatewayToolUse, aiGatewayAgent } from "../lib/ai-gateway";

const SYSTEM_PROMPT = `You are Mondaily AI — an intelligent business operating system. You help users manage contacts, deals, tasks, pipelines, emails, calls, and all business operations. Be concise, smart, and actionable.

You have tools to take real actions inside Mondaily. When a user asks you to create a task, look up a contact, update a deal, search records, create a list, add records to a list, build a custom object type, or explore relationships between records — use the appropriate tool. After using a tool, summarize what you did in plain language.

Mondaily has a real workspace graph: every record is a node, and nodes can be connected to each other by edges (relationships). You DO have a tool for this — find_related_objects. Never tell the user that "workspace graph" isn't a feature you have a tool for. If they ask about related objects, connections, or "the graph" for a person/company/record, call find_related_objects with either the record's name or its node_id (if you already know it from this conversation or from a previous tool result).

You also have real finance and report tools — never answer a finance or report question generically without checking. list_invoices and get_invoice read real invoice records; list_finance_summary gives real aggregate overdue/draft/sent/paid totals. list_reports and get_report read a saved report's definition; run_report actually executes it and returns its real computed data points — always call run_report rather than guessing at numbers from a report's name or type alone.

You can create_note (a standalone note, optionally linked to a record), create_decision (add a real item to the Decision Queue for a human to approve/reject/snooze — use this instead of claiming you did something sensitive yourself), and create_workflow_draft (saves a disabled workflow draft for the user to review in the builder — you can never enable a workflow yourself; always say so explicitly and never imply the workflow is now running).

For the Decision Queue itself: list_decisions reads what's actually pending, and resolve_decision approves/rejects/snoozes one by id. If the user says "approve all pending decisions" or similar, call list_decisions first, then call resolve_decision once per id returned — never say the queue is empty without having called list_decisions, and never claim you approved something without actually calling resolve_decision for it.

You also have discover_web_prospects — the Prospecting Agent. Use it whenever the user asks you to find new candidates from the web: people, organizations, investors, partners, suppliers, or any other object type the workspace tracks (this is not limited to sales leads). It searches the live web, extracts real source-backed candidates, deduplicates them against the workspace graph, and either queues them in the Decision Queue for approval or creates records directly, exactly as the user specifies. Every candidate it returns has a real source URL — never invent a candidate yourself; always call this tool instead.

Key tool-chaining patterns:
- "Create a list of [records matching criteria]" → search_records first to find the IDs, then create_list, then add_to_list in sequence.
- "Add X to my Y list" → use list_lists to find the list ID, then search_records to find the record, then add_to_list.
- "Create a new object for tracking X" → use create_object_type with a clear description so fields are generated well.
- "Show related objects / connections / graph for X" → search_records to resolve X to a node_id (if not already known), then find_related_objects.
- "What needs attention" on a finance page → list_finance_summary, or list_invoices filtered to overdue/draft for detail.
- "Explain this report" → get_report for its definition, then run_report for its real numbers (or list_reports first if you need to resolve it by name).
- For multi-step operations, execute all steps and report the full outcome.

You will often be given prior conversation turns before the user's latest message. Use them: if the user says "this", "that answer", "the previous result", or asks you to explain/expand/act on something without restating it, resolve the reference using the conversation history actually provided to you. Only ask a clarifying question if there genuinely is no prior message or selected object that the reference could point to — do not claim there is no previous question if conversation history was provided above the latest message.

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
  },
  {
    name: "find_related_objects",
    description: "Look up the workspace graph for a record — returns other nodes connected to it by an edge (relationship), grouped by relationship type. Use for 'show related objects for X', 'what's connected to Y', 'show me the graph for Z', 'who/what is linked to this'. If you don't already know the node_id, pass the record's name and it will be resolved first.",
    input_schema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "The node ID to find relationships for, if already known from this conversation or a previous tool result" },
        name: { type: "string", description: "The record's name to resolve to a node first, if node_id is not known" }
      },
      required: []
    }
  },
  {
    name: "list_invoices",
    description: "List real invoices in the workspace, optionally filtered by status. Use for 'what invoices are overdue', 'show unpaid invoices', 'what needs attention' on a finance/invoices page, or any question about invoice status across the workspace.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "sent", "viewed", "paid", "overdue", "cancelled"], description: "Filter to a specific status, or omit for all" },
        limit: { type: "number", description: "Max invoices to return (default 15)" }
      },
      required: []
    }
  },
  {
    name: "get_invoice",
    description: "Fetch full detail for one invoice by ID — client, line items, totals, due date, status, payments. Use when the user is on a specific invoice's page (you'll be told the invoice_id in context) or names an invoice number you've already found.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice's node ID" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "list_finance_summary",
    description: "Real aggregate finance numbers for the workspace: count and total value of overdue, draft, sent, and paid invoices, plus outstanding credit notes. Use for 'what needs attention here' or 'explain my finances' on a finance page, or any question that needs a finance overview rather than a single invoice.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "list_reports",
    description: "List saved reports in the workspace by name and type. Use to resolve a report by name before calling get_report or run_report, or for 'what reports do I have'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max reports to return (default 15)" }
      },
      required: []
    }
  },
  {
    name: "get_report",
    description: "Fetch a saved report's definition — its name, type (insight/funnel/time_in_stage/historical), and config. Use when the user is on a report's page (you'll be told the report_id in context) and asks to explain or describe the report itself, before or alongside run_report.",
    input_schema: {
      type: "object",
      properties: {
        report_id: { type: "string", description: "The report's node ID" }
      },
      required: ["report_id"]
    }
  },
  {
    name: "run_report",
    description: "Actually execute a saved report and return its real computed data points (the same numbers the report page charts). Use for 'explain this report' or 'what does this report show' — call this, don't guess at numbers from the report's name alone.",
    input_schema: {
      type: "object",
      properties: {
        report_id: { type: "string", description: "The report's node ID" }
      },
      required: ["report_id"]
    }
  },
  {
    name: "create_note",
    description: "Create a note, optionally attached to a record. Use for 'add a note', 'jot this down', 'write a note about X'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title" },
        content: { type: "string", description: "Note body" },
        parent_id: { type: "string", description: "Optional node_id of the record this note is about" }
      },
      required: ["content"]
    }
  },
  {
    name: "list_decisions",
    description: "Read the real Decision Queue — pending (or resolved) agent recommendations awaiting human approval. Use this whenever the user asks about 'pending decisions', 'what needs approval', or says 'approve all/everything' — you must call this first to see what's actually there before approving anything; never claim the queue is empty without calling this.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "approved", "rejected", "snoozed"], description: "Default 'pending'" }
      }
    }
  },
  {
    name: "resolve_decision",
    description: "Approve, reject, or snooze one specific Decision Queue item by its id (from list_decisions). To act on 'all pending decisions', call list_decisions first, then call this once per decision id returned.",
    input_schema: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "The decision's id, from list_decisions" },
        action: { type: "string", enum: ["approve", "reject", "snooze"] }
      },
      required: ["decision_id", "action"]
    }
  },
  {
    name: "create_decision",
    description: "Add an item to the Decision Queue for a human to approve, reject, or snooze. Use when the user says 'add this to the decision queue', 'flag this for approval', or when you've drafted a recommendation (e.g. a follow-up, an invoice action) that needs human sign-off rather than being done immediately.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short decision title" },
        summary: { type: "string", description: "What you found / why this needs a decision" },
        recommended_action: { type: "string", description: "The specific action you're recommending" },
        risk_level: { type: "string", enum: ["low", "medium", "high"], description: "Default low" },
        source_type: { type: "string", description: "What this relates to, e.g. 'task', 'node', 'invoice' — omit if general" },
        source_id: { type: "string", description: "node_id/task_id this relates to, if any" }
      },
      required: ["title", "recommended_action"]
    }
  },
  {
    name: "create_workflow_draft",
    description: "Create a draft workflow (trigger/condition/action config) for the user to review in the workflow builder. The draft is always saved disabled — it requires the user to explicitly enable it there. Use for 'build me a workflow that...', 'create an automation for X'. Never claim the workflow is running — only that a draft was created for review.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workflow name" },
        description: { type: "string", description: "Plain-language description of what it should do — trigger, condition, and action" }
      },
      required: ["name", "description"]
    }
  },
  {
    name: "discover_web_prospects",
    description: "Search the live web for new candidate records — people, organizations, investors, partners, suppliers, assets, or any object type the workspace tracks — and add source-backed candidates to the workspace graph. Use for 'find me 25 AI startups in London', 'find investors focused on climate tech', 'find suppliers for X', 'find companies similar to this record', 'find potential partners'. Always queues for approval unless the user explicitly says to add them directly without review.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The natural-language search, e.g. 'AI startups in London' or 'climate tech investors in Europe'" },
        object_type: { type: "string", description: "The object type to create, e.g. 'company', 'person', 'investor', 'supplier', 'asset'. Infer a sensible one from the request." },
        count: { type: "number", description: "How many candidates to find. Default 10 if not specified." },
        destination_list_id: { type: "string", description: "If the user named an existing list to add results to, resolve it with list_lists first and pass its id here." },
        require_approval: { type: "boolean", description: "Default true. Set false only if the user explicitly says to add them directly without review." }
      },
      required: ["query", "object_type"]
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

export interface SourceMeta {
  type: string;
  title: string;
  node_id?: string;
  object_type?: string;
  relationship?: string;
  match_reason?: string;
  timestamp?: string;
}

async function executeTool(
  name: string,
  input: Record<string, any>,
  workspaceId: string,
  userId: string,
  sources: SourceMeta[]
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
        for (const t of data.slice(0, 8)) {
          sources.push({ type: "task", title: t.title, node_id: t.id, match_reason: `status: ${t.status || "todo"}`, timestamp: t.due_date ?? undefined });
        }
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
          for (const r of d2) {
            sources.push({ type: "record", title: (r.data as any).name || "Untitled", node_id: r.id, object_type: r.object_type, match_reason: `email matches "${input.query}"` });
          }
          const list = d2.map((r: any) => `- [${r.id}] ${r.data.name || "Untitled"} (${r.object_type})${r.data.email ? ` | ${r.data.email}` : ""}`).join("\n");
          return `Found ${d2.length} record(s):\n${list}`;
        }
        if (!data?.length) return `No records found matching "${input.query}".`;
        for (const r of data) {
          sources.push({ type: "record", title: (r.data as any).name || "Untitled", node_id: r.id, object_type: r.object_type, match_reason: `name matches "${input.query}"` });
        }
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
        for (const r of data.slice(0, 8)) {
          sources.push({ type: "record", title: (r.data as any).name || "Untitled", node_id: r.id, object_type: input.object_type, timestamp: r.updated_at });
        }
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

        // Use AI gateway to generate a smart attribute list
        let attributes: Array<{ id: string; name: string; type: string }> = [];
        try {
          const toolResult = await aiGatewayToolUse({
            prompt: `Generate 5-10 useful fields for a "${input.name}" object. Context: ${input.description}. Use snake_case names, appropriate types (currency for money, date for dates, select for status fields, checkbox for yes/no). Always include a status or stage select field.`,
            toolName: "define_attributes",
            toolDescription: "Define the fields for a custom object type",
            toolSchema: {
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
            maxTokens: 1024,
          });
          if (toolResult.attributes) {
            attributes = (toolResult.attributes as any[]).map((a: any) => ({
              id: crypto.randomUUID(),
              name: a.name,
              type: a.type,
            }));
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

      case "find_related_objects": {
        let nodeId = input.node_id as string | undefined;
        let sourceLabel = "";

        // Resolve a name to a node first if no node_id was given
        if (!nodeId && input.name) {
          const { data: matches } = await supabase
            .from("nodes")
            .select("id, object_type, data")
            .eq("workspace_id", workspaceId)
            .ilike("data->>name", `%${input.name}%`)
            .limit(1);
          if (!matches?.length) return `No record found matching "${input.name}" — cannot look up related objects.`;
          nodeId = matches[0]!.id;
          sourceLabel = `${(matches[0]!.data as any).name ?? input.name} (${matches[0]!.object_type})`;
        }
        if (!nodeId) return "No node_id or name provided — cannot look up related objects.";

        const related = await ubc.getRelated(nodeId);
        if (!related.length) return `No related objects found in the workspace graph for ${sourceLabel || nodeId}.`;

        for (const node of related.slice(0, 8)) {
          sources.push({
            type: "related_object",
            title: (node.data as any)?.name || (node.data as any)?.title || "Untitled",
            node_id: node.id,
            object_type: node.object_type,
            relationship: "related",
          });
        }
        const grouped: Record<string, typeof related> = {};
        for (const node of related) {
          const key = node.object_type;
          if (!grouped[key]) grouped[key] = [];
          grouped[key]!.push(node);
        }
        const summary = Object.entries(grouped).map(([type, nodes]) =>
          `${type} (${nodes.length}): ${nodes.map(n => `[${n.id}] ${(n.data as any)?.name || (n.data as any)?.title || "Untitled"}`).join(", ")}`
        ).join("\n");
        return `Found ${related.length} related object(s) in the workspace graph${sourceLabel ? ` for ${sourceLabel}` : ""}, grouped by type:\n${summary}`;
      }

      case "list_invoices": {
        let query = supabase
          .from("nodes")
          .select("id,data,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("vertical", "finance")
          .eq("object_type", "invoice")
          .order("created_at", { ascending: false })
          .limit(Math.min(input.limit ?? 15, 30));
        if (input.status) query = query.eq("data->>status", input.status);
        const { data, error } = await query;
        if (error) return `Error fetching invoices: ${error.message}`;
        if (!data?.length) return input.status ? `No ${input.status} invoices found.` : "No invoices found.";
        for (const row of data.slice(0, 8)) {
          const d = row.data as any;
          sources.push({
            type: "invoice", title: `${d.number ?? "Invoice"} — ${d.client_name ?? "Unknown client"}`,
            node_id: row.id, object_type: "invoice",
            match_reason: `status: ${d.status ?? "draft"}`, timestamp: d.due_date ?? row.updated_at,
          });
        }
        const list = data.map(row => {
          const d = row.data as any;
          return `- [${row.id}] ${d.number ?? "Invoice"} | ${d.client_name ?? "Unknown client"} | ${d.total ?? 0} ${d.currency ?? "GBP"} | status: ${d.status ?? "draft"}${d.due_date ? ` | due: ${new Date(d.due_date).toLocaleDateString()}` : ""}`;
        }).join("\n");
        return `Found ${data.length} invoice(s):\n${list}`;
      }

      case "get_invoice": {
        const { data, error } = await supabase
          .from("nodes")
          .select("id,data,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("id", input.invoice_id)
          .eq("vertical", "finance")
          .eq("object_type", "invoice")
          .maybeSingle();
        if (error) return `Error fetching invoice: ${error.message}`;
        if (!data) return `No invoice found with ID ${input.invoice_id}.`;
        const d = data.data as any;
        sources.push({
          type: "invoice", title: `${d.number ?? "Invoice"} — ${d.client_name ?? "Unknown client"}`,
          node_id: data.id, object_type: "invoice", match_reason: `status: ${d.status ?? "draft"}`, timestamp: d.due_date,
        });
        const items = Array.isArray(d.line_items) ? d.line_items.map((li: any) => `  - ${li.description}: ${li.quantity} x ${li.unit_price} (tax ${li.tax_rate ?? 0}%)`).join("\n") : "";
        return `Invoice ${d.number ?? data.id} for ${d.client_name ?? "Unknown client"}\nStatus: ${d.status ?? "draft"}\nTotal: ${d.total ?? 0} ${d.currency ?? "GBP"}${d.due_date ? `\nDue: ${new Date(d.due_date).toLocaleDateString()}` : ""}\nLine items:\n${items || "  (none)"}`;
      }

      case "list_finance_summary": {
        const { data: invoices, error: invErr } = await supabase
          .from("nodes")
          .select("id,data")
          .eq("workspace_id", workspaceId)
          .eq("vertical", "finance")
          .eq("object_type", "invoice");
        if (invErr) return `Error fetching finance summary: ${invErr.message}`;
        const rows = (invoices ?? []).map(r => r.data as any);
        const byStatus = (status: string) => rows.filter(d => (d.status ?? "draft") === status);
        const sum = (list: any[]) => list.reduce((s, d) => s + Number(d.total ?? 0), 0);
        const overdue = byStatus("overdue");
        const draft = byStatus("draft");
        const sent = byStatus("sent");
        const paid = byStatus("paid");

        const { data: creditNotes } = await supabase
          .from("nodes")
          .select("id,data")
          .eq("workspace_id", workspaceId)
          .eq("vertical", "finance")
          .eq("object_type", "credit_note")
          .neq("data->>status", "void");
        const outstandingCreditNotes = (creditNotes ?? []).filter(r => (r.data as any).status !== "executed");

        if (overdue.length) {
          sources.push({ type: "finance", title: `${overdue.length} overdue invoice(s)`, match_reason: `total ${sum(overdue).toFixed(2)}` });
        }
        if (rows.length === 0) return "No invoices exist in this workspace yet.";
        return [
          `Finance summary (real data, ${rows.length} invoice(s) total):`,
          `- Overdue: ${overdue.length} invoice(s), total ${sum(overdue).toFixed(2)}`,
          `- Draft: ${draft.length} invoice(s), total ${sum(draft).toFixed(2)}`,
          `- Sent (awaiting payment): ${sent.length} invoice(s), total ${sum(sent).toFixed(2)}`,
          `- Paid: ${paid.length} invoice(s), total ${sum(paid).toFixed(2)}`,
          `- Outstanding credit notes: ${outstandingCreditNotes.length}`,
        ].join("\n");
      }

      case "list_reports": {
        const { data, error } = await supabase
          .from("nodes")
          .select("id,data,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("object_type", "report")
          .order("updated_at", { ascending: false })
          .limit(Math.min(input.limit ?? 15, 30));
        if (error) return `Error fetching reports: ${error.message}`;
        if (!data?.length) return "No saved reports found.";
        for (const row of data.slice(0, 8)) {
          const d = row.data as any;
          sources.push({ type: "report", title: d.name ?? "Untitled report", node_id: row.id, object_type: "report", match_reason: `type: ${d.type ?? "insight"}`, timestamp: row.updated_at });
        }
        return `Found ${data.length} report(s):\n${data.map(row => `- [${row.id}] ${(row.data as any).name ?? "Untitled"} (${(row.data as any).type ?? "insight"})`).join("\n")}`;
      }

      case "get_report": {
        const { data, error } = await supabase
          .from("nodes")
          .select("id,data,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("object_type", "report")
          .eq("id", input.report_id)
          .maybeSingle();
        if (error) return `Error fetching report: ${error.message}`;
        if (!data) return `No report found with ID ${input.report_id}.`;
        const d = data.data as any;
        sources.push({ type: "report", title: d.name ?? "Untitled report", node_id: data.id, object_type: "report", match_reason: `type: ${d.type ?? "insight"}`, timestamp: data.updated_at });
        return `Report "${d.name ?? "Untitled"}" — type: ${d.type ?? "insight"}\nConfig: ${JSON.stringify(d.config ?? {})}`;
      }

      case "run_report": {
        const result = await runReportData(workspaceId, input.report_id);
        if ("error" in result) return `Error running report: ${result.error}`;
        sources.push({ type: "report", title: `Report run: ${input.report_id}`, node_id: input.report_id, object_type: "report", match_reason: `chart_type: ${result.chart_type}` });
        const points = result.data.slice(0, 12).map(p => `- ${p.label}: ${p.value}`).join("\n");
        return [
          `Report run results (real computed data, chart type: ${result.chart_type}):`,
          points || "(no data points)",
          result.total !== undefined ? `Total: ${result.total}` : "",
        ].filter(Boolean).join("\n");
      }

      case "create_note": {
        const { data, error } = await supabase
          .from("nodes")
          .insert({
            workspace_id: workspaceId,
            vertical: "shared",
            object_type: "note",
            created_by: userId,
            data: {
              parent_id: input.parent_id ?? null,
              title: input.title ?? "Untitled note",
              content: input.content,
              created_at: new Date().toISOString(),
            },
          })
          .select("id")
          .single();
        if (error) return `Error creating note: ${error.message}`;
        sources.push({ type: "note", title: input.title ?? "Untitled note", node_id: data.id, object_type: "note" });
        return `Note created (ID: ${data.id}).`;
      }

      case "list_decisions": {
        const status = (input.status as string) || "pending";
        const { data, error } = await supabase
          .from("decision_queue")
          .select("id, title, summary, recommended_action, risk_level, agent_name, source_type, status, created_at")
          .eq("workspace_id", workspaceId)
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return `Error reading decision queue: ${error.message}`;
        if (!data?.length) return `No ${status} decisions in the Decision Queue.`;
        for (const d of data) {
          sources.push({ type: "decision", title: d.title, node_id: d.id, object_type: "decision", match_reason: `${d.risk_level} risk · ${d.agent_name}` });
        }
        const list = data.map(d => `- [${d.id}] ${d.title} (${d.agent_name}, ${d.risk_level} risk)${d.recommended_action ? ` — ${d.recommended_action}` : ""}`).join("\n");
        return `${data.length} ${status} decision(s):\n${list}`;
      }

      case "resolve_decision": {
        const decisionId = String(input.decision_id ?? "");
        const action = String(input.action ?? "");
        if (!["approve", "reject", "snooze"].includes(action)) return "Invalid action — must be approve, reject, or snooze.";
        const { data: decision, error: fetchError } = await supabase
          .from("decision_queue")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("id", decisionId)
          .maybeSingle();
        if (fetchError || !decision) return `Could not find decision ${decisionId}.`;
        const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "snoozed";
        if (action === "approve") await executeApprovedAction(workspaceId, decision).catch(() => {});
        const { error: updateError } = await supabase
          .from("decision_queue")
          .update({ status: newStatus, resolved_at: new Date().toISOString(), resolved_by: userId })
          .eq("id", decisionId);
        if (updateError) return `Error resolving decision: ${updateError.message}`;
        sources.push({ type: "decision", title: decision.title, node_id: decisionId, object_type: "decision" });
        return `${action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Snoozed"}: "${decision.title}".`;
      }

      case "create_decision": {
        const { data, error } = await supabase
          .from("decision_queue")
          .insert({
            workspace_id: workspaceId,
            source_type: input.source_type ?? "ask",
            source_id: input.source_id ?? null,
            agent_name: "ask-mondaily",
            title: input.title,
            summary: input.summary ?? null,
            recommended_action: input.recommended_action,
            risk_level: input.risk_level ?? "low",
            evidence: [],
          })
          .select("id")
          .single();
        if (error) return `Error adding to decision queue: ${error.message}`;
        sources.push({ type: "record", title: input.title, node_id: data.id, object_type: "decision" });
        return `Added to the decision queue: "${input.title}" (ID: ${data.id}). It's pending — a human needs to approve, reject, or snooze it before anything happens.`;
      }

      case "create_workflow_draft": {
        const { data, error } = await supabase
          .from("nodes")
          .insert({
            workspace_id: workspaceId,
            vertical: "shared",
            object_type: "automation",
            created_by: userId,
            data: {
              name: input.name,
              type: "workflow",
              status: "draft",
              description: input.description,
              enabled: false,
            },
          })
          .select("id")
          .single();
        if (error) return `Error creating workflow draft: ${error.message}`;
        sources.push({ type: "workflow", title: input.name, node_id: data.id, object_type: "automation" });
        return `Created a draft workflow "${input.name}" (ID: ${data.id}) based on: ${input.description}. It is saved disabled — open the workflow builder to review and enable it. I cannot enable it for you.`;
      }

      case "discover_web_prospects": {
        const result = await runProspecting(workspaceId, userId, {
          query: String(input.query),
          object_type: String(input.object_type),
          count: typeof input.count === "number" ? input.count : 10,
          destination_list_id: input.destination_list_id || undefined,
          require_approval: input.require_approval !== false,
        });
        for (const cand of result.candidates) {
          sources.push({
            type: "prospect",
            title: cand.name,
            node_id: cand.node_id,
            object_type: cand.object_type,
            match_reason: `${cand.status} · ${cand.confidence_label} confidence · ${cand.reason}`,
          });
        }
        const parts = [
          result.created > 0 ? `${result.created} created` : null,
          result.queued_for_review > 0 ? `${result.queued_for_review} queued in the Decision Queue for review` : null,
          result.existing > 0 ? `${result.existing} already existed in the graph (skipped as duplicates)` : null,
          result.added_to_list > 0 ? `${result.added_to_list} added to the destination list` : null,
        ].filter(Boolean).join(", ");
        if (!result.candidates.length) return `No real candidates found for "${input.query}" — the web search returned nothing usable. Try a more specific query.`;
        return `Searched the web for "${input.query}" (${input.object_type}): ${parts || "no new candidates"}. Every candidate is source-backed — see the source cards for the page each one came from.`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Tool error: ${err.message}`;
  }
}

// Maps an object_type to the natural-language word a user would actually
// say ("this company", "this deal") so context resolution isn't limited to
// the literal object_type string.
const OBJECT_LABEL: Record<string, string> = {
  company: "company", companies: "company",
  person: "person", contact: "person",
  deal: "deal",
  task: "task",
};

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

const HISTORY_TURN_LIMIT = 16; // last N turns (user+assistant messages combined) sent for context

router.post("/", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().optional(),
  model: z.enum(["auto", "fast", "smart"]).optional(),
  web_search: z.boolean().optional(),
  // Prior turns of this conversation, sent by the frontend so the AI can
  // resolve "this", "that answer", follow-up actions, etc. Without this the
  // backend has no memory — every request used to be treated as a fresh
  // conversation with no way to reference what was said before.
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  })).optional(),
  // Optional context about whatever the user currently has open — a
  // record/node (record detail page), a task (task drawer), or just a named
  // scope (e.g. "Finance", "Reports") — so "for this"/"this task" resolves
  // without the user having to restate it. Sent identically by every Ask
  // surface (Home, main Ask page, right-side drawer) via useAskEngine.
  context: z.object({
    node_id: z.string().optional(),
    node_name: z.string().optional(),
    object_type: z.string().optional(),
    task_id: z.string().optional(),
    task_title: z.string().optional(),
    task_status: z.string().optional(),
    task_assignee: z.string().optional(),
    task_record_id: z.string().optional(),
    invoice_id: z.string().optional(),
    report_id: z.string().optional(),
    report_title: z.string().optional(),
    route: z.string().optional(),
    scope_label: z.string().optional()
  }).optional()
})), async (c) => {
  const { message, model: modelPref, web_search, history, context } = c.req.valid("json");

  // AI_AGENT_MODEL env var overrides user preference (swap provider without code change).
  // When not set, honour the user's fast/smart/auto preference mapped to Claude models.
  const agentModelSpec = process.env.AI_AGENT_MODEL ?? (() => {
    const map: Record<string, string> = {
      fast: "anthropic/claude-haiku-4-5-20251001",
      smart: "anthropic/claude-sonnet-4-6",
      auto: "anthropic/claude-sonnet-4-6",
    };
    return map[modelPref ?? "auto"] ?? "anthropic/claude-sonnet-4-6";
  })();

  // Model ID string for usage tracking (strip provider prefix)
  const model = agentModelSpec.includes("/") ? agentModelSpec.split("/").slice(1).join("/") : agentModelSpec;

  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");

  try {
    let webContext = "";
    if (web_search === true || process.env.WEB_SEARCH_DEFAULT === "true") {
      webContext = await searchWeb(message);
    }

    let contextNote = "";
    if (context?.node_id || context?.node_name) {
      const objectLabel = context.object_type ? OBJECT_LABEL[context.object_type.toLowerCase()] ?? context.object_type : "object";
      contextNote += `\n\nThe user currently has a record selected/open: ${context.node_name ?? "(name unknown)"}${context.object_type ? ` (${context.object_type})` : ""}${context.node_id ? ` — node_id: ${context.node_id}` : ""}. If their message refers to "this", "this record", "this ${objectLabel}", or names the object type directly (e.g. "this company", "this person", "this deal"), it means this one — you can call find_related_objects with this node_id directly without searching for it first.`;
    }
    if (context?.task_id) {
      contextNote += `\n\nThe user currently has a task open: "${context.task_title ?? "(title unknown)"}" — task_id: ${context.task_id}.${context.task_status ? ` Status: ${context.task_status}.` : ""}${context.task_assignee ? ` Assignee: ${context.task_assignee}.` : ""}${context.task_record_id ? ` Linked record node_id: ${context.task_record_id}.` : ""} If their message refers to "this" or "this task", it means this one — you can call update_task with this task_id directly without searching for it first. If they ask to create a follow-up from this, base it on this task's title/status and (if present) its linked record.`;
    }
    if (context?.invoice_id) {
      contextNote += `\n\nThe user currently has invoice ${context.invoice_id} open. If their message refers to "this invoice" or "this", it means this one — call get_invoice with this invoice_id directly without searching for it first.`;
    }
    if (context?.report_id || context?.report_title) {
      contextNote += `\n\nThe user is currently viewing a report/dashboard: "${context.report_title ?? "(title unknown)"}"${context.report_id ? ` — report_id: ${context.report_id}` : ""}. If their message refers to "this report" or "this", it means this one. To explain or describe it, call run_report with this report_id to get its real computed numbers — do not guess at the numbers from the name alone. Call get_report first if you also need its config/type.`;
    }
    if (context?.scope_label && /finance|invoice/i.test(context.scope_label) && !context.invoice_id) {
      contextNote += `\n\nThe user is currently viewing: ${context.scope_label}. For "what needs attention here" or any finance question, call list_finance_summary (or list_invoices for the underlying list) to ground your answer in real invoice data — do not answer generically without checking.`;
    } else if (context?.scope_label && /report/i.test(context.scope_label) && !context.report_id) {
      contextNote += `\n\nThe user is currently viewing: ${context.scope_label}. For questions about it, call list_reports to find the relevant one, then run_report — do not answer generically without checking.`;
    } else if (context?.scope_label && !context.node_id && !context.task_id && !context.invoice_id && !context.report_id) {
      contextNote += `\n\nThe user is currently viewing: ${context.scope_label}. Treat this as the default scope for vague references like "this" unless they clearly mean something else.`;
    }
    if (context?.route) {
      contextNote += `\n\nCurrent route: ${context.route}`;
    }

    const systemPrompt = SYSTEM_PROMPT + (webContext ? `\n\nWeb context:\n${webContext}` : "") + contextNote;

    // Prepend prior conversation turns (capped) so the model has real memory
    // of this thread instead of treating every message as the first one.
    const priorTurns = (history ?? []).slice(-HISTORY_TURN_LIMIT).map(h => ({ role: h.role, content: h.content }));
    const messages: any[] = [...priorTurns, { role: "user", content: message }];

    const sources: SourceMeta[] = [];

    const { reply: agentReply, rounds, provider } = await aiGatewayAgent({
      system: systemPrompt,
      tools: TOOLS,
      messages,
      maxTokens: 2048,
      model: agentModelSpec,
      onToolCall: async (name, input) =>
        executeTool(name, input as Record<string, any>, workspaceId, userId, sources),
    });

    console.log(`[ask] done provider=${provider} rounds=${rounds} replyLen=${agentReply.length} sources=${sources.length}`);

    let reply = agentReply;

    if (!reply) reply = "I looked through your workspace but couldn't find anything relevant to that request. Try asking in a different way or add some data first.";

    // Extract follow-up suggestions
    let suggestions: string[] = [];
    const followupMatch = reply.match(/<followups>([\s\S]*?)<\/followups>/);
    if (followupMatch) {
      try { suggestions = JSON.parse(followupMatch[1] ?? "[]"); } catch {}
      reply = reply.replace(/<followups>[\s\S]*?<\/followups>/, "").trim();
    }

    // Dedupe sources by node_id (or title if no node_id), cap to a sane count
    const seen = new Set<string>();
    const dedupedSources = sources.filter(s => {
      const key = s.node_id ?? s.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);

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

    return c.json({ reply, suggestions, sources: dedupedSources, thread_id: null });
  } catch (err: any) {
    console.error("[ask] unexpected error:", err?.message ?? err);
    return c.json({ reply: "I ran into an unexpected issue. Please try again.", suggestions: [], sources: [], thread_id: null });
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
