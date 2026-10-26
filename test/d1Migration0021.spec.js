import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src";

// Runs the repository migrations against local Miniflare D1 (remoteBindings is
// disabled in vitest.config.js); no production data is involved.
const CALLBACK_SECRET = "migration-test-callback-secret";
const HILLSBORO_BRIDGE_ID = "hetzner-main";

function migrationsBefore0021() {
  return env.TEST_MIGRATIONS.filter(migration => migration.name < "0021");
}

function migration0021() {
  const migration = env.TEST_MIGRATIONS.find(item => item.name.startsWith("0021_"));
  expect(migration).toBeTruthy();
  return migration;
}

async function seedTask(id, provider, bridgeTaskId, { bridgeMode = 1, projectId = "", runtimeId = null } = {}) {
  await env.DB.prepare(
    `INSERT INTO openclaw_tasks (
      id, conversation_id, provider, model, status, started_at, updated_at,
      remote_task_id, bridge_task_id, bridge_mode_enabled, project_id, runtime_id, runtime_slug
    ) VALUES (?, 'conversation-migration', ?, 'openclaw/main', 'running', 1, 1, ?, ?, ?, ?, ?, ?)`
  ).bind(id, provider, bridgeTaskId, bridgeTaskId, bridgeMode, projectId, runtimeId, runtimeId).run();
}

async function seedEvent(eventId, taskId, projectId = "", runtimeId = "") {
  await env.DB.prepare(
    `INSERT INTO bridge_events (
      event_id, task_id, conversation_id, event_type, sequence, payload_json,
      received_at, bridge_id, applied, duplicate, error, project_id, runtime_id
    ) VALUES (?, ?, 'conversation-migration', 'bridge.activity', 1, '{}', ?, 'hetzner-main', 1, 0, '', ?, ?)`
  ).bind(eventId, taskId, new Date().toISOString(), projectId, runtimeId).run();
}

async function taskRuntime(id) {
  return env.DB.prepare("SELECT runtime_id, runtime_slug, runtime_resolution_source FROM openclaw_tasks WHERE id = ?").bind(id).first();
}

async function eventRuntime(eventId) {
  return (await env.DB.prepare("SELECT runtime_id FROM bridge_events WHERE event_id = ?").bind(eventId).first())?.runtime_id ?? null;
}

async function signedStartedCallback(bridgeTaskId, eventId) {
  const payload = {
    schema_version: "bridge_callback_v1",
    event_id: eventId,
    task_id: bridgeTaskId,
    conversation_id: "conversation-migration",
    event_type: "bridge.started",
    sequence: 1,
    created_at: new Date().toISOString(),
    content: { text: "started" },
    metadata: { source: "openclaw" }
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(CALLBACK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + rawBody));
  const hex = Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  return worker.fetch(new Request("http://example.com/api/openclaw/bridge/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenClaw-Bridge-Id": HILLSBORO_BRIDGE_ID,
      "X-OpenClaw-Timestamp": timestamp,
      "X-OpenClaw-Signature": "sha256=" + hex,
      "X-OpenClaw-Event-Id": eventId
    },
    body: rawBody
  }), {
    DB: env.DB,
    OPENCLAW_CALLBACK_SECRET: CALLBACK_SECRET,
    OPENCLAW_CALLBACK_ALLOWED_BRIDGE_IDS: HILLSBORO_BRIDGE_ID
  }, {});
}

describe("D1 migration 0021 (legacy Hillsboro bridge task runtime backfill)", () => {
  it("must run before the Worker that requires a bound runtime: legacy callbacks fail closed until it is applied", async () => {
    await applyD1Migrations(env.DB, migrationsBefore0021());
    await seedTask("legacy-hillsboro", "openclaw-hillsboro", "bt-legacy-hillsboro");

    const beforeMigration = await signedStartedCallback("bt-legacy-hillsboro", "evt-before-0021");
    expect(beforeMigration.status).toBe(401);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM bridge_events").first()).toMatchObject({ count: 0 });

    await applyD1Migrations(env.DB, [migration0021()]);
    const afterMigration = await signedStartedCallback("bt-legacy-hillsboro", "evt-after-0021");
    expect(afterMigration.status).toBe(200);
    expect(await afterMigration.json()).toMatchObject({ ok: true, applied: true });
    expect(await env.DB.prepare("SELECT runtime_id, applied FROM bridge_events WHERE event_id = ?").bind("evt-after-0021").first())
      .toEqual({ runtime_id: "hillsboro-openclaw", applied: 1 });
  });

  it("binds only legacy Hillsboro bridge tasks and their ledger rows, and is idempotent", async () => {
    await applyD1Migrations(env.DB, migrationsBefore0021());
    await seedTask("legacy-hill", "openclaw-hillsboro", "bt-legacy");
    await seedTask("legacy-generic", "openclaw", "bt-generic", { projectId: "default", runtimeId: "" });
    await seedTask("seattle-legacy", "openclaw-seattle", null, { bridgeMode: 0 });
    await seedTask("seattle-bridge-like", "openclaw-seattle", "bt-seattle");
    await seedTask("oracle", "openclaw-oracle", "bt-oracle", { projectId: "default", runtimeId: "oracle-openclaw" });
    await seedTask("oracle-unbound", "openclaw-oracle", "bt-oracle-unbound", { projectId: "default", runtimeId: "" });
    await seedTask("plain", "workers-ai", null, { bridgeMode: 0 });
    await seedEvent("e-legacy", "bt-legacy");
    await seedEvent("e-generic", "bt-generic", "default");
    await seedEvent("e-generic-other-project", "bt-generic", "other");
    await seedEvent("e-oracle", "bt-oracle", "default", "oracle-openclaw");
    await seedEvent("e-seattle", "bt-seattle");

    await applyD1Migrations(env.DB, [migration0021()]);
    const snapshot = async () => ({
      tasks: (await env.DB.prepare("SELECT id, runtime_id, runtime_slug, runtime_resolution_source FROM openclaw_tasks ORDER BY id").all()).results,
      events: (await env.DB.prepare("SELECT event_id, runtime_id FROM bridge_events ORDER BY event_id").all()).results
    });
    const once = await snapshot();
    // Re-running every statement changes nothing.
    for (const query of migration0021().queries) {
      await env.DB.prepare(query).run();
    }
    expect(await snapshot()).toEqual(once);

    expect(await taskRuntime("legacy-hill")).toEqual({
      runtime_id: "hillsboro-openclaw", runtime_slug: "hillsboro-openclaw", runtime_resolution_source: "legacy_bridge_backfill_0021"
    });
    expect((await taskRuntime("legacy-generic")).runtime_id).toBe("hillsboro-openclaw");
    expect((await taskRuntime("seattle-legacy")).runtime_id).toBeNull();
    expect((await taskRuntime("seattle-bridge-like")).runtime_id).toBeNull();
    expect((await taskRuntime("oracle")).runtime_id).toBe("oracle-openclaw");
    expect((await taskRuntime("oracle-unbound")).runtime_id).toBe("");
    expect((await taskRuntime("plain")).runtime_id).toBeNull();
    expect(await eventRuntime("e-legacy")).toBe("hillsboro-openclaw");
    expect(await eventRuntime("e-generic")).toBe("hillsboro-openclaw");
    expect(await eventRuntime("e-generic-other-project")).toBe("");
    expect(await eventRuntime("e-oracle")).toBe("oracle-openclaw");
    expect(await eventRuntime("e-seattle")).toBe("");
  });
});
