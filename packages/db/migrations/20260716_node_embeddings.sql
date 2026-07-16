-- Sovereign vector search — pgvector index of workspace records for true semantic (embedding)
-- retrieval. DORMANT until SOVEREIGN_EMBED_URL is set on the API and a reindex is run; the app
-- falls back to LLM-rerank search until then, so applying this migration is safe on its own.
--
-- Dimension 384 matches BAAI/bge-small-en-v1.5 (the model the runbook standardizes on). If you
-- run a different embedding model, change vector(384) to its dimension BEFORE reindexing.

create extension if not exists vector;

create table if not exists node_embeddings (
  node_id      uuid primary key references nodes(id) on delete cascade,
  workspace_id uuid not null,
  content      text,                       -- the text that was embedded (for debugging / re-embed)
  embedding    vector(384) not null,
  updated_at   timestamptz not null default now()
);

create index if not exists node_embeddings_ws_idx on node_embeddings (workspace_id);

-- NOTE ON THE VECTOR INDEX: for up to tens of thousands of rows per workspace, EXACT nearest-
-- neighbour (a plain scan ordered by <=>) is sub-millisecond and 100% accurate, so we intentionally
-- do NOT create an approximate (ivfflat) index — ivfflat only probes a few clusters and tanks
-- recall at small scale (it made an obvious match rank outside the top-k). When a workspace grows
-- past ~100k records and exact scans get slow, add an HNSW index (good recall AND speed):
--   create index node_embeddings_hnsw on node_embeddings using hnsw (embedding vector_cosine_ops);

-- Nearest-neighbour search within a workspace. Returns node_id + cosine similarity (1 = identical).
create or replace function match_node_embeddings(ws uuid, query_embedding vector(384), k int)
returns table (node_id uuid, similarity float)
language sql stable as $$
  select ne.node_id, 1 - (ne.embedding <=> query_embedding) as similarity
  from node_embeddings ne
  where ne.workspace_id = ws
  order by ne.embedding <=> query_embedding
  limit k
$$;
