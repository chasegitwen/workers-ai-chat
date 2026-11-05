// Sanitized, bounded run-detail events. Raw tool/subagent payloads never reach D1 or browsers.

import { safeCode, safeMessage } from "./errors.js";

export const HERMES_TIMELINE_LIMIT = 50;
const RESULT_PREVIEW_LIMIT = 500;
const ARG_PREVIEW_LIMIT = 300;
const REDACTION_INPUT_LIMIT = 16 * 1024;

function previewValue(value, limit) {
  if (value === null || value === undefined) return "";
  let text = "";
  if (typeof value === "string") text = value;
  else {
    try { text = JSON.stringify(value); } catch (err) { text = String(value); }
  }
  // Bound regex work, then redact before the final preview truncation so a credential
  // spanning the retained preview boundary cannot leak.
  return safeMessage(text.slice(0, REDACTION_INPUT_LIMIT), [], limit);
}

function safeDuration(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(86_400_000, Number(value))) : null;
}

function safeTool(value) {
  return safeCode(String(value || "").toLowerCase().replace(/[^a-z0-9_]/g, "_")) || "tool";
}

export function sanitizeHermesTimelineEvent(eventName, data = {}, seq = null) {
  const event = String(eventName || data.event || "");
  const out = { event, seq: Number.isInteger(seq) ? seq : (Number.isInteger(data.seq) ? data.seq : null) };
  if (event === "diagnostics.timeline_truncated") return { event: "diagnostics.timeline_truncated", seq: null };
  if (event === "tool.started") {
    out.tool = safeTool(data.tool);
    out.preview = previewValue(data.args_preview ?? data.preview ?? data.args, ARG_PREVIEW_LIMIT);
    return out;
  }
  if (event === "tool.completed") {
    out.tool = safeTool(data.tool);
    out.error = data.error === true;
    out.duration = safeDuration(data.duration ?? data.duration_ms);
    out.result = previewValue(data.result_preview ?? data.result ?? data.preview ?? data.summary, RESULT_PREVIEW_LIMIT);
    return out;
  }
  if (event === "subagent.start" || event === "subagent.complete") {
    out.status = safeCode(String(data.status || "").toLowerCase()) || (event.endsWith("complete") ? "completed" : "running");
    out.duration = safeDuration(data.duration ?? data.duration_ms);
    out.goal = previewValue(data.goal, ARG_PREVIEW_LIMIT);
    out.summary = previewValue(data.summary ?? data.result_preview ?? data.result, RESULT_PREVIEW_LIMIT);
    return out;
  }
  return null;
}

export function hermesTimelineEventKey(event) {
  if (Number.isInteger(event?.seq)) return "seq:" + event.seq;
  return [event?.event, event?.tool, event?.goal, event?.preview, event?.result, event?.summary].join("|");
}

export function mergeHermesTimeline(current, incoming) {
  const merged = [];
  const positions = new Map();
  for (const raw of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const event = sanitizeHermesTimelineEvent(raw?.event, raw, raw?.seq);
    if (!event) continue;
    const key = hermesTimelineEventKey(event);
    if (positions.has(key)) merged[positions.get(key)] = event;
    else {
      positions.set(key, merged.length);
      merged.push(event);
    }
  }
  return merged.slice(-HERMES_TIMELINE_LIMIT);
}

export function timelineEventsFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const source = Array.isArray(snapshot.timeline) ? snapshot.timeline
    : (Array.isArray(snapshot.tool_timeline) ? snapshot.tool_timeline
      : (Array.isArray(snapshot.events) ? snapshot.events : []));
  return mergeHermesTimeline([], source);
}
