-- PostgreSQL schema. Apply versioned changes with `npm run migrate`.
-- Runtime startup intentionally does not run DDL.
CREATE TABLE IF NOT EXISTS rare_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rare_persistent_documents (
  document_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rare_checkpoint_files (
  checkpoint_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content BYTEA NOT NULL,
  PRIMARY KEY (checkpoint_id, relative_path)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  title TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_owner_updated_idx
  ON projects (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assigned_role TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS project_tasks_project_updated_idx
  ON project_tasks (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success')),
  message TEXT NOT NULL,
  tool_called TEXT,
  file_affected TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_events_project_created_idx
  ON agent_events (project_id, created_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS artifacts_project_created_idx
  ON artifacts (project_id, created_at);

-- Project data is visible only when a transaction sets rare.user_id from the
-- server-validated session. Legacy rows with no owner remain inaccessible.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY projects_owner_scope ON projects
    USING (owner_id = current_setting('rare.user_id', true))
    WITH CHECK (owner_id = current_setting('rare.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY project_tasks_owner_scope ON project_tasks
    USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_tasks.project_id AND projects.owner_id = current_setting('rare.user_id', true)))
    WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_tasks.project_id AND projects.owner_id = current_setting('rare.user_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY agent_events_owner_scope ON agent_events
    USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = agent_events.project_id AND projects.owner_id = current_setting('rare.user_id', true)))
    WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = agent_events.project_id AND projects.owner_id = current_setting('rare.user_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY artifacts_owner_scope ON artifacts
    USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = artifacts.project_id AND projects.owner_id = current_setting('rare.user_id', true)))
    WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = artifacts.project_id AND projects.owner_id = current_setting('rare.user_id', true)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Authoritative RARE account records.
CREATE TABLE IF NOT EXISTS rare_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT,
  provider TEXT NOT NULL CHECK (
    provider IN ('google', 'outlook', 'email', 'phone')
  ),
  role TEXT NOT NULL DEFAULT 'user' CHECK (
    role IN ('developer', 'user')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_owner_fk') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_owner_fk
      FOREIGN KEY (owner_id) REFERENCES rare_users(id) ON DELETE CASCADE;
  END IF;
END $$;

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

-- Sessions contain only a hash of the bearer token.
CREATE TABLE IF NOT EXISTS rare_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  account_id TEXT REFERENCES rare_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rare_sessions_owner_expiry_idx
  ON rare_sessions (owner_id, expires_at);

CREATE INDEX IF NOT EXISTS rare_sessions_expiry_idx
  ON rare_sessions (expires_at);

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

-- Private application state is partitioned by the server-authenticated owner.
-- The database policy requires each application query to set rare.user_id
-- transaction-locally; ownership must never come from a request body.
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

DO $$
BEGIN
  CREATE POLICY rare_user_state_owner_scope ON rare_user_state
    USING (owner_id = current_setting('rare.user_id', true))
    WITH CHECK (owner_id = current_setting('rare.user_id', true));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
