-- Development schema. Replit Publish applies schema changes to the production database.
-- Runtime startup intentionally does not run DDL.
CREATE TABLE IF NOT EXISTS rare_persistent_documents (
  document_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'usr_system_legacy',
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rare_persistent_docs_user_idx
  ON rare_persistent_documents (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS rare_checkpoint_files (
  checkpoint_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content BYTEA NOT NULL,
  PRIMARY KEY (checkpoint_id, relative_path)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'usr_system_legacy',
  title TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_user_updated_idx
  ON projects (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'usr_system_legacy',
  title TEXT NOT NULL,
  assigned_role TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS project_tasks_user_updated_idx
  ON project_tasks (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'usr_system_legacy',
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success')),
  message TEXT NOT NULL,
  tool_called TEXT,
  file_affected TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_events_user_created_idx
  ON agent_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'usr_system_legacy',
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS artifacts_user_created_idx
  ON artifacts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rare_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rare_sessions_user_expires_idx
  ON rare_sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS rare_users (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  name TEXT NOT NULL,
  password_hash TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'email', 'phone')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('developer', 'user')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS rare_users_email_normalized_uidx
  ON rare_users (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rare_users_phone_uidx
  ON rare_users (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS rare_users_role_idx
  ON rare_users (role);
