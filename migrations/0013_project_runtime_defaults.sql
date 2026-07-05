ALTER TABLE project_openclaw_runtime_bindings ADD COLUMN default_agent_id TEXT;

ALTER TABLE openclaw_tasks ADD COLUMN project_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN runtime_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN runtime_slug TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN selected_agent_id TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN execution_mode TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN runtime_resolution_source TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN runtime_resolution_warnings TEXT;

CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_project_runtime
ON openclaw_tasks(project_id, runtime_id, updated_at);

UPDATE project_openclaw_runtime_bindings
SET default_agent_id = COALESCE(default_agent_id, 'main')
WHERE project_id = 'default'
  AND runtime_id = 'hillsboro-openclaw';
