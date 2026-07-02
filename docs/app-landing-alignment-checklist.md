# App ↔ Landing Page Alignment Checklist

Last updated: 2026-07-02. This is a living document — update it whenever a
landing-page promise's backing changes. Status definitions:

- **Implemented** — real backend data/logic, no fabrication, used in the app today.
- **Partially implemented** — real backend exists for part of the claim, or backend exists but frontend coverage is incomplete.
- **Not implemented** — no real backend exists; any UI suggesting otherwise should be considered a bug.

---

## Agents

| Promise | Status | Where it exists | What's left |
|---|---|---|---|
| Graph Agent (conversational interface) | **Implemented** | `packages/api/src/routes/ask.ts`, `apps/app/src/components/ai/use-ask-engine.ts` | — |
| Research / Enrichment Agent | **Partially implemented** | `packages/api/src/jobs/enrich-record.ts` (real Inngest job, agent_jobs-logged); registry entry `graph-enrichment` in `packages/api/src/routes/agents.ts` | Only "active"/"monitoring" once it has actually run for a given workspace — honest by design, but means most workspaces will show `not_configured` until enrichment fires once. |
| Relationship Agent | **Implemented** | `packages/api/src/jobs/relationship-health.ts`, `deal-alerts.ts` (real cron jobs); writes `relationship_health`/`health_signals` on nodes; creates real Decision Queue rows for stale deals | — |
| Signal Agent | **Implemented** | `runLeadScoring()` in `packages/api/src/jobs/runners.ts` writes real `lead_score` on nodes; reads `notifications` (type `ai_risk`) + deal-stage/amount in `packages/api/src/routes/agents.ts`; raises Decision Queue alerts | Signals are surfaced via `lead_score` + Decision Queue + notifications rather than a separate `/signals` schema (deliberate — see "Live Signals" below). |
| Operations Agent | **Implemented** | Live overdue/review task counts + real Decision Queue rows via `packages/api/src/jobs/overdue-task-decisions.ts` (new cron, daily) | — |
| Graph Enrichment Agent | **Implemented** | `packages/api/src/jobs/enrich-record.ts` (real Inngest job, agent_jobs-logged) over the sovereign SearXNG appliance | Fires once on record creation; no re-enrichment job yet. |
| Prospecting Agent | **Implemented** | `packages/api/src/routes/prospecting.ts` + `packages/api/src/jobs/social-discovery.ts` — sweeps the open web + social via the sovereign SearXNG appliance, per-page source-backed extraction, dedupe, queues Decision Queue approvals | Every candidate requires a real source URL. |
| Workflow Agent | **Implemented** | Real execution engine `packages/api/src/jobs/workflow-engine.ts` (`runWorkflowsForWorkspace`) — real-time Inngest event triggers on record create/update, multi-trigger OR logic, action execution, idempotent run history in `workflow_runs` (migration 0018) exposed at `GET /api/v1/workflows/:id/runs` | Multi-trigger is OR-only; runs also swept by the daily cron as a backstop. |
| Finance Agent | **Implemented** (when Finance module enabled) | `invoice-chaser.ts` (gated behind Decision Queue approval), `credit-note-dispute.ts`, `recurring-invoices.ts` — all real Inngest jobs | Deal-stage-triggered quote drafting does not exist (see Finance Autopilot below). |

Backend: `GET /api/v1/agents` returns every agent with `state` ∈ `active / monitoring / needs_approval / issue / disabled / not_configured`, `backed_by`, `last_run_at`, `last_action`, `evidence_count`, `suggested_action`, `destination`. Pending Decision Queue items for an agent upgrade its state to `needs_approval`/`issue`.

Frontend usage: Home Agent Constellation ✅ (preview), sidebar "Agents" row ✅, and the **Agent Control Room** at `/activity` ✅ — the canonical roster + proof-of-work timeline (`GET /agents/activity`) with run-now (`POST /agents/:id/run`) and replay (`POST /agents/replay`). An **Admin AI Control Room** at `/settings/ai-control-room` ✅ (owner/admin only) shows AI system status, agent permissions (read-only default policy), the data boundary, tool availability, and the recent-AI-actions audit.

---

## Workspace graph

| Promise | Status | Where | What's left |
|---|---|---|---|
| Objects/records form a connected graph | **Implemented** | `nodes`/`edges` tables, `ubc.getRelated()`, `find_related_objects` Ask tool | — |
| "Everything is one graph, not separate modules" | **Partially implemented** | Records, tasks, finance, automations all read/write the same `nodes`/`tasks` tables and surface in Ask | UI still presents them as distinct pages (Tasks, Finance, Automations) rather than graph "views" — acceptable as information architecture, just don't claim it's a single graph *view*. |

---

## Ask source cards / source-backed answers

| Promise | Status | Where | What's left |
|---|---|---|---|
| Ask answers are source-backed | **Implemented** | `executeTool()` in `ask.ts` pushes real `SourceMeta` for every tool call; frontend `SourceCard`/`EvidenceStrip` in `ask-shared.tsx` never shows a source the backend didn't return | — |
| Ask can search/create/build real things | **Implemented** | Tools: `search_records`, `find_related_objects`, `create_task`, `create_note`, `create_list`, `add_to_list`, `create_decision`, `list_finance_summary`, `list_invoices`, `get_invoice`, `run_report`, `get_report`, `list_reports`, `create_workflow_draft` | `create_workflow_draft` only ever saves a **disabled** draft — the model is explicitly told it can never enable one. "Create report" has no tool and its action chip stays honestly disabled. |
| No fake confidence in Ask answers | **Implemented** | `mapBackendSources()` never invents a confidence number; `EvidenceStrip` shows "Source-backed" vs "No sources returned" | — |

---

## Decision Queue

| Promise | Status | Where | What's left |
|---|---|---|---|
| Real decision_queue table + CRUD + approve/reject/snooze | **Implemented** | Migration `supabase/migrations/0016_decision_queue.sql` (confirmed applied to production 2026-06-21), `packages/api/src/routes/decisions.ts` | — |
| Decisions shown with evidence + owning agent | **Implemented** | Standalone `/decisions` Decision Deck route (`apps/app/src/App.tsx` → `DecisionsPage`), plus the Home Attention-stream panel (`command-center.tsx`) and `finance-agent-strip.tsx` on finance pages | — |
| Real sources feeding the queue | **Partially implemented** | Wired: overdue tasks (`overdue-task-decisions.ts`), stale relationships (`deal-alerts.ts`), overdue invoices (`invoice-chaser.ts`), credit note disputes (`credit-note-dispute.ts`) | Not wired: workflow approval steps (no execution engine to approve steps *of*). |
| Approving a decision actually does something | **Partially implemented** | Invoice-chase decisions: approving actually sends the reminder / creates the fallback task (`executeApprovedAction()` in `decisions.ts`) | Stale-relationship and overdue-task decisions are advisory only — approving just records the human's decision, since there's no automatable action behind "reach out to this person" or "reassign this task" today. |

---

## AI scoring / health

| Promise | Status | Where | What's left |
|---|---|---|---|
| AI health/score on records | **Implemented** | `relationship_health` (written by `relationship-health.ts`); `lead_score` is now auto-computed by `runLeadScoring()` in `runners.ts` across three trigger surfaces | Still qualify WHICH score in copy — `relationship_health` (relationships) and `lead_score` (deals/leads) are distinct real signals; don't claim a single universal "AI score" on every object type. |
| Reusable AI components | **Implemented** | `apps/app/src/components/ai/ai-intelligence.tsx`: `AIInsightBadge`, `AIHealthScore`, `AIHealthScoreCompact`, `AISignalList`, `AINextAction`, `AIEvidenceTray`, `AIAgentOwnerChip` | — |
| Used everywhere records/tasks appear | **Partially implemented** | Record detail ✅, task detail drawer ✅, record table (`relationship_health` column) ✅, task list/board cards ✅ ("AI flagged" badge from real pending decisions) | Home command center doesn't show per-record AI badges (no single record context there — addressed instead via the Decision Queue + Agent Activity panels). |
| Honest empty state | **Implemented** | "AI will start scoring this once more activity exists." in `AIHealthScore` | — |

---

## Live signals

| Promise | Status | Where | What's left |
|---|---|---|---|
| Source-backed live signals with confidence | **Implemented via Decision Queue + notifications, not a separate system** | `decision_queue.confidence` is nullable and only set when real; UI shows "Source-backed" when null (`decision-queue.tsx`, `ask-shared.tsx EvidenceStrip`) | **Decision made explicitly:** no separate `/api/v1/signals` endpoint/schema was built. Decision Queue + `notifications` *are* the signal system. If a dedicated signals API is wanted later, it should query the same underlying data (tasks/invoices/nodes/agent_jobs), not introduce a new parallel concept. |
| No fake confidence anywhere | **Implemented** | Landing page's `LIVE_SIGNALS` mock no longer shows numeric percentages (fixed in an earlier pass); backend confidence fields are nullable everywhere | — |

---

## Workflow Agent execution

| Promise | Status | Where | What's left |
|---|---|---|---|
| Workflow Agent executes graph actions | **Implemented** | `packages/api/src/jobs/workflow-engine.ts` — real trigger evaluation + condition checking + action execution, fired in real time by Inngest events on record create/update, with the daily cron as a backstop sweep | Multi-trigger is OR-only. |
| Run history / evidence trail | **Implemented** | Idempotent runs recorded in `workflow_runs` (migration 0018), exposed at `GET /api/v1/workflows/:id/runs` and shown in the builder drawer | — |

---

## Finance Autopilot

| Promise | Status | Where | What's left |
|---|---|---|---|
| Invoice chasing | **Implemented, now with approval** | `invoice-chaser.ts` queues a Decision Queue row instead of sending automatically; `executeApprovedAction()` in `decisions.ts` performs the real send (Nylas, or a fallback manual task) only on approval | — |
| Recurring invoices | **Implemented** (pre-existing) | `recurring-invoices.ts` already logged agent activity via `agent-logger.ts` before this work | — |
| Credit note disputes | **Implemented** | `credit-note-dispute.ts` creates the credit note as `pending_review` *and* queues a Decision Queue row | — |
| Deal-stage-triggered quote drafting | **Not implemented** | No job listens for stage changes to draft a quote | Do not claim this on the landing page until built. |
| Finance Agent activity visible on finance pages | **Implemented** | `FinanceAgentStrip` component on `/finance/invoices` and the invoice detail page, reading the same `/api/v1/decisions` data as Home | — |

---

## Voice / AI briefing

Not mentioned as a current landing-page promise as of this audit — no entry needed. If added to the landing page later, add a row here before launching that copy.

---

## Pricing / plan promises

| Promise | Status | Where | What's left |
|---|---|---|---|
| Plan features (Starter/Pro/Business/Enterprise) | **Not separately audited this pass** | `apps/web/components/landing-page.tsx` `PLANS` array | Out of scope for this backend/frontend parity pass — pricing copy was reviewed for tone in an earlier visual pass, not for literal feature-by-feature backend verification (e.g. "API/webhooks" on Business — webhooks support was not verified to exist). Flag for a future audit if pricing claims need backend verification. |

---

## AI surfaces (Inspector / Graph drawer / control rooms)

| Promise | Status | Where | What's left |
|---|---|---|---|
| AI Inspector on records/tasks/lists/reports/invoices | **Implemented** | `apps/app/src/components/ai/ai-inspector.tsx`, wired on all five surfaces | Composes real data only (summary, missing/stale fields, activity, graph neighbours, last agent action) with **qualitative** confidence — no numeric score. Ask actions reuse the existing Ask engine via `lib/ask-bus.ts`. |
| Graph Context Drawer on the same five surfaces | **Implemented** | `apps/app/src/components/graph/graph-context-drawer.tsx` | Real relationships (`/nodes/:id/related`), activity, connected work (tasks/notes/finance), last agent action. Non-node-backed views (task/list/report/invoice) honestly show "not a graph node". No per-object decisions filter exists → links to the Decision Deck instead of faking a list. |
| Agent Control Room | **Implemented** | `/activity` — roster (`GET /agents`) + proof-of-work timeline (`GET /agents/activity`) + run-now + replay | — |
| Admin AI Control Room (governance) | **Partially implemented** | `/settings/ai-control-room` (owner/admin) — live status, agent permissions, data boundary, tool availability, audit log | **Human approval policy is a read-only "policy preview"** — no `PATCH /settings/ai-policy` persistence endpoint exists yet. Do not present those toggles as saving. |

---

## Sovereign AI

| Promise | Status | Where | What's left |
|---|---|---|---|
| All AI runs on a sovereign gateway (no third-party middleman) | **Implemented** | App: `packages/api/src/lib/ai-gateway.ts` (Cerebras via `AI_GATEWAY_BASE_URL`/`AI_GATEWAY_API_KEY`). Marketing chat: `apps/web/app/api/ask/route.ts` uses the same gateway with **no** Anthropic/OpenAI fallback. Public ask: `packages/api/src/routes/public-ask.ts`. | Requires the gateway env vars to be set; when unset, surfaces "needs setup" rather than falling back to a third party. |
| Discovery = UI, Prospecting Agent = worker | **Implemented** | `apps/app/src/routes/dashboard/discovery.tsx` (search workbench) + `packages/api/src/routes/prospecting.ts` / `jobs/social-discovery.ts` (the worker) over the sovereign SearXNG appliance | Needs `SOVEREIGN_SEARCH_URL` + `AI_GATEWAY_*`. |

---

## Cross-cutting

- **Workspace scoping:** every route filters by `workspace_id` behind `requireAuth`, matching the existing RLS + middleware pattern. A route-by-route isolation audit (2026-07) found no cross-workspace leak.
- **No fake data policy:** confirmed no hardcoded confidence percentages remain in the Decision Queue, Ask source cards, or the landing page's live-signal mocks as of this audit.
