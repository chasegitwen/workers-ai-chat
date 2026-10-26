import test from "node:test";
import assert from "node:assert/strict";
import { GatewayAdapter, PendingRunEventBuffer } from "../gateway-adapter.mjs";
import { isUncertainSubmissionFailure } from "../submission-state.mjs";

class FakeGatewayClient {
  static instance;
  constructor(options) {
    this.options = options;
    FakeGatewayClient.instance = this;
  }
  start() { queueMicrotask(() => this.options.onHelloOk?.({ type: "hello-ok" })); }
  request(method, params, options = {}) {
    this.lastRequestOptions = options;
    return Promise.resolve({ method, params });
  }
  disconnect() { this.options.onClose?.(1006, "offline", { phase: "post-hello" }); }
  reconnect() { this.options.onHelloOk?.({ type: "hello-ok" }); }
  stopAndWait() { return Promise.resolve(); }
}

test("adapter waits across disconnect and resumes after reconnect", async () => {
  let disconnects = 0;
  const adapter = new GatewayAdapter({
    ClientClass: FakeGatewayClient,
    clientOptions: {},
    handlers: { onDisconnected: () => { disconnects += 1; } },
    readyTimeoutMs: 1_000,
  });
  await adapter.start();
  FakeGatewayClient.instance.disconnect();
  const pending = adapter.request("models.list", { agentId: "main" });
  setImmediate(() => FakeGatewayClient.instance.reconnect());
  assert.deepEqual(await pending, { method: "models.list", params: { agentId: "main" } });
  assert.equal(disconnects, 1);
  await adapter.stop();
});

test("adapter runs a synchronous guard after readiness and immediately before client.request", async () => {
  const order = [];
  const adapter = new GatewayAdapter({
    ClientClass: FakeGatewayClient,
    clientOptions: {},
    readyTimeoutMs: 1_000,
  });
  await adapter.start();
  FakeGatewayClient.instance.disconnect();
  const originalRequest = FakeGatewayClient.instance.request.bind(FakeGatewayClient.instance);
  FakeGatewayClient.instance.request = (method, params, options) => {
    order.push("client.request");
    return originalRequest(method, params, options);
  };
  const pending = adapter.request("chat.send", { idempotencyKey: "guard-run" }, {
    beforeDispatch: () => { order.push("beforeDispatch"); },
    onSent: () => {},
  });
  assert.deepEqual(order, []);
  FakeGatewayClient.instance.reconnect();
  await pending;
  assert.deepEqual(order, ["beforeDispatch", "client.request"]);
  assert.equal("beforeDispatch" in FakeGatewayClient.instance.lastRequestOptions, false);
  assert.equal(typeof FakeGatewayClient.instance.lastRequestOptions.onSent, "function");
  await adapter.stop();
});

test("events arriving before runId persistence are buffered and drained once", () => {
  const buffer = new PendingRunEventBuffer();
  buffer.push("run-1", { payload: { state: "final" } });
  assert.equal(buffer.take("run-1").length, 1);
  assert.deepEqual(buffer.take("run-1"), []);
});

test("a sent request timeout is uncertain, an unsent rejection is definite", () => {
  assert.equal(isUncertainSubmissionFailure(new Error("request timeout"), true), true);
  assert.equal(isUncertainSubmissionFailure(new Error("request timeout"), false), false);
  assert.equal(isUncertainSubmissionFailure(new Error("schema rejected"), true), false);
});
