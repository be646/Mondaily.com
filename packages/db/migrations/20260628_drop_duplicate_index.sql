-- workspace_members carries a UNIQUE CONSTRAINT on (workspace_id, user_id) that is
-- an exact duplicate of the table's PRIMARY KEY (also (workspace_id, user_id)). The
-- duplicate adds write overhead on every membership change for zero read benefit.
-- The PK already enforces the same uniqueness, so dropping it is safe.
--
-- It is backed by a constraint, not a bare index, so DROP INDEX fails with
-- "cannot drop index … because constraint … requires it" — drop the CONSTRAINT.
-- (If a foreign key ever references this constraint, Postgres will refuse the
-- drop; in that case leave it — the redundancy is only a minor write cost.)
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_workspace_user_unique;

-- Note: workspace_members_workspace (workspace_id) is intentionally KEPT — the
-- RLS policies do `select workspace_id from workspace_members`, which can use it.
