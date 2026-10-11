-- Development schema. Replit Publish applies schema changes to the production database.
-- Runtime startup intentionally does not run DDL.
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
