import { corsHeaders, jsonResponse } from "../utils/response.js";
import { getRelevantFileChunksByIds } from "./files.js";
import {
  ensureConversation,
  saveMessage,
  titleFromMessage
} from "./history.js";
import {
  buildConversationContext,
  maybeUpdateConversationSummary
} from "./summary.js";
import { DEFAULT_TEXT_MODEL, MODELS } from "../providers/models.js";
import { callModel } from "../providers/router.js";
import { callOpenAICompatible } from "../providers/openaiCompatible.js";
import { getModelRuntimeConfig } from "../providers/config.js";
import { callWorkersAI } from "../providers/workersai.js";
import { normalizeProviderError, ProviderError } from "../providers/errors.js";
import { filterEmptySystemMessages } from "../providers/messages.js";
import { runTool } from "../tools/registry.js";
import {
  isOpenClawBridgeModeEnabled,
  openclawBridgeClient
} from "./openclawBridgeClient.js";

const defaultSystemMessage = {
  role: "system",
  content: "\u4f60\u662f\u4e00\u4e2a\u7f51\u9875 AI \u52a9\u624b\uff0c\u8bf7\u7b80\u6d01\u3001\u51c6\u786e\u3001\u53cb\u597d\u5730\u56de\u7b54\u3002\u53ef\u4ee5\u4f7f\u7528 Markdown\u3002"
};

const MAX_AUTO_URL_LENGTH = 2048;
const MAX_AUTO_SEARCH_QUERY_LENGTH = 300;
const MAX_TOOL_DEBUG_SUMMARY_LENGTH = 120;
const MAX_IMAGE_ATTACHMENTS = 3;
const BROWSER_TOOL_TIMEOUT_MS = 60000;
const OPENCLAW_CHAT_TIMEOUT_MS = 240000;
const OPENCLAW_TASK_EXPIRE_MS = 10 * 60 * 1000;
const OPENCLAW_ASYNC_SUBMIT_TIMEOUT_MS = 15000;
const OPENCLAW_ASYNC_SUBMIT_SCAN_BYTES = 65536;
const MODEL_SETTINGS_KEY = "model_settings";
const AUTO_SEARCH_PATTERN = /搜索|查一下|查询|联网查|最新|最近|今天|现在|当前|目前|官网|价格|新闻|发布|更新|\bsearch\b|\blook up\b|\blatest\b|\brecent\b|\btoday\b|\bcurrent\b|\bnow\b|\bnews\b|\bprice\b|\brelease\b|\bupdate\b|\bofficial\b/i;

function getUserMessage(messages) {
  const userMessage = [...(messages || [])]
    .reverse()
    .find(message => message.role === "user");

  return (userMessage?.content || "").trim();
}

function isOpenClawProviderModel(provider, model) {
  const values = [
    provider?.id,
    provider?.label,
    provider?.providerName,
    provider?.apiBase,
    provider?.baseUrl,
    model?.id,
    model?.modelId,
    model?.modelName,
    model?.upstreamModelName,
    model?.label,
    model?.displayName
  ].map(value => String(value || "").toLowerCase());

  return values.some(value => value.startsWith("openclaw-")
    || value.includes("openclaw")
    || value.includes("hnsnowground.cfd"));
}

function isOpenClawRequestTarget(providerCatalog, requestedProvider, requestedModel) {
  try {
    const selected = findProviderModel(
      providerCatalog,
      String(requestedProvider || "").trim(),
      String(requestedModel || "").trim()
    );
    return isOpenClawProviderModel(selected.provider, selected.model);
  } catch (err) {
    return isOpenClawProviderModel(
      { id: requestedProvider },
      { id: requestedModel, modelName: requestedModel }
    );
  }
}

function resolveOpenClawProviderModel(providerCatalog, requestedProvider, requestedModel) {
  try {
    return findProviderModel(
      providerCatalog,
      String(requestedProvider || "").trim(),
      String(requestedModel || "").trim()
    );
  } catch (err) {
    return {
      provider: { id: requestedProvider },
      model: { id: requestedModel, modelName: requestedModel }
    };
  }
}

function openClawTaskMetadata(extra = {}) {
  return JSON.stringify({
    source: "worker-local",
    canReconnect: false,
    canQueryRemoteStatus: false,
    abortStopsRemote: false,
    ...extra
  });
}

function isOpenClawAsyncModeEnabled(env) {
  return String(env.OPENCLAW_ASYNC_MODE || "").trim().toLowerCase() === "native";
}

function logOpenClawAsync(event, detail = {}) {
  console.warn("[openclaw-async]", event, detail);
}

function taskStatus(row) {
  if (!row) {
    return "";
  }
  const status = String(row.status || "");
  if (status === "running" && Date.now() - Number(row.updated_at || row.started_at || 0) > OPENCLAW_TASK_EXPIRE_MS) {
    return "expired";
  }
  return status;
}

function serializeOpenClawTask(row) {
  if (!row) {
    return null;
  }
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata || "{}");
  } catch (err) {
    metadata = {};
  }
  const startedAt = Number(row.started_at || 0);
  const completedAt = row.completed_at ? Number(row.completed_at) : null;
  const latencyMs = row.latency_ms ? Number(row.latency_ms) : null;
  const durationMs = latencyMs ?? (completedAt && startedAt ? Math.max(0, completedAt - startedAt) : null);
  const status = taskStatus(row);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    conversation_id: row.conversation_id,
    provider: row.provider,
    model: row.model,
    upstreamModelName: row.upstream_model_name || "",
    upstream_model_name: row.upstream_model_name || "",
    agent_id: row.upstream_model_name || row.model || "",
    promptPreview: row.prompt_preview || "",
    prompt_preview: row.prompt_preview || "",
    status,
    storedStatus: row.status || "",
    created_at: startedAt,
    started_at: startedAt,
    startedAt,
    updatedAt: Number(row.updated_at || 0),
    updated_at: Number(row.updated_at || 0),
    finished_at: completedAt,
    completedAt,
    error: row.error || "",
    error_message: row.error || "",
    latencyMs,
    duration_ms: durationMs,
    assistantMessageId: row.assistant_message_id || "",
    remoteTaskId: row.remote_task_id || "",
    remote_task_id: row.remote_task_id || "",
    remoteStatus: row.remote_status || "",
    remote_status: row.remote_status || "",
    remoteProgress: row.remote_progress ?? null,
    remote_progress: row.remote_progress ?? null,
    remoteMessage: row.remote_message || "",
    remote_message: row.remote_message || "",
    cancelledAt: row.cancelled_at || "",
    cancelled_at: row.cancelled_at || "",
    bridgeTaskId: row.bridge_task_id || "",
    bridge_task_id: row.bridge_task_id || "",
    bridgeRunId: row.bridge_run_id || "",
    bridge_run_id: row.bridge_run_id || "",
    bridgeSessionKey: row.bridge_session_key || "",
    bridge_session_key: row.bridge_session_key || "",
    bridgeSessionId: row.bridge_session_id || "",
    bridge_session_id: row.bridge_session_id || "",
    bridgeAgentId: row.bridge_agent_id || "",
    bridge_agent_id: row.bridge_agent_id || "",
    bridgeResultHash: row.bridge_result_hash || "",
    bridge_result_hash: row.bridge_result_hash || "",
    bridgeModeEnabled: Boolean(row.bridge_mode_enabled),
    bridge_mode_enabled: Boolean(row.bridge_mode_enabled),
    metadata,
    canReconnect: Boolean(metadata.canReconnect),
    canQueryRemoteStatus: Boolean(metadata.canQueryRemoteStatus),
    abortStopsRemote: Boolean(metadata.abortStopsRemote)
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

async function createOpenClawTask(env, details) {
  if (!env.DB) {
    return null;
  }
  const now = Date.now();
  const task = {
    id: crypto.randomUUID(),
    conversationId: details.conversationId,
    provider: details.provider || "",
    model: details.model || "",
    upstreamModelName: details.upstreamModelName || "",
    promptPreview: String(details.prompt || "").replace(/\s+/g, " ").trim().slice(0, 240),
    status: "running",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    error: "",
    latencyMs: null,
    assistantMessageId: "",
    remoteTaskId: "",
    metadata: {
      source: "worker-local",
      canReconnect: false,
      canQueryRemoteStatus: false,
      abortStopsRemote: false
    }
  };

  try {
    await env.DB.prepare(
      `INSERT INTO openclaw_tasks (
        id,
        conversation_id,
        provider,
        model,
        upstream_model_name,
        prompt_preview,
        status,
        started_at,
        updated_at,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      task.id,
      task.conversationId,
      task.provider,
      task.model,
      task.upstreamModelName,
      task.promptPreview,
      task.status,
      task.startedAt,
      task.updatedAt,
      openClawTaskMetadata()
    ).run();
    return task;
  } catch (err) {
    console.warn("[openclaw-task] failed to create task", err?.message || String(err));
    return null;
  }
}

async function updateOpenClawTask(env, task, patch = {}) {
  if (!env.DB || !task?.id) {
    return null;
  }
  const now = Date.now();
  const nextStatus = patch.status || task.status || "running";
  const completedAt = patch.completedAt ?? (nextStatus === "completed" ? now : task.completedAt || null);
  const latencyMs = patch.latencyMs ?? task.latencyMs ?? null;
  const error = patch.error ?? task.error ?? "";
  const assistantMessageId = patch.assistantMessageId ?? task.assistantMessageId ?? "";

  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET status = ?,
          updated_at = ?,
          completed_at = ?,
          error = ?,
          latency_ms = ?,
          assistant_message_id = ?
        WHERE id = ?`
    ).bind(
      nextStatus,
      now,
      completedAt,
      error,
      latencyMs,
      assistantMessageId,
      task.id
    ).run();
    return {
      ...task,
      status: nextStatus,
      updatedAt: now,
      completedAt,
      error,
      latencyMs,
      assistantMessageId
    };
  } catch (err) {
    console.warn("[openclaw-task] failed to update task", err?.message || String(err));
    return null;
  }
}

async function updateOpenClawTaskRemoteStart(env, task, remoteTask) {
  const detail = typeof remoteTask === "object" && remoteTask !== null
    ? remoteTask
    : { taskId: remoteTask };
  const id = String(detail.taskId || "").trim();
  if (!env.DB || !task?.id || !id) {
    return task;
  }
  const existingTask = await readOpenClawTaskById(env, task.id);
  const existingRemoteStatus = String(existingTask?.remoteStatus || existingTask?.remote_status || "");
  if (isOpenClawTaskTerminalStatus(localStatusFromRemoteStatus(existingRemoteStatus))) {
    return existingTask || task;
  }
  const now = Date.now();
  const remoteStatus = String(detail.status || "running");
  const remoteProgress = Number.isFinite(Number(detail.progress))
    ? Math.max(0, Math.min(100, Number(detail.progress)))
    : 0;
  const remoteMessage = String(detail.message || "Remote task started");
  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET remote_task_id = ?,
          remote_status = ?,
          remote_progress = ?,
          remote_message = ?,
          updated_at = ?
        WHERE id = ?
          AND LOWER(COALESCE(remote_status, '')) NOT IN (
            'completed', 'complete', 'done', 'success', 'succeeded',
            'failed', 'failure', 'error',
            'cancelled', 'canceled'
          )`
    ).bind(
      id,
      remoteStatus,
      remoteProgress,
      remoteMessage,
      now,
      task.id
    ).run();
    const latestTask = await readOpenClawTaskById(env, task.id);
    if (latestTask) {
      return latestTask;
    }
    return {
      ...task,
      remoteTaskId: id,
      remote_task_id: id,
      remoteStatus,
      remote_status: remoteStatus,
      remoteProgress,
      remote_progress: remoteProgress,
      remoteMessage,
      remote_message: remoteMessage,
      updatedAt: now,
      updated_at: now
    };
  } catch (err) {
    console.warn("[openclaw-task] failed to store remote task id", err?.message || String(err));
    return task;
  }
}

function isOpenClawBridgeTask(task) {
  return Boolean(task?.bridgeModeEnabled || task?.bridge_mode_enabled || task?.bridgeTaskId || task?.bridge_task_id);
}

function openClawBridgeTaskId(task) {
  return String(task?.bridgeTaskId || task?.bridge_task_id || "").trim();
}

async function hashOpenClawBridgeResult(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function updateOpenClawBridgeTaskStart(env, task, bridgeTask) {
  if (!env.DB || !task?.id) {
    return task;
  }
  const bridgeTaskId = String(bridgeTask?.taskId || bridgeTask?.task_id || bridgeTask?.id || "").trim();
  const bridgeRunId = String(bridgeTask?.runId || bridgeTask?.run_id || "").trim();
  const bridgeSessionKey = String(bridgeTask?.sessionKey || bridgeTask?.session_key || "").trim();
  const bridgeSessionId = String(bridgeTask?.sessionId || bridgeTask?.session_id || "").trim();
  const bridgeAgentId = String(bridgeTask?.agentId || bridgeTask?.agent_id || "").trim();
  const remoteStatus = String(bridgeTask?.status || "running");
  const now = Date.now();
  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET status = ?,
          updated_at = ?,
          remote_task_id = ?,
          remote_status = ?,
          remote_progress = ?,
          remote_message = ?,
          bridge_task_id = ?,
          bridge_run_id = ?,
          bridge_session_key = ?,
          bridge_session_id = ?,
          bridge_agent_id = ?,
          bridge_mode_enabled = ?,
          metadata = ?
        WHERE id = ?`
    ).bind(
      localStatusFromRemoteStatus(remoteStatus, "running"),
      now,
      bridgeTaskId,
      remoteStatus,
      localStatusFromRemoteStatus(remoteStatus, "running") === "completed" ? 100 : 0,
      bridgeTask?.message || "OpenClaw Bridge task submitted",
      bridgeTaskId,
      bridgeRunId,
      bridgeSessionKey,
      bridgeSessionId,
      bridgeAgentId,
      1,
      openClawTaskMetadata({
        source: "openclaw-bridge",
        canReconnect: true,
        canQueryRemoteStatus: true,
        abortStopsRemote: true
      }),
      task.id
    ).run();
    return await readOpenClawTaskById(env, task.id);
  } catch (err) {
    console.warn("[openclaw-bridge] failed to store bridge task", err?.message || String(err));
    return task;
  }
}

async function markOpenClawBridgeTaskFailed(env, task, message) {
  if (!task?.id) {
    return task;
  }
  const failed = await updateOpenClawTask(env, task, {
    status: "failed",
    error: message || "OpenClaw Bridge unavailable",
    latencyMs: 0
  }) || task;
  if (!env.DB) {
    return failed;
  }
  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET bridge_mode_enabled = ?,
          remote_status = ?,
          remote_message = ?,
          metadata = ?
        WHERE id = ?`
    ).bind(
      1,
      "failed",
      message || "OpenClaw Bridge unavailable",
      openClawTaskMetadata({
        source: "openclaw-bridge",
        canReconnect: true,
        canQueryRemoteStatus: true,
        abortStopsRemote: true
      }),
      task.id
    ).run();
    return await readOpenClawTaskById(env, task.id) || failed;
  } catch (err) {
    console.warn("[openclaw-bridge] failed to mark bridge task failed", err?.message || String(err));
    return failed;
  }
}

async function readOpenClawTasks(env, options = {}) {
  if (!env.DB) {
    return [];
  }
  const conversationId = String(options.conversationId || "").trim();
  const status = String(options.status || "").trim();
  const sort = String(options.sort || "created_desc").trim();
  const limit = clampInteger(options.limit, 20, 1, 100);
  const offset = clampInteger(options.offset, 0, 0, 10000);
  const where = [];
  const bindings = [];

  if (conversationId) {
    where.push("conversation_id = ?");
    bindings.push(conversationId);
  }

  if (status) {
    where.push("status = ?");
    bindings.push(status);
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const orderBy = sort === "duration_desc"
    ? "ORDER BY COALESCE(latency_ms, completed_at - started_at, updated_at - started_at, 0) DESC, updated_at DESC"
    : "ORDER BY started_at DESC, updated_at DESC";
  const result = await env.DB.prepare(
    `SELECT *
      FROM openclaw_tasks
      ${whereSql}
      ${orderBy}
      LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all();
  return (result?.results || []).map(serializeOpenClawTask).filter(Boolean);
}

async function readActiveOpenClawTask(env, conversationId) {
  if (!env.DB) {
    return null;
  }
  const id = String(conversationId || "").trim();
  if (!id) {
    return null;
  }
  const result = await env.DB.prepare(
    `SELECT *
      FROM openclaw_tasks
      WHERE conversation_id = ?
        AND status NOT IN ('completed', 'failed', 'aborted', 'cancelled', 'cancel_requested')
      ORDER BY updated_at DESC, started_at DESC
      LIMIT 20`
  ).bind(id).all();
  return (result?.results || [])
    .map(serializeOpenClawTask)
    .find(isOpenClawTaskActive) || null;
}

function isOpenClawTaskActive(task) {
  return ["running", "recovering", "disconnected", "expired"].includes(String(task?.status || ""));
}

function isOpenClawTaskTerminalStatus(status) {
  return ["completed", "failed", "aborted", "cancelled", "canceled"].includes(String(status || ""));
}

async function readOpenClawTaskById(env, taskId) {
  if (!env.DB) {
    return null;
  }
  const id = String(taskId || "").trim();
  if (!id) {
    return null;
  }
  const row = await env.DB.prepare(
    `SELECT *
      FROM openclaw_tasks
      WHERE id = ?
      LIMIT 1`
  ).bind(id).first();
  return serializeOpenClawTask(row);
}

function normalizeOpenClawTaskEndpoint(value) {
  const endpoint = String(value || "").trim().replace(/\/+$/g, "");
  if (!endpoint) {
    return "";
  }
  if (/\/tasks$/i.test(endpoint)) {
    return endpoint;
  }
  if (/\/chat\/completions$/i.test(endpoint)) {
    return endpoint.replace(/\/chat\/completions$/i, "/tasks");
  }
  return endpoint + "/tasks";
}

function openClawRemoteTaskExplicitEndpoint(env) {
  return normalizeOpenClawTaskEndpoint(env.OPENCLAW_REMOTE_TASK_ENDPOINT
    || env.OPENCLAW_TASK_ENDPOINT
    || env.OPENCLAW_GATEWAY_BASE_URL
    || "");
}

function openClawRemoteTaskExplicitToken(env) {
  return String(env.OPENCLAW_REMOTE_TASK_TOKEN
    || env.OPENCLAW_TASK_TOKEN
    || env.OPENCLAW_GATEWAY_TOKEN
    || "").trim();
}

function openClawRemoteTaskLegacyToken(env) {
  return String(env.GLM_API_KEY || "").trim();
}

async function openClawRemoteTaskProviderConfig(env, task) {
  const providerId = String(task?.provider || "").trim();
  if (!providerId) {
    return null;
  }

  const providers = await readSavedProviders(env);
  const provider = (providers || []).find(item => String(item.id || item.providerId || "") === providerId);

  if (!provider) {
    return null;
  }

  return {
    endpoint: normalizeOpenClawTaskEndpoint(provider.apiBase || provider.baseUrl || ""),
    apiKeyEnv: String(provider.apiKeyEnv || "").trim()
  };
}

async function openClawRemoteTaskRequestConfig(env, task) {
  const providerConfig = await openClawRemoteTaskProviderConfig(env, task);
  const explicitEndpoint = openClawRemoteTaskExplicitEndpoint(env);
  const explicitToken = openClawRemoteTaskExplicitToken(env);
  const providerToken = providerConfig?.apiKeyEnv ? String(env[providerConfig.apiKeyEnv] || "").trim() : "";
  const legacyToken = openClawRemoteTaskLegacyToken(env);
  const endpoint = providerConfig?.endpoint || explicitEndpoint || "";
  const token = providerToken || explicitToken || legacyToken;

  return {
    endpoint,
    token,
    endpointSource: providerConfig?.endpoint ? "provider" : explicitEndpoint ? "env" : "missing",
    tokenSource: providerToken ? "provider:" + providerConfig.apiKeyEnv : explicitToken ? "env" : legacyToken ? "legacy:GLM_API_KEY" : "missing",
    providerApiKeyEnv: providerConfig?.apiKeyEnv || ""
  };
}

function openClawRemoteTaskHeaders(token) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  return headers;
}

async function callOpenClawRemoteTask(env, remoteTaskId, action, task = null) {
  const requestConfig = await openClawRemoteTaskRequestConfig(env, task);
  const endpoint = requestConfig.endpoint;
  if (!endpoint) {
    return {
      ok: false,
      unavailable: true,
      error: "OpenClaw remote task endpoint is not configured",
      debug: {
        endpointSource: requestConfig.endpointSource,
        tokenSource: requestConfig.tokenSource
      }
    };
  }
  const id = encodeURIComponent(String(remoteTaskId || "").trim());
  const suffix = action === "cancel"
    ? `/${id}/cancel`
    : action === "result"
      ? `/${id}/result`
      : `/${id}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint + suffix, {
      method: action === "cancel" ? "POST" : "GET",
      headers: openClawRemoteTaskHeaders(requestConfig.token),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      data = { raw: text };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data.error || data.message || "OpenClaw remote task request failed",
        data,
        debug: {
          endpointSource: requestConfig.endpointSource,
          tokenSource: requestConfig.tokenSource,
          hasToken: Boolean(requestConfig.token)
        }
      };
    }
    if (data && typeof data === "object" && data.ok === false) {
      return {
        ok: false,
        status: response.status,
        error: data.error || data.message || "OpenClaw remote task request failed",
        data,
        debug: {
          endpointSource: requestConfig.endpointSource,
          tokenSource: requestConfig.tokenSource,
          hasToken: Boolean(requestConfig.token)
        }
      };
    }
    return {
      ok: true,
      status: response.status,
      data,
      debug: {
        endpointSource: requestConfig.endpointSource,
        tokenSource: requestConfig.tokenSource,
        hasToken: Boolean(requestConfig.token)
      }
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      debug: {
        endpointSource: requestConfig.endpointSource,
        tokenSource: requestConfig.tokenSource,
        hasToken: Boolean(requestConfig.token)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getOpenClawTaskStatus(env, remoteTaskId, task = null) {
  if (isOpenClawBridgeTask(task)) {
    const bridgeTaskId = openClawBridgeTaskId(task);
    if (!bridgeTaskId) {
      return { ok: false, unavailable: true, error: "OpenClaw Bridge task id is missing" };
    }
    return openclawBridgeClient(env).getTaskStatus(bridgeTaskId);
  }
  return callOpenClawRemoteTask(env, remoteTaskId, "status", task);
}

async function cancelOpenClawTask(env, remoteTaskId, task = null) {
  if (isOpenClawBridgeTask(task)) {
    const bridgeTaskId = openClawBridgeTaskId(task);
    if (!bridgeTaskId) {
      return { ok: false, unavailable: true, error: "OpenClaw Bridge task id is missing" };
    }
    return openclawBridgeClient(env).cancelTask(bridgeTaskId);
  }
  return callOpenClawRemoteTask(env, remoteTaskId, "cancel", task);
}

async function getOpenClawTaskResult(env, remoteTaskId, task = null) {
  if (isOpenClawBridgeTask(task)) {
    const bridgeTaskId = openClawBridgeTaskId(task);
    if (!bridgeTaskId) {
      return { ok: false, unavailable: true, error: "OpenClaw Bridge task id is missing" };
    }
    return openclawBridgeClient(env).getTaskResult(bridgeTaskId);
  }
  return callOpenClawRemoteTask(env, remoteTaskId, "result", task);
}

function remoteResultText(remote) {
  const value = remote?.result ?? remote?.message ?? "";
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object") {
    if (typeof value.content === "string") {
      return value.content.trim();
    }
    if (typeof value.text === "string") {
      return value.text.trim();
    }
    if (typeof value.response === "string") {
      return value.response.trim();
    }
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function normalizeRemoteTaskPayload(result) {
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const task = data.task && typeof data.task === "object"
    ? data.task
    : data.data?.task && typeof data.data.task === "object"
      ? data.data.task
      : data.data && typeof data.data === "object"
        ? data.data
        : data;
  const progressValue = task.progress ?? task.remote_progress ?? data.progress ?? data.remote_progress;
  return {
    id: task.id || task.task_id || task.taskId || data.id || data.task_id || data.taskId || "",
    task_id: task.task_id || task.id || task.taskId || data.task_id || data.id || data.taskId || "",
    taskId: task.taskId || task.id || task.task_id || data.taskId || data.id || data.task_id || "",
    status: task.status || task.remote_status || task.state || data.status || data.remote_status || data.state || "",
    progress: Number.isFinite(Number(progressValue))
      ? Math.max(0, Math.min(100, Number(progressValue)))
      : null,
    message: task.message || task.remote_message || task.detail || task.error
      || data.message || data.remote_message || data.detail || data.error || "",
    result: task.result || task.output || task.response || data.result || data.output || data.response || null
  };
}

function localStatusFromRemoteStatus(remoteStatus, fallback = "") {
  const status = String(remoteStatus || "").toLowerCase();
  if (["completed", "complete", "done", "success", "succeeded"].includes(status)) {
    return "completed";
  }
  if (["failed", "failure", "error"].includes(status)) {
    return "failed";
  }
  if (["cancelled", "canceled"].includes(status)) {
    return "cancelled";
  }
  if (["cancel_requested", "cancelling", "canceling"].includes(status)) {
    return "cancel_requested";
  }
  if (["running", "recovering", "pending", "queued", "started", "active", "in_progress", "processing"].includes(status)) {
    return "running";
  }
  return fallback || "";
}

function openClawRemoteTaskId(task) {
  return String(task?.remoteTaskId || task?.remote_task_id || "").trim();
}

function isOpenClawRemoteTerminalStatus(status) {
  return isOpenClawTaskTerminalStatus(localStatusFromRemoteStatus(status));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncOpenClawRemoteTask(env, localTask, remoteResult, patch = {}) {
  if (!env.DB || !localTask?.id || !remoteResult?.ok) {
    return localTask;
  }
  const remote = normalizeRemoteTaskPayload(remoteResult);
  const now = Date.now();
  const currentLocalStatus = localTask.storedStatus || localTask.status || "running";
  const nextStatus = patch.status
    || (isOpenClawTaskTerminalStatus(currentLocalStatus)
      ? currentLocalStatus
      : localStatusFromRemoteStatus(remote.status, currentLocalStatus));
  const completedAt = nextStatus === "completed" || nextStatus === "failed"
    ? now
    : localTask.completedAt || null;
  const cancelledAt = nextStatus === "cancelled" || nextStatus === "cancel_requested"
    ? new Date(now).toISOString()
    : null;
  const nextRemoteStatus = remote.status || localTask.remoteStatus || localTask.remote_status || "unknown";
  const nextRemoteProgress = remote.progress !== null
    ? remote.progress
    : localTask.remoteProgress ?? localTask.remote_progress ?? null;
  const nextRemoteMessage = remote.message || localTask.remoteMessage || localTask.remote_message || "";
  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET status = ?,
          updated_at = ?,
          completed_at = COALESCE(?, completed_at),
          error = ?,
          remote_status = ?,
          remote_progress = ?,
          remote_message = ?,
          cancelled_at = COALESCE(?, cancelled_at)
        WHERE id = ?`
    ).bind(
      nextStatus,
      now,
      completedAt,
      nextStatus === "failed" ? (remote.message || localTask.error || "") : (localTask.error || ""),
      nextRemoteStatus,
      nextRemoteProgress,
      nextRemoteMessage,
      cancelledAt,
      localTask.id
    ).run();
    const syncedTask = await readOpenClawTaskById(env, localTask.id);
    console.warn("[openclaw-task] remote sync completed", {
      localTaskId: localTask.id,
      remoteTaskId: openClawRemoteTaskId(localTask),
      localStatus: nextStatus,
      remoteStatus: nextRemoteStatus,
      remoteProgress: nextRemoteProgress,
      hasRemoteMessage: Boolean(nextRemoteMessage)
    });
    return syncedTask;
  } catch (err) {
    console.warn("[openclaw-task] failed to sync remote task", err?.message || String(err));
    return localTask;
  }
}

async function markOpenClawRemoteStatusUnavailable(env, task, message = "Remote status unavailable after local completion") {
  if (!env.DB || !task?.id) {
    return {
      ...task,
      remoteStatus: "unknown",
      remote_status: "unknown",
      remoteMessage: message,
      remote_message: message
    };
  }
  const now = Date.now();
  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET updated_at = ?,
          remote_status = ?,
          remote_message = ?
        WHERE id = ?`
    ).bind(
      now,
      "unknown",
      message,
      task.id
    ).run();
    return await readOpenClawTaskById(env, task.id);
  } catch (err) {
    console.warn("[openclaw-task] failed to mark remote status unavailable", err?.message || String(err));
    return {
      ...task,
      remoteStatus: "unknown",
      remote_status: "unknown",
      remoteMessage: message,
      remote_message: message,
      updatedAt: now,
      updated_at: now
    };
  }
}

async function syncOpenClawRemoteTaskAfterLocalTerminal(env, task, localStatus) {
  const remoteTaskId = openClawRemoteTaskId(task);
  if (!remoteTaskId) {
    console.warn("[openclaw-task] terminal remote sync skipped: missing remote_task_id", {
      localTaskId: task?.id || "",
      localStatus: localStatus || task?.storedStatus || task?.status || ""
    });
    return task;
  }
  console.warn("[openclaw-task] terminal remote sync started", {
    localTaskId: task?.id || "",
    remoteTaskId,
    localStatus: localStatus || task?.storedStatus || task?.status || ""
  });
  const remoteResult = await getOpenClawTaskStatus(env, remoteTaskId, task);
  if (!remoteResult.ok) {
    console.warn("[openclaw-task] terminal remote sync failed", {
      localTaskId: task?.id || "",
      remoteTaskId,
      error: remoteResult.error || "",
      status: remoteResult.status || null,
      unavailable: Boolean(remoteResult.unavailable)
    });
    return markOpenClawRemoteStatusUnavailable(env, task);
  }
  const remote = normalizeRemoteTaskPayload(remoteResult);
  console.warn("[openclaw-task] terminal remote sync response", {
    localTaskId: task?.id || "",
    remoteTaskId,
    remoteStatus: remote.status || "",
    remoteProgress: remote.progress,
    hasRemoteMessage: Boolean(remote.message)
  });
  return syncOpenClawRemoteTask(env, task, remoteResult, {
    status: localStatus || task.storedStatus || task.status
  });
}

async function runOpenClawTerminalRemoteSync(env, ctx, task, localStatus) {
  const promise = syncOpenClawRemoteTaskAfterLocalTerminal(env, task, localStatus);
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise.catch(err => {
      console.warn("[openclaw-task] waitUntil terminal remote sync failed", err?.message || String(err));
    }));
  }
  const syncedTask = await promise;
  const remoteStatus = syncedTask?.remoteStatus || syncedTask?.remote_status || "";
  const remoteTaskId = openClawRemoteTaskId(syncedTask || task);
  if (ctx?.waitUntil
    && remoteTaskId
    && isOpenClawTaskTerminalStatus(localStatus)
    && !isOpenClawRemoteTerminalStatus(remoteStatus)) {
    ctx.waitUntil((async () => {
      let latestTask = syncedTask || task;
      for (const delayMs of [3000, 10000]) {
        await sleep(delayMs);
        latestTask = await syncOpenClawRemoteTaskAfterLocalTerminal(env, latestTask, localStatus) || latestTask;
        const latestRemoteStatus = latestTask?.remoteStatus || latestTask?.remote_status || "";
        if (isOpenClawRemoteTerminalStatus(latestRemoteStatus)) {
          break;
        }
      }
    })().catch(err => {
      console.warn("[openclaw-task] delayed terminal remote sync failed", err?.message || String(err));
    }));
  }
  return syncedTask;
}

async function finalizeOpenClawTaskResult(env, task) {
  if (!task?.id) {
    return { ok: false, error: "OpenClaw task not found", task: null };
  }
  let latestTask = await readOpenClawTaskById(env, task.id) || task;
  if (latestTask.assistantMessageId) {
    return { ok: true, saved: false, duplicate: true, task: latestTask };
  }
  const localStatus = String(latestTask.storedStatus || latestTask.status || "").toLowerCase();
  if (["failed", "aborted", "cancelled", "canceled", "cancel_requested"].includes(localStatus)) {
    return { ok: false, error: "OpenClaw task is not completed", task: latestTask };
  }
  const remoteTaskId = openClawRemoteTaskId(latestTask);
  if (!remoteTaskId) {
    return { ok: false, error: "OpenClaw task has no remote_task_id", task: latestTask };
  }
  const remoteResult = await getOpenClawTaskResult(env, remoteTaskId, latestTask);
  if (!remoteResult.ok) {
    return {
      ok: false,
      error: remoteResult.error || "OpenClaw remote task result unavailable",
      task: latestTask
    };
  }
  const remote = normalizeRemoteTaskPayload(remoteResult);
  const remoteLocalStatus = localStatusFromRemoteStatus(remote.status, "");
  if (["failed", "cancelled", "canceled", "cancel_requested"].includes(remoteLocalStatus)) {
    latestTask = await syncOpenClawRemoteTask(env, latestTask, remoteResult, {
      status: remoteLocalStatus
    }) || latestTask;
    return { ok: false, error: "OpenClaw task is not completed", task: latestTask };
  }
  if (remoteLocalStatus && remoteLocalStatus !== "completed" && localStatus !== "completed") {
    latestTask = await syncOpenClawRemoteTask(env, latestTask, remoteResult, {
      status: remoteLocalStatus
    }) || latestTask;
    return { ok: false, error: "OpenClaw task is not completed", task: latestTask };
  }
  latestTask = await syncOpenClawRemoteTask(env, latestTask, remoteResult, {
    status: "completed"
  }) || latestTask;
  const reply = remoteResultText(remote);
  if (!reply) {
    return { ok: false, error: "OpenClaw remote task result is empty", task: latestTask };
  }
  const bridgeResultHash = isOpenClawBridgeTask(latestTask)
    ? await hashOpenClawBridgeResult(reply)
    : "";
  if (bridgeResultHash && latestTask.bridgeResultHash === bridgeResultHash) {
    return { ok: true, saved: false, duplicate: true, task: latestTask, result: reply };
  }
  const refreshedTask = await readOpenClawTaskById(env, latestTask.id) || latestTask;
  if (refreshedTask.assistantMessageId) {
    return { ok: true, saved: false, duplicate: true, task: refreshedTask };
  }
  if (bridgeResultHash && refreshedTask.bridgeResultHash === bridgeResultHash) {
    return { ok: true, saved: false, duplicate: true, task: refreshedTask, result: reply };
  }
  const assistantMessage = env.DB
    ? await saveMessage(env.DB, refreshedTask.conversationId || refreshedTask.conversation_id, "assistant", reply)
    : null;
  if (env.DB) {
    await maybeUpdateConversationSummary(env, refreshedTask.conversationId || refreshedTask.conversation_id);
  }
  const savedTask = await updateOpenClawTask(env, refreshedTask, {
    status: "completed",
    assistantMessageId: assistantMessage?.id || refreshedTask.assistantMessageId || "",
    latencyMs: refreshedTask.latencyMs ?? null
  }) || {
    ...refreshedTask,
    status: "completed",
    assistantMessageId: assistantMessage?.id || refreshedTask.assistantMessageId || ""
  };
  if (bridgeResultHash && env.DB) {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET bridge_result_hash = ?
        WHERE id = ?`
    ).bind(
      bridgeResultHash,
      refreshedTask.id
    ).run();
  }
  const finalTask = bridgeResultHash
    ? await readOpenClawTaskById(env, refreshedTask.id) || savedTask
    : savedTask;
  return {
    ok: true,
    saved: Boolean(assistantMessage?.id),
    duplicate: false,
    task: finalTask,
    result: reply
  };
}

async function markOpenClawTaskCancelRequested(env, task, message = "Cancel requested locally. Remote task state is unknown.") {
  if (!env.DB || !task?.id) {
    return task;
  }
  const now = Date.now();
  try {
    await env.DB.prepare(
      `UPDATE openclaw_tasks
        SET status = ?,
          updated_at = ?,
          error = ?,
          remote_message = ?,
          cancelled_at = COALESCE(cancelled_at, ?)
        WHERE id = ?`
    ).bind(
      "cancel_requested",
      now,
      message,
      message,
      new Date(now).toISOString(),
      task.id
    ).run();
    return await readOpenClawTaskById(env, task.id);
  } catch (err) {
    console.warn("[openclaw-task] failed to mark cancel requested", err?.message || String(err));
    return {
      ...task,
      status: "cancel_requested",
      error: message,
      remoteMessage: message,
      updatedAt: now
    };
  }
}

async function handleOpenClawTasksRequest(request, env, url, ctx) {
  if (url.pathname === "/api/openclaw/tasks/ping" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      route: "openclaw-tasks"
    });
  }

  if (url.pathname === "/api/openclaw/tasks/debug-env" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      openClawAsyncModePresent: typeof env.OPENCLAW_ASYNC_MODE !== "undefined",
      openClawAsyncModeEnabled: isOpenClawAsyncModeEnabled(env),
      openClawBridgeModePresent: typeof env.OPENCLAW_BRIDGE_MODE !== "undefined",
      openClawBridgeModeEnabled: isOpenClawBridgeModeEnabled(env),
      openClawBridgeBaseUrlPresent: Boolean(String(env.OPENCLAW_BRIDGE_BASE_URL || "").trim()),
      openClawBridgeTokenPresent: Boolean(String(env.OPENCLAW_BRIDGE_TOKEN || "").trim())
    });
  }

  if (url.pathname === "/api/openclaw/tasks/active" && request.method === "GET") {
    const conversationId = url.searchParams.get("conversation_id") || url.searchParams.get("conversationId");
    if (!conversationId) {
      return jsonResponse({
        ok: false,
        error: "conversation_id is required"
      }, 400);
    }
    try {
      const task = await readActiveOpenClawTask(env, conversationId);
      return jsonResponse({
        ok: true,
        active: Boolean(task),
        task
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to read active OpenClaw task",
        detail: err?.message || String(err)
      }, 500);
    }
  }

  if (url.pathname === "/api/openclaw/tasks" && request.method === "GET") {
    try {
      const tasks = await readOpenClawTasks(env, {
        conversationId: url.searchParams.get("conversation_id") || url.searchParams.get("conversationId"),
        status: url.searchParams.get("status"),
        sort: url.searchParams.get("sort") || "created_desc",
        limit: url.searchParams.get("limit") || 20,
        offset: url.searchParams.get("offset") || 0
      });
      return jsonResponse({
        ok: true,
        tasks,
        limit: clampInteger(url.searchParams.get("limit"), 20, 1, 100),
        offset: clampInteger(url.searchParams.get("offset"), 0, 0, 10000)
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to read OpenClaw tasks",
        detail: err?.message || String(err)
      }, 500);
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/openclaw\/tasks\/([^/]+)\/status$/);
  if (statusMatch && request.method === "GET") {
    const id = decodeURIComponent(statusMatch[1]);
    try {
      const task = await readOpenClawTaskById(env, id);
      if (!task) {
        return jsonResponse({ ok: false, error: "OpenClaw task not found" }, 404);
      }
      const remoteTaskId = openClawRemoteTaskId(task);
      if (!remoteTaskId) {
        return jsonResponse({
          ok: true,
          remote: false,
          task,
          debug: {
            remoteTaskId: "",
            remoteStatusAttempted: false,
            remoteStatusOk: false,
            remoteHttpStatus: null
          }
        });
      }
      const remoteResult = await getOpenClawTaskStatus(env, remoteTaskId, task);
      if (!remoteResult.ok) {
        const nextTask = (isOpenClawTaskTerminalStatus(task.status) || isOpenClawTaskTerminalStatus(task.storedStatus))
          ? await markOpenClawRemoteStatusUnavailable(env, task, "Remote status unavailable")
          : task;
        return jsonResponse({
          ok: true,
          remote: true,
          remoteAvailable: false,
          error: remoteResult.error || "OpenClaw remote task status unavailable",
          task: nextTask,
          debug: {
            remoteTaskId,
            remoteStatusAttempted: true,
            remoteStatusOk: false,
            remoteHttpStatus: remoteResult.status || null,
            endpointSource: remoteResult.debug?.endpointSource || "",
            tokenSource: remoteResult.debug?.tokenSource || "",
            hasToken: Boolean(remoteResult.debug?.hasToken)
          }
        });
      }
      const syncedTask = await syncOpenClawRemoteTask(env, task, remoteResult);
      return jsonResponse({
        ok: true,
        remote: true,
        remoteAvailable: true,
        task: syncedTask,
        remoteStatus: normalizeRemoteTaskPayload(remoteResult),
        debug: {
          remoteTaskId,
          remoteStatusAttempted: true,
          remoteStatusOk: true,
          remoteHttpStatus: remoteResult.status || 200,
          endpointSource: remoteResult.debug?.endpointSource || "",
          tokenSource: remoteResult.debug?.tokenSource || "",
          hasToken: Boolean(remoteResult.debug?.hasToken)
        }
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to read OpenClaw task status",
        detail: err?.message || String(err)
      }, 500);
    }
  }

  const resultMatch = url.pathname.match(/^\/api\/openclaw\/tasks\/([^/]+)\/result$/);
  if (resultMatch && request.method === "GET") {
    const id = decodeURIComponent(resultMatch[1]);
    try {
      const task = await readOpenClawTaskById(env, id);
      if (!task) {
        return jsonResponse({ ok: false, error: "OpenClaw task not found" }, 404);
      }
      const finalized = await finalizeOpenClawTaskResult(env, task);
      if (!finalized.ok) {
        return jsonResponse({
          ok: false,
          error: finalized.error || "OpenClaw task result failed",
          task: finalized.task || task
        }, 502);
      }
      return jsonResponse({
        ok: true,
        saved: Boolean(finalized.saved),
        duplicate: Boolean(finalized.duplicate),
        task: finalized.task,
        result: finalized.result || ""
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to fetch OpenClaw task result",
        detail: err?.message || String(err)
      }, 500);
    }
  }

  const cancelMatch = url.pathname.match(/^\/api\/openclaw\/tasks\/([^/]+)\/cancel$/);
  if (cancelMatch && request.method === "POST") {
    const id = decodeURIComponent(cancelMatch[1]);
    try {
      const task = await readOpenClawTaskById(env, id);
      if (!task) {
        return jsonResponse({ ok: false, error: "OpenClaw task not found" }, 404);
      }
      if (isOpenClawTaskTerminalStatus(task.status) || isOpenClawTaskTerminalStatus(task.storedStatus)) {
        return jsonResponse({
          ok: true,
          remote: Boolean(openClawRemoteTaskId(task)),
          cancelled: false,
          terminal: true,
          task
        });
      }
      const remoteTaskId = openClawRemoteTaskId(task);
      if (!remoteTaskId) {
        const localTask = await markOpenClawTaskCancelRequested(env, task, "Cancel requested locally. This task has no remote_task_id.");
        return jsonResponse({
          ok: true,
          remote: false,
          cancelled: false,
          task: localTask
        });
      }
      const remoteResult = await cancelOpenClawTask(env, remoteTaskId, task);
      if (!remoteResult.ok) {
        const localTask = await markOpenClawTaskCancelRequested(env, task, remoteResult.error || "Cancel requested locally. Remote cancel is unavailable.");
        return jsonResponse({
          ok: true,
          remote: true,
          remoteAvailable: false,
          cancelled: false,
          error: remoteResult.error || "OpenClaw remote cancel unavailable",
          task: localTask
        });
      }
      const syncedTask = await syncOpenClawRemoteTask(env, task, remoteResult, {
        status: localStatusFromRemoteStatus(normalizeRemoteTaskPayload(remoteResult).status, "cancelled")
      });
      return jsonResponse({
        ok: true,
        remote: true,
        remoteAvailable: true,
        cancelled: true,
        task: syncedTask,
        remoteStatus: normalizeRemoteTaskPayload(remoteResult)
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to cancel OpenClaw task",
        detail: err?.message || String(err)
      }, 500);
    }
  }

  const match = url.pathname.match(/^\/api\/openclaw\/tasks\/([^/]+)\/mark-aborted$/);
  if (match && request.method === "POST") {
    if (!env.DB) {
      return jsonResponse({ ok: false, error: "D1 binding DB is not configured" }, 500);
    }
    const id = decodeURIComponent(match[1]);
    const now = Date.now();
    try {
      await env.DB.prepare(
        `UPDATE openclaw_tasks
          SET status = ?,
            updated_at = ?,
            error = ?
          WHERE id = ? AND status IN ('running', 'disconnected', 'expired')`
      ).bind(
        "aborted",
        now,
        "User stopped waiting locally. Remote task may still be running.",
        id
      ).run();
      let task = await readOpenClawTaskById(env, id);
      if (openClawRemoteTaskId(task) && (task.storedStatus === "aborted" || task.status === "aborted")) {
        task = await runOpenClawTerminalRemoteSync(env, ctx, task, "aborted") || task;
      }
      return jsonResponse({ ok: true, id, status: "aborted", updatedAt: now, task });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to update OpenClaw task",
        detail: err?.message || String(err)
      }, 500);
    }
  }

  if (url.pathname.startsWith("/api/openclaw/tasks")) {
    return jsonResponse({
      ok: false,
      error: "OpenClaw task route not found",
      method: request.method,
      pathname: url.pathname
    }, 404);
  }

  return null;
}

function cleanCandidateUrl(value) {
  return String(value || "").replace(/[)\].,;!?，。；！？）】]+$/u, "");
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".");

  if (parts.length !== 4 || !parts.every(part => /^\d+$/.test(part))) {
    return false;
  }

  const numbers = parts.map(part => Number(part));

  if (numbers.some(value => value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = numbers;

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedHostname(hostname) {
  const host = String(hostname || "").toLowerCase();

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    isPrivateIPv4(host)
  );
}

function isPrivateBrowserIPv4(hostname) {
  const parts = String(hostname || "").split(".");

  if (parts.length !== 4 || !parts.every(part => /^\d+$/.test(part))) {
    return false;
  }

  const numbers = parts.map(part => Number(part));

  if (numbers.some(value => value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = numbers;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function validateBrowserUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      ok: false,
      error: "URL is required"
    };
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch (err) {
    return {
      ok: false,
      error: "Invalid URL"
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "Only http and https URLs are allowed"
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const bareHostname = hostname.replace(/^\[|\]$/g, "");

  if (
    !bareHostname ||
    bareHostname === "localhost" ||
    bareHostname.endsWith(".localhost") ||
    bareHostname === "::1" ||
    bareHostname === "0.0.0.0" ||
    isPrivateBrowserIPv4(bareHostname)
  ) {
    return {
      ok: false,
      error: "Private or local URLs are not allowed"
    };
  }

  return {
    ok: true,
    url: parsed.href
  };
}

function browserJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function callBrowserTool(env, payload) {
  const endpoint = String(env.BROWSER_TOOL_ENDPOINT || "").trim();
  const authMode = String(env.BROWSER_TOOL_AUTH_MODE || "").trim().toLowerCase();
  const debug = {
    timeoutMs: BROWSER_TOOL_TIMEOUT_MS,
    endpointConfigured: Boolean(endpoint),
    authMode: authMode || "none"
  };

  if (!endpoint) {
    return {
      ok: false,
      error: "BROWSER_TOOL_ENDPOINT is not configured",
      debug
    };
  }

  const token = String(env.BROWSER_TOOL_TOKEN || "").trim();
  const headers = {
    "Content-Type": "application/json"
  };

  if (token && authMode === "x-browser-token") {
    headers["X-Browser-Token"] = token;
  } else if (token && authMode === "bearer") {
    headers.Authorization = "Bearer " + token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSER_TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      data = {
        text
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: data.error || "Browser tool upstream request failed",
        details: data.details || text || ("HTTP " + response.status),
        debug
      };
    }

    return {
      ok: true,
      url: data.url || payload.url,
      title: data.title || "",
      text: data.text || data.extractedText || "",
      screenshot: data.screenshot || data.screenshotBase64 || data.screenshotUrl || "",
      metadata: data.metadata || {}
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === "AbortError" ? "Browser tool request timed out" : "Browser tool request failed",
      details: err.message || String(err),
      debug
    };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectBrowserToolEndpoint(env) {
  const endpoint = String(env.BROWSER_TOOL_ENDPOINT || "").trim();

  if (!endpoint) {
    return {
      ok: false,
      error: "BROWSER_TOOL_ENDPOINT is not configured"
    };
  }

  let parsed;

  try {
    parsed = new URL(endpoint);
  } catch (err) {
    return {
      ok: false,
      error: "BROWSER_TOOL_ENDPOINT is not a valid URL"
    };
  }

  const endpointText = (parsed.hostname + " " + parsed.pathname).toLowerCase();
  const token = String(env.BROWSER_TOOL_TOKEN || "").trim();
  const authMode = String(env.BROWSER_TOOL_AUTH_MODE || "").trim().toLowerCase();
  const headers = {
    "Content-Type": "application/json"
  };

  if (token && authMode === "x-browser-token") {
    headers["X-Browser-Token"] = token;
  } else if (token && authMode === "bearer") {
    headers.Authorization = "Bearer " + token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSER_TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "https://example.com",
        mode: "extract"
      }),
      signal: controller.signal
    });
    const bodyText = await response.text();
    const responseHeaders = {};

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: true,
      endpoint: {
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        contains: {
          novnc: endpointText.includes("novnc"),
          vnc: endpointText.includes("vnc"),
          websockify: endpointText.includes("websockify"),
          playwright: endpointText.includes("playwright"),
          browser: endpointText.includes("browser"),
          openclaw: endpointText.includes("openclaw")
        }
      },
      upstream: {
        status: response.status,
        headers: responseHeaders,
        bodyPrefix: bodyText.slice(0, 200)
      }
    };
  } catch (err) {
    return {
      ok: false,
      endpoint: {
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        contains: {
          novnc: endpointText.includes("novnc"),
          vnc: endpointText.includes("vnc"),
          websockify: endpointText.includes("websockify"),
          playwright: endpointText.includes("playwright"),
          browser: endpointText.includes("browser"),
          openclaw: endpointText.includes("openclaw")
        }
      },
      error: err.name === "AbortError" ? "Browser tool request timed out" : "Browser tool request failed",
      details: err.message || String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleBrowserRequest(request, env) {
  let body = {};

  try {
    body = await request.json();
  } catch (err) {
    return browserJsonResponse({
      ok: false,
      error: "Invalid JSON request body"
    }, 400);
  }

  const validation = validateBrowserUrl(body.url);

  if (!validation.ok) {
    return browserJsonResponse({
      ok: false,
      error: validation.error
    }, 400);
  }

  const mode = ["extract", "screenshot", "full"].includes(body.mode)
    ? body.mode
    : "full";
  const result = await callBrowserTool(env, {
    url: validation.url,
    mode
  });

  return browserJsonResponse(result, result.ok ? 200 : 502);
}

function getAutoFetchToolCall(userContent) {
  const match = String(userContent || "").match(/https?:\/\/[^\s<>"']+/i);

  if (!match) {
    return null;
  }

  const candidate = cleanCandidateUrl(match[0]);

  if (!candidate || candidate.length > MAX_AUTO_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (isBlockedHostname(url.hostname)) {
      return null;
    }

    return {
      name: "fetch_url",
      args: {
        url: url.href
      }
    };
  } catch (err) {
    return null;
  }
}

function hasBlockedUrl(userContent) {
  const matches = String(userContent || "").match(/https?:\/\/[^\s<>"']+/gi) || [];

  return matches.some(value => {
    const candidate = cleanCandidateUrl(value);

    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return isBlockedHostname(url.hostname);
    } catch (err) {
      return false;
    }
  });
}

function cleanSearchQuery(userContent) {
  return String(userContent || "")
    .replace(/^\s*(帮我|请|麻烦你|麻烦|给我)?\s*(搜索|查一下|查询|联网查)\s*/i, "")
    .replace(/^\s*(please\s+)?(search|look up)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_AUTO_SEARCH_QUERY_LENGTH);
}

function isSearchQueryLongEnough(query) {
  const compact = String(query || "").trim();
  const chineseChars = compact.match(/[\u4e00-\u9fff]/g) || [];
  const latinChars = compact.match(/[a-z]/gi) || [];

  return chineseChars.length >= 2 || latinChars.length >= 3;
}

function getAutoSearchToolCall(userContent) {
  if (!AUTO_SEARCH_PATTERN.test(userContent || "")) {
    return null;
  }

  if (hasBlockedUrl(userContent)) {
    return null;
  }

  const query = cleanSearchQuery(userContent);

  if (!isSearchQueryLongEnough(query)) {
    return null;
  }

  return {
    name: "web_search",
    args: {
      query
    }
  };
}

function readStreamText(value) {
  if (value === "[DONE]") {
    return "";
  }

  try {
    const data = JSON.parse(value);

    return (
      data.response ||
      data.result?.response ||
      data.output_text ||
      data.text ||
      data.choices?.[0]?.delta?.content ||
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      ""
    );
  } catch (err) {
    return "";
  }
}

function createModelSelectionError(message) {
  const error = new Error(message);
  error.name = "ModelSelectionError";
  return error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeImageAttachment(attachment, index) {
    if (!isPlainObject(attachment)) {
      throw createModelSelectionError("Invalid image attachment at index " + index);
    }

    const type = String(attachment.type || "");
    const mimeType = String(attachment.mimeType || "");
    const dataUrl = String(attachment.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);

    if (type !== "image") {
      throw createModelSelectionError("Invalid image attachment type at index " + index);
    }

    if (!mimeType.startsWith("image/")) {
      throw createModelSelectionError("Invalid image attachment mimeType at index " + index);
    }

    if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) {
      throw createModelSelectionError("Invalid image attachment dataUrl at index " + index);
    }

    try {
      atob(match[2].replace(/\s/g, ""));
    } catch (err) {
      throw createModelSelectionError("Invalid image attachment base64 at index " + index);
    }

    return {
      type: "image",
      mimeType,
      dataUrl
    };
}

function normalizeImageAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_IMAGE_ATTACHMENTS).map((attachment, index) => {
    return normalizeImageAttachment(attachment, index);
  });
}

function imageDataUrlToAttachment(dataUrl, index = 0) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);

  if (!match) {
    throw createModelSelectionError("Invalid image dataUrl");
  }

  return normalizeImageAttachment({
    type: "image",
    mimeType: match[1],
    dataUrl: value
  }, index);
}

function buildMultimodalUserContent(text, attachments) {
  return [
    {
      type: "text",
      text
    },
    ...attachments.map(attachment => ({
      type: "image_url",
      image_url: {
        url: attachment.dataUrl
      }
    }))
  ];
}

function countProviderImages(messages) {
  return (messages || []).reduce((count, message) => {
    if (!Array.isArray(message?.content)) {
      return count;
    }

    return count + message.content.filter(part => part?.type === "image_url").length;
  }, 0);
}

function providerLabelFromModel(model) {
  if ((model.provider || "") === "cloudflare-proxied") {
    return "Cloudflare proxied Claude";
  }

  if ((model.provider || "") === "glm") {
    return "GLM Coding";
  }

  if ((model.provider || "") === "kimi") {
    return "Kimi";
  }

  if (model.providerType === "openai-compatible") {
    return "Custom OpenAI-compatible";
  }

  return "Workers AI";
}

function providersFromModels(models) {
  const providers = new Map();

  (models || []).forEach(model => {
    if (model.deprecated || model.enabled === false || !model.capabilities?.text) {
      return;
    }

    const isClaudeCompatible = (model.provider || "") === "cloudflare-proxied" ||
      String(model.id || model.modelName || "").startsWith("anthropic/claude");
    const providerType = isClaudeCompatible ? "claude-compatible" : (model.providerType || "workers-ai");
    const providerId = isClaudeCompatible ? (model.provider || "cloudflare-proxied") : (model.provider || model.providerType || "workers-ai");

    if (!providers.has(providerId)) {
      providers.set(providerId, {
        id: providerId,
        label: providerLabelFromModel(model),
        providerType,
        apiBase: model.apiBase || "",
        apiKeyEnv: model.apiKeyEnv || "",
        builtin: true,
        models: []
      });
    }

    providers.get(providerId).models.push({
      id: model.id,
      label: model.label || model.id,
      modelName: model.modelName || model.id,
      providerType,
      apiBase: model.apiBase || "",
      apiKeyEnv: model.apiKeyEnv || "",
      capabilities: model.capabilities || { text: true, streaming: true },
      enabled: model.enabled !== false,
      recommended: Boolean(model.recommended)
    });
  });

  return Array.from(providers.values());
}

function normalizeProvider(provider) {
  if (!isPlainObject(provider)) {
    return null;
  }

  const id = String(provider.providerId || provider.id || provider.provider || "").trim();

  if (!id) {
    return null;
  }

  return {
    id,
    label: String(provider.providerName || provider.label || id),
    providerType: String(provider.providerType || provider.type || provider.category || id || "workers-ai"),
    apiBase: String(provider.apiBase || provider.baseUrl || ""),
    apiKeyEnv: String(provider.apiKeyEnv || ""),
    builtin: Boolean(provider.builtin),
    enabled: provider.enabled !== false,
    models: Array.isArray(provider.models)
      ? provider.models
        .map(model => normalizeProviderModel(model, provider))
        .filter(Boolean)
      : []
  };
}

function normalizeProviderModel(model, provider) {
  if (!isPlainObject(model)) {
    return null;
  }

  const id = String(model.modelId || model.id || model.model || model.modelName || "").trim();

  if (!id) {
    return null;
  }

  return {
    id,
    label: String(model.displayName || model.label || id),
    modelName: String(model.upstreamModelName || model.modelName || model.model || id),
    providerType: String(model.providerType || provider.providerType || "workers-ai"),
    apiBase: String(model.apiBase || model.baseUrl || provider.apiBase || ""),
    apiKeyEnv: String(model.apiKeyEnv || provider.apiKeyEnv || ""),
    capabilities: model.capabilities || { text: true, streaming: true },
    enabled: model.enabled !== false,
    recommended: Boolean(model.recommended)
  };
}

function mergeProviders(baseProviders, nextProviders) {
  const merged = new Map();

  (baseProviders || []).forEach(provider => {
    const normalized = normalizeProvider(provider);

    if (normalized) {
      merged.set(normalized.id, normalized);
    }
  });

  (nextProviders || []).forEach(provider => {
    const normalized = normalizeProvider(provider);

    if (!normalized) {
      return;
    }

    const existing = merged.get(normalized.id);

    if (!existing) {
      merged.set(normalized.id, normalized);
      return;
    }

    const models = new Map((existing.models || []).map(model => [model.id, model]));
    (normalized.models || []).forEach(model => models.set(model.id, {
      ...models.get(model.id),
      ...model
    }));

    merged.set(normalized.id, {
      ...existing,
      ...normalized,
      models: Array.from(models.values())
    });
  });

  return Array.from(merged.values());
}

function providersFromCategories(categories) {
  const providers = [];

  (categories || []).forEach(category => {
    const type = String(category?.type || category?.category || "").trim();

    if (type === "workers-hosted") {
      providers.push({
        id: "workers-ai",
        label: "Workers 托管",
        providerType: "workers-ai",
        apiBase: "",
        apiKeyEnv: "",
        builtin: true,
        enabled: true,
        models: (category.models || []).map(model => ({
          id: model.modelId || model.id,
          label: model.displayName || model.label || model.modelId || model.id,
          modelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
          providerType: "workers-ai",
          capabilities: model.capabilities || { text: true, streaming: true },
          enabled: model.enabled !== false
        }))
      });
      return;
    }

    if (type === "claude-compatible" || type === "openai-compatible") {
      (category.providers || []).forEach(provider => {
        providers.push({
          id: provider.providerId || provider.id,
          label: provider.providerName || provider.label || provider.providerId || provider.id,
          providerType: type,
          apiBase: provider.baseUrl || provider.apiBase || "",
          apiKeyEnv: provider.apiKeyEnv || "",
          builtin: Boolean(provider.builtin),
          enabled: provider.enabled !== false,
          models: (provider.models || []).map(model => ({
            id: model.modelId || model.id,
            label: model.displayName || model.label || model.modelId || model.id,
            modelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
            providerType: type,
            capabilities: model.capabilities || { text: true, streaming: true },
            enabled: model.enabled !== false
          }))
        });
      });
    }
  });

  return providers.filter(provider => provider.id);
}

async function readSavedProviders(env) {
  if (!env.DB) {
    return [];
  }

  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = ?"
    ).bind(MODEL_SETTINGS_KEY).first();

    if (!row?.value) {
      return [];
    }

    const settings = JSON.parse(row.value);
    if (Array.isArray(settings?.providers) && settings.providers.length) {
      return settings.providers;
    }
    if (Array.isArray(settings?.categories) || Array.isArray(settings?.modelCategories)) {
      return providersFromCategories(settings.categories || settings.modelCategories);
    }
    return [];
  } catch (err) {
    console.warn("[model-settings] failed to read settings.providers", err.message || String(err));
    return [];
  }
}

function customConfigToProvider(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const provider = String(config.provider || "").trim();
  const id = String(config.id || config.modelName || config.model || "").trim();

  if (!provider || !id) {
    return null;
  }

  return {
    id: provider,
    label: provider,
    providerType: String(config.providerType || "openai-compatible"),
    apiBase: String(config.apiBase || config.baseUrl || ""),
    apiKeyEnv: String(config.apiKeyEnv || ""),
    models: [{
      id,
      label: String(config.label || id),
      modelName: String(config.modelName || config.model || id),
      providerType: String(config.providerType || "openai-compatible"),
      apiBase: String(config.apiBase || config.baseUrl || ""),
      apiKeyEnv: String(config.apiKeyEnv || ""),
      capabilities: config.capabilities || { text: true, streaming: true },
      enabled: true
    }]
  };
}

export async function buildModelProviderCatalog(env, requestProviders, customModelConfig, fallbackCustomModelConfig) {
  const defaultProviders = providersFromModels(MODELS);
  const savedProviders = await readSavedProviders(env);
  const customProviders = [
    customConfigToProvider(customModelConfig),
    customConfigToProvider(fallbackCustomModelConfig)
  ].filter(Boolean);

  return mergeProviders(
    mergeProviders(defaultProviders, savedProviders),
    mergeProviders(requestProviders || [], customProviders)
  );
}

function findProviderModel(providerCatalog, providerId, modelId) {
  const requestedProvider = String(providerId || "").trim();
  const requestedModel = String(modelId || "").trim();
  const enabledProviders = (providerCatalog || []).filter(item => item.enabled !== false);
  const provider = requestedProvider
    ? enabledProviders.find(item => item.id === requestedProvider)
    : enabledProviders.find(item => (item.models || []).some(model => model.enabled !== false && (model.id === requestedModel || model.modelName === requestedModel)));
  const model = provider
    ? (provider.models || []).find(item => item.enabled !== false && (item.id === requestedModel || item.modelName === requestedModel))
    : null;

  console.log("[model-validation]", {
    selectedProvider: requestedProvider || provider?.id || "",
    selectedModel: requestedModel,
    providerFound: Boolean(provider),
    modelFound: Boolean(model),
    providerModelsCount: provider?.models?.length || 0
  });

  return { provider, model };
}

function normalizeCustomModelConfig(config, { required = false } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    if (required) {
      throw createModelSelectionError("Custom model config is required");
    }
    return null;
  }

  const providerType = String(config.providerType || config.provider || "").trim();
  const apiBase = String(config.apiBase || config.baseUrl || "").trim();
  const apiKeyEnv = String(config.apiKeyEnv || "").trim();
  const modelName = String(config.modelName || config.model || config.id || "").trim();
  const id = String(config.id || modelName).trim();
  const provider = String(config.provider || "").trim();

  if (!provider) {
    throw createModelSelectionError("Unknown provider: " + (config.provider || ""));
  }

  if (providerType !== "openai-compatible") {
    throw createModelSelectionError("Unknown provider: " + provider);
  }

  if (!apiBase) {
    throw createModelSelectionError("OpenAI-compatible provider " + provider + " is missing baseUrl");
  }

  if (!apiKeyEnv) {
    throw createModelSelectionError("OpenAI-compatible provider " + provider + " is missing apiKeyEnv");
  }

  if (!modelName || !id) {
    throw createModelSelectionError("Unknown model for provider " + provider + ": " + (config.model || config.modelName || config.id || ""));
  }

  return {
    id,
    label: String(config.label || id),
    provider,
    providerType: "openai-compatible",
    apiBase,
    apiKeyEnv,
    modelName,
    capabilities: {
      text: true,
      streaming: true,
      ...(config.capabilities || {})
    },
    enabled: true
  };
}

export async function callSelectedModel({ env, provider, model, messages, stream, providerCatalog, max_tokens, temperature }) {
  const requestedModel = String(model || "").trim();
  const requestedProvider = String(provider || "").trim();
  const providerMessages = filterEmptySystemMessages(messages);

  if (!requestedModel) {
    throw createModelSelectionError("Model is required");
  }

  const { provider: selectedProvider, model: selectedModel } = findProviderModel(providerCatalog, requestedProvider, requestedModel);

  if (!selectedProvider) {
    throw createModelSelectionError("Unknown provider: " + requestedProvider);
  }

  if (!selectedModel) {
    throw createModelSelectionError("Unknown model for provider " + selectedProvider.id + ": " + requestedModel);
  }

  const providerType = selectedModel.providerType || selectedProvider.providerType;

  if (providerType === "openai-compatible") {
    const config = normalizeCustomModelConfig({
      id: selectedModel.id,
      label: selectedModel.label,
      provider: selectedProvider.id,
      providerType,
      apiBase: selectedModel.apiBase || selectedProvider.apiBase,
      apiKeyEnv: selectedModel.apiKeyEnv || selectedProvider.apiKeyEnv,
      modelName: selectedModel.modelName || selectedModel.id
    }, { required: true });

    if (!env[config.apiKeyEnv]) {
      throw new ProviderError("API key env " + config.apiKeyEnv + " is not configured", {
        provider: config.provider,
        model: config.id,
        code: "missing_api_key"
      });
    }

    const response = await callOpenAICompatible({
      env,
      config,
      messages: providerMessages,
      stream,
      max_tokens,
      temperature,
      timeoutMs: isOpenClawProviderModel(selectedProvider, selectedModel)
        ? OPENCLAW_CHAT_TIMEOUT_MS
        : undefined
    });

    return {
      provider: config.provider,
      providerType: config.providerType,
      model: config.id,
      modelName: config.modelName,
      stream: Boolean(stream),
      response
    };
  }

  if (providerType === "workers-ai" || providerType === "claude-compatible") {
    const runtimeConfig = getModelRuntimeConfig(selectedModel.id);
    const response = runtimeConfig
      ? (await callModel({
        env,
        model: selectedModel.id,
        messages: providerMessages,
        stream,
        max_tokens,
        temperature
      })).response
      : await callWorkersAI({
        env,
        model: selectedModel.modelName || selectedModel.id,
        messages: providerMessages,
        stream,
        max_tokens,
        temperature
      });

    return {
      provider: selectedProvider.id,
      providerType,
      model: selectedModel.id,
      modelName: selectedModel.modelName || selectedModel.id,
      stream: Boolean(stream),
      response
    };
  }

  throw createModelSelectionError("Unknown provider: " + selectedProvider.id);
}

function buildFileSources(fileChunks) {
  const seen = new Set();

  return (fileChunks || [])
    .map(chunk => ({
      file_id: chunk.fileId,
      filename: chunk.filename,
      chunk_index: chunk.chunkIndex,
      score: Number(chunk.score || 0),
      preview: String(chunk.content || "").slice(0, 400)
    }))
    .filter(source => {
      if (!source.file_id || source.chunk_index === undefined || source.chunk_index === null) {
        return false;
      }

      const key = source.file_id + ":" + source.chunk_index;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.filename !== b.filename) {
        return String(a.filename || "").localeCompare(String(b.filename || ""));
      }

      return Number(a.chunk_index || 0) - Number(b.chunk_index || 0);
    })
    .slice(0, 8);
}

function formatToolContext(toolCall) {
  if (!toolCall) {
    return "";
  }

  const result = toolCall.result || {};

  if (toolCall.name === "web_search") {
    const results = Array.isArray(result.results) ? result.results : [];
    const freshness = result.freshness || "";
    const freshnessLines = freshness
      ? [
        "Freshness: " + freshness,
        "",
        "本次问题需要最新信息。",
        "请优先依据下面搜索结果回答。",
        "优先使用带有发布日期、age 或 page_age 的结果。",
        "不要使用未经搜索结果支持的旧知识补充新闻细节。",
        "",
        "This query requires up-to-date information.",
        "Prioritize the search results below.",
        "Prefer results with publish dates, age, or page_age metadata.",
        "Do not add unsupported news details from model prior knowledge.",
        ""
      ]
      : [];

    return [
      "Tool result: web_search",
      "Query: " + (result.query || toolCall.args?.query || ""),
      ...freshnessLines,
      "",
      results.length
        ? results.map((item, index) => [
          "[" + (index + 1) + "] " + (item.title || "Untitled"),
          "URL: " + (item.url || ""),
          item.source ? "Source: " + item.source : "",
          item.age ? "Age: " + item.age : "",
          item.page_age ? "Page age: " + item.page_age : "",
          item.published ? "Published: " + item.published : "",
          "Snippet: " + (item.snippet || item.description || "")
        ].filter(Boolean).join("\n")).join("\n\n")
        : "No search results returned."
    ].join("\n");
  }

  if (toolCall.name === "fetch_url") {
    return [
      "Tool result: fetch_url",
      "Title: " + (result.title || "Untitled Page"),
      "URL: " + (result.url || toolCall.args?.url || ""),
      result.truncated ? "Note: content was truncated for prompt size." : "",
      "",
      result.text || result.content || ""
    ].filter(Boolean).join("\n");
  }

  return [
    "Tool result: " + toolCall.name,
    JSON.stringify(result, null, 2)
  ].join("\n");
}

function buildToolSources(toolCall) {
  if (!toolCall || toolCall.error) {
    return [];
  }

  const result = toolCall.result || {};

  if (toolCall.name === "web_search") {
    return (Array.isArray(result.results) ? result.results : [])
      .map(item => ({
        type: "web_search",
        title: item.title || "Untitled",
        url: item.url || "",
        snippet: item.snippet || item.description || "",
        age: item.age || "",
        page_age: item.page_age || "",
        published: item.published || "",
        source: item.source || "",
        freshness: result.freshness || ""
      }))
      .filter(source => source.url)
      .slice(0, 8);
  }

  if (toolCall.name === "fetch_url") {
    const preview = String(result.text || result.content || "").slice(0, 500);

    return result.url
      ? [{
        type: "fetch_url",
        title: result.title || "Untitled Page",
        url: result.url,
        snippet: preview,
        preview
      }]
      : [];
  }

  return [];
}

function getToolArgUrl(args = {}) {
  return String(args.url || args.pageUrl || "").trim();
}

function truncateDebugValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TOOL_DEBUG_SUMMARY_LENGTH);
}

function getToolTargetSummary(toolCall = {}) {
  if (toolCall.name === "fetch_url") {
    return {
      url: truncateDebugValue(getToolArgUrl(toolCall.args))
    };
  }

  if (toolCall.name === "web_search") {
    return {
      query: truncateDebugValue(toolCall.args?.query)
    };
  }

  return {};
}

function getToolResultDebug(result = {}) {
  if (!result || !Array.isArray(result.results)) {
    return {};
  }

  return {
    query: truncateDebugValue(result.query || ""),
    freshness: result.freshness || "none",
    result_count: result.results.length,
    results: result.results.map(item => ({
      title: truncateDebugValue(item.title || ""),
      age: item.age || "",
      page_age: item.page_age || "",
      published: item.published || "",
      source: item.source || ""
    }))
  };
}

function withToolTrigger(toolCall, trigger) {
  if (!toolCall) {
    return null;
  }

  return {
    ...toolCall,
    trigger
  };
}

function normalizeToolError(name, error, args = {}) {
  const rawMessage = String(error?.message || error || "");
  const recoverable = true;

  if (name === "web_search") {
    if (/BRAVE_SEARCH_API_KEY/i.test(rawMessage)) {
      return {
        name,
        message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u7f3a\u5c11 BRAVE_SEARCH_API_KEY",
        recoverable,
        code: "missing_brave_search_api_key"
      };
    }

    if (/HTTP\s+\d+/i.test(rawMessage)) {
      return {
        name,
        message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u641c\u7d22 API \u8fd4\u56de\u9519\u8bef",
        recoverable,
        code: "search_api_error"
      };
    }

    if (/timeout|timed out|network|fetch failed|AbortError/i.test(rawMessage)) {
      return {
        name,
        message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25\u6216\u8d85\u65f6",
        recoverable,
        code: "network_or_timeout"
      };
    }

    return {
      name,
      message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u672a\u77e5\u5de5\u5177\u9519\u8bef",
      recoverable,
      code: "unknown_tool_error"
    };
  }

  if (name === "fetch_url") {
    if (rawMessage === "invalid_url") {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1aURL \u4e0d\u5408\u6cd5",
        recoverable,
        code: "invalid_url"
      };
    }

    if (rawMessage === "blocked_private_url") {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u5185\u7f51\u6216\u672c\u5730\u5730\u5740\u5df2\u88ab\u62e6\u622a",
        recoverable,
        code: "blocked_private_url"
      };
    }

    if (/valid http:\/\/ or https:\/\/ url|invalid url/i.test(rawMessage)) {
      return normalizeToolError(name, "invalid_url", args);
    }

    if (/HTTP\s+\d+/i.test(rawMessage)) {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u65e0\u6cd5\u8bbf\u95ee\u8be5\u7f51\u9875",
        recoverable,
        code: "fetch_http_error"
      };
    }

    if (/timeout|timed out|network|fetch failed|AbortError/i.test(rawMessage)) {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25\u6216\u8d85\u65f6",
        recoverable,
        code: "network_or_timeout"
      };
    }

    return {
      name,
      message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u672a\u77e5\u5de5\u5177\u9519\u8bef",
      recoverable,
      code: "unknown_tool_error"
    };
  }

  return {
    name,
    message: "\u5de5\u5177\u8c03\u7528\u5931\u8d25\uff1a\u672a\u77e5\u5de5\u5177\u9519\u8bef",
    recoverable,
    code: "unknown_tool_error"
  };
}

function validateToolCall(toolCall) {
  if (!toolCall?.name) {
    return null;
  }

  if (toolCall.name !== "fetch_url") {
    return null;
  }

  const targetUrl = getToolArgUrl(toolCall.args);

  if (!targetUrl || targetUrl.length > MAX_AUTO_URL_LENGTH) {
    return normalizeToolError("fetch_url", "invalid_url", toolCall.args);
  }

  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return normalizeToolError("fetch_url", "invalid_url", toolCall.args);
    }

    if (isBlockedHostname(url.hostname)) {
      return normalizeToolError("fetch_url", "blocked_private_url", toolCall.args);
    }
  } catch (err) {
    return normalizeToolError("fetch_url", "invalid_url", toolCall.args);
  }

  return null;
}

async function runRequestedTool(toolCall, env) {
  if (!toolCall || !toolCall.name) {
    return null;
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const trigger = toolCall.trigger || "explicit";
  const target = getToolTargetSummary(toolCall);

  console.log("[tool]", {
    name: toolCall.name,
    trigger,
    started_at: startedAt,
    target
  });

  const validationError = validateToolCall(toolCall);

  if (validationError) {
    const durationMs = Date.now() - startedAtMs;
    const debug = {
      name: toolCall.name,
      trigger,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "error",
      code: validationError.code || "unknown_tool_error",
      target
    };

    console.warn("[tool]", debug);

    return {
      name: toolCall.name,
      args: toolCall.args || {},
      trigger,
      error: validationError.message,
      toolError: validationError,
      debug,
      result: {
        error: validationError.message
      }
    };
  }

  try {
    const result = await runTool(toolCall.name, toolCall.args || {}, env);
    const durationMs = Date.now() - startedAtMs;
    const debug = {
      name: toolCall.name,
      trigger,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "success",
      code: null,
      target,
      result: getToolResultDebug(result.result)
    };

    console.log("[tool]", debug);

    return {
      ...result,
      trigger,
      debug
    };
  } catch (err) {
    const toolError = normalizeToolError(toolCall.name, err, toolCall.args);
    const durationMs = Date.now() - startedAtMs;
    const debug = {
      name: toolCall.name,
      trigger,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "error",
      code: toolError.code || "unknown_tool_error",
      target
    };

    console.warn("[tool]", debug);

    return {
      name: toolCall.name,
      args: toolCall.args || {},
      trigger,
      error: toolError.message,
      toolError,
      debug,
      result: {
        error: toolError.message
      }
    };
  }
}

function getToolStatusMessage(name, status) {
  const messages = {
    web_search: {
      running: "\u6b63\u5728\u8054\u7f51\u641c\u7d22...",
      done: "\u8054\u7f51\u641c\u7d22\u5b8c\u6210",
      error: "\u8054\u7f51\u641c\u7d22\u5931\u8d25"
    },
    fetch_url: {
      running: "\u6b63\u5728\u6293\u53d6\u7f51\u9875...",
      done: "\u7f51\u9875\u6293\u53d6\u5b8c\u6210",
      error: "\u7f51\u9875\u6293\u53d6\u5931\u8d25"
    }
  };

  return messages[name]?.[status] || "";
}

function encodeSseEvent(event, data) {
  return (
    (event ? "event: " + event + "\n" : "") +
    "data: " + JSON.stringify(data) + "\n\n"
  );
}

function findOpenClawRemoteTaskId(value, options = {}) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const allowCompletionId = Boolean(options.allowCompletionId);
  const isCompletionChunk = Array.isArray(value.choices) || String(value.object || "").includes("chat.completion");
  if (isCompletionChunk && !allowCompletionId) {
    return "";
  }
  const direct = value.task_id
    || value.taskId
    || value.remote_task_id
    || value.remoteTaskId
    || value.task?.id
    || value.task?.task_id
    || value.task?.taskId
    || value.task?.remote_task_id
    || value.task?.remoteTaskId
    || value.data?.task_id
    || value.data?.taskId
    || value.data?.remote_task_id
    || value.data?.remoteTaskId
    || value.data?.task?.id
    || value.data?.task?.task_id
    || value.data?.task?.taskId
    || value.data?.task?.remote_task_id
    || value.data?.task?.remoteTaskId
    || (value.id && (!isCompletionChunk || allowCompletionId) ? value.id : "")
    || (value.data?.id && !Array.isArray(value.data?.choices) && !String(value.data?.object || "").includes("chat.completion") ? value.data.id : "");
  return typeof direct === "string" || typeof direct === "number"
    ? String(direct).trim()
    : "";
}

function openClawRemoteTaskDetail(value, options = {}) {
  const taskId = findOpenClawRemoteTaskId(value, options);
  if (!taskId) {
    return null;
  }
  const source = value?.data && typeof value.data === "object"
    ? { ...value, ...value.data }
    : value;
  return {
    taskId,
    status: source.status || "running",
    progress: source.progress ?? 0,
    message: source.message || "Remote task started"
  };
}

function extractOpenClawRemoteTaskFromText(text, options = {}) {
  const raw = String(text || "");
  if (!raw.trim()) {
    return null;
  }
  const candidates = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") {
      continue;
    }
    if (trimmed.startsWith("data:")) {
      candidates.push(trimmed.slice(5).trim());
    } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      candidates.push(trimmed);
    }
  }
  if (!candidates.length) {
    candidates.push(raw.trim());
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const detail = openClawRemoteTaskDetail(parsed, options);
      if (detail) {
        return detail;
      }
    } catch (err) {
      // Ignore non-JSON stream chunks.
    }
  }
  const textMatch = raw.match(/(?:remote[_\s-]*task[_\s-]*id|task[_\s-]*id|taskId)\s*[:=]\s*["']?([A-Za-z0-9._:-]{6,})/i)
    || raw.match(/\/tasks\/([A-Za-z0-9._:-]{6,})(?:[/?#\s"']|$)/i);
  if (textMatch?.[1]) {
    return {
      taskId: textMatch[1],
      status: "running",
      progress: 0,
      message: "Remote task started"
    };
  }
  return null;
}

function previewOpenClawSubmitText(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/"?((?:api[_-]?key|token|authorization))"?\s*[:=]\s*"[^"]+"/gi, "\"$1\":\"[redacted]\"")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

async function continueOpenClawAsyncStreamToCompletion({
  env,
  task,
  reader,
  initialText = ""
}) {
  const decoder = new TextDecoder();
  const bufferState = { value: "" };
  const replyState = { value: "" };
  let latestTask = task;
  let completed = false;

  try {
    if (initialText) {
      bufferState.value += initialText;
      appendReplyFromSseBuffer(bufferState, replyState);
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      const chunkText = decoder.decode(value, { stream: true });
      bufferState.value += chunkText;
      appendReplyFromSseBuffer(bufferState, replyState);
    }

    if (bufferState.value.trim()) {
      appendReplyFromSseBuffer({ value: bufferState.value + "\n\n" }, replyState);
    }

    const reply = replyState.value.trim();
    if (!reply) {
      logOpenClawAsync("background-stream-empty", {
        localTaskId: latestTask?.id || "",
        remoteTaskId: openClawRemoteTaskId(latestTask),
        completed
      });
      latestTask = await updateOpenClawTask(env, latestTask, {
        status: "disconnected",
        error: "OpenClaw async background stream completed without result",
        latencyMs: 0
      }) || latestTask;
      return latestTask;
    }

    const refreshedTask = await readOpenClawTaskById(env, latestTask.id) || latestTask;
    if (refreshedTask.assistantMessageId) {
      return refreshedTask;
    }

    const assistantMessage = env.DB
      ? await saveMessage(env.DB, refreshedTask.conversationId || refreshedTask.conversation_id, "assistant", reply)
      : null;
    if (env.DB) {
      await maybeUpdateConversationSummary(env, refreshedTask.conversationId || refreshedTask.conversation_id);
    }
    latestTask = await updateOpenClawTask(env, refreshedTask, {
      status: "completed",
      assistantMessageId: assistantMessage?.id || refreshedTask.assistantMessageId || "",
      latencyMs: 0
    }) || {
      ...refreshedTask,
      status: "completed",
      assistantMessageId: assistantMessage?.id || refreshedTask.assistantMessageId || ""
    };
    logOpenClawAsync("background-stream-completed", {
      localTaskId: latestTask?.id || "",
      remoteTaskId: openClawRemoteTaskId(latestTask),
      assistantMessageId: latestTask?.assistantMessageId || "",
      replyChars: reply.length
    });
    return latestTask;
  } catch (err) {
    logOpenClawAsync("background-stream-failed", {
      localTaskId: latestTask?.id || "",
      remoteTaskId: openClawRemoteTaskId(latestTask),
      error: err?.message || String(err)
    });
    latestTask = await updateOpenClawTask(env, latestTask, {
      status: "disconnected",
      error: err?.message || String(err),
      latencyMs: 0
    }) || latestTask;
    return latestTask;
  }
}

async function runOpenClawAsyncTaskInBackground({
  env,
  task,
  model,
  provider,
  providerCatalog,
  finalMessages
}) {
  const decoder = new TextDecoder();
  const bufferState = { value: "" };
  const replyState = { value: "" };
  let latestTask = task;
  let scannedBytes = 0;
  let scanText = "";
  let remoteTaskCaptured = Boolean(openClawRemoteTaskId(latestTask));

  try {
    logOpenClawAsync("background-submit-start", {
      localTaskId: latestTask?.id || "",
      conversationId: latestTask?.conversationId || latestTask?.conversation_id || "",
      provider,
      model
    });

    const result = await callSelectedModel({
      env,
      model: model || DEFAULT_TEXT_MODEL,
      provider,
      messages: finalMessages,
      stream: true,
      providerCatalog
    });

    const reader = result.response.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      const chunkText = decoder.decode(value, { stream: true });
      if (!remoteTaskCaptured && scannedBytes < OPENCLAW_ASYNC_SUBMIT_SCAN_BYTES) {
        scannedBytes += chunkText.length;
        scanText = (scanText + chunkText).slice(-OPENCLAW_ASYNC_SUBMIT_SCAN_BYTES);
        const remoteTask = extractOpenClawRemoteTaskFromText(scanText, {
          allowCompletionId: true
        });
        if (remoteTask) {
          latestTask = await updateOpenClawTaskRemoteStart(env, latestTask, remoteTask) || latestTask;
          remoteTaskCaptured = true;
          logOpenClawAsync("remote-task-id-extracted", {
            localTaskId: latestTask.id,
            remoteTaskId: remoteTask.taskId,
            scannedBytes
          });
        }
      }

      bufferState.value += chunkText;
      appendReplyFromSseBuffer(bufferState, replyState);
    }

    if (bufferState.value.trim()) {
      appendReplyFromSseBuffer({ value: bufferState.value + "\n\n" }, replyState);
    }

    const reply = replyState.value.trim();
    if (!reply) {
      logOpenClawAsync("background-stream-empty", {
        localTaskId: latestTask?.id || "",
        remoteTaskId: openClawRemoteTaskId(latestTask),
        scannedBytes,
        preview: previewOpenClawSubmitText(scanText)
      });
      latestTask = await updateOpenClawTask(env, latestTask, {
        status: "disconnected",
        error: "OpenClaw async background stream completed without result",
        latencyMs: 0
      }) || latestTask;
      return latestTask;
    }

    const refreshedTask = await readOpenClawTaskById(env, latestTask.id) || latestTask;
    if (refreshedTask.assistantMessageId) {
      return refreshedTask;
    }

    const assistantMessage = env.DB
      ? await saveMessage(env.DB, refreshedTask.conversationId || refreshedTask.conversation_id, "assistant", reply)
      : null;
    if (env.DB) {
      await maybeUpdateConversationSummary(env, refreshedTask.conversationId || refreshedTask.conversation_id);
    }
    latestTask = await updateOpenClawTask(env, refreshedTask, {
      status: "completed",
      assistantMessageId: assistantMessage?.id || refreshedTask.assistantMessageId || "",
      latencyMs: 0
    }) || {
      ...refreshedTask,
      status: "completed",
      assistantMessageId: assistantMessage?.id || refreshedTask.assistantMessageId || ""
    };
    logOpenClawAsync("background-stream-completed", {
      localTaskId: latestTask?.id || "",
      remoteTaskId: openClawRemoteTaskId(latestTask),
      assistantMessageId: latestTask?.assistantMessageId || "",
      replyChars: reply.length
    });
    return latestTask;
  } catch (err) {
    logOpenClawAsync("background-stream-failed", {
      localTaskId: latestTask?.id || "",
      remoteTaskId: openClawRemoteTaskId(latestTask),
      error: err?.message || String(err)
    });
    latestTask = await updateOpenClawTask(env, latestTask, {
      status: "disconnected",
      error: err?.message || String(err),
      latencyMs: 0
    }) || latestTask;
    return latestTask;
  }
}

function appendReplyFromSseBuffer(bufferState, replyState) {
  const events = bufferState.value.split("\n\n");
  bufferState.value = events.pop() || "";

  for (const event of events) {
    const lines = event
      .split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart());

    for (const line of lines) {
      replyState.value += readStreamText(line);
    }
  }
}

function appendToolContext(modelMessages, executedToolCall) {
  if (!executedToolCall) {
    return;
  }

  const toolContext = executedToolCall.error
    ? [
      "A requested tool call failed.",
      "Tool: " + executedToolCall.name,
      "Error: " + executedToolCall.error,
      "The tool call failed, so you cannot use real-time network results from this request.",
      "Answer only from existing knowledge and any other provided context, and clearly say that live tool data was unavailable."
    ].join("\n")
    : [
      "The user requested a single tool call before answering.",
      "Use the following tool result as context. Do not claim to have browsed beyond this result.",
      "",
      formatToolContext(executedToolCall)
    ].join("\n");

  modelMessages.push({
    role: "user",
    content: toolContext
  });
}

async function readOpenClawSubmitChunk(reader, timeoutMs) {
  let timeoutId = null;
  const timeout = new Promise(resolve => {
    timeoutId = setTimeout(() => resolve({ timeout: true }), timeoutMs);
  });
  try {
    return await Promise.race([
      reader.read(),
      timeout
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function submitOpenClawAsyncTask({
  env,
  ctx,
  conversationId,
  openClawTask,
  model,
  provider,
  providerCatalog,
  finalMessages
}) {
  if (!openClawTask) {
    return { ok: false, error: "OpenClaw local task was not created", task: null };
  }
  if (ctx?.waitUntil) {
    logOpenClawAsync("submit-background-scheduled", {
      localTaskId: openClawTask.id,
      conversationId,
      provider,
      model
    });
    ctx.waitUntil(runOpenClawAsyncTaskInBackground({
      env,
      task: openClawTask,
      model,
      provider,
      providerCatalog,
      finalMessages
    }).catch(err => {
      console.warn("[openclaw-async] background task failed", err?.message || String(err));
    }));
    return {
      ok: true,
      mode: "async",
      submitted: true,
      task: openClawTask
    };
  }
  const decoder = new TextDecoder();
  const bufferState = { value: "" };
  const replyState = { value: "" };
  let task = openClawTask;
  let result = null;
  let reader = null;
  let scannedBytes = 0;
  let scanText = "";
  let streamDone = false;

  try {
    logOpenClawAsync("submit-start", {
      localTaskId: task.id,
      conversationId,
      provider,
      model
    });
    result = await callSelectedModel({
      env,
      model: model || DEFAULT_TEXT_MODEL,
      provider,
      messages: finalMessages,
      stream: true,
      providerCatalog
    });
    reader = result.response.getReader();
    while (scannedBytes < OPENCLAW_ASYNC_SUBMIT_SCAN_BYTES) {
      const chunk = await readOpenClawSubmitChunk(reader, OPENCLAW_ASYNC_SUBMIT_TIMEOUT_MS);
      if (chunk?.timeout) {
        await reader.cancel("OpenClaw async submit timeout waiting for task id").catch(() => {});
        break;
      }
      if (chunk.done) {
        streamDone = true;
        break;
      }
      const chunkText = decoder.decode(chunk.value, { stream: true });
      scannedBytes += chunkText.length;
      scanText = (scanText + chunkText).slice(-OPENCLAW_ASYNC_SUBMIT_SCAN_BYTES);
      const remoteTask = extractOpenClawRemoteTaskFromText(scanText, {
        allowCompletionId: true
      });
      if (remoteTask) {
        task = await updateOpenClawTaskRemoteStart(env, task, remoteTask) || task;
        logOpenClawAsync("remote-task-id-extracted", {
          localTaskId: task.id,
          remoteTaskId: remoteTask.taskId,
          scannedBytes
        });
        if (ctx?.waitUntil) {
          ctx.waitUntil(continueOpenClawAsyncStreamToCompletion({
            env,
            task,
            reader,
            initialText: scanText
          }).catch(err => {
            console.warn("[openclaw-async] background stream waitUntil failed", err?.message || String(err));
          }));
        } else {
          await reader.cancel("OpenClaw async task id captured").catch(() => {});
        }
        return {
          ok: true,
          mode: "async",
          submitted: true,
          task
        };
      }
      bufferState.value += chunkText;
      appendReplyFromSseBuffer(bufferState, replyState);
    }

    if (streamDone && bufferState.value.trim()) {
      appendReplyFromSseBuffer({ value: bufferState.value + "\n\n" }, replyState);
    }

    if (streamDone && replyState.value) {
      const assistantMessage = env.DB
        ? await saveMessage(env.DB, conversationId, "assistant", replyState.value)
        : null;
      if (env.DB) {
        await maybeUpdateConversationSummary(env, conversationId);
      }
      task = await updateOpenClawTask(env, task, {
        status: "completed",
        assistantMessageId: assistantMessage?.id || "",
        latencyMs: 0
      }) || {
        ...task,
        status: "completed",
        assistantMessageId: assistantMessage?.id || ""
      };
      if (ctx?.waitUntil) {
        ctx.waitUntil(runOpenClawTerminalRemoteSync(env, ctx, task, "completed").catch(err => {
          console.warn("[openclaw-task] async terminal sync failed", err?.message || String(err));
        }));
      }
      return {
        ok: true,
        mode: "async",
        submitted: false,
        completed: true,
        task
      };
    }

    if (reader && !streamDone) {
      await reader.cancel("OpenClaw async submit ended without task id").catch(() => {});
    }
    logOpenClawAsync("remote-task-id-missing", {
      localTaskId: task.id,
      conversationId,
      scannedBytes,
      streamDone,
      partialReplyChars: replyState.value.length,
      preview: previewOpenClawSubmitText(scanText)
    });
    task = await updateOpenClawTask(env, task, {
      status: "disconnected",
      error: "OpenClaw async submit did not return a task_id",
      latencyMs: 0
    }) || task;
    return {
      ok: false,
      error: "OpenClaw async submit did not return a task_id",
      task
    };
  } catch (err) {
    logOpenClawAsync("submit-failed", {
      localTaskId: task.id,
      conversationId,
      error: err?.message || String(err)
    });
    task = await updateOpenClawTask(env, task, {
      status: "failed",
      error: err?.message || String(err),
      latencyMs: 0
    }) || task;
    return {
      ok: false,
      error: err?.message || String(err),
      task
    };
  }
}

async function submitOpenClawBridgeTask({
  env,
  conversationId,
  openClawTask,
  userContent,
  attachments = []
}) {
  if (!openClawTask?.id) {
    return {
      ok: false,
      error: "OpenClaw local task was not created",
      task: null
    };
  }

  const bridge = openclawBridgeClient(env);
  const result = await bridge.createTask({
    conversationId,
    message: userContent,
    sessionKey: "default",
    sessionId: "",
    agentId: "",
    attachments,
    idempotencyKey: openClawTask.id
  });

  if (!result.ok) {
    const error = result.error || "OpenClaw Bridge unavailable";
    const failedTask = await markOpenClawBridgeTaskFailed(env, openClawTask, error);
    return {
      ok: false,
      error,
      task: failedTask
    };
  }

  const bridgeTask = result.task || {};
  if (!bridgeTask.taskId) {
    const error = "OpenClaw Bridge unavailable: task id missing";
    const failedTask = await markOpenClawBridgeTaskFailed(env, openClawTask, error);
    return {
      ok: false,
      error,
      task: failedTask
    };
  }

  const task = await updateOpenClawBridgeTaskStart(env, openClawTask, bridgeTask) || openClawTask;
  return {
    ok: true,
    bridge: true,
    submitted: true,
    task
  };
}

function streamChatWithToolStatus({
  env,
  ctx,
  conversationId,
  model,
  provider,
  providerCatalog,
  autoFallbackEnabled,
  fallbackModel,
  customModelConfig,
  fallbackCustomModelConfig,
  modelMessages,
  historyMessages,
  userContent,
  attachments = [],
  requestedToolCall,
  ragSources,
  debugTools,
  openClawTask = null
}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const bufferState = { value: "" };
      const replyState = { value: "" };
      let toolSources = [];

      const enqueueText = text => controller.enqueue(encoder.encode(text));
      const enqueueOpenClawTask = task => {
        if (task) {
          enqueueText(encodeSseEvent("openclaw_task", {
            id: task.id,
            conversationId: task.conversationId,
            provider: task.provider,
            model: task.model,
            upstreamModelName: task.upstreamModelName || "",
            promptPreview: task.promptPreview || "",
            status: task.status || "running",
            startedAt: task.startedAt,
            updatedAt: task.updatedAt,
            completedAt: task.completedAt || null,
            error: task.error || "",
            latencyMs: task.latencyMs ?? null,
            remoteTaskId: task.remoteTaskId || "",
            remoteStatus: task.remoteStatus || "",
            remoteProgress: task.remoteProgress ?? null,
            remoteMessage: task.remoteMessage || "",
            bridgeTaskId: task.bridgeTaskId || "",
            bridgeRunId: task.bridgeRunId || "",
            bridgeSessionKey: task.bridgeSessionKey || "",
            bridgeSessionId: task.bridgeSessionId || "",
            bridgeAgentId: task.bridgeAgentId || "",
            bridgeModeEnabled: Boolean(task.bridgeModeEnabled),
            canReconnect: Boolean(task.canReconnect),
            canQueryRemoteStatus: Boolean(task.canQueryRemoteStatus),
            abortStopsRemote: Boolean(task.abortStopsRemote)
          }));
        }
      };
      const enqueueToolStatus = (name, status) => {
        enqueueText(encodeSseEvent("tool_status", {
          name,
          status,
          message: getToolStatusMessage(name, status)
        }));
      };
      const enqueueToolError = toolError => {
        if (toolError) {
          enqueueText(encodeSseEvent("tool_error", toolError));
        }
      };
      const enqueueToolDebug = debug => {
        if (debugTools && debug) {
          enqueueText(encodeSseEvent("tool_debug", {
            name: debug.name,
            trigger: debug.trigger,
            duration_ms: debug.duration_ms,
            status: debug.status,
            code: debug.code || null
          }));
        }
      };

      try {
        const finalMessages = [...modelMessages];
        let executedToolCall = null;
        let fallbackCount = 0;
        let activeCallStartedAt = 0;
        let activeResult = null;
        let activeOpenClawTask = openClawTask;

        enqueueOpenClawTask(activeOpenClawTask);

        if (requestedToolCall?.name) {
          enqueueToolStatus(requestedToolCall.name, "running");
          executedToolCall = await runRequestedTool(requestedToolCall, env);
          enqueueToolStatus(requestedToolCall.name, executedToolCall.error ? "error" : "done");
          enqueueToolError(executedToolCall.toolError);
          enqueueToolDebug(executedToolCall.debug);
          toolSources = buildToolSources(executedToolCall);
        }

        appendToolContext(finalMessages, executedToolCall);
        finalMessages.push(...historyMessages);
        finalMessages.push({
          role: "user",
          content: attachments.length
            ? buildMultimodalUserContent(userContent, attachments)
            : userContent
        });
        console.log("[phase10.3] provider image count", countProviderImages(finalMessages));

        let result;

        try {
          activeCallStartedAt = Date.now();
          result = await callSelectedModel({
            env,
            model: model || DEFAULT_TEXT_MODEL,
            provider,
            messages: finalMessages,
            stream: true,
            providerCatalog
          });
          activeResult = result;
        } catch (err) {
          if (!autoFallbackEnabled || !fallbackModel || fallbackModel === model) {
            throw err;
          }

          fallbackCount += 1;
          const normalizedError = normalizeProviderError(err, {
            provider,
            model: model || DEFAULT_TEXT_MODEL
          });

          enqueueText(encodeSseEvent("fallback", {
            from: model || DEFAULT_TEXT_MODEL,
            to: fallbackModel,
            reason: normalizedError.code || String(normalizedError.status || "provider_error"),
            message: normalizedError.message
          }));

          activeCallStartedAt = Date.now();
          result = await callSelectedModel({
            env,
            model: fallbackModel,
            provider: "",
            messages: finalMessages,
            stream: true,
            providerCatalog
          });
          activeResult = result;
        }

        const reader = result.response.getReader();
        let remoteTaskIdScanBytes = 0;
        let remoteTaskIdScanText = "";

        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          controller.enqueue(value);
          const chunkText = decoder.decode(value, { stream: true });
          if (activeOpenClawTask && !activeOpenClawTask.remoteTaskId && remoteTaskIdScanBytes < 65536) {
            remoteTaskIdScanBytes += chunkText.length;
            remoteTaskIdScanText = (remoteTaskIdScanText + chunkText).slice(-65536);
            const remoteTask = extractOpenClawRemoteTaskFromText(remoteTaskIdScanText);
            if (remoteTask) {
              activeOpenClawTask = await updateOpenClawTaskRemoteStart(env, activeOpenClawTask, remoteTask);
              enqueueOpenClawTask(activeOpenClawTask);
            }
          }
          bufferState.value += chunkText;
          appendReplyFromSseBuffer(bufferState, replyState);
        }

        if (bufferState.value.trim()) {
          appendReplyFromSseBuffer({ value: bufferState.value + "\n\n" }, replyState);
        }

        const latencyMs = activeCallStartedAt ? Date.now() - activeCallStartedAt : 0;

        let assistantMessage = null;

        if (env.DB && replyState.value) {
          assistantMessage = await saveMessage(env.DB, conversationId, "assistant", replyState.value);
          await maybeUpdateConversationSummary(env, conversationId);
        }

        if (activeOpenClawTask) {
          activeOpenClawTask = await updateOpenClawTask(env, activeOpenClawTask, {
            status: "completed",
            latencyMs,
            assistantMessageId: assistantMessage?.id || ""
          }) || {
            ...activeOpenClawTask,
            status: "completed",
            latencyMs,
            assistantMessageId: assistantMessage?.id || ""
          };
          activeOpenClawTask = await runOpenClawTerminalRemoteSync(
            env,
            ctx,
            activeOpenClawTask,
            "completed"
          ) || activeOpenClawTask;
          enqueueOpenClawTask(activeOpenClawTask);
        }

        if (ragSources.length) {
          enqueueText(encodeSseEvent("sources", { sources: ragSources }));
        }

        if (toolSources.length) {
          enqueueText(encodeSseEvent("tool_sources", { sources: toolSources }));
        }

        enqueueText("data: " + JSON.stringify({ conversationId }) + "\n\n");
        enqueueText(encodeSseEvent("done", {
          provider: activeResult?.provider || "",
          model: activeResult?.model || activeResult?.modelName || "",
          latencyMs,
          fallbackCount
        }));
        enqueueText("data: [DONE]\n\n");
      } catch (err) {
        console.log("AI request failed", err);
        const providerError = normalizeProviderError(err, {
          provider,
          model: model || DEFAULT_TEXT_MODEL
        });

        if (openClawTask) {
          let failedTask = await updateOpenClawTask(env, openClawTask, {
            status: "failed",
            error: providerError.message || String(err),
            latencyMs: 0
          }) || {
            ...openClawTask,
            status: "failed",
            error: providerError.message || String(err),
            latencyMs: 0
          };
          failedTask = await runOpenClawTerminalRemoteSync(
            env,
            ctx,
            failedTask,
            "failed"
          ) || failedTask;
          enqueueOpenClawTask(failedTask);
        }

        enqueueText(encodeSseEvent("provider_error", providerError));
        enqueueText("data: " + JSON.stringify({
          response:
            "AI \u8bf7\u6c42\u5931\u8d25\uff1a\n\n" +
            "provider: " + providerError.provider + "\n" +
            "model: " + providerError.model + "\n" +
            "status: " + (providerError.status || "") + "\n" +
            "code: " + providerError.code + "\n" +
            "message: " + providerError.message
        }) + "\n\n");
        enqueueText("data: " + JSON.stringify({ conversationId }) + "\n\n");
        enqueueText(encodeSseEvent("done", {
          provider: providerError.provider,
          model: providerError.model,
          latencyMs: 0,
          fallbackCount: 0
        }));
        enqueueText("data: [DONE]\n\n");
      } finally {
        controller.close();
      }
    }
  });
}

function streamWithHistorySave(result, env, conversationId, sources = [], toolSources = []) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reply = "";

  return result.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const lines = event
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart());

        for (const line of lines) {
          reply += readStreamText(line);
        }
      }
    },
    async flush(controller) {
      if (buffer.trim()) {
        const lines = buffer
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart());

        for (const line of lines) {
          reply += readStreamText(line);
        }
      }

      if (env.DB && reply) {
        await saveMessage(env.DB, conversationId, "assistant", reply);
        await maybeUpdateConversationSummary(env, conversationId);
      }

      if (sources.length) {
        controller.enqueue(encoder.encode(
          "event: sources\n" +
          "data: " + JSON.stringify({ sources }) + "\n\n"
        ));
      }

      if (toolSources.length) {
        controller.enqueue(encoder.encode(
          "event: tool_sources\n" +
          "data: " + JSON.stringify({ sources: toolSources }) + "\n\n"
        ));
      }

      controller.enqueue(encoder.encode(
        "data: " + JSON.stringify({ conversationId }) + "\n\n"
      ));
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    }
  }));
}

async function prepareConversation(env, conversationId, userContent) {
  if (!env.DB) {
    return {
      id: conversationId || crypto.randomUUID()
    };
  }

  return ensureConversation(
    env.DB,
    conversationId,
    titleFromMessage(userContent)
  );
}

export async function handleChat(request, env, ctx) {
  const url = new URL(request.url);
  const openClawTasksResponse = await handleOpenClawTasksRequest(request, env, url, ctx);

  if (openClawTasksResponse) {
    return openClawTasksResponse;
  }

  if (url.pathname === "/api/browser/inspect") {
    return browserJsonResponse(await inspectBrowserToolEndpoint(env));
  }

  if (url.pathname === "/api/browser") {
    return handleBrowserRequest(request, env);
  }

  const {
    messages = [],
    model,
    provider = "",
    providers = [],
    autoFallbackEnabled = false,
    fallbackModel = "",
    customModelConfig = null,
    fallbackCustomModelConfig = null,
    image,
    attachments,
    file,
    fileIds = [],
    conversationId,
    toolCall,
    debugTools = false
  } = await request.json();
  let imageAttachments = [];
  let allImageAttachments = [];

  try {
    imageAttachments = normalizeImageAttachments(attachments);
    allImageAttachments = [
      ...(image ? [imageDataUrlToAttachment(image, 0)] : []),
      ...imageAttachments
    ].slice(0, MAX_IMAGE_ATTACHMENTS);
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message || "Invalid attachments"
    }), {
      status: 400,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  }
  console.log("[phase10.3] backend image count", allImageAttachments.length);

  const userContent = getUserMessage(messages) ||
    (allImageAttachments.length ? "\u8bf7\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\u3002" : "\u8bf7\u7ee7\u7eed\u3002");
  const providerCatalog = await buildModelProviderCatalog(
    env,
    Array.isArray(providers) ? providers : [],
    customModelConfig,
    fallbackCustomModelConfig
  );

  const conversation = await prepareConversation(env, conversationId, userContent);

  if (image && imageAttachments.length === 0) {
    try {
      console.log("received image");

      if (env.DB) {
        await saveMessage(env.DB, conversation.id, "user", userContent);
      }

      const base64 = image.split(",")[1];

      if (!base64) {
        throw new Error("Image DataURL format is invalid");
      }

      const imageBytes = Array.from(
        Uint8Array.from(
          atob(base64),
          c => c.charCodeAt(0)
        )
      );

      const result = await callModel({
        env,
        model: "@cf/meta/llama-3.2-11b-vision-instruct",
        prompt: "\u8bf7\u7528\u4e2d\u6587\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\uff0c\u8bf4\u660e\u56fe\u7247\u4e2d\u7684\u4e3b\u8981\u5bf9\u8c61\u3001\u573a\u666f\u548c\u53ef\u80fd\u7528\u9014\u3002",
        image: imageBytes,
        max_tokens: 256
      });
      const reply = result.response.response || JSON.stringify(result.response);

      if (env.DB) {
        await saveMessage(env.DB, conversation.id, "assistant", reply);
        await maybeUpdateConversationSummary(env, conversation.id);
      }

      return new Response(
        "data: " + JSON.stringify({
          response: reply
        }) + "\n\n" +
        "data: " + JSON.stringify({
          conversationId: conversation.id
        }) + "\n\n" +
        "data: [DONE]\n\n",
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "X-Conversation-Id": conversation.id,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    } catch (err) {
      console.log("image recognition failed", err);

      return new Response(
        "data: " + JSON.stringify({
          response:
            "\u56fe\u7247\u8bc6\u522b\u5931\u8d25\uff1a\n\n" +
            "name: " + (err.name || "") + "\n" +
            "message: " + (err.message || String(err))
        }) + "\n\n",
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "X-Conversation-Id": conversation.id,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    }
  }

  const savedUserMessage = env.DB
    ? await saveMessage(env.DB, conversation.id, "user", userContent)
    : null;

  const historyMessages = env.DB
    ? await buildConversationContext(env, conversation.id, {
      limit: 14,
      excludeMessageId: savedUserMessage?.id
    })
    : messages.filter(message => message.role !== "system");

  const modelMessages = [
    defaultSystemMessage
  ];

  const ragFiles = [];
  let ragSources = [];
  const isOpenClawRequest = isOpenClawRequestTarget(providerCatalog, provider, model || DEFAULT_TEXT_MODEL);
  const openClawTarget = isOpenClawRequest
    ? resolveOpenClawProviderModel(providerCatalog, provider, model || DEFAULT_TEXT_MODEL)
    : null;
  const openClawTask = isOpenClawRequest
    ? await createOpenClawTask(env, {
      conversationId: conversation.id,
      provider: openClawTarget?.provider?.id || provider,
      model: openClawTarget?.model?.id || model || DEFAULT_TEXT_MODEL,
      upstreamModelName: openClawTarget?.model?.modelName || openClawTarget?.model?.upstreamModelName || "",
      prompt: userContent
    })
    : null;
  const autoFetchToolCall = isOpenClawRequest ? null : getAutoFetchToolCall(userContent);
  const autoSearchToolCall = isOpenClawRequest || autoFetchToolCall ? null : getAutoSearchToolCall(userContent);
  const requestedToolCall = toolCall?.name
    ? withToolTrigger(toolCall, "explicit")
    : (autoFetchToolCall
      ? withToolTrigger(autoFetchToolCall, "auto_url")
      : withToolTrigger(autoSearchToolCall, "auto_search"));

  if (file && file.text) {
    ragFiles.push(file);
  }

  if (Array.isArray(fileIds) && fileIds.length) {
    const fileChunks = await getRelevantFileChunksByIds(env, fileIds, userContent, {
      perFileLimit: 5,
      totalLimit: 14
    });

    console.log("[file-rag]", "selected files:", fileIds.length, "retrieved chunks:", fileChunks.length);
    ragSources = buildFileSources(fileChunks);

    if (fileChunks.length) {
      ragFiles.push({
        name: "\u5df2\u9009\u62e9\u7684\u6587\u4ef6 chunks",
        type: "file-chunks",
        chunks: fileChunks
      });
    }
  }

  if (ragFiles.length) {
    const filePrompt =
      "\u7528\u6237\u9009\u62e9\u4e86\u6587\u4ef6\u4e0a\u4e0b\u6587\u3002\u4e0b\u9762\u662f\u4ece\u6587\u4ef6\u4e2d\u63d0\u53d6\u51fa\u7684\u76f8\u5173\u7247\u6bb5\uff0c\u8bf7\u4f18\u5148\u4f9d\u636e\u8fd9\u4e9b\u7247\u6bb5\u56de\u7b54\u7528\u6237\u95ee\u9898\uff1b\u5982\u679c\u7247\u6bb5\u4fe1\u606f\u4e0d\u8db3\uff0c\u8bf7\u660e\u786e\u8bf4\u660e\u3002\n\n" +
      ragFiles.map((item, index) => {
        if (Array.isArray(item.chunks)) {
          return item.chunks.map(chunk => {
            return [
              "[File: " + chunk.filename + "]",
              "Chunk " + chunk.chunkIndex + (chunk.fallback ? " (fallback)" : "") + ":",
              chunk.content
            ].join("\n");
          }).join("\n\n");
        }

        return [
          "\u3010\u6587\u4ef6 " + (index + 1) + "\u3011",
          "\u6587\u4ef6\u540d\uff1a" + item.name,
          "\u6587\u4ef6\u7c7b\u578b\uff1a" + (item.type || "unknown"),
          "\u8d44\u6599\u5185\u5bb9\uff1a",
          (item.text || "").slice(0, 12000)
        ].join("\n");
      }).join("\n\n");

    modelMessages.push({
      role: "user",
      content: filePrompt
    });
  }

  if (isOpenClawRequest) {
    logOpenClawAsync("mode-check", {
      enabled: isOpenClawAsyncModeEnabled(env),
      bridgeEnabled: isOpenClawBridgeModeEnabled(env),
      provider,
      model: model || DEFAULT_TEXT_MODEL,
      localTaskId: openClawTask?.id || "",
      conversationId: conversation.id
    });
  }

  if (isOpenClawRequest && isOpenClawBridgeModeEnabled(env)) {
    const bridgeResult = await submitOpenClawBridgeTask({
      env,
      conversationId: conversation.id,
      openClawTask,
      userContent,
      attachments: allImageAttachments
    });
    return new Response(JSON.stringify({
      ok: Boolean(bridgeResult.ok),
      async: true,
      bridge: true,
      conversationId: conversation.id,
      task: bridgeResult.task,
      taskId: bridgeResult.task?.id || "",
      remoteTaskId: bridgeResult.task?.remoteTaskId || bridgeResult.task?.remote_task_id || "",
      bridgeTaskId: bridgeResult.task?.bridgeTaskId || bridgeResult.task?.bridge_task_id || "",
      submitted: Boolean(bridgeResult.submitted),
      completed: false,
      error: bridgeResult.error || ""
    }), {
      status: bridgeResult.ok ? 202 : 502,
      headers: {
        ...corsHeaders(),
        "X-Conversation-Id": conversation.id,
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  }

  if (isOpenClawRequest && isOpenClawAsyncModeEnabled(env)) {
    logOpenClawAsync("branch-entered", {
      provider,
      model: model || DEFAULT_TEXT_MODEL,
      localTaskId: openClawTask?.id || "",
      conversationId: conversation.id,
      responseContentType: "application/json; charset=utf-8"
    });
    const finalMessages = [...modelMessages];
    appendToolContext(finalMessages, null);
    finalMessages.push(...historyMessages);
    finalMessages.push({
      role: "user",
      content: allImageAttachments.length
        ? buildMultimodalUserContent(userContent, allImageAttachments)
        : userContent
    });
    const asyncResult = await submitOpenClawAsyncTask({
      env,
      ctx,
      conversationId: conversation.id,
      openClawTask,
      model,
      provider,
      providerCatalog,
      finalMessages
    });
    return new Response(JSON.stringify({
      ok: Boolean(asyncResult.ok),
      async: true,
      conversationId: conversation.id,
      task: asyncResult.task,
      taskId: asyncResult.task?.id || "",
      remoteTaskId: asyncResult.task?.remoteTaskId || asyncResult.task?.remote_task_id || "",
      submitted: Boolean(asyncResult.submitted),
      completed: Boolean(asyncResult.completed),
      error: asyncResult.error || ""
    }), {
      status: asyncResult.ok ? 202 : 502,
      headers: {
        ...corsHeaders(),
        "X-Conversation-Id": conversation.id,
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  }

  return new Response(streamChatWithToolStatus({
    env,
    ctx,
    conversationId: conversation.id,
    model,
    provider,
    providerCatalog,
    autoFallbackEnabled: Boolean(autoFallbackEnabled),
    fallbackModel,
    customModelConfig,
    fallbackCustomModelConfig,
    modelMessages,
    historyMessages,
    userContent,
    attachments: allImageAttachments,
    requestedToolCall,
    ragSources,
    debugTools: Boolean(debugTools),
    openClawTask
  }), {
    headers: {
      ...corsHeaders(),
      "X-Conversation-Id": conversation.id,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
