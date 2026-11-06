-- B2-3 analytics filters remain owner-scoped and time-bounded. Each reliable
-- dimension has an index prefix matching the Worker predicates.
CREATE INDEX IF NOT EXISTS idx_hermes_usage_owner_provider_time
ON hermes_run_usage(owner_username, actual_provider, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_usage_owner_model_time
ON hermes_run_usage(owner_username, actual_model, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_usage_owner_session_time
ON hermes_run_usage(owner_username, upstream_session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_usage_owner_project_time
ON hermes_run_usage(owner_username, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_usage_owner_job_time
ON hermes_run_usage(owner_username, hermes_job_id, occurred_at DESC);
