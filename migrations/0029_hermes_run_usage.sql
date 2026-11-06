-- Durable, owner-scoped Hermes token usage facts. This table is deliberately
-- separate from the bounded diagnostic payloads pruned after 30 days.
CREATE TABLE IF NOT EXISTS hermes_run_usage (
  run_id TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  upstream_run_id TEXT,
  run_status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  actual_provider TEXT,
  actual_model TEXT,
  requested_provider TEXT,
  requested_model TEXT,
  route_source TEXT,
  fallback_used INTEGER,
  instance_id TEXT NOT NULL,
  runtime_profile TEXT,
  service_tier TEXT,
  project_id TEXT,
  conversation_id TEXT,
  upstream_session_id TEXT,
  hermes_job_id TEXT,
  collection_status TEXT NOT NULL,
  collection_source TEXT NOT NULL,
  historical_gap INTEGER NOT NULL DEFAULT 0,
  overflow_detected INTEGER NOT NULL DEFAULT 0,
  validation_flags_json TEXT,
  -- Run occurrence time drives later analytics windows; collected_at records
  -- when this Worker observed/backfilled the authoritative snapshot.
  occurred_at INTEGER NOT NULL,
  collected_at INTEGER NOT NULL,
  -- Reserved for B2-2. B2-1 never populates cost or price data.
  price_snapshot_json TEXT,
  estimated_cost_micros INTEGER,
  cost_status TEXT,
  currency TEXT,
  PRIMARY KEY (owner_username, run_id),
  FOREIGN KEY (run_id) REFERENCES hermes_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_hermes_run_usage_owner_time
ON hermes_run_usage(owner_username, occurred_at DESC, run_id DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_run_usage_owner_status_time
ON hermes_run_usage(owner_username, collection_status, occurred_at DESC);
