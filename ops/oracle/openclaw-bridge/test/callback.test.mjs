import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload, computeSignature, createCallbackClient, ORACLE_BRIDGE_ID, resolveCallbackConfig } from "../callback.mjs";
import { BRIDGE_VERSION } from "../version.mjs";

test("callback preserves HMAC contract and reports the actual Bridge version", () => {
  const payload = buildPayload({
    eventType: "bridge.final",
    taskId: "task-1",
    sequence: 7,
    bridgeVersion: BRIDGE_VERSION,
    content: { final_answer: "done" },
  });
  assert.equal(payload.schema_version, "bridge_callback_v1");
  assert.equal(payload.sequence, 7);
  assert.equal(payload.metadata.bridge_version, BRIDGE_VERSION);
  assert.match(computeSignature("placeholder-secret", "2026-10-24T00:00:00Z", JSON.stringify(payload)), /^sha256=[a-f0-9]{64}$/);
});

test("callback config defaults to the Oracle Bridge identity and caps automatic dispatches at five", () => {
  const resolved = resolveCallbackConfig({ enabled: true, url: "https://callback.invalid.test", retry: { max_attempts: 50 } }, { OPENCLAW_CALLBACK_SECRET: "placeholder-secret" });
  assert.equal(resolved.bridgeId, ORACLE_BRIDGE_ID);
  assert.equal(ORACLE_BRIDGE_ID, "oracle-phoenix-a1-openclaw-bridge");
  const client = createCallbackClient({ ...resolved, fetchImpl: async () => new Response("", { status: 200 }), logger: { warn() {} } });
  const stats = client.stats();
  assert.equal(stats.maxAttempts, 5);
  assert.equal(stats.deliveryEnabled, true);
  assert.equal(stats.bridgeId, ORACLE_BRIDGE_ID);
});
