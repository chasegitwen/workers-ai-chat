CREATE TABLE IF NOT EXISTS model_health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  status TEXT,
  checked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_health_checks_provider_model_checked_at
ON model_health_checks(provider, model, checked_at);
