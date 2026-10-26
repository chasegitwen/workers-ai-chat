import { describe, expect, it } from "vitest";
import { appendReplyFromSseBuffer, handleChat, readStreamText } from "../src/api/chat.js";
import { htmlPage } from "../src/frontend/page.js";

function frontendStreamFunctions() {
  const page = htmlPage();
  const scriptMatch = page.match(/<script>([\s\S]*)<\/script>/);
  expect(scriptMatch?.[1]).toBeTruthy();
  const script = scriptMatch[1];
  const start = script.indexOf("function streamTextCandidate");
  const end = script.indexOf("async function streamAIResponse", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return new Function(
    "function renderAssistantMessage(element, reply){ element.rendered = reply; }\n" +
    "function setContextStatus(){}\n" +
    "function mergeOpenClawTask(){}\n" +
    "function isOpenClawNetworkLost(){ return false; }\n" +
    "function isOpenClawProviderError(){ return false; }\n" +
    "function openClawFriendlyError(error){ return error.message || String(error); }\n" +
    "function doneEventModelMetadata(){ return null; }\n" +
    "async function tryAutoResumeOpenClawTask(){ return { handled:false }; }\n" +
    script.slice(start, end) +
    "\nreturn { readStreamChunk, handleStreamEvent };"
  )();
}

describe("Seattle OpenClaw Legacy SSE parsing", () => {
  it("keeps compatibility with the older OpenAI-style SSE chunk format", () => {
    const raw = JSON.stringify({
      choices: [{
        delta: {
          content: "Seattle legacy token"
        }
      }]
    });

    expect(readStreamText(raw)).toBe("Seattle legacy token");
  });

  it("extracts Seattle upgraded SSE token fields from raw data events", () => {
    expect(readStreamText(JSON.stringify({
      type: "response.output_text.delta",
      delta: "Seattle "
    }))).toBe("Seattle ");
    expect(readStreamText(JSON.stringify({
      content: "Legacy SSE "
    }))).toBe("Legacy SSE ");
    expect(readStreamText(JSON.stringify({
      data: {
        content: "content"
      }
    }))).toBe("content");
    expect(readStreamText(JSON.stringify({
      message: " via message"
    }))).toBe(" via message");
  });

  it("does not treat OpenClaw task metadata as assistant answer text", () => {
    expect(readStreamText(JSON.stringify({
      task_id: "seattle-task-123",
      status: "running",
      message: "Remote task started"
    }))).toBe("");
  });

  it("lets the frontend accumulate Seattle Legacy SSE tokens instead of showing the empty placeholder", () => {
    const { readStreamChunk } = frontendStreamFunctions();
    const rawEvents = [
      JSON.stringify({ type: "response.output_text.delta", delta: "Seattle " }),
      JSON.stringify({ data: { content: "Legacy SSE " } }),
      JSON.stringify({ message: "reply" })
    ];
    const reply = rawEvents.map(event => readStreamChunk(event).text).join("");

    expect(reply).toBe("Seattle Legacy SSE reply");
    expect(reply).not.toBe("");
    expect(htmlPage()).toContain("没有返回内容");
  });

  it("keeps frontend done events with final content from becoming empty replies", async () => {
    const { handleStreamEvent } = frontendStreamFunctions();
    const state = {
      reply: "",
      sources: [],
      toolSources: [],
      toolError: null,
      toolDebug: null,
      diagnostics: {
        fallbacks: [],
        done: null,
        providerError: null
      },
      openClawFriendlyError: false,
      isOpenClawRequest: true
    };
    const element = {};

    const completed = await handleStreamEvent(
      "event: done\ndata: " + JSON.stringify({ content: "Seattle final content" }),
      state,
      element
    );

    expect(completed).toBe(true);
    expect(state.reply).toBe("Seattle final content");
    expect(element.rendered).toBe("Seattle final content");
  });

  it("treats an OpenClaw done payload as a final snapshot instead of appending it twice", async () => {
    const { handleStreamEvent } = frontendStreamFunctions();
    const state = {
      reply: "Complete answer",
      sources: [],
      toolSources: [],
      toolError: null,
      toolDebug: null,
      diagnostics: { fallbacks: [], done: null, providerError: null },
      openClawFriendlyError: false,
      providerFriendlyError: false,
      isOpenClawRequest: true
    };
    const element = {};

    await handleStreamEvent(
      "event: done\ndata: " + JSON.stringify({ content: "Complete answer" }),
      state,
      element
    );

    expect(state.reply).toBe("Complete answer");
    expect(element.rendered).toBe("Complete answer");
  });

  it("preserves legitimate repeated sentences in a final OpenClaw snapshot", async () => {
    const { handleStreamEvent } = frontendStreamFunctions();
    const state = {
      reply: "Repeat. ",
      sources: [],
      toolSources: [],
      toolError: null,
      toolDebug: null,
      diagnostics: { fallbacks: [], done: null, providerError: null },
      openClawFriendlyError: false,
      providerFriendlyError: false,
      isOpenClawRequest: true
    };

    await handleStreamEvent(
      "event: done\ndata: " + JSON.stringify({ content: "Repeat. Repeat." }),
      state,
      {}
    );

    expect(state.reply).toBe("Repeat. Repeat.");
  });

  it("keeps non-OpenClaw done payload behavior unchanged", async () => {
    const { handleStreamEvent } = frontendStreamFunctions();
    const state = {
      reply: "Token ",
      sources: [],
      toolSources: [],
      toolError: null,
      toolDebug: null,
      diagnostics: { fallbacks: [], done: null, providerError: null },
      openClawFriendlyError: false,
      providerFriendlyError: false,
      isOpenClawRequest: false
    };

    await handleStreamEvent(
      "event: done\ndata: " + JSON.stringify({ content: "tail" }),
      state,
      {}
    );

    expect(state.reply).toBe("Token tail");
  });

  it("stores an OpenClaw final snapshot once after incremental SSE chunks", () => {
    const bufferState = {
      value: [
        "event: response.output_text.delta",
        "data: " + JSON.stringify({ delta: "Complete " }),
        "",
        "event: response.output_text.delta",
        "data: " + JSON.stringify({ delta: "answer" }),
        "",
        "event: done",
        "data: " + JSON.stringify({ content: "Complete answer" }),
        ""
      ].join("\n") + "\n"
    };
    const replyState = { value: "" };

    appendReplyFromSseBuffer(bufferState, replyState, { finalEventIsSnapshot: true });

    expect(replyState.value).toBe("Complete answer");
  });

  it("proxies Seattle Legacy SSE tokens through handleChat without producing an empty reply", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe("https://seattle.example.test/chat/completions");
      expect(init.headers["X-OpenClaw-Task-Events"]).toBe("1");
      return new Response(
        [
          "event: response.output_text.delta",
          "data: " + JSON.stringify({ type: "response.output_text.delta", delta: "Seattle " }),
          "",
          "event: response.output_text.delta",
          "data: " + JSON.stringify({ data: { content: "Legacy SSE" } }),
          "",
          "event: done",
          "data: {}",
          "",
          "data: [DONE]",
          ""
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8"
          }
        }
      );
    };

    try {
      const response = await handleChat(new Request("http://example.com/", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Use Seattle legacy SSE" }],
          provider: "openclaw-seattle",
          model: "openclaw-seattle-glm51",
          runtime_id: "seattle-openclaw",
          providers: [{
            id: "openclaw-seattle",
            label: "OpenClaw Seattle",
            providerType: "openai-compatible",
            apiBase: "https://seattle.example.test",
            apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
            openclawExecutionMode: "legacy",
            models: [{
              id: "openclaw-seattle-glm51",
              label: "Seattle GLM",
              modelName: "glm-5.1",
              providerType: "openai-compatible",
              capabilities: {
                text: true,
                streaming: true
              },
              enabled: true
            }]
          }]
        })
      }), {
        SEATTLE_OPENCLAW_API_KEY: "test-key",
        OPENCLAW_BRIDGE_MODE: "false"
      }, {
        waitUntil() {}
      });

      const body = await response.text();
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
      expect(body).toContain("Seattle ");
      expect(body).toContain("Legacy SSE");
      expect(body).not.toContain("没有返回内容");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  async function seattleFailureWithFallback(extraBody = {}) {
    const originalFetch = globalThis.fetch;
    let wireRequests = 0;
    const fallbackRuns = [];
    globalThis.fetch = async () => {
      wireRequests += 1;
      return new Response(JSON.stringify({ error: "selected model unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const response = await handleChat(new Request("http://example.com/", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "one line" }],
          provider: "openclaw-seattle",
          model: "openclaw-seattle-glm51",
          runtime_id: "seattle-openclaw",
          autoFallbackEnabled: true,
          fallbackModel: "@cf/meta/llama-3.1-8b-instruct-fast",
          providers: [{
            id: "openclaw-seattle",
            label: "OpenClaw Seattle",
            providerType: "openai-compatible",
            apiBase: "https://seattle.example.test",
            apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
            openclawExecutionMode: "legacy",
            models: [{
              id: "openclaw-seattle-glm51",
              label: "Seattle GLM",
              modelName: "glm-5.1",
              providerType: "openai-compatible",
              capabilities: { text: true, streaming: true },
              enabled: true
            }]
          }],
          ...extraBody
        })
      }), {
        SEATTLE_OPENCLAW_API_KEY: "test-key",
        OPENCLAW_BRIDGE_MODE: "false",
        AI: {
          // Local stand-in for the Workers AI fallback model; no remote binding.
          run: async (model, input) => {
            fallbackRuns.push({ model, stream: input?.stream });
            return new Response(
              "data: " + JSON.stringify({ response: "fallback answer" }) + "\n\ndata: [DONE]\n\n",
              { headers: { "Content-Type": "text/event-stream" } }
            ).body;
          }
        }
      }, { waitUntil() {} });
      return { status: response.status, body: await response.text(), wireRequests, fallbackRuns };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it("keeps the Seattle Legacy SSE fallback for the default OpenClaw agent model", async () => {
    const { body, wireRequests, fallbackRuns } = await seattleFailureWithFallback();
    expect(wireRequests).toBe(1);
    expect(body).toContain("event: fallback");
    expect(fallbackRuns).toEqual([{ model: "@cf/meta/llama-3.1-8b-instruct-fast", stream: true }]);
  });

  it("never invokes a fallback model when the user explicitly selected an OpenClaw base model", async () => {
    const { body, wireRequests, fallbackRuns } = await seattleFailureWithFallback({
      base_model_id: "zai/glm-5.1"
    });
    expect(wireRequests).toBe(1);
    expect(body).not.toContain("event: fallback");
    expect(fallbackRuns).toEqual([]);
  });
});
