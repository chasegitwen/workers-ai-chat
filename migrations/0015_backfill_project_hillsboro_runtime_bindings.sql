INSERT OR IGNORE INTO project_openclaw_runtime_bindings (
  project_id,
  runtime_id,
  is_default,
  is_enabled,
  allowed_agents_json,
  default_agent_id,
  created_at,
  updated_at
)
SELECT
  p.id,
  'hillsboro-openclaw',
  1,
  1,
  '["main","glm51","glm5-2","kimi-for-coding"]',
  'main',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM projects p
JOIN openclaw_runtimes r ON r.id = 'hillsboro-openclaw'
WHERE p.is_archived = 0
  AND r.is_enabled = 1
  AND r.status = 'verified'
  AND r.bridge_mode = 'bridge'
  AND json_extract(r.capabilities_json, '$.bridge_callback') = 1
  AND NOT EXISTS (
    SELECT 1
    FROM project_openclaw_runtime_bindings existing
    WHERE existing.project_id = p.id
  );
