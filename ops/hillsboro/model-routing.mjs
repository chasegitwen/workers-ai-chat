import { randomUUID } from "node:crypto";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const INCOMPATIBLE_MODEL_IDS = new Set([
  "openai/gpt-5.5",
  "openai/gpt-6-sol",
  "openai/gpt-6-luna",
  "openai/gpt-6.1-sol"
]);
const CODEX_EFFORT_OPTIONS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const CODEX_SPEED_OPTIONS = new Set(["standard", "fast"]);

function safeId(value) {
  const id = String(value || "").trim();
  return ID_PATTERN.test(id) ? id : "";
}

function safeAgentId(value) {
  const id = String(value || "").trim();
  return AGENT_ID_PATTERN.test(id) ? id : "";
}

function selectableModelId(value) {
  const id = safeId(value);
  return id && !INCOMPATIBLE_MODEL_IDS.has(id) ? id : "";
}

export function normalizeCodexRunControls(value) {
  const effort = String(value?.effort || "").trim().toLowerCase();
  const speed = String(value?.speed || "").trim().toLowerCase();
  return CODEX_EFFORT_OPTIONS.has(effort) && CODEX_SPEED_OPTIONS.has(speed)
    ? { effort, speed }
    : null;
}

export function applyCodexRunControlsToMessage(message, modelId, controls) {
  const text = String(message || "");
  const normalizedModelId = safeId(modelId);
  const normalizedControls = normalizeCodexRunControls(controls);
  if (!normalizedControls || !/^openai\/(?:gpt|codex)(?:[._/+@-]|$)/i.test(normalizedModelId)) {
    return text;
  }
  return `/think:${normalizedControls.effort} /fast ${normalizedControls.speed === "fast" ? "on" : "off"}\n\n${text}`;
}

function rows(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

// Hillsboro VPS verification, 2026-10-18:
// - Agent-scoped configured catalog: main 9 models, glm 4 models, kimi 1 model.
// - A single main conversation retained prior context while switching GPT -> GLM -> Kimi.
// Gateway fallback/fallback# tags describe routing order and do not, by themselves,
// make an otherwise selectable configured model ineligible for manual selection.
function normalizeModels(modelsPayload) {
  return rows(modelsPayload, "models").map(row => {
    const rawId = safeId(row?.id || row?.modelId);
    const provider = safeId(row?.provider || row?.providerId);
    const id = rawId.includes("/") ? rawId : (provider && rawId ? `${provider}/${rawId}` : "");
    if (!selectableModelId(id) || row?.manualSelectionAllowed === false) return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      provider: id.split("/")[0],
      available: row?.available !== false,
      manualSelectionAllowed: true
    };
  }).filter(Boolean);
}

export function normalizeGatewayCatalog(agentsPayload, modelsByAgentPayload = {}, syncedAt = Date.now()) {
  const agents = rows(agentsPayload, "agents").map(row => {
    const id = safeAgentId(row?.id || row?.agentId);
    if (!id || row?.kind === "system") return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      defaultModel: selectableModelId(row?.model?.primary || row?.model?.id || row?.model || row?.effectiveModel)
    };
  }).filter(Boolean);
  const modelsByAgent = Object.fromEntries(agents.map(agent => [
    agent.id,
    [...new Map(normalizeModels(modelsByAgentPayload?.[agent.id]).map(model => [model.id, model])).values()]
  ]));
  const models = [...new Map(
    Object.values(modelsByAgent).flat().map(model => [model.id, model])
  ).values()];
  return {
    agents: [...new Map(agents.map(row => [row.id, row])).values()],
    models,
    modelsByAgent,
    defaultAgentId: safeAgentId(agentsPayload?.defaultId || agentsPayload?.defaultAgentId),
    modelView: "configured",
    syncedAt
  };
}

export async function readAgentScopedGatewayCatalog(request, { refreshModels = false, syncedAt = Date.now() } = {}) {
  const agentsPayload = await request("agents.list", {});
  const agentIds = [...new Set(rows(agentsPayload, "agents")
    .map(row => row?.kind === "system" ? "" : safeAgentId(row?.id || row?.agentId))
    .filter(Boolean))];
  const entries = await Promise.all(agentIds.map(async agentId => [
    agentId,
    await request("models.list", {
      agentId,
      view: "configured",
      refresh: Boolean(refreshModels)
    })
  ]));
  return normalizeGatewayCatalog(agentsPayload, Object.fromEntries(entries), syncedAt);
}

export function resolveCatalogSelection(catalog, requestedAgentId, requestedModelId = "") {
  const agentId = safeAgentId(requestedAgentId || catalog?.defaultAgentId);
  const agent = catalog?.agents?.find(item => item.id === agentId);
  if (!agent) return { ok: false, statusCode: 400, error: "invalid_agent_id" };
  const requested = safeId(requestedModelId);
  if (requestedModelId && (!requested || !requested.includes("/"))) {
    return { ok: false, statusCode: 400, error: "invalid_base_model_id" };
  }
  const resolvedModelId = requested || safeId(agent.defaultModel);
  if (!resolvedModelId) return { ok: false, statusCode: 409, error: "agent_default_model_unresolved" };
  const scopedModels = Array.isArray(catalog?.modelsByAgent?.[agentId])
    ? catalog.modelsByAgent[agentId]
    : [];
  const model = scopedModels.find(item => item.id === resolvedModelId
    && item.available !== false && item.manualSelectionAllowed !== false);
  if (!model) return { ok: false, statusCode: 400, error: "base_model_not_configured" };
  return {
    ok: true,
    agentId,
    requestedBaseModelId: requested,
    resolvedBaseModelId: resolvedModelId,
    inheritedDefault: !requested
  };
}

export function buildTurnSessionCreateParams({ agentId, conversationId, modelId, parentSessionKey = "", idempotencyKey = "" }) {
  const suffix = randomUUID();
  const key = `agent:${agentId}:bridge-turn:${conversationId}:${suffix}`;
  return {
    key,
    agentId,
    model: modelId,
    idempotencyKey: `bridge-session:${idempotencyKey || suffix}`,
    ...(parentSessionKey ? { parentSessionKey, fork: true, forkFrom: "last-completed" } : {})
  };
}

export function executionModelFromMessages(messages, fallback = "") {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const row = list[index];
    const role = String(row?.role || row?.type || row?.author?.role || row?.author || "").toLowerCase();
    if (role !== "assistant") continue;
    const provider = safeId(row?.provider || row?.metadata?.provider);
    const model = safeId(row?.model || row?.modelId || row?.metadata?.model);
    if (model.includes("/")) return model;
    if (provider && model) return `${provider}/${model}`;
  }
  return safeId(fallback);
}
