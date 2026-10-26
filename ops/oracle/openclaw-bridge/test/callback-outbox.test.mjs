import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { buildPayload, computeSignature, createCallbackClient } from "../callback.mjs";
import { openTaskDatabase, TaskStore } from "../task-store.mjs";

const SECRET = "test-secret";
const BRIDGE_ID = "oracle-test-bridge";

function taskRow(taskId = "task-one") {
  const now = new Date().toISOString();
  return {
    task_id: taskId,
    conversation_id: "conversation-one",
    session_key: `session-${taskId}`,
    session_id: `session-id-${taskId}`,
    agent_id: "main",
    run_id: `run-${taskId}`,
    idempotency_key: `idem-${taskId}`,
    status: "running",
    message: "short prompt",
    partial_text: "",
    result_json: null,
    error: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    selection_mode: "classic",
    requested_base_model_id: null,
    resolved_base_model_id: "openai/test",
    actual_model_id: null,
    parent_session_key: null,
    callback_sequence: 0,
    submission_phase: "run_known",
    session_create_params_json: null,
    chat_send_params_json: null,
    session_create_attempts: 0,
    chat_send_attempts: 1,
    cancel_requested: 0,
    recovery_deadline_at: null,
  };
}

function payloadFactory(eventType = "bridge.final", text = "one line") {
  return (task, sequence) => buildPayload({
    eventType,
    taskId: task.task_id,
    conversationId: task.conversation_id,
    sequence,
    agent: task.agent_id,
    content: { text },
    bridgeVersion: "oracle-bridge-test",
  });
}

const testResources = new WeakMap();

// One cleanup hook per test closes every SQLite handle first and only then
// removes the directory: Windows keeps the database and WAL/SHM files locked.
function resourcesFor(t) {
  let resources = testResources.get(t);
  if (!resources) {
    resources = { closers: [], directories: [] };
    testResources.set(t, resources);
    t.after(async () => {
      for (const close of resources.closers) close();
      for (const directory of resources.directories) await fs.rm(directory, { recursive: true, force: true });
    });
  }
  return resources;
}

async function openStore(t, existingPath = null) {
  const resources = resourcesFor(t);
  let dbPath = existingPath;
  if (!dbPath) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-callback-outbox-"));
    resources.directories.push(directory);
    dbPath = path.join(directory, "state.sqlite");
  }
  const db = openTaskDatabase(dbPath);
  let closed = false;
  const close = () => { if (!closed) { closed = true; db.close(); } };
  resources.closers.push(close);
  return { db, dbPath, store: new TaskStore(db), close };
}

function client(store, overrides = {}) {
  return createCallbackClient({
    enabled: true,
    url: "https://callback.invalid.test",
    bridgeId: BRIDGE_ID,
    secret: SECRET,
    store,
    backoffMs: [0, 0, 0, 0],
    logger: { warn() {} },
    ...overrides,
  });
}

function expireLease(db, eventId) {
  db.prepare("UPDATE callback_outbox SET lease_until = ? WHERE event_id = ?")
    .run(new Date(Date.now() - 1_000).toISOString(), eventId);
}

async function startReceiver(t, handler = () => 200) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const entry = { headers: req.headers, body };
      requests.push(entry);
      const status = await handler(entry, requests.length);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 300 }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/api/openclaw/bridge/callback`, requests };
}

test("terminal transition and outbox insert commit atomically", async (t) => {
  const { store } = await openStore(t);
  store.createOrGet(taskRow());

  assert.throws(() => store.transitionWithCallback(
    "task-one",
    () => store.complete("task-one", { final_answer: "done" }, "done", "openai/test"),
    () => { throw new Error("payload construction failed"); },
  ));
  assert.equal(store.get("task-one").status, "running");
  assert.equal(store.get("task-one").callback_sequence, 0);
  assert.equal(store.countCallbackStatus("pending"), 0);

  const committed = store.transitionWithCallback(
    "task-one",
    () => store.complete("task-one", { final_answer: "done" }, "done", "openai/test"),
    payloadFactory(),
  );
  assert.equal(committed.transitioned, true);
  assert.equal(store.get("task-one").status, "completed");
  assert.equal(store.getCallback(committed.payload.event_id).status, "pending");
  assert.equal(store.getCallback(committed.payload.event_id).sequence, 1);
  assert.equal(store.getCallback(committed.payload.event_id).priority, 100);
});

test("a lost terminal CAS creates no outbox event and consumes no sequence", async (t) => {
  const { db, store } = await openStore(t);
  store.createOrGet(taskRow());
  assert.equal(store.cancel("task-one", "cancel won"), true);
  const late = store.transitionWithCallback(
    "task-one",
    () => store.complete("task-one", { final_answer: "late" }, "late"),
    payloadFactory("bridge.final"),
  );
  assert.equal(late.transitioned, false);
  assert.equal(store.get("task-one").status, "canceled");
  assert.equal(store.get("task-one").callback_sequence, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM callback_outbox").get().count, 0);
});

for (const [label, overrides] of [
  ["disabled", { enabled: false }],
  ["missing url", { url: "" }],
  ["missing secret", { secret: "" }],
]) {
  test(`callback delivery ${label} never fetches and never consumes attempts`, async (t) => {
    const { store } = await openStore(t);
    store.createOrGet(taskRow());
    const event = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
    let fetches = 0;
    const dispatcher = client(store, { ...overrides, fetchImpl: async () => { fetches += 1; return new Response("", { status: 200 }); } });
    dispatcher.notify();
    await dispatcher.flush();
    await dispatcher.stop();

    const row = store.getCallback(event.payload.event_id);
    assert.equal(fetches, 0);
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 0);
    assert.equal(row.dispatch_attempts, 0);
    assert.equal(dispatcher.stats().deliveryEnabled, false);
  });
}

test("five failed dispatches enter dead_letter with stable event_id, payload and fresh signatures", async (t) => {
  const { store } = await openStore(t);
  store.createOrGet(taskRow());
  const event = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
  const seen = [];
  const dispatcher = client(store, {
    maxAttempts: 99,
    fetchImpl: async (_url, init) => {
      seen.push(init);
      await new Promise((resolve) => setTimeout(resolve, 3));
      return new Response("blocked", { status: 503 });
    },
  });
  await dispatcher.flush();
  await dispatcher.stop();

  const row = store.getCallback(event.payload.event_id);
  assert.equal(seen.length, 5);
  assert.equal(row.status, "dead_letter");
  assert.equal(row.attempts, 5);
  assert.equal(row.dispatch_attempts, 5);
  assert.equal(row.lease_until, null);
  assert.equal(row.last_http_status, 503);
  assert.match(row.last_error, /HTTP 503/);
  assert.equal(new Set(seen.map((init) => init.body)).size, 1);
  assert.equal(seen[0].body, row.payload_json);
  for (const init of seen) {
    assert.equal(init.headers["X-OpenClaw-Event-Id"], event.payload.event_id);
    assert.equal(JSON.parse(init.body).event_id, event.payload.event_id);
    assert.equal(
      init.headers["X-OpenClaw-Signature"],
      computeSignature(SECRET, init.headers["X-OpenClaw-Timestamp"], init.body),
    );
  }
  assert.ok(new Set(seen.map((init) => init.headers["X-OpenClaw-Timestamp"])).size > 1);
});

test("an expired lease after the fifth dispatch dead-letters without a sixth request", async (t) => {
  const { db, store } = await openStore(t);
  store.createOrGet(taskRow());
  const event = store.enqueueCallback("task-one", payloadFactory("bridge.final"));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const claimed = store.claimNextCallback({ maxAttempts: 5 });
    assert.equal(claimed.event_id, event.payload.event_id);
    assert.equal(claimed.status, "sending");
    assert.equal(claimed.dispatch_attempts, attempt);
    // Simulate a crash while the request was in flight.
    expireLease(db, event.payload.event_id);
  }
  let fetches = 0;
  const dispatcher = client(store, { fetchImpl: async () => { fetches += 1; return new Response("", { status: 200 }); } });
  await dispatcher.flush();
  await dispatcher.stop();

  const row = store.getCallback(event.payload.event_id);
  assert.equal(fetches, 0);
  assert.equal(row.status, "dead_letter");
  assert.equal(row.dispatch_attempts, 5);
  assert.match(row.last_error, /lease expired after the final allowed attempt/);
});

test("an active lease is exclusive across SQLite connections", async (t) => {
  const first = await openStore(t);
  first.store.createOrGet(taskRow());
  const event = first.store.enqueueCallback("task-one", payloadFactory("bridge.final"));
  const second = await openStore(t, first.dbPath);

  const claimed = first.store.claimNextCallback({ leaseMs: 60_000 });
  assert.equal(claimed.event_id, event.payload.event_id);
  assert.equal(second.store.claimNextCallback({ leaseMs: 60_000 }), null);
  assert.equal(first.store.getCallback(event.payload.event_id).dispatch_attempts, 1);

  expireLease(first.db, event.payload.event_id);
  const reclaimed = second.store.claimNextCallback({ leaseMs: 60_000 });
  assert.equal(reclaimed.event_id, event.payload.event_id);
  assert.equal(reclaimed.dispatch_attempts, 2);
  // The stale dispatcher's completion is fenced by dispatch_attempts.
  assert.equal(first.store.markCallbackDelivered(event.payload.event_id, 1, 200), false);
  assert.equal(second.store.markCallbackDelivered(event.payload.event_id, 2, 200), true);
});

test("restart resends an in-flight event with the same event_id to a local receiver", async (t) => {
  const receiver = await startReceiver(t);
  const first = await openStore(t);
  first.store.createOrGet(taskRow());
  const event = first.store.enqueueCallback("task-one", payloadFactory("bridge.final"));
  // The receiver accepted the request but the process died before writing delivered.
  const claimed = first.store.claimNextCallback();
  const timestamp = new Date().toISOString();
  await fetch(receiver.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openclaw-event-id": claimed.event_id,
      "x-openclaw-timestamp": timestamp,
      "x-openclaw-signature": computeSignature(SECRET, timestamp, claimed.payload_json),
    },
    body: claimed.payload_json,
  });
  expireLease(first.db, event.payload.event_id);
  first.close();

  const second = await openStore(t, first.dbPath);
  const dispatcher = client(null, { url: receiver.url, fetchImpl: undefined });
  dispatcher.attachStore(second.store);
  await dispatcher.flush();
  await dispatcher.stop();

  const row = second.store.getCallback(event.payload.event_id);
  assert.equal(receiver.requests.length, 2);
  assert.deepEqual(receiver.requests.map((request) => JSON.parse(request.body).event_id), [event.payload.event_id, event.payload.event_id]);
  assert.equal(receiver.requests[0].body, receiver.requests[1].body);
  const resent = receiver.requests[1];
  assert.equal(resent.headers["x-openclaw-bridge-id"], BRIDGE_ID);
  assert.equal(resent.headers["x-openclaw-signature"], computeSignature(SECRET, resent.headers["x-openclaw-timestamp"], resent.body));
  assert.equal(row.status, "delivered");
  assert.equal(row.dispatch_attempts, 2);
  assert.equal(second.store.get("task-one").status, "running");
});

test("restart recovers pending events from SQLite without recreating the task", async (t) => {
  const first = await openStore(t);
  first.store.createOrGet(taskRow());
  const event = first.store.enqueueCallback("task-one", payloadFactory());
  first.close();

  const second = await openStore(t, first.dbPath);
  let networkRequests = 0;
  const dispatcher = client(null, {
    fetchImpl: async () => {
      networkRequests += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  dispatcher.attachStore(second.store);
  await dispatcher.flush();
  await dispatcher.stop();

  const row = second.store.getCallback(event.payload.event_id);
  assert.equal(networkRequests, 1);
  assert.equal(row.status, "delivered");
  assert.equal(row.attempts, 1);
  assert.ok(row.delivered_at);
  assert.equal(second.store.get("task-one").status, "running");
});

test("events of one task are dispatched in sequence; a dead-lettered predecessor stops blocking", async (t) => {
  const { db, store } = await openStore(t);
  store.createOrGet(taskRow());
  const started = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
  const final = store.transitionWithCallback(
    "task-one",
    () => store.complete("task-one", { final_answer: "done" }, "done"),
    payloadFactory("bridge.final"),
  );

  const firstClaim = store.claimNextCallback();
  assert.equal(firstClaim.event_id, started.payload.event_id);
  const future = new Date(Date.now() + 60_000).toISOString();
  store.scheduleCallbackRetry(started.payload.event_id, 1, future, "HTTP 503", 503);
  // The final is due, but its predecessor is still retrying.
  assert.equal(store.claimNextCallback(), null);
  assert.equal(store.nextCallbackWakeup(), future);

  db.prepare("UPDATE callback_outbox SET next_retry_at = ? WHERE event_id = ?")
    .run(new Date(Date.now() - 1).toISOString(), started.payload.event_id);
  const secondClaim = store.claimNextCallback();
  assert.equal(secondClaim.event_id, started.payload.event_id);
  store.markCallbackDeadLetter(started.payload.event_id, 2, "HTTP 400", 400);

  const finalClaim = store.claimNextCallback();
  assert.equal(finalClaim.event_id, final.payload.event_id);
});

test("activity snapshots are superseded and terminal events are dispatched first across tasks", async (t) => {
  const { store } = await openStore(t);
  store.createOrGet(taskRow("busy"));
  store.createOrGet(taskRow("quiet"));
  const activities = [];
  for (let index = 0; index < 4; index += 1) {
    activities.push(store.enqueueCallback("busy", payloadFactory("bridge.activity", `partial ${index}`)));
  }
  for (const [index, superseded] of activities.slice(0, 3).entries()) {
    const row = store.getCallback(superseded.payload.event_id);
    assert.equal(row.status, "superseded");
    assert.equal(row.superseded_by, activities[index + 1].payload.event_id);
    assert.ok(row.payload_json);
  }
  const quietFinal = store.transitionWithCallback(
    "quiet",
    () => store.complete("quiet", { final_answer: "done" }, "done"),
    payloadFactory("bridge.final"),
  );
  assert.equal(store.claimNextCallback().event_id, quietFinal.payload.event_id);

  const busyFinal = store.transitionWithCallback(
    "busy",
    () => store.complete("busy", { final_answer: "done" }, "done"),
    payloadFactory("bridge.final"),
  );
  assert.equal(store.getCallback(activities[3].payload.event_id).status, "superseded");
  assert.equal(store.claimNextCallback().event_id, busyFinal.payload.event_id);
  assert.equal(store.claimNextCallback(), null);
});

test("outbox maintenance deletes only delivered/superseded rows past retention, never open or dead_letter rows", async (t) => {
  const { db, store } = await openStore(t);
  store.createOrGet(taskRow());
  const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const age = (eventId) => db
    .prepare("UPDATE callback_outbox SET created_at = ?, updated_at = ? WHERE event_id = ?")
    .run(longAgo, longAgo, eventId);

  const deliveredOld = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
  store.markCallbackDelivered(deliveredOld.payload.event_id, store.claimNextCallback().dispatch_attempts, 200);
  age(deliveredOld.payload.event_id);
  const deliveredFresh = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
  store.markCallbackDelivered(deliveredFresh.payload.event_id, store.claimNextCallback().dispatch_attempts, 200);
  const deadOld = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
  store.markCallbackDeadLetter(deadOld.payload.event_id, store.claimNextCallback().dispatch_attempts, "HTTP 400", 400);
  age(deadOld.payload.event_id);
  const pendingOld = store.enqueueCallback("task-one", payloadFactory("bridge.started"));
  age(pendingOld.payload.event_id);

  assert.deepEqual(store.maintainCallbackOutbox(), { prunedFinished: 1 });
  assert.equal(store.getCallback(deliveredOld.payload.event_id), null);
  assert.equal(store.getCallback(deliveredFresh.payload.event_id).status, "delivered");
  assert.equal(store.getCallback(deadOld.payload.event_id).status, "dead_letter");
  assert.equal(store.getCallback(pendingOld.payload.event_id).status, "pending");
  assert.equal(store.countUnresolvedCallbacks(), 2);
  // A year-old dead letter is still recoverable by the administrator.
  assert.equal(store.requeueCallback(deadOld.payload.event_id), true);
});

test("administrator requeue keeps event_id and payload and resets only the dispatch budget", async (t) => {
  const { store } = await openStore(t);
  store.createOrGet(taskRow());
  const event = store.enqueueCallback("task-one", payloadFactory());
  const before = store.getCallback(event.payload.event_id);
  assert.equal(store.requeueCallback(event.payload.event_id), false);
  const claimed = store.claimNextCallback();
  store.markCallbackDeadLetter(claimed.event_id, claimed.dispatch_attempts, "HTTP 503", 503);
  assert.equal(store.requeueCallback(claimed.event_id), true);
  const requeued = store.getCallback(claimed.event_id);
  assert.equal(requeued.status, "pending");
  assert.equal(requeued.event_id, before.event_id);
  assert.equal(requeued.sequence, before.sequence);
  assert.equal(requeued.payload_json, before.payload_json);
  assert.equal(requeued.attempts, 1);
  assert.equal(requeued.dispatch_attempts, 0);
  assert.equal(requeued.last_error, null);
  assert.equal(requeued.lease_until, null);
});

test("stop aborts an in-flight dispatch, records it, and lets SQLite close without later writes", async (t) => {
  const { store, close } = await openStore(t);
  store.createOrGet(taskRow());
  const event = store.enqueueCallback("task-one", payloadFactory("bridge.final"));
  let requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));
  const dispatcher = client(store, {
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      requestStarted();
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }),
  });
  dispatcher.notify();
  await started;
  await dispatcher.stop({ graceMs: 10 });

  const row = store.getCallback(event.payload.event_id);
  assert.equal(row.status, "retrying");
  assert.equal(row.dispatch_attempts, 1);
  assert.match(row.last_error, /dispatcher stopped/);
  close();
  dispatcher.notify();
  await dispatcher.flush(100);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(unhandled, []);
  assert.equal(dispatcher.stats().stopped, true);
});

test("payload event_id values are random UUID based and unique per event", async (t) => {
  const { store } = await openStore(t);
  store.createOrGet(taskRow());
  const ids = new Set();
  for (let index = 0; index < 5; index += 1) {
    ids.add(store.enqueueCallback("task-one", payloadFactory("bridge.started")).payload.event_id);
  }
  assert.equal(ids.size, 5);
  for (const id of ids) assert.match(id, /^evt_[0-9a-f-]{36}$/);
});
