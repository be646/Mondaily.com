-- 0017_project_log.sql
-- A living, database-backed project log powering the Status page's
-- "Recent updates" (kind='update') and "What's next" (kind='roadmap')
-- sections in real time — replacing the previously hardcoded arrays so the
-- record of what we've done and what's left is always current and persistent.

create table if not exists project_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('update', 'roadmap')),
  title       text not null,
  detail      text,
  -- update: free-text area; roadmap: tier (must_fix | should_improve | future)
  category    text,
  -- update: shipped | pending_deploy | needs_migration | needs_setup
  -- roadmap: todo | in_progress | done
  status      text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists project_log_kind_idx on project_log (kind, sort_order);

-- Server reads/writes via the service-role key (RLS bypassed there); the
-- frontend only goes through the API, never Supabase directly.
alter table project_log enable row level security;

-- Re-runnable: clear any prior seed, then insert fresh.
delete from project_log;

insert into project_log (kind, title, detail, category, status, sort_order, created_at, completed_at) values
  ('update', 'Live, database-backed project log on Status page',
   'Recent updates and What''s next are now read live from this table instead of hardcoded text — a persistent record of what shipped and what''s left.',
   'Status page, /api/v1/status/log', 'shipped', 1, now(), now()),
  ('update', 'Run now button for agents',
   'Relationship, Operations, Finance, and Graph Enrichment can be triggered on demand from the Home agent panel, showing a live result summary.',
   'apps/app agent constellation, POST /api/v1/agents/:id/run', 'shipped', 2, now(), now()),
  ('update', 'Agents fixed: object-type matching',
   'Agents matched exact type names (person/company) but the workspace uses people/contact-leads/companies, so Relationship scored 0 of 250+ records. Now matches by stem; scored 262 real records.',
   'packages/api/src/jobs/runners.ts', 'shipped', 3, now(), now()),
  ('update', 'Background agents run via Vercel Cron and on-demand',
   'Extracted every job into modular runners driven by Inngest, a daily Vercel Cron (/api/cron/daily), and on-demand routes — no extra account needed.',
   'jobs/runners.ts, app.ts, vercel.json', 'shipped', 4, now(), now()),
  ('update', 'Chat / Ask AI fixed — running on Cerebras',
   'Migrated the AI gateway to Cerebras gpt-oss-120b (fast, free, zero Anthropic dependency) and handled its reasoning-model output so answers populate correctly.',
   'packages/api/src/lib/ai-gateway.ts', 'shipped', 5, now(), now()),
  ('update', 'Home rebuilt as an AI control room',
   'Radial agent map, unified attention stream, and command-room band replace the old card-grid dashboard.',
   'Home, Agent Constellation, Command Center', 'shipped', 6, timestamptz '2026-06-21', timestamptz '2026-06-21'),
  ('update', 'Prospecting Agent shipped',
   'Web-search-backed candidate discovery with dedupe and Decision Queue approval.',
   'routes/prospecting.ts, Ask tool, Lists', 'shipped', 7, timestamptz '2026-06-21', timestamptz '2026-06-21'),
  ('update', 'Decision Queue and Agent Registry',
   'Real approve/reject/snooze flow backing every agent''s needs-approval state.',
   'decision_queue, /api/v1/agents, /api/v1/decisions', 'shipped', 8, timestamptz '2026-06-19', timestamptz '2026-06-19'),

  ('roadmap', 'Build /api/v1/billing/portal and /checkout',
   'The billing UI links to routes that don''t exist yet — they will 404 until built (needs Stripe wiring).',
   'must_fix', 'todo', 10, now(), null),
  ('roadmap', 'Fix signup onboarding redirect',
   'Email verification routes new users back to /sign-in instead of onboarding — blocks new signups.',
   'must_fix', 'todo', 11, now(), null),
  ('roadmap', 'Set CRON_SECRET and rotate exposed Cerebras key',
   'Lock the public cron endpoint and rotate the Cerebras key that was shared in plain text.',
   'must_fix', 'todo', 12, now(), null),
  ('roadmap', 'Confirm background jobs running in production',
   'Resolved: Inngest fires daily and a Vercel Cron fallback runs the same jobs; agents verified acting on real data.',
   'must_fix', 'done', 13, now(), now()),

  ('roadmap', 'Re-enrichment on demand',
   'Done: Graph Enrichment can now be re-run for a whole workspace via the Run button, not just on record creation.',
   'should_improve', 'done', 20, now(), now()),
  ('roadmap', 'Auto-detect updates from deploy/commit metadata',
   'The log is now DB-backed and live; auto-populating it from git/deploy metadata is still a future improvement.',
   'should_improve', 'todo', 21, now(), null),
  ('roadmap', 'MCP server for third-party AI clients',
   'Expose the workspace graph to external AI clients via an MCP server.',
   'should_improve', 'todo', 22, now(), null),

  ('roadmap', 'Workflow Agent execution engine',
   'Real trigger / condition / action engine so saved workflows actually run autonomously (currently design and CRUD only).',
   'future', 'todo', 30, now(), null),
  ('roadmap', 'Vertical agents: Opportunity, People, Portfolio, Asset',
   'Code scaffolds exist but no live jobs — build real implementations.',
   'future', 'todo', 31, now(), null),
  ('roadmap', 'Deal-stage-triggered quote drafting (Finance Agent)',
   'Auto-draft a quote when a deal reaches a configured stage.',
   'future', 'todo', 32, now(), null),
  ('roadmap', 'Voice input for Ask Mondaily',
   'Enable the currently-disabled mic for spoken questions.',
   'future', 'todo', 33, now(), null);
-- (created_at present on every row — all VALUES tuples are 8 columns)
