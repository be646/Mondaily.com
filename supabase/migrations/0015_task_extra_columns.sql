-- Add columns used by tasks API that were missing from migration 0014.

alter table tasks
  add column if not exists record_id          uuid,
  add column if not exists notes              text,
  add column if not exists overdue_notified_at timestamptz,
  add column if not exists reviewer_id        text,
  add column if not exists reviewer_name      text,
  add column if not exists review_result      text check (review_result in ('approved','changes_requested') or review_result is null),
  add column if not exists reviewed_at        timestamptz;

-- task_reviews table used by task-reviews.ts route.
create table if not exists task_reviews (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks(id) on delete cascade,
  workspace_id   uuid,
  round          int not null default 1,
  status         text not null default 'pending' check (status in ('pending','completed')),
  sent_by_id     text,
  sent_by_name   text,
  reviewer_id    text,
  reviewer_name  text,
  context        text,
  action         text check (action in ('approved','changes_requested','reassigned') or action is null),
  action_note    text,
  action_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists task_reviews_task_idx on task_reviews (task_id, round);
