# Oracle OpenClaw Bridge 1.3.0

The Oracle Phoenix Bridge between the Worker and the local OpenClaw Gateway.
Source of record for `oracle-bridge-1.3.0`. Runtime state (SQLite, identity,
callback secrets, `callback.json`) is not part of this package.

## Callback outbox

Callback events are written to the `callback_outbox` table of the task database
in the same `BEGIN IMMEDIATE` transaction as the task state transition and the
`tasks.callback_sequence` increment. A lost terminal compare-and-set rolls all
three back, so cancellation or a late final never creates an event.

Delivery is **at-least-once**: an event keeps its `event_id`, `sequence` and
payload across every retry and restart, and the Worker deduplicates by
`event_id`. Each HTTP attempt is signed with a fresh `X-OpenClaw-Timestamp`.

| status        | meaning                                                                 |
|---------------|-------------------------------------------------------------------------|
| `pending`     | waiting for first dispatch                                              |
| `sending`     | claimed under `lease_until`; a request may be in flight                 |
| `retrying`    | last attempt failed; due again at `next_retry_at`                       |
| `delivered`   | receiver answered 2xx                                                   |
| `dead_letter` | dispatch budget exhausted; kept until an administrator requeues it      |
| `superseded`  | an undelivered progress snapshot replaced by a newer snapshot or a terminal event |

- `dispatch_attempts` counts attempts in the current cycle that **may** have
  reached the receiver. It is incremented when the event is claimed, before the
  request, so a crash cannot undercount; it cannot prove whether the receiver
  got a request that was in flight during a crash.
- At most 5 automatic dispatches per cycle (`retry.max_attempts` can only lower
  this). When the lease of the fifth dispatch expires without a recorded
  outcome, the event goes to `dead_letter` without a sixth request.
- `attempts` is the lifetime total and survives requeue.
- Within one task, an event is dispatched only after every lower sequence is
  `delivered`, `dead_letter` or `superseded`, so a failing predecessor delays a
  final by at most its own dispatch budget. Across tasks, `bridge.final` and
  `bridge.error` go before `bridge.started`, and that before activity.
- `delivered` and `superseded` rows older than `retention.delivered_ms`
  (default 7 days) are pruned; `dead_letter` rows are kept.
- If callbacks are disabled or `url` / secret is missing, no row is claimed and
  no request is sent; events stay `pending`.
- Callback failures, recovery and requeue never call `chat.send`.

Administrator requeue (Bearer token required) keeps the `event_id` and payload
and resets only the dispatch budget:

```
POST /v1/openclaw/callbacks/<event_id>/requeue
```

## SQLite schema

`PRAGMA user_version` is `3`. Opening a v1.2.0 database (no version) or the
unreleased v1.2.1 development outbox migrates it in place inside one
transaction. A database with a newer version is refused.

## Identity

The Worker accepts callbacks for `oracle-openclaw` tasks only from Bridge ID
`oracle-phoenix-a1-openclaw-bridge` signed with `ORACLE_OPENCLAW_CALLBACK_SECRET`.
`bridge_id` in `callback.json` defaults to that value.

## Tests

```
node --test test/*.test.mjs
```

All tests use fake Gateways, temporary SQLite files and local HTTP receivers.
`gateway-runtime.test.mjs` needs the server's installed `openclaw` package, and
two `identity-store` tests assert POSIX file modes; both only pass on the Linux
host.
