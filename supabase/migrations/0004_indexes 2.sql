create index if not exists idx_nodes_workspace on nodes(workspace_id);
create index if not exists idx_nodes_type on nodes(workspace_id, vertical, object_type);
create index if not exists idx_nodes_embedding on nodes using ivfflat(embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_nodes_fts on nodes using gin(fts_vector);
create index if not exists idx_nodes_data on nodes using gin(data);
create index if not exists idx_activities_node on activities(node_id, created_at desc);
create index if not exists idx_activities_ws on activities(workspace_id, created_at desc);
create index if not exists idx_edges_from on edges(from_node_id);
create index if not exists idx_edges_to on edges(to_node_id);
create index if not exists idx_agent_jobs_ws on agent_jobs(workspace_id, created_at desc);
create index if not exists idx_agent_jobs_status on agent_jobs(status) where status in ('pending','running');
create index if not exists idx_chat_threads_user on chat_threads(workspace_id, user_id);
create index if not exists idx_list_entries_list on list_entries(list_id);
create index if not exists idx_list_entries_node on list_entries(node_id);

