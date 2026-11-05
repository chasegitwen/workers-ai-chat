-- Recent, sanitized tool/subagent progress for run-detail recovery after refresh.
-- Payloads are bounded to the last 50 events by the adapter and remain on the scoped run row.
ALTER TABLE hermes_runs ADD COLUMN timeline_json TEXT;
