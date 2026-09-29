ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN archived_at INTEGER;
ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_project_archive_updated
ON conversations(project_id, is_archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_project_archived_at
ON conversations(project_id, is_archived, archived_at DESC);
