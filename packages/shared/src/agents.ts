/**
 * THE canonical agent roster — the single, framework-agnostic source of truth for every agent's
 * id + display NAME, shared across the app (Home/Status) and the marketing site (Landing). Any
 * surface that lists agents should be checked against this so the three never drift again.
 *
 * Icons live in the app's lib/agents.ts (React-only, keyed by these same ids) — this file stays
 * dependency-free so both apps/app and apps/web can import it.
 */
export interface AgentRosterEntry {
  id: string;
  name: string;
  /** How the agent runs, for honest capability copy. */
  cadence: "scheduled" | "on-record" | "on-demand" | "conversational";
}

export const AGENT_ROSTER: readonly AgentRosterEntry[] = [
  { id: "ask-mondaily",     name: "Graph Agent",            cadence: "conversational" },
  { id: "operations",       name: "Operations Agent",       cadence: "scheduled" },
  { id: "relationship",     name: "Relationship Agent",     cadence: "scheduled" },
  { id: "finance",          name: "Finance Agent",          cadence: "scheduled" },
  { id: "signal",           name: "Signal Agent",           cadence: "scheduled" },
  { id: "graph-enrichment", name: "Graph Enrichment Agent", cadence: "on-record" },
  { id: "prospecting",      name: "Prospecting Agent",      cadence: "scheduled" },
  { id: "workflow",         name: "Workflow Agent",         cadence: "on-record" },
  { id: "opportunity",      name: "Opportunity Agent",      cadence: "scheduled" },
  { id: "people",           name: "People Agent",           cadence: "scheduled" },
  { id: "portfolio",        name: "Portfolio Agent",        cadence: "scheduled" },
  { id: "asset",            name: "Asset Agent",            cadence: "scheduled" },
  { id: "insights",         name: "Insights Agent",         cadence: "scheduled" },
  { id: "meeting",          name: "Meeting Agent",          cadence: "scheduled" },
  { id: "planner",          name: "Goal Planner",           cadence: "on-demand" },
] as const;

/** Total number of agents Mondaily ships. Home, Status, and Landing must all agree with this. */
export const AGENT_COUNT = AGENT_ROSTER.length;

export const AGENT_NAMES: readonly string[] = AGENT_ROSTER.map((a) => a.name);

/**
 * Drift guard: logs a loud console error if a surface's agent-name list doesn't cover exactly the
 * canonical roster. Call at module load in any surface that hardcodes agents (Status, Landing, the
 * app registry) so a missing or renamed agent surfaces immediately in the dev console instead of
 * silently drifting. Returns the list of problems (empty when in sync) so tests can assert on it.
 * Deliberately never throws — a marketing typo must not crash the app or the landing build.
 */
export function assertAgentCoverage(surface: string, names: readonly string[]): string[] {
  const have = new Set(names);
  const canonical = new Set(AGENT_NAMES);
  const missing = AGENT_NAMES.filter((n) => !have.has(n));
  const extra = [...have].filter((n) => !canonical.has(n));
  const problems: string[] = [];
  if (missing.length) problems.push(`missing: ${missing.join(", ")}`);
  if (extra.length) problems.push(`unknown: ${extra.join(", ")}`);
  if (problems.length) {
    console.error(`[agent-roster] "${surface}" drifted from the canonical roster — ${problems.join(" · ")}. Update it or packages/shared/src/agents.ts.`);
  }
  return problems;
}

/**
 * Canonicalize a free-text agent name from stored rows (decision_queue.agent_name and friends hold
 * whatever spelling the writer used: "signal", "signal_agent", "Signal Agent"). Grouping on the raw
 * string split one agent into several scorecard rows — the Agents page showed "Signal Agent" twice.
 * Matching is by STEM (case/punctuation/the word "agent" ignored) against the roster; an unknown
 * name passes through unchanged so a future agent is never silently renamed.
 */
export function canonicalAgentName(raw: string): string {
  const stem = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").replace(/\bagents?\b/g, "").replace(/\s+/g, " ").trim();
  const key = stem(raw);
  if (!key) return raw;
  for (const a of AGENT_ROSTER) {
    if (stem(a.name) === key || stem(a.id) === key) return a.name;
  }
  return raw;
}
