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
3. **Preflight counts (read-only).** Record the results:
   ```sql
   -- tasks 0021 will bind
   SELECT COUNT(*) FROM openclaw_tasks
   WHERE COALESCE(runtime_id, '') = ''
     AND COALESCE(runtime_slug, '') IN ('', 'hillsboro-openclaw')
     AND (COALESCE(bridge_mode_enabled, 0) = 1 OR COALESCE(bridge_task_id, '') <> '')
     AND COALESCE(provider, '') NOT IN ('openclaw-seattle', 'openclaw-oracle');
   -- bridge tasks that stay unbound and will be rejected; expected 0
   SELECT id, provider, status FROM openclaw_tasks
   WHERE COALESCE(runtime_id, '') = ''
     AND (COALESCE(bridge_mode_enabled, 0) = 1 OR COALESCE(bridge_task_id, '') <> '')
     AND COALESCE(provider, '') IN ('openclaw-seattle', 'openclaw-oracle');
   -- in-flight claims; expected 0 before the new Worker exists
   SELECT COUNT(*) FROM bridge_events WHERE error = 'apply_in_progress';
   ```
4. **Apply 0021** (`wrangler d1 migrations apply`), then rerun the first query;
   expect 0.
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
