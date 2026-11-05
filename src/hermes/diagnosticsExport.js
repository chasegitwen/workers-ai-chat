// Sanitized, size-bounded export formatting for owner-scoped persisted diagnostics.
// Inputs must be the public diagnosticRun(detail=true) shape; this module never accepts
// raw upstream requests, prompts, answers, environment values, or tool payloads.

import { safeCode, safeMessage } from "./errors.js";

export const HERMES_DIAGNOSTICS_EXPORT_SCHEMA = "hermes.diagnostics.export.v1";
export const HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT = 50;
export const HERMES_DIAGNOSTICS_EXPORT_TIMELINE_LIMIT = 50;

const ERROR_FIELDS = new Set([
  "occurredAt", "sourceLayer", "runId", "sessionId", "jobId", "originalCode", "upstreamCode",
  "httpStatus", "summary", "category", "categoryConfidence", "facts", "inference", "suggestion",
  "statusAtError", "kind", "isFault"
]);
const SUMMARY_FIELDS = new Set([
  "category", "categoryConfidence", "isFault", "kind", "status", "sourceLayer", "summary",
  "occurredAt", "updatedAt", "runId", "originalCode", "statusDetail", "sessionId", "toolFailureCount"
]);

function boundedNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function safeIdentifier(value, max = 256) {
  return safeMessage(value == null ? "" : String(value), [], max) || null;
}

function sanitizeKnownObject(value, fields, maxString = 300) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!fields.has(key) || raw === undefined) continue;
    if (typeof raw === "string") out[key] = safeMessage(raw, [], maxString);
    else if (typeof raw === "boolean") out[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (Array.isArray(raw) && key === "facts") {
      out[key] = raw.slice(0, 20).map(item => safeMessage(String(item ?? ""), [], 300)).filter(Boolean);
    }
  }
  return out;
}

function sanitizeTimelineEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const name = safeMessage(event.event || "", [], 80);
  if (!name || name === "diagnostics.timeline_truncated") return null;
  const out = { event: name, seq: Number.isInteger(event.seq) ? event.seq : null };
  if (event.tool != null) out.tool = safeMessage(event.tool, [], 80);
  if (event.error === true || event.error === false) out.error = event.error;
  if (Number.isFinite(Number(event.duration))) out.duration = Math.max(0, Math.min(86_400_000, Number(event.duration)));
  if (event.status != null) out.status = safeMessage(event.status, [], 80);
  for (const [key, limit] of [["preview", 300], ["result", 500], ["goal", 300], ["summary", 500]]) {
    if (event[key] != null) out[key] = safeMessage(event[key], [], limit);
  }
  return out;
}

function sanitizeRun(run) {
  const timeline = (Array.isArray(run?.timeline) ? run.timeline : [])
    .slice(0, HERMES_DIAGNOSTICS_EXPORT_TIMELINE_LIMIT)
    .map(sanitizeTimelineEvent).filter(Boolean);
  const error = run?.error && typeof run.error === "object" ? {
    code: safeCode(run.error.code) || "hermes_run_error",
    message: safeMessage(run.error.message || "", [], 300)
  } : null;
  const model = run?.model && typeof run.model === "object" ? {
    provider: safeIdentifier(run.model.provider, 120),
    id: safeIdentifier(run.model.id, 160),
    source: run.model.source === "actual" ? "actual" : "requested"
  } : null;
  return {
    id: safeIdentifier(run?.id),
    status: safeIdentifier(run?.status, 80),
    upstreamStatus: safeIdentifier(run?.upstreamStatus, 80),
    statusDetail: safeIdentifier(run?.statusDetail, 160),
    startedAt: boundedNumber(run?.startedAt),
    durationMs: boundedNumber(run?.durationMs),
    instanceId: safeIdentifier(run?.instanceId, 160),
    projectId: safeIdentifier(run?.projectId, 160),
    conversationId: safeIdentifier(run?.conversationId, 160),
    upstreamSessionId: safeIdentifier(run?.upstreamSessionId, 200),
    model,
    error,
    primaryError: sanitizeKnownObject(run?.primaryError, ERROR_FIELDS),
    errors: (Array.isArray(run?.errors) ? run.errors : []).slice(0, 50)
      .map(value => sanitizeKnownObject(value, ERROR_FIELDS)).filter(Boolean),
    persistedSummary: sanitizeKnownObject(run?.persistedSummary, SUMMARY_FIELDS, 1000),
    timelineCoverage: ["available", "empty", "truncated", "expired_or_missing"].includes(run?.timelineCoverage)
      ? run.timelineCoverage : "expired_or_missing",
    timeline
  };
}

export function compactRuntimeHealth(health) {
  if (!health || health.overallStatus === "unavailable") return null;
  return {
    overallStatus: safeIdentifier(health.overallStatus, 80) || "unknown",
    checkedAt: boundedNumber(health.probedAt),
    lastSuccessAt: boundedNumber(health.lastSuccessfulProbeAt),
    backend: safeIdentifier(health.backend, 80) || "unknown",
    notes: (Array.isArray(health.notes) ? health.notes : []).slice(0, 8)
      .map(note => safeMessage(note, [], 240)).filter(Boolean)
  };
}

export function buildDiagnosticsExport({ scope, owner, runs, runtimeHealth = null, runsCapped = false, exportedAt = Date.now() }) {
  const sanitizedRuns = (Array.isArray(runs) ? runs : []).slice(0, HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT).map(sanitizeRun);
  const gaps = new Set();
  for (const run of sanitizedRuns) {
    if (run.timelineCoverage === "expired_or_missing") gaps.add("timeline_expired_or_missing");
    if (run.timelineCoverage === "empty") gaps.add("timeline_empty");
    if (run.timelineCoverage === "truncated") gaps.add("timeline_truncated");
    if (!run.persistedSummary) gaps.add("persisted_summary_absent");
  }
  if (!runtimeHealth) gaps.add("runtime_health_unavailable");
  if (runsCapped) gaps.add("session_runs_capped");
  const safeScope = scope?.type === "session"
    ? { type: "session", sessionId: safeIdentifier(scope.sessionId, 200), owner: safeIdentifier(owner, 160) }
    : { type: "run", runId: safeIdentifier(scope?.runId, 256), owner: safeIdentifier(owner, 160) };
  return {
    schema: HERMES_DIAGNOSTICS_EXPORT_SCHEMA,
    exportedAt: new Date(Number(exportedAt) || Date.now()).toISOString(),
    notes: [
      "Sanitized summary from owner-scoped D1 diagnostics; no raw prompts, answers, credentials, environment, or full tool output.",
      `At most ${HERMES_DIAGNOSTICS_EXPORT_RUN_LIMIT} runs and ${HERMES_DIAGNOSTICS_EXPORT_TIMELINE_LIMIT} public timeline events per run are included.`
    ],
    scope: safeScope,
    gaps: [...gaps],
    runs: sanitizedRuns,
    runtimeHealth
  };
}

function mdText(value) {
  return safeMessage(value == null ? "" : String(value), [], 1000)
    .replace(/([\\`*_[\]{}()#+.!|])/g, "\\$1")
    .replace(/</g, "‹").replace(/>/g, "›");
}

function mdTime(value) {
  if (value == null) return "unknown / 未知";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "unknown / 未知" : date.toISOString();
}

export function diagnosticsExportMarkdown(payload) {
  const lines = [
    "# Hermes 诊断摘要 / Diagnostics Summary", "",
    `- Schema: ${mdText(payload.schema)}`,
    `- Exported at / 导出时间: ${mdTime(payload.exportedAt)}`,
    `- Scope / 范围: ${mdText(payload.scope.type)}`,
    `- Owner / 所有者: ${mdText(payload.scope.owner)}`,
    payload.scope.runId ? `- Run: ${mdText(payload.scope.runId)}` : `- Session: ${mdText(payload.scope.sessionId)}`,
    "", "## 数据缺口 / Gaps", ""
  ];
  if (payload.gaps.length) payload.gaps.forEach(gap => lines.push(`- ${mdText(gap)}`));
  else lines.push("- none / 无");

  for (const run of payload.runs) {
    lines.push("", `## Run ${mdText(run.id)}`, "",
      `- Status / 状态: ${mdText(run.status || "unknown")}`,
      `- Upstream status / 上游状态: ${mdText(run.upstreamStatus || "unknown")}`,
      `- Status detail / 状态详情: ${mdText(run.statusDetail || "none")}`,
      `- Started / 开始: ${mdTime(run.startedAt)}`,
      `- Duration ms / 时长: ${run.durationMs == null ? "unknown" : run.durationMs}`,
      `- Instance: ${mdText(run.instanceId || "unknown")}`,
      `- Project: ${mdText(run.projectId || "unknown")}`,
      `- Conversation: ${mdText(run.conversationId || "unknown")}`,
      `- Session: ${mdText(run.upstreamSessionId || "unknown")}`);
    if (run.model) lines.push(`- Model / 模型: ${mdText(run.model.provider || "unknown")} / ${mdText(run.model.id || "unknown")} (${mdText(run.model.source)})`);
    lines.push("", "### 错误分类 / Error taxonomy", "");
    if (run.primaryError) {
      lines.push(`- Category / 分类: ${mdText(run.primaryError.category || "unrecognized")}`,
        `- Confidence / 置信度: ${mdText(run.primaryError.categoryConfidence || "unknown")}`,
        `- Summary / 摘要: ${mdText(run.primaryError.summary || "none")}`,
        `- Suggestion / 建议: ${mdText(run.primaryError.suggestion || "none")}`);
    } else lines.push("- No classified primary error / 无主要错误分类");
    if (run.error) lines.push(`- Error code / 错误码: ${mdText(run.error.code)} — ${mdText(run.error.message)}`);

    lines.push("", "### 持久化摘要 / Persisted summary", "");
    if (run.persistedSummary) lines.push(`- ${mdText(run.persistedSummary.summary || JSON.stringify(run.persistedSummary))}`);
    else lines.push("- Missing or expired / 缺失或已过期");

    lines.push("", "### 关键事件时间线 / Key event timeline", "",
      `Coverage / 覆盖: ${mdText(run.timelineCoverage)}`, "");
    if (run.timeline.length) {
      run.timeline.forEach(event => lines.push(`- ${event.seq == null ? "?" : event.seq} · ${mdText(event.event)} · ${mdText(event.tool || event.status || event.goal || "")} · ${mdText(event.result || event.summary || event.preview || "")}`));
    } else lines.push("- Timeline detail is missing, expired, or empty / 时间线详情缺失、已过期或为空");
  }

  lines.push("", "## 运行时健康 / Runtime health", "");
  if (payload.runtimeHealth) {
    lines.push(`- Overall / 总体: ${mdText(payload.runtimeHealth.overallStatus)}`,
      `- Backend: ${mdText(payload.runtimeHealth.backend)}`,
      `- Checked / 检查时间: ${mdTime(payload.runtimeHealth.checkedAt)}`,
      `- Last success / 最近成功: ${mdTime(payload.runtimeHealth.lastSuccessAt)}`);
    payload.runtimeHealth.notes.forEach(note => lines.push(`- Note / 备注: ${mdText(note)}`));
  } else lines.push("- Unavailable; export continued from D1 / 不可用；已继续从 D1 导出");
  lines.push("", "## 格式说明 / Format notes", "", ...payload.notes.map(note => `- ${mdText(note)}`), "");
  return lines.join("\n");
}
