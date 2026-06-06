# MONDAILY — MASTER CODEX BUILD COMMAND
# Version 1.0
# Paste this entire file into Claude Code / Cursor / Windsurf before rebuild sessions.

This file is the execution companion to `MONDAILY.md`.

Read `MONDAILY.md` first, then use this file to build Mondaily from zero to production in controlled phases.

---

## Mission

Build Mondaily, a fully AI business operating system at `mondaily.com`.

Critical difference:

- Attio: AI-native CRM. Humans work, AI assists.
- Mondaily: Fully AI platform. AI works, humans review and approve.

Every page, feature, route, schema, workflow, and UI surface must assume that an AI agent is the primary actor. Humans are reviewers, approvers, and operators of exceptions.

---

## Phase 0 — Project Bootstrap

Create a Turborepo monorepo using pnpm.

```bash
mkdir mondaily
cd mondaily
pnpm init
npx create-turbo@latest . --package-manager pnpm
```

Create this target folder structure:

```text
mondaily/
├── MONDAILY.md
├── MONDAILY_CODEX_COMMAND.md
├── package.json
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   ├── changelog/page.tsx
│   │   │   ├── blog/[slug]/page.tsx
│   │   │   └── api/waitlist/route.ts
│   │   ├── components/
│   │   │   ├── hero.tsx
│   │   │   ├── feature-section.tsx
│   │   │   ├── pricing-table.tsx
│   │   │   ├── customer-logos.tsx
│   │   │   └── nav.tsx
│   │   └── package.json
│   └── app/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── routes/
│       │   │   ├── index.tsx
│       │   │   ├── auth/
│       │   │   ├── onboarding/
│       │   │   └── dashboard/
│       │   ├── components/
│       │   │   ├── ui/
│       │   │   ├── layout/
│       │   │   ├── records/
│       │   │   ├── ai/
│       │   │   └── modals/
│       │   └── lib/
│       └── package.json
├── packages/
│   ├── api/
│   ├── agents/
│   ├── tools/
│   ├── prompts/
│   ├── db/
│   ├── verticals/
│   └── shared/
└── supabase/
    ├── migrations/
    └── config.toml
```

Do not migrate the current live website blindly. Build this as a clean production architecture after the existing site is backed up.

---

## Phase 1 — Database First

Nothing works without the Universal Business Context database.

Create Supabase migrations:

```text
supabase/migrations/
├── 0001_ubc_schema.sql
├── 0002_rls_policies.sql
├── 0003_embedding_trigger.sql
├── 0004_indexes.sql
└── 0005_seed_objects.sql
```

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

Core tables:

- `workspaces`
- `workspace_members`
- `teams`
- `team_members`
- `nodes`
- `edges`
- `activities`
- `object_definitions`
- `agent_jobs`
- `chat_threads`
- `chat_messages`
- `lists`
- `list_entries`
- `api_keys`

Critical rules:

- `nodes` is the universal record table.
- Every vertical uses `nodes`.
- `nodes.embedding` uses `vector(1536)`.
- `nodes.fts_vector` uses Postgres full-text search.
- `activities` is immutable. Never update or delete.
- Every mutation creates an activity.
- Every record write must keep semantic memory synchronized with source data.

Use `pgvector` and Postgres full-text search. Do not use Pinecone, Weaviate, or Chroma.

---

## Phase 2 — Backend API

Create `packages/api` as a Hono API server.

Install:

```bash
cd packages/api
pnpm add hono @hono/zod-validator zod @supabase/supabase-js
pnpm add @clerk/backend @upstash/ratelimit @upstash/redis
pnpm add openai @ai-sdk/anthropic ai inngest
pnpm add @types/node typescript tsx --save-dev
```

Routes:

```text
packages/api/src/routes/
├── nodes.ts
├── edges.ts
├── search.ts
├── activities.ts
├── ask.ts
├── agents.ts
└── webhooks/
    ├── stripe.ts
    ├── clerk.ts
    └── nylas.ts
```

Middleware:

```text
packages/api/src/middleware/
├── auth.ts
├── ratelimit.ts
└── workspace.ts
```

API rules:

- Use Hono.
- Use `zValidator` on every route.
- Use Clerk JWT auth.
- Use workspace isolation on every route.
- Never trust raw `req.body`.
- Every node write calls `logActivity`.
- Streaming AI responses must stream; never wait for full text before rendering.

---

## Phase 3 — AI Agents

Create all agents inside `packages/agents`.

Agent files:

```text
packages/agents/src/
├── orchestrator.ts
├── ask-mondaily.ts
├── sales/agent.ts
├── realestate/agent.ts
├── hr/agent.ts
├── finance/agent.ts
└── investments/agent.ts
```

Prompts live only in Markdown:

```text
packages/prompts/
├── orchestrator.md
├── ask-mondaily.md
├── sales-agent.md
├── realestate-agent.md
├── hr-agent.md
├── finance-agent.md
└── investments-agent.md
```

Ask Mondaily must:

- Search before creating.
- Avoid duplicate records.
- Create and update records.
- Link records through edges.
- Draft emails and documents for review.
- Research companies and people.
- Analyze pipeline health.
- Flag risks.
- Log all actions.
- Stream responses.

Sales agent must:

- Search records.
- Update records.
- Enrich contacts.
- Research companies.
- Score leads.
- Draft outreach.
- Flag deal risk.
- Log all actions.

---

## Phase 4 — Frontend App

Create `apps/app` as React 19 + Vite + TypeScript.

Install:

```bash
cd apps/app
pnpm add react react-dom react-router-dom @tanstack/react-query zustand
pnpm add @clerk/react framer-motion lucide-react
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs
pnpm add @radix-ui/react-tooltip @radix-ui/react-popover @radix-ui/react-select
pnpm add @dnd-kit/core @dnd-kit/sortable recharts tiptap
pnpm add date-fns clsx tailwind-merge class-variance-authority
pnpm add --save-dev @vitejs/plugin-react tailwindcss autoprefixer vite typescript
npx shadcn-ui@latest init
```

Dashboard shell:

- Persistent left sidebar.
- Main panel shell.
- Global command palette.
- Ask Mondaily page.
- Agent status bar.
- AI action banner.
- Record table and kanban views.
- Record detail page.
- Activity timeline.
- Settings pages.

The UI is a review layer for AI activity. Every important component should show what the AI is doing or has done.

---

## Phase 5 — Proactive AI Jobs

Use Inngest for durable agent work.

Create jobs:

- `syncEmbedding`
- `stalledDealsCheck`
- `handleStalledDeals`
- `dailyBriefing`
- `enrichNewLead`

Rules:

- Agent errors are stored in `agent_jobs`.
- Jobs retry safely.
- Jobs never crash silently.
- Embedding sync must keep source data and vector memory aligned.

---

## Phase 6 — Marketing Site

Create `apps/web` as Next.js 14 App Router.

Homepage sections:

- Hero.
- Customer logos.
- Feature sections.
- Pricing preview.
- CTA.
- Parallax product mockup.

Positioning:

```text
Your entire business, run by AI.
```

Do not present Mondaily as "AI-assisted." Present it as a fully AI business operating system.

---

## Phase 7 — Environment Variables

Create `.env.example` with:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
VITE_CLERK_PUBLISHABLE_KEY=

ANTHROPIC_API_KEY=
OPENAI_API_KEY=

RESEND_API_KEY=
NYLAS_CLIENT_ID=
NYLAS_CLIENT_SECRET=
NYLAS_API_KEY=

INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=mondaily-files

TAVILY_API_KEY=
APOLLO_API_KEY=
CLEARBIT_API_KEY=

PLAID_CLIENT_ID=
PLAID_SECRET=

SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
AXIOM_API_KEY=

NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_API_URL=
VITE_API_URL=
VITE_APP_URL=
```

---

## Codex Execution Order

Give these tasks to Claude Code / Cursor one at a time.

Always preface with:

```text
Read MONDAILY.md and MONDAILY_CODEX_COMMAND.md first, then do the following task:
```

### Task 1 — Monorepo skeleton

Set up the Turborepo monorepo with the exact folder structure above. Install all dependencies per phase. Create all config files. Do not implement features yet.

### Task 2 — Database

Run all 5 Supabase migrations in order. Implement `packages/db/src/ubc.ts` with:

- `createNode`
- `updateNode`
- `getNode`
- `listNodes`
- `deleteNode`
- `searchNodes`
- `createEdge`
- `getRelated`
- `logActivity`
- `getActivities`

All functions must be Zod typed.

### Task 3 — API

Implement the Hono API server with auth middleware, rate limiting, nodes, search, ask streaming, agents, activities, and webhooks.

### Task 4 — Ask Mondaily

Implement all prompts and `packages/agents/src/ask-mondaily.ts` with all tools. Test streaming end to end.

### Task 5 — Sales agent

Implement `packages/agents/src/sales/agent.ts` with search, update, enrichment, research, scoring, outreach drafts, and risk flags.

### Task 6 — Inngest jobs

Implement embedding sync, stalled deal checks, daily briefings, and new lead enrichment.

### Task 7 — React app shell

Build app routing, Clerk auth, sidebar, dashboard layout, home page, meetings, tasks, and AI signals.

### Task 8 — Record system

Build object index pages, table view, kanban view, record detail pages, activity timeline, CRUD modals, email compose, task creation, and record merge.

### Task 9 — Ask Mondaily UI

Build chat threads, full-page chat, streaming messages, suggested prompts, and action cards.

### Task 10 — Workflow builder

Build node-based canvas with triggers, logic blocks, action blocks, drag-and-drop, connection lines, and configuration panels.

### Task 11 — Settings

Build account, workspace, members, teams, billing, objects, attributes, integrations, API keys, email sync, security, and SSO pages.

### Task 12 — Marketing site

Build the Next.js marketing site with hero, product mockup, feature sections, pricing page, Stripe checkout, and waitlist capture.

---

## Mondaily vs Attio

| Attio pattern | Mondaily pattern |
|---------------|-----------------|
| User opens a record, fills fields | AI fills fields on record creation |
| User clicks send follow-up | AI drafts follow-up, user approves |
| User sets up workflow | AI suggests workflow, user enables |
| User searches at-risk deals | AI flags at-risk deals proactively |
| User connects email, AI reads it | AI reads email and acts on it |
| AI assists when asked | AI acts continuously, reports back |

Every component should show an AI status indicator.

The AI is the primary actor. The UI is the review layer.

---

End of `MONDAILY_CODEX_COMMAND.md`.
