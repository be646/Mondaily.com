-- Sovereign-inference shadow evaluation ledger.
-- METADATA ONLY by contract: latencies, token counts, output lengths, and a similarity score.
-- Prompts and responses are NEVER stored here — the comparison is computed in memory and the
-- texts are discarded. Shadow runs never meter credits (they are evaluation, not product usage).

create table if not exists inference_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  created_at timestamptz not null default now(),
  task_class text,
  feature text,
  primary_model text not null,
  primary_latency_ms int,
  primary_tokens int,
  primary_chars int,
  shadow_model text not null,
  shadow_ok boolean not null default false,
  shadow_latency_ms int,
  shadow_tokens int,
  shadow_chars int,
  -- word-set Jaccard similarity between primary and shadow outputs, 0-100 (crude but honest,
  -- computed in memory; texts discarded)
  similarity_pct int,
  error text
);
create index if not exists inference_shadow_ws_idx on inference_shadow_runs (workspace_id, created_at desc);
create index if not exists inference_shadow_class_idx on inference_shadow_runs (task_class, created_at desc);
