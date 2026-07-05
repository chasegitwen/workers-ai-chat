import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { createSession } from "../src/lib/auth.js";

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
  const response = await worker.fetch(new Request("http://example.com/api/openclaw/bridge/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OpenClaw-Bridge-Id": options.bridgeId || BRIDGE_ID,
      "X-OpenClaw-Timestamp": timestamp,
      "X-OpenClaw-Signature": signature,
      "X-OpenClaw-Event-Id": payload.event_id || ""
    },
    body: rawBody
  }), callbackEnv(), {});
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
    this.fakeDb.run(this.sql, this.bindings);
    return {
      success: true,
      meta: { changes: 1 }
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
      return [...this.bridgeEvents.values()]
        .filter(event => ids.has(String(event.task_id || "")) && Number(event.applied || 0) === 1)
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
        conversation_id: bindings[2],
        assistant_message_id: bindings[3],
        event_type: bindings[4],
        sequence: bindings[5],
        payload_json: bindings[6],
        created_at: bindings[7],
        received_at: bindings[8],
        bridge_id: bindings[9],
        applied: bindings[10],
        duplicate: bindings[11],
        error: bindings[12]
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
    if (normalized.startsWith("insert into messages")) {
      this.messages.set(bindings[0], {
        id: bindings[0],
        conversation_id: bindings[1],
        role: bindings[2],
        content: bindings[3],
        created_at: bindings[4]
      });
      return;
    }
    if (normalized.startsWith("update messages")) {
      const message = this.messages.get(bindings[1]);
      if (message?.role === "assistant") {
        message.content = bindings[0] || "";
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
