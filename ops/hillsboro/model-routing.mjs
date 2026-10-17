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

export function normalizeGatewayCatalog(agentsPayload, modelsPayload, syncedAt = Date.now()) {
  const agents = rows(agentsPayload, "agents").map(row => {
    const id = safeAgentId(row?.id || row?.agentId);
    if (!id || row?.kind === "system") return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      defaultModel: selectableModelId(row?.model?.primary || row?.model?.id || row?.model || row?.effectiveModel)
    };
  }).filter(Boolean);
  const models = rows(modelsPayload, "models").map(row => {
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
  return {
    agents: [...new Map(agents.map(row => [row.id, row])).values()],
    models: [...new Map(models.map(row => [row.id, row])).values()],
    defaultAgentId: safeAgentId(agentsPayload?.defaultId || agentsPayload?.defaultAgentId),
    modelView: "configured",
    syncedAt
  };
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
  const model = catalog.models.find(item => item.id === resolvedModelId && item.available !== false && item.manualSelectionAllowed !== false);
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
