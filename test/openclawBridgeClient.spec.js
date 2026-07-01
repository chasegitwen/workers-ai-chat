import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOpenClawBridgeModeEnabled,
  normalizeOpenClawBridgeBaseUrl,
  openclawBridgeClient
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

  it("creates a bridge task through the bridge API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      task_id: "bridge-task-1",
      run_id: "run-1",
      sessionKey: "default",
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
      sessionKey: "default",
      idempotencyKey: "local-task-1"
    });

    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({
      taskId: "bridge-task-1",
      runId: "run-1",
      sessionKey: "default",
      status: "running"
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
});
