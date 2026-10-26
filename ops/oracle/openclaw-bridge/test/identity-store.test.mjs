import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOracleIdentityStore } from "../identity-store.mjs";

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-identity-store-"));
  return { directory, store: createOracleIdentityStore(directory) };
}

test("identity store creates one Ed25519 identity and reuses it", () => {
  const { directory, store } = temporaryStore();
  try {
    const first = store.hostDeps.loadOrCreateDeviceIdentity();
    const second = createOracleIdentityStore(directory).hostDeps.loadOrCreateDeviceIdentity();
    assert.match(first.deviceId, /^[a-f0-9]{64}$/);
    assert.match(first.privateKeyPem, /^-----BEGIN PRIVATE KEY-----/);
    assert.deepEqual(second, first);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(store.paths.identityFile).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("device token store persists only exact operator read/write scopes", () => {
  const { directory, store } = temporaryStore();
  try {
    const identity = store.hostDeps.loadOrCreateDeviceIdentity();
    store.hostDeps.storeDeviceAuthToken({
      deviceId: identity.deviceId,
      role: "operator",
      token: "device-token-for-test",
      scopes: ["operator.read", "operator.write"],
      expectedToken: null,
    });
    const reloaded = createOracleIdentityStore(directory).hostDeps.loadDeviceAuthToken({
      deviceId: identity.deviceId,
      role: "operator",
    });
    assert.deepEqual(reloaded, {
      token: "device-token-for-test",
      scopes: ["operator.read", "operator.write"],
    });
    assert.equal(fs.statSync(store.paths.authFile).mode & 0o777, 0o600);
    assert.throws(() => store.hostDeps.storeDeviceAuthToken({
      deviceId: identity.deviceId,
      role: "operator",
      token: "bad-scope-token",
      scopes: ["operator.read", "operator.write", "operator.admin"],
      expectedToken: "device-token-for-test",
    }), /unexpected scopes/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid persisted identity fails closed instead of rotating or falling back", () => {
  const { directory, store } = temporaryStore();
  try {
    fs.writeFileSync(store.paths.identityFile, '{"deviceId":"invalid"}\n', { mode: 0o600 });
    assert.throws(() => store.hostDeps.loadOrCreateDeviceIdentity(), /invalid device ID/);
    assert.equal(fs.readFileSync(store.paths.identityFile, "utf8"), '{"deviceId":"invalid"}\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
