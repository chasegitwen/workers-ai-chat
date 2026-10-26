import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OPERATOR_SCOPES,
  buildOracleGatewayClientOptions,
  createOracleGatewayAdapter,
  resolveBridgeIdentityStateDir,
} from "../gateway-runtime.mjs";

const IDENTITY_DIR = "/tmp/oracle-openclaw-bridge-test/identity";

function testEnv(overrides = {}) {
  return {
    OPENCLAW_BRIDGE_IDENTITY_STATE_DIR: IDENTITY_DIR,
    OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
    ...overrides,
  };
}

class CapturingClient {
  static options = [];

  constructor(options) {
    this.options = options;
    CapturingClient.options.push(options);
  }

  start() { queueMicrotask(() => this.options.onHelloOk?.({ type: "hello-ok" })); }
  stopAndWait() { return Promise.resolve(); }
}

test("GatewayClient uses only the dedicated Bridge identity store", () => {
  const options = buildOracleGatewayClientOptions(testEnv({
    OPENCLAW_STATE_DIR: "/home/ubuntu/.openclaw",
  }));
  assert.equal("env" in options, false);
  assert.equal(typeof options.hostDeps.loadOrCreateDeviceIdentity, "function");
  assert.equal(typeof options.hostDeps.loadDeviceAuthToken, "function");
  assert.equal(typeof options.hostDeps.storeDeviceAuthToken, "function");
  assert.equal("sharedStateMode" in options, false);
  assert.equal("deviceIdentity" in options, false);
});

test("dedicated identity state path is required and must be absolute", () => {
  assert.throws(() => resolveBridgeIdentityStateDir({}), /is required/);
  assert.throws(
    () => resolveBridgeIdentityStateDir({ OPENCLAW_BRIDGE_IDENTITY_STATE_DIR: "relative/identity" }),
    /must be an absolute path/,
  );
  assert.equal(resolveBridgeIdentityStateDir(testEnv()), IDENTITY_DIR);
});

test("first start delegates identity creation and pairing to public GatewayClient", async () => {
  CapturingClient.options = [];
  const adapter = createOracleGatewayAdapter({
    env: testEnv({ OPENCLAW_GATEWAY_TOKEN: "test-bootstrap-shared-token" }),
    ClientClass: CapturingClient,
  });
  await adapter.start();
  assert.equal(CapturingClient.options.length, 1);
  const options = CapturingClient.options[0];
  assert.equal(options.clientDisplayName, "Oracle OpenClaw Bridge");
  assert.equal(options.clientName, "cli");
  assert.equal(options.mode, "cli");
  assert.equal(options.token, "test-bootstrap-shared-token");
  assert.equal("deviceIdentity" in options, false);
  await adapter.stop();
});

test("later starts reuse the same dedicated state path without Bridge key generation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-bridge-identity-"));
  try {
    const env = testEnv({ OPENCLAW_BRIDGE_IDENTITY_STATE_DIR: directory });
    const first = buildOracleGatewayClientOptions(env);
    const firstIdentity = first.hostDeps.loadOrCreateDeviceIdentity();
    const firstPrivateKey = firstIdentity.privateKeyPem;
    const second = buildOracleGatewayClientOptions(env);
    const secondIdentity = second.hostDeps.loadOrCreateDeviceIdentity();
    assert.equal(secondIdentity.deviceId, firstIdentity.deviceId);
    assert.equal(secondIdentity.privateKeyPem, firstPrivateKey);
    assert.equal("token" in second, false);
    assert.equal("password" in second, false);
    assert.equal("deviceIdentity" in second, false);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(directory, "device-identity.json")).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("identity initialization errors cannot fall back to shared OpenClaw state", () => {
  assert.throws(
    () => buildOracleGatewayClientOptions({ OPENCLAW_STATE_DIR: "/home/ubuntu/.openclaw" }),
    /OPENCLAW_BRIDGE_IDENTITY_STATE_DIR is required/,
  );
});

test("operator scopes are exact and never request operator.admin", () => {
  const options = buildOracleGatewayClientOptions(testEnv());
  assert.deepEqual(OPERATOR_SCOPES, ["operator.read", "operator.write"]);
  assert.deepEqual(options.scopes, ["operator.read", "operator.write"]);
  assert.equal(options.scopes.includes("operator.admin"), false);
});

test("preferBootstrapToken stays false for a shared Gateway token", () => {
  const options = buildOracleGatewayClientOptions(testEnv({
    OPENCLAW_GATEWAY_TOKEN: "shared-token-for-test-only",
  }));
  assert.equal(options.preferBootstrapToken, false);
  assert.equal("bootstrapToken" in options, false);
});

test("identity material is absent from Bridge options and construction logs", () => {
  const messages = [];
  const logger = {
    debug: (...args) => messages.push(args.join(" ")),
    info: (...args) => messages.push(args.join(" ")),
    warn: (...args) => messages.push(args.join(" ")),
    error: (...args) => messages.push(args.join(" ")),
  };
  const adapter = createOracleGatewayAdapter({ env: testEnv(), logger, ClientClass: CapturingClient });
  assert.equal("privateKeyPem" in adapter.clientOptions, false);
  assert.equal("publicKeyPem" in adapter.clientOptions, false);
  assert.equal("deviceId" in adapter.clientOptions, false);
  assert.deepEqual(messages, []);
});
