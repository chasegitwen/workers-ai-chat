#!/usr/bin/env node
/**
 * server.mjs — OpenClaw Bridge HTTP Service
 * Version: 14.3-run-controls (Gateway catalog, per-turn model selection, and GPT run controls)
 *
 * Phase 2: Final Answer Recovery — returns the last valid assistant message.
 * Milestone 2.3: Progress Callback Client — pushes lifecycle events to web-ai-assistant.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  BridgeTaskError,
  assertGatewayFrameWithinLimit,
  buildGatewayChatSendRequest,
  messageText,
  extractHistoryMessages,
  classifyAssistantMessage,
  findRecoveredAssistantMessage,
  normalizeNativeAttachments,
} from "./lib.mjs";
import {
  createCallbackClient,
  resolveCallbackConfig,
  buildPayload,
  startedContent,
  activityContent,
  toolCallContent,
  toolResultContent,
  finalContent,
  errorContent,
} from "./callback.mjs";
import {
  applyCodexRunControlsToMessage,
  buildTurnSessionCreateParams,
  executionModelFromMessages,
  normalizeCodexRunControls,
  normalizeGatewayCatalog,
  resolveCatalogSelection,
} from "./model-routing.mjs";

const BRIDGE_DIR = "/root/.openclaw/workspace/openclaw_bridge";
const OPENCLAW_DIST = "/usr/lib/node_modules/openclaw/dist";
const DB_PATH = path.join(BRIDGE_DIR, "openclaw_bridge.sqlite");
const HOST = process.env.OPENCLAW_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.OPENCLAW_BRIDGE_PORT || 18793);
const TOKEN = process.env.OPENCLAW_BRIDGE_TOKEN || "";
const VERSION = "14.3-run-controls";
const MAX_BODY_BYTES = Number(process.env.OPENCLAW_BRIDGE_MAX_BODY_BYTES || 24 * 1024 * 1024);
const RECOVERY_SWEEP_MS = Number(process.env.OPENCLAW_BRIDGE_RECOVERY_SWEEP_MS || 20000);
const RECOVERY_HISTORY_LIMIT = Number(process.env.OPENCLAW_BRIDGE_RECOVERY_HISTORY_LIMIT || 80);

/* ── callback config ── */
const CALLBACK_CONFIG_PATH = path.join(BRIDGE_DIR, "callback.json");

if (!TOKEN) {
  console.error("OPENCLAW_BRIDGE_TOKEN is required");
  process.exit(1);
}

/* ── helpers ── */

function nowIso() {
  return new Date().toISOString();
}

function jsonResponse(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("invalid JSON body"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireAuth(req, res) {
  const auth = req.headers.authorization || "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix) || !safeEqual(auth.slice(prefix.length), TOKEN)) {
    jsonResponse(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

async function findDistFile(prefix) {
  const entries = await fs.readdir(OPENCLAW_DIST);
  const file = entries.find((name) => name.startsWith(prefix) && name.endsWith(".js"));
  if (!file) throw new Error(`OpenClaw dist file not found for prefix ${prefix}`);
  return path.join(OPENCLAW_DIST, file);
}

async function importDistModule(prefix) {
  const file = await findDistFile(prefix);
  const mod = await import(pathToFileURL(file).href);
  return { file, mod };
}

async function importDistModuleWithExport(prefix, exportName) {
  const entries = await fs.readdir(OPENCLAW_DIST);
  const files = entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .map((name) => path.join(OPENCLAW_DIST, name));

  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod?.[exportName] !== "undefined") {
      return { file, mod };
    }
  }

  throw new Error(`OpenClaw dist export ${exportName} not found for prefix ${prefix}`);
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  return agentsResult?.defaultId || agents.find((agent) => agent?.id === "main")?.id || agents[0]?.id || "main";
}

async function readGatewayCatalog(refreshModels = false) {
  const [agents, models] = await Promise.all([
    bridge.request("agents.list", {}),
    bridge.request("models.list", { view: "configured", refresh: Boolean(refreshModels) }),
  ]);
  return normalizeGatewayCatalog(agents, models);
}

/* ── database ── */

function createDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      session_key TEXT,
      session_id TEXT,
      agent_id TEXT,
      run_id TEXT,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      message TEXT,
      partial_text TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
  for (const column of [
    "selection_mode TEXT NOT NULL DEFAULT 'classic'",
    "requested_base_model_id TEXT",
    "resolved_base_model_id TEXT",
    "actual_model_id TEXT",
    "parent_session_key TEXT",
  ]) {
    try { db.exec(`ALTER TABLE tasks ADD COLUMN ${column}`); } catch (err) {
      if (!/duplicate column name/i.test(String(err?.message || err))) throw err;
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_session_key ON tasks(session_key)");
  return db;
}

class TaskStore {
  constructor(db) {
    this.db = db;
    this.insertTask = db.prepare(`
      INSERT INTO tasks (
        task_id, conversation_id, session_key, session_id, agent_id, run_id,
        idempotency_key, status, message, partial_text, result_json, error,
        created_at, updated_at, completed_at, selection_mode,
        requested_base_model_id, resolved_base_model_id, actual_model_id, parent_session_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare("SELECT * FROM tasks WHERE task_id = ?");
    this.getByRunIdStmt = db.prepare("SELECT * FROM tasks WHERE run_id = ?");
    this.getByIdempotencyKeyStmt = db.prepare(`
      SELECT * FROM tasks
      WHERE idempotency_key = ?
      ORDER BY created_at ASC
      LIMIT 1
    `);
    this.getPreviousTurnStmt = db.prepare(`
      SELECT * FROM tasks
      WHERE conversation_id = ? AND agent_id = ? AND selection_mode = 'openclaw-agent'
        AND status = 'completed' AND session_key IS NOT NULL
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `);
    this.updateSubmittingStmt = db.prepare(`
      UPDATE tasks
      SET status = 'submitting', updated_at = ?
      WHERE task_id = ? AND status = 'created'
    `);
    this.updateRunningStmt = db.prepare(`
      UPDATE tasks
      SET status = 'running', run_id = ?, session_key = ?, session_id = ?, updated_at = ?
      WHERE task_id = ? AND status IN ('created', 'submitting', 'recovering')
    `);
    this.updatePartialStmt = db.prepare(`
      UPDATE tasks
      SET status = CASE WHEN status = 'recovering' THEN 'running' ELSE status END,
          partial_text = ?,
          updated_at = ?
      WHERE task_id = ? AND status IN ('created', 'submitting', 'running', 'recovering')
    `);
    this.completeStmt = db.prepare(`
      UPDATE tasks
      SET status = 'completed', result_json = ?, partial_text = ?, actual_model_id = COALESCE(NULLIF(?, ''), actual_model_id), error = NULL,
          updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ('created', 'submitting', 'running', 'recovering')
    `);
    this.failStmt = db.prepare(`
      UPDATE tasks
      SET status = 'failed', error = ?, updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ('created', 'submitting', 'running', 'recovering')
    `);
    this.cancelStmt = db.prepare(`
      UPDATE tasks
      SET status = 'canceled', error = ?, updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ('created', 'submitting', 'running', 'recovering')
    `);
    this.recoveringStmt = db.prepare(`
      UPDATE tasks
      SET status = 'recovering', updated_at = ?
      WHERE task_id = ? AND status = 'running'
    `);
    this.startupRecoveringStmt = db.prepare(`
      UPDATE tasks
      SET status = 'recovering', updated_at = ?
      WHERE status IN ('created', 'submitting', 'running', 'recovering')
    `);
    this.runningRecoveringStmt = db.prepare(`
      UPDATE tasks
      SET status = 'recovering', updated_at = ?
      WHERE status = 'running'
    `);
    this.touchRecoverableStmt = db.prepare(`
      UPDATE tasks
      SET updated_at = ?
      WHERE task_id = ? AND status IN ('running', 'recovering')
    `);
    this.listRecoverableStmt = db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('running', 'recovering')
      ORDER BY updated_at ASC
      LIMIT ?
    `);
    this.countByStatusStmt = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = ?");
    this.completedRecentStmt = db.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at >= datetime('now', '-1 hour')
    `);
    this.dbOkStmt = db.prepare("SELECT 1 AS ok");
  }

  create(task) {
    this.insertTask.run(
      task.task_id,
      task.conversation_id,
      task.session_key,
      task.session_id,
      task.agent_id,
      task.run_id,
      task.idempotency_key,
      task.status,
      task.message,
      task.partial_text,
      task.result_json,
      task.error,
      task.created_at,
      task.updated_at,
      task.completed_at,
      task.selection_mode || "classic",
      task.requested_base_model_id,
      task.resolved_base_model_id,
      task.actual_model_id,
      task.parent_session_key,
    );
  }

  get(taskId) {
    return this.getByIdStmt.get(taskId) || null;
  }

  getByRunId(runId) {
    return this.getByRunIdStmt.get(runId) || null;
  }

  getByIdempotencyKey(idempotencyKey) {
    return this.getByIdempotencyKeyStmt.get(idempotencyKey) || null;
  }

  getPreviousTurn(conversationId, agentId) {
    return this.getPreviousTurnStmt.get(conversationId, agentId) || null;
  }

  markSubmitting(taskId) {
    this.updateSubmittingStmt.run(nowIso(), taskId);
  }

  markRunning(taskId, runId, sessionKey, sessionId) {
    this.updateRunningStmt.run(runId, sessionKey, sessionId, nowIso(), taskId);
  }

  updatePartial(taskId, text) {
    this.updatePartialStmt.run(text, nowIso(), taskId);
  }

  complete(taskId, result, partialText, actualModelId = "") {
    const ts = nowIso();
    this.completeStmt.run(JSON.stringify(result), partialText || messageText(result?.message), actualModelId, ts, ts, taskId);
  }

  fail(taskId, error) {
    const ts = nowIso();
    this.failStmt.run(error, ts, ts, taskId);
  }

  cancel(taskId, reason = "canceled") {
    const ts = nowIso();
    this.cancelStmt.run(reason, ts, ts, taskId);
  }

  recovering(taskId) {
    this.recoveringStmt.run(nowIso(), taskId);
  }

  markStartupRecovering() {
    return this.startupRecoveringStmt.run(nowIso()).changes ?? 0;
  }

  markRunningRecovering() {
    return this.runningRecoveringStmt.run(nowIso()).changes ?? 0;
  }

  touchRecoverable(taskId) {
    this.touchRecoverableStmt.run(nowIso(), taskId);
  }

  listRecoverable(limit = 50) {
    return this.listRecoverableStmt.all(limit);
  }

  countStatus(status) {
    return this.countByStatusStmt.get(status)?.count ?? 0;
  }

  completedRecent() {
    return this.completedRecentStmt.get()?.count ?? 0;
  }

  dbOk() {
    return this.dbOkStmt.get()?.ok === 1;
  }
}

/* ── gateway bridge ── */

class GatewayBridge {
  constructor(store) {
    this.store = store;
    this.chatClient = null;
    this.rawClient = null;
    this.connected = false;
    this.connecting = null;
    this.imports = {};
    this.partialByRunId = new Map();
    this.recoveryInFlight = false;
    this.recoveryTimer = null;
    this.lastRecoveryAt = null;
    this.lastRecoveryError = null;
  }

  async start() {
    if (this.connecting) return this.connecting;
    this.connecting = this.#connect();
    return this.connecting;
  }

  async #connect() {
    const gatewayChatImport = await importDistModule("gateway-chat-");
    const gatewayClientImport = await importDistModuleWithExport("client-", "GatewayClient");
    this.imports = {
      gatewayChatClient: gatewayChatImport.file,
      gatewayClient: gatewayClientImport.file,
    };
    const { GatewayChatClient } = gatewayChatImport.mod;
    if (typeof GatewayChatClient !== "function") throw new Error("GatewayChatClient export unavailable");

    const chatClient = await GatewayChatClient.connect({});
    chatClient.onEvent = (evt) => this.handleEvent(evt);
    chatClient.onConnected = () => {
      this.connected = true;
      this.recoverySweep("reconnect").catch((err) => {
        this.lastRecoveryError = err instanceof Error ? err.message : String(err);
      });
    };
    chatClient.onDisconnected = () => {
      this.connected = false;
      this.store.markRunningRecovering();
    };
    chatClient.start();
    await chatClient.waitForReady();
    this.connected = true;
    this.chatClient = chatClient;
    this.rawClient = chatClient.client;
    this.startRecoveryTimer();
    await this.recoverySweep("connect");
  }

  async stop() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
    if (typeof this.rawClient?.stopAndWait === "function") {
      await this.rawClient.stopAndWait({ timeoutMs: 3000 });
    } else {
      this.chatClient?.stop?.();
    }
  }

  async request(method, params, opts) {
    await this.start();
    return await this.rawClient.request(method, params, opts);
  }

  startRecoveryTimer() {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setInterval(() => {
      this.recoverySweep("timer").catch((err) => {
        this.lastRecoveryError = err instanceof Error ? err.message : String(err);
      });
    }, RECOVERY_SWEEP_MS);
    this.recoveryTimer.unref?.();
  }

  async recoverySweep(reason = "manual") {
    if (this.recoveryInFlight || !this.rawClient) return { skipped: true, reason: "busy_or_not_connected" };
    this.recoveryInFlight = true;
    const stats = { reason, checked: 0, recovered: 0, touched: 0, failed: 0 };
    try {
      const tasks = this.store.listRecoverable(100);
      for (const task of tasks) {
        stats.checked += 1;
        try {
          const history = await this.rawClient.request(
            "chat.history",
            {
              sessionKey: task.session_key,
              agentId: task.agent_id,
              limit: RECOVERY_HISTORY_LIMIT,
            },
            { timeoutMs: 15000 },
          );
          const recovered = findRecoveredAssistantMessage(history, task);
          const historyMessages = extractHistoryMessages(history);
          if (recovered.message) {
            const finalAnswer = recovered.text;
            const actualModelId = executionModelFromMessages(historyMessages, task.resolved_base_model_id);
            this.store.complete(
              task.task_id,
              {
                // ── new standardised fields ──
                final_answer: finalAnswer,
                result: finalAnswer,
                messages: historyMessages,
                events: [],
                metadata: {
                  final_answer_source: recovered.fallback ? "fallback_suspect" : "last_valid_assistant",
                  selected_message_index: recovered.selectedMessageIndex ?? 0,
                  message_count: historyMessages.length,
                  event_count: 0,
                  requested_base_model_id: task.requested_base_model_id || "",
                  resolved_base_model_id: task.resolved_base_model_id || "",
                  actual_model_id: actualModelId,
                },
                // ── legacy / debug fields (kept for backward compat) ──
                source: "history_recovery",
                recovery_reason: reason,
                runId: task.run_id,
                idempotencyKey: task.idempotency_key,
                sessionKey: task.session_key,
                sessionId: task.session_id,
                agentId: task.agent_id,
                match: recovered.match,
                classification: recovered.classification,
                fallback: recovered.fallback,
                fallback_reason: recovered.fallback_reason,
                messageCount: recovered.messageCount,
                message: recovered.message,
                text: finalAnswer,
                recovered_at: nowIso(),
              },
              finalAnswer,
              actualModelId,
            );
            stats.recovered += 1;
          } else {
            this.store.touchRecoverable(task.task_id);
            stats.touched += 1;
          }
        } catch {
          this.store.touchRecoverable(task.task_id);
          stats.failed += 1;
        }
      }
      this.lastRecoveryAt = nowIso();
      this.lastRecoveryError = null;
      return stats;
    } finally {
      this.recoveryInFlight = false;
    }
  }

  handleEvent(evt) {
    if (evt?.event !== "chat") return;
    const payload = evt.payload || {};
    const runId = normalizeOptionalString(payload.runId);
    if (!runId) return;
    const task = this.store.getByRunId(runId);
    if (!task) return;

    if (payload.state === "delta") {
      const previous = this.partialByRunId.get(runId) ?? task.partial_text ?? "";
      const text = payload.replace ? payload.deltaText ?? "" : previous + (payload.deltaText ?? "");
      this.partialByRunId.set(runId, text);
      this.store.updatePartial(task.task_id, text);
      // ── callback: bridge.activity (throttled via classification) ──
      const trimmed = (text || "").trim();
      if (trimmed && classifyAssistantMessage(trimmed) !== "empty") {
        emitCallback("bridge.activity", task, activityContent(trimmed));
      }
      return;
    }

    if (payload.state === "final") {
      this.#handleFinal(task, runId, evt, payload).catch((err) => {
        // ultimate fallback — should rarely happen
        const finalText =
          messageText(payload.message) ||
          this.partialByRunId.get(runId) ||
          task.partial_text ||
          "";
        this.store.complete(
          task.task_id,
          {
            event: evt.event,
            seq: evt.seq,
            payload,
            message: payload.message,
            text: finalText,
            final_answer: finalText,
            result: finalText,
            messages: [],
            events: [],
            metadata: {
              final_answer_source: "payload_final_fallback",
              selected_message_index: 0,
              message_count: 0,
              event_count: 0,
              requested_base_model_id: task.requested_base_model_id || "",
              resolved_base_model_id: task.resolved_base_model_id || "",
              actual_model_id: task.resolved_base_model_id || "",
            },
            received_at: nowIso(),
            fallback_error: err instanceof Error ? err.message : String(err),
          },
          finalText,
          task.resolved_base_model_id || "",
        );
        // ── callback: bridge.final (ultimate fallback) ──
        emitCallback("bridge.final", task, finalContent(finalText, finalText), {
          final_answer_source: "payload_final_fallback",
          fallback_error: err instanceof Error ? err.message : String(err),
        });
        this.partialByRunId.delete(runId);
      });
      return;
    }

    if (payload.state === "aborted") {
      this.store.cancel(task.task_id, payload.stopReason || "aborted");
      this.partialByRunId.delete(runId);
      // ── callback: bridge.error (canceled) ──
      emitCallback("bridge.error", task, errorContent(payload.stopReason || "aborted"), { reason: "canceled" });
      return;
    }

    if (payload.state === "error") {
      this.store.fail(task.task_id, payload.errorMessage || "chat error");
      this.partialByRunId.delete(runId);
      // ── callback: bridge.error ──
      emitCallback("bridge.error", task, errorContent(payload.errorMessage || "chat error"), { reason: "chat_error" });
    }
  }

  /**
   * Handle "final" state event.
   *
   * Try to call chat.history for the full message sequence, then use the same
   * last-valid-assistant selection logic as recovery. Falls back to
   * payload.message if chat.history is unavailable.
   */
  async #handleFinal(task, runId, evt, payload) {
    try {
      const history = await this.rawClient.request(
        "chat.history",
        {
          sessionKey: task.session_key,
          agentId: task.agent_id,
          limit: RECOVERY_HISTORY_LIMIT,
        },
        { timeoutMs: 15000 },
      );

      const recovered = findRecoveredAssistantMessage(history, task);
      const messages = extractHistoryMessages(history);

      if (recovered.message) {
        const finalAnswer = recovered.text;
        const actualModelId = executionModelFromMessages(messages, task.resolved_base_model_id);
        this.store.complete(
          task.task_id,
          {
            // ── new standardised fields ──
            final_answer: finalAnswer,
            result: finalAnswer,
            messages,
            events: [],
            metadata: {
              final_answer_source: recovered.fallback ? "fallback_suspect" : "last_valid_assistant",
              selected_message_index: recovered.selectedMessageIndex ?? 0,
              message_count: messages.length,
              event_count: 0,
              requested_base_model_id: task.requested_base_model_id || "",
              resolved_base_model_id: task.resolved_base_model_id || "",
              actual_model_id: actualModelId,
            },
            // ── legacy / debug fields ──
            event: evt.event,
            seq: evt.seq,
            payload,
            message: payload.message,
            text: finalAnswer,
            match: recovered.match,
            classification: recovered.classification,
            fallback: recovered.fallback,
            received_at: nowIso(),
          },
          finalAnswer,
          actualModelId,
        );
        // ── callback: bridge.final ──
        emitCallback("bridge.final", task, finalContent(finalAnswer, finalAnswer), {
          final_answer_source: recovered.fallback ? "fallback_suspect" : "last_valid_assistant",
          selected_message_index: recovered.selectedMessageIndex ?? 0,
          message_count: messages.length,
        });
      } else {
        // No usable assistant in history — fall back to payload
        throw new Error("no recovered assistant message in history");
      }
    } catch {
      // chat.history failed or no usable message — use payload.message
      const finalText =
        messageText(payload.message) ||
        this.partialByRunId.get(runId) ||
        task.partial_text ||
        "";
      this.store.complete(
        task.task_id,
        {
          // ── new standardised fields ──
          final_answer: finalText,
          result: finalText,
          messages: [],
          events: [],
          metadata: {
            final_answer_source: "payload_final_fallback",
            selected_message_index: 0,
            message_count: 0,
            event_count: 0,
            requested_base_model_id: task.requested_base_model_id || "",
            resolved_base_model_id: task.resolved_base_model_id || "",
            actual_model_id: task.resolved_base_model_id || "",
          },
          // ── legacy / debug fields ──
          event: evt.event,
          seq: evt.seq,
          payload,
          message: payload.message,
          text: finalText,
          received_at: nowIso(),
        },
        finalText,
        task.resolved_base_model_id || "",
      );
      // ── callback: bridge.final (fallback) ──
      emitCallback("bridge.final", task, finalContent(finalText, finalText), {
        final_answer_source: "payload_final_fallback",
      });
    }
    this.partialByRunId.delete(runId);
  }
}

/* ── server boot ── */

const db = createDb();
const store = new TaskStore(db);
const startupRecoveringCount = store.markStartupRecovering();

/* ── callback client boot ── */

let callbackClient = null;
try {
  const rawCallbackConfig = await fs.readFile(CALLBACK_CONFIG_PATH, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);
  if (rawCallbackConfig) {
    const resolved = resolveCallbackConfig(rawCallbackConfig.bridge_callback || rawCallbackConfig, process.env);
    callbackClient = createCallbackClient({
      ...resolved,
      logger: {
        warn: (...args) => console.warn("[callback]", ...args),
        info: (...args) => console.info("[callback]", ...args),
        error: (...args) => console.error("[callback]", ...args),
      },
    });
    console.log(`[callback] enabled=${resolved.enabled} url=${resolved.url ? resolved.url.replace(/\/$/, "") : "(none)"} bridge_id=${resolved.bridgeId}`);
  } else {
    console.log("[callback] no callback.json found — callbacks disabled");
  }
} catch (err) {
  console.warn(`[callback] config error (callbacks disabled): ${err instanceof Error ? err.message : String(err)}`);
}

/** Per-task sequence counter for callback events */
const taskSequences = new Map();
function nextSequence(taskId) {
  const seq = (taskSequences.get(taskId) ?? 0) + 1;
  taskSequences.set(taskId, seq);
  return seq;
}

/** Emit a callback event (no-op if callback client is not configured) */
function emitCallback(eventType, task, content, metadata) {
  if (!callbackClient) return;
  callbackClient.enqueue(
    buildPayload({
      eventType,
      taskId: task.task_id,
      conversationId: task.conversation_id,
      sequence: nextSequence(task.task_id),
      agent: task.agent_id,
      content,
      metadata,
    }),
  );
}

const bridge = new GatewayBridge(store);

/* ── route handlers ── */

function taskStatus(task) {
  return {
    task_id: task.task_id,
    run_id: task.run_id,
    status: task.status,
    updated_at: task.updated_at,
    error: task.error,
    selection_mode: task.selection_mode || "classic",
    requested_base_model_id: task.requested_base_model_id || "",
    resolved_base_model_id: task.resolved_base_model_id || "",
    actual_model_id: task.actual_model_id || "",
  };
}

async function createTask(req, res) {
  const body = await readJsonBody(req);
  const message = normalizeOptionalString(body.message);
  if (!message) {
    jsonResponse(res, 400, { error: "message is required" });
    return;
  }
  let attachmentInfo;
  try {
    attachmentInfo = normalizeNativeAttachments(body);
  } catch (err) {
    if (err instanceof BridgeTaskError) {
      jsonResponse(res, err.statusCode || 400, { error: err.code, message: err.message });
      return;
    }
    throw err;
  }
  const providedIdempotencyKey = normalizeOptionalString(body.idempotency_key);
  if (attachmentInfo.attachments.length > 0 && providedIdempotencyKey) {
    const existingTask = store.getByIdempotencyKey(providedIdempotencyKey);
    if (existingTask) {
      jsonResponse(res, existingTask.status === "completed" ? 200 : 202, {
        ...taskStatus(existingTask),
        session_key: existingTask.session_key,
        session_id: existingTask.session_id,
        agent_id: existingTask.agent_id,
        deduplicated: true,
      });
      return;
    }
  }
  const taskId = randomUUID();
  const selectionMode = body.selection_mode === "openclaw-agent" ? "openclaw-agent" : "classic";
  const requestedBaseModelId = selectionMode === "openclaw-agent"
    ? normalizeOptionalString(body.base_model_id) || ""
    : "";
  const codexControls = normalizeCodexRunControls(body.codex_controls);
  const agentsList = await bridge.request("agents.list", {});
  let agentId = pickAgentId(agentsList, normalizeOptionalString(body.agent_id));
  const conversationId = normalizeOptionalString(body.conversation_id) || taskId;
  const idempotencyKey = providedIdempotencyKey || taskId;
  let resolvedBaseModelId = "";
  let parentSessionKey = "";
  let sessionCreateParams = null;
  let sessionKey;
  let sessionId;
  if (selectionMode === "openclaw-agent") {
    const catalog = await readGatewayCatalog(false);
    const selection = resolveCatalogSelection(catalog, agentId, requestedBaseModelId);
    if (!selection.ok) {
      jsonResponse(res, selection.statusCode || 400, { error: selection.error });
      return;
    }
    agentId = selection.agentId;
    resolvedBaseModelId = selection.resolvedBaseModelId;
    parentSessionKey = store.getPreviousTurn(conversationId, agentId)?.session_key || "";
    sessionCreateParams = buildTurnSessionCreateParams({
      agentId,
      conversationId,
      modelId: resolvedBaseModelId,
      parentSessionKey,
      idempotencyKey,
    });
    sessionKey = sessionCreateParams.key;
    sessionId = null;
  } else {
    const defaultSessionKey = attachmentInfo.attachments.length > 0
      ? `agent:${agentId}:${conversationId}`
      : `agent:${agentId}:bridge:${conversationId}`;
    sessionKey = normalizeOptionalString(body.session_key) || defaultSessionKey;
    sessionId = normalizeOptionalString(body.session_id);
  }
  const createdAt = nowIso();
  store.create({
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

  store.markSubmitting(taskId);
  try {
    if (sessionCreateParams) {
      const created = await bridge.request("sessions.create", sessionCreateParams, { timeoutMs: 30000 });
      sessionKey = normalizeOptionalString(created?.key) || sessionKey;
      sessionId = normalizeOptionalString(created?.entry?.sessionId || created?.sessionId);
    }
    const gatewayMessage = applyCodexRunControlsToMessage(message, resolvedBaseModelId, codexControls);
    const request = buildGatewayChatSendRequest({
      sessionKey,
      agentId,
      sessionId,
      message: gatewayMessage,
      idempotencyKey,
      timeoutMs: body.timeoutMs,
      attachments: attachmentInfo.attachments,
    });
    assertGatewayFrameWithinLimit(request);
    const response = await bridge.request("chat.send", request, { timeoutMs: 20000 });
    const runId = normalizeOptionalString(response?.runId) || idempotencyKey;
    store.markRunning(taskId, runId, sessionKey, sessionId);
    // ── callback: bridge.started ──
    const startedTask = store.get(taskId);
    emitCallback("bridge.started", startedTask, startedContent(message, agentId), {
      task_id: taskId,
      run_id: runId,
      ...attachmentInfo.summary,
    });
    jsonResponse(res, 202, {
      task_id: taskId,
      run_id: runId,
      status: "running",
      session_key: sessionKey,
      session_id: sessionId,
      agent_id: agentId,
      selection_mode: selectionMode,
      requested_base_model_id: requestedBaseModelId,
      resolved_base_model_id: resolvedBaseModelId,
      codex_controls: codexControls || undefined,
      parent_session_key: parentSessionKey,
      chat_send: response,
    });
  } catch (err) {
    if (sessionCreateParams && sessionKey) {
      await bridge.request("sessions.delete", { key: sessionKey, agentId }, { timeoutMs: 10000 }).catch(() => {});
    }
    if (err instanceof BridgeTaskError) {
      store.fail(taskId, err.message);
      const failedTask = store.get(taskId);
      emitCallback("bridge.error", failedTask, errorContent(err.message), {
        reason: err.code,
        task_id: taskId,
        ...attachmentInfo.summary,
      });
      jsonResponse(res, err.statusCode || 413, { task_id: taskId, status: "failed", error: err.code, message: err.message });
      return;
    }
    const rawMessage = err instanceof Error ? err.message : String(err);
    const errorCode = /payload|too large|frame/i.test(rawMessage)
      ? "gateway_payload_too_large"
      : attachmentInfo.attachments.length > 0 ? "gateway_attachment_rejected" : "gateway_request_failed";
    const message = attachmentInfo.attachments.length > 0
      ? errorCode === "gateway_payload_too_large"
        ? "Gateway payload too large"
        : "Gateway rejected native attachment payload"
      : rawMessage;
    store.fail(taskId, message);
    // ── callback: bridge.error ──
    const failedTask = store.get(taskId);
    emitCallback("bridge.error", failedTask, errorContent(message), {
      reason: errorCode,
      task_id: taskId,
      ...attachmentInfo.summary,
    });
    jsonResponse(res, 502, { task_id: taskId, status: "failed", error: errorCode, message });
  }
}

async function cancelTask(task, res) {
  if (task.status === "completed") {
    jsonResponse(res, 200, taskStatus(task));
    return;
  }
  if (!task.run_id) {
    store.cancel(task.task_id, "canceled before run_id");
    jsonResponse(res, 200, taskStatus(store.get(task.task_id)));
    return;
  }
  try {
    await bridge.request(
      "chat.abort",
      {
        sessionKey: task.session_key,
        agentId: task.agent_id,
        runId: task.run_id,
      },
      { timeoutMs: 10000 },
    );
    const current = store.get(task.task_id);
    if (current?.status !== "completed") store.cancel(task.task_id, "cancel requested");
    jsonResponse(res, 200, taskStatus(store.get(task.task_id)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = store.get(task.task_id);
    if (current?.status !== "completed") store.fail(task.task_id, message);
    jsonResponse(res, 502, taskStatus(store.get(task.task_id)));
  }
}

/**
 * GET /v1/openclaw/tasks/:id/result
 *
 * Returns a standardised response with the last valid assistant message
 * as `final_answer` (and `result` for backward compatibility).
 */
async function taskResult(task, res) {
  if (task.status !== "completed") {
    jsonResponse(res, 409, {
      task_id: task.task_id,
      run_id: task.run_id,
      status: task.status,
      partial_text: task.partial_text || "",
      error: task.error,
      selection_mode: task.selection_mode || "classic",
      requested_base_model_id: task.requested_base_model_id || "",
      resolved_base_model_id: task.resolved_base_model_id || "",
      actual_model_id: task.actual_model_id || "",
    });
    return;
  }

  const stored = task.result_json ? JSON.parse(task.result_json) : null;

  // ── Determine final_answer ──
  let finalAnswer = stored?.final_answer || stored?.text || messageText(stored?.message) || "";

  // ── Collect messages ──
  let messages = [];
  if (Array.isArray(stored?.messages)) {
    messages = stored.messages;
  } else if (task.session_key) {
    // Messages not in stored result — try fetching live
    try {
      const history = await bridge.request(
        "chat.history",
        {
          sessionKey: task.session_key,
          agentId: task.agent_id,
          limit: RECOVERY_HISTORY_LIMIT,
        },
        { timeoutMs: 15000 },
      );
      messages = extractHistoryMessages(history);
      // Re-run selection if we still don't have a final answer
      if (!finalAnswer) {
        const recovered = findRecoveredAssistantMessage(history, task);
        finalAnswer = recovered.text;
      }
    } catch {
      // messages remain empty
    }
  }

  // ── Events (placeholder — no events table yet) ──
  const events = [];

  // ── Metadata ──
  const metadata = {
    final_answer_source:
      stored?.metadata?.final_answer_source ||
      stored?.source ||
      (stored?.match ? "history_recovery" : "unknown"),
    selected_message_index:
      stored?.metadata?.selected_message_index ?? stored?.selectedMessageIndex ?? 0,
    message_count: messages.length,
    event_count: events.length,
  };

  jsonResponse(res, 200, {
    task_id: task.task_id,
    run_id: task.run_id,
    status: task.status,
    // ── new standardised fields ──
    final_answer: finalAnswer,
    result: finalAnswer, // result === final_answer (backward compat for new clients)
    messages,
    events,
    metadata,
    selection_mode: task.selection_mode || "classic",
    requested_base_model_id: task.requested_base_model_id || "",
    resolved_base_model_id: task.resolved_base_model_id || "",
    actual_model_id: task.actual_model_id || executionModelFromMessages(messages, task.resolved_base_model_id),
    // ── legacy field ──
    text: finalAnswer,
  });
}

async function health(res) {
  let dbOk = false;
  let gatewayConnected = false;
  let gatewayError = null;
  try {
    dbOk = store.dbOk();
  } catch (err) {
    gatewayError = err instanceof Error ? err.message : String(err);
  }
  try {
    await bridge.start();
    gatewayConnected = bridge.connected;
  } catch (err) {
    gatewayError = err instanceof Error ? err.message : String(err);
  }
  jsonResponse(res, dbOk ? 200 : 500, {
    ok: dbOk && gatewayConnected,
    gateway_connected: gatewayConnected,
    db_ok: dbOk,
    running_tasks: store.countStatus("running"),
    recovering_tasks: store.countStatus("recovering"),
    completed_tasks_recent: store.completedRecent(),
    version: VERSION,
    imports: bridge.imports,
    startup_recovering_count: startupRecoveringCount,
    last_recovery_at: bridge.lastRecoveryAt,
    last_recovery_error: bridge.lastRecoveryError,
    ...(gatewayError ? { gateway_error: gatewayError } : {}),
    ...(callbackClient ? { callback: callbackClient.stats() } : {}),
  });
}

async function catalog(req, res, url) {
  const refresh = url.searchParams.get("refresh") === "1";
  const value = await readGatewayCatalog(refresh);
  jsonResponse(res, 200, value);
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    await health(res);
    return;
  }
  if (!requireAuth(req, res)) return;

  if (req.method === "GET" && url.pathname === "/v1/openclaw/catalog") {
    await catalog(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/openclaw/tasks") {
    await createTask(req, res);
    return;
  }

  const match = url.pathname.match(/^\/v1\/openclaw\/tasks\/([^/]+)\/(status|result|cancel)$/);
  if (!match) {
    jsonResponse(res, 404, { error: "not found" });
    return;
  }
  const [, taskId, action] = match;
  const task = store.get(taskId);
  if (!task) {
    jsonResponse(res, 404, { error: "task not found", task_id: taskId });
    return;
  }
  if (req.method === "GET" && action === "status") {
    jsonResponse(res, 200, taskStatus(task));
    return;
  }
  if (req.method === "GET" && action === "result") {
    await taskResult(task, res);
    return;
  }
  if (req.method === "POST" && action === "cancel") {
    await cancelTask(task, res);
    return;
  }
  jsonResponse(res, 405, { error: "method not allowed" });
}

/* ── HTTP server ── */

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    jsonResponse(res, statusCode, { error: err instanceof Error ? err.message : String(err) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`openclaw-bridge ${VERSION} listening on http://${HOST}:${PORT}`);
  bridge.start().catch((err) => {
    bridge.lastRecoveryError = err instanceof Error ? err.message : String(err);
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await bridge.stop().catch(() => {});
    db.close();
    process.exit(0);
  });
}
