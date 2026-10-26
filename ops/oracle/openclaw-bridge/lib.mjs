/**
 * lib.mjs — Pure utility functions for OpenClaw Bridge message recovery.
 * Extracted from server.mjs for testability.
 */

/* ── native attachment helpers ── */

export const NATIVE_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 5,
  maxSingleBytes: 16 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxGatewayFrameBytes: 25 * 1024 * 1024,
});

export class BridgeTaskError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "BridgeTaskError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function estimateBase64DecodedBytes(value) {
  const clean = value.replace(/\s+/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function decodeStrictBase64(value) {
  const clean = value.replace(/\s+/g, "");
  if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new BridgeTaskError("native_attachment_base64_invalid", "attachment contentBase64 is invalid base64");
  }
  const decoded = Buffer.from(clean, "base64");
  const normalizedInput = clean.replace(/=+$/, "");
  const normalizedOutput = decoded.toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedOutput) {
    throw new BridgeTaskError("native_attachment_base64_invalid", "attachment contentBase64 is invalid base64");
  }
  return { decoded, clean };
}

function sourceAttachments(body) {
  const nativeAttachments = body?.native_attachments;
  const legacyAttachments = body?.attachments;
  const source = nativeAttachments ?? legacyAttachments;
  if (source == null) return [];
  if (!Array.isArray(source)) {
    throw new BridgeTaskError("native_attachment_invalid", "native_attachments must be an array");
  }
  return source;
}

/**
 * Normalize Web AI Assistant Bridge native attachments into OpenClaw Gateway
 * chat.send attachments. This function intentionally returns only fields the
 * Gateway understands, so caller payloads and file ids cannot leak through.
 */
export function normalizeNativeAttachments(body, limits = NATIVE_ATTACHMENT_LIMITS) {
  const attachments = sourceAttachments(body);
  if (attachments.length === 0) {
    return {
      attachments: [],
      summary: {
        attachment_count: 0,
        attachment_total_bytes: 0,
        mime_types: [],
      },
    };
  }
  if (attachments.length > limits.maxCount) {
    throw new BridgeTaskError("native_attachment_too_large", `too many native attachments; max ${limits.maxCount}`);
  }

  let totalBytes = 0;
  const mimeTypes = [];
  const gatewayAttachments = attachments.map((attachment, index) => {
    if (!attachment || typeof attachment !== "object") {
      throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} must be an object`);
    }
    if (attachment.type !== "file") {
      throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} type must be file`);
    }
    const fileName = typeof attachment.fileName === "string" ? attachment.fileName.trim() : "";
    const mimeType = typeof attachment.mimeType === "string" ? attachment.mimeType.trim() : "";
    const contentBase64 = typeof attachment.contentBase64 === "string" ? attachment.contentBase64 : "";
    if (!fileName) throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} fileName is required`);
    if (!mimeType) throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} mimeType is required`);
    if (!contentBase64.trim()) {
      throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} contentBase64 is required`);
    }
    if (!Number.isInteger(attachment.size) || attachment.size < 0) {
      throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} size must be a non-negative integer`);
    }

    const estimatedBytes = estimateBase64DecodedBytes(contentBase64);
    if (estimatedBytes > limits.maxSingleBytes) {
      throw new BridgeTaskError("native_attachment_too_large", `native attachment ${index} exceeds the per-file size limit`);
    }

    const { decoded, clean } = decodeStrictBase64(contentBase64);
    if (decoded.length !== attachment.size) {
      throw new BridgeTaskError("native_attachment_invalid", `native attachment ${index} decoded size does not match size`);
    }
    if (decoded.length > limits.maxSingleBytes) {
      throw new BridgeTaskError("native_attachment_too_large", `native attachment ${index} exceeds the per-file size limit`);
    }

    totalBytes += decoded.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new BridgeTaskError("native_attachment_total_too_large", "native attachments exceed the total size limit");
    }
    mimeTypes.push(mimeType);
    return {
      type: "file",
      mimeType,
      fileName,
      content: clean,
    };
  });

  return {
    attachments: gatewayAttachments,
    summary: {
      attachment_count: gatewayAttachments.length,
      attachment_total_bytes: totalBytes,
      mime_types: [...new Set(mimeTypes)],
    },
  };
}

export function buildGatewayChatSendRequest({
  sessionKey,
  agentId,
  sessionId,
  message,
  idempotencyKey,
  timeoutMs,
  attachments = [],
}) {
  return {
    sessionKey,
    agentId,
    ...(sessionId ? { sessionId } : {}),
    message,
    deliver: false,
    idempotencyKey,
    ...(Number.isInteger(timeoutMs) ? { timeoutMs } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function estimateGatewayChatSendFrameBytes(request) {
  return Buffer.byteLength(JSON.stringify({
    jsonrpc: "2.0",
    id: "bridge-estimate",
    method: "chat.send",
    params: request,
  }));
}

export function assertGatewayFrameWithinLimit(request, limitBytes = NATIVE_ATTACHMENT_LIMITS.maxGatewayFrameBytes) {
  const frameBytes = estimateGatewayChatSendFrameBytes(request);
  if (frameBytes > limitBytes) {
    throw new BridgeTaskError("gateway_payload_too_large", "chat.send payload would exceed Gateway WebSocket frame limit", 413);
  }
  return frameBytes;
}

/* ── message helpers ── */

export function messageText(message) {
  if (!message) return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
      .join("");
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
      .join("");
  }
  return "";
}

export function extractHistoryMessages(result) {
  if (Array.isArray(result)) return result;
  for (const key of ["messages", "items", "history", "entries"]) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  return [];
}

export function isUserMessage(message) {
  return message?.role === "user" || message?.type === "user" || message?.author === "user";
}

export function isAssistantMessage(message) {
  return message?.role === "assistant" || message?.type === "assistant" || message?.author === "assistant";
}

export function messageTimestampMs(message) {
  const raw = message?.timestamp ?? message?.createdAt ?? message?.created_at ?? message?.time;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw < 10_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/* ── assistant message classification ── */

const FAILURE_PATTERNS = [
  /^The agent run failed before producing a reply\.?$/i,
];

const SUSPECT_PATTERNS = [
  /^我来检查一下/,
  /^现在让我/,
  /^我将/,
  /^我先/,
  /^Let me check/i,
  /^I'll check/i,
  /^I will check/i,
  /^Let me inspect/i,
  /^I'll inspect/i,
];

/**
 * Classify an assistant message text into one of:
 *   - "empty"              — no usable text
 *   - "failure_placeholder" — matches known failure/placeholder strings
 *   - "suspect_incomplete"  — matches transitional/filler phrases
 *   - "valid_final"         — a substantive, complete answer
 *
 * @param {string} text
 * @returns {"empty"|"failure_placeholder"|"suspect_incomplete"|"valid_final"}
 */
export function classifyAssistantMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "empty";
  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.test(trimmed)) return "failure_placeholder";
  }
  for (const pattern of SUSPECT_PATTERNS) {
    if (pattern.test(trimmed)) return "suspect_incomplete";
  }
  return "valid_final";
}

/* ── recovered assistant message finder ── */

export function messageRunId(message) {
  for (const value of [
    message?.runId,
    message?.run_id,
    message?.metadata?.runId,
    message?.metadata?.run_id,
    message?.identity?.runId,
    message?.identity?.run_id,
    message?.__openclaw?.runId,
    message?.__openclaw?.run_id,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function messageIdempotencyKey(message) {
  for (const value of [
    message?.idempotencyKey,
    message?.idempotency_key,
    message?.metadata?.idempotencyKey,
    message?.metadata?.idempotency_key,
    message?.identity?.idempotencyKey,
    message?.identity?.idempotency_key,
    message?.__openclaw?.idempotencyKey,
    message?.__openclaw?.idempotency_key,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function expectedUserTurnIdempotencyKey(task) {
  const runId = typeof task?.run_id === "string" && task.run_id.trim()
    ? task.run_id.trim()
    : typeof task?.idempotency_key === "string" ? task.idempotency_key.trim() : "";
  return runId ? `${runId}:user` : "";
}

export function messageStopReason(message) {
  for (const value of [message?.stopReason, message?.stop_reason, message?.metadata?.stopReason]) {
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return "";
}

/* ── OpenClaw assistant phases ──
 * OpenClaw marks provider commentary (progress narration) and the final answer
 * with an assistant phase: either a message-level `phase` or a per text block
 * `textSignature` JSON `{"v":1,"id":…,"phase":"commentary"|"final_answer"}`.
 * Tool calls are `toolCall` content blocks and end the message with
 * stopReason `toolUse`. A stopReason of `stop` alone does not end a run.
 */

const ASSISTANT_TEXT_BLOCK_TYPES = new Set(["text", "input_text", "output_text"]);
const TOOL_CALL_BLOCK_TYPES = new Set(["toolCall", "tool_call", "toolUse", "tool_use", "functionCall", "function_call"]);
const NON_FINAL_STOP_REASONS = new Set(["tooluse", "tool_use", "error", "aborted"]);

function normalizeAssistantPhase(value) {
  return value === "commentary" || value === "final_answer" ? value : "";
}

export function textBlockPhase(block) {
  const signature = block?.textSignature;
  if (typeof signature !== "string" || !signature.startsWith("{")) return "";
  try {
    const parsed = JSON.parse(signature);
    return parsed?.v === 1 ? normalizeAssistantPhase(parsed.phase) : "";
  } catch {
    return "";
  }
}

function isTextBlock(block) {
  return Boolean(block && typeof block === "object" && ASSISTANT_TEXT_BLOCK_TYPES.has(block.type));
}

function hasToolCallBlock(message) {
  return Array.isArray(message?.content)
    && message.content.some((block) => block && typeof block === "object" && TOOL_CALL_BLOCK_TYPES.has(block.type));
}

/**
 * Final-answer text of an assistant message, excluding commentary:
 *   - explicitly phased blocks: only `final_answer` blocks count;
 *   - otherwise the message-level phase decides; unphased (legacy) text counts.
 * Gateway display projections of stream segments (`openclawStreamFallback`)
 * are never a final answer.
 */
export function assistantFinalAnswerText(message) {
  if (!message || typeof message !== "object" || message.openclawStreamFallback) return "";
  const messagePhase = normalizeAssistantPhase(message.phase);
  if (!Array.isArray(message.content)) {
    return messagePhase === "commentary" ? "" : messageText(message);
  }
  const textBlocks = message.content.filter(isTextBlock);
  const explicitlyPhased = textBlocks.some((block) => textBlockPhase(block));
  return textBlocks
    .filter((block) => (explicitlyPhased ? textBlockPhase(block) === "final_answer" : messagePhase !== "commentary"))
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

/** An assistant message that cannot end a run: tool use, commentary-only, errors. */
export function isIntermediateAssistantMessage(message) {
  return hasToolCallBlock(message)
    || NON_FINAL_STOP_REASONS.has(messageStopReason(message))
    || !assistantFinalAnswerText(message).trim();
}

function isToolResultMessage(message) {
  const role = message?.role ?? message?.type;
  return role === "toolResult" || role === "tool_result" || role === "tool";
}

export function usableFinalText(value) {
  const text = typeof value === "string" ? value : assistantFinalAnswerText(value);
  const trimmed = text.trim();
  return trimmed && classifyAssistantMessage(trimmed) === "valid_final" ? text : "";
}

/**
 * Find this turn's final assistant reply in a chat history result.
 *
 * Ownership — the message must belong to this turn:
 *   - it carries this task's runId; or
 *   - it follows the durable user transcript record whose idempotency key is
 *     exactly `${task.run_id}:user` (OpenClaw's persisted turn identity).
 * Run end — history alone never proves the run ended. The caller supplies an
 * authoritative signal: `finalEventRunId` (the Gateway chat `final` event for
 * this run) or `runEnded` (Gateway `agent.wait` reported the run finished).
 * Finality — the message must be the last assistant/tool entry of the turn,
 * carry final-answer text (commentary excluded), have no tool calls and a
 * non-tool, non-error stopReason, and be substantive.
 *
 * @param {object|Array} historyResult — raw result from chat.history RPC
 * @param {{run_id?: string, idempotency_key?: string}} task
 * @param {{finalEventRunId?: string, runEnded?: boolean}} [options]
 */
export function findRecoveredAssistantMessage(historyResult, task, options = {}) {
  const messages = extractHistoryMessages(historyResult);
  const taskRunId = typeof task?.run_id === "string" ? task.run_id.trim() : "";
  const expectedUserKey = expectedUserTurnIdempotencyKey(task);
  const finalEventRunId = typeof options?.finalEventRunId === "string"
    ? options.finalEventRunId.trim()
    : "";
  const finalEventMatches = Boolean(finalEventRunId && taskRunId && finalEventRunId === taskRunId);
  const runEnded = finalEventMatches || options?.runEnded === true;

  // Forks copy timestamps and text. Neither is an ownership boundary. The
  // Gateway persists accepted user input under `${clientRunId}:user`, so only
  // that exact durable identity may delimit this turn when assistant run ids
  // are absent from the history projection.
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isUserMessage(message)) continue;
    if (expectedUserKey && messageIdempotencyKey(message) === expectedUserKey) {
      userIndex = index;
      break;
    }
  }

  const ownership = (message, index) => {
    const candidateRunId = messageRunId(message);
    if (candidateRunId && taskRunId && candidateRunId !== taskRunId) return null;
    const runMatches = Boolean(taskRunId && candidateRunId === taskRunId);
    let afterBoundary = userIndex >= 0 && index > userIndex;
    if (afterBoundary && messages.slice(userIndex + 1, index).some(isUserMessage)) afterBoundary = false;
    return runMatches || afterBoundary ? { runMatches, afterBoundary } : null;
  };

  // The newest assistant or tool entry of this turn; anything before it is
  // progress, never the final reply.
  let lastTurnActivityIndex = -1;
  const assistants = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isAssistantMessage(message) && !isToolResultMessage(message)) continue;
    const owned = ownership(message, index);
    if (!owned) continue;
    lastTurnActivityIndex = index;
    if (!isAssistantMessage(message)) continue;
    const text = assistantFinalAnswerText(message);
    assistants.push({
      message,
      text,
      index,
      classification: classifyAssistantMessage(text),
      intermediate: isIntermediateAssistantMessage(message),
      ...owned,
    });
  }

  const candidate = assistants.at(-1);
  if (runEnded && candidate && candidate.index === lastTurnActivityIndex
    && !candidate.intermediate && candidate.classification === "valid_final" && candidate.text.trim()) {
    return {
      message: candidate.message,
      text: candidate.text,
      match: candidate.runMatches ? "matching_run_id" : "matching_user_idempotency_boundary",
      messageCount: messages.length,
      selectedMessageIndex: candidate.index,
      classification: candidate.classification,
      fallback: false,
      evidence: {
        run_id_match: candidate.runMatches,
        user_idempotency_boundary_match: candidate.afterBoundary,
        stop_reason: messageStopReason(candidate.message),
        final_event_match: finalEventMatches,
        run_ended: runEnded,
      },
    };
  }

  return {
    message: null,
    text: "",
    match: userIndex >= 0 || assistants.length > 0 ? "evidence_incomplete" : "not_found",
    messageCount: messages.length,
    selectedMessageIndex: -1,
    classification: "empty",
    fallback: false,
    evidence: {
      run_id_match: assistants.some(item => item.runMatches),
      user_idempotency_boundary_match: userIndex >= 0,
      final_event_match: finalEventMatches,
      run_ended: runEnded,
      last_entry_is_final: Boolean(candidate && candidate.index === lastTurnActivityIndex && !candidate.intermediate),
    },
  };
}
