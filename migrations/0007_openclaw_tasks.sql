CREATE TABLE IF NOT EXISTS openclaw_tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  upstream_model_name TEXT,
  prompt_preview TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  latency_ms INTEGER,
  assistant_message_id TEXT,
  remote_task_id TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_conversation_updated
ON openclaw_tasks(conversation_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_status_updated
ON openclaw_tasks(status, updated_at);
