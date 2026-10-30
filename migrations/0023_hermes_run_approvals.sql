-- Persist only the sanitized identity and display snapshot of the current Hermes approval.
-- The raw prompt is never stored; session/permanent grant choices are never exposed.
ALTER TABLE hermes_runs ADD COLUMN approval_request_id TEXT;
ALTER TABLE hermes_runs ADD COLUMN approval_generation INTEGER;
ALTER TABLE hermes_runs ADD COLUMN approval_json TEXT;
ALTER TABLE hermes_runs ADD COLUMN approval_response_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hermes_runs ADD COLUMN approval_response_started_at INTEGER;
