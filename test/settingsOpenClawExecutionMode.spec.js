import { describe, expect, it } from "vitest";
import { mergeModelSettings, normalizeModelSettings } from "../src/api/settings.js";

const openClawModel = {
  id: "openclaw-seattle-glm51",
  label: "OpenClaw Seattle / GLM 5.1",
  modelName: "openclaw/glm51",
  enabled: true
};

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
});
