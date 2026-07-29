-- Cross-type duplicate detection — the read side of the data-cleaning tool.
--
-- WHY: the existing DedupPanel only ever compares records WITHIN one object type, and only by exact
-- match after normalisation. It therefore cannot see the workspace's real problem: near-duplicate
-- object TYPES holding overlapping records — `person` (568) vs `people` (138), `contacts` (14) vs
-- `contact-leads` (117). Ask can now say which type it queried, but nobody can see how much the
-- types overlap, so nobody can decide which is authoritative.
--
-- Both functions are STABLE and read-only. Nothing here merges, deletes, or writes.

-- ── 1. Deterministic overlap: records that share a normalised email / phone / name ──────────────
-- Runs with NO embeddings, so it works before (or without) a vector reindex. This is the
-- high-confidence signal — two records sharing an email are the same entity far more reliably than
-- two records that merely read similarly.
create or replace function cross_type_key_overlap(ws uuid, type_a text, type_b text, max_pairs int default 500)
returns table (a_id uuid, b_id uuid, match_key text, match_value text)
language sql stable as $$
  with norm as (
    select
      n.id, n.object_type,
      nullif(lower(trim(coalesce(n.data->>'email', n.data->>'Email', n.data->>'email_address', ''))), '') as email,
      nullif(regexp_replace(coalesce(n.data->>'phone', n.data->>'Phone', n.data->>'phone_number', n.data->>'mobile', ''), '[^0-9]', '', 'g'), '') as phone,
      nullif(lower(regexp_replace(coalesce(n.data->>'name', n.data->>'Name', n.data->>'full_name', n.data->>'company_name', ''), '[^a-z0-9]', '', 'gi')), '') as name
    from nodes n
    where n.workspace_id = ws and n.object_type in (type_a, type_b)
  ),
  a as (select * from norm where object_type = type_a),
  b as (select * from norm where object_type = type_b)
  select a.id, b.id, 'email'::text, a.email from a join b on a.email = b.email
  union all
  -- 7+ digits: shorter strings are extensions or partials and produce false pairs
  select a.id, b.id, 'phone'::text, a.phone from a join b on a.phone = b.phone and length(a.phone) >= 7
  union all
  -- 4+ chars: guards against "n/a", initials and other collapsed junk matching everything
  select a.id, b.id, 'name'::text,  a.name  from a join b on a.name  = b.name  and length(a.name) >= 4
  limit max_pairs
$$;

-- ── 2. Semantic overlap: pairs whose embeddings are close ──────────────────────────────────────
-- Catches what exact matching cannot — "Jon Smith"/"John Smith", "Acme Inc"/"Acme Incorporated".
-- Done as ONE pairwise join in the database rather than a nearest-neighbour call per record, which
-- would be thousands of round-trips. Exact cosine (no ANN index) so recall is 100% at this scale;
-- see the note in 20260701_node_embeddings.sql about adding HNSW past ~100k rows.
create or replace function cross_type_semantic_overlap(
  ws uuid, type_a text, type_b text, min_similarity float default 0.92, max_pairs int default 200
)
returns table (a_id uuid, b_id uuid, similarity float)
language sql stable as $$
  select ea.node_id, eb.node_id, 1 - (ea.embedding <=> eb.embedding) as similarity
  from node_embeddings ea
  join nodes na on na.id = ea.node_id and na.object_type = type_a and na.workspace_id = ws
  join node_embeddings eb on eb.workspace_id = ea.workspace_id and eb.node_id <> ea.node_id
  join nodes nb on nb.id = eb.node_id and nb.object_type = type_b and nb.workspace_id = ws
  where ea.workspace_id = ws
    and 1 - (ea.embedding <=> eb.embedding) >= min_similarity
  order by similarity desc
  limit max_pairs
$$;

-- Supports the object_type filters both functions lean on.
create index if not exists nodes_ws_object_type_idx on nodes (workspace_id, object_type);

-- ── 3. Exact per-type counts, in SQL ───────────────────────────────────────────────────────────
-- The alternative is selecting every row and counting in JS, which PostgREST silently truncates
-- past ~1000 rows — the bug that made the credit wallet report noise and Ask under-report totals.
-- A cleaning tool whose own counts are wrong is worse than no tool.
create or replace function object_type_counts(ws uuid)
returns table (object_type text, n bigint)
language sql stable as $$
  select n.object_type, count(*)::bigint
  from nodes n
  where n.workspace_id = ws and n.object_type is not null
  group by n.object_type
  order by count(*) desc
$$;
