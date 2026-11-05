-- Hermes sessions/projects workbench metadata only. Hermes remains the history system of record.
-- Add-only; archive is local metadata and never changes an upstream session end_reason.

CREATE TABLE IF NOT EXISTS hermes_workbench_projects (
  id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_workbench_projects_owner_id
ON hermes_workbench_projects(owner_username, id);

CREATE INDEX IF NOT EXISTS idx_hermes_workbench_projects_owner_updated
ON hermes_workbench_projects(owner_username, updated_at DESC);

CREATE TABLE IF NOT EXISTS hermes_session_meta (
  hermes_session_id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  project_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  archived_at INTEGER,
  title_override TEXT,
  forked_from_session_id TEXT,
  instance_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES hermes_workbench_projects(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_session_meta_owner_session
ON hermes_session_meta(owner_username, hermes_session_id);

CREATE INDEX IF NOT EXISTS idx_hermes_session_meta_owner_archive_updated
ON hermes_session_meta(owner_username, archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_session_meta_owner_project
ON hermes_session_meta(owner_username, project_id, updated_at DESC);
