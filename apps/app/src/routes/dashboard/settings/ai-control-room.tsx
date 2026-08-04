import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, CircleSlash, ShieldCheck, Loader2, ArrowUpRight, Lock, MessageSquare, Network, Radar, Receipt, Workflow, Users2, Activity, BarChart2, GitBranch } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { CommandPageHeader } from "../../../components/ui/controls";
import { useAgentData, CONSTELLATION_STATE_LABEL, type ConstellationState } from "../../../components/ai/agent-dock";

/**
 * Admin AI Control Room / AI Governance — an owner-facing view of Mondaily's AI operating layer.
 * REAL data only, from existing endpoints (GET /status, GET /agents via useAgentData, GET
 * /agents/activity). No new API, no schema. Where a control isn't yet persisted (approval policy),
 * it's shown READ-ONLY and clearly labelled "policy preview" with the missing endpoint reported —
 * never a fake toggle that pretends to save.
 */

type CheckState = "operational" | "needs_setup" | "disabled" | "error" | "not_checked";
interface Check { id: string; label: string; state: CheckState; explanation: string; action?: string }
interface StatusResp { checked_at: string; workspace_id: string; checks: Check[] }
interface ActivityItem { id: string; agent: string; status: string; summary: string; error: string | null; started_at: string; completed_at: string | null }
interface UsageSummary {
  month?: { ai_calls?: number; by_model?: Record<string, number> };
  observability?: {
    by_class?: Record<string, number>;
    avg_latency_ms?: number | null;
    cache_hit_rate?: number | null;
    cache_samples?: number;
    refusals?: number;
    providers?: string[];
  };
}

const STATE_TONE: Record<CheckState, string> = {
  operational: "var(--status-ok)", needs_setup: "var(--status-warn)", disabled: "var(--text-faint)", error: "var(--status-error)", not_checked: "var(--text-faint)",
};
const stateTone = (s: ConstellationState) =>
  s === "active" ? "var(--status-ok)" : s === "needs_approval" ? "var(--status-warn)" : s === "issue" ? "var(--status-error)" : s === "monitoring" ? "var(--text-muted)" : "var(--text-faint)";

const relAgo = (iso?: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function AIControlRoomSettings() {
  // Owner/admin gate — from real membership role (existing /workspaces/mine).
  const wsId = typeof localStorage !== "undefined" ? localStorage.getItem("mondaily_workspace_id") : null;
  const roleQ = useQuery({
    queryKey: ["my-workspaces"],
    queryFn: async () => (await apiClient.get<{ workspaces?: { workspace_id: string; role: string }[] }>("/workspaces/mine")).workspaces ?? [],
    staleTime: 300_000,
  });
  const myRole = useMemo(() => roleQ.data?.find((w) => w.workspace_id === wsId)?.role ?? null, [roleQ.data, wsId]);
  const isOwnerAdmin = myRole === "owner" || myRole === "admin";

  const statusQ = useQuery({ queryKey: ["status"], queryFn: () => apiClient.get<StatusResp>("/status"), refetchInterval: 60_000, retry: false });
  const { constellation, isLoading: agentsLoading } = useAgentData();
  const activityQ = useQuery({
    queryKey: ["agent-activity"],
    queryFn: () => apiClient.get<{ activity: ActivityItem[]; stats: { runs_today: number; errors_today: number } }>("/agents/activity?limit=40"),
    refetchInterval: 30_000,
  });
  // Phase-1 AI-run observability (real ai_usage rollup; fields are null until populated).
  const obsQ = useQuery<UsageSummary>({ queryKey: ["usage-summary"], queryFn: () => apiClient.get<UsageSummary>("/usage/summary"), retry: false });

  const checks = statusQ.data?.checks ?? [];
  const byId = (id: string) => checks.find((c) => c.id === id);
  const activity = activityQ.data?.activity ?? [];
  const errorsToday = activityQ.data?.stats?.errors_today ?? 0;
  const lastRun = constellation.map((a) => a.lastRunAt).filter(Boolean).sort().slice(-1)[0] ?? null;

  // Access gate — honest: only real owners/admins see the controls.
  if (roleQ.isLoading) return <div className="flex items-center gap-2 p-8 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin" /> Checking access…</div>;
  if (!isOwnerAdmin) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <Lock size={22} className="mx-auto mb-3" style={{ color: "var(--text-faint)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Owner access required</p>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
          The AI Control Room is limited to workspace owners and admins.{myRole ? ` Your role here is "${myRole}".` : ""}
        </p>
      </div>
    );
  }


/**
 * Production errors, where someone will actually see them.
 *
 * The sink collected reports and readiness showed a COUNT — which says something is wrong without
 * saying what. An operator should not need SQL to read their own failures, and for a public launch
 * "check the database" is not an answer.
 *
 * Loudest first: one fault firing 400 times matters more than four firing once.
 */
function ProductionErrors() {
  const qc = useQueryClient();
  const q = useQuery<{ errors: ClientError[]; available: boolean; reason?: string }>({
    queryKey: ["client-errors"],
    queryFn: () => apiClient.get("/telemetry/errors?limit=25"),
    retry: false, staleTime: 30_000,
  });
  const resolve = useMutation({
    mutationFn: (fp: string) => apiClient.post(`/telemetry/errors/${fp}/resolve`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["client-errors"] }); },
  });

  // "Not installed" is NOT "no errors" — conflating them is how a dead rate limiter went unnoticed.
  if (q.data && q.data.available === false) {
    return (
      <Section title="Production errors" hint="Not yet collecting.">
        <p className="text-body" style={{ color: "var(--text-muted)" }}>
          The error table is not installed, so nothing is being recorded. This is not the same as
          having no errors.
        </p>
      </Section>
    );
  }

  const rows = q.data?.errors ?? [];
  return (
    <Section title="Production errors"
      hint={rows.length ? `${rows.length} unresolved — loudest first.` : "Nothing unresolved. This is real, not a placeholder."}>
      {q.isLoading && <p className="text-body" style={{ color: "var(--text-faint)" }}>Loading…</p>}
      {!q.isLoading && rows.length === 0 && (
        <p className="text-body" style={{ color: "var(--text-muted)" }}>
          No unresolved errors reported.
        </p>
      )}
      <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
        {rows.map(e => (
          <div key={e.fingerprint} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 text-caption tabular-nums"
              style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
              ×{e.occurrences}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body" style={{ color: "var(--text-primary)" }} title={e.message}>{e.message}</p>
              <p className="text-caption" style={{ color: "var(--text-faint)" }}>
                {e.route || "unknown route"} · {e.source} · last {new Date(e.last_seen_at).toLocaleString()}
              </p>
            </div>
            <button onClick={() => resolve.mutate(e.fingerprint)} disabled={resolve.isPending}
              className="btn-secondary shrink-0 !px-2.5 !py-1 !text-label">
              Resolve
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

interface ClientError {
  fingerprint: string; message: string; source: string; route: string | null;
  occurrences: number; first_seen_at: string; last_seen_at: string; resolved_at: string | null;
}

  return (
    <div className="mx-auto max-w-3xl px-1 py-2">
      {/* Shared PageHeader — same page-header pattern as every other settings page. */}
      <div className="mb-6">
        <CommandPageHeader
          variant="bar" icon={ShieldCheck} callsign="AI CONTROL ROOM" title="AI Control Room" subtitle="Sovereign-first AI architecture — configuration, agents, safety, and the audit trail. Real data only." />
      </div>

      <ProductionErrors />

      {/* Sovereignty matrix — the honest at-a-glance posture. Layers are self-hosted/native where
          it matters (auth, inference gateway, search); Google/Outlook/Stripe are optional
          client-authorized integrations, not core AI infrastructure. */}
      <Section title="Sovereignty matrix" hint='Sovereign-first — "100% sovereign" applies only when private/self-hosted inference AND search are configured.'>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          <MatrixRow label="Core auth" value="Sovereign / native (email + cookie sessions)" tone="ok" />
          <MatrixRow label="Workspace data" value="Isolated — every query is workspace-scoped" tone="ok" />
          <MatrixRow label="AI inference"
            value={byId("ask")?.state === "operational" ? "Private AI gateway (your configured endpoint)" : "Not configured — needs the private AI gateway"}
            tone={byId("ask")?.state === "operational" ? "ok" : "warn"} />
          <MatrixRow label="Web search"
            value={byId("sovereign_search")?.state === "operational" ? "Sovereign search appliance (self-hosted SearXNG)" : "Needs setup — SOVEREIGN_SEARCH_URL"}
            tone={byId("sovereign_search")?.state === "operational" ? "ok" : "warn"} />
          <MatrixRow label="Marketing chat" value="Routes to the backend public ask endpoint on the sovereign gateway — the marketing site holds no AI secrets" tone="ok" />
          <MatrixRow label="Email / calendar" value="Optional client-authorized connectors (Google / Outlook) — not core AI infrastructure" tone="muted" />
          <MatrixRow label="Billing" value="Stripe — payment processor only (Mondaily never stores card numbers)" tone="muted" />
          <MatrixRow label="Training data" value="Human-approved only — connected email/calendar is never used for training unless you explicitly approve it" tone="ok" />
          <MatrixRow label="Third-party AI/search fallbacks" value="Disabled — no silent fallback to Anthropic, OpenAI, or Tavily" tone="ok" />
        </div>
      </Section>

      {/* AI runs — Phase-1 observability. Calm, monospaced, honest: any metric with no signal
          yet reads "—" (never a fabricated number). Populates as the new ai_usage columns fill. */}
      {(() => {
        const o = obsQ.data?.observability;
        const calls = obsQ.data?.month?.ai_calls ?? 0;
        const classes = Object.entries(o?.by_class ?? {}).sort((a, b) => b[1] - a[1]);
        const models = Object.keys(obsQ.data?.month?.by_model ?? {});
        const cells: { label: string; value: string }[] = [
          { label: "AI runs · month", value: calls ? calls.toLocaleString() : "—" },
          { label: "avg latency", value: o?.avg_latency_ms != null ? `${o.avg_latency_ms} ms` : "—" },
          { label: "cache hit rate", value: o?.cache_hit_rate != null ? `${o.cache_hit_rate}%` : "—" },
          { label: "refusals", value: o?.refusals != null ? String(o.refusals) : "—" },
          { label: "backend", value: (o?.providers ?? []).join(", ") || "—" },
          { label: "models", value: models.length ? String(models.length) : "—" },
        ];
        return (
          <Section title="AI runs" hint="Live from the AI usage ledger this month. Cache hit rate populates once your gateway reports prompt caching (e.g. vLLM prefix cache).">
            <div className="grid grid-cols-2 divide-y overflow-hidden rounded-sm border sm:grid-cols-3 sm:divide-x sm:divide-y-0" style={{ borderColor: "var(--border-soft)" }}>
              {cells.map((cl) => (
                <div key={cl.label} className="px-3.5 py-2.5">
                  <div className="truncate font-mono text-[14px] font-medium tabular-nums" style={{ color: "var(--text-primary)" }} title={cl.value}>{cl.value}</div>
                  <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em]" style={{ color: "var(--text-faint)" }}>{cl.label}</div>
                </div>
              ))}
            </div>
            {classes.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {classes.map(([cls, n]) => (
                  <span key={cls} className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
                    {cls} <span className="tabular-nums" style={{ color: "var(--text-faint)" }}>{n}</span>
                  </span>
                ))}
              </div>
            )}
          </Section>
        );
      })()}

      {/* Production readiness — owner/admin-only, READ-ONLY config inspector. Booleans only, never any
          secret value. Sourced from /admin/readiness which reuses the same gating helpers the features
          use, so it can't drift from real behavior. */}
      <ProdReadinessSection />

      {/* Inference infrastructure — sovereign vLLM engine status, measured handshake, shadow verdicts. */}
      <InferenceInfraSection />

      {/* Workspace memory (shadow) — Phase 2A. Default OFF. Turning it on ONLY unlocks this debug
          view; recall is NOT wired into Ask/agents, so no answer changes. Admin-only surface. */}
      <MemoryShadowSection />

      {/* 1. AI System Status */}
      <Section title="AI system status">
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          <StatusRow label="AI gateway" check={byId("ask")} />
          <StatusRow label="Sovereign web search" check={byId("sovereign_search")} />
          <StatusRow label="Background jobs (agents)" check={byId("inngest")} />
          <Row>
            <span style={{ color: "var(--text-secondary)" }}>Last agent run</span>
            <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{relAgo(lastRun)}</span>
          </Row>
          <Row>
            <span style={{ color: "var(--text-secondary)" }}>AI errors today</span>
            <span className="tabular-nums" style={{ color: errorsToday > 0 ? "var(--status-error)" : "var(--text-muted)" }}>{errorsToday}</span>
          </Row>
        </div>
      </Section>

      {/* 2. Agent Permissions — real agents; permissions shown as read-only default policy */}
      <Section title="Agent permissions" hint="Default policy — per-agent permission overrides aren't stored yet (read-only).">
        {agentsLoading ? <Loading /> : (
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {constellation.map((a) => {
              const runnable = ["relationship", "operations", "finance", "graph-enrichment", "workflow", "opportunity", "people", "portfolio", "asset", "meeting"].includes(a.id);
              return (
                <div key={a.id} className="flex items-center gap-3 py-2.5">
                  <a.icon size={14} className="shrink-0" style={{ color: a.state === "active" ? stateTone(a.state) : "var(--text-muted)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{a.name.replace(" Agent", "")}</span>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateTone(a.state) }} />
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{CONSTELLATION_STATE_LABEL[a.state]}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
                      <Pill>reads records</Pill>
                      <Pill>can draft</Pill>
                      <Pill>acts only with approval</Pill>
                      <span>· last run {relAgo(a.lastRunAt)}</span>
                    </div>
                  </div>
                  {runnable && <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>run-now enabled</span>}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 3. Human Approval Policy — POLICY PREVIEW (no persistence endpoint yet) */}
      <Section title="Human approval policy" hint="Policy preview — not yet persisted. Needs a settings endpoint (see note below).">
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {[
            "Require approval before sending emails",
            "Require approval before finance actions",
            "Require approval before workflow execution",
            "Require approval before external enrichment",
          ].map((label) => (
            <Row key={label}>
              <span style={{ color: "var(--text-secondary)" }}>{label}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: "var(--status-ok)" }}>
                <CheckCircle2 size={12} /> On (default)
              </span>
            </Row>
          ))}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
          These reflect Mondaily's current behaviour — every agent prepares actions for the Decision Queue and nothing sends without your approval. Making them editable needs a <code>PATCH /settings/ai-policy</code> endpoint (not built).
        </p>
      </Section>

      {/* 4. AI Data Boundary — factual architecture statements */}
      <Section title="AI data boundary">
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          <Boundary ok label="Workspace-scoped answers only" detail="Every AI request is scoped to this workspace; the AI can't read another workspace's data." />
          <Boundary ok label="Source-backed responses" detail="Answers and decisions cite the real records or evidence behind them." />
          <Boundary ok label="No cross-workspace memory" detail="Threads and context never carry across workspaces." />
          <Boundary ok label="No training on your data by default" detail="Customer data isn't used for model training unless you explicitly export/configure it." />
          <Boundary ok label="Connected email & calendar stay yours" detail="Email and calendar data is only accessed after you connect an account, remains workspace-scoped, is never used for AI training unless you explicitly approve it, and can be disconnected at any time." />
          <Boundary ok label="AI can't see payment data" detail="Card numbers and payment methods live with Stripe (the payment processor) — Mondaily never stores them and AI tools can't access raw card/payment data." />
          <Boundary ok label="Sovereign-first AI + search" detail="Runs on your private AI gateway and self-hosted search — no third-party AI/search middleman and no silent fallbacks." />
        </div>
      </Section>

      {/* 5. Tool Availability */}
      <Section title="Tool availability">
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <Tool icon={MessageSquare} label="Ask AI" on />
          <Tool icon={Network} label="AI Inspector" on />
          <Tool icon={GitBranch} label="Graph Context Drawer" on />
          <Tool icon={Radar} label="Discovery / Prospecting Agent" on={byId("sovereign_search")?.state === "operational"} note={byId("sovereign_search")?.state !== "operational" ? "needs search setup" : undefined} />
          <Tool icon={Receipt} label="Finance Agent" on />
          <Tool icon={Workflow} label="Workflow Agent" on />
          <Tool icon={Users2} label="Relationship Agent" on />
          <Tool icon={Activity} label="Operations Agent" on />
          <Tool icon={BarChart2} label="Reports / Insights" on />
        </div>
      </Section>

      {/* 6. Audit Log / Recent AI Actions */}
      <Section title="Recent AI actions" hint="Live from the agent job log.">
        {activityQ.isLoading ? <Loading /> : activity.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No agent activity recorded yet.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {activity.slice(0, 12).map((a) => {
              const tone = a.status === "completed" ? "var(--status-ok)" : a.status === "failed" ? "var(--status-error)" : "var(--status-warn)";
              return (
                <div key={a.id} className="flex items-start gap-2.5 py-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-medium capitalize" style={{ color: "var(--text-primary)" }}>{a.agent.replace(/_/g, " ")}</span>
                      <span className="mx-1.5" style={{ color: "var(--text-faint)" }}>·</span>
                      <span style={{ color: a.status === "failed" ? "var(--status-error)" : "var(--text-secondary)" }}>{a.error || a.summary}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: "var(--text-faint)" }}>{clock(a.started_at)}</span>
                </div>
              );
            })}
          </div>
        )}
        <Link to="/activity" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>
          Open the full Agent Control Room (roster, timeline, replay) <ArrowUpRight size={11} />
        </Link>
      </Section>

      <div className="mt-4 flex items-start gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
        <ShieldCheck size={13} className="mt-px shrink-0" />
        <p>Everything on this page is read straight from the live status probe and agent job log — real configuration, real runs, no fabricated scores or activity.</p>
      </div>
    </div>
  );
}

// ── Phase 2A: source-backed memory recall in SHADOW mode ──────────────────────
interface ScoreBreakdown { keyword: number; type_weight: number; recency: number; final: number }
interface RecallCandidate { kind: string; category?: string; title: string; snippet: string; source: { type: string; id: string }; as_of: string | null; score: number; breakdown?: ScoreBreakdown; injected?: boolean; reject_reason?: string }
interface RecallResp { enabled: boolean; candidates: RecallCandidate[]; candidate_count: number; injected_count?: number; source_count: number; by_kind?: Record<string, number>; intent?: string[]; latency_ms: number; scanned: number }
function MemoryShadowSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const settingQ = useQuery({ queryKey: ["memory-settings"], queryFn: () => apiClient.get<{ enabled: boolean }>("/memory/settings"), retry: false });
  const enabled = settingQ.data?.enabled ?? false;
  const toggle = useMutation({
    mutationFn: (next: boolean) => apiClient.post("/memory/settings", { enabled: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory-settings"] }),
  });
  const recall = useMutation({
    mutationFn: (query: string) => apiClient.get<RecallResp>(`/memory/recall?q=${encodeURIComponent(query)}`),
  });
  const r = recall.data;
  return (
    <Section title="Workspace memory · shadow" hint="Phase 2A — source-backed recall preview. Reads only existing records; injects nothing into answers. Default off.">
      <div className="flex items-center justify-between gap-4 py-1">
        <div>
          <p className="text-[12.5px]" style={{ color: "var(--text-primary)" }}>Enable shadow recall</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>Unlocks this preview only — recall is NOT wired into Ask or agents, so no AI answer changes.</p>
        </div>
        <button role="switch" aria-checked={enabled} onClick={() => toggle.mutate(!enabled)} disabled={toggle.isPending}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50"
          style={{ background: enabled ? "var(--section-accent)" : "var(--surface-hover)" }}>
          <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: enabled ? "1.5rem" : "0.125rem" }} />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) recall.mutate(q.trim()); }}
              placeholder="Try a query — e.g. overdue invoices, acme deal, onboarding task…"
              className="flex-1 rounded-sm border bg-transparent px-2.5 py-1.5 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }} />
            <button onClick={() => q.trim() && recall.mutate(q.trim())} disabled={!q.trim() || recall.isPending}
              className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-medium disabled:opacity-50" style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
              {recall.isPending ? <Loader2 size={12} className="animate-spin" /> : "Preview recall"}
            </button>
          </div>
          {r && (
            <>
              <div className="grid grid-cols-3 divide-x overflow-hidden rounded-sm border sm:grid-cols-5" style={{ borderColor: "var(--border-soft)" }}>
                {[["candidates", String(r.candidate_count)], ["injected", String(r.injected_count ?? Math.min(3, r.candidate_count))], ["sources", String(r.source_count)], ["scanned", String(r.scanned)], ["latency", `${r.latency_ms} ms`]].map(([l, v]) => (
                  <div key={l} className="px-3 py-2">
                    <div className="font-mono text-[13px] font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{v}</div>
                    <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em]" style={{ color: "var(--text-faint)" }}>{l}</div>
                  </div>
                ))}
              </div>
              {(r.intent?.length || r.by_kind) && (
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                  {(r.intent ?? []).length > 0 && <span>intent: {(r.intent ?? []).join(" + ")}</span>}
                  {r.by_kind && Object.entries(r.by_kind).map(([k, n]) => (
                    <span key={k} className="rounded-sm border px-1.5 py-px" style={{ borderColor: "var(--border-soft)" }}>{k} {n}</span>
                  ))}
                </div>
              )}
              {r.candidates.length === 0 ? (
                <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>No source-backed matches — recall returns empty rather than inventing context.</p>
              ) : (
                <div className="divide-y rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
                  {r.candidates.map((c) => {
                    const injected = c.injected ?? false;
                    const b = c.breakdown;
                    return (
                      <div key={`${c.source.type}:${c.source.id}`} className="flex items-start gap-2.5 px-3 py-2" style={{ background: injected ? "var(--surface-hover)" : undefined, opacity: injected ? 1 : 0.72 }}>
                        <span className="mt-0.5 shrink-0 rounded-sm border px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wide" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>{c.category ?? c.kind}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <div className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{c.title}</div>
                            {injected
                              ? <span className="shrink-0 rounded-sm px-1 py-px font-mono text-[8px] uppercase tracking-wider" style={{ background: "var(--section-accent-soft)", color: "var(--section-accent)" }}>injected</span>
                              : <span className="shrink-0 rounded-sm border px-1 py-px font-mono text-[8px] uppercase tracking-wider" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>not injected</span>}
                          </div>
                          <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{c.snippet}</div>
                          <div className="mt-0.5 font-mono text-[9.5px]" style={{ color: "var(--text-faint)" }}>
                            {c.source.type}:{c.source.id.slice(0, 8)} · score {b ? b.final : c.score}{b ? ` (kw ${b.keyword} × type ${b.type_weight} × rec ${b.recency})` : ""}{c.as_of ? ` · ${new Date(c.as_of).toLocaleDateString()}` : ""}
                          </div>
                          {!injected && c.reject_reason && (
                            <div className="mt-0.5 text-[10px]" style={{ color: "var(--status-warn)" }}>↳ {c.reject_reason}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Shadow only — this is what recall WOULD surface. Nothing here is sent to the model or affects any answer. Every item is workspace-scoped and cites its source record.</p>
            </>
          )}
        </div>
      )}
    </Section>
  );
}


// ── Inference infrastructure — sovereign vLLM status + measured handshake + shadow verdicts ─────
interface VllmProbe { configured: boolean; ok: boolean; host: string | null; models_ms: number | null; served_models: string[]; model_served: boolean | null; ttft_ms: number | null; error: string | null }
interface ShadowAgg { enabled: boolean; reason?: string; total_runs?: number; classes?: { task_class: string; runs: number; error_rate_pct: number; avg_primary_ms: number | null; avg_shadow_ms: number | null; avg_similarity_pct: number | null }[] }
function InferenceInfraSection() {
  const readiness = useQuery<{ fields?: { inference_mode?: string; sovereign_vllm_configured?: boolean } }>({ queryKey: ["admin-readiness"], queryFn: () => apiClient.get("/admin/readiness"), retry: false, staleTime: 60_000 });
  const shadow = useQuery<ShadowAgg>({ queryKey: ["inference-shadow"], queryFn: () => apiClient.get("/admin/readiness/inference-shadow"), retry: false, staleTime: 60_000 });
  const [probe, setProbe] = useState<VllmProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const mode = readiness.data?.fields?.inference_mode ?? "gateway";
  const configured = readiness.data?.fields?.sovereign_vllm_configured ?? false;
  if (readiness.isError) return null;   // non-admin — no fake panel
  return (
    <Section title="Inference infrastructure" hint="Which engine serves the AI gateway. Sovereign vLLM fails closed — it never silently falls back across the sovereignty boundary. Everything shown is measured, never assumed.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
          <span>mode: <span style={{ color: "var(--text-primary)" }}>{mode}</span></span>
          <span>vllm: <span style={{ color: configured ? "var(--status-ok)" : "var(--text-faint)" }}>{configured ? "configured" : "not configured"}</span></span>
          {mode === "gateway" && configured && <span style={{ color: "var(--text-faint)" }}>shadow-eval eligible</span>}
          <button
            onClick={async () => { setProbing(true); try { setProbe(await apiClient.post<VllmProbe>("/admin/readiness/vllm-test", {})); } catch { setProbe(null); } finally { setProbing(false); } }}
            disabled={probing}
            className="btn-secondary h-7 gap-1.5 px-2.5 font-mono text-[11px]">
            {probing ? <Loader2 size={11} className="animate-spin" /> : null} {probing ? "measuring…" : "test handshake"}
          </button>
        </div>
        {probe && (
          <div className="rounded-md border px-3 py-2 font-mono text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            {probe.ok ? (
              <>
                <div style={{ color: "var(--status-ok)" }}>handshake ok · {probe.host}</div>
                <div>models rt: {probe.models_ms}ms · 1-token completion: {probe.ttft_ms}ms</div>
                <div>served: {probe.served_models.join(", ") || "—"}{probe.model_served === false ? <span style={{ color: "var(--status-warn)" }}>  · configured model NOT in served list</span> : null}</div>
                <div className="mt-1" style={{ color: "var(--text-faint)" }}>measured values only — engine internals (e.g. PagedAttention state) are not reported by vLLM and are not shown.</div>
              </>
            ) : (
              <div style={{ color: "var(--status-warn)" }}>handshake failed{probe.host ? ` · ${probe.host}` : ""} — {probe.error ?? "unreachable"}</div>
            )}
          </div>
        )}
        <div>
          <p className="mb-1 text-[10px] font-semibold" style={{ color: "var(--text-faint)" }}>Shadow evaluation — per task class</p>
          {!shadow.data ? <Loading /> : !shadow.data.enabled ? (
            <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              {shadow.data.reason === "migration_not_applied" ? "Shadow ledger table isn't migrated yet." : "Shadow evaluation is off."} It activates when the vLLM env vars and SOVEREIGN_VLLM_SHADOW_PCT are set — a sampled slice of real traffic is mirrored and compared (metadata only, never prompts, never credits).
            </p>
          ) : (shadow.data.total_runs ?? 0) === 0 ? (
            <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>No shadow runs yet — set SOVEREIGN_VLLM_SHADOW_PCT &gt; 0 to start mirroring. Nothing is simulated.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[11px]">
                <thead><tr style={{ color: "var(--text-faint)" }}>
                  <th className="pb-1 text-left font-medium">class</th><th className="pb-1 text-right font-medium">runs</th><th className="pb-1 text-right font-medium">err%</th>
                  <th className="pb-1 text-right font-medium">primary ms</th><th className="pb-1 text-right font-medium">shadow ms</th><th className="pb-1 text-right font-medium">similarity</th>
                </tr></thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
                  {shadow.data.classes?.map(cl => (
                    <tr key={cl.task_class} style={{ color: "var(--text-secondary)", borderColor: "var(--border-soft)" }}>
                      <td className="py-1">{cl.task_class}</td>
                      <td className="py-1 text-right tabular-nums">{cl.runs}</td>
                      <td className="py-1 text-right tabular-nums" style={{ color: cl.error_rate_pct > 5 ? "var(--status-warn)" : undefined }}>{cl.error_rate_pct}%</td>
                      <td className="py-1 text-right tabular-nums">{cl.avg_primary_ms ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{cl.avg_shadow_ms ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums" style={{ color: (cl.avg_similarity_pct ?? 0) >= 70 ? "var(--status-ok)" : undefined }}>{cl.avg_similarity_pct != null ? `${cl.avg_similarity_pct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>Similarity is a word-overlap heuristic over discarded in-memory outputs — a screening signal, not a quality verdict. Promotion to sovereign mode is a deliberate env change, never automatic.</p>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── Production readiness (read-only config inspector) ──────────────────────────
type ReadinessGroup = "ready" | "partial" | "missing" | "unknown";
interface ReadinessResp {
  deploy_commit: string | null;
  fields: Record<string, unknown> & { supabase_realtime_note?: string };
  group: Record<string, ReadinessGroup | string>;
}
// Static, human copy per subsystem — what it unlocks, what happens without it, how urgent. No env values
// live here; the live status comes purely from the API booleans.
const READINESS_ROWS: { key: string; label: string; unlocks: string; failClosed: string; priority: "Must add before customers" | "Can wait" }[] = [
  { key: "ai", label: "AI gateway", unlocks: "All AI — chat, Ask, agents, insights", failClosed: "AI features return an honest error; nothing fabricated", priority: "Must add before customers" },
  { key: "billing", label: "Billing (Stripe)", unlocks: "Paid checkout & subscriptions", failClosed: "Upgrades return “billing isn’t connected”; no fake paid state", priority: "Must add before customers" },
  { key: "mail", label: "Transactional mail", unlocks: "Activation, support & follow-up emails", failClosed: "Sends are skipped (one-shot, fail-safe); signup never blocks", priority: "Must add before customers" },
  { key: "realtime", label: "Supabase realtime", unlocks: "Instant notifications / decisions / inbox", failClosed: "Falls back to polling — everything stays current, just not instant", priority: "Can wait" },
  { key: "calls", label: "Calls (LiveKit)", unlocks: "Native calls, guest calls, recording", failClosed: "Call URLs 503 — no fake tokens; code-ready, inactive", priority: "Can wait" },
  { key: "meeting_memory", label: "Meeting Memory (STT)", unlocks: "Transcripts & AI summaries", failClosed: "Transcript “unavailable”, summary “pending” — never fabricated", priority: "Can wait" },
  { key: "search", label: "Search / Discovery", unlocks: "Web-backed lead & review discovery", failClosed: "Honest empty results (fail-loud), never fake sources", priority: "Can wait" },
  { key: "private_inference", label: "Private inference / embeddings", unlocks: "Vector recall acceleration", failClosed: "Fails soft to LLM-rerank; product unchanged", priority: "Can wait" },
];
const STATUS_META: Record<string, { color: string; label: string }> = {
  ready:   { color: "var(--status-ok)", label: "Ready" },
  partial: { color: "var(--status-warn)", label: "Partial" },
  missing: { color: "var(--status-error)", label: "Missing" },
  unknown: { color: "var(--text-faint)", label: "Unknown" },
};
// A small admin-only "Verify" action + inline result (Passed / Failed / Not run). Runs a safe,
// non-destructive self-test endpoint; shows the honest outcome without exposing any secret.
function VerifyAction({ label, run }: { label: string; run: () => Promise<{ ok: boolean; reason?: string }> }) {
  const m = useMutation({ mutationFn: run });
  const state = m.isPending ? "running" : m.data ? (m.data.ok ? "passed" : "failed") : "idle";
  const color = state === "passed" ? "var(--status-ok)" : state === "failed" ? "var(--status-error)" : "var(--text-faint)";
  const text = state === "running" ? "Running…" : state === "passed" ? "Passed" : state === "failed" ? "Failed" : "Not run";
  return (
    <div className="mt-1 flex items-center gap-2">
      <button onClick={() => m.mutate()} disabled={m.isPending}
        className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium disabled:opacity-50"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
        {m.isPending ? <Loader2 size={10} className="animate-spin" /> : null}{label}
      </button>
      <span className="text-[10px] font-semibold" style={{ color }}>{text}</span>
      {state === "failed" && m.data?.reason && (
        <span className="text-[9.5px]" style={{ color: "var(--text-faint)" }}>({m.data.reason})</span>
      )}
    </div>
  );
}

function ProdReadinessSection() {
  const q = useQuery<ReadinessResp>({ queryKey: ["admin-readiness"], queryFn: () => apiClient.get<ReadinessResp>("/admin/readiness"), retry: false, staleTime: 60_000 });
  const g = q.data?.group ?? {};
  const note = q.data?.fields?.supabase_realtime_note;
  return (
    <Section title="Production readiness" hint="Read-only — which production subsystems are configured. Booleans only; no secret values are ever shown or editable here.">
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Checking configuration…</div>
      ) : q.isError ? (
        <p className="py-3 text-[12px]" style={{ color: "var(--text-faint)" }}>Readiness is unavailable right now.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)" }}>
            {READINESS_ROWS.map((r, i) => {
              const st = String(g[r.key] ?? "unknown");
              const meta = STATUS_META[st] ?? STATUS_META.unknown!;
              return (
                <div key={r.key} className="flex items-start gap-3 px-3.5 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}>
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{r.label}</span>
                      <span className="rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span>
                      {r.priority === "Must add before customers" && (st === "missing" || st === "partial") && (
                        <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--status-warn)" }}>· before customers</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>Unlocks: {r.unlocks}</p>
                    <p className="text-[10.5px]" style={{ color: "var(--text-faint)" }}>Without it: {r.failClosed}</p>
                    {r.key === "realtime" && note && (st === "ready" || st === "partial") && (
                      // Advisory, not a warning: faint when ready (creds configured), amber only if partial.
                      <p className="mt-0.5 text-[10.5px]" style={{ color: st === "ready" ? "var(--text-faint)" : "var(--status-warn)" }}>{note}</p>
                    )}
                    {/* Admin-only safe self-tests. Mail sends one message to your own address; LiveKit only
                        mints+discards a token. Neither touches product mail, calls, recording, or payments. */}
                    {r.key === "mail" && (
                      <VerifyAction label="Verify mail (to me)" run={() => apiClient.post<{ ok: boolean; reason?: string }>("/admin/readiness/mail-test", {})} />
                    )}
                    {r.key === "calls" && (
                      <VerifyAction label="Verify LiveKit" run={() => apiClient.post<{ ok: boolean; reason?: string }>("/admin/readiness/livekit-test", {})} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {q.data?.deploy_commit && (
            <p className="mt-2 font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>deploy · {q.data.deploy_commit.slice(0, 8)}</p>
          )}
        </>
      )}
    </Section>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-2">
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
        {hint && <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2.5 text-[12.5px]">{children}</div>;
}
function MatrixRow({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "muted" }) {
  const color = tone === "ok" ? "var(--status-ok)" : tone === "warn" ? "var(--status-warn)" : "var(--text-faint)";
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="w-32 shrink-0 text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="min-w-0 flex-1 text-[12px]" style={{ color: "var(--text-muted)" }}>{value}</span>
    </div>
  );
}
function StatusRow({ label, check }: { label: string; check?: Check }) {
  const state = check?.state ?? "not_checked";
  const tone = STATE_TONE[state];
  const Icon = state === "operational" ? CheckCircle2 : state === "disabled" || state === "not_checked" ? CircleSlash : AlertTriangle;
  const stateLabel = state === "operational" ? "Configured" : state === "needs_setup" ? "Needs setup" : state === "error" ? "Error" : state === "disabled" ? "Disabled" : "Unknown";
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: tone }}>
        <Icon size={12} /> {stateLabel}
      </span>
    </div>
  );
}
function Boundary({ ok, label, detail }: { ok?: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <CheckCircle2 size={13} className="mt-0.5 shrink-0" style={{ color: ok ? "var(--status-ok)" : "var(--text-faint)" }} />
      <div>
        <p className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
        <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>{detail}</p>
      </div>
    </div>
  );
}
function Tool({ icon: Icon, label, on, note }: { icon: React.ElementType; label: string; on?: boolean; note?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[12.5px]">
      <Icon size={13} className="shrink-0" style={{ color: on ? "var(--section-accent)" : "var(--text-faint)" }} />
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="ml-auto inline-flex items-center gap-1 text-[10.5px]" style={{ color: on ? "var(--status-ok)" : "var(--status-warn)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "var(--status-ok)" : "var(--status-warn)" }} />
        {on ? "Available" : (note ?? "Needs setup")}
      </span>
    </div>
  );
}
function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full px-1.5 py-px" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{children}</span>;
}
function Loading() {
  return <div className="flex items-center gap-2 py-4 text-[12px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Loading…</div>;
}
