// Local Hermes run states and the mapping from Hermes v0.22.5 run statuses.
//
// Upstream (GET /v1/runs/{id}): queued, running, waiting_for_approval, stopping, unknown
// (authority mode, not terminal), completed, failed, cancelled, interrupted.
// Local-only states:
//   reserving / submitting  slot taken, POST not yet answered
//   submission_unknown      POST outcome unknown (timeout, network, 5xx). Never auto-retried.
//   cancel_requested        stop requested, upstream confirmation pending
//   rejected                POST definitively refused; no upstream run exists
//   abandoned               operator released the slot after confirming on the Hermes side

export const HERMES_TERMINAL_STATUSES = Object.freeze([
  "completed", "failed", "cancelled", "interrupted", "rejected", "abandoned"
]);

export const HERMES_ACTIVE_STATUSES = Object.freeze([
  "reserving", "submitting", "submission_unknown", "queued", "running",
  "waiting_for_approval", "stopping", "cancel_requested", "unknown"
]);

const UPSTREAM_TO_LOCAL = Object.freeze({
  queued: "queued",
  started: "queued",
  running: "running",
  waiting_for_approval: "waiting_for_approval",
  stopping: "stopping",
  unknown: "unknown",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  interrupted: "interrupted"
});

export function isHermesTerminal(status) {
  return HERMES_TERMINAL_STATUSES.includes(status);
}

// Returns the local status for an upstream status, or "" when unrecognized. Callers keep
// the current local status for unrecognized values rather than guessing an outcome.
export function mapHermesUpstreamStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UPSTREAM_TO_LOCAL, key) ? UPSTREAM_TO_LOCAL[key] : "";
}

export function sqlStatusList(statuses) {
  return statuses.map(status => "'" + status + "'").join(", ");
}
