-- Safe, repeatable migration for server-owned private application state.
-- Each query sets rare.user_id transaction-locally from a validated session.
-- Existing project rows remain unassigned because their historical owner
-- cannot be safely inferred; API reads hide rows without an owner.
-- OAuth identities are keyed by the provider's stable subject. Some valid
-- provider accounts do not expose a verified email, so the account row must
-- not require a mutable email or phone number as its identity.
ALTER TABLE rare_users DROP CONSTRAINT IF EXISTS rare_users_check;

CREATE TABLE IF NOT EXISTS rare_oauth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES rare_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, user_id)
);
CREATE INDEX IF NOT EXISTS rare_oauth_identities_user_idx
  ON rare_oauth_identities (user_id);

CREATE TABLE IF NOT EXISTS rare_developer_credentials (
  user_id TEXT PRIMARY KEY REFERENCES rare_users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rare_developer_grants (
  session_hash TEXT PRIMARY KEY REFERENCES rare_sessions(token_hash) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rare_developer_grants_expiry_idx
  ON rare_developer_grants (expires_at);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id TEXT;
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
  ON projects (owner_id, updated_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_owner_fk') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_owner_fk
      FOREIGN KEY (owner_id) REFERENCES rare_users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_owner_scope ON projects;
CREATE POLICY projects_owner_scope ON projects
  USING (owner_id = current_setting('rare.user_id', true))
  WITH CHECK (owner_id = current_setting('rare.user_id', true));

DROP POLICY IF EXISTS project_tasks_owner_scope ON project_tasks;
CREATE POLICY project_tasks_owner_scope ON project_tasks
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_tasks.project_id AND projects.owner_id = current_setting('rare.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_tasks.project_id AND projects.owner_id = current_setting('rare.user_id', true)));

DROP POLICY IF EXISTS agent_events_owner_scope ON agent_events;
CREATE POLICY agent_events_owner_scope ON agent_events
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = agent_events.project_id AND projects.owner_id = current_setting('rare.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = agent_events.project_id AND projects.owner_id = current_setting('rare.user_id', true)));

DROP POLICY IF EXISTS artifacts_owner_scope ON artifacts;
CREATE POLICY artifacts_owner_scope ON artifacts
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = artifacts.project_id AND projects.owner_id = current_setting('rare.user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = artifacts.project_id AND projects.owner_id = current_setting('rare.user_id', true)));

CREATE TABLE IF NOT EXISTS rare_user_state (
  owner_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, state_key)
);

CREATE INDEX IF NOT EXISTS rare_user_state_updated_idx
  ON rare_user_state (owner_id, updated_at DESC);

ALTER TABLE rare_user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE rare_user_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rare_user_state_owner_scope ON rare_user_state;
CREATE POLICY rare_user_state_owner_scope ON rare_user_state
  USING (owner_id = current_setting('rare.user_id', true))
  WITH CHECK (owner_id = current_setting('rare.user_id', true));
