import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob, step } from "../lib/agent-logger";
import { createNotification } from "../lib/notify";

/**
 * Vertical agents — Opportunity, People, Portfolio, Asset.
 *
 * Each scans its relevant object types for the workspace, derives REAL
 * findings from the data (never fabricated), writes a summary notification,
 * and queues the highest-value items in the Decision Queue for a human.
 * Honest by construction: if a vertical has no matching records, the agent
 * reports zero rather than inventing activity.
 *
 * All four run both ways: daily via the cron (runAllVertical) and on demand
 * via POST /api/v1/agents/:id/run.
 */

interface NodeRow { id: string; object_type: string; data: Record<string, unknown>; updated_at: string }

async function loadNodes(workspaceId: string): Promise<NodeRow[]> {
  const { data } = await supabase
    .from("nodes").select("id, object_type, data, updated_at")
    .eq("workspace_id", workspaceId).limit(5000);
  return (data ?? []) as NodeRow[];
}

function matches(objectType: string, stems: string[]): boolean {
  const t = objectType.toLowerCase();
  return stems.some((s) => t.includes(s));
}

const DAY = 86_400_000;
function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
}

// `agent` is the canonical agent slug (source_agent) so every finding is attributable in the bell.
async function notify(workspaceId: string, agent: string, title: string, body: string, metadata: Record<string, unknown> = {}) {
  await createNotification({ workspace_id: workspaceId, type: "agent", title, body, metadata, source: { source_agent: agent } });
}

async function queueDecision(workspaceId: string, agent: string, recordId: string, title: string, summary: string, action: string, risk: "low" | "medium" | "high", evidenceTitle: string) {
  // Don't re-queue if a pending decision already exists for this record+agent.
  const { data: existing } = await supabase.from("decision_queue").select("id")
    .eq("workspace_id", workspaceId).eq("source_id", recordId).eq("agent_name", agent).eq("status", "pending").maybeSingle();
  if (existing) return false;
  await supabase.from("decision_queue").insert({
    workspace_id: workspaceId, source_type: "node", source_id: recordId, agent_name: agent,
    title, summary, recommended_action: action, risk_level: risk,
    evidence: [{ type: "record", title: evidenceTitle, node_id: recordId, match_reason: summary }],
  }).then(() => {}, () => {});
  return true;
}

function recName(d: Record<string, unknown>): string {
  return String(d.name ?? d.title ?? d.full_name ?? d.company ?? "Record");
}

// ── Opportunity Agent (sales) — leads/contacts with no active deal = conversion opportunities ──
export async function runOpportunityScan(workspaceId: string) {
  const jobId = await startJob({ workspace_id: workspaceId, agent_name: "opportunity", trigger_type: "manual", input: {} });
  try {
    const nodes = await loadNodes(workspaceId);
    const deals = nodes.filter((n) => matches(n.object_type, ["deal"]));
    const linked = new Set<string>();
    for (const d of deals) {
      for (const k of ["contact_id", "linked_record_id", "company_id", "account_id"]) {
        const v = d.data[k]; if (v) linked.add(String(v));
      }
    }
    const leads = nodes.filter((n) => matches(n.object_type, ["lead", "contact", "people", "person", "compan"]));
    const opportunities = leads.filter((l) => !linked.has(l.id));

    const steps = [
      step(`Loaded ${nodes.length} workspace records`),
      step(`Found ${deals.length} deals with ${linked.size} linked records`),
      step(`${opportunities.length} lead/contact record(s) have no active deal`, { status: opportunities.length ? "warn" : "ok" }),
    ];

    let queued = 0;
    // Queue the top few most-recently-active uncovered leads as real opportunities.
    for (const lead of opportunities.sort((a, b) => daysSince(a.updated_at) - daysSince(b.updated_at)).slice(0, 3)) {
      const ok = await queueDecision(workspaceId, "opportunity", lead.id,
        `Opportunity: ${recName(lead.data)} has no active deal`,
        `This ${lead.object_type} record has no linked deal yet — a potential conversion.`,
        "Create a deal/opportunity for this record, or mark as not a fit", "low", recName(lead.data));
      if (ok) queued++;
    }
    steps.push(step(`Queued ${queued} opportunity decision(s) for review`, { status: queued ? "ok" : "info" }));
    if (opportunities.length > 0) {
      await notify(workspaceId, "opportunity", "✦ Opportunity Agent", `${opportunities.length} record(s) with no active deal — potential conversions.`, { opportunities: opportunities.length });
    }
    await completeJob(jobId, { opportunities: opportunities.length, queued, summary: `${opportunities.length} conversion opportunity(ies), ${queued} queued` }, steps);
    return { opportunities: opportunities.length, queued };
  } catch (err: unknown) { await failJob(jobId, err instanceof Error ? err.message : String(err)); throw err; }
}

// ── People Agent (HR) — people/employee records missing key info ──
export async function runPeopleScan(workspaceId: string) {
  const jobId = await startJob({ workspace_id: workspaceId, agent_name: "people", trigger_type: "manual", input: {} });
  try {
    const nodes = await loadNodes(workspaceId);
    const people = nodes.filter((n) => matches(n.object_type, ["people", "person", "employee", "candidate", "contact"]));
    const incomplete = people.filter((p) => {
      const d = p.data;
      const hasEmail = d.email || d.Email;
      const hasRole = d.role || d.title || d.job_title || d.position;
      return !hasEmail || !hasRole;
    });
    const steps = [
      step(`Loaded ${people.length} people record(s)`),
      step(`${incomplete.length} missing email or role/title`, { status: incomplete.length ? "warn" : "ok" }),
    ];
    let queued = 0;
    for (const p of incomplete.slice(0, 3)) {
      const missing = [!(p.data.email || p.data.Email) ? "email" : null, !(p.data.role || p.data.title || p.data.job_title) ? "role/title" : null].filter(Boolean).join(" and ");
      const ok = await queueDecision(workspaceId, "people", p.id,
        `People: ${recName(p.data)} is missing ${missing}`,
        `This person record is missing ${missing}.`,
        "Complete the missing fields or enrich the record", "low", recName(p.data));
      if (ok) queued++;
    }
    steps.push(step(`Queued ${queued} completion decision(s)`, { status: queued ? "ok" : "info" }));
    if (incomplete.length > 0) {
      await notify(workspaceId, "people", "✦ People Agent", `${incomplete.length} of ${people.length} people record(s) missing email or role.`, { incomplete: incomplete.length, total: people.length });
    }
    await completeJob(jobId, { people: people.length, incomplete: incomplete.length, queued, summary: `${incomplete.length}/${people.length} people need completion` }, steps);
    return { people: people.length, incomplete: incomplete.length, queued };
  } catch (err: unknown) { await failJob(jobId, err instanceof Error ? err.message : String(err)); throw err; }
}

// ── Portfolio Agent (investments) — holdings missing valuation or gone stale ──
export async function runPortfolioScan(workspaceId: string) {
  const jobId = await startJob({ workspace_id: workspaceId, agent_name: "portfolio", trigger_type: "manual", input: {} });
  try {
    const nodes = await loadNodes(workspaceId);
    const holdings = nodes.filter((n) => matches(n.object_type, ["invest", "portfolio", "fund", "holding", "asset-under"]));
    const needsReview = holdings.filter((h) => {
      const d = h.data;
      const hasValue = d.value ?? d.valuation ?? d.amount ?? d.current_value;
      return !hasValue || daysSince(h.updated_at) > 90;
    });
    const steps = [
      step(`Loaded ${holdings.length} holding(s)`),
      step(`${needsReview.length} missing a valuation or stale (90+ days)`, { status: needsReview.length ? "warn" : "ok" }),
    ];
    let queued = 0;
    for (const h of needsReview.slice(0, 3)) {
      const stale = daysSince(h.updated_at) > 90;
      const ok = await queueDecision(workspaceId, "portfolio", h.id,
        `Portfolio: ${recName(h.data)} ${stale ? "not updated in 90+ days" : "is missing a valuation"}`,
        stale ? `No update in ${daysSince(h.updated_at)} days.` : "No valuation/value recorded.",
        "Update the valuation or latest figures", "low", recName(h.data));
      if (ok) queued++;
    }
    steps.push(step(`Queued ${queued} valuation decision(s)`, { status: queued ? "ok" : "info" }));
    if (holdings.length > 0) {
      await notify(workspaceId, "portfolio", "✦ Portfolio Agent", `${needsReview.length} of ${holdings.length} holding(s) need a valuation update.`, { needs_review: needsReview.length, total: holdings.length });
    }
    await completeJob(jobId, { holdings: holdings.length, needs_review: needsReview.length, queued, summary: `${needsReview.length}/${holdings.length} holdings need review` }, steps);
    return { holdings: holdings.length, needs_review: needsReview.length, queued };
  } catch (err: unknown) { await failJob(jobId, err instanceof Error ? err.message : String(err)); throw err; }
}

// ── Asset Agent (real estate / equipment) — assets needing attention ──
export async function runAssetScan(workspaceId: string) {
  const jobId = await startJob({ workspace_id: workspaceId, agent_name: "asset", trigger_type: "manual", input: {} });
  try {
    const nodes = await loadNodes(workspaceId);
    const assets = nodes.filter((n) => matches(n.object_type, ["asset", "property", "equipment", "real-estate", "realestate", "supplier", "facility", "vehicle"]));
    const flagged = assets.filter((a) => {
      const d = a.data;
      const renewal = d.lease_end ?? d.renewal_date ?? d.next_service ?? d.warranty_end;
      const renewalSoon = renewal && daysSince(String(renewal)) > -30 && daysSince(String(renewal)) < Infinity && new Date(String(renewal)).getTime() - Date.now() < 30 * DAY;
      return renewalSoon || daysSince(a.updated_at) > 180;
    });
    const steps = [
      step(`Loaded ${assets.length} asset record(s)`),
      step(`${flagged.length} flagged (upcoming renewal/service or 180+ days stale)`, { status: flagged.length ? "warn" : "ok" }),
    ];
    let queued = 0;
    for (const a of flagged.slice(0, 3)) {
      const ok = await queueDecision(workspaceId, "asset", a.id,
        `Asset: ${recName(a.data)} needs attention`,
        `This asset has an upcoming renewal/service date or hasn't been reviewed in 180+ days.`,
        "Review the asset's renewal, service, or valuation", "low", recName(a.data));
      if (ok) queued++;
    }
    steps.push(step(`Queued ${queued} attention decision(s)`, { status: queued ? "ok" : "info" }));
    if (assets.length > 0) {
      await notify(workspaceId, "asset", "✦ Asset Agent", `${flagged.length} of ${assets.length} asset(s) need attention.`, { flagged: flagged.length, total: assets.length });
    }
    await completeJob(jobId, { assets: assets.length, flagged, queued, summary: assets.length === 0 ? "No asset records in this workspace" : `${flagged.length}/${assets.length} assets flagged` }, steps);
    return { assets: assets.length, flagged: flagged.length, queued };
  } catch (err: unknown) { await failJob(jobId, err instanceof Error ? err.message : String(err)); throw err; }
}

/** All four, across all workspaces — used by the daily cron. */
export async function runAllVertical(): Promise<Record<string, unknown>> {
  const { data: workspaces } = await supabase.from("workspaces").select("id");
  const totals = { opportunity: 0, people: 0, portfolio: 0, asset: 0 };
  for (const ws of workspaces ?? []) {
    const id = ws.id as string;
    const o = await runOpportunityScan(id).catch(() => null); if (o) totals.opportunity += o.queued;
    const p = await runPeopleScan(id).catch(() => null); if (p) totals.people += p.queued;
    const pf = await runPortfolioScan(id).catch(() => null); if (pf) totals.portfolio += pf.queued;
    const a = await runAssetScan(id).catch(() => null); if (a) totals.asset += a.queued;
  }
  return totals;
}
