import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTurnSessionCreateParams,
  normalizeGatewayCatalog,
  resolveCatalogSelection,
} from "../model-routing.mjs";

test("configured view rows do not need a configured tag and Hillsboro blacklist is gone", () => {
  const catalog = normalizeGatewayCatalog({
    defaultId: "main",
    agents: [{ id: "main", model: { primary: "openai/gpt-6.1-sol" } }],
  }, {
    main: {
      defaultModels: { automaticUtilityModel: "openai/gpt-5.6-luna" },
      models: [
        { id: "openai/gpt-6.1-sol", available: true },
        { id: "openai/gpt-6-sol", available: true, tags: ["authenticated"] },
        { id: "openai/gpt-5.6-luna", available: true },
      ],
    },
  }, 123);

  assert.equal(resolveCatalogSelection(catalog, "main", "openai/gpt-6-sol").ok, true);
  assert.deepEqual(resolveCatalogSelection(catalog, "main", ""), {
    ok: true,
    agentId: "main",
    requestedBaseModelId: "",
    resolvedBaseModelId: "openai/gpt-6.1-sol",
    inheritedDefault: true,
  });
  assert.equal(resolveCatalogSelection(catalog, "main", "openai/gpt-5.6-luna").error, "base_model_not_configured");
  assert.equal(catalog.modelsByAgent.main.find((row) => row.id === "openai/gpt-5.6-luna").manualSelectionAllowed, false);
});

test("per-turn fork parameters match the installed sessions.create schema", () => {
  const first = buildTurnSessionCreateParams({
    agentId: "main",
    conversationId: "conv-1",
    modelId: "openai/gpt-6.1-sol",
    idempotencyKey: "idem-1",
  });
  assert.equal(first.agentId, "main");
  assert.equal(first.model, "openai/gpt-6.1-sol");
  assert.equal(first.idempotencyKey, "bridge-session:idem-1");
  assert.equal("fork" in first, false);
  assert.equal("emitCommandHooks" in first, false);

  const next = buildTurnSessionCreateParams({
    agentId: "main",
    conversationId: "conv-1",
    modelId: "openai/gpt-6.1-sol",
    parentSessionKey: "agent:main:bridge-turn:old",
    idempotencyKey: "idem-2",
  });
  assert.equal(next.parentSessionKey, "agent:main:bridge-turn:old");
  assert.equal(next.fork, true);
  assert.equal(next.forkFrom, "last-completed");
  assert.equal("emitCommandHooks" in next, false);
});
