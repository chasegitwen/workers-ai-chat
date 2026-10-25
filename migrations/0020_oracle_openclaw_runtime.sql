INSERT INTO openclaw_runtimes (
  id,
  display_name,
  slug,
  provider_id,
  base_url,
  callback_url,
  capabilities_json,
  agents_json,
  bridge_mode,
  status,
  is_enabled,
  last_verified_at,
  created_at,
  updated_at
)
VALUES (
  'oracle-openclaw',
  'Oracle OpenClaw',
  'oracle-openclaw',
  'openclaw-oracle',
  'https://oracle-ai.hnsnowground.cfd/v1',
  '',
  '{"bridge_callback":true,"progress_callback":true,"sse_events":true,"remote_console":true,"nativeAttachment":true,"production_validated":true,"automatic_fallback":false}',
  '[{"agent_id":"main","display_name":"Main","verified":true,"default_model":"openai/gpt-5.6-sol"}]',
  'bridge',
  'verified',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  slug = excluded.slug,
  provider_id = excluded.provider_id,
  base_url = excluded.base_url,
  capabilities_json = excluded.capabilities_json,
  agents_json = excluded.agents_json,
  bridge_mode = excluded.bridge_mode,
  status = excluded.status,
  is_enabled = excluded.is_enabled,
  last_verified_at = COALESCE(openclaw_runtimes.last_verified_at, excluded.last_verified_at),
  updated_at = excluded.updated_at;

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
  'oracle-openclaw',
  0,
  1,
  '["main"]',
  'main',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM projects p
WHERE p.is_archived = 0;

UPDATE project_openclaw_runtime_bindings
SET is_default = CASE WHEN runtime_id = 'hillsboro-openclaw' THEN 1 ELSE 0 END,
  updated_at = CURRENT_TIMESTAMP
WHERE project_id IN (
  SELECT project_id
  FROM project_openclaw_runtime_bindings
  WHERE runtime_id = 'oracle-openclaw'
)
AND runtime_id IN ('hillsboro-openclaw', 'oracle-openclaw');
