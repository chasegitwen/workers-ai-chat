import {
  GatewayClient,
  isGatewayTransportError,
} from "openclaw/plugin-sdk/gateway-runtime";
import path from "node:path";
import { GatewayAdapter } from "./gateway-adapter.mjs";
import { createOracleIdentityStore } from "./identity-store.mjs";
import { isUncertainSubmissionFailure } from "./submission-state.mjs";
import { BRIDGE_VERSION } from "./version.mjs";

const OPERATOR_SCOPES = Object.freeze(["operator.read", "operator.write"]);

export function resolveBridgeIdentityStateDir(env = process.env) {
  const configured = String(env.OPENCLAW_BRIDGE_IDENTITY_STATE_DIR || "").trim();
  if (!configured) {
    throw new Error("OPENCLAW_BRIDGE_IDENTITY_STATE_DIR is required");
  }
  if (!path.isAbsolute(configured)) {
    throw new Error("OPENCLAW_BRIDGE_IDENTITY_STATE_DIR must be an absolute path");
  }
  return path.normalize(configured);
}

export function buildOracleGatewayClientOptions(env = process.env) {
  const token = String(env.OPENCLAW_GATEWAY_TOKEN || "").trim();
  const password = String(env.OPENCLAW_GATEWAY_PASSWORD || "").trim();
  const identityStateDir = resolveBridgeIdentityStateDir(env);
  const identityStore = createOracleIdentityStore(identityStateDir);

  return {
    url: env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789",
    ...(token ? { token } : {}),
    ...(password ? { password } : {}),
    role: "operator",
    scopes: [...OPERATOR_SCOPES],
    clientName: "cli",
    clientDisplayName: "Oracle OpenClaw Bridge",
    clientVersion: BRIDGE_VERSION,
    mode: "cli",
    platform: "linux",
    minProtocol: 4,
    maxProtocol: 4,
    // The public GatewayClientHostDeps contract makes identity and device-token
    // persistence host-owned. This store never opens OpenClaw shared state.
    hostDeps: identityStore.hostDeps,
    preferBootstrapToken: false,
    requestTimeoutMs: Number(env.OPENCLAW_GATEWAY_REQUEST_TIMEOUT_MS || 20_000),
  };
}

export function createOracleGatewayAdapter({
  env = process.env,
  handlers = {},
  logger = console,
  ClientClass = GatewayClient,
} = {}) {
  return new GatewayAdapter({
    ClientClass,
    readyTimeoutMs: Number(env.OPENCLAW_GATEWAY_READY_TIMEOUT_MS || 15_000),
    handlers,
    logger,
    clientOptions: buildOracleGatewayClientOptions(env),
  });
}

export function isUncertainGatewayFailure(error, requestWasSent) {
  if (!requestWasSent) return false;
  if (isGatewayTransportError(error)) return true;
  return isUncertainSubmissionFailure(error, requestWasSent);
}

export { OPERATOR_SCOPES };
