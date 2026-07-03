-- Task completion timestamp — enables accurate "completed work over time" trends in Team Oversight.
-- The tasks table had only a `completed` boolean (no completion time), so completed-over-time could
-- not be computed honestly. Purely additive; nothing reads completed_at until it's populated.

alter table tasks add column if not exists completed_at timestamptz;

-- Backfill: for tasks already completed but with no timestamp, use updated_at (the best available
-- proxy for when it finished), falling back to now(). Idempotent (only touches null completed_at).
update tasks
  set completed_at = coalesce(updated_at, now())
  where completed = true and completed_at is null;

-- Trend queries bucket by (workspace_id, completed_at).
create index if not exists tasks_completed_at_idx on tasks (workspace_id, completed_at);
