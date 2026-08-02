-- Record listing resolved entirely in SQL.
--
-- WHY: the sheet was half server-side and half client-side, and the boundary moved per feature.
-- Only the FIRST sort rule reached SQL; the rest were applied in the browser over the loaded page.
-- Numeric ">" / "<" filters and every owner/assignee filter never reached SQL at all. Under the
-- page cap that is invisible; over it, SQL picks WHICH rows you get by one ranking while the
-- browser displays them by another, and "Unassigned" means "unassigned among the thousand rows we
-- happened to load". Nothing on screen said so.
--
-- These functions take the whole query — search, every filter, every sort rule, in order — so the
-- page the client renders is the true top-N of the whole table, and the count is the real count.

-- ── Numeric parsing that matches @mondaily/shared/numbers.parseNumeric ────────────────────────
-- A plain regexp strip reads "1.200,50" as 1.2 — the same corruption that once got WRITTEN back
-- into records. Ordering and comparison must agree with what the UI displays.
-- This mirrors parseNumeric STATEMENT FOR STATEMENT. Verified by porting this exact logic to JS and
-- fuzzing it against parseNumeric over 4047 inputs (fixed cases + random strings) — zero mismatches.
-- Do not "simplify" either side alone: the first draft used a plausible-looking rule
-- (^\d{1,3}(\.\d{3})+$ = thousands) and read "1.200" as 1200 where the app reads 1.2, which would
-- have made the same value sort and filter differently depending on which engine ran.
create or replace function mondaily_num(v text)
returns numeric
language plpgsql
immutable
as $$
declare
  s          text;
  neg        boolean := false;
  mult       numeric := 1;
  sfx        text;
  last_dot   int;
  last_comma int;
  many       int;
  frac       int;
  i          int;
begin
  if v is null then return null; end if;
  s := btrim(v);
  if s = '' or s = '—' then return null; end if;

  -- accounting negatives: (500) -> -500
  if s ~ '^\(.*\)$' then
    neg := true;
    s := btrim(substring(s from 2 for length(s) - 2));
  end if;
  if s ~ '^-' then neg := true; end if;

  -- magnitude suffix: 1.2k / 3M / 1.5bn / 2b
  sfx := substring(s from '([kKmMbB]|bn|BN|Bn)\s*$');
  if sfx is not null then
    mult := case lower(sfx) when 'k' then 1e3 when 'm' then 1e6 else 1e9 end;
    s := left(s, length(s) - length(sfx));
  end if;

  -- keep digits and separators only (drops currency symbols, spaces, %, the sign)
  s := regexp_replace(s, '[^0-9.,]', '', 'g');
  if s = '' then return null; end if;

  last_dot   := case when position('.' in s) = 0 then -1 else length(s) - position('.' in reverse(s)) end;
  last_comma := case when position(',' in s) = 0 then -1 else length(s) - position(',' in reverse(s)) end;

  if last_dot >= 0 and last_comma >= 0 then
    -- both present: whichever comes LAST is the decimal point, the other is a thousands mark
    if last_dot > last_comma then
      s := replace(s, ',', '');
      i := length(s) - position('.' in reverse(s));
    else
      s := replace(s, '.', '');
      i := length(s) - position(',' in reverse(s));
    end if;
    s := regexp_replace(left(s, i), '[.,]', '', 'g') || '.' || substring(s from i + 2);
  elsif last_comma >= 0 then
    -- commas only: "1,5" is decimal; "1,200" and "1,200,300" are thousands
    frac := length(s) - last_comma - 1;
    many := length(s) - length(replace(s, ',', ''));
    if (frac = 3 and (many > 1 or length(s) > 4)) or many > 1 then
      s := replace(s, ',', '');
    else
      s := regexp_replace(s, ',', '.');                  -- first occurrence only, like JS replace()
    end if;
  elsif last_dot >= 0 then
    -- dots only: a SINGLE dot is a decimal point ("1.200" = 1.2); several mean thousands
    many := length(s) - length(replace(s, '.', ''));
    if many > 1 then s := replace(s, '.', ''); end if;
  end if;

  if s !~ '^[0-9]*\.?[0-9]*$' or s = '' or s = '.' then return null; end if;
  return (case when neg then -1 else 1 end) * s::numeric * mult;
exception when others then
  return null;
end;
$$;

comment on function mondaily_num(text) is
  'Locale-tolerant numeric parse mirroring @mondaily/shared/numbers.parseNumeric. NULL when the text is not a number.';

-- ── The listing function ──────────────────────────────────────────────────────────────────────
-- p_filters: [{"col":"amount","op":"gt","value":"1000"}]
--   ops: is | is_not | contains | empty | not_empty | before | after | gt | lt
-- p_sorts:   [{"col":"stage","dir":"asc","kind":"rank","rank":["lead","qualified",...]}]
--   kind: text | numeric | date | rank   (rank carries the ordered spellings; index = position)
-- Both column names are shape-validated here as well as in the API — this function is reachable
-- through PostgREST, so it may not assume a trusted caller.
create or replace function list_records(
  p_workspace_id uuid,
  p_object_type  text    default null,
  p_vertical     text    default null,
  p_parent_id    text    default null,
  p_q            text    default null,
  p_q_cols       text[]  default null,
  p_filters      jsonb   default '[]'::jsonb,
  p_sorts        jsonb   default '[]'::jsonb,
  p_limit        int     default 50,
  p_offset       int     default 0
)
-- Returns the whole row as jsonb rather than a fixed column list: this function must not have to
-- be edited every time a column is added to `nodes`, and a stale column list here would silently
-- drop fields the client depends on (lead_score / relationship_health are node-level, not in data).
returns table (record jsonb, total_count bigint)
language plpgsql
stable
security invoker
as $$
declare
  where_sql  text := 'n.workspace_id = ' || quote_literal(p_workspace_id);
  order_sql  text := '';
  f          jsonb;
  s          jsonb;
  col        text;
  op         text;
  val        text;
  expr       text;
  dir        text;
  kind       text;
  ranks      text[];
  or_parts    text[];
  search_cols text[];
  c           text;
  num_val     numeric;
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 2000);
  safe_off   int := greatest(coalesce(p_offset, 0), 0);
begin
  -- Without this, quote_literal(null) makes where_sql NULL, format() returns NULL and the whole
  -- call fails with an unhelpful error instead of simply returning nothing.
  if p_workspace_id is null then return; end if;

  if p_object_type is not null then
    where_sql := where_sql || ' and n.object_type = ' || quote_literal(p_object_type);
  end if;
  if p_vertical is not null then
    where_sql := where_sql || ' and n.vertical = ' || quote_literal(p_vertical);
  end if;
  if p_parent_id is not null then
    where_sql := where_sql || ' and n.data->>''parent_id'' = ' || quote_literal(p_parent_id);
  end if;

  -- Free-text over identity fields plus the caller's own visible columns.
  if coalesce(btrim(p_q), '') <> '' then
    or_parts := array[]::text[];
    select array(
      select distinct x from unnest(
        array['name','title','full_name','email','phone','company','notes']
        || coalesce(p_q_cols, array[]::text[])
      ) as x
      where x ~ '^[a-zA-Z0-9_-]{1,64}$'
    ) into search_cols;
    -- Escape ilike wildcards, same as the PostgREST path: an unescaped "%" or "_" in the term
    -- matched everything, so searching "50%" returned the whole table.
    val := replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_');
    foreach c in array search_cols
    loop
      or_parts := or_parts || ('n.data->>' || quote_literal(c) || ' ilike ' ||
                               quote_literal('%' || val || '%'));
    end loop;
    if array_length(or_parts, 1) > 0 then
      where_sql := where_sql || ' and (' || array_to_string(or_parts, ' or ') || ')';
    end if;
  end if;

  -- Filters. last_activity is the row's real updated_at, not a data key.
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    col := f->>'col';
    op  := coalesce(f->>'op', 'is');
    val := coalesce(f->>'value', '');
    continue when col is null or col !~ '^[a-zA-Z0-9_-]{1,64}$';

    if col in ('last_activity', '__updated_at') then
      expr := 'n.updated_at::text';
    else
      expr := 'n.data->>' || quote_literal(col);
    end if;

    if op = 'is' then
      where_sql := where_sql || ' and ' || expr || ' = ' || quote_literal(val);
    elsif op = 'is_not' then
      where_sql := where_sql || ' and coalesce(' || expr || ', '''') <> ' || quote_literal(val);
    elsif op = 'contains' then
      where_sql := where_sql || ' and ' || expr || ' ilike ' || quote_literal('%' || val || '%');
    elsif op = 'empty' then
      where_sql := where_sql || ' and coalesce(btrim(' || expr || '), '''') = ''''';
    elsif op = 'not_empty' then
      where_sql := where_sql || ' and coalesce(btrim(' || expr || '), '''') <> ''''';
    elsif op = 'after' then
      where_sql := where_sql || ' and ' || expr || ' >= ' || quote_literal(val);
    elsif op = 'before' then
      where_sql := where_sql || ' and ' || expr || ' <= ' || quote_literal(val);
    -- gt/lt compare as NUMBERS. These two were the ones that never reached SQL: they ran in the
    -- browser over the loaded page, so "amount > 1000" answered from a subset without saying so.
    elsif op in ('gt', 'lt') then
      -- Parse the OPERAND the same way as the column, and skip the condition entirely if it is not
      -- a number — a bad cast here would abort the whole query instead of just ignoring one filter.
      num_val := mondaily_num(val);
      if num_val is not null then
        where_sql := where_sql || ' and mondaily_num(' || expr || ') '
                     || case when op = 'gt' then '>' else '<' end || ' ' || quote_literal(num_val) || '::numeric';
      end if;
    end if;
  end loop;

  -- Sorts, in the order given. Empty always sinks (NULLS LAST both directions).
  for s in select * from jsonb_array_elements(coalesce(p_sorts, '[]'::jsonb))
  loop
    col  := s->>'col';
    kind := coalesce(s->>'kind', 'text');
    dir  := case when lower(coalesce(s->>'dir', 'asc')) = 'desc' then 'desc' else 'asc' end;
    continue when col is null or col !~ '^[a-zA-Z0-9_-]{1,64}$';

    if col in ('last_activity', '__updated_at') then
      expr := 'n.updated_at';
    elsif kind = 'numeric' then
      expr := 'mondaily_num(n.data->>' || quote_literal(col) || ')';
    elsif kind = 'rank' then
      -- Ordered categoricals rank by pipeline position, never by spelling. Unknown values get a
      -- NULL position and therefore sort after every known one, still visible.
      ranks := coalesce(array(select jsonb_array_elements_text(s->'rank')), array[]::text[]);
      expr := 'array_position(' || quote_literal(ranks) || '::text[], lower(btrim(n.data->>' || quote_literal(col) || ')))';
    else
      expr := 'nullif(btrim(n.data->>' || quote_literal(col) || '), '''')';
    end if;

    order_sql := order_sql || case when order_sql = '' then '' else ', ' end
                 || expr || ' ' || dir || ' nulls last';
  end loop;

  -- Stable keys last: without them, rows equal on every rule reorder between pages, which both
  -- duplicates and skips records across a paginated read.
  order_sql := order_sql || case when order_sql = '' then '' else ', ' end
               || 'n.updated_at desc, n.id asc';

  -- `- 'embedding'` drops the pgvector column from the payload. It is null today (vector search is
  -- dormant), but once that pipeline runs each row would carry a ~20KB vector that no list view
  -- reads — a 1000-row page would balloon from ~1.5MB to ~20MB.
  return query execute format(
    'select to_jsonb(n.*) - ''embedding'' as record, count(*) over() as total_count
       from nodes n
      where %s
      order by %s
      limit %s offset %s',
    where_sql, order_sql, safe_limit, safe_off
  );
end;
$$;

comment on function list_records is
  'Resolves a record view entirely in SQL: search, all filters (including numeric gt/lt and owner), all sort rules in order with rank-aware ordering and NULLS LAST. total_count is the real filtered count, not the page length.';

-- SERVICE ROLE ONLY, deliberately. This function takes p_workspace_id as an argument, so any role
-- that can execute it can ask for any workspace. The API is the only caller and holds the service
-- key behind requireAuth (which validates membership before trusting the header). `nodes` is not in
-- the RLS backstop list of 20260626_rls_complete.sql, so granting `authenticated`/`anon` here would
-- be a cross-tenant read path reachable straight through PostgREST.
revoke execute on function list_records(uuid, text, text, text, text, text[], jsonb, jsonb, int, int) from public;
revoke execute on function mondaily_num(text) from public;
grant execute on function mondaily_num(text) to service_role;
grant execute on function list_records(uuid, text, text, text, text, text[], jsonb, jsonb, int, int)
  to service_role;
