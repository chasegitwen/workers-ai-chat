-- Compact, redacted Hermes diagnostic summaries. The full sanitized tool timeline remains
-- in timeline_json; these columns intentionally do not create a second event log.
ALTER TABLE hermes_runs ADD COLUMN diagnostics_json TEXT;
ALTER TABLE hermes_runs ADD COLUMN diagnostics_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_hermes_runs_diagnostics_updated
ON hermes_runs(COALESCE(completed_at, updated_at, created_at))
WHERE timeline_json IS NOT NULL OR diagnostics_json IS NOT NULL;
