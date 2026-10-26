# Oracle Bridge 1.3.0 / callback runtime binding — release order

Not executed. Production checks and the D1 migration need separate approval.

## Why the order matters

The Worker now rejects callbacks for tasks without a persisted `runtime_id`
(`401 callback_unauthorized`, logged as `task_runtime_not_bridge_bound`).
Migration `0021_backfill_hillsboro_bridge_task_runtime.sql` binds legacy
Hillsboro bridge tasks (and their `bridge_events` rows) to
`hillsboro-openclaw`. Deploying the Worker before 0021 makes every callback of
an older, still-running Hillsboro task fail closed.
`test/d1Migration0021.spec.js` demonstrates both states on local D1.

## Order

1. **Preconditions (read-only).**
   - Hillsboro Bridge sends `X-OpenClaw-Bridge-Id: hetzner-main`.
   - Oracle Bridge `callback.json` has `bridge_id` unset or
     `oracle-phoenix-a1-openclaw-bridge`.
   - Worker `OPENCLAW_CALLBACK_ALLOWED_BRIDGE_IDS` is empty or contains both IDs.
2. **Back up D1** (`wrangler d1 export`).
3. **Preflight detail review (read-only).** Export every candidate row and
   confirm its ownership one by one before approving the migration. A count is
   not sufficient: 0021 assumes that every bridge-mode task without a runtime
   and with a provider other than `openclaw-seattle` / `openclaw-oracle` came
   from the Hillsboro Bridge, which only holds for the standard migration
   history (manual or partial histories may contain other rows).
   ```sql
   -- (a) every task 0021 will bind to hillsboro-openclaw. Check each row:
   --     provider/model are Hillsboro ones, bridge_task_id is a Hillsboro
   --     Bridge task id, started_at precedes the Oracle runtime (migration 0020).
   SELECT id, conversation_id, provider, model, status, started_at, updated_at,
     bridge_task_id, remote_task_id, bridge_agent_id, project_id,
     runtime_id, runtime_slug, runtime_resolution_source
   FROM openclaw_tasks
   WHERE COALESCE(runtime_id, '') = ''
     AND COALESCE(runtime_slug, '') IN ('', 'hillsboro-openclaw')
     AND (COALESCE(bridge_mode_enabled, 0) = 1 OR COALESCE(bridge_task_id, '') <> '')
     AND COALESCE(provider, '') NOT IN ('openclaw-seattle', 'openclaw-oracle')
   ORDER BY started_at;

   -- (b) every ledger row 0021 will rebind. Each must belong to a task listed
   --     in (a) with the same project_id, and bridge_id must be hetzner-main.
   SELECT e.event_id, e.task_id, e.project_id, e.bridge_id, e.event_type,
     e.sequence, e.received_at, e.applied, t.id AS local_task_id, t.provider
   FROM bridge_events e
   JOIN openclaw_tasks t
     ON e.task_id IN (t.id, COALESCE(t.bridge_task_id, ''), COALESCE(t.remote_task_id, ''))
    AND COALESCE(e.project_id, '') = COALESCE(t.project_id, '')
   WHERE COALESCE(e.runtime_id, '') = '' AND COALESCE(e.task_id, '') <> ''
     AND COALESCE(t.runtime_id, '') = ''
     AND COALESCE(t.runtime_slug, '') IN ('', 'hillsboro-openclaw')
     AND (COALESCE(t.bridge_mode_enabled, 0) = 1 OR COALESCE(t.bridge_task_id, '') <> '')
     AND COALESCE(t.provider, '') NOT IN ('openclaw-seattle', 'openclaw-oracle')
   ORDER BY e.received_at;

   -- (c) bridge tasks that stay unbound and are rejected after the Worker
   --     deploy. Review each; expected: none still running.
   SELECT id, provider, model, status, started_at, bridge_task_id, project_id, runtime_slug
   FROM openclaw_tasks
   WHERE COALESCE(runtime_id, '') = ''
     AND (COALESCE(bridge_mode_enabled, 0) = 1 OR COALESCE(bridge_task_id, '') <> '')
     AND (COALESCE(provider, '') IN ('openclaw-seattle', 'openclaw-oracle')
       OR COALESCE(runtime_slug, '') NOT IN ('', 'hillsboro-openclaw'))
   ORDER BY started_at;

   -- (d) unscoped ledger rows whose task id matches more than one local task
   --     (ambiguous ownership). Expected: no rows.
   SELECT e.event_id, e.task_id, COUNT(DISTINCT t.id) AS owners
   FROM bridge_events e
   JOIN openclaw_tasks t
     ON e.task_id IN (t.id, COALESCE(t.bridge_task_id, ''), COALESCE(t.remote_task_id, ''))
   WHERE COALESCE(e.runtime_id, '') = '' AND COALESCE(e.task_id, '') <> ''
   GROUP BY e.event_id, e.task_id
   HAVING COUNT(DISTINCT t.id) > 1;
   ```
   Any row in (a) or (b) that cannot be attributed to Hillsboro, or any row in
   (d), stops the release until it is corrected by a separately approved
   manual update. Keep the exported (a) and (b) results with the D1 backup.
4. **Apply 0021** (`wrangler d1 migrations apply`), then rerun (a) and (b);
   expect no rows.
5. **Deploy the Worker.**
6. **Deploy Oracle Bridge 1.3.0.** It migrates its SQLite in place
   (`user_version` 3) on start; stop the old service first so only one process
   opens the database.

## Rollback

- Worker: redeploy the previous version. 0021 only fills empty runtime fields
  and is compatible with the previous Worker.
- 0021 itself: the backfilled task rows carry
  `runtime_resolution_source = 'legacy_bridge_backfill_0021'` unless they
  already had a source; restore from the step 2 export if exact reversal is
  required.
- Bridge: the 1.2.x code cannot open a `user_version` 3 database safely; keep
  a copy of the SQLite file (with WAL/SHM, service stopped) before step 6.
