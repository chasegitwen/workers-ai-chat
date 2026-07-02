import { describe, expect, it } from "vitest";
import { buildModelProviderCatalog } from "../src/api/chat.js";
import { mergeModelSettings, normalizeModelSettings } from "../src/api/settings.js";

const openClawModel = {
  id: "openclaw-seattle-glm51",
  label: "OpenClaw Seattle / GLM 5.1",
  modelName: "openclaw/glm51",
  enabled: true
};

function provider(id, mode, models = [openClawModel]) {
  return {
    id,
    label: id === "openclaw-hillsboro" ? "OpenClaw Hillsboro" : "OpenClaw Seattle",
    providerType: "openai-compatible",
    apiBase: id === "openclaw-hillsboro" ? "https://hill.example.test/v1" : "https://act.example.test/v1",
    apiKeyEnv: id === "openclaw-hillsboro" ? "OPENCLAW_HILLSBORO_API_KEY" : "OPENCLAW_SEATTLE_API_KEY",
    ...(mode === undefined ? {} : { openclawExecutionMode: mode }),
    enabled: true,
    models
  };
}

function envWithSavedProviders(providers) {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            value: JSON.stringify({ providers })
          })
        })
      })
    }
  };
}

async function catalogProvider(savedProviders, requestProviders = [], customModelConfig = null) {
  const catalog = await buildModelProviderCatalog(
    envWithSavedProviders(savedProviders),
    requestProviders,
    customModelConfig,
    null
  );
  return catalog.find(item => item.id === "openclaw-hillsboro" || item.id === "openclaw-seattle");
}

describe("OpenClaw execution mode settings persistence", () => {
  it("normalizes missing OpenClaw execution mode to legacy on load", () => {
    const settings = normalizeModelSettings({
      providers: [{
        id: "openclaw-seattle",
        label: "OpenClaw Seattle",
        providerType: "openai-compatible",
        apiBase: "https://act.example.test/v1",
        enabled: true,
        models: [openClawModel]
      }, {
        id: "openai",
        label: "OpenAI",
        providerType: "openai-compatible",
        apiBase: "https://api.openai.com/v1",
        enabled: true,
        models: []
      }]
    });

    expect(settings.providers.find(provider => provider.id === "openclaw-seattle").openclawExecutionMode).toBe("legacy");
    expect(settings.categories[2].providers.find(provider => provider.providerId === "openclaw-seattle").openclawExecutionMode).toBe("legacy");
    expect(settings.providers.find(provider => provider.id === "openai").openclawExecutionMode).toBeUndefined();
  });

  it("round-trips legacy and bridge OpenClaw execution modes on save", () => {
    const merged = mergeModelSettings(null, {
      providers: [{
        id: "openclaw-seattle",
        label: "OpenClaw Seattle",
        providerType: "openai-compatible",
        apiBase: "https://act.example.test/v1",
        openclawExecutionMode: "legacy",
        enabled: true,
        models: [openClawModel]
      }, {
        id: "openclaw-hillsboro",
        label: "OpenClaw Hillsboro",
        providerType: "openai-compatible",
        apiBase: "https://hill.example.test/v1",
        openclawExecutionMode: "bridge",
        enabled: true,
        models: []
      }]
    }, 0, 1234);

    expect(merged.providers.find(provider => provider.id === "openclaw-seattle").openclawExecutionMode).toBe("legacy");
    expect(merged.categories[2].providers.find(provider => provider.providerId === "openclaw-seattle").openclawExecutionMode).toBe("legacy");
    expect(merged.providers.find(provider => provider.id === "openclaw-hillsboro").openclawExecutionMode).toBe("bridge");
    expect(merged.categories[2].providers.find(provider => provider.providerId === "openclaw-hillsboro").openclawExecutionMode).toBe("bridge");
  });

  it("preserves saved bridge when request provider omits OpenClaw execution mode", async () => {
    const saved = provider("openclaw-hillsboro", "bridge", [{
      ...openClawModel,
      id: "openclaw-hillsboro-main",
      label: "OpenClaw Hillsboro / main",
      modelName: "openclaw/main"
    }]);
    const request = provider("openclaw-hillsboro", undefined, saved.models);

    const mergedProvider = await catalogProvider([saved], [request]);

    expect(mergedProvider.openclawExecutionMode).toBe("bridge");
  });

  it("preserves saved bridge when custom model config omits OpenClaw execution mode", async () => {
    const saved = provider("openclaw-hillsboro", "bridge", [{
      ...openClawModel,
      id: "openclaw-hillsboro-main",
      label: "OpenClaw Hillsboro / main",
      modelName: "openclaw/main"
    }]);

    const mergedProvider = await catalogProvider([saved], [saved], {
      id: "openclaw-hillsboro-main",
      label: "OpenClaw Hillsboro / main",
      provider: "openclaw-hillsboro",
      providerType: "openai-compatible",
      apiBase: "https://hill.example.test/v1",
      apiKeyEnv: "OPENCLAW_HILLSBORO_API_KEY",
      modelName: "openclaw/main"
    });

    expect(mergedProvider.openclawExecutionMode).toBe("bridge");
  });

  it("keeps saved Seattle legacy through catalog merge", async () => {
    const saved = provider("openclaw-seattle", "legacy");
    const request = provider("openclaw-seattle", undefined);

    const mergedProvider = await catalogProvider([saved], [request]);

    expect(mergedProvider.openclawExecutionMode).toBe("legacy");
  });

  it("allows explicit incoming legacy to override saved bridge", async () => {
    const saved = provider("openclaw-hillsboro", "bridge");
    const request = provider("openclaw-hillsboro", "legacy");

    const mergedProvider = await catalogProvider([saved], [request]);

    expect(mergedProvider.openclawExecutionMode).toBe("legacy");
  });

  it("allows explicit incoming bridge to override saved legacy", async () => {
    const saved = provider("openclaw-hillsboro", "legacy");
    const request = provider("openclaw-hillsboro", "bridge");

    const mergedProvider = await catalogProvider([saved], [request]);

    expect(mergedProvider.openclawExecutionMode).toBe("bridge");
  });
});
