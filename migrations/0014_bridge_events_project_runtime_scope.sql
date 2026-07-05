ALTER TABLE bridge_events ADD COLUMN project_id TEXT;
ALTER TABLE bridge_events ADD COLUMN runtime_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bridge_events_project_runtime_task
ON bridge_events(project_id, runtime_id, task_id, received_at);
