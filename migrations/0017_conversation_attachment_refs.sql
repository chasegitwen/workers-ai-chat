CREATE TABLE IF NOT EXISTS conversation_attachment_refs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  source_attachment_id TEXT,
  draft_id TEXT,
  created_at INTEGER NOT NULL,
  attached_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_attachment_refs_conversation
ON conversation_attachment_refs(conversation_id, attached_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_attachment_refs_unique_object
ON conversation_attachment_refs(conversation_id, r2_key);
