import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER,
  classifyOpenClawBridgeResultFinality,
  extractOpenClawBridgeFinalAnswer,
  isOpenClawBridgeModeEnabled,
  isOpenClawBridgeEmptyReplyPlaceholder,
  normalizeOpenClawAgentId,
  normalizeOpenClawBridgeBaseUrl,
  normalizeOpenClawBridgeTaskProgress,
  openclawBridgeClient,
  shouldRecoverOpenClawBridgeCompletedStatus,
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
    expect(normalizeOpenClawAgentId("glm-5.1")).toBe("glm51");
    expect(normalizeOpenClawAgentId("zai/glm-5.1")).toBe("glm51");
    expect(normalizeOpenClawAgentId("kimi-for-coding")).toBe("kimi-for-coding");
    expect(normalizeOpenClawAgentId("glm5-2")).toBe("glm5-2");
    expect(normalizeOpenClawAgentId("glm-5.2")).toBe("glm5-2");
    expect(normalizeOpenClawAgentId("zai/glm-5.2")).toBe("glm5-2");
    expect(normalizeOpenClawAgentId({
      modelName: "openclaw",
      upstreamModelName: "",
      id: "glm-5.1"
    })).toBe("glm51");
    expect(normalizeOpenClawAgentId({
      modelName: "",
      upstreamModelName: "zai/glm-5.1",
      id: "openclaw-hillsboro-glm51"
    })).toBe("glm51");
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
      agent_id: agentId,
      session_key: sessionKey,
      session_id: sessionKey,
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
      agentId: "main",
      session_key: "agent:main:conversation-1",
      session_id: "agent:main:conversation-1",
      agent_id: "main"
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

  it("prefers final_answer over result and text for bridge result compatibility", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      final_answer: "final answer value",
      result: "result value",
      text: "text value"
    });

    expect(result).toMatchObject({
      text: "final answer value",
      finality: "final"
    });
  });

  it("prefers result over text when final_answer is absent", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      result: "result value",
      text: "text value"
    });

    expect(result).toMatchObject({
      text: "result value",
      finality: "final"
    });
  });

  it("falls back to text when final_answer and result are absent", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      text: "text value"
    });

    expect(result).toMatchObject({
      text: "text value",
      finality: "final"
    });
  });

  it("extracts the latest successful bridge assistant answer after an error placeholder", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      events: [
        {
          seq: 33,
          role: "assistant",
          stopReason: "error",
          content: OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER
        },
        {
          seq: 34,
          role: "assistant",
          status: "completed",
          content: "intermediate success"
        },
        {
          seq: 37,
          role: "assistant",
          status: "completed",
          content: "final recovered answer"
        }
      ]
    });

    expect(result).toMatchObject({
      text: "final recovered answer",
      finality: "final",
      placeholderOnly: false
    });
  });

  it("classifies short bridge lead-ins as suspect incomplete", () => {
    expect(classifyOpenClawBridgeResultFinality("我来检查一下 VPS 的运行状态和最近的攻击模式。")).toBe("suspect_incomplete");
    expect(classifyOpenClawBridgeResultFinality("现在让我提取全面的统计数据...")).toBe("suspect_incomplete");
    expect(classifyOpenClawBridgeResultFinality("我将检查当前服务状态。")).toBe("suspect_incomplete");
    expect(classifyOpenClawBridgeResultFinality("Let me check the VPS status first.")).toBe("suspect_incomplete");
    expect(classifyOpenClawBridgeResultFinality("I'll check the logs now.")).toBe("suspect_incomplete");
  });

  it("classifies short mid-sentence bridge lead-ins as suspect incomplete", () => {
    expect(classifyOpenClawBridgeResultFinality("当前有 4 个定时任务，全部状态正常。让我查一下各自最近的执行记录，找出最近一次运行的是哪个。")).toBe("suspect_incomplete");
  });

  it("keeps completed short bridge reports final even when they mention checking", () => {
    expect(classifyOpenClawBridgeResultFinality("查完了。以下是 4 个定时任务最近一次执行的情况...")).toBe("final");
    expect(classifyOpenClawBridgeResultFinality("让我查一下只是过程说明；查完了。总结如下：4 个定时任务最近一次都已完成。")).toBe("final");
  });

  it("classifies short GLM query lead-ins as suspect incomplete", () => {
    expect(classifyOpenClawBridgeResultFinality("\u6211\u6765\u4e3a\u60a8\u67e5\u8be2\u4e00\u4e0b\u4eca\u5e74\uff082026\u5e74\uff09\u9ad8\u8003\u6570\u5b66\u6ee1\u5206\u7684\u76f8\u5173\u4fe1\u606f\u3002")).toBe("suspect_incomplete");
  });

  it("keeps completed GLM query answers final", () => {
    expect(classifyOpenClawBridgeResultFinality("\u4ee5\u4e0b\u662f\u4eca\u5e74\u9ad8\u8003\u6570\u5b66\u6ee1\u5206\u7684\u67e5\u8be2\u7ed3\u679c...")).toBe("final");
    expect(classifyOpenClawBridgeResultFinality("\u6839\u636e\u67e5\u8be2\u7ed3\u679c\uff0c2026\u5e74...")).toBe("final");
  });

  it("prefers a later final bridge report over an earlier lead-in", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      messages: [
        {
          seq: 1,
          role: "assistant",
          content: "我来检查一下 VPS 的运行状态和最近的攻击模式。"
        },
        {
          seq: 2,
          role: "assistant",
          content: "现在让我提取全面的统计数据..."
        },
        {
          seq: 3,
          role: "assistant",
          content: "以下是完整的 VPS 状态报告：\n\n## 系统状态\n\n服务运行正常，端口攻击统计如下。"
        }
      ]
    });

    expect(result).toMatchObject({
      text: "以下是完整的 VPS 状态报告：\n\n## 系统状态\n\n服务运行正常，端口攻击统计如下。",
      finality: "final",
      placeholderOnly: false
    });
  });

  it("marks bridge lead-in-only results as suspect incomplete", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      message: "我来检查一下 VPS 的运行状态和最近的攻击模式。"
    });

    expect(result).toMatchObject({
      text: "我来检查一下 VPS 的运行状态和最近的攻击模式。",
      finality: "suspect_incomplete",
      placeholderOnly: false
    });
  });

  it("keeps existing real final bridge answers classified as final", () => {
    expect(classifyOpenClawBridgeResultFinality("以下是完整的 VPS 状态报告：服务运行正常。")).toBe("final");
    expect(classifyOpenClawBridgeResultFinality("Final report: the VPS is healthy and blocked 100 probes.")).toBe("final");
  });

  it("marks completed bridge placeholder-only results as incomplete instead of final text", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "completed",
      result: {
        messages: [
          {
            seq: 33,
            role: "assistant",
            content: OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER
          }
        ]
      }
    });

    expect(result.text).toBe(OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER);
    expect(result.placeholderOnly).toBe(true);
    expect(result.finality).toBe("placeholder");
    expect(isOpenClawBridgeEmptyReplyPlaceholder(result.text)).toBe(true);
  });

  it("keeps failed bridge placeholder-only results recognizable as failure placeholders", () => {
    const result = extractOpenClawBridgeFinalAnswer({
      status: "failed",
      message: OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER
    });

    expect(result.text).toBe(OPENCLAW_BRIDGE_EMPTY_REPLY_PLACEHOLDER);
    expect(result.placeholderOnly).toBe(true);
  });

  it("allows bridge local failure to recover when remote status later completes", () => {
    expect(shouldRecoverOpenClawBridgeCompletedStatus("failed", "completed")).toBe(true);
    expect(shouldRecoverOpenClawBridgeCompletedStatus("failed", "success")).toBe(true);
    expect(shouldRecoverOpenClawBridgeCompletedStatus("failed", "error")).toBe(false);
    expect(shouldRecoverOpenClawBridgeCompletedStatus("running", "completed")).toBe(false);
  });
});
