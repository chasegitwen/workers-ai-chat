// Fail-soft, size-bounded persistence for compact Hermes diagnostics and retention.

import { safeMessage } from "./errors.js";
import { buildHermesErrorRecord } from "./errorTaxonomy.js";

export const HERMES_DIAGNOSTICS_MAX_BYTES = 4 * 1024;
export const HERMES_TIMELINE_MAX_BYTES = 16 * 1024;
export const HERMES_DIAGNOSTICS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const HERMES_RETENTION_BATCH_MAX = 500;

const MEANINGFUL_STATUSES = new Set([
  "completed", "failed", "rejected", "cancelled", "interrupted", "abandoned",
  "unknown", "submission_unknown", "cancel_requested", "waiting_for_approval", "waiting_for_clarification"
]);

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function serializeCappedTimeline(events, maxBytes = HERMES_TIMELINE_MAX_BYTES) {
  const retained = Array.isArray(events) ? [...events] : [];
  let truncated = false;
  let json = JSON.stringify(retained);
  while (retained.length && byteLength(json) > maxBytes) {
    truncated = true;
    // Drop ordinary events first; keep a single truncation marker if present.
    const dropAt = retained.findIndex(event => event?.event !== "diagnostics.timeline_truncated");
    if (dropAt < 0) break;
    retained.splice(dropAt, 1);
    json = JSON.stringify(retained);
  }
  if (truncated && !retained.some(event => event?.event === "diagnostics.timeline_truncated")) {
    retained.unshift({ event: "diagnostics.timeline_truncated" });
    json = JSON.stringify(retained);
    while (retained.length > 1 && byteLength(json) > maxBytes) {
      retained.splice(1, 1);
      json = JSON.stringify(retained);
    }
  }
  return json;
}

function latestToolFailure(row) {
  if (!row?.timeline_json) return null;
  try {
    const timeline = JSON.parse(row.timeline_json);
    if (!Array.isArray(timeline)) return null;
    return [...timeline].reverse().find(event => event?.event === "tool.completed" && event.error === true) || null;
  } catch (err) {
    return null;
  }
}

function countToolFailures(row) {
  if (!row?.timeline_json) return 0;
  try {
    const timeline = JSON.parse(row.timeline_json);
    if (!Array.isArray(timeline)) return 0;
    return timeline.filter(event => event?.event === "tool.completed" && event.error === true).length;
  } catch (err) {
    return 0;
  }
}

function compactRecord(row, now) {
  const toolFailureCount = countToolFailures(row);
  // M2: a completed run is not a fault even if intermediate tools failed and recovered.
  if (row.status === "completed") {
    return {
      category: "unrecognized",
      categoryConfidence: "confirmed",
      isFault: false,
      kind: "completed",
      status: "completed",
      ...(row.status_detail ? { statusDetail: safeMessage(row.status_detail, [], 160) } : {}),
      sourceLayer: row.upstream_run_id ? "hermes" : "worker",
      summary: toolFailureCount
        ? ("Run completed successfully after " + toolFailureCount + " intermediate tool failure(s).")
        : "Run completed successfully.",
      occurredAt: Number(row.completed_at || row.updated_at || now) || now,
      updatedAt: now,
      runId: row.id,
      toolFailureCount,
      ...(row.upstream_session_id ? { sessionId: String(row.upstream_session_id).slice(0, 256) } : {})
    };
  }
  const toolFailure = latestToolFailure(row);
  const record = buildHermesErrorRecord({
    occurredAt: Number(row.completed_at || row.updated_at || now) || now,
    sourceLayer: row.upstream_run_id ? "hermes" : "worker",
    runId: row.id,
    sessionId: row.upstream_session_id || undefined,
    originalCode: row.error_code || undefined,
    summary: row.error_message || row.status_detail || row.status,
    status: row.status,
    statusDetail: row.status_detail,
    // Only treat tool failure as the classifier when the run did not complete successfully.
    timelineToolError: Boolean(toolFailure) && row.status !== "completed",
    timelineSeq: toolFailure?.seq,
    tool: toolFailure?.tool,
    ambiguous: row.status === "submission_unknown"
  });
  return {
    category: record.category,
    categoryConfidence: record.categoryConfidence,
    isFault: record.isFault,
    kind: record.kind,
    ...(record.originalCode ? { originalCode: record.originalCode } : {}),
    status: row.status,
    ...(row.status_detail ? { statusDetail: safeMessage(row.status_detail, [], 160) } : {}),
    sourceLayer: record.sourceLayer,
    summary: safeMessage(record.summary, [], 1000),
    occurredAt: record.occurredAt,
    updatedAt: now,
    runId: row.id,
    toolFailureCount,
    ...(row.upstream_session_id ? { sessionId: String(row.upstream_session_id).slice(0, 256) } : {})
  };
}

function sameDiagnostic(existingJson, next) {
  if (!existingJson) return false;
  try {
    const existing = JSON.parse(existingJson);
    return ["category", "categoryConfidence", "isFault", "kind", "originalCode", "status",
      "statusDetail", "sourceLayer", "summary", "runId", "sessionId"]
      .every(key => existing?.[key] === next?.[key]);
  } catch (err) {
    return false;
  }
}

export function serializeDiagnosticSummary(summary, maxBytes = HERMES_DIAGNOSTICS_MAX_BYTES) {
  const capped = { ...summary };
  let json = JSON.stringify(capped);
  if (byteLength(json) <= maxBytes) return json;
  // Only free-text fields are truncated; structured facts remain exact.
  for (const key of ["summary", "statusDetail"]) {
    let text = String(capped[key] || "");
    while (text && byteLength(json) > maxBytes) {
      const nextLength = Math.max(0, Math.floor(text.length * 0.75));
      text = text.slice(0, nextLength);
      capped[key] = text ? text + "..." : "[truncated to size cap]";
      json = JSON.stringify(capped);
    }
  }
  if (byteLength(json) > maxBytes) {
    capped.summary = "[truncated to size cap]";
    delete capped.statusDetail;
    json = JSON.stringify(capped);
  }
  return byteLength(json) <= maxBytes ? json : null;
}

export async function persistHermesDiagnosticSummary(env, runId) {
  if (!env?.DB || !runId) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const row = await env.DB.prepare(
        `SELECT id, upstream_run_id, upstream_session_id, status, status_detail, error_code,
                error_message, timeline_json, completed_at, updated_at, diagnostics_json
         FROM hermes_runs WHERE id = ?`
      ).bind(runId).first();
      if (!row || (!MEANINGFUL_STATUSES.has(row.status) && !row.error_code)) return false;
      const now = Date.now();
      const summary = compactRecord(row, now);
      if (sameDiagnostic(row.diagnostics_json, summary)) return false;
      const json = serializeDiagnosticSummary(summary);
      if (!json) return false;
      await env.DB.prepare(
        "UPDATE hermes_runs SET diagnostics_json = ?, diagnostics_updated_at = ? WHERE id = ?"
      ).bind(json, now, runId).run();
      return true;
    } catch (err) {
      if (attempt === 1) {
        console.warn("[hermes] diagnostic_write_failed", { run_id: runId });
        return false;
      }
    }
  }
  return false;
}

export async function pruneHermesDiagnosticPayloads(env, { now = Date.now(), limit = HERMES_RETENTION_BATCH_MAX } = {}) {
  if (!env?.DB) return 0;
  const batch = Math.max(1, Math.min(HERMES_RETENTION_BATCH_MAX, Number(limit) || HERMES_RETENTION_BATCH_MAX));
  try {
    const result = await env.DB.prepare(
      `UPDATE hermes_runs
       SET timeline_json = NULL, diagnostics_json = NULL, diagnostics_updated_at = NULL
       WHERE id IN (
         SELECT id FROM hermes_runs
         WHERE COALESCE(completed_at, updated_at, created_at) < ?
           AND (timeline_json IS NOT NULL OR diagnostics_json IS NOT NULL)
         ORDER BY COALESCE(completed_at, updated_at, created_at) ASC
         LIMIT ?
       )`
    ).bind(now - HERMES_DIAGNOSTICS_RETENTION_MS, batch).run();
    return Number(result?.meta?.changes) || 0;
  } catch (err) {
    console.warn("[hermes] diagnostic_retention_failed");
    return 0;
  }
}
