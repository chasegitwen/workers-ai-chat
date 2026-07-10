CREATE TABLE IF NOT EXISTS openclaw_runtimes (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  provider_id TEXT,
  base_url TEXT,
  callback_url TEXT,
  capabilities_json TEXT,
  agents_json TEXT,
  bridge_mode TEXT,
  status TEXT NOT NULL DEFAULT 'unverified',
  is_enabled INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_openclaw_runtimes_enabled_status
ON openclaw_runtimes(is_enabled, status);

CREATE TABLE IF NOT EXISTS project_openclaw_runtime_bindings (
  project_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  allowed_agents_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, runtime_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (runtime_id) REFERENCES openclaw_runtimes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_openclaw_runtime_single_default
ON project_openclaw_runtime_bindings(project_id, is_default)
WHERE is_default = 1;

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
  'hillsboro-openclaw',
  'Hillsboro OpenClaw',
  'hillsboro-openclaw',
  'openclaw-hillsboro',
  'https://hill.hnsnowground.cfd/v1',
  '',
  '{"bridge_callback":true,"progress_callback":true,"sse_events":true,"remote_console":true,"nativeAttachment":true,"production_validated":true}',
  '[{"agent_id":"main","display_name":"Main","verified":true},{"agent_id":"glm51","display_name":"GLM 5.1","verified":true},{"agent_id":"glm5-2","display_name":"GLM 5.2","verified":true},{"agent_id":"kimi-for-coding","display_name":"Kimi for Coding","verified":true}]',
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
  'seattle-openclaw',
  'Seattle OpenClaw',
  'seattle-openclaw',
  'openclaw-seattle',
  'https://act.hnsnowground.cfd/v1',
  '',
  '{"bridge_callback":false,"progress_callback":false,"sse_events":false,"remote_console":false,"nativeAttachment":false,"legacy_only":true,"production_validated":false}',
  '[]',
  'legacy',
  'unverified',
  0,
  NULL,
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
  updated_at = excluded.updated_at;

INSERT INTO project_openclaw_runtime_bindings (
  project_id,
  runtime_id,
  is_default,
  is_enabled,
  allowed_agents_json,
  created_at,
  updated_at
)
VALUES (
  'default',
  'hillsboro-openclaw',
  1,
  1,
  '["main","glm51","glm5-2","kimi-for-coding"]',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(project_id, runtime_id) DO UPDATE SET
  is_default = 1,
  is_enabled = 1,
  allowed_agents_json = excluded.allowed_agents_json,
  updated_at = excluded.updated_at;
