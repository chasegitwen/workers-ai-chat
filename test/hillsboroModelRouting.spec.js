import { describe, expect, it } from "vitest";
import {
  applyCodexRunControlsToMessage,
  buildTurnSessionCreateParams,
  executionModelFromMessages,
  normalizeCodexRunControls,
  normalizeGatewayCatalog,
  readAgentScopedGatewayCatalog,
  resolveCatalogSelection
} from "../ops/hillsboro/model-routing.mjs";

const catalog = normalizeGatewayCatalog(
  { defaultId: "main", agents: [
    { id: "main", model: { primary: "openai/gpt-5.6-terra" } },
    { id: "glm", model: { primary: "zai/glm-5.2" } },
    { id: "kimi", model: { primary: "kimi/kimi-for-coding" } }
  ] },
  {
    main: { models: [
      { provider: "openai", id: "gpt-5.6-terra", available: true },
      { provider: "openai", id: "gpt-5.6-sol", available: true },
      { provider: "openai", id: "gpt-5.6-luna", available: true },
      { provider: "openai", id: "gpt-6-astra", available: true },
      { provider: "zai", id: "glm-5", available: true, tags: ["fallback#1"] },
      { provider: "kimi", id: "kimi-for-coding", available: true, tags: ["fallback#2", "configured"] }
    ] },
    glm: { models: [
      { provider: "zai", id: "glm-5.0-turbo", available: true },
      { provider: "zai", id: "glm-5", available: true },
      { provider: "zai", id: "glm-5.1", available: true },
      { provider: "zai", id: "glm-5.2", available: true }
    ] },
    kimi: { models: [
      { provider: "kimi", id: "kimi-for-coding", available: true }
    ] }
  }
);

describe("Hillsboro per-turn Gateway model routing", () => {
  it("resolves Agent default and explicit configured models", () => {
    expect(resolveCatalogSelection(catalog, "main", "")).toMatchObject({
      ok: true, agentId: "main", resolvedBaseModelId: "openai/gpt-5.6-terra", inheritedDefault: true
    });
    for (const modelId of ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol", "openai/gpt-5.6-luna", "openai/gpt-6-astra"]) {
      expect(resolveCatalogSelection(catalog, "main", modelId)).toMatchObject({
        ok: true, resolvedBaseModelId: modelId, inheritedDefault: false
      });
    }
    expect(resolveCatalogSelection(catalog, "glm", "")).toMatchObject({
      ok: true, agentId: "glm", resolvedBaseModelId: "zai/glm-5.2", inheritedDefault: true
    });
    expect(resolveCatalogSelection(catalog, "glm", "zai/glm-5.1")).toMatchObject({
      ok: true, resolvedBaseModelId: "zai/glm-5.1", inheritedDefault: false
    });
    expect(resolveCatalogSelection(catalog, "kimi", "kimi/kimi-for-coding")).toMatchObject({ ok: true });
  });

  it("rejects unknown agents and cross-Agent model selections", () => {
    expect(resolveCatalogSelection(catalog, "missing", "")).toMatchObject({ ok: false, error: "invalid_agent_id" });
    expect(resolveCatalogSelection(catalog, "glm", "zai/missing")).toMatchObject({ ok: false, error: "base_model_not_configured" });
    expect(resolveCatalogSelection(catalog, "main", "zai/glm-5.2")).toMatchObject({ ok: false, error: "base_model_not_configured" });
    expect(resolveCatalogSelection(catalog, "glm", "openai/gpt-5.6-terra")).toMatchObject({ ok: false, error: "base_model_not_configured" });
    expect(resolveCatalogSelection(catalog, "kimi", "zai/glm-5.2")).toMatchObject({ ok: false, error: "base_model_not_configured" });
    for (const modelId of ["openai/gpt-5.5", "openai/gpt-6-sol", "openai/gpt-6-luna", "openai/gpt-6.1-sol"]) {
      expect(resolveCatalogSelection(catalog, "main", modelId)).toMatchObject({ ok: false, error: "base_model_not_configured" });
    }
  });

  it("reads configured models separately for every Gateway Agent", async () => {
    const calls = [];
    const payloads = {
      main: { models: [
        { provider: "openai", id: "gpt-5.6-terra", tags: ["default", "configured"] },
        { provider: "zai", id: "glm-5", tags: ["fallback#1"] },
        { provider: "kimi", id: "kimi-for-coding", tags: ["fallback#2", "configured"] }
      ] },
      glm: { models: [{ provider: "zai", id: "glm-5.2" }] },
      kimi: { models: [{ provider: "kimi", id: "kimi-for-coding" }] }
    };
    const request = async (method, params) => {
      calls.push({ method, params });
      if (method === "agents.list") return {
        defaultId: "main",
        agents: [
          { id: "main", model: { primary: "openai/gpt-5.6-terra" } },
          { id: "glm", model: { primary: "zai/glm-5.2" } },
          { id: "kimi", model: { primary: "kimi/kimi-for-coding" } }
        ]
      };
      return payloads[params.agentId];
    };

    const scoped = await readAgentScopedGatewayCatalog(request, { refreshModels: true, syncedAt: 123 });

    expect(calls).toEqual([
      { method: "agents.list", params: {} },
      { method: "models.list", params: { agentId: "main", view: "configured", refresh: true } },
      { method: "models.list", params: { agentId: "glm", view: "configured", refresh: true } },
      { method: "models.list", params: { agentId: "kimi", view: "configured", refresh: true } }
    ]);
    expect(scoped.modelsByAgent.main.map(model => model.id)).toEqual(["openai/gpt-5.6-terra"]);
    expect(scoped.modelsByAgent.glm.map(model => model.id)).toEqual(["zai/glm-5.2"]);
    expect(scoped.modelsByAgent.kimi.map(model => model.id)).toEqual(["kimi/kimi-for-coding"]);
    expect(scoped.syncedAt).toBe(123);
  });

  it("creates a unique child turn and forks only from the prior completed turn", () => {
    const first = buildTurnSessionCreateParams({
      agentId: "glm51", conversationId: "conversation-1", modelId: "zai/glm-5.1", idempotencyKey: "task-1"
    });
    const second = buildTurnSessionCreateParams({
      agentId: "glm51", conversationId: "conversation-1", modelId: "zai/glm-5.2",
      parentSessionKey: first.key, idempotencyKey: "task-2"
    });
    expect(first).not.toHaveProperty("fork");
    expect(second).toMatchObject({
      agentId: "glm51", model: "zai/glm-5.2", parentSessionKey: first.key,
      fork: true, forkFrom: "last-completed"
    });
    expect(second.key).not.toBe(first.key);
  });

  it("reads the actual executed model from assistant history metadata", () => {
    expect(executionModelFromMessages([
      { role: "assistant", provider: "zai", model: "glm-5.1" },
      { role: "user", content: "next" },
      { role: "assistant", provider: "zai", model: "glm-5.2" }
    ], "zai/glm-5.1")).toBe("zai/glm-5.2");
  });

  it("applies validated effort and speed directives only to GPT turns", () => {
    expect(normalizeCodexRunControls({ effort: "HIGH", speed: "fast" })).toEqual({ effort: "high", speed: "fast" });
    expect(normalizeCodexRunControls({ effort: "invalid", speed: "fast" })).toBeNull();
    expect(applyCodexRunControlsToMessage(
      "Explain this code", "openai/gpt-5.6-terra", { effort: "high", speed: "fast" }
    )).toBe("/think:high /fast on\n\nExplain this code");
    expect(applyCodexRunControlsToMessage(
      "Explain this code", "openai/gpt-6-astra", { effort: "medium", speed: "standard" }
    )).toBe("/think:medium /fast off\n\nExplain this code");
    expect(applyCodexRunControlsToMessage(
      "Explain this code", "zai/glm-5.2", { effort: "high", speed: "fast" }
    )).toBe("Explain this code");
  });
});
