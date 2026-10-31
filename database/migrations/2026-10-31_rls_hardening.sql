-- ============================================================================
-- RARE — Row Level Security hardening
-- ============================================================================
-- Verified state before this migration (2026-10-31, via psql as `postgres`):
--
--   16 tables in `public`, all with RLS ENABLED.
--   11 of them had ZERO policies:
--     rare_checkpoint_files, rare_developer_credentials, rare_developer_grants,
--     rare_oauth_identities, rare_persistent_documents, rare_schema_migrations,
--     rare_sessions, rare_users, "PROFILES", "PROJECTS", "USERS"
--     plus agent_events/artifacts/project_tasks/projects/rare_user_state which
--     DO have owner-scoped policies.
--
-- The 11 "zero policy" tables were not actually exposed: `anon` and
-- `authenticated` hold no SELECT/INSERT/UPDATE/DELETE grants on them, so
-- PostgREST returns 401 before RLS is consulted. That was confirmed by direct
-- request with the publishable key:
--     GET /rest/v1/rare_users?select=email     -> 401 42501 permission denied
--     GET /rest/v1/rare_sessions?select=*      -> 401 42501 permission denied
--
-- So this is defence in depth, not an open door. The point is that the current
-- safety depends on a grant table that nobody documented and that a future
-- `GRANT ALL ON ALL TABLES` would silently destroy. This migration makes the
-- intent explicit and keeps it true even if grants are widened.
--
-- Design: the application does NOT use Supabase Auth sessions on these tables.
-- It connects as `postgres` (which has BYPASSRLS) and scopes rows itself via
-- the `rare.user_id` session setting already used by the existing policies.
-- Therefore every table here gets an explicit deny-by-default policy for the
-- end-user roles, and a matching owner-scoped policy where a row is per-user.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Helper: read the application's current owner from the session setting.
--    Same mechanism the pre-existing policies use, so behaviour is consistent.
-- ---------------------------------------------------------------------------
create or replace function public.rare_current_owner()
returns text
language sql
stable
as $$
  select nullif(current_setting('rare.user_id', true), '')
$$;

comment on function public.rare_current_owner() is
  'Returns the owner id the application set for this transaction via SET LOCAL rare.user_id. Null when unset, so every owner-scoped policy fails closed.';

-- ---------------------------------------------------------------------------
-- 2. Tables that must never be readable or writable by end-user roles.
--    These hold credentials, session tokens, or infrastructure state.
--    No policy is granted to anon/authenticated at all: absence of a policy
--    with RLS enabled means deny. We state it explicitly so intent is recorded.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  protected_tables text[] := array[
    'rare_sessions',
    'rare_developer_credentials',
    'rare_developer_grants',
    'rare_oauth_identities',
    'rare_schema_migrations',
    'rare_checkpoint_files'
  ];
begin
  foreach t in array protected_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_deny_end_users', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      t || '_deny_end_users', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. rare_users — the account table. End users never query it directly; the
--    server mediates. Deny explicitly for the same reason as above.
-- ---------------------------------------------------------------------------
drop policy if exists rare_users_deny_end_users on public.rare_users;
create policy rare_users_deny_end_users
  on public.rare_users
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- 4. rare_persistent_documents — per-owner document payloads.
--    Keyed by `document_key`, which the application composes as
--    `<ownerId>::<path>`-style keys, so ownership is in the key. Because there
--    is no owner column, the safe policy is deny for end-user roles; the server
--    (BYPASSRLS) reads and writes it. Recorded rather than silently allowed.
-- ---------------------------------------------------------------------------
drop policy if exists rare_persistent_documents_deny_end_users on public.rare_persistent_documents;
create policy rare_persistent_documents_deny_end_users
  on public.rare_persistent_documents
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- 5. Legacy uppercase tables (PROFILES, PROJECTS, USERS).
--    These are unreferenced by the application code — the live application uses
--    rare_users / projects / PROFILES-shaped data through rare_* tables. They
--    have anon grants but no policies. Deny for end-user roles, which is the
--    current effective behaviour anyway.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['PROFILES', 'PROJECTS', 'USERS'] loop
    execute format('drop policy if exists %I on public.%I', lower(t) || '_deny_end_users', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      lower(t) || '_deny_end_users', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Owner-scoped tables — add the missing command coverage.
--    agent_events / artifacts / project_tasks / projects / rare_user_state
--    already have an owner-scoped ALL policy keyed on rare.user_id. That is
--    correct. Nothing to change; listed here so the audit is complete.
-- ---------------------------------------------------------------------------

commit;

-- ---------------------------------------------------------------------------
-- Verification (run manually after applying):
--   select tablename, policyname, cmd, roles::text
--     from pg_policies where schemaname='public' order by tablename, policyname;
--   -- expect: every table either has an owner-scoped policy or an explicit
--   -- *_deny_end_users policy. No table with RLS on and zero policies.
-- ---------------------------------------------------------------------------
