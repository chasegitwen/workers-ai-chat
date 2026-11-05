-- Owner-scoped metadata for instance-global Hermes scheduled jobs.
-- Job definitions and execution results remain in Hermes.

CREATE TABLE IF NOT EXISTS hermes_job_meta (
  hermes_job_id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  project_id TEXT,
  title_override TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_job_meta_owner_job
ON hermes_job_meta(owner_username, hermes_job_id);

CREATE INDEX IF NOT EXISTS idx_hermes_job_meta_owner_updated
ON hermes_job_meta(owner_username, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_job_meta_owner_project
ON hermes_job_meta(owner_username, project_id, updated_at DESC);
