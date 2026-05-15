CREATE TABLE IF NOT EXISTS file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id
ON file_chunks(file_id);

CREATE INDEX IF NOT EXISTS idx_file_chunks_chunk_index
ON file_chunks(chunk_index);
