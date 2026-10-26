import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBridgeApplication } from "../bridge-service.mjs";
import { computeSignature, createCallbackClient } from "../callback.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeGateway {
  constructor(handlers, requestHandler) {
    this.handlers = handlers;
    this.requestHandler = requestHandler;
    this.calls = [];
    this.connected = true;
  }
  async start() { this.connected = true; }
  async stop() { this.connected = false; }
  async request(method, params, options = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === "agents.list") {
      return { defaultId: "main", agents: [{ id: "main", model: { primary: "openai/gpt-6.1-sol" } }] };
    }
    if (method === "models.list") {
      return { models: [{ id: "openai/gpt-6.1-sol", available: true }] };
    }
    return this.requestHandler(method, params, options, this);
  }
  count(method) { return this.calls.filter((call) => call.method === method).length; }
  callsFor(method) { return this.calls.filter((call) => call.method === method); }
}

async function fixture(t, requestHandler, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-server-"));
  let gateway;
  const callbacks = [];
  const callbackClient = {
    notify(payload) { if (payload) callbacks.push(payload); },
    async flush() {},
  };
  const runtime = createBridgeApplication({
    dbPath: path.join(dir, "state.sqlite"),
    token: "test-bridge-token",
    port: 0,
    recoveryDeadlineMs: options.recoveryDeadlineMs ?? 240_000,
    maxSessionCreateAttempts: options.maxSessionCreateAttempts ?? 2,
    callbackClient,
    gatewayFactory: (handlers) => {
      gateway = new FakeGateway(handlers, requestHandler);
      return gateway;
    },
  });
  const address = await runtime.app.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  async function request(method, pathname, body) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        authorization: "Bearer test-bridge-token",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  return { runtime, gateway, callbacks, request };
}

function agentTaskBody(idempotencyKey, message = "repeat question") {
  return {
    message,
    idempotency_key: idempotencyKey,
    conversation_id: "conversation-one",
    selection_mode: "openclaw-agent",
    agent_id: "main",
  };
}

test("server recovery rejects a five-second-old same-text fork without exact turn identity", async (t) => {
  const { runtime, gateway, request } = await fixture(t, async (method, params, options) => {
    if (method === "sessions.create") {
      options.onSent?.();
      return { key: params.key, entry: { sessionId: "session-old-boundary" } };
    }
    if (method === "chat.send") {
      options.onSent?.();
      const error = new Error("confirmation timeout");
      error.requestSent = true;
      throw error;
    }
    if (method === "chat.history") {
      return { messages: [
        { role: "user", text: "repeat question", timestamp: new Date(Date.now() - 5_000).toISOString() },
        { role: "assistant", text: "inherited old answer", stopReason: "stop" },
      ] };
    }
    throw new Error(`unexpected ${method}`);
  });

  const created = await request("POST", "/v1/openclaw/tasks", agentTaskBody("turn-boundary-key"));
  assert.equal(created.status, 202);
  assert.equal(created.body.status, "recovering");
  await runtime.controller.recoverySweep("test-old-boundary");
  const task = runtime.store.getByIdempotencyKey("turn-boundary-key");
  assert.notEqual(task.status, "completed");
  assert.equal(task.status, "recovering");
  assert.equal(gateway.count("chat.send"), 1);
});

test("cancel while sessions.create is pending prevents chat.send", async (t) => {
  const createGate = deferred();
  const { runtime, gateway, request } = await fixture(t, async (method, params, options) => {
    if (method === "sessions.create") {
      options.onSent?.();
      return createGate.promise;
    }
    if (method === "chat.send") throw new Error("chat.send must not be called");
    if (method === "chat.history") return { messages: [] };
    if (method === "chat.abort") return { ok: true };
    throw new Error(`unexpected ${method}`);
  });

  const createResponse = request("POST", "/v1/openclaw/tasks", agentTaskBody("cancel-before-send"));
  let task;
  for (let index = 0; index < 20; index += 1) {
    await nextTurn();
    task = runtime.store.getByIdempotencyKey("cancel-before-send");
    if (task?.submission_phase === "session_create_dispatched") break;
  }
  assert.equal(task?.submission_phase, "session_create_dispatched");
  const canceled = await request("POST", `/v1/openclaw/tasks/${task.task_id}/cancel`);
  assert.equal(canceled.status, 200);
  assert.equal(canceled.body.status, "canceled");
  createGate.resolve({ key: task.session_key, entry: { sessionId: "idle-session-created" } });
  await createResponse;

  assert.equal(runtime.store.get(task.task_id).status, "canceled");
  assert.equal(gateway.count("sessions.create"), 1);
  assert.equal(gateway.count("chat.send"), 0);
  assert.equal(gateway.count("chat.abort"), 0);
});

test("cancel after chat.send dispatch aborts the exact persisted run and late final cannot win", async (t) => {
  const sendGate = deferred();
  const { runtime, gateway, callbacks, request } = await fixture(t, async (method, params, options) => {
    if (method === "chat.send") {
      options.onSent?.();
      return sendGate.promise;
    }
    if (method === "chat.abort") return { ok: true, runId: params.runId };
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });

  const createResponse = request("POST", "/v1/openclaw/tasks", {
    message: "cancel dispatched run",
    idempotency_key: "known-run-key",
    conversation_id: "classic-conversation",
  });
  let task;
  for (let index = 0; index < 20; index += 1) {
    await nextTurn();
    task = runtime.store.getByIdempotencyKey("known-run-key");
    if (task?.submission_phase === "chat_send_dispatched") break;
  }
  assert.equal(task?.run_id, "known-run-key");
  const canceled = await request("POST", `/v1/openclaw/tasks/${task.task_id}/cancel`);
  assert.equal(canceled.status, 200);
  assert.equal(canceled.body.status, "canceled");
  assert.deepEqual(gateway.callsFor("chat.abort")[0].params, {
    sessionKey: task.session_key,
    agentId: "main",
    runId: "known-run-key",
  });

  sendGate.resolve({ runId: "known-run-key", status: "started" });
  await createResponse;
  await runtime.controller.handleEvent({
    event: "chat",
    payload: {
      runId: "known-run-key",
      sessionKey: task.session_key,
      state: "final",
      message: { role: "assistant", text: "late success" },
    },
  });
  assert.equal(runtime.store.get(task.task_id).status, "canceled");
  assert.equal(gateway.count("chat.send"), 1);
  assert.equal(gateway.count("chat.abort"), 1);
  assert.equal(callbacks.some((payload) => payload.event_type === "bridge.final"), false);
});

test("cancel during the pre-onSent gate stays pending until exact run abort completes", async (t) => {
  const onSentGate = deferred();
  const enteredAdapter = deferred();
  let wireSendCount = 0;
  const { runtime, gateway, request } = await fixture(t, async (method, params, options) => {
    if (method === "chat.send") {
      options.beforeDispatch?.();
      enteredAdapter.resolve();
      await onSentGate.promise;
      wireSendCount += 1;
      options.onSent?.();
      return { runId: params.idempotencyKey, status: "started" };
    }
    if (method === "chat.abort") return { ok: true, runId: params.runId };
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });

  const createResponse = request("POST", "/v1/openclaw/tasks", {
    message: "cancel between adapter entry and onSent",
    idempotency_key: "pre-onsent-cancel",
    conversation_id: "classic-pre-onsent",
  });
  await enteredAdapter.promise;
  const task = runtime.store.getByIdempotencyKey("pre-onsent-cancel");
  assert.equal(task.submission_phase, "chat_send_dispatching");
  const cancelResponse = await request("POST", `/v1/openclaw/tasks/${task.task_id}/cancel`);
  assert.equal(cancelResponse.status, 202);
  assert.equal(cancelResponse.body.status, "canceling");
  assert.equal(wireSendCount, 0);
  assert.equal(gateway.count("chat.abort"), 0);

  onSentGate.resolve();
  await createResponse;
  for (let index = 0; index < 20; index += 1) {
    if (runtime.store.get(task.task_id).status === "canceled") break;
    await nextTurn();
  }
  const canceled = runtime.store.get(task.task_id);
  assert.equal(canceled.status, "canceled");
  assert.equal(wireSendCount, 1);
  assert.equal(gateway.count("chat.send"), 1);
  assert.equal(gateway.count("chat.abort"), 1);
  assert.deepEqual(gateway.callsFor("chat.abort")[0].params, {
    sessionKey: task.session_key,
    agentId: "main",
    runId: "pre-onsent-cancel",
  });
  const sendsAfterCanceled = wireSendCount;
  await nextTurn();
  await nextTurn();
  assert.equal(wireSendCount, sendsAfterCanceled);
});

test("cancel while Gateway readiness is pending prevents the later wire send", async (t) => {
  const readyGate = deferred();
  const enteredAdapter = deferred();
  let wireSendCount = 0;
  const { runtime, gateway, request } = await fixture(t, async (method, params, options) => {
    if (method === "chat.send") {
      enteredAdapter.resolve();
      await readyGate.promise;
      options.beforeDispatch?.();
      wireSendCount += 1;
      options.onSent?.();
      return { runId: params.idempotencyKey, status: "started" };
    }
    if (method === "chat.abort") return { ok: true, runId: params.runId };
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });

  const createResponse = request("POST", "/v1/openclaw/tasks", {
    message: "cancel while waiting for Gateway readiness",
    idempotency_key: "readiness-cancel",
    conversation_id: "classic-readiness",
  });
  await enteredAdapter.promise;
  const task = runtime.store.getByIdempotencyKey("readiness-cancel");
  assert.equal(task.submission_phase, "chat_send_dispatching");
  const firstCancel = await request("POST", `/v1/openclaw/tasks/${task.task_id}/cancel`);
  assert.equal(firstCancel.status, 202);
  assert.equal(firstCancel.body.status, "canceling");

  readyGate.resolve();
  await createResponse;
  const canceled = runtime.store.get(task.task_id);
  assert.equal(canceled.status, "canceled");
  assert.equal(wireSendCount, 0);
  assert.equal(gateway.count("chat.send"), 1);
  assert.equal(gateway.count("chat.abort"), 0);
  const confirmedCancel = await request("POST", `/v1/openclaw/tasks/${task.task_id}/cancel`);
  assert.equal(confirmedCancel.status, 200);
  assert.equal(confirmedCancel.body.status, "canceled");
  const sendsAfterCanceledResponse = wireSendCount;
  await nextTurn();
  await nextTurn();
  assert.equal(wireSendCount, sendsAfterCanceledResponse);
});

test("sessions.create timeout resumes with the same idempotent parameters then sends once", async (t) => {
  let createAttempt = 0;
  const { runtime, gateway, request } = await fixture(t, async (method, params, options) => {
    if (method === "sessions.create") {
      createAttempt += 1;
      options.onSent?.();
      if (createAttempt === 1) {
        const error = new Error("sessions.create confirmation timeout");
        error.requestSent = true;
        throw error;
      }
      return { key: params.key, entry: { sessionId: "recovered-session-id" } };
    }
    if (method === "chat.send") {
      options.onSent?.();
      options.onAccepted?.({ runId: params.idempotencyKey });
      return { runId: params.idempotencyKey, status: "started" };
    }
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });

  const created = await request("POST", "/v1/openclaw/tasks", agentTaskBody("resume-after-create-timeout", "resume me"));
  assert.equal(created.status, 202);
  assert.equal(created.body.status, "recovering");
  assert.equal(gateway.count("sessions.create"), 1);
  assert.equal(gateway.count("chat.send"), 0);

  await runtime.controller.recoverySweep("test-session-create-retry");
  const task = runtime.store.getByIdempotencyKey("resume-after-create-timeout");
  const createCalls = gateway.callsFor("sessions.create");
  assert.equal(createCalls.length, 2);
  assert.deepEqual(createCalls[1].params, createCalls[0].params);
  assert.equal(gateway.count("chat.send"), 1);
  assert.equal(task.run_id, "resume-after-create-timeout");
  assert.equal(task.status, "running");
  assert.equal(task.session_create_attempts, 2);
  assert.equal(task.chat_send_attempts, 1);
});

test("sessions.create recovery parameters survive a process restart in SQLite", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-restart-"));
  const dbPath = path.join(dir, "state.sqlite");
  let activeRuntime = null;
  t.after(async () => {
    await activeRuntime?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });

  function boot(requestHandler) {
    let gateway;
    const runtime = createBridgeApplication({
      dbPath,
      token: "test-bridge-token",
      port: 0,
      recoveryDeadlineMs: 240_000,
      maxSessionCreateAttempts: 2,
      gatewayFactory: (handlers) => {
        gateway = new FakeGateway(handlers, requestHandler);
        return gateway;
      },
    });
    return { runtime, gateway };
  }

  const first = boot(async (method, _params, options) => {
    if (method === "sessions.create") {
      options.onSent?.();
      const error = new Error("lost first confirmation");
      error.requestSent = true;
      throw error;
    }
    throw new Error(`unexpected ${method}`);
  });
  activeRuntime = first.runtime;
  const firstAddress = await first.runtime.app.listen();
  const firstResponse = await fetch(`http://127.0.0.1:${firstAddress.port}/v1/openclaw/tasks`, {
    method: "POST",
    headers: { authorization: "Bearer test-bridge-token", "content-type": "application/json" },
    body: JSON.stringify(agentTaskBody("restart-create-timeout", "persist and resume")),
  });
  assert.equal(firstResponse.status, 202);
  const beforeRestart = first.runtime.store.getByIdempotencyKey("restart-create-timeout");
  const persistedCreateParams = JSON.parse(beforeRestart.session_create_params_json);
  assert.equal(beforeRestart.submission_phase, "session_create_dispatched");
  assert.equal(beforeRestart.status, "recovering");
  assert.equal(first.gateway.count("sessions.create"), 1);
  assert.equal(first.gateway.count("chat.send"), 0);
  await first.runtime.close();
  activeRuntime = null;

  const second = boot(async (method, params, options) => {
    if (method === "sessions.create") {
      options.onSent?.();
      return { key: params.key, entry: { sessionId: "restart-session-id" } };
    }
    if (method === "chat.send") {
      options.onSent?.();
      options.onAccepted?.({ runId: params.idempotencyKey });
      return { runId: params.idempotencyKey, status: "started" };
    }
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });
  activeRuntime = second.runtime;
  await second.runtime.controller.recoverySweep("restart-recovery");

  const recovered = second.runtime.store.getByIdempotencyKey("restart-create-timeout");
  assert.deepEqual(second.gateway.callsFor("sessions.create")[0].params, persistedCreateParams);
  assert.equal(second.gateway.count("sessions.create"), 1);
  assert.equal(second.gateway.count("chat.send"), 1);
  assert.equal(recovered.session_id, "restart-session-id");
  assert.equal(recovered.run_id, "restart-create-timeout");
  assert.equal(recovered.status, "running");
  assert.equal(recovered.session_create_attempts, 2);
  assert.equal(recovered.chat_send_attempts, 1);
});

test("chat.send is never resent after onSent uncertainty and restart recovers through history", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-chat-send-once-"));
  const dbPath = path.join(dir, "state.sqlite");
  let activeRuntime = null;
  t.after(async () => {
    await activeRuntime?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });

  function boot(requestHandler) {
    let gateway;
    const runtime = createBridgeApplication({
      dbPath,
      token: "test-bridge-token",
      port: 0,
      gatewayFactory: (handlers) => {
        gateway = new FakeGateway(handlers, requestHandler);
        return gateway;
      },
    });
    return { runtime, gateway };
  }

  const first = boot(async (method, params, options) => {
    if (method === "chat.send") {
      options.onSent?.();
      const error = new Error("wire response lost");
      error.requestSent = true;
      throw error;
    }
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });
  activeRuntime = first.runtime;
  const firstAddress = await first.runtime.app.listen();
  const response = await fetch(`http://127.0.0.1:${firstAddress.port}/v1/openclaw/tasks`, {
    method: "POST",
    headers: { authorization: "Bearer test-bridge-token", "content-type": "application/json" },
    body: JSON.stringify({
      message: "one short prompt",
      idempotency_key: "wire-send-once",
      conversation_id: "wire-send-once-conversation",
    }),
  });
  assert.equal(response.status, 202);
  assert.equal(first.gateway.count("chat.send"), 1);
  const beforeRestart = first.runtime.store.getByIdempotencyKey("wire-send-once");
  assert.equal(beforeRestart.status, "recovering");
  assert.equal(beforeRestart.submission_phase, "chat_send_dispatched");
  assert.equal(beforeRestart.chat_send_attempts, 1);
  await first.runtime.close();
  activeRuntime = null;

  const second = boot(async (method) => {
    if (method === "chat.send") throw new Error("chat.send must not be resent");
    if (method === "chat.history") {
      return { messages: [{
        role: "assistant",
        text: "one-line recovered answer",
        runId: "wire-send-once",
        stopReason: "stop",
      }] };
    }
    throw new Error(`unexpected ${method}`);
  });
  activeRuntime = second.runtime;
  await second.runtime.controller.recoverySweep("restart-history-only");
  const recovered = second.runtime.store.getByIdempotencyKey("wire-send-once");
  assert.equal(second.gateway.count("chat.send"), 0);
  assert.equal(second.gateway.count("chat.history"), 1);
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.chat_send_attempts, 1);
});

test("sessions.create stops after two identical uncertain sends and becomes indeterminate", async (t) => {
  const { runtime, gateway, request } = await fixture(t, async (method, _params, options) => {
    if (method === "sessions.create") {
      options.onSent?.();
      const error = new Error("confirmation unavailable");
      error.requestSent = true;
      throw error;
    }
    if (method === "chat.send") throw new Error("chat.send must not be called");
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  }, { maxSessionCreateAttempts: 2 });

  const created = await request("POST", "/v1/openclaw/tasks", agentTaskBody("two-create-attempts", "same params only"));
  assert.equal(created.body.status, "recovering");
  await runtime.controller.recoverySweep("second-create-attempt");
  await runtime.controller.recoverySweep("must-not-create-third-time");
  const calls = gateway.callsFor("sessions.create");
  const task = runtime.store.getByIdempotencyKey("two-create-attempts");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, calls[0].params);
  assert.equal(task.session_create_attempts, 2);
  assert.equal(task.status, "indeterminate");
  assert.equal(gateway.count("chat.send"), 0);
});

test("bounded sessions.create uncertainty becomes explicit indeterminate without sending or deleting", async (t) => {
  const { runtime, gateway, request } = await fixture(t, async (method, _params, options) => {
    if (method === "sessions.create") {
      options.onSent?.();
      const error = new Error("confirmation still unavailable");
      error.requestSent = true;
      throw error;
    }
    if (method === "chat.send") throw new Error("chat.send must not be called");
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  }, { maxSessionCreateAttempts: 1 });

  const created = await request("POST", "/v1/openclaw/tasks", agentTaskBody("bounded-create-timeout", "do not duplicate"));
  assert.equal(created.body.status, "recovering");
  const originalSessionKey = runtime.store.getByIdempotencyKey("bounded-create-timeout").session_key;
  await runtime.controller.recoverySweep("bounded-create-timeout");
  const task = runtime.store.getByIdempotencyKey("bounded-create-timeout");
  assert.equal(task.status, "indeterminate");
  assert.equal(task.session_key, originalSessionKey);
  assert.match(task.error, /possible idle session retained/);
  assert.equal(gateway.count("sessions.create"), 1);
  assert.equal(gateway.count("chat.send"), 0);
});

test("an unexpected accepted runId becomes indeterminate through a callback-bearing transition", async (t) => {
  const { runtime, callbacks, request } = await fixture(t, async (method, _params, options) => {
    if (method === "chat.send") {
      options.onSent?.();
      options.onAccepted?.({ runId: "someone-elses-run" });
      return { runId: "someone-elses-run", status: "started" };
    }
    if (method === "chat.history") return { messages: [] };
    throw new Error(`unexpected ${method}`);
  });

  const created = await request("POST", "/v1/openclaw/tasks", {
    message: "identity check",
    idempotency_key: "accepted-run-mismatch",
    conversation_id: "accepted-run-mismatch-conversation",
  });
  assert.equal(created.status, 503);
  const task = runtime.store.getByIdempotencyKey("accepted-run-mismatch");
  assert.equal(task.status, "indeterminate");
  assert.match(task.error, /unexpected runId someone-elses-run/);
  const errors = callbacks.filter((payload) => payload.event_type === "bridge.error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].metadata.reason, "run_identity_mismatch");
  const row = runtime.store.getCallback(errors[0].event_id);
  assert.equal(row.event_type, "bridge.error");
  assert.equal(row.sequence, task.callback_sequence);
  assert.equal(callbacks.some((payload) => payload.event_type === "bridge.started"), false);
});

test("callback failure, dead_letter and administrator requeue never send chat.send again", async (t) => {
  const received = [];
  let receiverStatus = 503;
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(receiverStatus, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => receiver.close(resolve)));

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-callback-requeue-"));
  const callbackClient = createCallbackClient({
    enabled: true,
    url: `http://127.0.0.1:${receiver.address().port}/api/openclaw/bridge/callback`,
    bridgeId: "oracle-phoenix-a1-openclaw-bridge",
    secret: "local-test-secret",
    backoffMs: [0, 0, 0, 0],
    logger: { warn() {} },
  });
  let gateway;
  const runtime = createBridgeApplication({
    dbPath: path.join(dir, "state.sqlite"),
    token: "test-bridge-token",
    port: 0,
    callbackClient,
    gatewayFactory: (handlers) => {
      gateway = new FakeGateway(handlers, async (method, params, options) => {
        if (method === "chat.send") {
          options.onSent?.();
          options.onAccepted?.({ runId: params.idempotencyKey });
          return { runId: params.idempotencyKey, status: "started" };
        }
        if (method === "chat.history") return { messages: [] };
        throw new Error(`unexpected ${method}`);
      });
      return gateway;
    },
  });
  t.after(async () => {
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const address = await runtime.app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: "Bearer test-bridge-token", "content-type": "application/json" };

  const created = await fetch(`${base}/v1/openclaw/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "callback outage", idempotency_key: "callback-outage", conversation_id: "callback-outage" }),
  });
  assert.equal(created.status, 202);
  const task = runtime.store.getByIdempotencyKey("callback-outage");
  await callbackClient.flush(5_000);
  const startedRow = runtime.store.db
    .prepare("SELECT * FROM callback_outbox WHERE task_id = ? AND event_type = 'bridge.started'")
    .get(task.task_id);
  assert.equal(startedRow.status, "dead_letter");
  assert.equal(startedRow.dispatch_attempts, 5);
  assert.equal(received.length, 5);

  receiverStatus = 200;
  const requeued = await fetch(`${base}/v1/openclaw/callbacks/${encodeURIComponent(startedRow.event_id)}/requeue`, { method: "POST", headers });
  assert.equal(requeued.status, 202);
  await callbackClient.flush(5_000);
  const delivered = runtime.store.getCallback(startedRow.event_id);
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.attempts, 6);
  assert.equal(received.length, 6);
  assert.equal(new Set(received.map((entry) => JSON.parse(entry.body).event_id)).size, 1);
  const last = received.at(-1);
  assert.equal(last.headers["x-openclaw-signature"], computeSignature("local-test-secret", last.headers["x-openclaw-timestamp"], last.body));

  const conflict = await fetch(`${base}/v1/openclaw/callbacks/${encodeURIComponent(startedRow.event_id)}/requeue`, { method: "POST", headers });
  assert.equal(conflict.status, 409);
  await runtime.controller.recoverySweep("after-callback-outage");
  assert.equal(gateway.count("chat.send"), 1);
  assert.equal(runtime.store.get(task.task_id).chat_send_attempts, 1);
});

test("runtime close waits for an in-flight callback before closing SQLite", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let requestSeen;
  const seen = new Promise((resolve) => { requestSeen = resolve; });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-bridge-close-order-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));
  const callbackClient = createCallbackClient({
    enabled: true,
    url: "http://127.0.0.1:9/never-contacted",
    bridgeId: "oracle-phoenix-a1-openclaw-bridge",
    secret: "local-test-secret",
    logger: { warn() {} },
    fetchImpl: async () => { requestSeen(); await gate; return new Response("{}", { status: 200 }); },
  });
  const runtime = createBridgeApplication({
    dbPath: path.join(dir, "state.sqlite"),
    token: "test-bridge-token",
    port: 0,
    callbackClient,
    gatewayFactory: (handlers) => new FakeGateway(handlers, async () => { throw new Error("unused"); }),
  });
  const now = new Date().toISOString();
  runtime.store.createOrGet({
    task_id: "close-order", conversation_id: "c", session_key: "s", session_id: null, agent_id: "main",
    run_id: "r", idempotency_key: "close-order", status: "running", message: "m", partial_text: "",
    result_json: null, error: null, created_at: now, updated_at: now, completed_at: null,
    requested_base_model_id: null, resolved_base_model_id: null, actual_model_id: null, parent_session_key: null,
  });
  assert.equal(runtime.controller.emitCallback("bridge.started", runtime.store.get("close-order"), { text: "started" }), true);
  await seen;
  const closing = runtime.close();
  setTimeout(release, 20);
  await closing;
  const check = new DatabaseSync(path.join(dir, "state.sqlite"));
  try {
    const row = check.prepare("SELECT status, dispatch_attempts FROM callback_outbox").get();
    assert.equal(row.status, "delivered");
    assert.equal(row.dispatch_attempts, 1);
  } finally {
    check.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(unhandled, []);
});
