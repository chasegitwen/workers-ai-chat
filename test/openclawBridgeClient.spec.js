import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOpenClawBridgeModeEnabled,
  normalizeOpenClawAgentId,
  normalizeOpenClawBridgeBaseUrl,
  normalizeOpenClawBridgeTaskProgress,
  openclawBridgeClient,
  shouldUseOpenClawBridge
} from "../src/api/openclawBridgeClient.js";

const env = {
  OPENCLAW_BRIDGE_MODE: "true",
  OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test/",
  OPENCLAW_BRIDGE_TOKEN: "secret-token"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openclawBridgeClient", () => {
  it("normalizes config and detects the mode switch", () => {
    expect(isOpenClawBridgeModeEnabled(env)).toBe(true);
    expect(isOpenClawBridgeModeEnabled({ OPENCLAW_BRIDGE_MODE: "false" })).toBe(false);
    expect(normalizeOpenClawBridgeBaseUrl("https://bridge.example.test///")).toBe("https://bridge.example.test");
  });

  it("selects bridge mode from OpenClaw provider settings before env fallback", () => {
    expect(shouldUseOpenClawBridge({ type: "openclaw", openclawExecutionMode: "bridge" }, {
      OPENCLAW_BRIDGE_MODE: "false"
    })).toBe(true);
    expect(shouldUseOpenClawBridge({ type: "openclaw", openclawExecutionMode: "legacy" }, env)).toBe(false);
    expect(shouldUseOpenClawBridge({ type: "openclaw" }, env)).toBe(true);
    expect(shouldUseOpenClawBridge({ type: "openclaw" }, {})).toBe(false);
  });

  it("never enables bridge mode for non-OpenClaw providers", () => {
    expect(shouldUseOpenClawBridge({ type: "openai", openclawExecutionMode: "bridge" }, env)).toBe(false);
    expect(shouldUseOpenClawBridge({ type: "workers-ai" }, env)).toBe(false);
  });

  it("normalizes bridge task progress by terminal status", () => {
    expect(normalizeOpenClawBridgeTaskProgress("completed", 0, 20)).toBe(100);
    expect(normalizeOpenClawBridgeTaskProgress("done", null, 20)).toBe(100);
    expect(normalizeOpenClawBridgeTaskProgress("success", undefined, null)).toBe(100);
    expect(normalizeOpenClawBridgeTaskProgress("failed", null, 35)).toBe(35);
    expect(normalizeOpenClawBridgeTaskProgress("error", undefined, null)).toBe(0);
    expect(normalizeOpenClawBridgeTaskProgress("running", 42, 10)).toBe(42);
    expect(normalizeOpenClawBridgeTaskProgress("queued", null, 10)).toBe(10);
    expect(normalizeOpenClawBridgeTaskProgress("queued", null, null)).toBe(null);
  });

  it("normalizes OpenClaw model ids to canonical bridge agent ids", () => {
    expect(normalizeOpenClawAgentId("openclaw/main")).toBe("main");
    expect(normalizeOpenClawAgentId("openclaw/glm51")).toBe("glm51");
    expect(normalizeOpenClawAgentId("openclaw/kimi-for-coding")).toBe("kimi-for-coding");
    expect(normalizeOpenClawAgentId("openclaw/glm5-2")).toBe("glm5-2");
    expect(normalizeOpenClawAgentId("main")).toBe("main");
    expect(normalizeOpenClawAgentId("glm51")).toBe("glm51");
    expect(normalizeOpenClawAgentId("kimi-for-coding")).toBe("kimi-for-coding");
    expect(normalizeOpenClawAgentId("glm5-2")).toBe("glm5-2");
  });

  it.each([
    ["openclaw/main", "main"],
    ["openclaw/glm51", "glm51"],
    ["openclaw/kimi-for-coding", "kimi-for-coding"],
    ["openclaw/glm5-2", "glm5-2"]
  ])("submits %s as bridge agent %s", async (modelName, agentId) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      task_id: "bridge-task-1",
      run_id: "run-1",
      sessionKey: "agent:" + agentId + ":conversation-1",
      sessionId: "agent:" + agentId + ":conversation-1",
      agentId,
      status: "running"
    }), {
      status: 202,
      headers: {
        "Content-Type": "application/json"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const sessionKey = "agent:" + agentId + ":conversation-1";
    const result = await openclawBridgeClient(env).createTask({
      conversationId: "conversation-1",
      message: "hello",
      sessionKey,
      sessionId: sessionKey,
      agentId: normalizeOpenClawAgentId(modelName),
      idempotencyKey: "local-task-1"
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(result.task).toMatchObject({
      agentId,
      sessionKey,
      sessionId: sessionKey
    });
    expect(body).toMatchObject({
      conversation_id: "conversation-1",
      agentId,
      sessionKey,
      sessionId: sessionKey,
      idempotencyKey: "local-task-1"
    });
  });

  it("creates a bridge task through the bridge API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      task_id: "bridge-task-1",
      run_id: "run-1",
      sessionKey: "agent:main:conversation-1",
      sessionId: "agent:main:conversation-1",
      agentId: "main",
      status: "running"
    }), {
      status: 202,
      headers: {
        "Content-Type": "application/json"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openclawBridgeClient(env).createTask({
      conversationId: "conversation-1",
      message: "hello",
      sessionKey: "agent:main:conversation-1",
      sessionId: "agent:main:conversation-1",
      agentId: "main",
      idempotencyKey: "local-task-1"
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({
      taskId: "bridge-task-1",
      runId: "run-1",
      sessionKey: "agent:main:conversation-1",
      sessionId: "agent:main:conversation-1",
      agentId: "main",
      status: "running"
    });
    expect(body).toMatchObject({
      sessionKey: "agent:main:conversation-1",
      sessionId: "agent:main:conversation-1",
      agentId: "main"
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://bridge.example.test/v1/openclaw/tasks");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer secret-token");
    expect(fetchMock.mock.calls[0][0]).not.toContain("/v1/chat/completions");
  });

  it("returns structured errors for non-2xx bridge responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "Bridge exploded"
    }), {
      status: 503,
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const result = await openclawBridgeClient(env).getTaskStatus("bridge-task-1");

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      error: "Bridge exploded"
    });
  });

  it("proxies status, result, and cancel to bridge task endpoints", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      status: "completed",
      result: "done"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = openclawBridgeClient(env);

    await client.getTaskStatus("bridge-task-1");
    await client.getTaskResult("bridge-task-1");
    await client.cancelTask("bridge-task-1");

    expect(fetchMock.mock.calls.map(call => [call[1].method || "GET", call[0]])).toEqual([
      ["GET", "https://bridge.example.test/v1/openclaw/tasks/bridge-task-1/status"],
      ["GET", "https://bridge.example.test/v1/openclaw/tasks/bridge-task-1/result"],
      ["POST", "https://bridge.example.test/v1/openclaw/tasks/bridge-task-1/cancel"]
    ]);
  });

  it("reports completed bridge task status with 100 progress", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      task: {
        task_id: "bridge-task-1",
        status: "completed",
        progress: 0,
        result: "done"
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    })));

    const result = await openclawBridgeClient(env).getTaskStatus("bridge-task-1");

    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({
      taskId: "bridge-task-1",
      status: "completed",
      progress: 100
    });
  });
});
