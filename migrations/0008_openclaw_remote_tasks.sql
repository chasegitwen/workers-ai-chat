ALTER TABLE openclaw_tasks ADD COLUMN remote_status TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN remote_progress INTEGER;
ALTER TABLE openclaw_tasks ADD COLUMN remote_message TEXT;
ALTER TABLE openclaw_tasks ADD COLUMN cancelled_at TEXT;
