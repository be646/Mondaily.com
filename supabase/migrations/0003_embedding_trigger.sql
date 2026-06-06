create or replace function trigger_node_sync()
returns trigger as $$
declare
  text_content text;
begin
  text_content := coalesce(new.object_type, '') || ' '
    || coalesce(new.data->>'name', '') || ' '
    || coalesce(new.data->>'email', '') || ' '
    || coalesce(new.data->>'description', '') || ' '
    || coalesce(new.data->>'title', '') || ' '
    || coalesce(new.data->>'company', '') || ' '
    || coalesce(new.ai_summary, '');

  new.fts_vector := to_tsvector('english', text_content);
  new.updated_at := now();

  perform net.http_post(
    url := current_setting('app.inngest_event_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.inngest_key', true)
    ),
    body := json_build_object(
      'name', 'mondaily/embedding.sync',
      'data', json_build_object(
        'node_id', new.id,
        'text', text_content,
        'workspace', new.workspace_id
      )
    )::text
  );

  return new;
end;
$$ language plpgsql;

create trigger node_sync_trigger
  before insert or update on nodes
  for each row execute function trigger_node_sync();

create or replace function search_nodes(
  p_workspace_id uuid,
  p_query_text text,
  p_query_vector vector(1536),
  p_verticals text[] default null,
  p_object_types text[] default null,
  p_limit int default 20
)
returns table(id uuid, vertical text, object_type text, data jsonb, ai_summary text, score float) as $$
begin
  return query
  select n.id, n.vertical, n.object_type, n.data, n.ai_summary,
    (0.7 * (1 - (n.embedding <=> p_query_vector)) +
     0.3 * ts_rank(n.fts_vector, plainto_tsquery('english', p_query_text))) as score
  from nodes n
  where n.workspace_id = p_workspace_id
    and n.embedding is not null
    and (p_verticals is null or n.vertical = any(p_verticals))
    and (p_object_types is null or n.object_type = any(p_object_types))
  order by score desc
  limit p_limit;
end;
$$ language plpgsql;

create or replace function search_nodes_keyword_only(
  p_workspace_id uuid,
  p_query_text text,
  p_verticals text[] default null,
  p_object_types text[] default null,
  p_limit int default 20
)
returns table(id uuid, vertical text, object_type text, data jsonb, ai_summary text, score float) as $$
begin
  return query
  select n.id, n.vertical, n.object_type, n.data, n.ai_summary,
    ts_rank(n.fts_vector, plainto_tsquery('english', p_query_text)) as score
  from nodes n
  where n.workspace_id = p_workspace_id
    and (p_verticals is null or n.vertical = any(p_verticals))
    and (p_object_types is null or n.object_type = any(p_object_types))
  order by score desc, n.updated_at desc
  limit p_limit;
end;
$$ language plpgsql;

