import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildPayload } from "../callback.mjs";
import { openTaskDatabase, TaskStore, TASK_DB_SCHEMA_VERSION } from "../task-store.mjs";

// Reconstructed v1.2.0 layout: the original tasks table plus the columns that
// v1.2.0 added through ALTER TABLE, with no callback outbox and no
// user_version. No authentic v1.2.0 database file is available locally.
const V120_TASKS = `
  CREATE TABLE tasks (
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
    completed_at TEXT,
    selection_mode TEXT NOT NULL DEFAULT 'classic',
    requested_base_model_id TEXT,
    resolved_base_model_id TEXT,
    actual_model_id TEXT,
    parent_session_key TEXT
  );
  CREATE INDEX idx_tasks_run_id ON tasks(run_id);
  CREATE UNIQUE INDEX idx_tasks_idempotency_unique ON tasks(idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
`;

const V121_DEV_OUTBOX = `
  CREATE TABLE callback_outbox (
    event_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    cycle_attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_attempt_at TEXT,
    delivered_at TEXT,
    acknowledged_at TEXT,
    last_http_status INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (task_id, sequence)
  );
`;

async function legacyDatabase(t, statements) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-migration-"));
  const dbPath = path.join(directory, "state.sqlite");
  const handles = [];
  t.after(async () => {
    for (const handle of handles) { try { handle.close(); } catch {} }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(statements);
  return { dbPath, legacy, track(handle) { handles.push(handle); return handle; } };
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

test("a v1.2.0 database with an active task upgrades in place and reopens idempotently", async (t) => {
  const { dbPath, legacy, track } = await legacyDatabase(t, V120_TASKS);
  const now = new Date().toISOString();
  legacy.prepare(`
    INSERT INTO tasks (task_id, conversation_id, session_key, agent_id, run_id, idempotency_key,
      status, message, partial_text, created_at, updated_at, selection_mode)
    VALUES ('legacy-task', 'conv', 'agent:main:conv', 'main', 'legacy-run', 'legacy-key',
      'running', 'legacy prompt', 'partial', ?, ?, 'classic')
  `).run(now, now);
  legacy.close();

  const db = track(openTaskDatabase(dbPath));
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, TASK_DB_SCHEMA_VERSION);
  for (const name of ["callback_sequence", "submission_phase", "cancel_requested", "recovery_deadline_at"]) {
    assert.ok(columns(db, "tasks").includes(name), name);
  }
  for (const name of ["dispatch_attempts", "lease_until", "priority", "superseded_by", "attempts"]) {
    assert.ok(columns(db, "callback_outbox").includes(name), name);
  }
  const store = new TaskStore(db);
  const task = store.get("legacy-task");
  assert.equal(task.status, "running");
  assert.equal(task.partial_text, "partial");
  assert.equal(task.callback_sequence, 0);
  assert.equal(task.submission_phase, "prepared");

  const event = store.enqueueCallback("legacy-task", (row, sequence) => buildPayload({
    eventType: "bridge.started", taskId: row.task_id, sequence, content: { text: "started" },
  }));
  assert.equal(event.payload.sequence, 1);
  db.close();

  const reopened = track(openTaskDatabase(dbPath));
  assert.equal(reopened.prepare("PRAGMA user_version").get().user_version, TASK_DB_SCHEMA_VERSION);
  const reopenedStore = new TaskStore(reopened);
  assert.equal(reopenedStore.getCallback(event.payload.event_id).status, "pending");
  assert.equal(reopenedStore.get("legacy-task").callback_sequence, 1);
});

test("a v1.2.1 development outbox keeps its events and carries cycle attempts into dispatch_attempts", async (t) => {
  const { dbPath, legacy, track } = await legacyDatabase(t, V120_TASKS + V121_DEV_OUTBOX);
  const now = new Date().toISOString();
  legacy.exec("ALTER TABLE tasks ADD COLUMN callback_sequence INTEGER NOT NULL DEFAULT 0");
  legacy.prepare(`
    INSERT INTO tasks (task_id, status, created_at, updated_at, callback_sequence)
    VALUES ('dev-task', 'completed', ?, ?, 2)
  `).run(now, now);
  const insert = legacy.prepare(`
    INSERT INTO callback_outbox (event_id, task_id, sequence, event_type, payload_json, status,
      attempts, cycle_attempts, next_retry_at, created_at, updated_at)
    VALUES (?, 'dev-task', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("evt_dev_started", 1, "bridge.started", "{\"event_id\":\"evt_dev_started\"}", "retrying", 3, 3, now, now, now);
  insert.run("evt_dev_final", 2, "bridge.final", "{\"event_id\":\"evt_dev_final\"}", "blocked", 7, 5, null, now, now);
  legacy.close();

  const db = track(openTaskDatabase(dbPath));
  const store = new TaskStore(db);
  const started = store.getCallback("evt_dev_started");
  assert.equal(started.status, "retrying");
  assert.equal(started.dispatch_attempts, 3);
  assert.equal(started.attempts, 3);
  assert.equal(started.priority, 50);
  const final = store.getCallback("evt_dev_final");
  assert.equal(final.status, "dead_letter");
  assert.equal(final.priority, 100);
  assert.equal(final.payload_json, "{\"event_id\":\"evt_dev_final\"}");
  const claimed = store.claimNextCallback();
  assert.equal(claimed.event_id, "evt_dev_started");
  assert.equal(claimed.dispatch_attempts, 4);
});

test("a database from a newer schema is refused without modification", async (t) => {
  const { dbPath, legacy } = await legacyDatabase(t, V120_TASKS);
  legacy.exec(`PRAGMA user_version = ${TASK_DB_SCHEMA_VERSION + 1}`);
  legacy.close();
  assert.throws(() => openTaskDatabase(dbPath), /newer than supported/);
  const check = new DatabaseSync(dbPath);
  try {
    assert.equal(check.prepare("PRAGMA user_version").get().user_version, TASK_DB_SCHEMA_VERSION + 1);
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'callback_outbox'").get().count, 0);
  } finally {
    check.close();
  }
});
