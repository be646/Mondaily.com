import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleSlash, HelpCircle, Network } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { apiClient } from "../../lib/api-client";
import { assertAgentCoverage } from "@mondaily/shared/agents";
import { PageSkeleton } from "../../components/ui/page-state";
import { CommandPageHeader } from "../../components/ui/controls";

/**
 * Workspace Status — the honest "what's real today" page. Live System
 * Status and Migrations come from a real backend probe (GET
 * /api/v1/status). Recent Updates and What's Next are now LIVE and
 * DB-backed (GET /api/v1/status/log, table project_log from migration
 * 0017) — a persistent record of what shipped and what's left, updated as
 * work lands. The Feature Reality Matrix and Agent Capability Board remain
 * code-backed snapshots audited as part of their change.
 */

type CheckState = "operational" | "needs_setup" | "disabled" | "error" | "not_checked";

interface Check { id: string; label: string; state: CheckState; explanation: string; action?: string; }
interface Migration { id: string; label: string; applied: boolean; required: boolean; breaks_if_missing: string; }
interface StatusResponse { checked_at: string; checks: Check[]; migrations: Migration[]; }

const STATE_META: Record<CheckState, { label: string; color: string; icon: React.ElementType }> = {
  operational:  { label: "Operational",   color: "var(--status-ok)", icon: CheckCircle2 },
  needs_setup:  { label: "Needs setup",   color: "var(--status-warn)", icon: AlertTriangle },
  disabled:     { label: "Disabled",      color: "var(--text-faint)", icon: CircleSlash },
  error:        { label: "Error",         color: "var(--status-error)", icon: AlertTriangle },
  not_checked:  { label: "Not checked yet", color: "var(--text-faint)", icon: HelpCircle },
};

function StatusDot({ color }: { color: string }) {
  return <span className="inline-flex h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

// ── Sovereignty grouping — maps each backend check id to a named readiness area, in the order
// item-2 specifies. Any check id NOT listed here still renders (it falls into "Other checks"),
// so the page can never silently hide a check the API returns. ──────────────────────────────
const CHECK_GROUPS: { title: string; ids: string[] }[] = [
  { title: "AI Gateway", ids: ["ask"] },
  { title: "Sovereign Search", ids: ["sovereign_search", "sovereign_search_key"] },
  { title: "Scraper", ids: ["sovereign_scraper"] },
  { title: "Native Auth", ids: ["auth"] },
  { title: "Database", ids: ["database"] },
  { title: "Background Jobs", ids: ["api", "agent_jobs", "inngest", "cron_secret"] },
  { title: "Internal Messaging", ids: ["messaging"] },
  { title: "Calls / LiveKit", ids: ["calls"] },
  { title: "Training Controls", ids: ["training"] },
  { title: "Optional Connectors", ids: ["email", "microsoft"] },
  { title: "Billing", ids: ["stripe"] },
];

// ── Feature Reality Matrix — code-backed, not live-queried. Status values
// reflect what actually exists in this codebase today (routes, jobs,
// frontend wiring), audited as part of this change. ──────────────────────
type FeatureStatus = "live" | "partial" | "needs_configuration" | "planned" | "not_built";
const FEATURE_STATUS_META: Record<FeatureStatus, { label: string; color: string }> = {
  live:                 { label: "Live",                 color: "var(--status-ok)" },
  partial:               { label: "Partial",              color: "var(--status-neutral)" },
  needs_configuration:    { label: "Needs configuration",  color: "var(--status-warn)" },
  planned:                { label: "Planned",              color: "var(--section-accent)" },
  not_built:              { label: "Not built",            color: "var(--text-faint)" },
};

interface FeatureRow { feature: string; status: FeatureStatus; inApp: boolean; backendReady: boolean; needsSetup: boolean; notes: string; }
const FEATURES: FeatureRow[] = [
  { feature: "Ask Mondaily memory/context", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Thread history + context store, real source-backed answers." },
  { feature: "Source cards", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Every Ask/Decision Queue answer shows the real records or evidence behind it." },
  { feature: "Action chips", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Create task / draft message / explain reasoning — real tool calls, not canned text." },
  { feature: "Lists", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Create, share, bulk-add, AI-match, and Find from web." },
  { feature: "Sheets/table bulk actions", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Bulk edit, assign, add to list, delete, Find similar from web." },
  { feature: "Enrichment of existing records", status: "live", inApp: true, backendReady: true, needsSetup: true, notes: "Real Inngest job + sovereign AI gateway extraction over the sovereign SearXNG appliance — needs AI_GATEWAY_API_KEY and SOVEREIGN_SEARCH_URL." },
  { feature: "Discovery (UI) / Prospecting Agent (worker)", status: "live", inApp: true, backendReady: true, needsSetup: true, notes: "Discovery is the search workbench; the Prospecting Agent sweeps the open web + social via the sovereign SearXNG appliance, extracts source-backed candidates per page, dedupes, and queues approvals. Live streaming, AI overview, deep contact-harvest, and saved-search monitors. Needs AI_GATEWAY_API_KEY + SOVEREIGN_SEARCH_URL." },
  { feature: "Decision Queue", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Real approve/reject/snooze, real downstream actions for invoice-chase and prospecting." },
  { feature: "Tasks", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Full CRUD, reviews, assignment, AI-sorted home widget." },
  { feature: "Finance invoices", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Invoice CRUD + chasing via Decision Queue approval." },
  { feature: "Reports", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "Saved reports run real computed data; Ask can build them via the create_report tool." },
  { feature: "Automations", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "AI-built trigger→condition→action workflows execute in real time on record create/update (Inngest event triggers, idempotent), with the daily cron as a backstop sweep." },
  { feature: "Email (Gmail + Outlook, direct)", status: "needs_configuration", inApp: true, backendReady: true, needsSetup: true, notes: "Direct Google (Gmail API) + Microsoft (Graph), no middleman: connect, inbox read, reply, and compose/send are live. Needs GOOGLE_CLIENT_ID/SECRET and/or MICROSOFT_CLIENT_ID/SECRET." },
  { feature: "Calendar sync (Gmail + Outlook)", status: "needs_configuration", inApp: true, backendReady: true, needsSetup: true, notes: "Direct Google Calendar + Microsoft Graph OAuth (read-only) — one 'Connect' grants mail + calendar; real events render on Home. Uses the same GOOGLE_/MICROSOFT_CLIENT_ID/SECRET." },
  { feature: "Calls", status: "partial", inApp: true, backendReady: true, needsSetup: true, notes: "Call log + AI transcript summary exist; needs AI_GATEWAY_API_KEY for summaries." },
  { feature: "Voice dictation", status: "partial", inApp: true, backendReady: false, needsSetup: false, notes: "Browser speech-to-text dictation (Web Speech API) fills the Ask input on Home — no backend involved. Full voice COMMANDS (act on speech) not built." },
  { feature: "MCP / API", status: "live", inApp: false, backendReady: true, needsSetup: false, notes: "REST API at /docs + an MCP server at /api/mcp (search_records, get_record, list_recent) for external AI clients, authed by a per-workspace key from Settings → Integrations." },
  { feature: "Workspace isolation & security", status: "live", inApp: true, backendReady: true, needsSetup: false, notes: "App-layer workspace_id scoping + Postgres RLS (verified via anon key) + a cross-tenant isolation test; IDOR paths closed, RBAC-gated settings/lists, prompt-injection hardened." },
  { feature: "AI training ledger", status: "live", inApp: false, backendReady: true, needsSetup: false, notes: "Decision-Queue verdicts → ai_training_logs with real generation prompts (prospecting/chat); PII-redacted + injection-filtered JSONL exporter." },
  { feature: "Billing (embedded Stripe)", status: "needs_configuration", inApp: true, backendReady: true, needsSetup: true, notes: "Embedded Payment Element on our own page (no redirect) + subscriptions + webhook tier activation, all built. Needs STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_OPERATOR/COMMAND_MONTH, STRIPE_WEBHOOK_SECRET." },
];

// ── Project log — live, DB-backed. Recent updates (kind='update') and
// What's next (kind='roadmap') are read from GET /api/v1/status/log so the
// record of what shipped and what's left is always current, never hardcoded. ──
interface ProjectLogEntry {
  id: string; kind: "update" | "roadmap"; title: string; detail: string | null;
  category: string | null; status: string; sort_order: number;
  created_at: string; completed_at: string | null;
}
interface ProjectLogResponse { available: boolean; reason?: string; updates: ProjectLogEntry[]; roadmap: ProjectLogEntry[]; }

const ROADMAP_TIERS: { key: string; label: string; tone: string }[] = [
  { key: "must_fix", label: "Must fix before clients", tone: "var(--status-error)" },
  { key: "should_improve", label: "Should improve", tone: "var(--status-warn)" },
  { key: "future", label: "Future AI-native upgrades", tone: "var(--section-accent)" },
];

function useProjectLog() {
  return useQuery({
    queryKey: ["status-log"],
    queryFn: () => apiClient.get<ProjectLogResponse>("/status/log"),
    refetchInterval: 60_000,
    retry: false,
  });
}

// ── Agent Capability Board — code-backed against packages/api/src/jobs
// and packages/api/src/routes/agents.ts as of this change. ──────────────
interface AgentCapability {
  name: string; canRead: string; canWrite: string; autonomous: boolean; requiresApproval: boolean; sourcesEvidence: boolean; limitations: string;
}
const AGENT_CAPABILITIES: AgentCapability[] = [
  { name: "Graph Agent", canRead: "Any record, task, finance, or report in the workspace graph", canWrite: "Tasks, notes, lists, decision queue items, workflow drafts (disabled)", autonomous: false, requiresApproval: true, sourcesEvidence: true, limitations: "Conversational only — runs in response to a question, no scheduled job." },
  { name: "Operations Agent", canRead: "Tasks, overdue/review status", canWrite: "Decision Queue rows for overdue tasks", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Recommends only — reassigning/rescheduling still requires a human action today." },
  { name: "Relationship Agent", canRead: "All workspace nodes' activity timestamps", canWrite: "relationship_health field on any node", autonomous: true, requiresApproval: false, sourcesEvidence: true, limitations: "Writes a score directly (no sensitive action) — daily cron, not real-time." },
  { name: "Finance Agent", canRead: "Invoices, credit notes", canWrite: "Drafted reminders/adjustments, Decision Queue rows", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Never sends or applies anything without explicit approval." },
  { name: "Graph Enrichment Agent", canRead: "New records + the live web (sovereign SearXNG appliance)", canWrite: "ARR/headcount/tech-stack fields on the record", autonomous: true, requiresApproval: false, sourcesEvidence: true, limitations: "Fires once on record creation only — no re-enrichment job yet." },
  { name: "Workflow Agent", canRead: "Workflow definitions + the record that fired the trigger", canWrite: "Executes trigger→condition→action workflows — queues/sends real actions, logs every run", autonomous: true, requiresApproval: false, sourcesEvidence: true, limitations: "One trigger per workflow (multi-trigger not yet supported); fires on record create/update + a daily cron sweep." },
  { name: "Prospecting Agent", canRead: "The live web + social (sovereign SearXNG appliance) + existing workspace nodes for dedupe", canWrite: "New nodes or Decision Queue rows", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Every candidate requires a real source URL — drops anything it can't trace back to a scanned page." },
  { name: "Signal Agent", canRead: "Records + activity timestamps, deal stage/amount", canWrite: "lead_score field + Decision Queue alerts for at-risk/high-intent deals", autonomous: true, requiresApproval: false, sourcesEvidence: true, limitations: "Lead-scoring + deal alerts; daily cron, not real-time; alert thresholds are heuristic." },
  { name: "Opportunity Agent", canRead: "Deals / opportunities and their stage + age", canWrite: "Decision Queue rows for stale or at-risk opportunities", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Recommends only — never advances a stage without approval." },
  { name: "People Agent", canRead: "People / contact records", canWrite: "Decision Queue rows for follow-ups", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Recommends only; daily cron." },
  { name: "Portfolio Agent", canRead: "Portfolio / investment records", canWrite: "Decision Queue rows for portfolio attention", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Recommends only; daily cron." },
  { name: "Asset Agent", canRead: "Real-estate / asset records", canWrite: "Decision Queue rows for asset attention", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Recommends only; daily cron." },
  { name: "Insights Agent", canRead: "Cross-workspace activity — tasks, deals, records, decisions", canWrite: "The Daily Brief (summary + priorities)", autonomous: true, requiresApproval: false, sourcesEvidence: true, limitations: "Read-only synthesis — writes no records; runs on the daily brief schedule." },
  { name: "Meeting Agent", canRead: "Calendar events, meeting rosters, conflicts", canWrite: "Meeting briefs + Decision Queue rows for conflicts", autonomous: true, requiresApproval: true, sourcesEvidence: true, limitations: "Recommends only — never reschedules a meeting without approval; daily cron + on-demand." },
  { name: "Goal Planner", canRead: "The goal you describe + related workspace records", canWrite: "A proposed multi-step plan (Decision Queue)", autonomous: false, requiresApproval: true, sourcesEvidence: true, limitations: "On-demand only — runs when you ask it to plan a goal, never on a schedule." },
];
// Fails loudly in dev if this board drifts from the canonical roster (shared with Home + Landing).
assertAgentCoverage("status/capability-board", AGENT_CAPABILITIES.map((a) => a.name));

function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => apiClient.get<StatusResponse>("/status"),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function StatusPage() {
  const { data, isLoading, isError, error } = useStatus();
  const { data: log } = useProjectLog();
  const updates = log?.updates ?? [];
  const logUnavailable = log && !log.available;

  return (
    <div className="mx-auto max-w-5xl px-6 pt-2 pb-10">
      <CommandPageHeader
        variant="bar" icon={CheckCircle2} callsign="READINESS" title="Workspace Readiness" subtitle="What's real today, what changed recently, and what's next — every row audited against the live code." />

      {/* ── 1. Live System Status ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Live system status</h2>
          {data?.checked_at && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Last checked {new Date(data.checked_at).toLocaleTimeString()} · refreshes every 60s</span>}
        </div>
        {isLoading ? (
          <div className="skeleton-shimmer h-48 rounded-sm"/>
        ) : isError ? (
          <div className="surface-card rounded-sm p-4 text-[12.5px]" style={{ color: "var(--text-faint)" }}>
            Couldn't reach the status endpoint: {(error as Error)?.message ?? "unknown error"}. The API itself may be down — that's a real signal, not hidden.
          </div>
        ) : (() => {
          const renderCheck = (check: Check) => {
            const meta = STATE_META[check.state];
            return (
              <div key={check.id} className="stream-row" style={{ borderLeft: `2px solid ${meta.color}` }}>
                <meta.icon size={14} className="mt-0.5 shrink-0" style={{ color: meta.color }}/>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{check.label}</p>
                    <span className="shrink-0 text-[10.5px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>{check.explanation}</p>
                  {/* Only shows a "Do this" when the API itself flags the row non-operational — never invented. */}
                  {check.state !== "operational" && check.action && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="mt-px shrink-0 font-semibold" style={{ color: meta.color }}>Do this:</span>
                      <span>{check.action}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          };
          const byId = new Map(data!.checks.map(c => [c.id, c]));
          const grouped = CHECK_GROUPS
            .map(g => ({ title: g.title, checks: g.ids.map(id => byId.get(id)).filter((c): c is Check => Boolean(c)) }))
            .filter(g => g.checks.length > 0);
          // Any check the API returns that isn't mapped to a group above — surface it, never hide it.
          const claimed = new Set(CHECK_GROUPS.flatMap(g => g.ids));
          const other = data!.checks.filter(c => !claimed.has(c.id));
          const sections = other.length ? [...grouped, { title: "Other checks", checks: other }] : grouped;
          return (
            <div className="space-y-4">
              {sections.map(section => (
                <div key={section.title}>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{section.title}</p>
                  <div className="surface-card rounded-sm">
                    {section.checks.map(renderCheck)}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* ── 2. Feature Reality Matrix ── */}
      <section className="mb-10">
        <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Feature reality matrix</h2>
        <div className="surface-card overflow-x-auto rounded-sm">
          <table className="minimal-table text-left text-[12px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-soft)" }}>
                {["Feature", "Status", "In app", "Backend ready", "Needs setup", "Notes"].map(h => (
                  <th key={h} className="whitespace-nowrap px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map(f => {
                const meta = FEATURE_STATUS_META[f.status];
                return (
                  <tr key={f.feature} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                    <td className="whitespace-nowrap px-3.5 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>{f.feature}</td>
                    <td className="whitespace-nowrap px-3.5 py-2.5">
                      <span className="inline-flex items-center gap-1.5"><StatusDot color={meta.color}/><span style={{ color: meta.color }}>{meta.label}</span></span>
                    </td>
                    <td className="px-3.5 py-2.5">{f.inApp ? "Yes" : "—"}</td>
                    <td className="px-3.5 py-2.5">{f.backendReady ? "Yes" : "—"}</td>
                    <td className="px-3.5 py-2.5">{f.needsSetup ? "Yes" : "—"}</td>
                    <td className="min-w-[260px] px-3.5 py-2.5" style={{ color: "var(--text-secondary)" }}>{f.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 3. Recent Updates (live, DB-backed) ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Recent updates</h2>
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Live log · refreshes every 60s</span>
        </div>
        {logUnavailable ? (
          <div className="surface-card rounded-sm p-4 text-[12px]" style={{ color: "var(--text-faint)" }}>
            Project log table not found — run migration <code>0017_project_log.sql</code> in Supabase to enable the live log.
          </div>
        ) : updates.length === 0 ? (
          <div className="skeleton-shimmer h-28 rounded-sm"/>
        ) : (
          <div className="surface-card rounded-sm">
            {updates.map((u) => (
              <div key={u.id} className="stream-row">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--surface-selected)" }}>
                  <LogoMark size={11} style={{ color: "var(--section-accent)" }}/>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{u.title}</p>
                    <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{new Date(u.completed_at ?? u.created_at).toLocaleDateString()}</span>
                    <span className="rounded-full px-1.5 py-px text-[9.5px] font-medium" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{u.status.replace("_", " ")}</span>
                  </div>
                  {u.detail && <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>{u.detail}</p>}
                  {u.category && <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-faint)" }}>{u.category}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 4. Migrations & Setup Required ── */}
      <section className="mb-10">
        <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Migrations & setup required</h2>
        {isLoading ? (
          <div className="skeleton-shimmer h-28 rounded-sm"/>
        ) : isError ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>Could not check migration status — see Live system status above.</p>
        ) : (
          <div className="surface-card rounded-sm">
            {data!.migrations.map(m => (
              <div key={m.id} className="stream-row" style={{ borderLeft: `2px solid ${m.applied ? "var(--status-ok)" : "var(--status-error)"}` }}>
                {m.applied ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: "var(--status-ok)" }}/> : <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--status-error)" }}/>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{m.label}</p>
                    <span className="shrink-0 text-[10.5px] font-medium" style={{ color: m.applied ? "var(--status-ok)" : "var(--status-error)" }}>{m.applied ? "Applied" : "Not applied"}</span>
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>{m.required ? "Required. " : "Optional. "}If missing: {m.breaks_if_missing}</p>
                  {!m.applied && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="mt-px shrink-0 font-semibold" style={{ color: "var(--status-error)" }}>Do this:</span>
                      <span>Open Supabase → SQL editor and run migration <code>{m.id}</code> from <code>packages/db/migrations</code>.</span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 5. Agent Capability Board ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Network size={13} style={{ color: "var(--text-muted)" }}/>
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Agent capability board</h2>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {AGENT_CAPABILITIES.map(a => (
            <div key={a.name} className="surface-card rounded-sm p-4">
              <p className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{a.name}</p>
              <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex gap-2"><dt className="shrink-0 font-medium" style={{ color: "var(--text-faint)" }}>Reads:</dt><dd style={{ color: "var(--text-secondary)" }}>{a.canRead}</dd></div>
                <div className="flex gap-2"><dt className="shrink-0 font-medium" style={{ color: "var(--text-faint)" }}>Writes:</dt><dd style={{ color: "var(--text-secondary)" }}>{a.canWrite}</dd></div>
              </dl>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: a.autonomous ? "rgba(16,185,129,0.1)" : "var(--surface-hover)", color: a.autonomous ? "var(--status-ok)" : "var(--text-faint)" }}>{a.autonomous ? "Runs autonomously" : "Manual trigger only"}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: a.requiresApproval ? "rgba(217,119,6,0.1)" : "var(--surface-hover)", color: a.requiresApproval ? "var(--status-warn)" : "var(--text-faint)" }}>{a.requiresApproval ? "Requires approval" : "No approval needed"}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: a.sourcesEvidence ? "rgba(59,130,246,0.1)" : "var(--surface-hover)", color: a.sourcesEvidence ? "var(--status-neutral)" : "var(--text-faint)" }}>{a.sourcesEvidence ? "Source-backed" : "No evidence trail"}</span>
              </div>
              <p className="mt-2 text-[10.5px]" style={{ color: "var(--text-faint)" }}>Limitation: {a.limitations}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 6. What's next (live, DB-backed) ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>What's next</h2>
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Live roadmap · {(log?.roadmap ?? []).filter(r => r.status === "done").length} done · {(log?.roadmap ?? []).filter(r => r.status !== "done").length} open</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {ROADMAP_TIERS.map(tier => {
            const items = (log?.roadmap ?? []).filter(r => r.category === tier.key);
            return (
              <div key={tier.key} className="surface-card rounded-sm p-4">
                <div className="mb-2 flex items-center gap-2">
                  <StatusDot color={tier.tone}/>
                  <p className="text-[11.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{tier.label}</p>
                </div>
                <ul className="space-y-2">
                  {items.length === 0 && <li className="text-[11px]" style={{ color: "var(--text-faint)" }}>Nothing here.</li>}
                  {items.map(item => {
                    const done = item.status === "done";
                    return (
                      <li key={item.id} className="flex items-start gap-1.5 text-[11.5px]">
                        {done
                          ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" style={{ color: "var(--status-ok)" }}/>
                          : item.status === "in_progress"
                            ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--status-warn)" }}/>
                            : <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--text-faint)" }}/>}
                        <div className="min-w-0">
                          <span style={{ color: done ? "var(--text-faint)" : "var(--text-primary)", textDecoration: done ? "line-through" : "none" }}>{item.title}</span>
                          {item.detail && <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>{item.detail}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
