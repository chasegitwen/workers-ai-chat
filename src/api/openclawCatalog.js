import { jsonResponse } from "../utils/response.js";
import { readSeattleGatewayCatalog } from "./seattleGatewayRpc.js";

const CACHE_KEY = "openclaw_catalog_seattle_v1";
const MAX_AGE_MS = 5 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
let pendingRefresh = null;

function safeId(value) {
  const id = String(value || "").trim();
  return ID_PATTERN.test(id) ? id : "";
}

function safeAgentId(value) {
  const id = String(value || "").trim();
  return AGENT_ID_PATTERN.test(id) ? id : "";
}

function applyAvailabilityOverrides(catalog, env) {
  if (!catalog) return null;
  const disabled = new Set(String(env.OPENCLAW_SEATTLE_DISABLED_MODEL_PROVIDERS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!disabled.size) return catalog;
  return {
    ...catalog,
    models: catalog.models.map(model => ({
      ...model,
      available: model.available !== false && !disabled.has(model.id.split("/")[0].toLowerCase())
    }))
  };
}

function rows(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

export function normalizeOpenClawCatalog(agentPayload, modelPayload, syncedAt = Date.now()) {
  const agents = rows(agentPayload, "agents").map(row => {
    const id = safeAgentId(row?.id || row?.agentId);
    if (!id || row?.kind === "system") return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      defaultModel: safeId(row?.model?.primary || row?.model?.id || row?.model || row?.effectiveModel)
    };
  }).filter(Boolean);
  const models = rows(modelPayload, "models").map(row => {
    const rawId = safeId(row?.id || row?.modelId);
    const provider = safeId(row?.provider || row?.providerId);
    const id = rawId.includes("/") ? rawId : (provider && rawId ? provider + "/" + rawId : "");
    if (!id || row?.manualSelectionAllowed === false) return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      available: row?.available !== false
    };
  }).filter(Boolean);
  return {
    providerId: "openclaw-seattle",
    agents: [...new Map(agents.map(row => [row.id, row])).values()],
    models: [...new Map(models.map(row => [row.id, row])).values()],
    syncedAt
  };
}

async function readCache(env) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(CACHE_KEY).first();
    const catalog = JSON.parse(row?.value || "null");
    return catalog?.providerId === "openclaw-seattle" ? catalog : null;
  } catch {
    return null;
  }
}

async function writeCache(env, catalog) {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
      + "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(CACHE_KEY, JSON.stringify(catalog), catalog.syncedAt).run();
}

async function refresh(env, refreshModels = false) {
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const { agents, models } = await readSeattleGatewayCatalog(env, { refreshModels });
      const catalog = normalizeOpenClawCatalog(agents, models);
      if (!catalog.agents.length || !catalog.models.length) throw new Error("catalog_empty");
      await writeCache(env, catalog);
      return catalog;
    })().finally(() => { pendingRefresh = null; });
  }
  return pendingRefresh;
}

export async function getOpenClawCatalog(env, { force = false } = {}) {
  const cached = await readCache(env);
  if (!force && cached && Date.now() - cached.syncedAt < MAX_AGE_MS) {
    return { ok: true, status: "fresh", catalog: applyAvailabilityOverrides(cached, env) };
  }
  try {
    const catalog = await refresh(env, force);
    return { ok: true, status: "fresh", catalog: applyAvailabilityOverrides(catalog, env) };
  } catch (error) {
    const status = error?.code || "unavailable";
    return { ok: Boolean(cached), status: cached ? "stale" : status,
      gatewayHttpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : undefined,
      catalog: applyAvailabilityOverrides(cached, env) };
  }
}

export async function handleOpenClawCatalog(request, env, url) {
  if (url.pathname !== "/api/openclaw/catalog/seattle") return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }
  const result = await getOpenClawCatalog(env, { force: request.method === "POST" });
  const response = jsonResponse(result, result.ok ? 200 : 503);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function validateOpenClawCatalogSelection(env, agentId, baseModelId) {
  if (!safeAgentId(agentId) || (baseModelId && (!safeId(baseModelId) || !baseModelId.includes("/")))) {
    return false;
  }
  const disabled = new Set(String(env.OPENCLAW_SEATTLE_DISABLED_MODEL_PROVIDERS || "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (baseModelId && disabled.has(baseModelId.split("/")[0].toLowerCase())) return false;
  const catalog = await readCache(env);
  if (!catalog) return true;
  const effectiveCatalog = applyAvailabilityOverrides(catalog, env);
  return effectiveCatalog.agents.some(agent => agent.id === agentId)
    && (!baseModelId || effectiveCatalog.models.some(model => model.id === baseModelId && model.available));
}
