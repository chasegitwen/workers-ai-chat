-- Bridge callbacks now require a persisted runtime on the task and reject
-- tasks without one. Bridge-mode tasks created before runtime_id existed
-- (migration 0013) could only have come from the Hillsboro Bridge, so bind
-- them to hillsboro-openclaw. Seattle (legacy SSE) and Oracle tasks are
-- excluded by provider, and rows that already carry a runtime are untouched.

-- Keep the stored callback ledger of those tasks in the same scope, so
-- /result ledger recovery and SSE replay still find their events. This runs
-- first because it identifies the tasks by their still-empty runtime.
UPDATE bridge_events
SET runtime_id = 'hillsboro-openclaw'
WHERE COALESCE(runtime_id, '') = ''
  AND COALESCE(task_id, '') <> ''
  AND EXISTS (
    SELECT 1
    FROM openclaw_tasks t
    WHERE COALESCE(t.runtime_id, '') = ''
      AND COALESCE(t.runtime_slug, '') IN ('', 'hillsboro-openclaw')
      AND (COALESCE(t.bridge_mode_enabled, 0) = 1 OR COALESCE(t.bridge_task_id, '') <> '')
      AND COALESCE(t.provider, '') NOT IN ('openclaw-seattle', 'openclaw-oracle')
      AND bridge_events.task_id IN (t.id, COALESCE(t.bridge_task_id, ''), COALESCE(t.remote_task_id, ''))
      AND COALESCE(bridge_events.project_id, '') = COALESCE(t.project_id, '')
  );

UPDATE openclaw_tasks
SET runtime_id = 'hillsboro-openclaw',
  runtime_slug = 'hillsboro-openclaw',
  runtime_resolution_source = COALESCE(NULLIF(runtime_resolution_source, ''), 'legacy_bridge_backfill_0021')
WHERE COALESCE(runtime_id, '') = ''
  AND COALESCE(runtime_slug, '') IN ('', 'hillsboro-openclaw')
  AND (COALESCE(bridge_mode_enabled, 0) = 1 OR COALESCE(bridge_task_id, '') <> '')
  AND COALESCE(provider, '') NOT IN ('openclaw-seattle', 'openclaw-oracle');
