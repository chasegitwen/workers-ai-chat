CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_single_default
ON projects(is_default)
WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_projects_archived_updated
ON projects(is_archived, updated_at DESC);

INSERT INTO projects (
  id,
  name,
  slug,
  description,
  is_default,
  is_archived,
  created_at,
  updated_at
)
VALUES (
  'default',
  'Default Project',
  'default',
  'Compatibility workspace for conversations created before Project Workspace.',
  1,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO UPDATE SET
  is_default = 1,
  is_archived = 0,
  archived_at = NULL,
  updated_at = CURRENT_TIMESTAMP;

ALTER TABLE conversations ADD COLUMN project_id TEXT;

UPDATE conversations
SET project_id = 'default'
WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_project_updated
ON conversations(project_id, updated_at DESC);
