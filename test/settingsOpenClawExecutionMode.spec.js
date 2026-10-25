import { describe, expect, it } from "vitest";
import { buildModelProviderCatalog } from "../src/api/chat.js";
import {
  mergeModelSettings,
  normalizeModelSettings,
  normalizeOpenClawInstances,
  removeOpenClawInstanceSettings,
  upsertOpenClawInstanceSettings
} from "../src/api/settings.js";

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
  it("round-trips classic and Agent-mode selections without rewriting legacy model fields", () => {
    const input = {
      defaultModel: "glm-5.2",
      lastModel: "openclaw-seattle-glm51",
      selectionMode: "openclaw-agent",
      classicSelectedModel: "glm-5.2",
      openClawSelection: {
        instanceId: "openclaw-seattle",
        agentId: "glm51",
        baseModelId: "zai/glm-5.1"
      },
      providers: [provider("openclaw-seattle", "legacy")]
    };
    const settings = normalizeModelSettings(input);
    expect(settings.selectionMode).toBe("modern");
    expect(settings.newModeTarget).toBe("openclaw");
    expect(settings.classicSelectedModel).toBe("glm-5.2");
    expect(settings.openClawSelection).toEqual(input.openClawSelection);
    expect(settings.lastModel).toBe("openclaw-seattle-glm51");

    const classic = normalizeModelSettings({ ...input, selectionMode: "classic" });
    expect(classic.selectionMode).toBe("classic");
    expect(classic.openClawSelection).toEqual(input.openClawSelection);
  });

  it("keeps classic OpenClaw model data while storing modern selections separately", () => {
    const legacyProvider = provider("openclaw-seattle", "legacy");
    const settings = normalizeModelSettings({
      selectionMode: "modern",
      newModeTarget: "model",
      classicSelectedModel: openClawModel.id,
      modernSelectedModel: "workers-model",
      providers: [legacyProvider, provider("workers-ai", undefined, [{
        id: "workers-model", label: "Workers model", modelName: "workers-model", enabled: true
      }])]
    });

    expect(settings.classicSelectedModel).toBe(openClawModel.id);
    expect(settings.modernSelectedModel).toBe("workers-model");
    expect(settings.providers.find(item => item.id === "openclaw-seattle")?.models).toEqual([openClawModel]);
  });

  it("adds, edits, and removes instances without accepting browser supplied targets", () => {
    const added = upsertOpenClawInstanceSettings([], {
      id: "my-seattle",
      label: "Seattle A",
      targetId: "seattle",
      endpoint: "http://127.0.0.1/private",
      connectionId: "attacker"
    });
    expect(added).toEqual([expect.objectContaining({
      id: "my-seattle",
      label: "Seattle A",
      targetId: "seattle",
      endpoint: "https://act.hnsnowground.cfd/v1",
      connectionId: "openclaw-seattle"
    })]);

    const edited = upsertOpenClawInstanceSettings(added, {
      id: "my-seattle", label: "Seattle B", targetId: "seattle"
    });
    expect(edited).toHaveLength(1);
    expect(edited[0].label).toBe("Seattle B");
    expect(removeOpenClawInstanceSettings(edited, "my-seattle")).toEqual([]);
    expect(normalizeOpenClawInstances([{ id: "bad", targetId: "private-lan" }])).toEqual([]);
  });

  it("migrates an existing Seattle-only instance list to include Hillsboro and Oracle once", () => {
    const migrated = normalizeModelSettings({
      openClawInstances: [{ id: "openclaw-seattle", label: "Seattle OpenClaw", targetId: "seattle" }],
      providers: [provider("openclaw-seattle", "legacy"), provider("openclaw-hillsboro", "bridge")]
    });

    expect(migrated.openClawInstances.map(instance => instance.id)).toEqual([
      "openclaw-seattle",
      "openclaw-hillsboro",
      "openclaw-oracle"
    ]);
    expect(migrated.openClawInstanceConfigVersion).toBe(3);

    const afterUserDeletion = normalizeModelSettings({
      ...migrated,
      openClawInstances: migrated.openClawInstances.filter(instance => instance.targetId !== "hillsboro")
    });
    expect(afterUserDeletion.openClawInstances.map(instance => instance.id)).toEqual([
      "openclaw-seattle",
      "openclaw-oracle"
    ]);
  });

  it("persists the per-message model info display preference", () => {
    const settings = normalizeModelSettings({
      showPerMessageModelInfo: true,
      providers: [provider("openclaw-hillsboro", "bridge")]
    });

    expect(settings.showPerMessageModelInfo).toBe(true);

    const merged = mergeModelSettings({ showPerMessageModelInfo: false }, {
      showPerMessageModelInfo: true,
      providers: [provider("openclaw-hillsboro", "bridge")]
    });

    expect(merged.showPerMessageModelInfo).toBe(true);
  });

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

  it("preserves model Cloudflare document attachment capability through settings normalization", () => {
    const settings = normalizeModelSettings({
      providers: [provider("openai-docs", undefined, [{
        id: "doc-model",
        label: "Doc Model",
        modelName: "doc-model-upstream",
        capabilities: {
          text: true,
          streaming: true,
          cloudflareDocumentAttachment: true
        },
        enabled: true
      }])]
    });

    const normalizedModel = settings.providers
      .find(item => item.id === "openai-docs")
      .models.find(item => item.id === "doc-model");
    const categoryModel = settings.categories[2].providers
      .find(item => item.providerId === "openai-docs")
      .models.find(item => item.modelId === "doc-model");

    expect(normalizedModel.capabilities.cloudflareDocumentAttachment).toBe(true);
    expect(categoryModel.capabilities.cloudflareDocumentAttachment).toBe(true);
  });

  it("preserves model Cloudflare document attachment capability through settings merge", () => {
    const merged = mergeModelSettings(null, {
      providers: [provider("openai-docs", undefined, [{
        id: "doc-model",
        label: "Doc Model",
        modelName: "doc-model-upstream",
        capabilities: {
          text: true,
          streaming: true,
          cloudflareDocumentAttachment: true
        },
        enabled: true
      }])]
    }, 0, 5678);

    const mergedModel = merged.providers
      .find(item => item.id === "openai-docs")
      .models.find(item => item.id === "doc-model");

    expect(mergedModel.capabilities.cloudflareDocumentAttachment).toBe(true);
  });
});
