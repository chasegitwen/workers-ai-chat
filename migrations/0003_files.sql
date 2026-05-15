CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  r2_key TEXT NOT NULL,
  text_content TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
