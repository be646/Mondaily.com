import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob, logStep } from "../lib/agent-logger";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";

/**
 * Provider-agnostic agent runners.
 *
 * Each function here holds the *real* logic for one background agent. The
 * Inngest job wrappers (deal-alerts.ts, relationship-health.ts, …) call these,
 * and so do the Vercel Cron endpoint (/api/cron/daily) and the on-demand
 * "Run now" routes (POST /api/v1/agents/:id/run). One implementation, three
 * trigger surfaces — nothing is duplicated or faked.
 *
 * Every runner accepts an optional `workspaceId`:
 *   - omitted  → run across all workspaces (scheduled/cron behaviour)
 *   - provided → run for a single workspace (on-demand from the app)
 */

async function listWorkspaceIds(workspaceId?: string): Promise<string[]> {
  if (workspaceId) return [workspaceId];
  const { data } = await supabase.from("workspaces").select("id");
  return (data ?? []).map((w) => w.id as string);
}

/**
 * Object-type matching by stem, not exact string. Workspaces name their
 * types freely ("people", "contact-leads", "companies"), so exact-match
 * filters silently miss everything. Match on substring stems instead.
 */
const PERSON_OR_COMPANY_STEMS = ["contact", "person", "people", "lead", "client", "compan", "account", "organization", "org", "investor", "supplier", "employee", "candidate"];
function isRelationshipType(objectType: string): boolean {
  const t = objectType.toLowerCase();
  return PERSON_OR_COMPANY_STEMS.some((s) => t.includes(s));
}

// ── Relationship Agent: cold-deal alerts ────────────────────────────────────────
export async function runDealAlerts(workspaceId?: string): Promise<{ alerts_created: number }> {
  const jobId = await startJob({
    workspace_id: workspaceId ?? "system",
    agent_name: "deal_alerts",
    trigger_type: workspaceId ? "manual" : "scheduled",
    input: {},
    node_ids: [],
  });

  try {
    const wsIds = await listWorkspaceIds(workspaceId);
    let totalAlerts = 0;

    for (const wsId of wsIds) {
      const { data: deals } = await supabase
        .from("nodes")
        .select("id, data, updated_at")
        .eq("workspace_id", wsId)
        .ilike("object_type", "%deal%");

      for (const deal of deals ?? []) {
        const data = deal.data as Record<string, unknown>;
        const stage = String(data.stage ?? data.status ?? "").toLowerCase();
        if (["won", "lost", "closed"].some((s) => stage.includes(s))) continue;

        const daysInactive = Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / 86400000);
        if (daysInactive < 14) continue;

        const { data: existing } = await supabase
          .from("deal_alerts")
          .select("id")
          .eq("node_id", deal.id)
          .eq("alert_type", "cold_deal")
          .is("dismissed_at", null)
          .single();
        if (existing) continue;

        await supabase.from("deal_alerts").insert({
          workspace_id: wsId, node_id: deal.id, alert_type: "cold_deal", days_inactive: daysInactive,
        });
        await supabase.from("notifications").insert({
          workspace_id: wsId, type: "alert", title: "🥶 Cold deal detected",
          body: `"${data.name ?? data.title ?? "Deal"}" has had no activity for ${daysInactive} days`,
          metadata: { node_id: deal.id, days_inactive: daysInactive },
        });
        await supabase.from("decision_queue").insert({
          workspace_id: wsId, source_type: "node", source_id: deal.id, agent_name: "relationship",
          title: `${data.name ?? data.title ?? "This relationship"} has gone quiet`,
          summary: `No activity for ${daysInactive} days.`,
          recommended_action: "Reach out to re-engage, or mark as lost",
          risk_level: daysInactive > 30 ? "high" : "medium",
          evidence: [{ type: "record", title: String(data.name ?? data.title ?? "Deal"), node_id: deal.id, match_reason: `${daysInactive} days inactive` }],
        }).then(() => {}, () => {});
        totalAlerts++;
      }
    }

    await completeJob(jobId, { alerts_created: totalAlerts, summary: `Flagged ${totalAlerts} cold deal(s)` }, []);
    return { alerts_created: totalAlerts };
  } catch (err: unknown) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── Relationship Agent: health scoring ──────────────────────────────────────────
export async function runRelationshipHealth(workspaceId?: string): Promise<{ total_scored: number }> {
  const wsIds = await listWorkspaceIds(workspaceId);
  let totalScored = 0;

  for (const wsId of wsIds) {
    const jobId = await startJob({
      workspace_id: wsId, agent_name: "relationship_health",
      trigger_type: workspaceId ? "manual" : "scheduled", input: { workspace_id: wsId },
    });
    try {
      // Fetch all nodes and filter by stem — workspaces use plural/hyphenated
      // type names ("people", "contact-leads", "companies") that exact-match misses.
      const { data: allNodes } = await supabase
        .from("nodes").select("id, data, object_type").eq("workspace_id", wsId).limit(5000);
      const contacts = (allNodes ?? []).filter((n) => isRelationshipType(String(n.object_type)));
      if (!contacts.length) { await completeJob(jobId, { scored: 0 }, []); continue; }

      for (const contact of contacts) {
        const signals: Record<string, unknown> = {};
        let score = 50;
        const lastContact = contact.data?.last_contacted_at ?? contact.data?.last_contact;
        if (lastContact) {
          const days = Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000);
          signals.days_since_contact = days;
          if (days <= 7) score += 25; else if (days <= 30) score += 10; else if (days <= 90) score -= 10; else score -= 25;
        } else { signals.days_since_contact = null; score -= 15; }

        const { count: openTasks } = await supabase.from("nodes").select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId).eq("object_type", "task").eq("data->>status", "todo").eq("data->>record_id", contact.id);
        signals.open_tasks = openTasks ?? 0;
        if ((openTasks ?? 0) > 3) score -= 10;

        const { count: openDeals } = await supabase.from("nodes").select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId).eq("object_type", "deal").not("data->>stage", "in", '("closed_won","closed_lost")').eq("data->>contact_id", contact.id);
        signals.open_deals = openDeals ?? 0;
        if ((openDeals ?? 0) > 0) score += 15;

        const { count: recentActivity } = await supabase.from("activities").select("id", { count: "exact", head: true })
          .eq("node_id", contact.id).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
        signals.recent_activity_30d = recentActivity ?? 0;
        if ((recentActivity ?? 0) >= 5) score += 15; else if ((recentActivity ?? 0) >= 2) score += 5; else if ((recentActivity ?? 0) === 0) score -= 10;

        const finalScore = Math.max(0, Math.min(100, score));
        await supabase.from("nodes").update({ relationship_health: finalScore, health_updated_at: new Date().toISOString(), health_signals: signals }).eq("id", contact.id);
        totalScored++;
      }
      await completeJob(jobId, { scored: contacts.length, summary: `Scored ${contacts.length} relationship(s)` }, []);
    } catch (err: unknown) {
      await failJob(jobId, err instanceof Error ? err.message : String(err));
    }
  }
  return { total_scored: totalScored };
}

// ── Operations Agent: overdue-task decisions ────────────────────────────────────
export async function runOverdueTaskDecisions(workspaceId?: string): Promise<{ queued: number }> {
  const jobId = await startJob({
    workspace_id: workspaceId ?? "system", agent_name: "operations",
    trigger_type: workspaceId ? "manual" : "scheduled", input: {},
  });
  try {
    const wsIds = await listWorkspaceIds(workspaceId);
    let queued = 0;
    for (const wsId of wsIds) {
      const { data: tasks } = await supabase
        .from("tasks").select("id, title, due_date, priority, assignee_email")
        .eq("workspace_id", wsId).eq("completed", false).lt("due_date", new Date().toISOString());
      for (const task of tasks ?? []) {
        const { data: existing } = await supabase.from("decision_queue").select("id")
          .eq("workspace_id", wsId).eq("source_type", "task").eq("source_id", task.id)
          .eq("agent_name", "operations").eq("status", "pending").maybeSingle();
        if (existing) continue;
        const daysOverdue = Math.floor((Date.now() - new Date(task.due_date!).getTime()) / 86_400_000);
        await supabase.from("decision_queue").insert({
          workspace_id: wsId, source_type: "task", source_id: task.id, agent_name: "operations",
          title: `Overdue: ${task.title}`,
          summary: `${daysOverdue} day(s) overdue${task.assignee_email ? `, assigned to ${task.assignee_email}` : ", unassigned"}.`,
          recommended_action: "Reassign, reschedule, or mark complete",
          risk_level: daysOverdue > 7 || task.priority === "urgent" ? "high" : daysOverdue > 2 ? "medium" : "low",
          evidence: [{ type: "task", title: task.title, node_id: task.id, match_reason: `${daysOverdue} days overdue`, timestamp: task.due_date }],
        });
        queued++;
      }
    }
    await completeJob(jobId, { queued, summary: `Queued ${queued} overdue-task decision(s)` }, []);
    return { queued };
  } catch (err: unknown) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── Finance Agent: invoice chaser ───────────────────────────────────────────────
interface InvoiceData {
  status?: string; due_date?: string; amount?: number; currency?: string;
  client_name?: string; client_email?: string; invoice_number?: string;
  last_chased_at?: string; chase_count?: number;
}
function daysOverdue(dueDateStr: string): number {
  return Math.floor((Date.now() - new Date(dueDateStr).getTime()) / 86_400_000);
}
function chaseMessage(invoice: InvoiceData, days: number): { subject: string; body: string } {
  const num = invoice.invoice_number ?? "your invoice";
  const amount = invoice.amount
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency ?? "USD" }).format(invoice.amount)
    : "the outstanding amount";
  if (days <= 7) return { subject: `Friendly reminder: ${num} is overdue`, body: `Hi ${invoice.client_name ?? "there"},\n\nThis is a friendly reminder that ${num} for ${amount} was due ${days} day${days === 1 ? "" : "s"} ago.\n\nPlease let us know if you have any questions.\n\nThank you!` };
  if (days <= 14) return { subject: `Second notice: ${num} — ${days} days overdue`, body: `Hi ${invoice.client_name ?? "there"},\n\nWe noticed that ${num} for ${amount} remains unpaid and is now ${days} days overdue.\n\nPlease arrange payment at your earliest convenience.\n\nIf there's an issue, please reach out so we can resolve it.\n\nRegards` };
  return { subject: `Urgent: ${num} — ${days} days past due`, body: `Hi ${invoice.client_name ?? "there"},\n\nDespite previous reminders, ${num} for ${amount} remains unpaid at ${days} days overdue.\n\nPlease treat this as urgent. If payment cannot be made immediately, contact us to discuss arrangements.\n\nThis matter may be escalated if not resolved promptly.` };
}
export async function runInvoiceChaser(workspaceId?: string): Promise<{ total_chased: number; total_skipped: number }> {
  const wsIds = await listWorkspaceIds(workspaceId);
  let totalChased = 0, totalSkipped = 0;
  for (const wsId of wsIds) {
    const jobId = await startJob({
      workspace_id: wsId, agent_name: "invoice_chaser",
      trigger_type: workspaceId ? "manual" : "scheduled", input: { workspace_id: wsId },
    });
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data: invoices } = await supabase
        .from("nodes").select("id, workspace_id, data")
        .eq("workspace_id", wsId).eq("object_type", "invoice")
        .lt("data->>due_date", today).in("data->>status", ["sent", "overdue", "unpaid"]) as { data: { id: string; data: InvoiceData }[] | null };
      if (!invoices?.length) { await completeJob(jobId, { chased: 0, message: "no overdue invoices" }, []); continue; }

      const steps: unknown[] = []; let chased = 0;
      for (const invoice of invoices) {
        const due = invoice.data.due_date; if (!due) continue;
        const days = daysOverdue(due); if (days <= 0) continue;
        const lastChased = invoice.data.last_chased_at;
        if (lastChased && daysOverdue(lastChased) < 3) { totalSkipped++; continue; }

        const { subject } = chaseMessage(invoice.data, days);
        const chaseCount = (invoice.data.chase_count ?? 0) + 1;
        await logStep(jobId, { invoice_id: invoice.id, days_overdue: days, chase_count: chaseCount });

        const { data: existingDecision } = await supabase.from("decision_queue").select("id")
          .eq("workspace_id", wsId).eq("source_type", "invoice").eq("source_id", invoice.id)
          .eq("agent_name", "invoice_chaser").eq("status", "pending").maybeSingle();
        if (existingDecision) { totalSkipped++; continue; }

        await supabase.from("decision_queue").insert({
          workspace_id: wsId, source_type: "invoice", source_id: invoice.id, agent_name: "invoice_chaser",
          title: `Chase invoice ${invoice.data.invoice_number ?? invoice.id} — ${days} days overdue`,
          summary: `Draft reminder ready to send to ${invoice.data.client_email ?? "no email on file"}.`,
          recommended_action: `Send: "${subject}"`,
          risk_level: days > 14 ? "high" : days > 7 ? "medium" : "low",
          evidence: [{ type: "invoice", title: subject, node_id: invoice.id, match_reason: `${days} days overdue`, timestamp: due }],
        });
        steps.push({ decision_queued: true, invoice_id: invoice.id, days_overdue: days });
        await supabase.from("notifications").insert({
          workspace_id: wsId, type: "agent",
          title: `Invoice ${invoice.data.invoice_number ?? ""} chase ready for approval`,
          body: `${days} days overdue · reminder #${chaseCount} drafted, awaiting your approval`,
          metadata: { invoice_id: invoice.id, days_overdue: days },
        });
        chased++; totalChased++;
      }
      await completeJob(jobId, { chased, skipped: totalSkipped, summary: `Drafted ${chased} chase(s) for approval` }, steps);
    } catch (err: unknown) {
      await failJob(jobId, err instanceof Error ? err.message : String(err));
    }
  }
  return { total_chased: totalChased, total_skipped: totalSkipped };
}

// ── Finance Agent: recurring invoices ───────────────────────────────────────────
interface RecurringData {
  is_recurring?: boolean; recurring_frequency?: "monthly" | "quarterly" | "annual";
  next_due_date?: string; number?: string; client_name?: string; client_email?: string;
  client_address?: string; currency?: string; line_items?: unknown[]; subtotal?: number;
  tax_total?: number; total?: number; notes?: string; linked_record_id?: string; status?: string;
}
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr); d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0] ?? dateStr;
}
function nextDueDateAfter(current: string, frequency: string): string {
  if (frequency === "quarterly") return addMonths(current, 3);
  if (frequency === "annual") return addMonths(current, 12);
  return addMonths(current, 1);
}
async function nextInvoiceNumber(workspaceId: string): Promise<string> {
  const { count } = await supabase.from("nodes").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).eq("vertical", "finance").eq("object_type", "invoice");
  return `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
}
export async function runRecurringInvoices(workspaceId?: string): Promise<{ generated: number }> {
  const wsIds = await listWorkspaceIds(workspaceId);
  let totalGenerated = 0;
  for (const wsId of wsIds) {
    const jobId = await startJob({
      workspace_id: wsId, agent_name: "recurring_invoices",
      trigger_type: workspaceId ? "manual" : "scheduled", input: { workspace_id: wsId },
    });
    try {
      const today = new Date().toISOString().split("T")[0] ?? "";
      const { data: invoices } = await supabase.from("nodes").select("id, workspace_id, data")
        .eq("workspace_id", wsId).eq("object_type", "invoice")
        .eq("data->>is_recurring", "true").neq("data->>status", "cancelled") as { data: { id: string; data: RecurringData }[] | null };
      if (!invoices?.length) { await completeJob(jobId, { generated: 0, message: "no recurring invoices" }, []); continue; }

      let generated = 0; const steps: unknown[] = [];
      for (const invoice of invoices) {
        const nextDue = invoice.data.next_due_date; if (!nextDue) continue;
        if (today < nextDue) continue;
        const newNumber = await nextInvoiceNumber(wsId);
        const newInvoiceData = {
          number: newNumber, client_name: invoice.data.client_name ?? "", client_email: invoice.data.client_email ?? null,
          client_address: invoice.data.client_address ?? null, line_items: invoice.data.line_items ?? [],
          currency: invoice.data.currency ?? "GBP", subtotal: invoice.data.subtotal ?? 0, tax_total: invoice.data.tax_total ?? 0,
          total: invoice.data.total ?? 0, notes: invoice.data.notes ?? null, status: "draft", sent_at: null, paid_at: null, chase_count: 0,
          ...(invoice.data.linked_record_id ? { linked_record_id: invoice.data.linked_record_id } : {}),
        };
        const { data: newInvoice, error: insertErr } = await supabase.from("nodes")
          .insert({ workspace_id: wsId, vertical: "finance", object_type: "invoice", data: newInvoiceData, created_by: "agent:recurring_invoices" })
          .select("id").single();
        if (insertErr) { steps.push({ error: insertErr.message, original_id: invoice.id }); continue; }

        const updatedNextDue = nextDueDateAfter(nextDue, invoice.data.recurring_frequency ?? "monthly");
        await supabase.from("nodes").update({ data: { ...invoice.data, next_due_date: updatedNextDue } }).eq("id", invoice.id);
        await supabase.from("notifications").insert({
          workspace_id: wsId, type: "agent", title: `Recurring invoice generated: ${newNumber}`,
          body: `Cloned from ${invoice.data.number ?? invoice.id} · Next due: ${updatedNextDue}`,
          metadata: { original_invoice_id: invoice.id, new_invoice_id: newInvoice.id },
        });
        steps.push({ generated: newNumber, original_id: invoice.id, new_id: newInvoice.id });
        generated++; totalGenerated++;
      }
      await completeJob(jobId, { generated, summary: `Generated ${generated} recurring invoice(s)` }, steps);
    } catch (err: unknown) {
      await failJob(jobId, err instanceof Error ? err.message : String(err));
    }
  }
  return { generated: totalGenerated };
}

// ── Graph Enrichment Agent: on-demand workspace enrichment ──────────────────────
// Stems (not exact) so "companies"/"contact-leads"/"people" all match.
const ENRICHABLE = ["contact", "person", "people", "lead", "client", "compan", "account", "organization", "org"];

async function tavilySearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: 4, search_depth: "basic" }),
    });
    if (!res.ok) return "";
    const json = await res.json() as { results?: { title: string; content: string }[] };
    return (json.results ?? []).slice(0, 4).map((r) => `${r.title}: ${r.content}`).join("\n");
  } catch { return ""; }
}

async function enrichOne(nodeId: string, objectType: string, recordData: Record<string, unknown>): Promise<number> {
  const normalizedType = objectType.toLowerCase();
  const isPerson = ["contact", "person", "people", "lead"].some((t) => normalizedType.includes(t));
  const name = (recordData.name ?? recordData.Name ?? recordData.company_name ?? recordData.full_name ?? "") as string;
  const email = (recordData.email ?? recordData.Email ?? "") as string;
  const domain = (recordData.domain ?? recordData.website ?? "") as string;

  const query = isPerson
    ? (email ? `${email} linkedin job title company` : `${name} linkedin job title company professional`)
    : `${name} ${domain} company funding employees revenue industry`;
  const webContext = await tavilySearch(query);

  const schema: GatewayToolRequest["toolSchema"] = isPerson
    ? { type: "object", properties: { company: { type: "string" }, job_title: { type: "string" }, linkedin: { type: "string" }, location: { type: "string" }, twitter: { type: "string" }, bio: { type: "string" } } }
    : { type: "object", properties: { description: { type: "string" }, country: { type: "string" }, employee_range: { type: "string" }, arr: { type: "number" }, funding_raised: { type: "number" }, website: { type: "string" }, industry: { type: "string" }, founded_year: { type: "number" } } };

  const raw = await aiGatewayToolUse({
    prompt: isPerson
      ? `Enrich this person. Name: "${name}", Email: "${email}"\n${webContext ? `Web context:\n${webContext}` : ""}`
      : `Enrich this company. Name: "${name}", Domain: "${domain}"\n${webContext ? `Web context:\n${webContext}` : ""}`,
    toolName: isPerson ? "enrich_person" : "enrich_company",
    toolDescription: "Extract enrichment fields",
    toolSchema: schema, maxTokens: 1024,
  }).catch(() => ({} as Record<string, unknown>));

  const fields = Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== ""));
  if (Object.keys(fields).length === 0) return 0;

  const { data: node } = await supabase.from("nodes").select("data").eq("id", nodeId).single();
  const merged = { ...(node?.data ?? {}), ...fields };
  await supabase.from("nodes").update({ data: merged }).eq("id", nodeId);
  await supabase.from("nodes").update({ enriched_at: new Date().toISOString(), enrichment_status: "done" }).eq("id", nodeId);
  return Object.keys(fields).length;
}

/** Enrich up to `limit` records in a workspace. On-demand "re-enrich" entry point. */
export async function runEnrichWorkspace(workspaceId: string, limit = 10): Promise<{ enriched_count: number; records: number }> {
  const jobId = await startJob({
    workspace_id: workspaceId, agent_name: "crm_enricher", trigger_type: "manual", input: { limit },
  });
  try {
    const { data: nodes } = await supabase
      .from("nodes").select("id, object_type, data")
      .eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200);

    const enrichable = (nodes ?? [])
      .filter((n) => ENRICHABLE.some((t) => String(n.object_type).toLowerCase().includes(t)))
      .slice(0, limit);

    let enrichedCount = 0;
    for (const n of enrichable) {
      const added = await enrichOne(n.id, n.object_type, (n.data ?? {}) as Record<string, unknown>);
      if (added > 0) {
        enrichedCount++;
        await supabase.from("notifications").insert({
          workspace_id: workspaceId, type: "agent", title: "✦ Record enriched",
          body: `AI filled in ${added} field(s)`, metadata: { nodeId: n.id, fields_added: added },
        });
      }
    }
    await completeJob(jobId, { enriched_count: enrichedCount, summary: `Enriched ${enrichedCount} record(s)` }, []);
    return { enriched_count: enrichedCount, records: enrichable.length };
  } catch (err: unknown) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Every daily runner, in execution order. Used by the Vercel Cron endpoint. */
export async function runAllDaily(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  // Sequential, mirrors the original cron staggering (relationship → recurring → overdue → deals → chaser)
  results.relationship_health = await runRelationshipHealth().catch((e) => ({ error: String(e) }));
  results.recurring_invoices = await runRecurringInvoices().catch((e) => ({ error: String(e) }));
  results.overdue_task_decisions = await runOverdueTaskDecisions().catch((e) => ({ error: String(e) }));
  results.deal_alerts = await runDealAlerts().catch((e) => ({ error: String(e) }));
  results.invoice_chaser = await runInvoiceChaser().catch((e) => ({ error: String(e) }));
  return results;
}
