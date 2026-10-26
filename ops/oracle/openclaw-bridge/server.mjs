#!/usr/bin/env node
/** Oracle-specific OpenClaw Bridge production entrypoint. */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCallbackClient, resolveCallbackConfig } from "./callback.mjs";
import { createOracleGatewayAdapter, resolveBridgeIdentityStateDir } from "./gateway-runtime.mjs";
import { createBridgeApplication } from "./bridge-service.mjs";
import { BRIDGE_VERSION } from "./version.mjs";

const INSTALL_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.OPENCLAW_BRIDGE_STATE_DIR || "/home/ubuntu/.local/state/openclaw-bridge";
const DB_PATH = process.env.OPENCLAW_BRIDGE_DB_PATH || path.join(STATE_DIR, "openclaw_bridge.sqlite");
const CALLBACK_CONFIG_PATH = process.env.OPENCLAW_BRIDGE_CALLBACK_CONFIG || path.join(INSTALL_DIR, "callback.json");
const HOST = process.env.OPENCLAW_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.OPENCLAW_BRIDGE_PORT || 18793);
const TOKEN = process.env.OPENCLAW_BRIDGE_TOKEN || "";
const IDENTITY_STATE_DIR = resolveBridgeIdentityStateDir(process.env);

if (!TOKEN) throw new Error("OPENCLAW_BRIDGE_TOKEN is required");
await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
await fs.mkdir(IDENTITY_STATE_DIR, { recursive: true, mode: 0o700 });
await fs.chmod(IDENTITY_STATE_DIR, 0o700);

let callbackClient = null;
try {
  const config = await fs.readFile(CALLBACK_CONFIG_PATH, "utf8").then(JSON.parse).catch(() => null);
  if (config) {
    callbackClient = createCallbackClient({
      ...resolveCallbackConfig(config.bridge_callback || config, process.env),
      logger: console,
    });
  }
} catch (error) {
  console.warn(`[callback] disabled: ${error instanceof Error ? error.message : String(error)}`);
}

const runtime = createBridgeApplication({
  dbPath: DB_PATH,
  token: TOKEN,
  host: HOST,
  port: PORT,
  maxBodyBytes: Number(process.env.OPENCLAW_BRIDGE_MAX_BODY_BYTES || 24 * 1024 * 1024),
  recoveryDeadlineMs: Number(process.env.OPENCLAW_BRIDGE_RECOVERY_DEADLINE_MS || 240_000),
  maxSessionCreateAttempts: Math.min(2, Number(process.env.OPENCLAW_BRIDGE_SESSION_CREATE_MAX_ATTEMPTS || 2)),
  recoveryHistoryLimit: Number(process.env.OPENCLAW_BRIDGE_RECOVERY_HISTORY_LIMIT || 80),
  callbackClient,
  gatewayFactory: (handlers) => createOracleGatewayAdapter({ handlers }),
});

await runtime.app.listen();
console.log(`openclaw-bridge ${BRIDGE_VERSION} listening on http://${HOST}:${PORT}`);
void runtime.controller.start(Number(process.env.OPENCLAW_BRIDGE_RECOVERY_SWEEP_MS || 20_000)).catch((error) => {
  runtime.controller.lastRecoveryError = error instanceof Error ? error.message : String(error);
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await runtime.close();
      process.exit(0);
    } catch (error) {
      console.error(`openclaw-bridge shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
}
