// Owner-scoped, read-only diagnostics over persisted Hermes runs.
// Listing never contacts Hermes. A single-run detail refresh uses syncHermesRun, whose
// GET /v1/runs/{id} path is authoritative and never submits or retries a run.

import { safeCode, safeMessage, HermesError, publicError } from "./errors.js";
import { buildHermesErrorRecord, parseErrorCategory } from "./errorTaxonomy.js";
import { HERMES_ACTIVE_STATUSES } from "./status.js";
import { publicHermesRun, readRunById, syncHermesRun } from "./runs.js";
import { pruneHermesDiagnosticPayloads } from "./persistence.js";
import { isHermesSessionId } from "./client.js";
import { getHermesRuntimeHealth } from "./health.js";
import {
  HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT,
  buildDiagnosticsExport,
  compactRuntimeHealth,
  diagnosticsExportMarkdown
} from "./diagnosticsExport.js";

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
  error_code, error_message, last_event_seq, timeline_json, diagnostics_json, diagnostics_updated_at, submitted_at, completed_at,
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
    const timeline = (publicHermesRun(row)?.timeline || [])
      .filter(event => event?.event !== "diagnostics.timeline_truncated");
    const rawTruncated = parsed.some(event => event?.event === "diagnostics.timeline_truncated");
    if (!timeline.length && !rawTruncated) return { timeline: [], coverage: "empty" };
    return {
      timeline,
      coverage: (rawTruncated || timeline.length >= 50) ? "truncated" : "available"
    };
  } catch (err) {
    return { timeline: [], coverage: "expired_or_missing" };
  }
}

function diagnosticsErrors(row, timeline) {
  const records = [];
  for (const event of timeline.timeline) {
    if (event?.event !== "tool.completed" || event.error !== true) continue;
    records.push(buildHermesErrorRecord({
      occurredAt: null,
      sourceLayer: "hermes",
      runId: row.id,
      sessionId: row.upstream_session_id || undefined,
      summary: event.result || ("Tool " + (event.tool || "tool") + " failed"),
      status: row.status,
      statusDetail: row.status_detail,
      timelineToolError: true,
      timelineSeq: event.seq,
      tool: event.tool
    }));
  }
  const statusNeedsRecord = [
    "failed", "interrupted", "cancelled", "cancel_requested", "waiting_for_approval",
    "waiting_for_clarification", "unknown", "submission_unknown"
  ].includes(row.status);
  if (row.error_code || row.error_message || statusNeedsRecord) {
    records.push(buildHermesErrorRecord({
      occurredAt: Number(row.completed_at || row.updated_at) || null,
      sourceLayer: "worker",
      runId: row.id,
      sessionId: row.upstream_session_id || undefined,
      originalCode: row.error_code,
      summary: row.error_message || row.status_detail || row.status,
      status: row.status,
      statusDetail: row.status_detail,
      ambiguous: row.status === "submission_unknown"
    }));
  }
  return records;
}

function selectPrimaryError(records, status) {
  if (!records.length) return null;
  if (status === "unknown" || status === "submission_unknown") {
    return records.find(item => item.category === "unknown_execution") || records[records.length - 1] || null;
  }
  if (status === "cancelled" || status === "cancel_requested" || status === "waiting_for_approval" || status === "waiting_for_clarification" || status === "interrupted") {
    return records.find(item => !item.timelineSeq && item.kind) || records[records.length - 1] || null;
  }
  return records[0] || null;
}

function storedDiagnosticSummary(row) {
  if (!row?.diagnostics_json) return null;
  try {
    const value = JSON.parse(row.diagnostics_json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const category = parseErrorCategory(value.category);
    const out = {
      ...(category ? { category } : {}),
      categoryConfidence: value.categoryConfidence === "confirmed" ? "confirmed" : "inferred",
      isFault: value.isFault === true,
      kind: safeCode(value.kind) || "fault",
      status: safeCode(value.status) || row.status,
      sourceLayer: ["browser", "worker", "hermes"].includes(value.sourceLayer) ? value.sourceLayer : "worker",
      summary: safeMessage(value.summary || "", [], 1000),
      occurredAt: Number.isFinite(Number(value.occurredAt)) ? Number(value.occurredAt) : null,
      updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Number(row.diagnostics_updated_at) || null,
      runId: row.id
    };
    const originalCode = safeCode(value.originalCode);
    const statusDetail = safeMessage(value.statusDetail || "", [], 160);
    const sessionId = safeMessage(value.sessionId || "", [], 256);
    if (originalCode) out.originalCode = originalCode;
    if (statusDetail) out.statusDetail = statusDetail;
    if (sessionId) out.sessionId = sessionId;
    return out;
  } catch (err) {
    return null;
  }
}

function diagnosticRun(row, { detail = false, now = Date.now() } = {}) {
  const startedAt = Number(row.submitted_at || row.created_at) || null;
  const terminal = ["completed", "failed", "cancelled", "interrupted", "rejected", "abandoned"].includes(row.status);
  const endAt = Number(row.completed_at) || (!terminal && startedAt ? now : null);
  const model = row.actual_model || row.requested_model || null;
  const provider = row.actual_provider || row.requested_provider || null;
  const timeline = timelineInfo(row);
  const errors = diagnosticsErrors(row, timeline);
  const errorCode = safeCode(row.error_code);
  const errorMessage = safeMessage(row.error_message || "", [], 300);
  const persistedSummary = storedDiagnosticSummary(row);
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
    primaryError: selectPrimaryError(errors, row.status),
    errors,
    persistedSummary,
    dataSource: detail ? "D1 persisted run; Hermes authoritative sync when applicable" : "D1 persisted Hermes runs",
    updatedAt: Number(row.updated_at) || null,
    timelineCoverage: timeline.coverage,
    ...(detail ? { timeline: timeline.timeline } : {})
  };
}

let lastOpportunisticPruneAt = 0;
const OPPORTUNISTIC_PRUNE_INTERVAL_MS = 60 * 1000;

async function listDiagnostics(env, url, owner) {
  // M1: throttle opportunistic retention so most list GETs pay zero prune cost,
  // and always await when it does run (Vitest isolated storage cannot outlive the request).
  const now = Date.now();
  if (now - lastOpportunisticPruneAt >= OPPORTUNISTIC_PRUNE_INTERVAL_MS) {
    lastOpportunisticPruneAt = now;
    await pruneHermesDiagnosticPayloads(env, { limit: 50 });
  }
  const window = parseWindow(url.searchParams.get("window"));
  const filters = parseStatusFilters(url);
  const limit = integerParam(url, "limit", 30, 1, 100);
  const offset = integerParam(url, "offset", 0, 0, 100000);
  const categoryRaw = url.searchParams.get("error_category") || url.searchParams.get("category") || "";
  const category = parseErrorCategory(categoryRaw);
  if (categoryRaw && !category) {
    throw new HermesError("hermes_diagnostics_category_invalid", "Unsupported diagnostics error category", { httpStatus: 400 });
  }
  const cutoff = Date.now() - WINDOW_MS[window];
  const statuses = [...new Set(filters.flatMap(filter => FILTER_STATUSES[filter]))];
  const statusSql = statuses.length ? " AND status IN (" + statuses.map(() => "?").join(", ") + ")" : "";
  const bindings = [owner, cutoff, ...statuses];
  const where = "owner_username = ? AND COALESCE(submitted_at, created_at) >= ?" + statusSql;
  let rows;
  let total;
  if (category) {
    const CATEGORY_SCAN_CAP = 500;
    const rowsResult = await env.DB.prepare("SELECT " + DIAGNOSTIC_COLUMNS + " FROM hermes_runs WHERE " + where
      + " ORDER BY COALESCE(submitted_at, created_at) DESC, created_at DESC LIMIT ?").bind(...bindings, CATEGORY_SCAN_CAP).all();
    const scanned = rowsResult.results || [];
    const classified = scanned.map(row => diagnosticRun(row))
      .filter(run => run.errors.some(error => error.category === category));
    total = classified.length;
    const page = classified.slice(offset, offset + limit);
    return {
      ok: true,
      runs: page,
      window,
      filters,
      errorCategory: category,
      pagination: { limit, offset, total, hasMore: offset + page.length < total || scanned.length >= CATEGORY_SCAN_CAP },
      categoryScanCapped: scanned.length >= CATEGORY_SCAN_CAP,
      dataSource: "D1 persisted Hermes runs; taxonomy derived on read",
      updatedAt: Date.now(),
      emptyReason: total ? null : "No owned Hermes runs matched this error category in the selected window."
    };
  }
  const [rowsResult, countRow] = await Promise.all([
    env.DB.prepare("SELECT " + DIAGNOSTIC_COLUMNS + " FROM hermes_runs WHERE " + where
      + " ORDER BY COALESCE(submitted_at, created_at) DESC, created_at DESC LIMIT ? OFFSET ?")
      .bind(...bindings, limit, offset).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM hermes_runs WHERE " + where).bind(...bindings).first()
  ]);
  rows = rowsResult.results || [];
  total = Number(countRow?.total) || 0;
  return {
    ok: true,
    runs: rows.map(row => diagnosticRun(row)),
    window,
    filters,
    errorCategory: null,
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

function exportFormat(url) {
  const format = String(url.searchParams.get("format") || "md").toLowerCase();
  if (!["md", "json"].includes(format)) {
    throw new HermesError("hermes_diagnostics_export_format_invalid", "format must be md or json", { httpStatus: 400 });
  }
  return format;
}

function exportFilename(scopeId, format, now = Date.now()) {
  const safeId = String(scopeId || "summary").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "summary";
  const utc = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `hermes-diagnostics-${safeId}-${utc}.${format}`;
}

async function runtimeHealthForExport(env, instanceId, fetchImpl) {
  try {
    return compactRuntimeHealth(await getHermesRuntimeHealth(env, instanceId, { fetchImpl }));
  } catch (err) {
    return null;
  }
}

function diagnosticsExportResponse(payload, format, scopeId) {
  const body = format === "json" ? JSON.stringify(payload, null, 2) : diagnosticsExportMarkdown(payload);
  return new Response(body, { headers: {
    "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${exportFilename(scopeId, format)}"`,
    "Cache-Control": "no-store"
  } });
}

async function exportRunDiagnostics(env, url, runId, owner, { fetchImpl } = {}) {
  const format = exportFormat(url);
  // Re-check identity ownership at export time; never reuse a previously loaded detail object.
  const row = await env.DB.prepare("SELECT " + DIAGNOSTIC_COLUMNS + " FROM hermes_runs WHERE id = ? AND owner_username = ?")
    .bind(runId, owner).first();
  if (!row) throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
  const health = await runtimeHealthForExport(env, row.instance_id, fetchImpl);
  const payload = buildDiagnosticsExport({
    scope: { type: "run", runId }, owner,
    runs: [diagnosticRun(row, { detail: true })], runtimeHealth: health
  });
  return diagnosticsExportResponse(payload, format, runId);
}

async function exportSessionDiagnostics(env, url, sessionId, owner, { fetchImpl } = {}) {
  const format = exportFormat(url);
  if (!isHermesSessionId(sessionId)) {
    throw new HermesError("hermes_invalid_session_id", "Invalid Hermes session id", { httpStatus: 400 });
  }
  // Owner scope is in the same SELECT as the session id, so another user's session is indistinguishable from missing.
  const result = await env.DB.prepare("SELECT " + DIAGNOSTIC_COLUMNS
    + " FROM hermes_runs WHERE owner_username = ? AND upstream_session_id = ?"
    + " ORDER BY COALESCE(submitted_at, created_at) DESC, created_at DESC LIMIT ?")
    .bind(owner, sessionId, HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT + 1).all();
  const rows = result.results || [];
  if (!rows.length) throw new HermesError("hermes_session_not_found", "Hermes session not found", { httpStatus: 404 });
  const included = rows.slice(0, HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT);
  const health = await runtimeHealthForExport(env, included[0].instance_id, fetchImpl);
  const payload = buildDiagnosticsExport({
    scope: { type: "session", sessionId }, owner,
    runs: included.map(row => diagnosticRun(row, { detail: true })),
    runtimeHealth: health,
    runsCapped: rows.length > HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT
  });
  return diagnosticsExportResponse(payload, format, sessionId);
}

function decodedSessionId(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    throw new HermesError("hermes_invalid_session_id", "Invalid Hermes session id", { httpStatus: 400 });
  }
}

export async function handleHermesDiagnostics(request, env, url, { owner, fetchImpl, ctx } = {}) {
  if (url.pathname === "/api/hermes/diagnostics/runs") {
    if (request.method !== "GET") return null;
    return listDiagnostics(env, url, owner);
  }
  if (request.method !== "GET") return null;
  const runExport = url.pathname.match(/^\/api\/hermes\/diagnostics\/runs\/(hrun_[a-f0-9]{32})\/export$/);
  if (runExport) return exportRunDiagnostics(env, url, runExport[1], owner, { fetchImpl });
  const sessionExport = url.pathname.match(/^\/api\/hermes\/diagnostics\/sessions\/([^/]+)\/export$/);
  if (sessionExport) return exportSessionDiagnostics(env, url, decodedSessionId(sessionExport[1]), owner, { fetchImpl });
  const match = url.pathname.match(/^\/api\/hermes\/diagnostics\/runs\/(hrun_[a-f0-9]{32})$/);
  if (!match) return null;
  return diagnosticsDetail(env, match[1], owner, { fetchImpl });
}

export { diagnosticRun, parseStatusFilters, timelineInfo };
