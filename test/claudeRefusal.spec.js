import { describe, expect, it, vi } from "vitest";
import { callWorkersAI } from "../src/providers/workersai.js";
import { ProviderError } from "../src/providers/errors.js";
import { handleChat } from "../src/api/chat.js";
import { htmlPage } from "../src/frontend/page.js";

const model = "anthropic/claude-opus-5";
const refusalMessage = "Claude拒绝了本次请求，可能是内容分类器误判。请改写问题或新建话题后重试。";
const limitMessage = "Claude已达到本次输出长度限制，未能生成正文。请缩短问题或稍后重试。";
const emptyMessage = "模型返回了异常的空响应，请稍后重试。";
const privateExplanation = "PRIVATE refusal explanation must not leave the provider";
const privateQuestion = "PRIVATE user question must not appear in diagnostics";

function fixture(stop_reason, category, text = "", output_tokens = 0) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: text ? [{ type: "text", text }] : [],
    stop_reason,
    stop_details: category ? { type: "refusal", category, explanation: privateExplanation } : null,
    usage: {
      input_tokens: category === "cyber" ? 305 : category ? 524 : stop_reason === "max_tokens" ? 500 : 100,
      output_tokens
    }
  };
}

function frontendHandler() {
  const script = htmlPage().match(/<script>([\s\S]*)<\/script>/)[1];
  const start = script.indexOf("function streamTextCandidate");
  const end = script.indexOf("async function streamAIResponse", start);
  return new Function(
    "function renderAssistantMessage(element, reply){ element.rendered = reply; }\n" +
    "function setContextStatus(){}\n" +
    "function isOpenClawProviderError(){ return false; }\n" +
    "function doneEventModelMetadata(){ return null; }\n" +
    script.slice(start, end) + "\nreturn handleStreamEvent;"
  )();
}

async function display(body) {
  const state = {
    reply: "", sources: [], toolSources: [],
    diagnostics: { fallbacks: [], providerError: null }, isOpenClawRequest: false
  };
  const element = {};
  const handle = frontendHandler();
  for (const event of body.split("\n\n").filter(Boolean)) {
    await handle(event, state, element);
  }
  return { state, element };
}

async function chat(response, options = {}) {
  const run = vi.fn().mockResolvedValue(response);
  const result = await handleChat(new Request("https://example.test/api/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: privateQuestion }],
      provider: "cloudflare-proxied", model,
      providers: [{
        id: "cloudflare-proxied", providerType: "claude-compatible",
        models: [{ id: model, modelName: model, enabled: true,
          capabilities: { text: true, streaming: true } }]
      }],
      ...options
    })
  }), { AI: { run } }, { waitUntil() {} });
  return { body: await result.text(), run };
}

describe("Claude native response handling", () => {
  it("preserves normal text and safe metadata without changing request parameters", async () => {
    const response = fixture("end_turn", null, "正常回答", 20);
    response.usage.input_tokens = 100;
    response.content.unshift({ type: "thinking", thinking: "PRIVATE thinking" });
    const run = vi.fn().mockResolvedValue(response);
    const stream = await callWorkersAI({ env: { AI: { run } }, model,
      messages: [{ role: "system", content: "system" }, { role: "user", content: "hello" }] });
    const body = await new Response(stream).text();
    const payload = JSON.parse(body.slice(6).trim());
    expect(payload.response).toBe("正常回答");
    expect(payload.metadata).toMatchObject({
      id: "msg_test", model: "claude-opus-5", stop_reason: "end_turn",
      stop_details: null, usage: { input_tokens: 100, output_tokens: 20 },
      content_block_types: ["thinking", "text"], text_length: 4
    });
    expect(body).not.toContain("PRIVATE thinking");
    expect(run).toHaveBeenCalledWith(model, {
      messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 4096
    }, { gateway: { id: "default" } });
    const { state, element } = await display(body);
    expect(state.reply).toBe("正常回答");
    expect(element.rendered).toBe("正常回答");
    expect(state.diagnostics.providerError).toBeNull();
  });

  it.each([
    ["refusal", "reasoning_extraction", 0, "provider_refusal", refusalMessage],
    ["refusal", "cyber", 0, "provider_refusal", refusalMessage],
    ["max_tokens", null, 4096, "output_limit", limitMessage],
    ["end_turn", null, 0, "empty_response", emptyMessage],
    ["unknown_status", null, 0, "empty_response", emptyMessage],
    [undefined, null, 0, "empty_response", emptyMessage]
  ])("routes %s / %s through ProviderError and friendly SSE without fallback", async (reason, category, tokens, code, message) => {
    const response = fixture(reason, category, "", tokens);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(callWorkersAI({ env: { AI: { run: async () => response } }, model, messages: [] }))
        .rejects.toMatchObject({ name: "ProviderError", code, message, raw: {
          stop_reason: reason || "", text_length: 0, content_block_types: [],
          usage: response.usage
        } });
      const { body, run } = await chat(response, {
        autoFallbackEnabled: true, fallbackModel: "@cf/meta/llama-3.1-8b-instruct-fast"
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(body).toContain("event: provider_error");
      expect(body).toContain('"code":"' + code + '"');
      expect(body).not.toContain('"response":""');
      expect(body).not.toContain("event: fallback");
      expect(body).not.toContain("没有返回内容");
      expect(body).not.toContain(privateExplanation);
      expect(body).not.toContain(privateQuestion);
      expect(body).not.toContain("stack");
      if (category) expect(body).toContain('"category":"' + category + '"');
      const { state, element } = await display(body);
      expect(state.reply).toBe(message);
      expect(element.rendered).toBe(message);
      expect(state.diagnostics.providerError.code).toBe(code);
      const logs = JSON.stringify([warn.mock.calls, log.mock.calls]);
      expect(logs).not.toContain(privateExplanation);
      expect(logs).not.toContain(privateQuestion);
      expect(warn).toHaveBeenCalledWith("[claude-response]", expect.objectContaining({
        code, stop_reason: reason || "", latency_ms: expect.any(Number)
      }));
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("uses stop_reason to detect refusal even when a text block is present", async () => {
    await expect(callWorkersAI({ env: { AI: { run: async () => fixture("refusal", "cyber", "blocked") } },
      model, messages: [] })).rejects.toBeInstanceOf(ProviderError);
  });

  it("does not infer refusal from category alone or discard partial max_tokens text", async () => {
    for (const response of [fixture("end_turn", "cyber", "正常回答"), fixture("max_tokens", null, "部分回答", 4096)]) {
      const { body } = await chat(response);
      expect(body).not.toContain("event: provider_error");
      expect((await display(body)).state.reply).toBe(response.content[0].text);
    }
  });

  it("keeps ordinary Workers AI streams unchanged", async () => {
    const upstream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"response":"普通回答"}\n\n'));
      controller.close();
    } });
    const run = vi.fn().mockResolvedValue(upstream);
    const result = await callWorkersAI({ env: { AI: { run } }, model: "@cf/test/model", messages: [], stream: true });
    expect(result).toBe(upstream);
    expect(run).toHaveBeenCalledWith("@cf/test/model", { messages: [], stream: true });
    expect((await display(await new Response(result).text())).state.reply).toBe("普通回答");
  });

  it("treats malformed non-text response fields as empty responses", async () => {
    for (const response of [{ response: { internal: "not text" } }, {
      content: [{ type: "text", text: { internal: "not text" } }], stop_reason: "end_turn"
    }]) {
      await expect(callWorkersAI({ env: { AI: { run: async () => response } }, model, messages: [] }))
        .rejects.toMatchObject({ code: "empty_response", raw: { text_length: 0 } });
    }
  });

  it("keeps other provider and rate-limit errors distinct", async () => {
    for (const code of ["provider_error", "rate_limit"]) {
      const { state } = await display("event: provider_error\ndata: " + JSON.stringify({
        code, message: "existing error", status: code === "rate_limit" ? 429 : 500
      }) + "\n\n");
      expect(state.diagnostics.providerError.code).toBe(code);
      expect(state.providerFriendlyError).toBeUndefined();
    }
  });
});
