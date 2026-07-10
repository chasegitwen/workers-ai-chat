const BRIDGE_TIMEOUT_MS = 30000;
export const OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER = "The agent run failed before producing a reply.";

function normalizeOpenClawExecutionMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "bridge" || mode === "true") {
    return "bridge";
  }
  return "legacy";
}

export function isOpenClawBridgeModeEnabled(env) {
  return shouldUseOpenClawBridge({ type: "openclaw" }, env);
}

export function shouldUseOpenClawBridge(provider, env) {
  const providerType = String(provider?.type || provider?.provider || provider?.id || "").trim().toLowerCase();
  if (providerType !== "openclaw") {
    return false;
  }

  const mode = provider?.openclawExecutionMode === undefined
    ? normalizeOpenClawExecutionMode(env?.OPENCLAW_BRIDGE_MODE)
    : normalizeOpenClawExecutionMode(provider.openclawExecutionMode);
  return mode === "bridge";
}

export function normalizeOpenClawAgentId(modelLike) {
  const values = typeof modelLike === "object" && modelLike !== null
    ? [
      modelLike.modelName,
      modelLike.upstreamModelName,
      modelLike.model,
      modelLike.id,
      modelLike.modelId
    ]
    : [modelLike];
  const agentAliases = new Map([
    ["main", "main"],
    ["glm51", "glm51"],
    ["glm-5.1", "glm51"],
    ["glm-5-1", "glm51"],
    ["glm5.1", "glm51"],
    ["glm 5.1", "glm51"],
    ["zai/glm-5.1", "glm51"],
    ["glm5-2", "glm5-2"],
    ["glm52", "glm5-2"],
    ["glm-5.2", "glm5-2"],
    ["glm-5-2", "glm5-2"],
    ["glm5.2", "glm5-2"],
    ["glm 5.2", "glm5-2"],
    ["zai/glm-5.2", "glm5-2"],
    ["kimi-for-coding", "kimi-for-coding"],
    ["kimi/kimi-for-coding", "kimi-for-coding"]
  ]);

  for (const value of values) {
    let text = String(value || "").trim();
    if (!text) {
      continue;
    }

    const normalized = text.toLowerCase();
    if (normalized.startsWith("openclaw/")) {
      text = text.slice("openclaw/".length);
    } else if (agentAliases.has(normalized)) {
      return agentAliases.get(normalized);
    }

    const agent = text.trim().toLowerCase();
    if (agentAliases.has(agent)) {
      return agentAliases.get(agent);
    }

    if (agent.includes("kimi-for-coding")) {
      return "kimi-for-coding";
    }
    if (agent.includes("glm-5.1") || agent.includes("glm-5-1") || agent.includes("glm51")) {
      return "glm51";
    }
    if (agent.includes("glm-5.2") || agent.includes("glm-5-2") || agent.includes("glm5-2") || agent.includes("glm52")) {
      return "glm5-2";
    }
  }

  return "main";
}

export function normalizeOpenClawBridgeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function normalizeProgressValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function isOpenClawBridgeSuccessStatus(status) {
  return ["completed", "complete", "done", "success", "succeeded"].includes(String(status || "").trim().toLowerCase());
}

function isOpenClawBridgeFailedStatus(status) {
  return ["failed", "failure", "error"].includes(String(status || "").trim().toLowerCase());
}

export function shouldRecoverOpenClawBridgeCompletedStatus(localStatus, remoteStatus) {
  const local = String(localStatus || "").trim().toLowerCase();
  return ["failed", "failure", "error", "aborted"].includes(local)
    && isOpenClawBridgeSuccessStatus(remoteStatus);
}

export function isOpenClawBridgeEmptyReplyPlaceholder(value) {
  return String(value || "").trim() === OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER;
}

export function classifyOpenClawBridgeResultFinality(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "empty";
  }
  if (isOpenClawBridgeEmptyReplyPlaceholder(text)) {
    return "placeholder";
  }
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  const completionMarkers = [
    /\u4ee5\u4e0b\u662f/,
    /\u603b\u7ed3/,
    /\u67e5\u5b8c\u4e86/,
    /\u67e5\u8be2\u7ed3\u679c/,
    /\u7ed3\u679c\u5982\u4e0b/,
    /\u5b8c\u6210\u60c5\u51b5\u5982\u4e0b/,
    /\u5df2\u5b8c\u6210/,
    /\u6839\u636e\u67e5\u8be2\u7ed3\u679c/,
    /Here is/i,
    /Summary/i
  ];
  if (completionMarkers.some(pattern => pattern.test(text))) {
    return "final";
  }
  if (text.length <= 180) {
    const suspectLeadIn = [
      /^我来(?:先)?(?:检查|查看|确认|分析|获取|提取|通过|继续)/,
      /^现在让我(?:先)?(?:检查|查看|确认|分析|获取|提取|通过|继续)/,
      /^我将(?:先)?(?:检查|查看|确认|分析|获取|提取|通过|继续)/,
      /^让我(?:先)?(?:检查|查看|确认|分析|获取|提取|通过|继续)/,
      /^Let me (?:check|inspect|look|fetch|get|analy[sz]e|continue)/i,
      /^I'll (?:check|inspect|look|fetch|get|analy[sz]e|continue)/i,
      /^I will (?:check|inspect|look|fetch|get|analy[sz]e|continue)/i,
      /^I'm going to (?:check|inspect|look|fetch|get|analy[sz]e|continue)/i,
      /^Now let me (?:check|inspect|look|fetch|get|analy[sz]e|continue)/i
    ];
    if (suspectLeadIn.some(pattern => pattern.test(text))) {
      return "suspect_incomplete";
    }
  }
  const midLeadInShortEnough = hasCjk ? text.length <= 120 : text.length <= 250;
  if (midLeadInShortEnough) {
    const suspectMidLeadIn = [
      /\u8ba9\u6211\u67e5\u4e00\u4e0b/,
      /\u8ba9\u6211\u68c0\u67e5/,
      /\u6211\u518d\u67e5/,
      /\u6211\u5148\u67e5/,
      /\u73b0\u5728\u67e5\u4e00\u4e0b/,
      /\u7ee7\u7eed\u67e5\u4e00\u4e0b/,
      /\u67e5\u4e00\u4e0b\u5404\u81ea/,
      /\u627e\u51fa/,
      /\u6211\u6765\u4e3a\u60a8\u67e5\u8be2\u4e00\u4e0b/,
      /\u6211\u6765\u67e5\u8be2\u4e00\u4e0b/,
      /\u6211\u4e3a\u60a8\u67e5\u8be2\u4e00\u4e0b/,
      /\u4e3a\u60a8\u67e5\u8be2\u4e00\u4e0b/,
      /\u67e5\u8be2\u4e00\u4e0b\u76f8\u5173\u4fe1\u606f/,
      /\u6211\u6765\u5e2e\u60a8\u67e5\u8be2/,
      /\u6211\u6765\u5e2e\u4f60\u67e5\u8be2/,
      /\u6211\u5e2e\u60a8\u67e5\u4e00\u4e0b/,
      /\u6211\u5e2e\u4f60\u67e5\u4e00\u4e0b/,
      /Let me check/i,
      /I'll check/i,
      /I will check/i
    ];
    if (suspectMidLeadIn.some(pattern => pattern.test(text))) {
      return "suspect_incomplete";
    }
  }
  return "final";
}

function bridgeCandidateText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          return item.text || item.content || "";
        }
        return "";
      })
      .filter(Boolean)
      .join("")
      .trim();
  }
  if (value && typeof value === "object") {
    return bridgeCandidateText(
      value.final_answer
      ?? value.finalAnswer
      ?? value.result
      ?? value.answer
      ?? value.output
      ?? value.response
      ?? value.text
      ?? value.content
      ?? value.message
      ?? ""
    );
  }
  return "";
}

function bridgeCandidateNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function bridgeCandidateTime(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isBridgeAssistantCandidate(item) {
  const role = String(item?.role || item?.author?.role || item?.speaker || "").trim().toLowerCase();
  const type = String(item?.type || item?.event || item?.kind || item?.name || "").trim().toLowerCase();
  return role === "assistant"
    || role === "ai"
    || type === "assistant"
    || type === "assistant_message"
    || type === "message"
    || type === "final_answer"
    || type === "output";
}

function isBridgeSuccessfulCandidate(item) {
  const status = String(item?.status || item?.state || item?.stopReason || item?.stop_reason || item?.reason || "").trim().toLowerCase();
  if (["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(status)) {
    return false;
  }
  if (item?.error) {
    return false;
  }
  return true;
}

function collectBridgeFinalAnswerCandidates(source, candidates, state, options = {}) {
  if (!source) {
    return;
  }
  if (Array.isArray(source)) {
    source.forEach(item => collectBridgeFinalAnswerCandidates(item, candidates, state, {
      ...options,
      fromList: true
    }));
    return;
  }
  if (typeof source !== "object") {
    const text = bridgeCandidateText(source);
    if (text) {
      candidates.push({
        text,
        placeholder: isOpenClawBridgeEmptyReplyPlaceholder(text),
        finality: classifyOpenClawBridgeResultFinality(text),
        successful: options.successful !== false,
        seq: options.seq ?? null,
        timestamp: options.timestamp ?? null,
        order: state.order++,
        priority: options.priority ?? 0
      });
    }
    return;
  }

  const seq = bridgeCandidateNumber(source.seq, source.sequence, source.index, source.offset, options.seq);
  const timestamp = bridgeCandidateTime(source.timestamp, source.created_at, source.createdAt, source.time, source.updated_at, source.updatedAt, options.timestamp);
  const successful = options.successful !== false && isBridgeSuccessfulCandidate(source);
  const assistant = !options.fromList || isBridgeAssistantCandidate(source);
  const fields = [
    ["final_answer", 80],
    ["finalAnswer", 80],
    ["result", 70],
    ["answer", 65],
    ["output", 60],
    ["response", 55],
    ["text", 50],
    ["content", 45],
    ["message", 40]
  ];

  if (assistant) {
    for (const [field, priority] of fields) {
      if (source[field] === undefined || source[field] === null) {
        continue;
      }
      const text = bridgeCandidateText(source[field]);
      if (text) {
        candidates.push({
          text,
          placeholder: isOpenClawBridgeEmptyReplyPlaceholder(text),
          finality: classifyOpenClawBridgeResultFinality(text),
          successful,
          seq,
          timestamp,
          order: state.order++,
          priority
        });
      }
    }
  }

  const containers = [
    source.messages,
    source.events,
    source.history,
    source.chat?.history,
    source.chat_history,
    source.chatHistory
  ];
  containers.forEach(container => collectBridgeFinalAnswerCandidates(container, candidates, state, {
    successful,
    seq,
    timestamp,
    fromList: true
  }));
}

function compareBridgeFinalAnswerCandidates(a, b) {
  const aSeq = a.seq ?? -Infinity;
  const bSeq = b.seq ?? -Infinity;
  if (aSeq !== bSeq) {
    return aSeq - bSeq;
  }
  const aTimestamp = a.timestamp ?? -Infinity;
  const bTimestamp = b.timestamp ?? -Infinity;
  if (aTimestamp !== bTimestamp) {
    return aTimestamp - bTimestamp;
  }
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  return a.order - b.order;
}

export function extractOpenClawBridgeFinalAnswer(payload) {
  const source = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const candidates = [];
  collectBridgeFinalAnswerCandidates(source?.task && typeof source.task === "object" ? source.task : source, candidates, { order: 0 });
  collectBridgeFinalAnswerCandidates(source?.result, candidates, { order: candidates.length }, { priority: 30 });

  const successful = candidates
    .filter(candidate => candidate.successful && candidate.finality === "final" && candidate.text)
    .sort(compareBridgeFinalAnswerCandidates);
  if (successful.length) {
    return {
      text: successful[successful.length - 1].text,
      placeholderOnly: false,
      finality: "final",
      candidates
    };
  }

  const suspect = candidates
    .filter(candidate => candidate.successful && candidate.finality === "suspect_incomplete" && candidate.text)
    .sort(compareBridgeFinalAnswerCandidates);
  if (suspect.length) {
    return {
      text: suspect[suspect.length - 1].text,
      placeholderOnly: false,
      finality: "suspect_incomplete",
      candidates
    };
  }

  const placeholders = candidates
    .filter(candidate => candidate.placeholder)
    .sort(compareBridgeFinalAnswerCandidates);
  if (placeholders.length) {
    return {
      text: placeholders[placeholders.length - 1].text,
      placeholderOnly: true,
      finality: "placeholder",
      candidates
    };
  }

  const fallback = candidates
    .filter(candidate => candidate.text)
    .sort(compareBridgeFinalAnswerCandidates);
  return {
    text: fallback.length ? fallback[fallback.length - 1].text : "",
    finality: fallback.length ? fallback[fallback.length - 1].finality : "empty",
    placeholderOnly: false,
    candidates
  };
}

export function normalizeOpenClawBridgeTaskProgress(status, remoteProgress, existingProgress = null) {
  if (isOpenClawBridgeSuccessStatus(status)) {
    return 100;
  }

  const remote = normalizeProgressValue(remoteProgress);
  if (remote !== null) {
    return remote;
  }

  const existing = normalizeProgressValue(existingProgress);
  if (existing !== null) {
    return existing;
  }

  return isOpenClawBridgeFailedStatus(status) ? 0 : null;
}

function bridgeConfig(env) {
  return {
    baseUrl: normalizeOpenClawBridgeBaseUrl(env?.OPENCLAW_BRIDGE_BASE_URL),
    token: String(env?.OPENCLAW_BRIDGE_TOKEN || "").trim()
  };
}

function bridgeHeaders(token) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8"
  };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  return headers;
}

function normalizeBridgeTask(data) {
  const source = data?.task && typeof data.task === "object" ? data.task : data || {};
  const status = String(source.status || data?.status || "");
  const progressValue = source.progress ?? source.remote_progress ?? data?.progress ?? data?.remote_progress;
  return {
    taskId: String(source.task_id || source.taskId || source.id || data?.task_id || data?.taskId || data?.id || ""),
    runId: String(source.run_id || source.runId || data?.run_id || data?.runId || ""),
    sessionKey: String(source.sessionKey || source.session_key || data?.sessionKey || data?.session_key || ""),
    sessionId: String(source.sessionId || source.session_id || data?.sessionId || data?.session_id || ""),
    agentId: String(source.agentId || source.agent_id || data?.agentId || data?.agent_id || ""),
    status,
    progress: isOpenClawBridgeSuccessStatus(status)
      ? 100
      : normalizeProgressValue(progressValue),
    message: source.message || data?.message || "",
    result: source.result ?? data?.result ?? null,
    raw: data || {}
  };
}

async function bridgeRequest(env, path, options = {}) {
  const config = bridgeConfig(env);
  if (!config.baseUrl) {
    return {
      ok: false,
      unavailable: true,
      error: "OpenClaw Bridge unavailable: OPENCLAW_BRIDGE_BASE_URL is not configured"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || BRIDGE_TIMEOUT_MS);

  try {
    const response = await fetch(config.baseUrl + path, {
      method: options.method || "GET",
      headers: bridgeHeaders(config.token),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      data = { raw: text };
    }
    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        status: response.status,
        error: data.error || data.message || "OpenClaw Bridge request failed",
        data
      };
    }
    return {
      ok: true,
      status: response.status,
      data,
      task: normalizeBridgeTask(data)
    };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err?.name === "AbortError"
        ? "OpenClaw Bridge unavailable: request timed out"
        : "OpenClaw Bridge unavailable: " + (err?.message || String(err))
    };
  } finally {
    clearTimeout(timer);
  }
}

export function openclawBridgeClient(env) {
  return {
    createTask({
      conversationId,
      projectId,
      runtimeId,
      message,
      sessionKey,
      sessionId,
      agentId,
      attachments,
      fileAttachments,
      nativeAttachments,
      idempotencyKey
    }) {
      const files = Array.isArray(fileAttachments) ? fileAttachments : [];
      const nativeFiles = Array.isArray(nativeAttachments) ? nativeAttachments : [];
      return bridgeRequest(env, "/v1/openclaw/tasks", {
        method: "POST",
        body: {
          conversation_id: conversationId,
          project_id: projectId || "",
          runtime_id: runtimeId || "",
          message,
          prompt: message,
          sessionKey,
          sessionId,
          agentId,
          session_key: sessionKey,
          session_id: sessionId,
          agent_id: agentId,
          attachments: nativeFiles.length ? nativeFiles : (Array.isArray(attachments) ? attachments : []),
          native_attachments: nativeFiles,
          files,
          file_ids: files.map(file => file.file_id).filter(Boolean),
          local_task_id: idempotencyKey,
          idempotencyKey
        }
      });
    },
    getTaskStatus(taskId) {
      return bridgeRequest(env, "/v1/openclaw/tasks/" + encodeURIComponent(String(taskId || "")) + "/status");
    },
    getTaskResult(taskId) {
      return bridgeRequest(env, "/v1/openclaw/tasks/" + encodeURIComponent(String(taskId || "")) + "/result");
    },
    cancelTask(taskId) {
      return bridgeRequest(env, "/v1/openclaw/tasks/" + encodeURIComponent(String(taskId || "")) + "/cancel", {
        method: "POST"
      });
    }
  };
}
