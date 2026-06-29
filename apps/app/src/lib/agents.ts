import type { ElementType } from "react";
import {
  MessageCircle, Workflow, Users, Receipt, ShieldAlert, GitBranch, Search,
  TrendingUp, Briefcase, Building2, BarChart2, Bot,
} from "lucide-react";

/**
 * THE canonical agent registry — the single source of truth for every agent's
 * NAME and ICON across the whole app (Home constellation, control panel, command
 * center, anywhere). Names mirror the backend (routes/agents.ts). Do NOT define
 * agent names/icons anywhere else — import from here so an agent looks identical
 * everywhere. Standard and restricted, by request.
 */
export interface AgentIdentity { id: string; name: string; Icon: ElementType }

export const AGENTS: Record<string, AgentIdentity> = {
  "ask-mondaily":     { id: "ask-mondaily",     name: "Graph Agent",            Icon: MessageCircle },
  operations:         { id: "operations",       name: "Operations Agent",       Icon: Workflow },
  relationship:       { id: "relationship",     name: "Relationship Agent",     Icon: Users },
  finance:            { id: "finance",          name: "Finance Agent",          Icon: Receipt },
  signal:             { id: "signal",           name: "Signal Agent",           Icon: ShieldAlert },
  "graph-enrichment": { id: "graph-enrichment", name: "Graph Enrichment Agent", Icon: GitBranch },
  prospecting:        { id: "prospecting",      name: "Prospecting Agent",      Icon: Search },
  workflow:           { id: "workflow",         name: "Workflow Agent",         Icon: Workflow },
  opportunity:        { id: "opportunity",      name: "Opportunity Agent",      Icon: TrendingUp },
  people:             { id: "people",           name: "People Agent",           Icon: Briefcase },
  portfolio:          { id: "portfolio",        name: "Portfolio Agent",        Icon: TrendingUp },
  asset:              { id: "asset",            name: "Asset Agent",            Icon: Building2 },
  insights:           { id: "insights",         name: "Insights Agent",         Icon: BarChart2 },
};

const FALLBACK: AgentIdentity = { id: "agent", name: "Agent", Icon: Bot };

/** Resolve a canonical agent by its id (e.g. "finance"). */
export function agentById(id: string): AgentIdentity {
  return AGENTS[id] ?? { ...FALLBACK, id, name: id.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) };
}

/** Map a raw backend job name (agent_jobs.agent_name) → canonical agent. Several
 *  internal jobs roll up to one real agent (e.g. invoice_chaser → Finance Agent). */
const RAW_TO_ID: Record<string, string> = {
  crm_enricher: "graph-enrichment",
  invoice_chaser: "finance",
  recurring_invoices: "finance",
  credit_note_dispute_handler: "finance",
  relationship_health: "relationship",
  deal_alerts: "signal",
  lead_scoring: "operations",
  operations: "operations",
  overdue_task_decisions: "operations",
  prospecting: "prospecting",
  people: "people",
  asset: "asset",
  portfolio: "portfolio",
  opportunity: "opportunity",
  workflow: "workflow",
};
export function agentByRaw(raw: string): AgentIdentity {
  return agentById(RAW_TO_ID[raw] ?? raw);
}
