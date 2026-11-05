// Pure, facts-first taxonomy for persisted Hermes diagnostics.
// HTTP status is deliberately never used as a classifier signal by itself.

import { safeCode, safeMessage } from "./errors.js";

export const HERMES_ERROR_CATEGORIES = Object.freeze([
  "provider_model",
  "tool_execution",
  "network_timeout_sse",
  "api_auth",
  "runtime_unavailable",
  "user_cancel_or_approval",
  "unknown_execution",
  "worker_d1_adapter",
  "unrecognized"
]);

const CATEGORY_SET = new Set(HERMES_ERROR_CATEGORIES);
const AUTH_CODES = new Set([
  "hermes_upstream_auth", "provider_auth_failed", "authentication_failed", "authorization_failed",
  "invalid_api_key", "unauthorized", "forbidden"
]);
const PROVIDER_CODES = new Set([
  "hermes_unknown_provider", "hermes_provider_unavailable", "hermes_unknown_model", "provider_unavailable",
  "unknown_provider", "unknown_model", "model_not_found", "model_failed", "provider_failed"
]);
const NETWORK_CODES = new Set([
  "hermes_timeout", "hermes_network_error", "hermes_stream_unavailable", "hermes_stream_closed",
  "network_error", "request_timeout", "sse_disconnected", "sse_connection_lost"
]);
const RUNTIME_CODES = new Set([
  "hermes_unavailable", "runtime_draining", "gateway_draining", "storage_unavailable", "chain_moved"
]);
const UNKNOWN_CODES = new Set([
  "hermes_submission_unknown", "hermes_unknown_execution", "hermes_run_unknown", "hermes_run_not_found",
  "hermes_upstream_not_found", "unknown_execution", "submission_unknown", "upstream_not_found"
]);
const ADAPTER_CODES = new Set([
  "hermes_internal_error", "hermes_no_database", "hermes_bad_response", "d1_error", "d1_unavailable",
  "worker_d1_error", "adapter_error", "timeline_write_failed"
]);
const TOOL_CODES = new Set([
  "tool_failed", "tool_error", "tool_execution_failed", "hermes_tool_error", "hermes_tool_failed"
]);
const WAITING_STATUSES = new Set(["waiting_for_approval", "waiting_for_clarification"]);
const CANCEL_STATUSES = new Set(["cancelled", "cancel_requested"]);
const UNKNOWN_STATUSES = new Set(["unknown", "submission_unknown"]);

function normalizedCode(value) {
  return safeCode(String(value || "").toLowerCase());
}

function codeMatches(code, exact, patterns = []) {
  return exact.has(code) || patterns.some(pattern => pattern.test(code));
}

function result(category, confidence, rationale, suggestion, { kind = "fault", isFault = true } = {}) {
  return {
    category,
    categoryConfidence: confidence,
    inference: confidence === "inferred" ? "Inferred: " + rationale : null,
    suggestion,
    kind,
    isFault
  };
}

export function parseErrorCategory(value) {
  const category = String(value || "").trim().toLowerCase();
  return CATEGORY_SET.has(category) ? category : "";
}

export function classifyHermesError(input = {}) {
  const originalCode = normalizedCode(input.originalCode || input.errorCode);
  const upstreamCode = normalizedCode(input.upstreamCode);
  const status = normalizedCode(input.status || input.statusAtError);
  const statusDetail = normalizedCode(input.statusDetail);
  // status_detail may carry turn_exit_reason / UI markers; do not treat it as an error-code classifier key.
  const codes = [originalCode, upstreamCode].filter(Boolean);
  const has = (set, patterns) => codes.some(code => codeMatches(code, set, patterns));

  // H1: unknown / submission_unknown outcome outranks transport or reject codes that may have led here.
  if (UNKNOWN_STATUSES.has(status) || statusDetail === "upstream_not_found" || statusDetail === "upstream_unknown"
    || has(UNKNOWN_CODES, [/unknown_execution$/, /submission_unknown$/, /upstream_not_found$/])) {
    return result("unknown_execution", "confirmed", "The stored status or code says the execution outcome is unknown.", "Manually reconcile or resolve the unknown run; do not automatically create or POST a replacement Run.");
  }
  if (WAITING_STATUSES.has(status)) {
    return result("user_cancel_or_approval", "confirmed", "The run is waiting for user approval or clarification, not failed.", "Provide the requested approval or clarification; this waiting state is not a production fault.", { kind: "waiting", isFault: false });
  }
  // H2: upstream cancel without a local stop request is a fault, not a user cancellation.
  if (status === "cancelled" && statusDetail === "cancelled_upstream_without_request") {
    return result("unrecognized", "confirmed", "Upstream reported cancelled without a local stop request; this is not a user cancellation.", "Inspect authoritative Run facts; do not present this as a user cancel and do not auto-create a replacement Run.", { kind: "upstream_cancel", isFault: true });
  }
  if (status === "interrupted" || statusDetail === "upstream_interrupted") {
    return result("unrecognized", "confirmed", "The stored run status records an interruption.", "Inspect authoritative Run facts before any manual retry; do not auto-create a replacement Run.", { kind: "interrupted", isFault: true });
  }
  if (CANCEL_STATUSES.has(status)) {
    return result("user_cancel_or_approval", "confirmed", "The stored run status records a user cancellation or cancellation request.", "Confirm the final authoritative state; normal user cancellation is not automatically a production fault.", { kind: "cancel", isFault: false });
  }
  if (input.timelineToolError === true) {
    return result("tool_execution", "confirmed", "Hermes timeline contains tool.completed with error=true.", "Inspect the sanitized tool failure facts; retry only after the tool issue is understood.");
  }
  if (has(TOOL_CODES, [/^tool_(?:failed|error)$/, /_tool_(?:error|failed)$/, /^hermes_tool_(?:error|failed)$/])) {
    return result("tool_execution", "confirmed", "An observed error code identifies a tool execution failure.", "Inspect the sanitized tool failure facts; retry only after the tool issue is understood.");
  }
  if (has(AUTH_CODES, [/(?:^|_)auth(?:entication|orization)?_(?:failed|error|rejected)$/, /invalid_(?:api_)?key/])) {
    return result("api_auth", "confirmed", "An observed error code identifies an authentication or authorization rejection.", "Verify the relevant API authorization outside diagnostics; do not expose credentials here.");
  }
  if (has(PROVIDER_CODES, [/(?:unknown|unsupported)_(?:provider|model)$/, /(?:provider|model)_(?:unavailable|failed|not_found)$/])) {
    return result("provider_model", "confirmed", "An observed error code identifies the provider or model layer.", "Check provider/model availability and configuration before a manual retry.");
  }
  if (has(RUNTIME_CODES, [/(?:runtime|gateway)_draining$/, /storage_unavailable$/])) {
    return result("runtime_unavailable", "confirmed", "An observed error code identifies runtime draining or unavailability.", "Wait for runtime readiness and verify health before a manual retry.");
  }
  // Avoid matching the substring "stream" inside unrelated codes such as hermes_upstream_error.
  if (has(NETWORK_CODES, [/(?:^|_)(?:network|timeout|sse)(?:_|$)/, /(?:^|_)stream_(?:error|unavailable|closed|lost)(?:_|$)/, /sse_(?:disconnected|connection_lost)/])) {
    const ambiguous = input.ambiguous === true || originalCode === "hermes_network_error";
    return result("network_timeout_sse", ambiguous ? "inferred" : "confirmed",
      ambiguous
        ? "The observed network/timeout signal may explain the interruption, but the execution outcome is not proven."
        : "An observed code identifies a network, timeout, or SSE transport failure.",
      ambiguous
        ? "Check and reconcile the existing Run manually; do not automatically create or POST a replacement Run."
        : "Check connectivity and authoritative Run state before a manual retry.");
  }
  if (has(ADAPTER_CODES, [/(?:^|_)d1_(?:error|unavailable|failed)$/, /adapter_(?:error|failed)$/])) {
    return result("worker_d1_adapter", "confirmed", "An observed error code identifies the Worker, D1, or adapter layer.", "Inspect Worker/D1 adapter diagnostics; retry only after persistence and adapter health are confirmed.");
  }
  if (status === "completed") {
    return result("unrecognized", "confirmed", "The stored run status records successful completion.", "No fault action is required.", { kind: "outcome", isFault: false });
  }
  return result("unrecognized", "inferred",
    codes.length || statusDetail ? "No documented taxonomy mapping matched the preserved code." : "No code, timeline tool failure, or classified run state was observed.",
    "Preserve the original facts and inspect manually; do not retry solely from this classification.");
}

function observedFacts(input, originalCode, upstreamCode, statusAtError, httpStatus) {
  const facts = [];
  if (input.timelineToolError === true) facts.push("Timeline fact: tool.completed error=true");
  if (input.tool) facts.push("Timeline tool: " + safeMessage(input.tool, [], 80));
  if (Number.isInteger(input.timelineSeq)) facts.push("Timeline sequence: " + input.timelineSeq);
  if (originalCode) facts.push("Observed original error code: " + originalCode);
  if (upstreamCode) facts.push("Observed upstream code: " + upstreamCode);
  if (statusAtError) facts.push("Stored run status: " + statusAtError);
  if (input.statusDetail) facts.push("Stored status detail: " + safeMessage(input.statusDetail, [], 120));
  if (httpStatus) facts.push("Observed HTTP status: " + httpStatus + " (supporting fact only)");
  return facts;
}

export function buildHermesErrorRecord(input = {}) {
  const originalCode = normalizedCode(input.originalCode || input.errorCode) || undefined;
  const upstreamCode = normalizedCode(input.upstreamCode) || undefined;
  const statusAtError = normalizedCode(input.status || input.statusAtError) || undefined;
  const httpStatus = Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599
    ? input.httpStatus : undefined;
  const classification = classifyHermesError({ ...input, originalCode, upstreamCode, statusAtError });
  return {
    occurredAt: Number.isFinite(Number(input.occurredAt)) ? Number(input.occurredAt) : null,
    sourceLayer: ["browser", "worker", "hermes"].includes(input.sourceLayer) ? input.sourceLayer : "worker",
    ...(input.runId ? { runId: String(input.runId) } : {}),
    ...(input.sessionId ? { sessionId: String(input.sessionId) } : {}),
    ...(input.jobId ? { jobId: String(input.jobId) } : {}),
    ...(originalCode ? { originalCode } : {}),
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    summary: safeMessage(input.summary || "", input.secrets || [], 300),
    category: classification.category,
    categoryConfidence: classification.categoryConfidence,
    facts: observedFacts(input, originalCode, upstreamCode, statusAtError, httpStatus),
    inference: classification.inference,
    suggestion: classification.suggestion,
    ...(statusAtError ? { statusAtError } : {}),
    kind: classification.kind,
    isFault: classification.isFault
  };
}
