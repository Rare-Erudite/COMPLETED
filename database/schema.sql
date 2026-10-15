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
