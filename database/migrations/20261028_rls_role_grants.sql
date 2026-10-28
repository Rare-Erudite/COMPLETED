-- Grant the Supabase `authenticated` role the table privileges it needs for
-- row-level security to be the thing that restricts access.
--
-- Why this is needed
-- ------------------
-- RLS policies are only consulted for roles that actually hold a table
-- privilege. Without a GRANT, `authenticated` gets "permission denied for
-- table rare_user_state" and the policy is never evaluated — which looks like
-- RLS is broken when in fact it was never reached.
--
-- Note on the application connection: the app connects as `postgres`, which
-- carries rolbypassrls = true on Supabase. RLS therefore does NOT filter the
-- application's own queries; ownership is enforced in the service layer
-- (every read/write is scoped by the authenticated session's owner id) and
-- verified by the isolation tests. These grants make the database-level
-- backstop real for any client that connects as `authenticated`/`anon`
-- (e.g. the Supabase REST API with an anon key).
--
-- Idempotent: GRANT is a no-op when the privilege already exists.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rare_user_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rare_user_state TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artifacts TO authenticated;
