import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openTaskDatabase, TaskStore } from "../task-store.mjs";

function task(id, idempotencyKey) {
  return {
    task_id: id,
    conversation_id: "conv",
    session_key: `session-${id}`,
    session_id: null,
    agent_id: "main",
    run_id: `run-${id}`,
    idempotency_key: idempotencyKey,
    status: "running",
    message: "hello",
    partial_text: "",
    result_json: null,
    error: null,
    created_at: "2026-10-24T13:30:00Z",
    updated_at: "2026-10-24T13:30:00Z",
    completed_at: null,
    selection_mode: "classic",
    requested_base_model_id: null,
    resolved_base_model_id: null,
    actual_model_id: null,
    parent_session_key: null,
  };
}

test("idempotency applies without attachments and survives races", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-test-"));
  const db = openTaskDatabase(path.join(dir, "state.sqlite"));
  // Close SQLite before removing its directory (Windows keeps WAL/SHM locked).
  t.after(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = new TaskStore(db);
  assert.equal(store.createOrGet(task("one", "same-key")).created, true);
  const duplicate = store.createOrGet(task("two", "same-key"));
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.task.task_id, "one");
});

test("cancel/final race has one database winner and callback sequence persists", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-race-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "state.sqlite");
  let db = openTaskDatabase(filename);
  let store = new TaskStore(db);
  store.createOrGet(task("race", "race-key"));
  assert.equal(store.nextCallbackSequence("race"), 1);
  assert.equal(store.cancel("race", "cancel requested"), true);
  assert.equal(store.complete("race", { final_answer: "late" }, "late"), false);
  assert.equal(store.get("race").status, "canceled");
  db.close();

  db = openTaskDatabase(filename);
  store = new TaskStore(db);
  assert.equal(store.nextCallbackSequence("race"), 2);
  db.close();
});

test("empty text cannot transition a task to completed", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-empty-"));
  const db = openTaskDatabase(path.join(dir, "state.sqlite"));
  // Close SQLite before removing its directory (Windows keeps WAL/SHM locked).
  t.after(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = new TaskStore(db);
  store.createOrGet(task("empty", "empty-key"));
  assert.equal(store.complete("empty", { final_answer: "" }, ""), false);
  assert.equal(store.get("empty").status, "running");
});
