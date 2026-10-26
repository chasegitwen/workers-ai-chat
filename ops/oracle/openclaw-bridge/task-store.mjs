import { DatabaseSync } from "node:sqlite";
import { messageText } from "./lib.mjs";

function nowIso() {
  return new Date().toISOString();
}

const ACTIVE_STATUSES = "('created', 'submitting', 'running', 'recovering', 'canceling')";
const CALLBACK_DUE_STATUSES = "('pending', 'retrying')";
const CALLBACK_ORDER_BLOCKING_STATUSES = "('pending', 'retrying', 'sending')";
const CALLBACK_TERMINAL_EVENTS = new Set(["bridge.final", "bridge.error"]);

// PRAGMA user_version history:
//   0 = v1.2.0 and the unreleased v1.2.1 development outbox (no version recorded)
//   3 = v1.3.0 callback outbox with sending leases and dispatch_attempts
export const TASK_DB_SCHEMA_VERSION = 3;
// Hard ceiling for automatic dispatches of one event per delivery cycle.
export const CALLBACK_MAX_DISPATCH_ATTEMPTS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
// Every outbox row has a bounded lifetime: open rows expire to dead_letter
// (still requeueable) and finished rows are deleted after their retention.
// maxFinishedRows caps finished rows in between; open rows are never deleted.
export const DEFAULT_CALLBACK_OUTBOX_POLICY = Object.freeze({
  pendingMaxAgeMs: 7 * DAY_MS,
  deliveredRetentionMs: 7 * DAY_MS,
  deadLetterRetentionMs: 30 * DAY_MS,
  maxFinishedRows: 20_000,
});

export function resolveCallbackOutboxPolicy(overrides = {}) {
  const policy = { ...DEFAULT_CALLBACK_OUTBOX_POLICY };
  for (const key of Object.keys(policy)) {
    const value = Math.floor(Number(overrides?.[key]));
    if (Number.isFinite(value) && value > 0) policy[key] = value;
  }
  return policy;
}

const TASK_COLUMNS = [
  ["selection_mode", "TEXT NOT NULL DEFAULT 'classic'"],
  ["requested_base_model_id", "TEXT"],
  ["resolved_base_model_id", "TEXT"],
  ["actual_model_id", "TEXT"],
  ["parent_session_key", "TEXT"],
  ["callback_sequence", "INTEGER NOT NULL DEFAULT 0"],
  ["submission_phase", "TEXT NOT NULL DEFAULT 'prepared'"],
  ["session_create_params_json", "TEXT"],
  ["chat_send_params_json", "TEXT"],
  ["session_create_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["chat_send_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["cancel_requested", "INTEGER NOT NULL DEFAULT 0"],
  ["recovery_deadline_at", "TEXT"],
];

const CALLBACK_OUTBOX_COLUMNS = [
  ["status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["priority", "INTEGER NOT NULL DEFAULT 0"],
  ["attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["dispatch_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["lease_until", "TEXT"],
  ["next_retry_at", "TEXT"],
  ["last_attempt_at", "TEXT"],
  ["delivered_at", "TEXT"],
  ["acknowledged_at", "TEXT"],
  ["last_http_status", "INTEGER"],
  ["last_error", "TEXT"],
  ["superseded_by", "TEXT"],
];

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function addMissingColumns(db, table, columns) {
  const existing = tableColumns(db, table);
  for (const [name, definition] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

export function callbackPriority(eventType) {
  if (CALLBACK_TERMINAL_EVENTS.has(eventType)) return 100;
  if (eventType === "bridge.started") return 50;
  return 0;
}

export function clampCallbackAttempts(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return CALLBACK_MAX_DISPATCH_ATTEMPTS;
  return Math.min(CALLBACK_MAX_DISPATCH_ATTEMPTS, parsed);
}

export function migrateTaskDatabase(db) {
  const current = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (current > TASK_DB_SCHEMA_VERSION) {
    throw new Error(`task database schema ${current} is newer than supported ${TASK_DB_SCHEMA_VERSION}`);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
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
    addMissingColumns(db, "tasks", TASK_COLUMNS);
    db.exec(`
      CREATE TABLE IF NOT EXISTS callback_outbox (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
        UNIQUE (task_id, sequence)
      )
    `);
    const outboxColumnsBefore = tableColumns(db, "callback_outbox");
    addMissingColumns(db, "callback_outbox", CALLBACK_OUTBOX_COLUMNS);
    if (current < 3 && outboxColumnsBefore.has("cycle_attempts") && !outboxColumnsBefore.has("dispatch_attempts")) {
      // v1.2.1 development rows counted claims per cycle in cycle_attempts.
      db.exec("UPDATE callback_outbox SET dispatch_attempts = cycle_attempts");
    }
    if (current < 3) {
      db.exec("UPDATE callback_outbox SET status = 'dead_letter', next_retry_at = NULL WHERE status = 'blocked'");
      db.exec(`
        UPDATE callback_outbox SET priority = CASE
          WHEN event_type IN ('bridge.final', 'bridge.error') THEN 100
          WHEN event_type = 'bridge.started' THEN 50
          ELSE 0 END
      `);
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_session_key ON tasks(session_key)");
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_unique
      ON tasks(idempotency_key)
      WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_callback_outbox_due
      ON callback_outbox(status, next_retry_at, created_at)
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_callback_outbox_lease ON callback_outbox(status, lease_until)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_callback_outbox_task_sequence ON callback_outbox(task_id, sequence)");
    db.exec(`PRAGMA user_version = ${TASK_DB_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function openTaskDatabase(filename) {
  const db = new DatabaseSync(filename);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    migrateTaskDatabase(db);
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
  return db;
}

export class TaskStore {
  constructor(db) {
    this.db = db;
    this.insertTask = db.prepare(`
      INSERT INTO tasks (
        task_id, conversation_id, session_key, session_id, agent_id, run_id,
        idempotency_key, status, message, partial_text, result_json, error,
        created_at, updated_at, completed_at, selection_mode,
        requested_base_model_id, resolved_base_model_id, actual_model_id,
        parent_session_key, callback_sequence, submission_phase,
        session_create_params_json, chat_send_params_json,
        session_create_attempts, chat_send_attempts, cancel_requested,
        recovery_deadline_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare("SELECT * FROM tasks WHERE task_id = ?");
    this.getByRunIdStmt = db.prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at DESC LIMIT 1");
    this.getByIdempotencyKeyStmt = db.prepare("SELECT * FROM tasks WHERE idempotency_key = ? ORDER BY created_at ASC LIMIT 1");
    this.getActiveBySessionKeyStmt = db.prepare(`
      SELECT * FROM tasks WHERE session_key = ? AND status IN ${ACTIVE_STATUSES}
      ORDER BY created_at DESC LIMIT 1
    `);
    this.getPreviousTurnStmt = db.prepare(`
      SELECT * FROM tasks
      WHERE conversation_id = ? AND agent_id = ? AND selection_mode = 'openclaw-agent'
        AND status = 'completed' AND session_key IS NOT NULL
      ORDER BY completed_at DESC, created_at DESC LIMIT 1
    `);
    this.markSubmittingStmt = db.prepare("UPDATE tasks SET status = 'submitting', updated_at = ? WHERE task_id = ? AND status = 'created'");
    this.setSubmissionPlanStmt = db.prepare(`
      UPDATE tasks SET session_create_params_json = ?, chat_send_params_json = ?,
        submission_phase = ?, recovery_deadline_at = ?, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 0
    `);
    this.sessionCreateAttemptStmt = db.prepare(`
      UPDATE tasks SET submission_phase = 'session_create_dispatched',
        session_create_attempts = session_create_attempts + 1, status = 'submitting', updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 0
    `);
    this.sessionReadyStmt = db.prepare(`
      UPDATE tasks SET session_key = ?, session_id = ?, chat_send_params_json = ?,
        submission_phase = 'session_ready', status = 'submitting', error = NULL, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.chatSendDispatchingStmt = db.prepare(`
      UPDATE tasks SET submission_phase = 'chat_send_dispatching', run_id = ?,
        chat_send_attempts = chat_send_attempts + 1, status = 'submitting', updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 0
        AND submission_phase = 'session_ready'
    `);
    this.chatSendDispatchedStmt = db.prepare(`
      UPDATE tasks SET submission_phase = 'chat_send_dispatched', run_id = ?,
        status = CASE WHEN cancel_requested = 1 THEN 'canceling' ELSE 'running' END, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
        AND submission_phase IN ('chat_send_dispatching', 'chat_send_dispatched')
    `);
    this.requestCancelStmt = db.prepare(`
      UPDATE tasks SET cancel_requested = 1, status = 'canceling',
        error = 'cancel requested', updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.cancelBeforeSendStmt = db.prepare(`
      UPDATE tasks SET status = 'canceled', submission_phase = 'terminal', error = ?,
        updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 1
        AND submission_phase IN ('prepared', 'session_create_dispatched', 'session_ready')
    `);
    this.cancelBeforeChatDispatchStmt = db.prepare(`
      UPDATE tasks SET status = 'canceled', submission_phase = 'terminal', error = ?,
        updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 1
        AND submission_phase = 'chat_send_dispatching'
    `);
    this.bindSessionStmt = db.prepare(`
      UPDATE tasks SET session_key = ?, session_id = ?, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.bindRunStmt = db.prepare(`
      UPDATE tasks SET status = CASE WHEN cancel_requested = 1 THEN 'canceling' ELSE 'running' END,
        submission_phase = 'run_known', run_id = ?, session_key = ?, session_id = ?, error = NULL, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.updatePartialStmt = db.prepare(`
      UPDATE tasks SET partial_text = ?, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 0
    `);
    this.completeStmt = db.prepare(`
      UPDATE tasks
      SET status = 'completed', result_json = ?, partial_text = ?,
          actual_model_id = COALESCE(NULLIF(?, ''), actual_model_id), error = NULL,
          updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES} AND cancel_requested = 0
    `);
    this.failStmt = db.prepare(`
      UPDATE tasks SET status = 'failed', submission_phase = 'terminal', error = ?, updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.cancelStmt = db.prepare(`
      UPDATE tasks SET status = 'canceled', submission_phase = 'terminal', error = ?, updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.recoveringStmt = db.prepare(`
      UPDATE tasks SET status = CASE WHEN cancel_requested = 1 THEN 'canceling' ELSE 'recovering' END,
        error = ?, updated_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.indeterminateStmt = db.prepare(`
      UPDATE tasks SET status = 'indeterminate', submission_phase = 'terminal', error = ?,
        updated_at = ?, completed_at = ?
      WHERE task_id = ? AND status IN ${ACTIVE_STATUSES}
    `);
    this.startupRecoveringStmt = db.prepare(`
      UPDATE tasks SET status = CASE WHEN cancel_requested = 1 THEN 'canceling' ELSE 'recovering' END, updated_at = ?
      WHERE status IN ${ACTIVE_STATUSES}
    `);
    this.runningRecoveringStmt = db.prepare("UPDATE tasks SET status = 'recovering', updated_at = ? WHERE status = 'running'");
    this.touchRecoverableStmt = db.prepare("UPDATE tasks SET updated_at = ? WHERE task_id = ? AND status IN ('running', 'recovering', 'canceling', 'submitting')");
    this.listRecoverableStmt = db.prepare(`
      SELECT * FROM tasks WHERE status IN ('submitting', 'running', 'recovering', 'canceling')
      ORDER BY updated_at ASC LIMIT ?
    `);
    this.nextCallbackSequenceStmt = db.prepare(`
      UPDATE tasks SET callback_sequence = callback_sequence + 1
      WHERE task_id = ? RETURNING callback_sequence
    `);
    this.insertCallbackOutboxStmt = db.prepare(`
      INSERT INTO callback_outbox (
        event_id, task_id, sequence, event_type, payload_json, status, priority,
        attempts, dispatch_attempts, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, 0, ?, ?, ?)
    `);
    this.supersedeActivityStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'superseded', superseded_by = ?, next_retry_at = NULL, updated_at = ?
      WHERE task_id = ? AND event_type = 'bridge.activity'
        AND status IN ${CALLBACK_DUE_STATUSES} AND sequence < ?
    `);
    this.getCallbackOutboxStmt = db.prepare("SELECT * FROM callback_outbox WHERE event_id = ?");
    // Per-task order: an event is eligible only when no lower sequence of the
    // same task is still pending, retrying or sending. Dead-lettered,
    // superseded and delivered predecessors never block, so the wait is bounded
    // by the predecessor's own dispatch budget. Across tasks, terminal events
    // are dispatched before progress events.
    const notBlockedByPredecessor = `
      NOT EXISTS (
        SELECT 1 FROM callback_outbox p
        WHERE p.task_id = o.task_id AND p.sequence < o.sequence
          AND p.status IN ${CALLBACK_ORDER_BLOCKING_STATUSES}
      )
    `;
    this.nextDueCallbackStmt = db.prepare(`
      SELECT o.* FROM callback_outbox o
      WHERE o.status IN ${CALLBACK_DUE_STATUSES}
        AND o.next_retry_at IS NOT NULL AND o.next_retry_at <= ?
        AND o.dispatch_attempts < ?
        AND ${notBlockedByPredecessor}
      ORDER BY o.priority DESC, o.next_retry_at ASC, o.created_at ASC, o.sequence ASC
      LIMIT 1
    `);
    this.nextCallbackWakeupStmt = db.prepare(`
      SELECT MIN(wake_at) AS wake_at FROM (
        SELECT o.next_retry_at AS wake_at FROM callback_outbox o
        WHERE o.status IN ${CALLBACK_DUE_STATUSES} AND o.next_retry_at IS NOT NULL
          AND ${notBlockedByPredecessor}
        UNION ALL
        SELECT lease_until AS wake_at FROM callback_outbox
        WHERE status = 'sending' AND lease_until IS NOT NULL
      )
    `);
    this.exhaustExpiredLeaseStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'dead_letter', lease_until = NULL, next_retry_at = NULL,
        last_error = ?, updated_at = ?
      WHERE status = 'sending' AND lease_until <= ? AND dispatch_attempts >= ?
    `);
    this.releaseExpiredLeaseStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'retrying', lease_until = NULL, next_retry_at = ?,
        last_error = ?, updated_at = ?
      WHERE status = 'sending' AND lease_until <= ?
    `);
    this.exhaustOpenStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'dead_letter', next_retry_at = NULL,
        last_error = COALESCE(last_error, 'dispatch attempt limit reached'), updated_at = ?
      WHERE status IN ${CALLBACK_DUE_STATUSES} AND dispatch_attempts >= ?
    `);
    this.claimCallbackStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'sending', lease_until = ?, attempts = attempts + 1,
        dispatch_attempts = dispatch_attempts + 1, last_attempt_at = ?, updated_at = ?
      WHERE event_id = ? AND status IN ${CALLBACK_DUE_STATUSES}
      RETURNING *
    `);
    // Completion updates are fenced by the claimed dispatch_attempts value so a
    // stale dispatcher cannot overwrite a newer claim of the same event.
    this.retryCallbackStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'retrying', lease_until = NULL, next_retry_at = ?, last_http_status = ?,
        last_error = ?, updated_at = ?
      WHERE event_id = ? AND status = 'sending' AND dispatch_attempts = ?
    `);
    this.deadLetterCallbackStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'dead_letter', lease_until = NULL, next_retry_at = NULL, last_http_status = ?,
        last_error = ?, updated_at = ?
      WHERE event_id = ? AND status = 'sending' AND dispatch_attempts = ?
    `);
    this.deliverCallbackStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'delivered', lease_until = NULL, next_retry_at = NULL, delivered_at = ?,
        acknowledged_at = ?, last_http_status = ?, last_error = NULL, updated_at = ?
      WHERE event_id = ? AND status = 'sending' AND dispatch_attempts = ?
    `);
    this.requeueCallbackStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'pending', dispatch_attempts = 0, lease_until = NULL, next_retry_at = ?,
        last_attempt_at = NULL, delivered_at = NULL, acknowledged_at = NULL,
        last_http_status = NULL, last_error = NULL, updated_at = ?
      WHERE event_id = ? AND status = 'dead_letter'
    `);
    this.expireOpenCallbacksStmt = db.prepare(`
      UPDATE callback_outbox
      SET status = 'dead_letter', next_retry_at = NULL, lease_until = NULL,
        last_error = ?, updated_at = ?
      WHERE status IN ${CALLBACK_DUE_STATUSES} AND created_at < ?
    `);
    this.pruneFinishedCallbacksStmt = db.prepare(`
      DELETE FROM callback_outbox
      WHERE status IN ('delivered', 'superseded') AND updated_at < ?
    `);
    this.pruneDeadLetterCallbacksStmt = db.prepare(`
      DELETE FROM callback_outbox
      WHERE status = 'dead_letter' AND updated_at < ?
    `);
    this.countFinishedCallbacksStmt = db.prepare(`
      SELECT COUNT(*) AS count FROM callback_outbox
      WHERE status IN ('delivered', 'superseded', 'dead_letter')
    `);
    // Over the cap, delete delivered/superseded before dead_letter, oldest first.
    this.trimFinishedCallbacksStmt = db.prepare(`
      DELETE FROM callback_outbox WHERE event_id IN (
        SELECT event_id FROM callback_outbox
        WHERE status IN ('delivered', 'superseded', 'dead_letter')
        ORDER BY CASE status WHEN 'dead_letter' THEN 1 ELSE 0 END, updated_at ASC
        LIMIT ?
      )
    `);
    this.countCallbackRowsStmt = db.prepare("SELECT COUNT(*) AS count FROM callback_outbox");
    this.countCallbackStatusStmt = db.prepare("SELECT COUNT(*) AS count FROM callback_outbox WHERE status = ?");
    this.countByStatusStmt = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = ?");
    this.completedRecentStmt = db.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE status = 'completed' AND completed_at IS NOT NULL
        AND completed_at >= datetime('now', '-1 hour')
    `);
    this.dbOkStmt = db.prepare("SELECT 1 AS ok");
  }

  createOrGet(task) {
    try {
      this.insertTask.run(
        task.task_id, task.conversation_id, task.session_key, task.session_id,
        task.agent_id, task.run_id, task.idempotency_key, task.status,
        task.message, task.partial_text, task.result_json, task.error,
        task.created_at, task.updated_at, task.completed_at,
        task.selection_mode || "classic", task.requested_base_model_id,
        task.resolved_base_model_id, task.actual_model_id,
        task.parent_session_key, task.callback_sequence || 0,
        task.submission_phase || "prepared",
        task.session_create_params_json || null,
        task.chat_send_params_json || null,
        task.session_create_attempts || 0,
        task.chat_send_attempts || 0,
        task.cancel_requested ? 1 : 0,
        task.recovery_deadline_at || null,
      );
      return { created: true, task: this.get(task.task_id) };
    } catch (error) {
      if (!/unique constraint/i.test(String(error?.message || error))) throw error;
      const existing = this.getByIdempotencyKey(task.idempotency_key);
      if (!existing) throw error;
      return { created: false, task: existing };
    }
  }

  get(taskId) { return this.getByIdStmt.get(taskId) || null; }
  getByRunId(runId) { return runId ? this.getByRunIdStmt.get(runId) || null : null; }
  getByIdempotencyKey(key) { return key ? this.getByIdempotencyKeyStmt.get(key) || null : null; }
  getActiveBySessionKey(key) { return key ? this.getActiveBySessionKeyStmt.get(key) || null : null; }
  getPreviousTurn(conversationId, agentId) { return this.getPreviousTurnStmt.get(conversationId, agentId) || null; }
  markSubmitting(taskId) { return (this.markSubmittingStmt.run(nowIso(), taskId).changes ?? 0) === 1; }
  setSubmissionPlan(taskId, { sessionCreateParams = null, chatSendParams, recoveryDeadlineAt }) {
    const phase = sessionCreateParams ? "prepared" : "session_ready";
    return (this.setSubmissionPlanStmt.run(
      sessionCreateParams ? JSON.stringify(sessionCreateParams) : null,
      JSON.stringify(chatSendParams), phase, recoveryDeadlineAt, nowIso(), taskId,
    ).changes ?? 0) === 1;
  }
  markSessionCreateAttempt(taskId) { return (this.sessionCreateAttemptStmt.run(nowIso(), taskId).changes ?? 0) === 1; }
  markSessionReady(taskId, sessionKey, sessionId, chatSendParams) {
    return (this.sessionReadyStmt.run(sessionKey, sessionId, JSON.stringify(chatSendParams), nowIso(), taskId).changes ?? 0) === 1;
  }
  markChatSendDispatching(taskId, runId) { return (this.chatSendDispatchingStmt.run(runId, nowIso(), taskId).changes ?? 0) === 1; }
  markChatSendDispatched(taskId, runId) { return (this.chatSendDispatchedStmt.run(runId, nowIso(), taskId).changes ?? 0) === 1; }
  requestCancel(taskId) { return (this.requestCancelStmt.run(nowIso(), taskId).changes ?? 0) === 1; }
  cancelBeforeSend(taskId, reason = "canceled before chat.send") {
    const ts = nowIso();
    return (this.cancelBeforeSendStmt.run(reason, ts, ts, taskId).changes ?? 0) === 1;
  }
  cancelBeforeChatDispatch(taskId, reason = "canceled before chat.send dispatch") {
    const ts = nowIso();
    return (this.cancelBeforeChatDispatchStmt.run(reason, ts, ts, taskId).changes ?? 0) === 1;
  }
  bindSession(taskId, sessionKey, sessionId) { return (this.bindSessionStmt.run(sessionKey, sessionId, nowIso(), taskId).changes ?? 0) === 1; }
  bindRun(taskId, runId, sessionKey, sessionId) { return (this.bindRunStmt.run(runId, sessionKey, sessionId, nowIso(), taskId).changes ?? 0) === 1; }
  updatePartial(taskId, text) { return (this.updatePartialStmt.run(text, nowIso(), taskId).changes ?? 0) === 1; }

  complete(taskId, result, partialText, actualModelId = "") {
    const finalText = partialText || result?.final_answer || result?.text || messageText(result?.message);
    if (typeof finalText !== "string" || !finalText.trim()) return false;
    const ts = nowIso();
    return (this.completeStmt.run(
      JSON.stringify(result), finalText,
      actualModelId, ts, ts, taskId,
    ).changes ?? 0) === 1;
  }

  fail(taskId, error) {
    const ts = nowIso();
    return (this.failStmt.run(error, ts, ts, taskId).changes ?? 0) === 1;
  }

  markIndeterminate(taskId, error) {
    const ts = nowIso();
    return (this.indeterminateStmt.run(error, ts, ts, taskId).changes ?? 0) === 1;
  }

  cancel(taskId, reason = "canceled") {
    const ts = nowIso();
    return (this.cancelStmt.run(reason, ts, ts, taskId).changes ?? 0) === 1;
  }

  markRecovering(taskId, reason = "recovery pending") {
    return (this.recoveringStmt.run(reason, nowIso(), taskId).changes ?? 0) === 1;
  }

  markStartupRecovering() { return this.startupRecoveringStmt.run(nowIso()).changes ?? 0; }
  markRunningRecovering() { return this.runningRecoveringStmt.run(nowIso()).changes ?? 0; }
  touchRecoverable(taskId) { return (this.touchRecoverableStmt.run(nowIso(), taskId).changes ?? 0) === 1; }
  listRecoverable(limit = 50) { return this.listRecoverableStmt.all(limit); }
  nextCallbackSequence(taskId) { return this.nextCallbackSequenceStmt.get(taskId)?.callback_sequence ?? null; }
  enqueueCallback(taskId, payloadFactory) {
    return this.transitionWithCallback(taskId, () => true, payloadFactory);
  }

  transitionWithCallback(taskId, transition, payloadFactory) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const transitioned = transition();
      if (!transitioned) {
        this.db.exec("ROLLBACK");
        return { transitioned: false, task: this.get(taskId), payload: null };
      }
      const sequence = this.nextCallbackSequenceStmt.get(taskId)?.callback_sequence ?? null;
      const task = this.get(taskId);
      if (!task || !sequence) throw new Error("callback task or sequence is unavailable");
      const payload = payloadFactory(task, sequence);
      const eventId = String(payload?.event_id || "").trim();
      const eventType = String(payload?.event_type || "").trim();
      if (!eventId || !eventType || Number(payload?.sequence) !== sequence) {
        throw new Error("invalid callback payload for outbox");
      }
      const ts = nowIso();
      this.insertCallbackOutboxStmt.run(
        eventId,
        taskId,
        sequence,
        eventType,
        JSON.stringify(payload),
        callbackPriority(eventType),
        ts,
        ts,
        ts,
      );
      // Undelivered progress snapshots are obsolete once a newer snapshot or a
      // terminal event exists for the task. They are retained as `superseded`
      // for audit instead of being deleted or sent.
      if (eventType === "bridge.activity" || CALLBACK_TERMINAL_EVENTS.has(eventType)) {
        this.supersedeActivityStmt.run(eventId, ts, taskId, sequence);
      }
      this.db.exec("COMMIT");
      return { transitioned: true, task, payload, outbox: this.getCallback(eventId) };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  getCallback(eventId) { return this.getCallbackOutboxStmt.get(eventId) || null; }

  /** Earliest time at which the dispatcher has work: a due eligible event or an expiring lease. */
  nextCallbackWakeup() { return this.nextCallbackWakeupStmt.get()?.wake_at || null; }

  /**
   * Atomically recover expired leases and claim the next eligible event.
   *
   * A claimed event moves to `sending` with a lease. `dispatch_attempts` is
   * incremented before the network request, so it counts attempts that may
   * have reached the receiver; a crash cannot prove whether the receiver got
   * the request. Once `dispatch_attempts` reaches the cap, an expired lease
   * moves the event to `dead_letter` instead of dispatching it again.
   */
  claimNextCallback({ at = nowIso(), maxAttempts = CALLBACK_MAX_DISPATCH_ATTEMPTS, leaseMs = 30_000 } = {}) {
    const max = clampCallbackAttempts(maxAttempts);
    const leaseUntil = new Date(Date.parse(at) + Math.max(1_000, Number(leaseMs) || 30_000)).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.exhaustExpiredLeaseStmt.run(
        "dispatch lease expired after the final allowed attempt; receiver outcome unknown",
        at, at, max,
      );
      this.releaseExpiredLeaseStmt.run(
        at, "dispatch lease expired; receiver outcome unknown", at, at,
      );
      this.exhaustOpenStmt.run(at, max);
      const due = this.nextDueCallbackStmt.get(at, max);
      const claimed = due ? this.claimCallbackStmt.get(leaseUntil, at, at, due.event_id) || null : null;
      this.db.exec("COMMIT");
      return claimed;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  scheduleCallbackRetry(eventId, dispatchAttempt, nextRetryAt, error, httpStatus = null) {
    return (this.retryCallbackStmt.run(
      nextRetryAt,
      Number.isInteger(httpStatus) ? httpStatus : null,
      String(error || "callback delivery failed").slice(0, 1000),
      nowIso(),
      eventId,
      dispatchAttempt,
    ).changes ?? 0) === 1;
  }
  markCallbackDeadLetter(eventId, dispatchAttempt, error, httpStatus = null) {
    return (this.deadLetterCallbackStmt.run(
      Number.isInteger(httpStatus) ? httpStatus : null,
      String(error || "callback delivery failed").slice(0, 1000),
      nowIso(),
      eventId,
      dispatchAttempt,
    ).changes ?? 0) === 1;
  }
  markCallbackDelivered(eventId, dispatchAttempt, httpStatus) {
    const ts = nowIso();
    return (this.deliverCallbackStmt.run(ts, ts, httpStatus, ts, eventId, dispatchAttempt).changes ?? 0) === 1;
  }
  /** Administrator requeue: same event_id and payload, fresh dispatch budget. */
  requeueCallback(eventId) {
    const ts = nowIso();
    return (this.requeueCallbackStmt.run(ts, ts, eventId).changes ?? 0) === 1;
  }
  /** Apply the outbox retention policy in one transaction; returns per-step counts. */
  maintainCallbackOutbox(policyOverrides = {}, now = Date.now()) {
    const policy = resolveCallbackOutboxPolicy(policyOverrides);
    const at = new Date(now).toISOString();
    const before = (ms) => new Date(now - ms).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const expired = this.expireOpenCallbacksStmt.run(
        `expired before delivery after ${policy.pendingMaxAgeMs} ms`,
        at,
        before(policy.pendingMaxAgeMs),
      ).changes ?? 0;
      const prunedFinished = this.pruneFinishedCallbacksStmt.run(before(policy.deliveredRetentionMs)).changes ?? 0;
      const prunedDeadLetter = this.pruneDeadLetterCallbacksStmt.run(before(policy.deadLetterRetentionMs)).changes ?? 0;
      const finished = this.countFinishedCallbacksStmt.get()?.count ?? 0;
      const overCap = Math.max(0, finished - policy.maxFinishedRows);
      const trimmed = overCap > 0 ? this.trimFinishedCallbacksStmt.run(overCap).changes ?? 0 : 0;
      this.db.exec("COMMIT");
      return { expired, prunedFinished, prunedDeadLetter, trimmed };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  countCallbackRows() { return this.countCallbackRowsStmt.get()?.count ?? 0; }
  countCallbackStatus(status) { return this.countCallbackStatusStmt.get(status)?.count ?? 0; }
  countStatus(status) { return this.countByStatusStmt.get(status)?.count ?? 0; }
  completedRecent() { return this.completedRecentStmt.get()?.count ?? 0; }
  dbOk() { return this.dbOkStmt.get()?.ok === 1; }
}
