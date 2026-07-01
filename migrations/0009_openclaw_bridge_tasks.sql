ALTER TABLE openclaw_tasks ADD COLUMN bridge_task_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_run_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_session_key TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_session_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_agent_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_result_hash TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN bridge_mode_enabled INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_bridge_task
ON openclaw_tasks(bridge_task_id);
