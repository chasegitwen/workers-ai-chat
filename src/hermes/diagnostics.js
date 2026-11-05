// Owner-scoped, read-only diagnostics over persisted Hermes runs.
// Listing never contacts Hermes. A single-run detail refresh uses syncHermesRun, whose
// GET /v1/runs/{id} path is authoritative and never submits or retries a run.

import { safeCode, safeMessage, HermesError, publicError } from "./errors.js";
import { HERMES_ACTIVE_STATUSES } from "./status.js";
import { publicHermesRun, readRunById, syncHermesRun } from "./runs.js";

const WINDOW_MS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
});

const FILTER_STATUSES = Object.freeze({
  failed: ["failed"],
  cancelled: ["cancelled"],
  interrupted: ["interrupted"],
  unknown: ["unknown", "submission_unknown"],
  stopping: ["stopping", "cancel_requested"],
  success: ["completed"],
  completed: ["completed"],
  active: HERMES_ACTIVE_STATUSES
});

const DIAGNOSTIC_COLUMNS = `id, owner_username, project_id, conversation_id, instance_id,
  upstream_run_id, upstream_session_id, model_mode, requested_provider, requested_model,
  actual_provider, actual_model, route_source, status, upstream_status, status_detail,
  error_code, error_message, last_event_seq, timeline_json, submitted_at, completed_at,
  created_at, updated_at`;

function parseWindow(value) {
  const key = String(value || "24h").trim().toLowerCase();
  if (!WINDOW_MS[key]) throw new HermesError("hermes_diagnostics_window_invalid", "window must be 24h, 7d, or 30d", { httpStatus: 400 });
  return key;
}

function parseStatusFilters(url) {
  const raw = url.searchParams.getAll("status").flatMap(value => String(value).split(","));
  const filters = [...new Set(raw.map(value => value.trim().toLowerCase()).filter(Boolean))];
  for (const filter of filters) {
    if (!FILTER_STATUSES[filter]) {
      throw new HermesError("hermes_diagnostics_status_invalid", "Unsupported diagnostics status filter", { httpStatus: 400 });
    }
  }
  return filters;
}

function integerParam(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HermesError("hermes_diagnostics_pagination_invalid", name + " is out of range", { httpStatus: 400 });
  }
  return value;
}

function timelineInfo(row) {
  if (!row?.timeline_json) return { timeline: [], coverage: "expired_or_missing" };
  try {
    const parsed = JSON.parse(row.timeline_json);
    if (!Array.isArray(parsed)) return { timeline: [], coverage: "expired_or_missing" };
    const timeline = publicHermesRun(row)?.timeline || [];
    if (!timeline.length) return { timeline: [], coverage: "empty" };
    return { timeline, coverage: timeline.length >= 50 ? "truncated" : "available" };
  } catch (err) {
    return { timeline: [], coverage: "expired_or_missing" };
  }
}

function diagnosticRun(row, { detail = false, now = Date.now() } = {}) {
  const startedAt = Number(row.submitted_at || row.created_at) || null;
  const terminal = ["completed", "failed", "cancelled", "interrupted", "rejected", "abandoned"].includes(row.status);
  const endAt = Number(row.completed_at) || (!terminal && startedAt ? now : null);
  const model = row.actual_model || row.requested_model || null;
  const provider = row.actual_provider || row.requested_provider || null;
  const timeline = timelineInfo(row);
  const errorCode = safeCode(row.error_code);
  const errorMessage = safeMessage(row.error_message || "", [], 300);
  return {
    id: row.id,
    startedAt,
    durationMs: startedAt && endAt ? Math.max(0, endAt - startedAt) : null,
    durationRunning: !terminal,
    status: row.status,
    upstreamStatus: row.upstream_status || null,
    statusDetail: safeMessage(row.status_detail || "", [], 160) || null,
    instanceId: row.instance_id,
    executionEnvironment: row.instance_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    upstreamSessionId: row.upstream_session_id || null,
    model: model ? { provider, id: model, source: row.actual_model ? "actual" : "requested" } : null,
    error: errorCode || errorMessage ? { code: errorCode || "hermes_run_error", message: errorMessage } : null,
    dataSource: detail ? "D1 persisted run; Hermes authoritative sync when applicable" : "D1 persisted Hermes runs",
    updatedAt: Number(row.updated_at) || null,
    timelineCoverage: timeline.coverage,
    ...(detail ? { timeline: timeline.timeline } : {})
  };
}

async function listDiagnostics(env, url, owner) {
  const window = parseWindow(url.searchParams.get("window"));
  const filters = parseStatusFilters(url);
  const limit = integerParam(url, "limit", 30, 1, 100);
  const offset = integerParam(url, "offset", 0, 0, 100000);
  const cutoff = Date.now() - WINDOW_MS[window];
  const statuses = [...new Set(filters.flatMap(filter => FILTER_STATUSES[filter]))];
  const statusSql = statuses.length ? " AND status IN (" + statuses.map(() => "?").join(", ") + ")" : "";
  const bindings = [owner, cutoff, ...statuses];
  const where = "owner_username = ? AND COALESCE(submitted_at, created_at) >= ?" + statusSql;
  const [rowsResult, countRow] = await Promise.all([
    env.DB.prepare("SELECT " + DIAGNOSTIC_COLUMNS + " FROM hermes_runs WHERE " + where
      + " ORDER BY COALESCE(submitted_at, created_at) DESC, created_at DESC LIMIT ? OFFSET ?")
      .bind(...bindings, limit, offset).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM hermes_runs WHERE " + where).bind(...bindings).first()
  ]);
  const rows = rowsResult.results || [];
  const total = Number(countRow?.total) || 0;
  return {
    ok: true,
    runs: rows.map(row => diagnosticRun(row)),
    window,
    filters,
    pagination: { limit, offset, total, hasMore: offset + rows.length < total },
    dataSource: "D1 persisted Hermes runs",
    updatedAt: Date.now(),
    emptyReason: total ? null : (filters.length
      ? "No owned Hermes runs matched these statuses in the selected window."
      : "No owned Hermes run history is persisted in the selected window.")
  };
}

async function diagnosticsDetail(env, runId, owner, { fetchImpl } = {}) {
  const owned = await env.DB.prepare("SELECT " + DIAGNOSTIC_COLUMNS + " FROM hermes_runs WHERE id = ? AND owner_username = ?")
    .bind(runId, owner).first();
  if (!owned) throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
  const fullRow = await readRunById(env.DB, runId);
  const { run, syncError } = await syncHermesRun(env, fullRow, { fetchImpl });
  return {
    ok: true,
    run: diagnosticRun(run, { detail: true }),
    syncError: syncError ? publicError(syncError) : null
  };
}

export async function handleHermesDiagnostics(request, env, url, { owner, fetchImpl } = {}) {
  if (url.pathname === "/api/hermes/diagnostics/runs") {
    if (request.method !== "GET") return null;
    return listDiagnostics(env, url, owner);
  }
  const match = url.pathname.match(/^\/api\/hermes\/diagnostics\/runs\/(hrun_[a-f0-9]{32})$/);
  if (!match || request.method !== "GET") return null;
  return diagnosticsDetail(env, match[1], owner, { fetchImpl });
}

export { diagnosticRun, parseStatusFilters, timelineInfo };
