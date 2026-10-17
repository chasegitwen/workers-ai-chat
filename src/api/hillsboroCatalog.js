import { jsonResponse } from "../utils/response.js";
import { openclawBridgeClient } from "./openclawBridgeClient.js";

const CACHE_KEY = "openclaw_catalog_hillsboro_v1";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const INCOMPATIBLE_MODEL_IDS = new Set([
  "openai/gpt-5.5",
  "openai/gpt-6-sol",
  "openai/gpt-6-luna",
  "openai/gpt-6.1-sol"
]);
let pendingRefresh = null;

function safeId(value) {
  const id = String(value || "").trim();
  return ID_PATTERN.test(id) ? id : "";
}

function safeAgentId(value) {
  const id = String(value || "").trim();
  return AGENT_ID_PATTERN.test(id) ? id : "";
}

function rows(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function isSelectableModelId(value) {
  const id = safeId(value);
  return Boolean(id) && !INCOMPATIBLE_MODEL_IDS.has(id);
}

function applyHillsboroModelPolicy(catalog) {
  if (!catalog || typeof catalog !== "object") return null;
  return {
    ...catalog,
    agents: rows(catalog, "agents").map(agent => ({
      ...agent,
      defaultModel: isSelectableModelId(agent?.defaultModel) ? safeId(agent.defaultModel) : ""
    })),
    models: rows(catalog, "models").filter(model => isSelectableModelId(model?.id))
  };
}

export function normalizeHillsboroGatewayCatalog(payload, syncedAt = Date.now()) {
  const agents = rows(payload, "agents").map(row => {
    const id = safeAgentId(row?.id || row?.agentId);
    if (!id || row?.kind === "system") return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      defaultModel: safeId(row?.defaultModel || row?.model?.primary || row?.model?.id || row?.model || row?.effectiveModel)
    };
  }).filter(Boolean);
  const models = rows(payload, "models").map(row => {
    const rawId = safeId(row?.id || row?.modelId);
    const provider = safeId(row?.provider || row?.providerId);
    const id = rawId.includes("/") ? rawId : (provider && rawId ? provider + "/" + rawId : "");
    if (!isSelectableModelId(id) || row?.manualSelectionAllowed === false) return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      available: row?.available !== false
    };
  }).filter(Boolean);
  return applyHillsboroModelPolicy({
    providerId: "openclaw-hillsboro",
    runtimeId: "hillsboro-openclaw",
    source: "gateway_rpc",
    agents: [...new Map(agents.map(row => [row.id, row])).values()],
    models: [...new Map(models.map(row => [row.id, row])).values()],
    defaultAgentId: safeAgentId(payload?.defaultAgentId || payload?.defaultId),
    modelView: "configured",
    syncedAt
  });
}

async function readCache(env) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(CACHE_KEY).first();
    const catalog = JSON.parse(row?.value || "null");
    return catalog?.providerId === "openclaw-hillsboro" ? applyHillsboroModelPolicy(catalog) : null;
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
      const result = await openclawBridgeClient(env).getCatalog({ refresh: refreshModels });
      if (!result.ok) throw new Error(result.error || "catalog_unavailable");
      const catalog = normalizeHillsboroGatewayCatalog(result.data);
      if (!catalog.agents.length || !catalog.models.length) throw new Error("catalog_empty");
      await writeCache(env, catalog);
      return catalog;
    })().finally(() => { pendingRefresh = null; });
  }
  return pendingRefresh;
}

export async function getHillsboroOpenClawCatalog(env, { force = false } = {}) {
  const cached = await readCache(env);
  if (!force && cached && Date.now() - Number(cached.syncedAt || 0) < CACHE_MAX_AGE_MS) {
    return { ok: true, status: "fresh", catalog: cached };
  }
  try {
    return { ok: true, status: "fresh", catalog: await refresh(env, force) };
  } catch (error) {
    return {
      ok: Boolean(cached),
      status: cached ? "stale" : "error",
      error: cached ? undefined : (error?.message || "catalog_unavailable"),
      catalog: cached
    };
  }
}

export async function handleHillsboroOpenClawCatalog(request, env, url) {
  if (url.pathname !== "/api/openclaw/catalog/hillsboro") return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }
  const result = await getHillsboroOpenClawCatalog(env, { force: request.method === "POST" });
  const response = jsonResponse(result, result.ok ? 200 : 503);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function validateHillsboroOpenClawSelection(env, agentId, baseModelId) {
  const normalizedAgentId = safeAgentId(agentId);
  const normalizedModelId = safeId(baseModelId);
  if (!normalizedAgentId || (baseModelId && (!normalizedModelId || !normalizedModelId.includes("/")))) return false;
  let catalog = await readCache(env);
  if (!catalog) {
    try { catalog = await refresh(env); } catch { return false; }
  }
  return catalog.agents.some(agent => agent.id === normalizedAgentId)
    && (!normalizedModelId || catalog.models.some(model => model.id === normalizedModelId && model.available !== false));
}
