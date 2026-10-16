import { describe, expect, it, vi } from "vitest";
import { callOpenAICompatible } from "../src/providers/openaiCompatible.js";
import { handleChat } from "../src/api/chat.js";
import { htmlPage } from "../src/frontend/page.js";

const config = {
  id: "openclaw-seattle-gpt-sol-5.6",
  label: "GPT-Sol-5.6",
  provider: "openclaw-seattle",
  apiBase: "https://seattle.example.test/v1",
  apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
  modelName: "openclaw/gpt-sol-5.6"
};

function sseResponse() {
  return new Response("data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" }
  });
}

describe("Seattle Codex run controls", () => {
  it("renders usable effort and speed controls in the chat composer", () => {
    const page = htmlPage();
    expect(page).toContain('id="codexEffortSelect"');
    expect(page).toContain('id="codexSpeedSelect"');
    expect(page).toContain('codexControls:selectedCodexRunControls()');
    const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script)).not.toThrow();
  });

  it("shows controls for Seattle Codex agents but not GLM or Bridge agents", () => {
    const script = htmlPage().match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
    const start = script.indexOf("function selectedCodexRunModel");
    const end = script.indexOf("function codexRunPreferenceKey", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const selectedModel = new Function("modelSelect", "modelOptions", "modelProviders", "openClawAgentSelect", "openClawBaseModelSelect",
      script.slice(start, end) + "\nreturn selectedCodexRunModel();");
    const providers = [{ id: "openclaw-seattle", openclawExecutionMode: "legacy" }];
    const sol = { id: "sol", label: "GPT-Sol-5.6", provider: "openclaw-seattle", providerType: "openai-compatible", modelName: "openclaw/sol56" };
    const glm = { ...sol, label: "GLM 5.1", modelName: "openclaw/glm51" };
    const agent = { value: "sol56" };
    const base = { value: "" };
    expect(selectedModel({ value: "sol" }, [sol], providers, agent, base)).toEqual(sol);
    expect(selectedModel({ value: "sol" }, [glm], providers, { value: "glm51" }, base)).toBeNull();
    expect(selectedModel({ value: "sol" }, [sol], [{ ...providers[0], openclawExecutionMode: "bridge" }], agent, base)).toBeNull();
    expect(selectedModel({ value: "sol" }, [glm], providers, { value: "main" }, { value: "openai/gpt-6-astra" })).toEqual(glm);
  });

  it("sends effort and speed as OpenClaw directives without changing the stored message", async () => {
    const originalFetch = globalThis.fetch;
    let body;
    globalThis.fetch = vi.fn(async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse();
    });
    const messages = [{ role: "user", content: "Explain this code" }];
    try {
      await callOpenAICompatible({
        env: { SEATTLE_OPENCLAW_API_KEY: "test-key" },
        config,
        messages,
        codexControls: { effort: "high", speed: "fast" }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(body.model).toBe("openclaw/gpt-sol-5.6");
    expect(body.messages[0].content).toBe("/think:high /fast on\n\nExplain this code");
    expect(messages[0].content).toBe("Explain this code");
  });

  it("adds controls to multimodal text and leaves non-Codex OpenClaw agents alone", async () => {
    const originalFetch = globalThis.fetch;
    const bodies = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return sseResponse();
    });
    const content = [{ type: "text", text: "Describe image" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }];
    try {
      await callOpenAICompatible({
        env: { SEATTLE_OPENCLAW_API_KEY: "test-key" },
        config,
        messages: [{ role: "user", content }],
        codexControls: { effort: "medium", speed: "standard" }
      });
      await callOpenAICompatible({
        env: { SEATTLE_OPENCLAW_API_KEY: "test-key" },
        config: { ...config, id: "openclaw-seattle-glm51", label: "GLM 5.1", modelName: "openclaw/glm51" },
        messages: [{ role: "user", content: "Hello GLM" }],
        codexControls: { effort: "max", speed: "fast" }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(bodies[0].messages[0].content[0].text).toBe("/think:medium /fast off\n\nDescribe image");
    expect(bodies[0].messages[0].content[1]).toEqual(content[1]);
    expect(content[0].text).toBe("Describe image");
    expect(bodies[1].messages[0].content).toBe("Hello GLM");
  });

  it("passes the selected controls through the chat endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let body;
    globalThis.fetch = vi.fn(async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse();
    });
    try {
      const response = await handleChat(new Request("http://example.com/", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello Astra" }],
          provider: "openclaw-seattle",
          model: "openclaw-seattle-gpt-6-astro",
          runtime_id: "seattle-openclaw",
          codexControls: { effort: "xhigh", speed: "fast" },
          providers: [{
            id: "openclaw-seattle",
            label: "OpenClaw Seattle",
            providerType: "openai-compatible",
            apiBase: "https://seattle.example.test/v1",
            apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
            openclawExecutionMode: "legacy",
            models: [{
              id: "openclaw-seattle-gpt-6-astro",
              label: "GPT-6-Astro",
              modelName: "openclaw/gpt-6-astro",
              providerType: "openai-compatible",
              capabilities: { text: true, streaming: true },
              enabled: true
            }]
          }]
        })
      }), {
        SEATTLE_OPENCLAW_API_KEY: "test-key",
        OPENCLAW_BRIDGE_MODE: "false"
      }, { waitUntil() {} });
      await response.text();
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(body.model).toBe("openclaw/gpt-6-astro");
    expect(body.messages.at(-1).content).toBe("/think:xhigh /fast on\n\nHello Astra");
  });
});
