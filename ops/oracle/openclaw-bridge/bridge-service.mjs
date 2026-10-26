import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  BridgeTaskError,
  assertGatewayFrameWithinLimit,
  buildGatewayChatSendRequest,
  extractHistoryMessages,
  findRecoveredAssistantMessage,
  messageText,
  normalizeNativeAttachments,
  usableFinalText,
} from "./lib.mjs";
import {
  activityContent,
  buildPayload,
  errorContent,
  finalContent,
  startedContent,
} from "./callback.mjs";
import {
  applyCodexRunControlsToMessage,
  buildTurnSessionCreateParams,
  executionModelFromMessages,
  normalizeCodexRunControls,
  readAgentScopedGatewayCatalog,
  resolveCatalogSelection,
} from "./model-routing.mjs";
import { PendingRunEventBuffer } from "./gateway-adapter.mjs";
import { isUncertainSubmissionFailure } from "./submission-state.mjs";
import { openTaskDatabase, resolveCallbackOutboxPolicy, resolveCapacityLimits, TaskStore } from "./task-store.mjs";
import { BRIDGE_VERSION } from "./version.mjs";

const TERMINAL = new Set(["completed", "failed", "canceled", "indeterminate"]);
const PRE_SEND_PHASES = new Set(["prepared", "session_create_dispatched", "session_ready"]);
const OUTBOX_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function deadlineExpired(task, now = Date.now()) {
  const deadline = Date.parse(task?.recovery_deadline_at || "");
  return Number.isFinite(deadline) && deadline <= now;
}
function extractAgents(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.agents)) return result.agents;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}
function pickAgentId(agentsResult, requestedAgentId) {
  if (requestedAgentId) return requestedAgentId;
  const agents = extractAgents(agentsResult);
  return agentsResult?.defaultId || agentsResult?.defaultAgentId
    || agents.find((agent) => agent?.id === "main")?.id || agents[0]?.id || "main";
}
export function taskStatus(task) {
  return {
    task_id: task.task_id,
    run_id: task.run_id,
    status: task.status,
    submission_phase: task.submission_phase,
    cancel_requested: Boolean(task.cancel_requested),
    updated_at: task.updated_at,
    error: task.error,
    selection_mode: task.selection_mode || "classic",
    requested_base_model_id: task.requested_base_model_id || "",
    resolved_base_model_id: task.resolved_base_model_id || "",
    actual_model_id: task.actual_model_id || "",
  };
}

function resultRecord(task, recovered, messages, source, extra = {}) {
  const finalAnswer = recovered.text;
  const actualModelId = executionModelFromMessages(messages, task.resolved_base_model_id);
  return {
    finalAnswer,
    actualModelId,
    value: {
      final_answer: finalAnswer,
      result: finalAnswer,
      messages,
      events: [],
      metadata: {
        final_answer_source: source,
        selected_message_index: recovered.selectedMessageIndex ?? 0,
        message_count: messages.length,
        event_count: 0,
        requested_base_model_id: task.requested_base_model_id || "",
        resolved_base_model_id: task.resolved_base_model_id || "",
        actual_model_id: actualModelId,
        recovery_evidence: recovered.evidence || {},
      },
      source,
      runId: task.run_id,
      idempotencyKey: task.idempotency_key,
      sessionKey: task.session_key,
      sessionId: task.session_id,
      agentId: task.agent_id,
      match: recovered.match,
      classification: recovered.classification,
      message: recovered.message,
      text: finalAnswer,
      received_at: nowIso(),
      ...extra,
    },
  };
}

export class BridgeController {
  constructor({
    store,
    gateway,
    callbackClient = null,
    recoveryHistoryLimit = 80,
    maxSessionCreateAttempts = 2,
    callbackOutboxPolicy = {},
  }) {
    this.store = store;
    this.gateway = gateway;
    this.callbackClient = callbackClient;
    this.recoveryHistoryLimit = recoveryHistoryLimit;
    this.maxSessionCreateAttempts = Math.max(1, Math.min(2, Number(maxSessionCreateAttempts) || 2));
    this.partialByRunId = new Map();
    this.pendingEvents = new PendingRunEventBuffer();
    this.deferredTaskIds = new Set();
    this.terminalInFlight = new Set();
    this.cancellationInFlight = new Map();
    this.recoveryInFlight = false;
    this.recoveryTimer = null;
    this.lastRecoveryAt = null;
    this.lastRecoveryError = null;
    this.submissionRunner = null;
    this.stopped = false;
    this.backgroundWork = new Set();
    this.callbackOutboxPolicy = resolveCallbackOutboxPolicy(callbackOutboxPolicy);
    this.lastOutboxMaintenanceAt = 0;
    this.lastOutboxMaintenance = null;
  }

  /**
   * Bound callback_outbox growth. Runs on the recovery timer whether or not a
   * callback client is configured, because events are recorded either way.
   */
  maintainCallbackOutbox({ force = false, now = Date.now() } = {}) {
    if (this.stopped) return null;
    if (!force && now - this.lastOutboxMaintenanceAt < OUTBOX_MAINTENANCE_INTERVAL_MS) return null;
    this.lastOutboxMaintenanceAt = now;
    try {
      this.lastOutboxMaintenance = { at: new Date(now).toISOString(), ...this.store.maintainCallbackOutbox(this.callbackOutboxPolicy, now) };
    } catch (error) {
      this.lastOutboxMaintenance = { at: new Date(now).toISOString(), error: error instanceof Error ? error.message : String(error) };
    }
    return this.lastOutboxMaintenance;
  }

  /** Track asynchronous gateway/timer work so stop() can drain it before SQLite closes. */
  track(promise) {
    const tracked = Promise.resolve(promise).catch((error) => {
      this.lastRecoveryError = error instanceof Error ? error.message : String(error);
    }).finally(() => this.backgroundWork.delete(tracked));
    this.backgroundWork.add(tracked);
    return tracked;
  }

  get connected() { return this.gateway.connected !== false; }
  setSubmissionRunner(runner) { this.submissionRunner = runner; }
  request(method, params, options) { return this.gateway.request(method, params, options); }

  requeueCallback(eventId) {
    const changed = this.store.requeueCallback(eventId);
    if (changed) this.callbackClient?.notify?.();
    return changed;
  }

  callbackPayload(eventType, task, sequence, content, metadata = {}) {
    return buildPayload({
      eventType,
      taskId: task.task_id,
      conversationId: task.conversation_id,
      sequence,
      agent: task.agent_id,
      model: task.actual_model_id || task.resolved_base_model_id || null,
      content,
      metadata,
      bridgeVersion: BRIDGE_VERSION,
    });
  }

  notifyCallback(payload) {
    if (typeof this.callbackClient?.notify === "function") this.callbackClient.notify(payload);
    else this.callbackClient?.enqueue?.(payload);
  }

  emitCallback(eventType, task, content, metadata = {}) {
    if (!task) return false;
    const committed = this.store.enqueueCallback(
      task.task_id,
      (current, sequence) => this.callbackPayload(eventType, current, sequence, content, metadata),
    );
    if (!committed.transitioned) return false;
    this.notifyCallback(committed.payload);
    return true;
  }

  transitionWithCallback(taskId, transition, eventType, content, metadata = {}) {
    const committed = this.store.transitionWithCallback(
      taskId,
      transition,
      (task, sequence) => this.callbackPayload(eventType, task, sequence, content, metadata),
    );
    if (committed.transitioned) this.notifyCallback(committed.payload);
    return committed.transitioned;
  }

  async start(recoverySweepMs = 20_000) {
    this.maintainCallbackOutbox({ force: true });
    await this.gateway.start?.();
    if (!this.recoveryTimer && recoverySweepMs > 0) {
      this.recoveryTimer = setInterval(() => {
        this.maintainCallbackOutbox();
        void this.track(this.recoverySweep("timer"));
      }, recoverySweepMs);
      this.recoveryTimer.unref?.();
    }
    await this.recoverySweep("connect");
  }

  /**
   * Stop new Gateway/timer work, stop the Gateway, then wait for tracked work.
   * Resolves true only when every tracked operation has settled; false means
   * work may still touch SQLite and the caller must not close the database.
   */
  async stop({ drainMs = 10_000 } = {}) {
    this.stopped = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
    try {
      await this.gateway.stop?.();
    } catch (error) {
      this.lastRecoveryError = error instanceof Error ? error.message : String(error);
    }
    return this.drain(drainMs);
  }

  async drain(drainMs) {
    const deadline = Date.now() + Math.max(0, Number(drainMs) || 0);
    // Tracked work can start further tracked work, so drain until empty.
    while (this.backgroundWork.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      let drainTimer;
      await Promise.race([
        Promise.allSettled([...this.backgroundWork]),
        new Promise((resolve) => { drainTimer = setTimeout(resolve, remaining); }),
      ]);
      clearTimeout(drainTimer);
    }
    return true;
  }

  deferEvents(taskId) { this.deferredTaskIds.add(taskId); }
  async releaseEvents(taskId) {
    this.deferredTaskIds.delete(taskId);
    const task = this.store.get(taskId);
    if (!task?.run_id) return;
    for (const event of this.pendingEvents.take(task.run_id)) await this.handleEvent(event);
  }

  cancelBeforeChatDispatch(taskId, reason = "canceled before chat.send dispatch") {
    let task = this.store.get(taskId);
    if (!task?.cancel_requested || task.submission_phase !== "chat_send_dispatching") return task;
    this.transitionWithCallback(
      taskId,
      () => this.store.cancelBeforeChatDispatch(taskId, reason),
      "bridge.error",
      errorContent(reason),
      { reason: "canceled" },
    );
    return this.store.get(taskId);
  }

  assertChatSendDispatchAllowed(taskId) {
    const task = this.store.get(taskId);
    if (task && !TERMINAL.has(task.status) && !task.cancel_requested) return;
    if (task?.cancel_requested) this.cancelBeforeChatDispatch(taskId);
    const error = new Error("chat.send dispatch prevented by persisted cancellation");
    error.code = "chat_send_dispatch_prevented";
    error.requestSent = false;
    throw error;
  }

  async coordinateCancellation(taskId, reason = "cancel requested") {
    const existing = this.cancellationInFlight.get(taskId);
    if (existing) return await existing;
    const operation = this.#coordinateCancellation(taskId, reason).finally(() => {
      if (this.cancellationInFlight.get(taskId) === operation) this.cancellationInFlight.delete(taskId);
    });
    this.cancellationInFlight.set(taskId, operation);
    return await operation;
  }

  async #coordinateCancellation(taskId, reason) {
    let task = this.store.get(taskId);
    if (!task || TERMINAL.has(task.status) || !task.cancel_requested) return task;
    if (PRE_SEND_PHASES.has(task.submission_phase)) {
      this.transitionWithCallback(
        taskId,
        () => this.store.cancelBeforeSend(taskId, "canceled before chat.send"),
        "bridge.error",
        errorContent("canceled before chat.send"),
        { reason: "canceled" },
      );
      return this.store.get(taskId);
    }
    if (task.submission_phase === "chat_send_dispatching") {
      this.store.markRecovering(taskId, "cancel requested; waiting for chat.send dispatch proof");
      return this.store.get(taskId);
    }
    const runId = normalizeOptionalString(task.run_id);
    if (!runId) {
      this.store.markRecovering(taskId, "cancel requested; waiting for exact run identity");
      return this.store.get(taskId);
    }
    try {
      await this.request("chat.abort", {
        sessionKey: task.session_key,
        agentId: task.agent_id,
        runId,
      }, { timeoutMs: 10_000 });
      this.transitionWithCallback(
        taskId,
        () => this.store.cancel(taskId, reason),
        "bridge.error",
        errorContent(reason),
        { reason: "canceled" },
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.store.markRecovering(taskId, `chat.abort confirmation uncertain: ${text}`);
    }
    return this.store.get(taskId);
  }

  async recoverySweep(reason = "manual") {
    if (this.stopped || this.recoveryInFlight || !this.connected) return { skipped: true };
    this.recoveryInFlight = true;
    const stats = { reason, checked: 0, resumed: 0, recovered: 0, pending: 0, failed: 0 };
    try {
      for (const snapshot of this.store.listRecoverable(100)) {
        stats.checked += 1;
        let task = this.store.get(snapshot.task_id);
        if (!task || TERMINAL.has(task.status)) continue;
        try {
          if (task.cancel_requested) {
            const afterCancel = await this.coordinateCancellation(task.task_id);
            if (TERMINAL.has(afterCancel?.status)) continue;
            task = afterCancel;
          }

          if (this.submissionRunner && ["prepared", "session_create_dispatched", "session_ready"].includes(task.submission_phase)) {
            await this.submissionRunner(task.task_id, { recovery: true });
            stats.resumed += 1;
            task = this.store.get(task.task_id);
            if (!task || TERMINAL.has(task.status)) continue;
          }

          if (!task.session_key) {
            if (deadlineExpired(task)) {
              const detail = "submission confirmation deadline expired without a session identity";
              this.transitionWithCallback(
                task.task_id,
                () => this.store.markIndeterminate(task.task_id, detail),
                "bridge.error",
                errorContent(detail),
                { reason: "submission_indeterminate" },
              );
            } else stats.pending += 1;
            continue;
          }

          const history = await this.request("chat.history", {
            sessionKey: task.session_key,
            agentId: task.agent_id,
            limit: this.recoveryHistoryLimit,
          }, { timeoutMs: 15_000 });
          const recovered = findRecoveredAssistantMessage(history, task);
          if (!recovered.message) {
            if (deadlineExpired(task) && ["chat_send_dispatching", "chat_send_dispatched"].includes(task.submission_phase)) {
              const detail = "chat.send outcome remained unconfirmed through the bounded recovery window; session retained for manual reconciliation";
              this.transitionWithCallback(
                task.task_id,
                () => this.store.markIndeterminate(task.task_id, detail),
                "bridge.error",
                errorContent(detail),
                { reason: "chat_send_indeterminate" },
              );
            } else {
              this.store.touchRecoverable(task.task_id);
              stats.pending += 1;
            }
            continue;
          }
          const messages = extractHistoryMessages(history);
          const record = resultRecord(task, recovered, messages, "history_recovery", { recovery_reason: reason });
          if (this.transitionWithCallback(
            task.task_id,
            () => this.store.complete(task.task_id, record.value, record.finalAnswer, record.actualModelId),
            "bridge.final",
            finalContent(record.finalAnswer, record.finalAnswer),
            { final_answer_source: "history_recovery", recovery_reason: reason },
          )) {
            stats.recovered += 1;
          }
        } catch (error) {
          this.store.touchRecoverable(task.task_id);
          stats.failed += 1;
          this.lastRecoveryError = error instanceof Error ? error.message : String(error);
        }
      }
      this.lastRecoveryAt = nowIso();
      if (stats.failed === 0) this.lastRecoveryError = null;
      return stats;
    } finally {
      this.recoveryInFlight = false;
    }
  }

  async handleEvent(event) {
    if (this.stopped || event?.event !== "chat") return;
    const payload = event.payload || {};
    const runId = normalizeOptionalString(payload.runId);
    if (!runId) return;
    let task = this.store.getByRunId(runId);
    if (!task) {
      const bySession = this.store.getActiveBySessionKey(normalizeOptionalString(payload.sessionKey));
      if (bySession && bySession.idempotency_key === runId) {
        this.store.bindRun(bySession.task_id, runId, bySession.session_key, bySession.session_id);
        task = this.store.get(bySession.task_id);
      }
    }
    if (!task || this.deferredTaskIds.has(task.task_id)) {
      this.pendingEvents.push(runId, event);
      return;
    }
    const current = this.store.get(task.task_id);
    if (!current || TERMINAL.has(current.status)) return;
    if (current.cancel_requested && payload.state !== "aborted") {
      await this.coordinateCancellation(current.task_id);
      return;
    }
    if (payload.state === "delta") {
      const previous = this.partialByRunId.get(runId) ?? current.partial_text ?? "";
      const text = payload.replace ? payload.deltaText ?? "" : previous + (payload.deltaText ?? "");
      this.partialByRunId.set(runId, text);
      if (this.store.updatePartial(current.task_id, text) && text.trim()) {
        this.emitCallback("bridge.activity", this.store.get(current.task_id), activityContent(text.trim()));
      }
      return;
    }
    if (payload.state === "final") return this.handleFinal(current, runId, event, payload);
    if (payload.state === "aborted") {
      const reason = payload.stopReason || "aborted";
      this.transitionWithCallback(
        current.task_id,
        () => this.store.cancel(current.task_id, reason),
        "bridge.error",
        errorContent(reason),
        { reason: "canceled" },
      );
      this.partialByRunId.delete(runId);
      return;
    }
    if (payload.state === "error") {
      const text = payload.errorMessage || "chat error";
      this.transitionWithCallback(
        current.task_id,
        () => this.store.fail(current.task_id, text),
        "bridge.error",
        errorContent(text),
        { reason: "chat_error" },
      );
      this.partialByRunId.delete(runId);
    }
  }

  async handleFinal(task, runId, event, payload) {
    if (this.terminalInFlight.has(runId)) return;
    this.terminalInFlight.add(runId);
    try {
      const latest = this.store.get(task.task_id);
      if (!latest || latest.cancel_requested || TERMINAL.has(latest.status)) {
        if (latest?.cancel_requested && !TERMINAL.has(latest.status)) await this.coordinateCancellation(latest.task_id);
        return;
      }
      let record = null;
      try {
        const history = await this.request("chat.history", {
          sessionKey: latest.session_key,
          agentId: latest.agent_id,
          limit: this.recoveryHistoryLimit,
        }, { timeoutMs: 15_000 });
        const recovered = findRecoveredAssistantMessage(history, latest, { finalEventRunId: runId });
        if (recovered.message) {
          record = resultRecord(latest, recovered, extractHistoryMessages(history), "chat_final_event", {
            event: event.event,
            seq: event.seq,
          });
        }
      } catch {}
      if (!record && latest.run_id === runId) {
        const finalText = usableFinalText(messageText(payload.message))
          || usableFinalText(this.partialByRunId.get(runId) || latest.partial_text || "");
        if (finalText) {
          record = resultRecord(latest, {
            message: payload.message || null,
            text: finalText,
            selectedMessageIndex: 0,
            match: "matching_final_event_run_id",
            classification: "valid_final",
            evidence: { final_event_match: true, run_id_match: true },
          }, [], "chat_final_event_payload", { event: event.event, seq: event.seq });
        }
      }
      if (!record) {
        this.store.markRecovering(latest.task_id, "final event lacked usable turn-owned text");
        return;
      }
      this.transitionWithCallback(
        latest.task_id,
        () => this.store.complete(latest.task_id, record.value, record.finalAnswer, record.actualModelId),
        "bridge.final",
        finalContent(record.finalAnswer, record.finalAnswer),
        { final_answer_source: record.value.metadata.final_answer_source },
      );
      this.partialByRunId.delete(runId);
    } finally {
      this.terminalInFlight.delete(runId);
    }
  }
}

export class BridgeHttpApplication {
  constructor({
    store,
    controller,
    token,
    host = "127.0.0.1",
    port = 18793,
    maxBodyBytes = 24 * 1024 * 1024,
    recoveryDeadlineMs = 240_000,
    maxSessionCreateAttempts = 2,
    dbPath = null,
    capacityLimits = {},
  }) {
    this.store = store;
    this.controller = controller;
    this.token = token;
    this.host = host;
    this.port = port;
    this.maxBodyBytes = maxBodyBytes;
    this.recoveryDeadlineMs = recoveryDeadlineMs;
    this.maxSessionCreateAttempts = Math.max(1, Math.min(2, Number(maxSessionCreateAttempts) || 2));
    this.dbPath = dbPath;
    this.capacityLimits = resolveCapacityLimits(capacityLimits);
    this.server = http.createServer((req, res) => {
      if (controller.stopped) {
        this.jsonResponse(res, 503, { error: "bridge is shutting down" });
        return;
      }
      // Request handlers touch SQLite, so shutdown drains them like Gateway work.
      void controller.track(this.route(req, res).catch((error) => {
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        this.jsonResponse(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }));
    });
    controller.setSubmissionRunner((taskId, options) => this.submitTask(taskId, options));
  }

  jsonResponse(res, statusCode, value) {
    if (res.writableEnded) return;
    const body = JSON.stringify(value);
    res.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (chunks.length === 0) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(Object.assign(new Error("invalid JSON body"), { statusCode: 400 })); }
      });
      req.on("error", reject);
    });
  }

  requireAuth(req, res) {
    const auth = req.headers.authorization || "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const left = Buffer.from(presented);
    const right = Buffer.from(this.token);
    if (!presented || left.length !== right.length || !timingSafeEqual(left, right)) {
      this.jsonResponse(res, 401, { error: "unauthorized" });
      return false;
    }
    return true;
  }

  /**
   * Admission control for new tasks. Unresolved callbacks and dead letters are
   * never deleted automatically, so the Bridge stops accepting new work when
   * they, the database or the free disk space reach their limits. Existing
   * tasks keep running, recovering and recording callbacks.
   */
  async capacityStatus() {
    const limits = this.capacityLimits;
    const unresolvedCallbacks = this.store.countUnresolvedCallbacks();
    let databaseBytes = this.store.databaseSizeBytes();
    let freeDiskBytes = null;
    if (this.dbPath && this.dbPath !== ":memory:") {
      databaseBytes += await fs.stat(`${this.dbPath}-wal`).then((stat) => stat.size, () => 0);
      freeDiskBytes = await fs.statfs(path.dirname(this.dbPath))
        .then((stat) => Number(stat.bavail) * Number(stat.bsize), () => null);
    }
    const reasons = [];
    if (unresolvedCallbacks >= limits.maxUnresolvedCallbacks) reasons.push("unresolved_callbacks_limit");
    if (databaseBytes >= limits.maxDatabaseBytes) reasons.push("database_size_limit");
    // An unreadable free-space value is reported (null) but does not block.
    if (freeDiskBytes !== null && freeDiskBytes < limits.minFreeDiskBytes) reasons.push("free_disk_limit");
    return {
      ok: reasons.length === 0,
      reasons,
      unresolved_callbacks: unresolvedCallbacks,
      database_bytes: databaseBytes,
      free_disk_bytes: freeDiskBytes,
      limits,
    };
  }

  async readGatewayCatalog(refreshModels = false) {
    return readAgentScopedGatewayCatalog((method, params) => this.controller.request(method, params), { refreshModels });
  }

  deduplicatedResponse(res, task) {
    this.jsonResponse(res, task.status === "completed" ? 200 : 202, {
      ...taskStatus(task),
      session_key: task.session_key,
      session_id: task.session_id,
      agent_id: task.agent_id,
      deduplicated: true,
    });
  }

  async createTask(req, res) {
    const body = await this.readJsonBody(req);
    const message = normalizeOptionalString(body.message);
    if (!message) return this.jsonResponse(res, 400, { error: "message is required" });
    const providedIdempotencyKey = normalizeOptionalString(body.idempotency_key);
    const existing = providedIdempotencyKey ? this.store.getByIdempotencyKey(providedIdempotencyKey) : null;
    if (existing) return this.deduplicatedResponse(res, existing);
    const capacity = await this.capacityStatus();
    if (!capacity.ok) {
      return this.jsonResponse(res, 503, { error: "bridge_capacity_exhausted", reasons: capacity.reasons });
    }

    let attachmentInfo;
    try { attachmentInfo = normalizeNativeAttachments(body); }
    catch (error) {
      if (error instanceof BridgeTaskError) {
        return this.jsonResponse(res, error.statusCode || 400, { error: error.code, message: error.message });
      }
      throw error;
    }

    const taskId = randomUUID();
    const idempotencyKey = providedIdempotencyKey || taskId;
    const selectionMode = body.selection_mode === "openclaw-agent" ? "openclaw-agent" : "classic";
    const requestedBaseModelId = selectionMode === "openclaw-agent"
      ? normalizeOptionalString(body.base_model_id) || "" : "";
    const codexControls = normalizeCodexRunControls(body.codex_controls);
    const agentsList = await this.controller.request("agents.list", {});
    let agentId = pickAgentId(agentsList, normalizeOptionalString(body.agent_id));
    const conversationId = normalizeOptionalString(body.conversation_id) || taskId;
    let resolvedBaseModelId = "";
    let parentSessionKey = "";
    let sessionCreateParams = null;
    let sessionKey;
    let sessionId = normalizeOptionalString(body.session_id);

    if (selectionMode === "openclaw-agent") {
      const selection = resolveCatalogSelection(await this.readGatewayCatalog(false), agentId, requestedBaseModelId);
      if (!selection.ok) return this.jsonResponse(res, selection.statusCode || 400, { error: selection.error });
      agentId = selection.agentId;
      resolvedBaseModelId = selection.resolvedBaseModelId;
      parentSessionKey = this.store.getPreviousTurn(conversationId, agentId)?.session_key || "";
      sessionCreateParams = buildTurnSessionCreateParams({
        agentId, conversationId, modelId: resolvedBaseModelId, parentSessionKey, idempotencyKey,
      });
      sessionKey = sessionCreateParams.key;
      sessionId = null;
    } else {
      const defaultSessionKey = attachmentInfo.attachments.length > 0
        ? `agent:${agentId}:${conversationId}`
        : `agent:${agentId}:bridge:${conversationId}`;
      sessionKey = normalizeOptionalString(body.session_key) || defaultSessionKey;
    }

    const gatewayMessage = applyCodexRunControlsToMessage(message, resolvedBaseModelId, codexControls);
    const chatSendParams = buildGatewayChatSendRequest({
      sessionKey,
      agentId,
      sessionId,
      message: gatewayMessage,
      idempotencyKey,
      timeoutMs: body.timeoutMs,
      attachments: attachmentInfo.attachments,
    });
    assertGatewayFrameWithinLimit(chatSendParams);

    const createdAt = nowIso();
    const creation = this.store.createOrGet({
      task_id: taskId,
      conversation_id: conversationId,
      session_key: sessionKey,
      session_id: sessionId,
      agent_id: agentId,
      run_id: null,
      idempotency_key: idempotencyKey,
      status: "created",
      message,
      partial_text: "",
      result_json: null,
      error: null,
      created_at: createdAt,
      updated_at: createdAt,
      completed_at: null,
      selection_mode: selectionMode,
      requested_base_model_id: requestedBaseModelId || null,
      resolved_base_model_id: resolvedBaseModelId || null,
      actual_model_id: null,
      parent_session_key: parentSessionKey || null,
    });
    if (!creation.created) return this.deduplicatedResponse(res, creation.task);
    this.store.markSubmitting(taskId);
    this.store.setSubmissionPlan(taskId, {
      sessionCreateParams,
      chatSendParams,
      recoveryDeadlineAt: new Date(Date.now() + this.recoveryDeadlineMs).toISOString(),
    });

    await this.submitTask(taskId);
    const current = this.store.get(taskId);
    const statusCode = current.status === "failed" ? 502 : current.status === "indeterminate" ? 503 : 202;
    return this.jsonResponse(res, statusCode, {
      ...taskStatus(current),
      session_key: current.session_key,
      session_id: current.session_id,
      agent_id: current.agent_id,
      selection_mode: selectionMode,
      requested_base_model_id: requestedBaseModelId,
      resolved_base_model_id: resolvedBaseModelId,
      codex_controls: codexControls || undefined,
      parent_session_key: parentSessionKey,
    });
  }

  terminalFailure(taskId, text, reason, indeterminate = false) {
    return this.controller.transitionWithCallback(
      taskId,
      () => indeterminate
        ? this.store.markIndeterminate(taskId, text)
        : this.store.fail(taskId, text),
      "bridge.error",
      errorContent(text),
      { reason },
    );
  }

  async submitTask(taskId, { recovery = false } = {}) {
    let task = this.store.get(taskId);
    if (!task || TERMINAL.has(task.status)) return task;
    if (task.cancel_requested) return this.controller.coordinateCancellation(taskId);

    let chatSendParams = parseJson(task.chat_send_params_json, null);
    if (!chatSendParams) {
      this.terminalFailure(taskId, "persisted chat.send parameters are unavailable", "submission_state_invalid", true);
      return this.store.get(taskId);
    }

    if (["prepared", "session_create_dispatched"].includes(task.submission_phase)) {
      const sessionCreateParams = parseJson(task.session_create_params_json, null);
      if (!sessionCreateParams) {
        this.terminalFailure(taskId, "persisted sessions.create parameters are unavailable", "submission_state_invalid", true);
        return this.store.get(taskId);
      }
      if (deadlineExpired(task) || task.session_create_attempts >= this.maxSessionCreateAttempts) {
        this.terminalFailure(
          taskId,
          "sessions.create confirmation remained uncertain after bounded idempotent retries; possible idle session retained",
          "sessions_create_indeterminate",
          true,
        );
        return this.store.get(taskId);
      }
      if (!this.store.markSessionCreateAttempt(taskId)) {
        return this.controller.coordinateCancellation(taskId);
      }
      let sent = false;
      try {
        const created = await this.controller.request("sessions.create", sessionCreateParams, {
          timeoutMs: 30_000,
          onSent: () => { sent = true; },
        });
        task = this.store.get(taskId);
        if (task.cancel_requested) return this.controller.coordinateCancellation(taskId);
        const sessionKey = normalizeOptionalString(created?.key) || sessionCreateParams.key;
        const sessionId = normalizeOptionalString(created?.entry?.sessionId || created?.sessionId);
        chatSendParams = { ...chatSendParams, sessionKey, ...(sessionId ? { sessionId } : {}) };
        this.store.markSessionReady(taskId, sessionKey, sessionId, chatSendParams);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        task = this.store.get(taskId);
        if (task.cancel_requested) return this.controller.coordinateCancellation(taskId);
        if (isUncertainSubmissionFailure(error, sent)) {
          this.store.markRecovering(taskId, `sessions.create confirmation uncertain: ${text}`);
          return this.store.get(taskId);
        }
        this.terminalFailure(taskId, text, "sessions_create_failed");
        return this.store.get(taskId);
      }
    }

    task = this.store.get(taskId);
    if (!task || TERMINAL.has(task.status)) return task;
    if (task.cancel_requested) return this.controller.coordinateCancellation(taskId);
    if (task.submission_phase !== "session_ready") return task;

    // Installed OpenClaw uses chat.send.idempotencyKey as the exact runId.
    // Persist it before the request so early events and cancellation share one
    // verifiable identity; it is not inferred from response timing or text.
    const exactRunId = task.idempotency_key;
    if (!this.store.markChatSendDispatching(taskId, exactRunId)) {
      return this.controller.coordinateCancellation(taskId);
    }
    task = this.store.get(taskId);
    if (task.cancel_requested) return this.controller.cancelBeforeChatDispatch(taskId);

    this.controller.deferEvents(taskId);
    let sent = false;
    let startedEmitted = false;
    try {
      const response = await this.controller.request("chat.send", chatSendParams, {
        timeoutMs: 20_000,
        beforeDispatch: () => this.controller.assertChatSendDispatchAllowed(taskId),
        onSent: () => {
          sent = true;
          this.store.markChatSendDispatched(taskId, exactRunId);
          if (this.store.get(taskId)?.cancel_requested) {
            queueMicrotask(() => void this.controller.track(this.controller.coordinateCancellation(taskId)));
          }
        },
        onAccepted: (payload) => {
          const acceptedRunId = normalizeOptionalString(payload?.runId);
          if (acceptedRunId && acceptedRunId !== exactRunId) {
            this.terminalFailure(taskId, `Gateway returned unexpected runId ${acceptedRunId}`, "run_identity_mismatch", true);
            return;
          }
          this.store.bindRun(taskId, exactRunId, chatSendParams.sessionKey, chatSendParams.sessionId || null);
        },
      });
      const responseRunId = normalizeOptionalString(response?.runId);
      if (responseRunId && responseRunId !== exactRunId) {
        this.terminalFailure(taskId, `Gateway returned unexpected runId ${responseRunId}`, "run_identity_mismatch", true);
        await this.controller.releaseEvents(taskId);
        return this.store.get(taskId);
      }
      this.store.bindRun(taskId, exactRunId, chatSendParams.sessionKey, chatSendParams.sessionId || null);
      task = this.store.get(taskId);
      if (!task.cancel_requested && task.status === "running") {
        this.controller.emitCallback("bridge.started", task, startedContent(task.message, task.agent_id), {
          task_id: taskId,
          run_id: exactRunId,
        });
        startedEmitted = true;
      }
      await this.controller.releaseEvents(taskId);
      if (this.store.get(taskId)?.cancel_requested) await this.controller.coordinateCancellation(taskId);
      return this.store.get(taskId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      task = this.store.get(taskId);
      if (sent) this.store.markChatSendDispatched(taskId, exactRunId);
      if (TERMINAL.has(task.status)) {
        // A synchronous beforeDispatch guard can prove the request never left
        // the adapter and atomically move the task to canceled.
      } else if (sent || isUncertainSubmissionFailure(error, sent)) {
        this.store.markRecovering(taskId, `chat.send confirmation uncertain: ${text}`);
        if (!startedEmitted && !task.cancel_requested) {
          this.controller.emitCallback("bridge.started", this.store.get(taskId), startedContent(task.message, task.agent_id), {
            task_id: taskId,
            run_id: exactRunId,
            confirmation: "request_dispatched",
          });
        }
      } else if (task.cancel_requested) {
        this.controller.cancelBeforeChatDispatch(taskId);
      } else {
        this.terminalFailure(taskId, text, "chat_send_failed");
      }
      await this.controller.releaseEvents(taskId);
      if (this.store.get(taskId)?.cancel_requested && !TERMINAL.has(this.store.get(taskId).status)) {
        await this.controller.coordinateCancellation(taskId);
      }
      return this.store.get(taskId);
    }
  }

  async cancelTask(task, res) {
    if (TERMINAL.has(task.status)) return this.jsonResponse(res, 200, taskStatus(task));
    this.store.requestCancel(task.task_id);
    const current = await this.controller.coordinateCancellation(task.task_id);
    const code = current?.status === "canceling" || current?.status === "recovering" ? 202 : 200;
    return this.jsonResponse(res, code, taskStatus(current));
  }

  async taskResult(task, res) {
    if (task.status !== "completed") {
      return this.jsonResponse(res, 409, { ...taskStatus(task), partial_text: task.partial_text || "" });
    }
    const stored = parseJson(task.result_json, {});
    const finalAnswer = stored.final_answer || stored.text || messageText(stored.message) || "";
    if (!finalAnswer.trim()) {
      return this.jsonResponse(res, 409, { ...taskStatus(task), error: "completed task has no usable final text" });
    }
    const messages = Array.isArray(stored.messages) ? stored.messages : [];
    return this.jsonResponse(res, 200, {
      task_id: task.task_id,
      run_id: task.run_id,
      status: task.status,
      final_answer: finalAnswer,
      result: finalAnswer,
      messages,
      events: Array.isArray(stored.events) ? stored.events : [],
      metadata: stored.metadata || {},
      selection_mode: task.selection_mode || "classic",
      requested_base_model_id: task.requested_base_model_id || "",
      resolved_base_model_id: task.resolved_base_model_id || "",
      actual_model_id: task.actual_model_id || executionModelFromMessages(messages, task.resolved_base_model_id),
      text: finalAnswer,
    });
  }

  async route(req, res) {
    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : this.port;
    const url = new URL(req.url || "/", `http://${this.host}:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      const dbOk = this.store.dbOk();
      const capacity = await this.capacityStatus();
      return this.jsonResponse(res, dbOk ? 200 : 500, {
        ok: dbOk && this.controller.connected && capacity.ok,
        capacity,
        callback_unresolved: capacity.unresolved_callbacks,
        gateway_connected: this.controller.connected,
        db_ok: dbOk,
        running_tasks: this.store.countStatus("running"),
        recovering_tasks: this.store.countStatus("recovering"),
        completed_tasks_recent: this.store.completedRecent(),
        callback_pending: this.store.countCallbackStatus("pending"),
        callback_sending: this.store.countCallbackStatus("sending"),
        callback_retrying: this.store.countCallbackStatus("retrying"),
        callback_dead_letter: this.store.countCallbackStatus("dead_letter"),
        callback_superseded: this.store.countCallbackStatus("superseded"),
        callback_outbox_rows: this.store.countCallbackRows(),
        callback_outbox_maintenance: this.controller.lastOutboxMaintenance,
        callback_delivery_enabled: this.controller.callbackClient?.stats?.().deliveryEnabled ?? false,
        callback_delivery_semantics: "at-least-once",
        version: BRIDGE_VERSION,
        gateway_client_export: "openclaw/plugin-sdk/gateway-runtime",
        last_recovery_at: this.controller.lastRecoveryAt,
        last_recovery_error: this.controller.lastRecoveryError,
      });
    }
    if (!this.requireAuth(req, res)) return;
    if (req.method === "GET" && url.pathname === "/v1/openclaw/catalog") {
      return this.jsonResponse(res, 200, await this.readGatewayCatalog(url.searchParams.get("refresh") === "1"));
    }
    const callbackMatch = url.pathname.match(/^\/v1\/openclaw\/callbacks\/([^/]+)\/(requeue)$/);
    if (callbackMatch) {
      if (req.method !== "POST") return this.jsonResponse(res, 405, { error: "method not allowed" });
      const eventId = decodeURIComponent(callbackMatch[1]);
      const existing = this.store.getCallback(eventId);
      if (!existing) return this.jsonResponse(res, 404, { error: "callback event not found", event_id: eventId });
      if (!this.controller.requeueCallback(eventId)) {
        return this.jsonResponse(res, 409, { error: "callback event is not dead_letter", event_id: eventId, status: existing.status });
      }
      return this.jsonResponse(res, 202, { event_id: eventId, status: "pending" });
    }
    if (req.method === "POST" && url.pathname === "/v1/openclaw/tasks") return this.createTask(req, res);
    const match = url.pathname.match(/^\/v1\/openclaw\/tasks\/([^/]+)\/(status|result|cancel)$/);
    if (!match) return this.jsonResponse(res, 404, { error: "not found" });
    const task = this.store.get(match[1]);
    if (!task) return this.jsonResponse(res, 404, { error: "task not found", task_id: match[1] });
    if (req.method === "GET" && match[2] === "status") return this.jsonResponse(res, 200, taskStatus(task));
    if (req.method === "GET" && match[2] === "result") return this.taskResult(task, res);
    if (req.method === "POST" && match[2] === "cancel") return this.cancelTask(task, res);
    return this.jsonResponse(res, 405, { error: "method not allowed" });
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve(this.server.address());
      });
    });
  }

  /** Stop accepting connections; in-flight requests are drained by the controller. */
  close() {
    if (!this.server.listening) return Promise.resolve();
    const closed = new Promise((resolve) => this.server.close(() => resolve()));
    this.server.closeIdleConnections?.();
    return closed;
  }
}

export function createBridgeApplication({
  dbPath,
  token,
  gatewayFactory,
  callbackClient = null,
  host = "127.0.0.1",
  port = 18793,
  maxBodyBytes,
  recoveryDeadlineMs,
  maxSessionCreateAttempts = 2,
  recoveryHistoryLimit = 80,
  shutdownDrainMs = 10_000,
  callbackOutboxPolicy = {},
  capacityLimits = {},
} = {}) {
  if (!dbPath) throw new Error("dbPath is required");
  if (!token) throw new Error("Bridge bearer token is required");
  if (typeof gatewayFactory !== "function") throw new Error("gatewayFactory is required");
  const db = openTaskDatabase(dbPath);
  const store = new TaskStore(db);
  store.markStartupRecovering();
  callbackClient?.attachStore?.(store);
  let controller;
  let closed = false;
  const gateway = gatewayFactory({
    onEvent: (event) => { if (controller && !closed) void controller.track(controller.handleEvent(event)); },
    onConnected: () => { if (controller && !closed) void controller.track(controller.recoverySweep("reconnect")); },
    onDisconnected: () => { if (!closed) store.markRunningRecovering(); },
    onGap: () => { if (controller && !closed) void controller.track(controller.recoverySweep("event-gap")); },
    onConnectError: (error) => { if (controller) controller.lastRecoveryError = error.message; },
  });
  controller = new BridgeController({
    store,
    gateway,
    callbackClient,
    recoveryHistoryLimit,
    maxSessionCreateAttempts,
    callbackOutboxPolicy,
  });
  const app = new BridgeHttpApplication({
    store,
    controller,
    token,
    host,
    port,
    maxBodyBytes,
    recoveryDeadlineMs,
    maxSessionCreateAttempts,
    dbPath,
    capacityLimits,
  });
  let closePromise = null;
  return {
    app,
    controller,
    store,
    db,
    gateway,
    /**
     * Shut down without using SQLite after it is closed. Order: stop accepting
     * HTTP, stop the Gateway and drain tracked request/event/recovery work,
     * stop the callback dispatcher, then close SQLite. If tracked work is still
     * running after the drain window, SQLite is deliberately left open (WAL
     * keeps it crash-safe when the process exits) and sqliteClosed is false.
     */
    async close({ drainMs = shutdownDrainMs } = {}) {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const serverClosed = app.close();
        const drained = await controller.stop({ drainMs }).catch(() => false);
        if (typeof callbackClient?.stop === "function") await callbackClient.stop({ graceMs: 3_000 });
        else await callbackClient?.flush?.(3_000);
        if (!drained) {
          console.warn("[bridge] shutdown drain timed out; SQLite left open for in-flight work");
          return { sqliteClosed: false };
        }
        // All requests have settled; drop lingering keep-alive sockets.
        app.server.closeAllConnections?.();
        await serverClosed;
        closed = true;
        db.close();
        return { sqliteClosed: true };
      })();
      return closePromise;
    },
  };
}
