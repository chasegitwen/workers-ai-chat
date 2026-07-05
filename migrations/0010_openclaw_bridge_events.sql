CREATE TABLE IF NOT EXISTS bridge_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  conversation_id TEXT,
  assistant_message_id TEXT,
  event_type TEXT NOT NULL,
  sequence INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  received_at TEXT NOT NULL,
  bridge_id TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  duplicate INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_bridge_events_task_id
ON bridge_events(task_id);

CREATE INDEX IF NOT EXISTS idx_bridge_events_assistant_message_id
ON bridge_events(assistant_message_id);

CREATE INDEX IF NOT EXISTS idx_bridge_events_received_at
ON bridge_events(received_at);

ALTER TABLE openclaw_tasks ADD COLUMN bridge_last_sequence INTEGER DEFAULT -1;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_last_seen_at TEXT;
