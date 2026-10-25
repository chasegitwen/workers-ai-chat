import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import { createSession } from "../src/lib/auth.js";
import { broadcastOpenClawBridgeEvent } from "../src/api/openclawBridgeEvents.js";

const CALLBACK_SECRET = "test-callback-secret";
const BRIDGE_ID = "openclaw-test-bridge";
const AUTH_ENV = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "password",
  SESSION_SECRET: "test-session-secret"
};
let db;

async function signCallback(timestamp, rawBody, secret = CALLBACK_SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(timestamp + "." + rawBody)
  );
  const hex = Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return "sha256=" + hex;
}

function callbackEnv() {
  return {
    DB: db,
    ...AUTH_ENV,
    OPENCLAW_CALLBACK_SECRET: CALLBACK_SECRET,
    OPENCLAW_CALLBACK_ALLOWED_BRIDGE_IDS: BRIDGE_ID
  };
}

async function authCookie() {
  return "wa_session=" + await createSession("admin", AUTH_ENV);
}

async function postCallback(payload, options = {}) {
  const rawBody = JSON.stringify(payload);
  const timestamp = options.timestamp || String(Date.now());
  const signature = options.signature || await signCallback(timestamp, rawBody, options.secret || CALLBACK_SECRET);
  const path = options.path || "/api/openclaw/bridge/callback";
  const response = await worker.fetch(new Request("http://example.com" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenClaw-Bridge-Id": options.bridgeId || BRIDGE_ID,
      "X-OpenClaw-Timestamp": timestamp,
      "X-OpenClaw-Signature": signature,
      "X-OpenClaw-Event-Id": payload.event_id || ""
    },
    body: rawBody
  }), { ...callbackEnv(), ...(options.env || {}) }, {});
  return response;
}

function basePayload(overrides = {}) {
  return {
    schema_version: "bridge_callback_v1",
    event_id: "evt_" + crypto.randomUUID(),
    task_id: "bridge_task_callback",
    conversation_id: "conversation_callback",
    assistant_message_id: "",
    event_type: "bridge.activity",
    sequence: 1,
    created_at: new Date().toISOString(),
    agent: "glm5-2",
    model: "zai/glm-5.2",
    execution_mode: "bridge",
    content: {
      text: "checking files",
      activity_type: "analysis"
    },
    metadata: {
      source: "openclaw",
      bridge_version: "milestone_2"
    },
    ...overrides
  };
}

class FakeStatement {
  constructor(fakeDb, sql) {
    this.fakeDb = fakeDb;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.fakeDb.first(this.sql, this.bindings);
  }

  async all() {
    return {
      results: this.fakeDb.all(this.sql, this.bindings)
    };
  }

  async run() {
    const changes = this.fakeDb.run(this.sql, this.bindings);
    return {
      success: true,
      meta: { changes: changes ?? 1 }
    };
  }
}

class FakeD1 {
  constructor() {
    this.bridgeEvents = new Map();
    this.openclawTasks = new Map();
    this.messages = new Map();
    this.conversations = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      await statement.run();
    }
  }

  first(sql, bindings) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.includes("from bridge_events")) {
      if (normalized.includes("task_id in")) {
        const ids = bindings.slice(0, -2);
        const [projectId, runtimeId] = bindings.slice(-2);
        const events = [...this.bridgeEvents.values()].filter(event => ids.includes(event.task_id)
          && String(event.project_id || "") === projectId && String(event.runtime_id || "") === runtimeId);
        if (normalized.includes("event_type = 'bridge.final'")) {
          return events.filter(event => event.event_type === "bridge.final")
            .sort((a, b) => Number(b.applied) - Number(a.applied) || String(a.received_at).localeCompare(String(b.received_at)))[0] || null;
        }
        return events.find(event => ["bridge.started", "bridge.activity", "bridge.tool_call", "bridge.tool_result", "bridge.heartbeat"].includes(event.event_type)) || null;
      }
      const event = this.bridgeEvents.get(bindings[0]);
      return event ? { ...event } : null;
    }
    if (normalized.includes("from openclaw_tasks") && normalized.includes("bridge_task_id")) {
      const taskId = bindings[0];
      const task = [...this.openclawTasks.values()].find(item =>
        item.bridge_task_id === taskId || item.remote_task_id === taskId || item.id === taskId
      );
      return task ? { ...task } : null;
    }
    if (normalized.includes("from openclaw_tasks") && normalized.includes("where id = ?")) {
      const task = this.openclawTasks.get(bindings[0]);
      return task ? { ...task } : null;
    }
    if (normalized.includes("from openclaw_tasks") && normalized.includes("assistant_message_id")) {
      const messageId = bindings[0];
      const task = [...this.openclawTasks.values()].find(item => item.assistant_message_id === messageId);
      return task ? { ...task } : null;
    }
    if (normalized.includes("from messages") && normalized.includes("role = 'assistant'")) {
      const message = this.messages.get(bindings[0]);
      return message?.role === "assistant" ? { ...message } : null;
    }
    return null;
  }

  all(sql, bindings) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.includes("from bridge_events")) {
      const ids = new Set(bindings.slice(0, -1).map(value => String(value || "")));
      const scoped = normalized.includes("coalesce(project_id");
      const scopedIds = scoped
        ? new Set(bindings.slice(0, -3).map(value => String(value || "")))
        : ids;
      const projectId = scoped ? String(bindings[bindings.length - 3] || "") : "";
      const runtimeId = scoped ? String(bindings[bindings.length - 2] || "") : "";
      return [...this.bridgeEvents.values()]
        .filter(event => scopedIds.has(String(event.task_id || "")) && Number(event.applied || 0) === 1)
        .filter(event => !scoped || (String(event.project_id || "") === projectId && String(event.runtime_id || "") === runtimeId))
        .sort((left, right) => {
          const leftSequence = left.sequence === null || left.sequence === undefined ? Number.MAX_SAFE_INTEGER : Number(left.sequence);
          const rightSequence = right.sequence === null || right.sequence === undefined ? Number.MAX_SAFE_INTEGER : Number(right.sequence);
          if (leftSequence !== rightSequence) {
            return leftSequence - rightSequence;
          }
          return String(left.received_at || "").localeCompare(String(right.received_at || ""));
        });
    }
    return [];
  }

  run(sql, bindings) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.startsWith("insert into bridge_events")) {
      this.bridgeEvents.set(bindings[0], {
        event_id: bindings[0],
        task_id: bindings[1],
        project_id: bindings[2],
        runtime_id: bindings[3],
        conversation_id: bindings[4],
        assistant_message_id: bindings[5],
        event_type: bindings[6],
        sequence: bindings[7],
        payload_json: bindings[8],
        created_at: bindings[9],
        received_at: bindings[10],
        bridge_id: bindings[11],
        applied: bindings[12],
        duplicate: bindings[13],
        error: bindings[14]
      });
      return;
    }
    if (normalized.startsWith("update bridge_events")) {
      const event = this.bridgeEvents.get(bindings[2]);
      if (event) {
        event.applied = bindings[0];
        event.error = bindings[1];
      }
      return;
    }
    if (normalized.startsWith("insert or ignore into messages")) {
      if (this.messages.has(bindings[0])) {
        return 0;
      }
      this.messages.set(bindings[0], {
        id: bindings[0],
        conversation_id: bindings[1],
        role: "assistant",
        content: bindings[2],
        created_at: bindings[3],
        metadata: bindings[4] || null
      });
      return 1;
    }
    if (normalized.startsWith("insert into messages")) {
      this.messages.set(bindings[0], {
        id: bindings[0],
        conversation_id: bindings[1],
        role: bindings[2],
        content: bindings[3],
        created_at: bindings[4],
        metadata: bindings[5] || null
      });
      return;
    }
    if (normalized.startsWith("update messages")) {
      const messageId = normalized.includes("metadata = coalesce") ? bindings[2] : bindings[1];
      const message = this.messages.get(messageId);
      if (message?.role === "assistant") {
        if (normalized.includes("json_extract") && JSON.parse(message.metadata || "{}").openclaw_completion?.source === "callback") return 0;
        message.content = bindings[0] || "";
        if (normalized.includes("metadata = coalesce") && bindings[1]) {
          message.metadata = bindings[1];
        }
      }
      return;
    }
    if (normalized.startsWith("update conversations")) {
      const conversationId = normalized.includes("where id = (") ? null : bindings[1];
      if (conversationId && this.conversations.has(conversationId)) {
        this.conversations.get(conversationId).updated_at = bindings[0];
      }
      return;
    }
    if (normalized.startsWith("update openclaw_tasks") && normalized.includes("cancelled_at = coalesce")) {
      const task = this.openclawTasks.get(bindings[8]);
      if (task) {
        const message = this.messages.get(task.assistant_message_id) || this.messages.get("openclaw-assistant-" + task.id);
        if (normalized.includes("and not exists") && JSON.parse(message?.metadata || "{}").openclaw_completion?.source === "callback") return 0;
        task.status = bindings[0];
        task.updated_at = bindings[1];
        task.completed_at = bindings[2] || task.completed_at;
        task.error = bindings[3];
        task.remote_status = bindings[4];
        task.remote_progress = bindings[5];
        task.remote_message = bindings[6];
        task.cancelled_at = bindings[7] || task.cancelled_at;
      }
      return;
    }
    if (normalized.startsWith("update openclaw_tasks") && normalized.includes("latency_ms = ?") && bindings.length === 7) {
      const task = this.openclawTasks.get(bindings[6]);
      if (task) {
        task.status = bindings[0];
        task.updated_at = bindings[1];
        task.completed_at = bindings[2];
        task.error = bindings[3];
        task.latency_ms = bindings[4];
        task.assistant_message_id = bindings[5];
      }
      return;
    }
    if (normalized.startsWith("update openclaw_tasks") && normalized.includes("set bridge_result_hash = ?") && bindings.length === 2) {
      const task = this.openclawTasks.get(bindings[1]);
      if (task) {
        task.bridge_result_hash = bindings[0];
      }
      return;
    }
    if (normalized.startsWith("update openclaw_tasks") && normalized.includes("bridge_result_hash")) {
      const task = this.openclawTasks.get(bindings[13]);
      if (task) {
        task.status = bindings[0];
        task.updated_at = bindings[1];
        task.completed_at = task.completed_at || bindings[2];
        task.error = bindings[3];
        task.latency_ms = task.latency_ms || Math.max(0, bindings[4] - task.started_at);
        task.assistant_message_id = bindings[5] || task.assistant_message_id;
        task.remote_status = bindings[6];
        task.remote_progress = bindings[7];
        task.remote_message = bindings[8];
        task.bridge_result_hash = bindings[9];
        task.bridge_last_seen_at = bindings[10];
        if (bindings[11] !== null && bindings[11] !== undefined) {
          task.bridge_last_sequence = Math.max(Number(task.bridge_last_sequence ?? -1), Number(bindings[12]));
        }
      }
      return;
    }
    if (normalized.startsWith("update openclaw_tasks") && normalized.includes("status != 'completed'")) {
      const task = this.openclawTasks.get(bindings[9]);
      if (task && task.status !== "completed") {
        task.status = bindings[0];
        task.updated_at = bindings[1];
        task.completed_at = task.completed_at || bindings[2];
        task.error = bindings[3];
        task.remote_status = bindings[4];
        task.remote_message = bindings[5];
        task.bridge_last_seen_at = bindings[6];
        if (bindings[7] !== null && bindings[7] !== undefined) {
          task.bridge_last_sequence = Math.max(Number(task.bridge_last_sequence ?? -1), Number(bindings[8]));
        }
      }
      return;
    }
    if (normalized.startsWith("update openclaw_tasks") && normalized.includes("remote_status = ?")) {
      const taskId = bindings[bindings.length - 1];
      const task = this.openclawTasks.get(taskId);
      if (task) {
        task.status = bindings[0];
        task.updated_at = bindings[1];
        task.remote_status = bindings[2];
        task.remote_progress = bindings[3];
        task.remote_message = bindings[4];
        task.bridge_last_seen_at = bindings[5];
        if (bindings.length === 8) {
          task.bridge_last_sequence = bindings[6];
        }
      }
    }
  }
}

async function createBridgeTask(overrides = {}) {
  const now = Date.now();
  const conversationId = overrides.conversation_id || "conversation_callback";
  const id = overrides.id || "local_callback_task";
  db.conversations.set(conversationId, {
    id: conversationId,
    title: "Callback test",
    created_at: now,
    updated_at: now
  });
  db.openclawTasks.set(id, {
    id,
    conversation_id: conversationId,
    provider: "openclaw-hillsboro",
    model: "openclaw/glm5-2",
    upstream_model_name: "zai/glm-5.2",
    prompt_preview: "callback prompt",
    status: overrides.status || "running",
    started_at: now,
    updated_at: now,
    completed_at: null,
    error: "",
    latency_ms: null,
    assistant_message_id: overrides.assistant_message_id || "",
    remote_task_id: overrides.remote_task_id || "bridge_task_callback",
    remote_status: overrides.remote_status || "running",
    remote_progress: overrides.remote_progress ?? 0,
    remote_message: overrides.remote_message || "",
    metadata: JSON.stringify({ source: "openclaw-bridge" }),
    bridge_task_id: overrides.bridge_task_id || "bridge_task_callback",
    bridge_agent_id: "glm5-2",
    bridge_mode_enabled: 1,
    project_id: overrides.project_id || "",
    runtime_id: overrides.runtime_id || "",
    runtime_slug: overrides.runtime_slug || overrides.runtime_id || "",
    bridge_result_hash: "",
    bridge_last_sequence: overrides.bridge_last_sequence ?? -1,
    bridge_last_seen_at: ""
  });
}

async function readTask() {
  return [...db.openclawTasks.values()].find(task => task.bridge_task_id === "bridge_task_callback");
}

describe("OpenClaw bridge callback endpoint", () => {
  beforeEach(async () => {
    db = new FakeD1();
    await createBridgeTask();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts a valid bridge.started callback", async () => {
    const payload = basePayload({
      event_type: "bridge.started",
      sequence: 1,
      content: { text: "started" }
    });

    const response = await postCallback(payload);
    const body = await response.json();
    const task = await readTask();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, applied: true, duplicate: false });
    expect(task.status).toBe("running");
    expect(task.remote_message).toBe("started");
  });

  it.each([
    "/api/openclaw/bridge/callback",
    "/api/openclaw/callback",
    "/api/bridge/callback"
  ])("accepts callback route alias %s", async path => {
    const payload = basePayload({
      event_type: "bridge.started",
      event_id: "evt_alias_" + path.replace(/[^a-z0-9]+/gi, "_"),
      sequence: 1
    });
    const response = await postCallback(payload, { path });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("logs diagnostics for legacy callbacks resolved to unscoped tasks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await postCallback(basePayload({
      event_id: "evt_legacy_scope_warning",
      event_type: "bridge.started",
      sequence: 1
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applied).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[openclaw-compat]",
      "bridge_callback_legacy_unscoped_task",
      expect.objectContaining({
        task_id: "local_callback_task",
        bridge_task_id: "bridge_task_callback",
        project_id: "",
        runtime_id: ""
      })
    );
  });

  it("stores bridge_events with task project and runtime scope for new tasks", async () => {
    db = new FakeD1();
    await createBridgeTask({
      project_id: "project-a",
      runtime_id: "hillsboro-openclaw"
    });
    const payload = basePayload({
      event_id: "evt_scoped_callback",
      project_id: "project-a",
      runtime_id: "hillsboro-openclaw",
      event_type: "bridge.started",
      sequence: 1
    });

    const response = await postCallback(payload);
    const body = await response.json();
    const event = db.bridgeEvents.get("evt_scoped_callback");

    expect(response.status).toBe(200);
    expect(body.applied).toBe(true);
    expect(event).toMatchObject({
      project_id: "project-a",
      runtime_id: "hillsboro-openclaw",
      applied: 1
    });
  });

  it("rejects callbacks with the wrong runtime_id for the resolved task", async () => {
    db = new FakeD1();
    await createBridgeTask({
      project_id: "default",
      runtime_id: "hillsboro-openclaw"
    });

    const response = await postCallback(basePayload({
      project_id: "default",
      runtime_id: "seattle-openclaw"
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, error: "runtime_id_mismatch" });
    expect(db.bridgeEvents.size).toBe(0);
  });

  it("rejects callbacks with the wrong project_id for the resolved task", async () => {
    db = new FakeD1();
    await createBridgeTask({
      project_id: "project-b",
      runtime_id: "hillsboro-openclaw"
    });

    const response = await postCallback(basePayload({
      project_id: "project-a",
      runtime_id: "hillsboro-openclaw"
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, error: "project_id_mismatch" });
    expect(db.bridgeEvents.size).toBe(0);
  });

  it("rejects callbacks signed with the wrong runtime HMAC secret", async () => {
    db = new FakeD1();
    await createBridgeTask({
      project_id: "default",
      runtime_id: "hillsboro-openclaw"
    });

    const response = await postCallback(basePayload({
      project_id: "default",
      runtime_id: "hillsboro-openclaw"
    }), {
      secret: "wrong-runtime-secret"
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "invalid_signature" });
    expect(db.bridgeEvents.size).toBe(0);
  });

  it("does not let Seattle runtime inherit the legacy Hillsboro callback secret", async () => {
    db = new FakeD1();
    await createBridgeTask({
      project_id: "default",
      runtime_id: "seattle-openclaw"
    });

    const response = await postCallback(basePayload({
      project_id: "default",
      runtime_id: "seattle-openclaw"
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "callback_secret_not_configured" });
    expect(db.bridgeEvents.size).toBe(0);
  });

  it("selects the Oracle callback secret from the stored task runtime", async () => {
    db = new FakeD1();
    await createBridgeTask({
      project_id: "default",
      runtime_id: "oracle-openclaw"
    });
    const payload = basePayload({
      event_id: "evt_oracle_secret",
      project_id: "default",
      runtime_id: "oracle-openclaw",
      event_type: "bridge.started"
    });
    const oracleSecret = "oracle-callback-secret";
    const accepted = await postCallback(payload, {
      secret: oracleSecret,
      env: { ORACLE_OPENCLAW_CALLBACK_SECRET: oracleSecret }
    });
    expect(accepted.status).toBe(200);

    payload.event_id = "evt_oracle_wrong_secret";
    const rejected = await postCallback(payload, {
      secret: CALLBACK_SECRET,
      env: { ORACLE_OPENCLAW_CALLBACK_SECRET: oracleSecret }
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ ok: false, error: "invalid_signature" });
  });

  it("updates message activity from bridge.activity", async () => {
    const response = await postCallback(basePayload({
      event_type: "bridge.activity",
      sequence: 2,
      content: { text: "正在检查文件结构..." }
    }));
    const body = await response.json();
    const task = await readTask();

    expect(body.applied).toBe(true);
    expect(task.status).toBe("running");
    expect(task.remote_message).toBe("正在检查文件结构...");
    expect(task.bridge_last_sequence).toBe(2);
  });

  it("updates status for bridge.tool_call", async () => {
    await postCallback(basePayload({
      event_type: "bridge.tool_call",
      sequence: 3,
      content: { tool_name: "list_files" }
    }));
    const task = await readTask();

    expect(task.status).toBe("tool_calling");
    expect(task.remote_message).toBe("Tool call: list_files");
  });

  it("stores final answer from bridge.final", async () => {
    const response = await postCallback(basePayload({
      event_type: "bridge.final",
      sequence: 4,
      content: { final_answer: "Final callback answer" }
    }));
    const body = await response.json();
    const task = await readTask();
    const message = db.messages.get(task.assistant_message_id);

    expect(body.applied).toBe(true);
    expect(task.status).toBe("completed");
    expect(task.remote_status).toBe("completed");
    expect(task.remote_progress).toBe(100);
    expect(message.content).toBe("Final callback answer");
    expect(JSON.parse(message.metadata)).toMatchObject({
      provider: "openclaw-hillsboro",
      model: "openclaw/glm5-2",
      model_label: "zai/glm-5.2"
    });
  });

  it("completes a task only once when final callbacks use different event_id values", async () => {
    const firstPayload = basePayload({
      event_id: "evt_final_first",
      event_type: "bridge.final",
      sequence: 4,
      content: { final_answer: "First final answer" }
    });
    const retryPayload = basePayload({
      event_id: "evt_final_retry",
      event_type: "bridge.final",
      sequence: 5,
      content: { final_answer: "Retry must not overwrite" }
    });

    const first = await postCallback(firstPayload);
    const retry = await postCallback(retryPayload);
    const task = await readTask();

    expect(await first.json()).toMatchObject({ applied: true, duplicate: false });
    expect(await retry.json()).toMatchObject({ applied: false, duplicate: false });
    expect(db.messages.size).toBe(1);
    expect(db.messages.get(task.assistant_message_id).content).toBe("First final answer");
    expect(db.bridgeEvents.get("evt_final_retry").error).toBe("final_not_applied");
  });

  it("converges concurrent final callbacks on one assistant message", async () => {
    const responses = await Promise.all([
      postCallback(basePayload({
        event_id: "evt_concurrent_final_a",
        event_type: "bridge.final",
        sequence: 8,
        content: { final_answer: "Concurrent final A" }
      })),
      postCallback(basePayload({
        event_id: "evt_concurrent_final_b",
        event_type: "bridge.final",
        sequence: 9,
        content: { final_answer: "Concurrent final B" }
      }))
    ]);
    const bodies = await Promise.all(responses.map(response => response.json()));
    const task = await readTask();

    expect(bodies.filter(body => body.applied).length).toBe(1);
    expect(db.messages.size).toBe(1);
    expect(db.messages.get(task.assistant_message_id).content).toMatch(/^Concurrent final [AB]$/);
  });

  it("keeps a polling-completed assistant message when a callback arrives later", async () => {
    const task = await readTask();
    task.status = "completed";
    task.remote_status = "completed";
    task.assistant_message_id = "polling-message";
    task.bridge_result_hash = "polling-result-hash";
    db.messages.set("polling-message", {
      id: "polling-message",
      conversation_id: task.conversation_id,
      role: "assistant",
      content: "Polling final answer",
      created_at: Date.now(),
      metadata: null
    });

    const response = await postCallback(basePayload({
      event_id: "evt_callback_after_polling",
      event_type: "bridge.final",
      sequence: 9,
      content: { final_answer: "Late callback answer" }
    }));

    expect(await response.json()).toMatchObject({ applied: false, duplicate: false });
    expect(db.messages.size).toBe(1);
    expect(db.messages.get("polling-message").content).toBe("Polling final answer");
  });

  it("repairs a polling-completed intermediate message when the authoritative final callback arrives", async () => {
    await postCallback(basePayload({ event_type: "bridge.started", sequence: 1 }));
    const task = await readTask();
    task.status = "completed";
    task.remote_status = "completed";
    task.bridge_last_sequence = 1;
    task.assistant_message_id = "polling-intermediate-message";
    task.bridge_result_hash = "polling-intermediate-hash";
    db.messages.set("polling-intermediate-message", {
      id: "polling-intermediate-message",
      conversation_id: task.conversation_id,
      role: "assistant",
      content: "即时 `top` 那一秒显示 CPU 系统态偏高，但负载很低、`vmstat` 后两秒基本空闲，像是采样瞬间波动。我再补一组 5 秒平均和关键服务资源占用，避免误判。",
      created_at: Date.now(),
      metadata: null
    });

    const response = await postCallback(basePayload({
      event_id: "evt_authoritative_final_after_polling",
      event_type: "bridge.final",
      sequence: 21,
      content: { final_answer: "当前 VPS 状态正常。CPU 约 93%-100% idle，内存可用约 650MiB。" }
    }));

    expect(await response.json()).toMatchObject({ applied: true, duplicate: false });
    expect(db.messages.size).toBe(1);
    expect(task.assistant_message_id).toBe("polling-intermediate-message");
    expect(db.messages.get("polling-intermediate-message").content).toContain("93%-100% idle");
    expect(task.bridge_last_sequence).toBe(21);
  });

  it("waits for the terminal callback regardless of the wording of a polling snapshot", async () => {
    const intermediate = "当前看起来负载很低，内存还有余量，swap 有少量使用。我再过滤一下过去 24 小时的系统日志，确认有没有 OOM、重启、服务失败或内存压力记录。";
    await postCallback(basePayload({ event_type: "bridge.started", sequence: 1 }));
    vi.stubGlobal("fetch", vi.fn(async input => Response.json({
      task: { task_id: "bridge_task_callback", status: "completed", final_answer: intermediate }
    })));
    const task = await readTask();
    const response = await worker.fetch(new Request(
      "http://example.com/api/openclaw/tasks/" + task.id + "/status",
      { headers: { Cookie: await authCookie() } }
    ), { ...callbackEnv(), OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test" }, {});
    expect(await response.json()).toMatchObject({
      task: { status: "recovering" }, resultRecovery: { incomplete: true, result_finality: "awaiting_final_event" }
    });
    expect(db.messages.size).toBe(0);
    expect(await (await postCallback(basePayload({ event_type: "bridge.activity", sequence: 43, content: { text: "采样仍在进行" } }))).json()).toMatchObject({ applied: true });
    const final = "CPU 正常。内存正常。Swap 正常。资源正常。资源正常。";
    expect(await (await postCallback(basePayload({ event_type: "bridge.final", sequence: 44, content: { final_answer: final } }))).json()).toMatchObject({ applied: true });
    expect(db.messages.size).toBe(1);
    expect(db.messages.get(task.assistant_message_id).content).toBe(final);
    expect(task.bridge_last_sequence).toBe(44);
  });

  it("recovers an older rejected final from the authenticated event ledger on /result without another Bridge request", async () => {
    await postCallback(basePayload({ event_type: "bridge.started", sequence: 1 }));
    const task = await readTask();
    task.status = "completed";
    task.assistant_message_id = "old-polling-snapshot";
    db.messages.set(task.assistant_message_id, {
      id: task.assistant_message_id, conversation_id: task.conversation_id, role: "assistant",
      content: "一段未被句式分类器识别的过程说明", metadata: null
    });
    const payload = basePayload({ event_id: "evt_old_rejected_final", event_type: "bridge.final", sequence: 44, content: { final_answer: "检查完了。CPU、内存和 Swap 的完整数据。" } });
    db.bridgeEvents.set(payload.event_id, {
      ...payload, payload_json: JSON.stringify(payload), applied: 0, error: "final_not_applied", received_at: new Date().toISOString()
    });
    const bridgeFetch = vi.fn();
    vi.stubGlobal("fetch", bridgeFetch);
    const response = await worker.fetch(new Request("http://example.com/api/openclaw/tasks/" + task.id + "/result", {
      headers: { Cookie: await authCookie() }
    }), callbackEnv(), {});
    expect(await response.json()).toMatchObject({ ok: true, saved: true, result: payload.content.final_answer });
    expect(db.messages.size).toBe(1);
    expect(db.messages.get(task.assistant_message_id).content).toBe(payload.content.final_answer);
    expect(db.bridgeEvents.get(payload.event_id)).toMatchObject({ applied: 1, error: "" });
    expect(bridgeFetch).not.toHaveBeenCalled();
  });

  it("accepts a verifiable polling final when progress callbacks arrived but the final callback was lost", async () => {
    await postCallback(basePayload({ event_type: "bridge.started", sequence: 1 }));
    const final = "资源正常。CPU idle 99%，内存可用 680MiB，Swap 251MiB。";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      task: { task_id: "bridge_task_callback", status: "completed", final_answer: "尚在检查", events: [
        { event_type: "bridge.final", sequence: 44, content: { final_answer: final } }
      ] }
    })));
    const task = await readTask();
    const response = await worker.fetch(new Request("http://example.com/api/openclaw/tasks/" + task.id + "/result", {
      headers: { Cookie: await authCookie() }
    }), { ...callbackEnv(), OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test" }, {});
    expect(await response.json()).toMatchObject({ ok: true, saved: true, result: final });
    expect(db.messages.size).toBe(1);
    expect(db.messages.get(task.assistant_message_id).content).toBe(final);
    expect(await (await postCallback(basePayload({ event_type: "bridge.final", sequence: 44, content: { final_answer: final } }))).json()).toMatchObject({ applied: false });
  });

  it("does not let a polling result in flight demote a terminal callback to recovering", async () => {
    await postCallback(basePayload({ event_type: "bridge.started", sequence: 1 }));
    const task = await readTask();
    vi.stubGlobal("fetch", vi.fn(async () => {
      await postCallback(basePayload({ event_type: "bridge.final", sequence: 44, content: { final_answer: "完整答案" } }));
      return Response.json({ task: { task_id: task.bridge_task_id, status: "completed", final_answer: "较早快照" } });
    }));
    await worker.fetch(new Request("http://example.com/api/openclaw/tasks/" + task.id + "/result", {
      headers: { Cookie: await authCookie() }
    }), { ...callbackEnv(), OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test" }, {});
    expect(task.status).toBe("completed");
    expect(db.messages.get(task.assistant_message_id).content).toBe("完整答案");
  });

  it("ignores final ledger entries belonging to another runtime or task", async () => {
    const task = await readTask();
    task.project_id = "project_current";
    task.runtime_id = "hillsboro-openclaw";
    const started = await postCallback(basePayload({ event_type: "bridge.started", sequence: 1, project_id: task.project_id, runtime_id: task.runtime_id }));
    expect(await started.json()).toMatchObject({ applied: true });
    for (const [id, taskId, runtimeId] of [
      ["evt_other_task", "another_bridge_task", task.runtime_id],
      ["evt_other_runtime", task.bridge_task_id, "another_runtime"]
    ]) {
      const payload = basePayload({ event_id: id, task_id: taskId, runtime_id: runtimeId, project_id: task.project_id,
        event_type: "bridge.final", sequence: 44, content: { final_answer: "不属于当前任务的完整答案" } });
      db.bridgeEvents.set(id, { ...payload, payload_json: JSON.stringify(payload), applied: 1, received_at: new Date().toISOString() });
    }
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ task: { status: "completed", final_answer: "当前任务的过程快照" } })));
    const response = await worker.fetch(new Request("http://example.com/api/openclaw/tasks/" + task.id + "/result", {
      headers: { Cookie: await authCookie() }
    }), { ...callbackEnv(), OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test" }, {});
    expect(await response.json()).toMatchObject({ ok: false, result_finality: "awaiting_final_event" });
    expect(db.messages.size).toBe(0);
  });

  it("keeps a remotely completed Bridge task recovering while /result is still intermediate", async () => {
    const intermediate = "即时 `top` 那一秒显示 CPU 系统态偏高，但负载很低、`vmstat` 后两秒基本空闲，像是采样瞬间波动。我再补一组 5 秒平均和关键服务资源占用，避免误判。";
    const finalAnswer = "当前 VPS 状态正常。CPU 约 93%-100% idle，内存可用约 650MiB。";
    let resultRequests = 0;
    const bridgeFetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return Response.json({
          task: {
            task_id: "bridge_task_callback",
            status: "completed",
            progress: 100
          }
        });
      }
      if (url.endsWith("/result")) {
        resultRequests += 1;
        return Response.json({
          task: {
            task_id: "bridge_task_callback",
            status: "completed",
            final_answer: resultRequests === 1 ? intermediate : finalAnswer
          }
        });
      }
      return Response.json({ error: "unexpected_url" }, { status: 404 });
    });
    vi.stubGlobal("fetch", bridgeFetch);

    const task = await readTask();
    const response = await worker.fetch(new Request(
      "http://example.com/api/openclaw/tasks/" + encodeURIComponent(task.id) + "/status",
      { headers: { Cookie: await authCookie() } }
    ), {
      ...callbackEnv(),
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test",
      OPENCLAW_BRIDGE_TOKEN: "bridge-token"
    }, {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task.status).toBe("recovering");
    expect(body.task.remote_status).toBe("completed");
    expect(body.resultRecovery).toMatchObject({
      ok: false,
      incomplete: true,
      recoverable: true,
      result_finality: "suspect_incomplete"
    });
    expect(db.messages.size).toBe(0);

    const recoveredResponse = await worker.fetch(new Request(
      "http://example.com/api/openclaw/tasks/" + encodeURIComponent(task.id) + "/status",
      { headers: { Cookie: await authCookie() } }
    ), {
      ...callbackEnv(),
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test",
      OPENCLAW_BRIDGE_TOKEN: "bridge-token"
    }, {});
    const recoveredBody = await recoveredResponse.json();

    expect(recoveredResponse.status).toBe(200);
    expect(recoveredBody.task.status).toBe("completed");
    expect(recoveredBody.resultRecovery).toMatchObject({
      ok: true,
      incomplete: false,
      result_finality: "final"
    });
    expect(db.messages.size).toBe(1);
    expect([...db.messages.values()][0].content).toBe(finalAnswer);
    expect((await readTask()).bridge_result_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(bridgeFetch).toHaveBeenCalledTimes(4);
  });

  it("treats polling result finalization after callback completion as a duplicate", async () => {
    await postCallback(basePayload({
      event_id: "evt_callback_before_polling",
      event_type: "bridge.final",
      sequence: 7,
      content: { final_answer: "Callback final answer" }
    }));
    const task = await readTask();

    const response = await worker.fetch(new Request(
      "http://example.com/api/openclaw/tasks/" + encodeURIComponent(task.id) + "/result",
      { headers: { Cookie: await authCookie() } }
    ), callbackEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, saved: false, duplicate: true });
    expect(db.messages.size).toBe(1);
    expect(db.messages.get(task.assistant_message_id).content).toBe("Callback final answer");
  });

  it("treats duplicate event_id as idempotent", async () => {
    const payload = basePayload({
      event_id: "evt_duplicate_callback",
      event_type: "bridge.activity",
      sequence: 5,
      content: { text: "first activity" }
    });

    const first = await postCallback(payload);
    const second = await postCallback(payload);
    const firstBody = await first.json();
    const secondBody = await second.json();
    const count = [...db.bridgeEvents.values()].filter(event => event.event_id === "evt_duplicate_callback").length;

    expect(firstBody).toMatchObject({ ok: true, applied: true, duplicate: false });
    expect(secondBody).toMatchObject({ ok: true, applied: false, duplicate: true });
    expect(count).toBe(1);
  });

  it("does not let an old sequence overwrite newer activity", async () => {
    await postCallback(basePayload({
      event_type: "bridge.activity",
      sequence: 10,
      content: { text: "new activity" }
    }));
    const response = await postCallback(basePayload({
      event_type: "bridge.activity",
      sequence: 9,
      content: { text: "old activity" }
    }));
    const body = await response.json();
    const task = await readTask();

    expect(body.applied).toBe(false);
    expect(task.remote_message).toBe("new activity");
    expect(task.bridge_last_sequence).toBe(10);
  });

  it("does not let later activity overwrite a final answer", async () => {
    await postCallback(basePayload({
      event_type: "bridge.final",
      sequence: 20,
      content: { text: "Final remains" }
    }));
    await postCallback(basePayload({
      event_type: "bridge.activity",
      sequence: 21,
      content: { text: "late activity" }
    }));
    const task = await readTask();
    const message = db.messages.get(task.assistant_message_id);

    expect(task.status).toBe("completed");
    expect(message.content).toBe("Final remains");
    expect(task.remote_message).toBe("OpenClaw Bridge final received");
  });

  it("does not let a late final callback overwrite a canceled task", async () => {
    db = new FakeD1();
    await createBridgeTask({
      status: "cancelled",
      remote_status: "cancelled",
      project_id: "default",
      runtime_id: "hillsboro-openclaw"
    });
    const response = await postCallback(basePayload({
      event_id: "evt_late_final_after_cancel",
      project_id: "default",
      runtime_id: "hillsboro-openclaw",
      event_type: "bridge.final",
      sequence: 99,
      content: { final_answer: "must not replace cancellation" }
    }));
    const body = await response.json();
    const task = await readTask();
    expect(response.status).toBe(200);
    expect(body.applied).toBe(false);
    expect(task.status).toBe("cancelled");
    expect(task.remote_status).toBe("cancelled");
    expect(task.assistant_message_id).toBe("");
  });

  it("rejects invalid signatures", async () => {
    const response = await postCallback(basePayload(), {
      signature: "sha256=bad"
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "invalid_signature" });
  });

  it("rejects stale timestamps", async () => {
    const stale = String(Date.now() - 10 * 60 * 1000);
    const response = await postCallback(basePayload(), {
      timestamp: stale
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "stale_timestamp" });
  });

  it("stores unknown event_type without crashing or changing task status", async () => {
    const response = await postCallback(basePayload({
      event_id: "evt_unknown_callback",
      event_type: "bridge.mystery",
      sequence: 30,
      content: { text: "unknown" }
    }));
    const body = await response.json();
    const task = await readTask();
    const event = db.bridgeEvents.get("evt_unknown_callback");

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, applied: false, duplicate: false });
    expect(task.status).toBe("running");
    expect(task.remote_message).toBe("");
    expect(event.error).toBe("unknown_event_type");
  });

  it("requires login for the bridge event stream", async () => {
    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=local_callback_task"), callbackEnv(), {});

    expect(response.status).toBe(401);
  });

  it("rejects bridge event stream access for an unknown task", async () => {
    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=missing", {
      headers: {
        Cookie: await authCookie()
      }
    }), callbackEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("OpenClaw task not found");
  });

  it("streams historical bridge_events before listening live", async () => {
    await postCallback(basePayload({
      event_id: "evt_history_1",
      event_type: "bridge.activity",
      sequence: 7,
      content: { text: "historical activity" }
    }));

    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=local_callback_task", {
      headers: {
        Cookie: await authCookie()
      }
    }), callbackEnv(), {});
    const reader = response.body.getReader();
    const first = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(first.value);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(text).toContain("event: bridge_event");
    expect(text).toContain("evt_history_1");
    expect(text).toContain("historical activity");
  });

  it("logs diagnostics when legacy unscoped SSE replay is used", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await postCallback(basePayload({
      event_id: "evt_legacy_sse_warning",
      event_type: "bridge.activity",
      sequence: 7,
      content: { text: "legacy replay activity" }
    }));

    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=local_callback_task", {
      headers: {
        Cookie: await authCookie()
      }
    }), callbackEnv(), {});
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      "[openclaw-bridge-events-compat]",
      "legacy_unscoped_sse_subscription",
      expect.objectContaining({
        requested_task_id: "local_callback_task",
        project_id: "",
        runtime_id: ""
      })
    );
    expect(warn).toHaveBeenCalledWith(
      "[openclaw-bridge-events-compat]",
      "legacy_unscoped_sse_replay",
      expect.objectContaining({
        task_id: "local_callback_task",
        bridge_task_id: "bridge_task_callback",
        runtime_id: ""
      })
    );
  });

  it("keeps Hillsboro events out of a Seattle-scoped live stream", async () => {
    db = new FakeD1();
    await createBridgeTask({
      id: "local_seattle_task",
      bridge_task_id: "shared_runtime_task",
      remote_task_id: "shared_runtime_task",
      project_id: "default",
      runtime_id: "seattle-openclaw"
    });

    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=local_seattle_task&project_id=default&runtime_id=seattle-openclaw", {
      headers: {
        Cookie: await authCookie()
      }
    }), callbackEnv(), {});
    const reader = response.body.getReader();
    await reader.read();

    const delivered = broadcastOpenClawBridgeEvent({
      event_id: "evt_hillsboro_not_seattle",
      task_id: "local_seattle_task",
      project_id: "default",
      runtime_id: "hillsboro-openclaw",
      event_type: "bridge.activity",
      content: { text: "wrong runtime" }
    });
    await reader.cancel();

    expect(response.status).toBe(200);
    expect(delivered).toBe(0);
  });

  it("keeps Project A events out of a Project B live stream", async () => {
    db = new FakeD1();
    await createBridgeTask({
      id: "local_project_b_task",
      bridge_task_id: "shared_project_task",
      remote_task_id: "shared_project_task",
      project_id: "project-b",
      runtime_id: "hillsboro-openclaw"
    });

    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=local_project_b_task&project_id=project-b&runtime_id=hillsboro-openclaw", {
      headers: {
        Cookie: await authCookie()
      }
    }), callbackEnv(), {});
    const reader = response.body.getReader();
    await reader.read();

    const delivered = broadcastOpenClawBridgeEvent({
      event_id: "evt_project_a_not_b",
      task_id: "local_project_b_task",
      project_id: "project-a",
      runtime_id: "hillsboro-openclaw",
      event_type: "bridge.activity",
      content: { text: "wrong project" }
    });
    await reader.cancel();

    expect(response.status).toBe(200);
    expect(delivered).toBe(0);
  });

  it("broadcasts applied callback events to subscribed stream clients once", async () => {
    const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/events/stream?task_id=local_callback_task", {
      headers: {
        Cookie: await authCookie()
      }
    }), callbackEnv(), {});
    const reader = response.body.getReader();
    await reader.read();

    const payload = basePayload({
      event_id: "evt_live_1",
      event_type: "bridge.activity",
      sequence: 8,
      content: { text: "live activity" }
    });
    const firstCallback = await postCallback(payload);
    const secondCallback = await postCallback(payload);
    const chunk = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(chunk.value);

    expect((await firstCallback.json()).duplicate).toBe(false);
    expect((await secondCallback.json()).duplicate).toBe(true);
    expect(text).toContain("evt_live_1");
    expect(text).toContain("live activity");
  });
});
