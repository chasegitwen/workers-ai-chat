-- Hermes Agent runtime (Oracle Hermes, v0.22.5 /v1/runs contract).
-- Add-only: new tables and indexes; no existing table (OpenClaw or core) is altered.

-- Ownership of a conversation for Hermes purposes. conversations/projects carry no
-- owner column, so the first Hermes submit binds (conversation, owner, project) here and
-- every later Hermes access must match all three.
CREATE TABLE IF NOT EXISTS hermes_conversation_bindings (
  conversation_id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  project_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  hermes_session_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hermes_runs (
  id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  -- Client-supplied request id (persistent idempotency key on our side).
  client_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  -- Idempotency-Key sent upstream; derived from id and persisted before the POST.
  upstream_idempotency_key TEXT NOT NULL UNIQUE,
  -- Exact JSON body sent upstream, kept so a user-initiated reconcile replays it byte for byte.
  upstream_request_json TEXT NOT NULL,
  upstream_run_id TEXT UNIQUE,
  upstream_session_id TEXT,
  admission_id TEXT,
  execution_generation INTEGER,
  model_mode TEXT NOT NULL DEFAULT 'agent_default',
  requested_provider TEXT,
  requested_model TEXT,
  actual_provider TEXT,
  actual_model TEXT,
  route_source TEXT,
  status TEXT NOT NULL,
  upstream_status TEXT,
  status_detail TEXT,
  error_code TEXT,
  error_message TEXT,
  -- 1 while this run occupies the global Hermes execution slot, NULL otherwise.
  holds_slot INTEGER,
  last_event_seq INTEGER NOT NULL DEFAULT -1,
  user_message_id TEXT,
  assistant_message_id TEXT,
  usage_json TEXT,
  cancel_requested_at INTEGER,
  submitted_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Persistent idempotency: one run per (owner, client request id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_runs_owner_request
ON hermes_runs(owner_username, client_request_id);

-- Global concurrency limit of 1: at most one row may hold the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_runs_single_slot
ON hermes_runs(holds_slot)
WHERE holds_slot = 1;

CREATE INDEX IF NOT EXISTS idx_hermes_runs_conversation_created
ON hermes_runs(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_runs_owner_status
ON hermes_runs(owner_username, status, updated_at DESC);

-- Whitelisted catalog snapshot per Hermes instance (never contains credentials).
CREATE TABLE IF NOT EXISTS hermes_catalog_cache (
  instance_id TEXT PRIMARY KEY,
  catalog_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);
