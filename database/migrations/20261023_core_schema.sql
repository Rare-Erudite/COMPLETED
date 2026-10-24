-- Repeatable baseline for fresh PostgreSQL/Supabase databases. Existing
-- installations retain their rows; the following ownership migration adds
-- tenant policy without assigning legacy rows to an inferred user.
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

CREATE TABLE IF NOT EXISTS rare_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'email', 'phone')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('developer', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rare_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  account_id TEXT REFERENCES rare_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS rare_sessions_owner_expiry_idx ON rare_sessions (owner_id, expires_at);
CREATE INDEX IF NOT EXISTS rare_sessions_expiry_idx ON rare_sessions (expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES rare_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_id, updated_at DESC);

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
CREATE INDEX IF NOT EXISTS project_tasks_project_updated_idx ON project_tasks (project_id, updated_at DESC);

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
CREATE INDEX IF NOT EXISTS agent_events_project_created_idx ON agent_events (project_id, created_at);

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
CREATE INDEX IF NOT EXISTS artifacts_project_created_idx ON artifacts (project_id, created_at);
