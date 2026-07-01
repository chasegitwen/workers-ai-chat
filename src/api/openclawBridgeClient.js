const BRIDGE_TIMEOUT_MS = 30000;

export function isOpenClawBridgeModeEnabled(env) {
  return String(env?.OPENCLAW_BRIDGE_MODE || "").trim().toLowerCase() === "true";
}

export function normalizeOpenClawBridgeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function bridgeConfig(env) {
  return {
    baseUrl: normalizeOpenClawBridgeBaseUrl(env?.OPENCLAW_BRIDGE_BASE_URL),
    token: String(env?.OPENCLAW_BRIDGE_TOKEN || "").trim()
  };
}

function bridgeHeaders(token) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  return headers;
}

function normalizeBridgeTask(data) {
  const source = data?.task && typeof data.task === "object" ? data.task : data || {};
  return {
    taskId: String(source.task_id || source.taskId || source.id || data?.task_id || data?.taskId || data?.id || ""),
    runId: String(source.run_id || source.runId || data?.run_id || data?.runId || ""),
    sessionKey: String(source.sessionKey || source.session_key || data?.sessionKey || data?.session_key || ""),
    sessionId: String(source.sessionId || source.session_id || data?.sessionId || data?.session_id || ""),
    agentId: String(source.agentId || source.agent_id || data?.agentId || data?.agent_id || ""),
    status: String(source.status || data?.status || ""),
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
      message,
      sessionKey,
      sessionId,
      agentId,
      attachments,
      idempotencyKey
    }) {
      return bridgeRequest(env, "/v1/openclaw/tasks", {
        method: "POST",
        body: {
          conversation_id: conversationId,
          message,
          sessionKey,
          sessionId,
          agentId,
          attachments: Array.isArray(attachments) ? attachments : [],
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
