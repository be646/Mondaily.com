# RLS Production Verification

Run these in the **Supabase SQL editor** against production to *prove* (not assume)
that Row-Level Security isolates every workspace's data. Each query is read-only.

The app's service-role key bypasses RLS by design (it scopes every query by
`workspace_id` in code). RLS is the **provable backstop**: even a leaked anon key,
a mis-scoped query, or a direct client connection cannot cross tenants.

## 1. RLS enabled on all workspace tables

Lists every table that has a `workspace_id` column and whether RLS is ON. Any row
with `rls_enabled = false` is a gap to fix.

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and exists (
    select 1 from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name = c.relname
      and col.column_name = 'workspace_id'
  )
order by rls_enabled asc, table_name;
```

## 2. Policies exist for each workspace table

A table with RLS enabled but **zero policies** denies all access (or, if forced off,
leaks). Confirm every workspace table has at least one policy.

```sql
select t.table_name,
       count(p.policyname) as policy_count,
       string_agg(p.policyname, ', ') as policies
from information_schema.columns t
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = t.table_name
where t.table_schema = 'public'
  and t.column_name = 'workspace_id'
group by t.table_name
order by policy_count asc, t.table_name;
```

Any `policy_count = 0` row is a gap.

## 3. Specific sensitive tables are workspace-isolated

Confirm the tables this hardening pass touched are covered. Each should return a row
with `rls_enabled = true` **and** at least one policy.

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'ai_training_logs',     -- training data
    'internal_messages',    -- internal messaging
    'call_sessions',        -- calls
    'decision_queue',       -- decisions
    'nodes',                -- graph records
    'tasks',                -- tasks
    'lists',                -- lists
    'reports',              -- reports
    'invoices',             -- finance
    'agent_jobs'            -- agent run history
  )
order by rls_enabled asc, policy_count asc, table_name;
```

Adjust the table names to match your schema (some may differ, e.g. `calls` vs
`call_sessions`). Any listed table missing here means the migration that creates it
hasn't been applied.

## 4. Prove a policy actually filters by workspace

Inspect the policy expression for a sensitive table — it should reference
`workspace_id` (directly, or via a membership subquery), never be `USING (true)`.

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('ai_training_logs', 'internal_messages', 'call_sessions', 'decision_queue')
order by tablename, policyname;
```

Red flags: `qual` = `true`, or a policy that omits `workspace_id` entirely.

## 5. Membership function sanity (if policies use a helper)

If your policies delegate to a helper (e.g. `auth_workspace_ids()` /
`is_workspace_member()`), confirm it exists and is `security definer`.

```sql
select proname, prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname ilike '%workspace%';
```

## What to do if a gap is found

- Table with `rls_enabled = false` → apply the RLS migration
  (`0002_rls_policies.sql`, `20260626_rls_complete.sql`) or enable + add a policy:
  ```sql
  alter table public.<table> enable row level security;
  -- then create the workspace-scoped policy matching your existing pattern
  ```
- Table with a policy but `USING (true)` → replace with a `workspace_id`-scoped predicate.
- Missing table → the feature's migration hasn't been applied in prod.
