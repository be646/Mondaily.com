# MONDAILY — Master Context File
# Read this before writing a single line of code.
# Paste this into every Claude Code / Cursor / Windsurf session.

---

## What is Mondaily?

Mondaily is a **fully AI business operating system** — one platform that replaces CRM,
task management, service delivery, accounting, HR, real estate management, and investment
tracking across any industry. AI is not a feature — it is the execution layer. Humans
review and approve; AI initiates and executes.

Website: mondaily.com
App: app.mondaily.com
Tagline: "Your entire business, run by AI."

---

## Core philosophy (never violate these)

1. **AI-first, not AI-assisted.** Every workflow starts with an AI agent, not a human.
2. **External Consistency.** Vector embeddings are ALWAYS in sync with source data.
   Never async. Never a separate vector DB. pgvector co-located with the record.
3. **Universal Business Context (UBC).** All business data — contacts, properties,
   employees, invoices, investments — lives in one unified graph. One agent can
   reason across all domains simultaneously.
4. **Agent-per-role.** Each business function (sales, HR, finance, real estate,
   investments) has a dedicated AI agent team with domain-specific tools and memory.
5. **Natural language as the primary UI.** Every action, report, and workflow can
   be triggered via plain English through "Ask Mondaily."
6. **Codex-friendly codebase.** All agent prompts are .md files. All tools have JSDoc.
   All schemas are Zod-typed. AI coding tools can navigate and extend everything.

---

## Tech Stack (do not deviate without reason)

### Frontend — Marketing site (mondaily.com)
- Framework: Next.js 14 App Router
- Language: TypeScript (strict mode)
- Styling: Tailwind CSS v3
- Components: Radix UI primitives
- Animations: Framer Motion
- CMS: Storyblok (headless, for blog/changelog/feature pages)
- Hosting: Vercel

### Frontend — Application (app.mondaily.com)
- Framework: React 19 + Vite
- Language: TypeScript (strict mode)
- Styling: Tailwind CSS v3
- Components: Radix UI + shadcn/ui
- State (server): TanStack Query v5
- State (UI): Zustand
- Realtime: Supabase Realtime client
- Icons: Lucide React
- Tables: TanStack Table v8
- Drag & drop: @dnd-kit/core
- Rich text: Tiptap
- Charts: Recharts
- Routing: React Router v6

### Backend
- Runtime: Node.js 20 / Vercel Edge Functions
- API layer: Hono (edge-native, fast) — mounted at /api/v1/*
- Auth: Clerk (workspace/org management, SSO, MFA)
- Database: Supabase (Postgres 15 + pgvector + Realtime)
- Job queue: Inngest (durable agent execution, retries, fan-out)
- Cache: Upstash Redis (agent working memory, rate limiting, sessions)
- File storage: Cloudflare R2 (documents, attachments, exports, PDFs)
- Email send: Resend + React Email templates
- Email sync: Nylas API (Gmail + Outlook — do NOT build this from scratch)
- Bank sync: Plaid API (financial vertical)
- Search: pgvector (semantic) + Postgres tsvector (FTS) — no Pinecone
- Validation: Zod (everywhere — API input, tool args, DB output)
- HTTP client: ky or native fetch

### AI Stack
- Primary LLM: Anthropic claude-opus-4 (complex reasoning, document drafting, analysis)
- Fast LLM: claude-haiku-4-5 (classification, extraction, quick summaries)
- Embeddings: OpenAI text-embedding-3-large (1536 dimensions)
- AI SDK: Vercel AI SDK v4 (streaming, tool calling, agent loops)
- Agent orchestration: LangGraph (multi-agent coordination for complex flows)
- Web research: Tavily Search API (agent web browsing tool)
- Enrichment: Apollo.io API (contacts/companies), Clearbit (company data)
- Document OCR: AWS Textract (invoices, contracts, PDFs)
- Voice transcription: AssemblyAI (call recordings)
- MCP server: Custom — exposes all Mondaily tools to Claude/ChatGPT externally

### Infrastructure
- Monorepo: Turborepo
- Package manager: pnpm
- Testing: Vitest + Playwright (e2e)
- Linting: ESLint + Prettier
- CI/CD: GitHub Actions → Vercel preview per PR
- Monitoring: Sentry (errors) + PostHog (analytics) + BetterStack (uptime)
- Logging: Axiom
- Secrets: Doppler (all envs) or Vercel env vars

---

## Repository Structure

```text
mondaily/
├── MONDAILY.md                    ← THIS FILE — always read first
├── apps/
│   ├── web/                       ← Next.js marketing site (mondaily.com)
│   │   ├── app/
│   │   │   ├── (marketing)/       ← public pages layout
│   │   │   │   ├── page.tsx       ← homepage
│   │   │   │   ├── pricing/
│   │   │   │   └── changelog/
│   │   │   └── api/
│   │   │       └── waitlist/route.ts
│   │   └── components/
│   └── app/                       ← React SPA (app.mondaily.com)
│       ├── src/
│       │   ├── pages/             ← route components
│       │   ├── components/        ← shared UI
│       │   └── main.tsx
├── packages/
│   ├── api/                       ← Hono API server
│   │   └── src/
│   │       ├── index.ts           ← main router
│   │       ├── routes/
│   │       │   ├── nodes.ts       ← CRUD for all records
│   │       │   ├── search.ts      ← hybrid search endpoint
│   │       │   ├── agents.ts      ← trigger/stream agents
│   │       │   └── webhooks/      ← Stripe, Nylas, Clerk
│   │       └── middleware/
│   │           ├── auth.ts        ← Clerk JWT validation
│   │           └── ratelimit.ts   ← Upstash rate limiting
│   ├── agents/                    ← ALL AI agent code
│   │   └── src/
│   │       ├── orchestrator.ts    ← supervisor — routes tasks to specialists
│   │       ├── ask-mondaily.ts    ← Ask Mondaily conversational interface
│   │       ├── sales/
│   │       │   └── agent.ts
│   │       ├── realestate/
│   │       │   └── agent.ts
│   │       ├── hr/
│   │       │   └── agent.ts
│   │       ├── finance/
│   │       │   └── agent.ts
│   │       └── investments/
│   │           └── agent.ts
│   ├── tools/                     ← Agent tool functions (all JSDoc'd)
│   │   └── src/
│   │       ├── records.ts         ← search, get, create, update nodes
│   │       ├── email.ts           ← send email, read threads (Nylas)
│   │       ├── calendar.ts        ← read/create calendar events
│   │       ├── web-research.ts    ← Tavily search
│   │       ├── documents.ts       ← PDF generation, contract drafting
│   │       ├── enrichment.ts      ← Apollo/Clearbit lookups
│   │       └── notifications.ts   ← in-app + email notifications
│   ├── prompts/                   ← All LLM system prompts as .md files
│   │   ├── orchestrator.md
│   │   ├── ask-mondaily.md
│   │   ├── sales-agent.md
│   │   ├── realestate-agent.md
│   │   ├── hr-agent.md
│   │   ├── finance-agent.md
│   │   └── investments-agent.md
│   ├── db/                        ← Database layer
│   │   └── src/
│   │       ├── client.ts          ← Supabase client (server + browser)
│   │       ├── ubc.ts             ← Universal Business Context client
│   │       ├── embedding.ts       ← embedding sync logic
│   │       └── migrations/        ← Supabase SQL migrations
│   ├── verticals/                 ← Per-vertical schemas and config
│   │   ├── sales/schema.ts
│   │   ├── realestate/schema.ts
│   │   ├── hr/schema.ts
│   │   ├── finance/schema.ts
│   │   └── investments/schema.ts
│   └── shared/                    ← Types, utils, constants
│       └── src/
│           ├── types.ts
│           └── constants.ts
└── supabase/
    ├── migrations/
    │   ├── 0001_ubc_schema.sql
    │   ├── 0002_rls_policies.sql
    │   ├── 0003_embedding_trigger.sql
    │   └── 0004_indexes.sql
    └── seed.sql
```

---

## Database Schema — Universal Business Context (UBC)

### Core tables (every vertical uses these)

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_net;  -- for HTTP calls from triggers

-- Workspaces
CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  plan        TEXT DEFAULT 'free' CHECK (plan IN ('free','plus','pro','enterprise')),
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Workspace members
CREATE TABLE workspace_members (
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,  -- Clerk user ID
  role          TEXT CHECK (role IN ('owner','admin','member','viewer')),
  joined_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- CORE: Every record in every vertical is a node
CREATE TABLE nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vertical      TEXT NOT NULL,  -- 'sales','realestate','hr','finance','investments'
  object_type   TEXT NOT NULL,  -- 'contact','company','deal','property','employee','invoice'
  data          JSONB NOT NULL DEFAULT '{}',
  embedding     vector(1536),   -- OpenAI text-embedding-3-large, ALWAYS in sync
  fts_vector    tsvector,       -- full-text search, auto-generated
  ai_summary    TEXT,           -- LLM-generated summary, updated on significant changes
  created_by    TEXT,           -- Clerk user ID or 'ai_agent'
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Typed relationships between any two nodes
CREATE TABLE edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_node_id    UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node_id      UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relationship    TEXT NOT NULL,  -- 'owns','employs','invoiced','manages','invested_in'
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Immutable activity log (never delete, never update)
CREATE TABLE activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id       UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('human','ai_agent','integration','system')),
  actor_id      TEXT,          -- user ID, agent name, or integration name
  action        TEXT NOT NULL, -- 'created','updated','emailed','called','ai_analyzed','ai_drafted'
  diff          JSONB,         -- what changed: {field, old_value, new_value}
  ai_summary    TEXT,          -- LLM summary of this activity (1-2 sentences)
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Agent jobs (what the AI is doing / has done)
CREATE TABLE agent_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  agent_name    TEXT NOT NULL,  -- 'sales-agent','hr-agent', etc.
  trigger_type  TEXT NOT NULL,  -- 'manual','scheduled','webhook','signal'
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  input         JSONB NOT NULL,
  output        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Indexes

```sql
-- Workspace isolation (most common query pattern)
CREATE INDEX idx_nodes_workspace ON nodes(workspace_id);
CREATE INDEX idx_nodes_type ON nodes(workspace_id, vertical, object_type);

-- Vector similarity search (cosine distance)
CREATE INDEX idx_nodes_embedding ON nodes USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text search
CREATE INDEX idx_nodes_fts ON nodes USING gin(fts_vector);

-- JSONB field queries (e.g. find by email)
CREATE INDEX idx_nodes_data ON nodes USING gin(data);

-- Activity feed
CREATE INDEX idx_activities_node ON activities(node_id, created_at DESC);
CREATE INDEX idx_activities_workspace ON activities(workspace_id, created_at DESC);

-- Edges
CREATE INDEX idx_edges_from ON edges(from_node_id);
CREATE INDEX idx_edges_to ON edges(to_node_id);
```

### Row-Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_jobs ENABLE ROW LEVEL SECURITY;

-- Helper function: get workspace IDs for current user
CREATE OR REPLACE FUNCTION get_user_workspace_ids()
RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.jwt() ->> 'sub'
  )
$$ LANGUAGE SQL SECURITY DEFINER;

-- RLS policies
CREATE POLICY "workspace_isolation_nodes" ON nodes
  FOR ALL USING (workspace_id = ANY(get_user_workspace_ids()));

CREATE POLICY "workspace_isolation_edges" ON edges
  FOR ALL USING (workspace_id = ANY(get_user_workspace_ids()));

CREATE POLICY "workspace_isolation_activities" ON activities
  FOR ALL USING (workspace_id = ANY(get_user_workspace_ids()));
```

### Embedding trigger (External Consistency — DO NOT make async)

```sql
-- This trigger fires synchronously on every node write
-- It calls an edge function to generate + store the embedding
CREATE OR REPLACE FUNCTION trigger_embedding_sync()
RETURNS TRIGGER AS $$
DECLARE
  text_content TEXT;
BEGIN
  -- Build searchable text from node data
  text_content := NEW.object_type || ' ' ||
    COALESCE(NEW.data->>'name', '') || ' ' ||
    COALESCE(NEW.data->>'email', '') || ' ' ||
    COALESCE(NEW.data->>'description', '') || ' ' ||
    COALESCE(NEW.ai_summary, '');

  -- Update FTS vector synchronously
  NEW.fts_vector := to_tsvector('english', text_content);
  NEW.updated_at := now();

  -- Queue embedding update (near-sync via Inngest)
  PERFORM net.http_post(
    url := current_setting('app.inngest_url', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := json_build_object(
      'name', 'mondaily/embedding.sync',
      'data', json_build_object('node_id', NEW.id, 'text', text_content)
    )::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER embedding_sync_trigger
  BEFORE INSERT OR UPDATE ON nodes
  FOR EACH ROW EXECUTE FUNCTION trigger_embedding_sync();
```

### Hybrid search function

```sql
CREATE OR REPLACE FUNCTION search_nodes(
  p_workspace_id  UUID,
  p_query_text    TEXT,
  p_query_vector  vector(1536),
  p_verticals     TEXT[] DEFAULT NULL,
  p_object_types  TEXT[] DEFAULT NULL,
  p_limit         INT DEFAULT 20
)
RETURNS TABLE (id UUID, vertical TEXT, object_type TEXT, data JSONB,
               ai_summary TEXT, score FLOAT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id, n.vertical, n.object_type, n.data, n.ai_summary,
    -- RRF: 70% semantic + 30% keyword
    (0.7 * (1 - (n.embedding <=> p_query_vector)) +
     0.3 * ts_rank(n.fts_vector, plainto_tsquery('english', p_query_text))) AS score
  FROM nodes n
  WHERE n.workspace_id = p_workspace_id
    AND (p_verticals IS NULL OR n.vertical = ANY(p_verticals))
    AND (p_object_types IS NULL OR n.object_type = ANY(p_object_types))
    AND n.embedding IS NOT NULL
  ORDER BY score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

---

## UBC Client (packages/db/src/ubc.ts)

```typescript
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export const NodeSchema = z.object({
  id: z.string().uuid().optional(),
  workspace_id: z.string().uuid(),
  vertical: z.enum(['sales','realestate','hr','finance','investments','tasks']),
  object_type: z.string(),
  data: z.record(z.unknown()),
  ai_summary: z.string().optional(),
  created_by: z.string().optional(),
})
export type Node = z.infer<typeof NodeSchema>

export async function createNode(input: Omit<Node, 'id'>): Promise<Node> {
  const validated = NodeSchema.omit({ id: true }).parse(input)
  const { data, error } = await supabase
    .from('nodes')
    .insert(validated)
    .select()
    .single()
  if (error) throw new Error(`createNode failed: ${error.message}`)
  return data as Node
}

export async function updateNode(
  id: string,
  updates: Partial<Pick<Node, 'data' | 'ai_summary'>>
): Promise<Node> {
  const { data, error } = await supabase
    .from('nodes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`updateNode failed: ${error.message}`)
  return data as Node
}

export async function getNode(id: string): Promise<Node | null> {
  const { data } = await supabase
    .from('nodes').select('*').eq('id', id).single()
  return data as Node | null
}

export async function searchNodes(
  workspaceId: string,
  query: string,
  options?: { verticals?: string[]; objectTypes?: string[]; limit?: number }
): Promise<Node[]> {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: query,
  })
  const queryVector = embeddingResponse.data[0].embedding

  const { data, error } = await supabase.rpc('search_nodes', {
    p_workspace_id: workspaceId,
    p_query_text: query,
    p_query_vector: queryVector,
    p_verticals: options?.verticals ?? null,
    p_object_types: options?.objectTypes ?? null,
    p_limit: options?.limit ?? 20,
  })
  if (error) throw new Error(`searchNodes failed: ${error.message}`)
  return data as Node[]
}

export async function createEdge(
  workspaceId: string,
  fromNodeId: string,
  toNodeId: string,
  relationship: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('edges').insert({
    workspace_id: workspaceId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    relationship,
    metadata: metadata ?? {},
  })
  if (error) throw new Error(`createEdge failed: ${error.message}`)
}

export async function getRelated(
  nodeId: string,
  relationship?: string
): Promise<Node[]> {
  let query = supabase
    .from('edges')
    .select('to_node_id, nodes!edges_to_node_id_fkey(*)')
    .eq('from_node_id', nodeId)
  if (relationship) query = query.eq('relationship', relationship)
  const { data, error } = await query
  if (error) throw new Error(`getRelated failed: ${error.message}`)
  return (data?.map((e: any) => e.nodes) ?? []) as Node[]
}

export async function logActivity(
  nodeId: string,
  workspaceId: string,
  actorType: 'human' | 'ai_agent' | 'integration' | 'system',
  actorId: string,
  action: string,
  diff?: Record<string, unknown>,
  aiSummary?: string
): Promise<void> {
  const { error } = await supabase.from('activities').insert({
    node_id: nodeId,
    workspace_id: workspaceId,
    actor_type: actorType,
    actor_id: actorId,
    action,
    diff: diff ?? null,
    ai_summary: aiSummary ?? null,
  })
  if (error) throw new Error(`logActivity failed: ${error.message}`)
}
```

---

## Agent Pattern (how ALL agents are built)

Every agent in Mondaily follows this exact pattern. Do not deviate.

```typescript
// packages/agents/src/[vertical]/agent.ts
import { streamText, tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import * as tools from '../../tools/src/records'

const systemPrompt = readFileSync(
  join(__dirname, '../../../prompts/sales-agent.md'),
  'utf-8'
)

export async function runSalesAgent(input: {
  workspaceId: string
  task: string
  context?: Record<string, unknown>
}) {
  const result = await streamText({
    model: anthropic('claude-opus-4'),
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Workspace: ${input.workspaceId}\nTask: ${input.task}\n${
          input.context ? `Context: ${JSON.stringify(input.context)}` : ''
        }`,
      },
    ],
    tools: {
      searchRecords: tool({
        description: 'Search for any records in the CRM using natural language',
        parameters: z.object({
          query: z.string().describe('Natural language search query'),
          verticals: z.array(z.string()).optional(),
          limit: z.number().default(10),
        }),
        execute: async ({ query, verticals, limit }) =>
          tools.searchNodes(input.workspaceId, query, { verticals, limit }),
      }),
      updateRecord: tool({
        description: 'Update fields on a record',
        parameters: z.object({
          nodeId: z.string().uuid(),
          updates: z.record(z.unknown()),
          reason: z.string().describe('Why this update is being made'),
        }),
        execute: async ({ nodeId, updates, reason }) => {
          const node = await tools.updateNode(nodeId, { data: updates })
          await tools.logActivity(nodeId, input.workspaceId, 'ai_agent',
            'sales-agent', 'updated', updates, reason)
          return node
        },
      }),
    },
    maxSteps: 20,
  })

  return result
}
```

---

## Vertical Schemas

### Sales

```typescript
// packages/verticals/sales/schema.ts
import { z } from 'zod'

export const ContactSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  company_id: z.string().uuid().optional(),
  linkedin: z.string().url().optional(),
  lead_score: z.number().min(0).max(100).optional(),
  icp_fit: z.enum(['strong','moderate','weak','unknown']).default('unknown'),
  last_contacted: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  ai_summary: z.string().optional(),
  buying_signals: z.array(z.string()).default([]),
  communication_style: z.string().optional(),
})

export const DealSchema = z.object({
  name: z.string(),
  company_id: z.string().uuid(),
  contact_ids: z.array(z.string().uuid()).default([]),
  stage: z.enum(['lead','qualified','proposal','negotiation','closed_won','closed_lost']),
  value: z.number().optional(),
  currency: z.string().default('USD'),
  probability: z.number().min(0).max(100).optional(),
  close_date: z.string().datetime().optional(),
  ai_health_score: z.number().min(0).max(100).optional(),
  ai_risk_flags: z.array(z.string()).default([]),
  next_action: z.string().optional(),
})
```

### Real Estate

```typescript
// packages/verticals/realestate/schema.ts
export const PropertySchema = z.object({
  address: z.string(),
  city: z.string(),
  postcode: z.string(),
  country: z.string().default('GB'),
  type: z.enum(['residential','commercial','industrial','land']),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  size_sqft: z.number().optional(),
  purchase_price: z.number().optional(),
  current_valuation: z.number().optional(),
  monthly_rent: z.number().optional(),
  owner_id: z.string().uuid().optional(),
  status: z.enum(['available','let','under_offer','sold','maintenance']),
  lease_expiry: z.string().datetime().optional(),
  epc_rating: z.enum(['A','B','C','D','E','F','G']).optional(),
  last_inspection: z.string().datetime().optional(),
  ai_roi_estimate: z.number().optional(),
  compliance_flags: z.array(z.string()).default([]),
})
```

### HR

```typescript
// packages/verticals/hr/schema.ts
export const EmployeeSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  department: z.string(),
  manager_id: z.string().uuid().optional(),
  start_date: z.string().datetime(),
  salary: z.number().optional(),
  currency: z.string().default('GBP'),
  contract_type: z.enum(['permanent','fixed_term','contractor','intern']),
  skills: z.array(z.string()).default([]),
  performance_score: z.number().min(1).max(5).optional(),
  engagement_score: z.number().min(0).max(100).optional(),
  review_date: z.string().datetime().optional(),
  ai_sentiment: z.enum(['positive','neutral','at_risk']).optional(),
})

export const CandidateSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role_applied: z.string(),
  cv_url: z.string().url().optional(),
  stage: z.enum(['applied','screening','interview','offer','hired','rejected']),
  ai_score: z.number().min(0).max(100).optional(),
  ai_strengths: z.array(z.string()).default([]),
  ai_concerns: z.array(z.string()).default([]),
  source: z.string().optional(),
})
```

### Finance

```typescript
// packages/verticals/finance/schema.ts
export const InvoiceSchema = z.object({
  number: z.string(),
  client_id: z.string().uuid(),
  deal_id: z.string().uuid().optional(),
  line_items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    tax_rate: z.number().default(0),
  })),
  subtotal: z.number(),
  tax_total: z.number(),
  total: z.number(),
  currency: z.string().default('GBP'),
  status: z.enum(['draft','sent','viewed','paid','overdue','cancelled']),
  due_date: z.string().datetime(),
  sent_at: z.string().datetime().optional(),
  paid_at: z.string().datetime().optional(),
  chase_count: z.number().default(0),
  ai_payment_prediction: z.enum(['likely_on_time','at_risk','likely_late']).optional(),
})
```

### Investments

```typescript
// packages/verticals/investments/schema.ts
export const PortfolioCompanySchema = z.object({
  name: z.string(),
  domain: z.string().optional(),
  sector: z.string(),
  stage: z.enum(['pre_seed','seed','series_a','series_b','series_c','growth','public']),
  investment_date: z.string().datetime(),
  investment_amount: z.number(),
  currency: z.string().default('USD'),
  equity_percentage: z.number().optional(),
  current_valuation: z.number().optional(),
  irr: z.number().optional(),
  moic: z.number().optional(),
  status: z.enum(['active','exited','written_off','ipo']),
  ai_health_signal: z.enum(['strong','stable','watch','critical']).optional(),
  covenant_flags: z.array(z.string()).default([]),
  next_board_date: z.string().datetime().optional(),
})
```

---

## Agent System Prompts (what to put in each .md file)

### prompts/sales-agent.md

```markdown
You are Mondaily's Sales Agent — an autonomous AI sales representative.

Your role:
- Qualify and research leads automatically
- Monitor deal health and flag risks proactively
- Draft personalized outreach using company news and interaction history
- Update CRM records with insights from every interaction
- Run sequences and follow-ups without human prompting

You have access to:
- searchRecords: find any contact, company, or deal
- updateRecord: update any field (always log a reason)
- sendEmail: draft and send emails via Nylas
- webResearch: research companies and people via Tavily
- enrichContact: fetch enrichment data from Apollo
- logActivity: record what you did and why
- getActivities: read the full history of any record

Rules:
- ALWAYS log your actions with a clear reason
- NEVER send emails without confidence_score > 0.85
- When in doubt, escalate to human with a draft for review
- Personalize every outreach — never use generic templates
- Update deal stage only when there is evidence from an interaction
```

---

## API Routes Pattern

```typescript
// packages/api/src/routes/nodes.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireWorkspace } from '../middleware/auth'
import * as ubc from '@mondaily/db/ubc'

const router = new Hono()

router.get('/:id', requireAuth, requireWorkspace, async (c) => {
  const node = await ubc.getNode(c.req.param('id'))
  if (!node) return c.json({ error: 'Not found' }, 404)
  return c.json(node)
})

router.post('/',
  requireAuth,
  requireWorkspace,
  zValidator('json', z.object({
    vertical: z.enum(['sales','realestate','hr','finance','investments']),
    object_type: z.string(),
    data: z.record(z.unknown()),
  })),
  async (c) => {
    const body = c.req.valid('json')
    const node = await ubc.createNode({
      workspace_id: c.get('workspaceId'),
      created_by: c.get('userId'),
      ...body,
    })
    return c.json(node, 201)
  }
)

router.post('/search',
  requireAuth,
  requireWorkspace,
  zValidator('json', z.object({
    query: z.string().min(1),
    verticals: z.array(z.string()).optional(),
    object_types: z.array(z.string()).optional(),
    limit: z.number().max(50).default(20),
  })),
  async (c) => {
    const { query, verticals, object_types, limit } = c.req.valid('json')
    const results = await ubc.searchNodes(c.get('workspaceId'), query, {
      verticals, objectTypes: object_types, limit
    })
    return c.json(results)
  }
)

export { router as nodesRouter }
```

---

## Inngest Jobs (agent scheduling)

```typescript
// packages/api/src/inngest/proactive-scans.ts
import { inngest } from './client'
import { runSalesAgent } from '@mondaily/agents/sales'
import { supabase } from '@mondaily/db'

export const stalledDealsCheck = inngest.createFunction(
  { id: 'stalled-deals-check', name: 'Check for stalled deals' },
  { cron: '0 * * * *' },
  async ({ step }) => {
    const { data: workspaces } = await step.run('get-workspaces', async () =>
      supabase.from('workspaces')
        .select('id')
        .in('plan', ['pro', 'enterprise'])
    )

    await step.sendEvent('dispatch-agents', workspaces!.map(w => ({
      name: 'mondaily/sales.check-stalled-deals',
      data: { workspaceId: w.id },
    })))
  }
)

export const handleStalledDeals = inngest.createFunction(
  { id: 'handle-stalled-deals', concurrency: { limit: 10 } },
  { event: 'mondaily/sales.check-stalled-deals' },
  async ({ event, step }) => {
    const { workspaceId } = event.data

    const stalledDeals = await step.run('find-stalled-deals', async () => {
      const { data } = await supabase.from('nodes')
        .select('id, data')
        .eq('workspace_id', workspaceId)
        .eq('object_type', 'deal')
        .not('data->>stage', 'in', '("closed_won","closed_lost")')
      return data
    })

    if (!stalledDeals?.length) return { message: 'No stalled deals' }

    for (const deal of stalledDeals) {
      await step.run(`analyze-deal-${deal.id}`, async () => {
        await runSalesAgent({
          workspaceId,
          task: `Analyze the stalled deal "${deal.data.name}" and draft a re-engagement strategy. Check the last interactions, research the company for recent news, and prepare a personalized follow-up message for human review.`,
          context: { dealId: deal.id },
        })
      })
    }

    return { processed: stalledDeals.length }
  }
)
```

---

## Environment Variables

```bash
# .env.example — copy to .env.local

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...  # server-side only, never expose to client

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...         # for embeddings only

# Email
RESEND_API_KEY=re_...
NYLAS_CLIENT_ID=...
NYLAS_CLIENT_SECRET=...
NYLAS_API_KEY=...

# Queue
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...

# Cache
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Storage
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY=...
CLOUDFLARE_R2_SECRET_KEY=...
CLOUDFLARE_R2_BUCKET=mondaily-files

# Enrichment & research
APOLLO_API_KEY=...
TAVILY_API_KEY=tvly-...
CLEARBIT_API_KEY=...

# Finance
PLAID_CLIENT_ID=...
PLAID_SECRET=...

# Monitoring
SENTRY_DSN=https://...
POSTHOG_KEY=phc_...
AXIOM_API_KEY=...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_DOMAIN=app.mondaily.com
```

---

## Coding Rules for AI Codex (enforce these in every session)

1. **Every node write MUST call logActivity** — no silent mutations
2. **Embeddings are synchronous** — the trigger handles it, never queue manually
3. **All tool arguments use Zod schemas** — no untyped tool calls
4. **All API routes use zValidator** — never trust raw req.body
5. **RLS handles workspace isolation** — never add extra workspace_id WHERE clauses in app code
6. **Agent errors are caught and stored in agent_jobs** — never crash silently
7. **Stream all LLM responses** — never await a complete response before rendering
8. **Prompts live in .md files** — never hardcode system prompts in TypeScript
9. **No Pinecone, no Weaviate, no Chroma** — pgvector only for External Consistency
10. **All money values are integers (cents/pence)** — never store floats for currency

---

## Security Rules — Multi-Tenant Isolation (NEVER violate these)

These rules are permanent. Every new table, route, and feature must follow them.

### Authentication
- **ALWAYS verify JWT signatures** using `clerk.verifyToken(token)` from `@clerk/backend`
- **NEVER** base64-decode a JWT and trust it without cryptographic verification
- **NEVER** add demo tokens, backdoor strings, or hardcoded user IDs in auth middleware
- The `requireAuth` middleware in `packages/api/src/middleware/auth.ts` handles this — use it on every router with `router.use("*", requireAuth)`

### Workspace Isolation (Client A vs Client B)
- After verifying the JWT, **always verify workspace membership** by querying `workspace_members` with `(workspace_id, user_id)`
- If the user is not in `workspace_members` for the claimed workspace → return 403
- The `workspaceId` set on context comes from this verified query, never blindly from a header
- At the database layer, RLS on every table enforces this as a second line of defence
- **Every new table MUST have RLS enabled** — run `ALTER TABLE x ENABLE ROW LEVEL SECURITY` and create appropriate policies in a new migration file before the table is used

### Role-Based Access Control (Member vs Admin)
- The user's `role` is read from `workspace_members.role` — never hardcoded
- Roles: `owner` > `admin` > `member` > `viewer`
- Use `requireAdmin` middleware (also in `auth.ts`) on any route that destroys data, manages members, or changes workspace settings
- Members can only see their own tasks/assignments — API routes must filter by `assignee_id = userId` or `created_by = userId` when `role = 'member'`
- Admins and owners see all records in the workspace

### New Table Checklist (run this every time)
When adding a new database table, you MUST:
1. Add `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` as a column
2. In a migration: `ALTER TABLE new_table ENABLE ROW LEVEL SECURITY`
3. Add a policy: `CREATE POLICY new_table_workspace ON new_table FOR ALL USING (workspace_id = ANY(get_user_workspace_ids()))`
4. If the table is user-personal (like notifications), also add `AND user_id = auth.jwt() ->> 'sub'`
5. If delete should be admin-only, split into separate SELECT/INSERT/UPDATE/DELETE policies

### Encryption in Transit
- All API calls go through HTTPS — Vercel enforces this, never allow HTTP in production
- Supabase connection always uses the `https://` URL — never the direct Postgres connection string on the client side
- `SUPABASE_SERVICE_KEY` is server-only — never expose it to the browser or commit it to git
- All secrets live in Vercel environment variables — never in code or `.env` files committed to the repo

---

## First Build Sequence for Codex

Give these tasks to Claude Code in this exact order:

### Task 1 — Monorepo foundation
"Set up the Mondaily Turborepo monorepo with pnpm workspaces. Create the folder
structure defined in MONDAILY.md. Initialize packages: api (Hono), db, agents, tools,
prompts, verticals, shared. Set up TypeScript configs, ESLint, Prettier, and a root
turbo.json. Do not implement any features yet — just the skeleton."

### Task 2 — Database
"Using MONDAILY.md, implement the full Supabase database schema. Create migrations
in supabase/migrations/ for: (1) all tables with correct types and constraints,
(2) all indexes, (3) RLS policies, (4) the embedding sync trigger, (5) the
hybrid search function. Also implement packages/db/src/ubc.ts exactly as specified."

### Task 3 — Auth + API foundation
"Implement Clerk authentication middleware for the Hono API. Create the auth
middleware in packages/api/src/middleware/auth.ts that validates Clerk JWTs,
extracts workspace_id, and attaches to context. Then implement the /nodes
and /search routes as specified in MONDAILY.md."

### Task 4 — Sales vertical (first feature)
"Implement the full sales vertical: Contact and Company and Deal schemas in
packages/verticals/sales/schema.ts, the sales agent in packages/agents/src/sales/agent.ts
with all tools wired up from packages/tools/, and the system prompt in
packages/prompts/sales-agent.md. The agent must be able to: search records,
update records, draft emails, research companies via Tavily, and log all actions."

### Task 5 — Ask Mondaily
"Implement Ask Mondaily in packages/agents/src/ask-mondaily.ts. It receives a
natural language message and workspace_id, plans the steps needed, calls the
appropriate specialist agents or tools, and streams the response. Wire it to
POST /api/v1/ask. The response must stream via Vercel AI SDK streamText()."

---

*End of MONDAILY.md — version 1.0 — update this file as the architecture evolves*
