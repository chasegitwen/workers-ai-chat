/**
 * callback.mjs — Bridge Progress Callback Client
 *
 * Sends task lifecycle events to a web-ai-assistant callback endpoint
 * with HMAC SHA256 signing, a durable SQLite outbox and bounded retries.
 *
 * Pure module: no side-effects on import. Call `createCallbackClient(config)`
 * to get an emitter instance.
 */

import crypto from "node:crypto";

/* ── constants ── */

const SCHEMA_VERSION = "bridge_callback_v1";
export const ORACLE_BRIDGE_ID = "oracle-phoenix-a1-openclaw-bridge";
const MAX_CONTENT_TEXT = 4096;       // truncate content.text to prevent oversized payloads
const MAX_TOOL_ARGS_SUMMARY = 1024;
const HTTP_TIMEOUT_MS = 10_000;
const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 60_000;
const LEASE_MARGIN_MS = 20_000;     // sending lease outlives the HTTP timeout
const MIN_WAKEUP_MS = 25;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/* ── helpers ── */

function nowIso() {
  return new Date().toISOString();
}

function truncate(text, maxLen) {
  const str = typeof text === "string" ? text : String(text ?? "");
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable" });
  }
}

/* ── payload builder ── */

/**
 * Build a callback payload object.
 *
 * @param {object} opts
 * @param {string} opts.eventType   — one of bridge.started, bridge.activity, etc.
 * @param {string} opts.taskId
 * @param {string} [opts.conversationId]
 * @param {string} [opts.assistantMessageId]
 * @param {number} opts.sequence    — monotonically increasing per task
 * @param {string} [opts.agent]
 * @param {string} [opts.model]
 * @param {object} [opts.content]   — event-specific content
 * @param {object} [opts.metadata]  — additional metadata
 * @param {string} [opts.bridgeVersion]
 * @returns {object} payload
 */
export function buildPayload(opts) {
  return {
    schema_version: SCHEMA_VERSION,
    event_id: `evt_${crypto.randomUUID()}`,
    task_id: opts.taskId,
    conversation_id: opts.conversationId ?? null,
    assistant_message_id: opts.assistantMessageId ?? null,
    event_type: opts.eventType,
    sequence: opts.sequence,
    created_at: nowIso(),
    agent: opts.agent ?? null,
    model: opts.model ?? null,
    execution_mode: "bridge",
    content: opts.content ?? {},
    metadata: {
      source: "openclaw",
      bridge_version: opts.bridgeVersion ?? "milestone_2_3",
      ...(opts.metadata ?? {}),
    },
  };
}

/**
 * Create content for a bridge.started event.
 */
export function startedContent(message, agentId) {
  return {
    text: truncate(message, MAX_CONTENT_TEXT),
    activity_type: "started",
    agent_id: agentId,
  };
}

/**
 * Create content for a bridge.activity event.
 */
export function activityContent(text, activityType = "analysis") {
  return {
    text: truncate(text, MAX_CONTENT_TEXT),
    activity_type: activityType,
  };
}

/**
 * Create content for a bridge.tool_call event.
 */
export function toolCallContent(toolName, argsSummary) {
  return {
    text: truncate(`Tool: ${toolName}`, MAX_CONTENT_TEXT),
    activity_type: "tool_call",
    tool_name: toolName,
    args_summary: truncate(safeStringify(argsSummary), MAX_TOOL_ARGS_SUMMARY),
  };
}

/**
 * Create content for a bridge.tool_result event.
 */
export function toolResultContent(toolName, resultSummary) {
  return {
    text: truncate(`Tool result: ${toolName}`, MAX_CONTENT_TEXT),
    activity_type: "tool_result",
    tool_name: toolName,
    result_summary: truncate(safeStringify(resultSummary), MAX_TOOL_ARGS_SUMMARY),
  };
}

/**
 * Create content for a bridge.final event.
 */
export function finalContent(finalAnswer, fullText) {
  const answer = finalAnswer || fullText || "";
  return {
    text: truncate(answer, MAX_CONTENT_TEXT),
    final_answer: truncate(answer, MAX_CONTENT_TEXT),
    result_finality: "final",
  };
}

/**
 * Create content for a bridge.error event.
 */
export function errorContent(errorMessage) {
  return {
    text: truncate(errorMessage, MAX_CONTENT_TEXT),
    error: truncate(errorMessage, MAX_CONTENT_TEXT),
  };
}

/* ── HMAC signing ── */

/**
 * Compute HMAC SHA256 signature.
 *
 * @param {string} secret
 * @param {string} timestamp — ISO timestamp
 * @param {string} rawBody — exact JSON string being sent
 * @returns {string} — `sha256=<hex>`
 */
export function computeSignature(secret, timestamp, rawBody) {
  const data = `${timestamp}.${rawBody}`;
  const hmac = crypto.createHmac("sha256", secret).update(data, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

/**
 * Build the HTTP headers for a callback request.
 */
export function buildHeaders(bridgeId, timestamp, signature, eventId) {
  return {
    "Content-Type": "application/json",
    "X-OpenClaw-Bridge-Id": bridgeId,
    "X-OpenClaw-Timestamp": timestamp,
    "X-OpenClaw-Signature": signature,
    "X-OpenClaw-Event-Id": eventId,
  };
}

/* ── callback client ── */

/**
 * Create the durable callback dispatcher.
 *
 * Delivery is at-least-once: events live in the SQLite outbox and are retried
 * with the same event_id and payload until the receiver acknowledges them or
 * the per-cycle dispatch budget is exhausted. The receiver must deduplicate
 * by event_id. Each network attempt is signed with a fresh timestamp.
 *
 * @param {object} config — resolved config object
 * @param {boolean} config.enabled
 * @param {string} [config.url]
 * @param {string} [config.bridgeId]
 * @param {string} [config.secret] — raw secret string
 * @param {number[]} [config.backoffMs] — retry backoff schedule
 * @param {number} [config.maxAttempts] — dispatch attempts per cycle (capped at 5)
 * @param {number} [config.httpTimeoutMs]
 * @param {number} [config.leaseMs] — sending lease; always longer than the HTTP timeout
 * @param {number} [config.deliveredRetentionMs] — retention for delivered/superseded rows
 * @param {object} [config.store] — TaskStore (or attach later with attachStore)
 * @param {object} [config.logger] — { warn, info, error }
 * @param {Function} [config.fetchImpl] — injectable fetch for testing
 */
export function createCallbackClient(config) {
  const enabled = config.enabled === true;
  const url = String(config.url ?? "").trim();
  const bridgeId = config.bridgeId ?? "openclaw-bridge";
  const secret = config.secret ?? "";
  const backoffMs = (Array.isArray(config.backoffMs) && config.backoffMs.length > 0
    ? config.backoffMs
    : [1000, 3000, 10000, 30000]).map(value => Math.max(0, Math.min(MAX_BACKOFF_MS, Number(value) || 0)));
  const requestedAttempts = Math.floor(Number(config.maxAttempts));
  const maxAttempts = Number.isFinite(requestedAttempts) && requestedAttempts > 0
    ? Math.min(MAX_DELIVERY_ATTEMPTS, requestedAttempts)
    : MAX_DELIVERY_ATTEMPTS;
  const httpTimeoutMs = Math.max(100, Math.min(60_000, Number(config.httpTimeoutMs) || HTTP_TIMEOUT_MS));
  const leaseMs = Math.max(httpTimeoutMs + LEASE_MARGIN_MS, Number(config.leaseMs) || 0);
  const retentionMs = Math.max(60_000, Number(config.deliveredRetentionMs) || DELIVERED_RETENTION_MS);
  const logger = config.logger ?? console;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  const disabledReason = !enabled ? "disabled"
    : !url ? "url_missing"
    : !secret ? "secret_missing"
    : !fetchImpl ? "fetch_unavailable"
    : null;
  const deliveryEnabled = disabledReason === null;
  if (enabled && !deliveryEnabled) {
    logger.warn?.(`[callback] enabled but ${disabledReason}; events stay pending and no request is sent`);
  }

  let store = config.store ?? null;
  let stopped = false;
  let wakeupTimer = null;
  let running = null;
  let rerun = false;
  let inflight = null;
  let lastPruneAt = 0;
  const stats = {
    dispatched: 0,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
  };

  function warn(message, error) {
    const detail = error === undefined ? "" : `: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn?.(`[callback] ${message}${detail}`);
  }

  function attachStore(value) {
    store = value;
    notify();
  }

  function clearWakeup() {
    if (wakeupTimer) clearTimeout(wakeupTimer);
    wakeupTimer = null;
  }

  function scheduleWakeup() {
    clearWakeup();
    if (stopped || !store || !deliveryEnabled) return;
    let next;
    try {
      next = Date.parse(store.nextCallbackWakeup?.() || "");
    } catch (error) {
      warn("could not schedule outbox wakeup", error);
      return;
    }
    if (!Number.isFinite(next)) return;
    const delay = Math.max(MIN_WAKEUP_MS, Math.min(MAX_BACKOFF_MS, next - Date.now()));
    wakeupTimer = setTimeout(notify, delay);
    wakeupTimer.unref?.();
  }

  function notify() {
    if (stopped) return;
    clearWakeup();
    if (running) {
      rerun = true;
      return;
    }
    running = processQueue()
      .catch((error) => warn("outbox processor error", error))
      .finally(() => {
        running = null;
        if (rerun && !stopped) {
          rerun = false;
          notify();
        } else {
          scheduleWakeup();
        }
      });
  }

  function maybePrune() {
    const now = Date.now();
    if (!store?.pruneCallbacks || now - lastPruneAt < PRUNE_INTERVAL_MS) return;
    lastPruneAt = now;
    try {
      store.pruneCallbacks(new Date(now - retentionMs).toISOString());
    } catch (error) {
      warn("delivered callback pruning failed", error);
    }
  }

  async function processQueue() {
    maybePrune();
    // Disabled or incomplete configuration never claims rows: no request is
    // sent and no dispatch attempt is consumed.
    if (!deliveryEnabled) return;
    while (!stopped && store) {
      rerun = false;
      const item = store.claimNextCallback({ maxAttempts, leaseMs });
      if (!item) break;
      await dispatch(item);
    }
  }

  async function dispatch(item) {
    const attempt = item.dispatch_attempts;
    const rawBody = item.payload_json;
    try {
      JSON.parse(rawBody);
    } catch {
      store.markCallbackDeadLetter(item.event_id, attempt, "persisted callback payload is invalid JSON");
      stats.deadLettered += 1;
      return;
    }
    const timestamp = nowIso();
    const signature = computeSignature(secret, timestamp, rawBody);
    const headers = buildHeaders(bridgeId, timestamp, signature, item.event_id);
    const controller = new AbortController();
    inflight = controller;
    const timer = setTimeout(
      () => controller.abort(new Error(`callback HTTP timeout after ${httpTimeoutMs}ms`)),
      httpTimeoutMs,
    );
    timer.unref?.();
    stats.dispatched += 1;
    let outcome;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
      });
      try { await response.body?.cancel?.(); } catch {}
      outcome = response.status >= 200 && response.status < 300
        ? { ok: true, httpStatus: response.status }
        : { ok: false, httpStatus: response.status, error: `HTTP ${response.status}` };
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      outcome = { ok: false, httpStatus: null, error: reason instanceof Error ? reason.message : String(reason) };
    } finally {
      clearTimeout(timer);
      inflight = null;
    }

    if (outcome.ok) {
      store.markCallbackDelivered(item.event_id, attempt, outcome.httpStatus);
      stats.delivered += 1;
      return;
    }
    if (attempt >= maxAttempts) {
      store.markCallbackDeadLetter(item.event_id, attempt, outcome.error, outcome.httpStatus);
      stats.deadLettered += 1;
      warn(`event ${item.event_id} entered dead_letter after ${attempt} dispatch attempts: ${outcome.error}`);
      return;
    }
    const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)];
    store.scheduleCallbackRetry(
      item.event_id,
      attempt,
      new Date(Date.now() + delay).toISOString(),
      outcome.error,
      outcome.httpStatus,
    );
    stats.retried += 1;
  }

  /**
   * Run the dispatcher until it is idle (mostly for tests).
   */
  async function flush(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    notify();
    while (running && Date.now() < deadline) {
      await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 20))]);
    }
  }

  /**
   * Stop dispatching. The current request may finish within graceMs; after
   * that it is aborted and recorded as a failed attempt. Resolves only after
   * the dispatcher has written its last outbox update, so the caller may
   * close SQLite afterwards.
   */
  async function stop({ graceMs = 3_000 } = {}) {
    stopped = true;
    clearWakeup();
    const current = running;
    if (!current) return;
    let graceTimer;
    const graceExpired = new Promise((resolve) => {
      graceTimer = setTimeout(resolve, Math.max(0, Number(graceMs) || 0));
    });
    await Promise.race([current, graceExpired]);
    clearTimeout(graceTimer);
    inflight?.abort(new Error("callback dispatcher stopped"));
    await current;
  }

  function getStats() {
    const count = (status) => {
      try { return store?.countCallbackStatus?.(status) ?? 0; } catch { return 0; }
    };
    return {
      ...stats,
      pending: count("pending"),
      sending: count("sending"),
      retrying: count("retrying"),
      delivered: count("delivered"),
      superseded: count("superseded"),
      deadLetter: count("dead_letter"),
      enabled,
      deliveryEnabled,
      disabledReason,
      stopped,
      maxAttempts,
      url: url ? url.replace(/\/$/, "") : null,
      bridgeId,
    };
  }

  return { attachStore, notify, flush, stop, stats: getStats };
}

/* ── config loader ── */

/**
 * Load and resolve bridge_callback config from raw config object + env.
 *
 * @param {object} rawConfig — bridge_callback section from config file
 * @param {object} env — process.env
 * @returns {object} resolved config for createCallbackClient
 */
export function resolveCallbackConfig(rawConfig, env) {
  const cfg = rawConfig ?? {};
  const secretEnvKey = cfg.secret_env || "OPENCLAW_CALLBACK_SECRET";
  return {
    enabled: cfg.enabled === true,
    url: cfg.url ?? "",
    // This package is the Oracle Bridge; the Worker binds oracle-openclaw tasks
    // to exactly this identity.
    bridgeId: cfg.bridge_id ?? ORACLE_BRIDGE_ID,
    secret: env[secretEnvKey] ?? "",
    backoffMs: cfg.retry?.backoff_ms,
    maxAttempts: cfg.retry?.max_attempts,
    httpTimeoutMs: cfg.http_timeout_ms,
    deliveredRetentionMs: cfg.retention?.delivered_ms,
  };
}
