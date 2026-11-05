-- Persist only the sanitized identity and display snapshot of the current Hermes clarification.
-- Clarification state is deliberately separate from approval state and choices.
ALTER TABLE hermes_runs ADD COLUMN clarify_request_id TEXT;
ALTER TABLE hermes_runs ADD COLUMN clarify_generation INTEGER;
ALTER TABLE hermes_runs ADD COLUMN clarify_json TEXT;
ALTER TABLE hermes_runs ADD COLUMN clarify_response_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hermes_runs ADD COLUMN clarify_response_started_at INTEGER;
