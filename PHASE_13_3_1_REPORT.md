# Phase 13.3.1 Report - OpenClaw Bridge Provider Integration

## Summary

Implemented OpenClaw Bridge Provider integration in `web-ai-assistant` with a disabled-by-default switch. The new path only applies to OpenClaw requests when `OPENCLAW_BRIDGE_MODE=true`; otherwise the existing Legacy SSE behavior is unchanged.

No Cloudflare deployment was performed. No Hetzner Bridge, OpenClaw Gateway, or provider/model configuration was modified.

## Modified Files

- `src/api/chat.js`
- `src/api/openclawBridgeClient.js`
- `migrations/0009_openclaw_bridge_tasks.sql`
- `test/openclawBridgeClient.spec.js`
- `test/openclawBridgeRoutes.spec.js`
- `PHASE_13_3_1_REPORT.md`

## New Environment Variables

- `OPENCLAW_BRIDGE_MODE=false`
- `OPENCLAW_BRIDGE_BASE_URL=`
- `OPENCLAW_BRIDGE_TOKEN=`

`OPENCLAW_BRIDGE_TOKEN` is only read from `env` and is never logged. Debug output only reports whether a token is present.

## Database Migration

Added migration `0009_openclaw_bridge_tasks.sql`:

- `bridge_task_id`
- `bridge_run_id`
- `bridge_session_key`
- `bridge_session_id`
- `bridge_agent_id`
- `bridge_result_hash`
- `bridge_mode_enabled`

The existing `remote_task_id`, `remote_status`, `remote_progress`, and `remote_message` fields remain intact for old tasks. Bridge tasks also copy `bridge_task_id` into `remote_task_id` so existing Task History, This Chat, and polling logic can continue to identify a remote-capable task.

## Bridge Mode Call Chain

When the selected provider/model is OpenClaw and `OPENCLAW_BRIDGE_MODE=true`:

1. `/api/chat` saves the user message as before.
2. A local `openclaw_tasks` row is created.
3. The local task id is used as the Bridge `idempotencyKey`.
4. `openclawBridgeClient.createTask()` sends:
   - `POST {OPENCLAW_BRIDGE_BASE_URL}/v1/openclaw/tasks`
   - `Authorization: Bearer <OPENCLAW_BRIDGE_TOKEN>`
5. The local task stores:
   - `bridge_task_id`
   - `bridge_run_id`
   - `bridge_session_key`
   - `bridge_session_id`
   - `bridge_agent_id`
6. `/api/chat` returns the existing frontend-friendly 202 task JSON response.
7. Existing frontend polling calls `/api/openclaw/tasks/:id/status`.
8. For Bridge tasks, status/result/cancel routes proxy to the Bridge HTTP API.
9. Completed result is saved as one assistant message and guarded by `assistant_message_id` plus `bridge_result_hash`.

## Legacy Mode Regression

When `OPENCLAW_BRIDGE_MODE` is unset or not equal to `true`:

- OpenClaw still follows the existing path.
- `OPENCLAW_ASYNC_MODE=native` still controls the older experimental async branch.
- Default OpenClaw behavior remains Legacy SSE.
- Non-OpenClaw providers are unchanged.

## Mock Bridge Verification

Added `test/openclawBridgeClient.spec.js`.

Verified:

- Bridge mode switch parsing.
- Base URL trailing slash normalization.
- `Authorization: Bearer` header.
- `POST /v1/openclaw/tasks`.
- `GET /v1/openclaw/tasks/:id/status`.
- `GET /v1/openclaw/tasks/:id/result`.
- `POST /v1/openclaw/tasks/:id/cancel`.
- Non-2xx Bridge responses return structured errors.
- Bridge client does not call `/v1/chat/completions`.
- Route-level mock coverage was attempted with fake D1, but direct `handleChat` collection was unstable in the Workers Vitest pool. The file is left as a skipped placeholder; real route verification should be run with an integration-capable local Bridge/D1 setup.

## Error Handling

If Bridge mode is enabled but the Bridge is unavailable or misconfigured:

- The request does not fall back to Legacy SSE.
- The local task is marked `failed`.
- The API returns a clear `OpenClaw Bridge unavailable...` error.
- No assistant message is created from a failed Bridge submit.

## Static Checks

Ran checks:

- `node --check src/api/openclawBridgeClient.js` - PASS
- `node --check src/api/chat.js` - PASS
- `git diff --check` - PASS, with the existing Windows LF/CRLF warning for `src/api/chat.js`
- `npx vitest run test/openclawBridgeClient.spec.js` - PASS, 4 tests
- `npx vitest run test/openclawBridgeRoutes.spec.js` - PASS, 1 skipped placeholder
- `npx vitest run` - Bridge and web search tests passed; existing `test/index.spec.js` failed because its inline snapshot expects `Hello World!` while the current Worker returns the real frontend HTML.
- `rg` confirmed the Bridge client does not use `/v1/chat/completions`.
- `rg` confirmed the Bridge client does not open WebSocket/EventSource connections.

## Not Done In This Phase

- Did not deploy Cloudflare Worker.
- Did not call the real Hetzner Bridge.
- Did not expose Hetzner Bridge to Cloudflare or local machine.
- Did not modify OpenClaw Gateway or Hetzner systemd service.

## Next Hetzner Coordination Needed

1. Expose the Bridge endpoint securely to Cloudflare Worker, or provide a private tunnel/service binding equivalent.
2. Set Cloudflare secrets:
   - `OPENCLAW_BRIDGE_MODE=true`
   - `OPENCLAW_BRIDGE_BASE_URL=<bridge https url>`
   - `OPENCLAW_BRIDGE_TOKEN=<secret>`
3. Run a grey validation with one OpenClaw provider/conversation.
4. Confirm long task lifecycle:
   - create
   - status running
   - completed
   - result writeback once
   - cancel does not override completed tasks
