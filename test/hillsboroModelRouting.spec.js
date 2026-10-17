import { describe, expect, it } from "vitest";
import {
  applyCodexRunControlsToMessage,
  buildTurnSessionCreateParams,
  executionModelFromMessages,
  normalizeCodexRunControls,
  normalizeGatewayCatalog,
  resolveCatalogSelection
} from "../ops/hillsboro/model-routing.mjs";

const catalog = normalizeGatewayCatalog(
  { defaultId: "main", agents: [
    { id: "main", model: { primary: "openai/gpt-5.6-terra" } },
    { id: "glm51", model: { primary: "zai/glm-5.1" } }
  ] },
  { models: [
    { provider: "openai", id: "gpt-5.6-terra", available: true },
    { provider: "openai", id: "gpt-5.6-sol", available: true },
    { provider: "openai", id: "gpt-5.6-luna", available: true },
    { provider: "openai", id: "gpt-6-astra", available: true },
    { provider: "openai", id: "gpt-5.5", available: true },
    { provider: "openai", id: "gpt-6-sol", available: true },
    { provider: "openai", id: "gpt-6-luna", available: true },
    { provider: "openai", id: "gpt-6.1-sol", available: true },
    { provider: "zai", id: "glm-5.1", available: true },
    { provider: "zai", id: "glm-5.2", available: true }
  ] }
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
    expect(resolveCatalogSelection(catalog, "glm51", "")).toMatchObject({
      ok: true, agentId: "glm51", resolvedBaseModelId: "zai/glm-5.1", inheritedDefault: true
    });
    expect(resolveCatalogSelection(catalog, "glm51", "zai/glm-5.2")).toMatchObject({
      ok: true, resolvedBaseModelId: "zai/glm-5.2", inheritedDefault: false
    });
  });

  it("rejects unknown agents and models", () => {
    expect(resolveCatalogSelection(catalog, "missing", "")).toMatchObject({ ok: false, error: "invalid_agent_id" });
    expect(resolveCatalogSelection(catalog, "glm51", "zai/missing")).toMatchObject({ ok: false, error: "base_model_not_configured" });
    for (const modelId of ["openai/gpt-5.5", "openai/gpt-6-sol", "openai/gpt-6-luna", "openai/gpt-6.1-sol"]) {
      expect(resolveCatalogSelection(catalog, "main", modelId)).toMatchObject({ ok: false, error: "base_model_not_configured" });
    }
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
