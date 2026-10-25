import { jsonResponse } from "../utils/response.js";
import { openclawBridgeClient, ORACLE_OPENCLAW_RUNTIME_ID } from "./openclawBridgeClient.js";

const CACHE_KEY = "openclaw_catalog_oracle_v1";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const pendingRefreshes = new WeakMap();

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

function modelIsManuallySelectable(row) {
  if (row?.manualSelectionAllowed === false || row?.manual_selection_allowed === false) return false;
  if (row?.selectable === false || row?.available === false) return false;
  const usage = String(row?.usage || row?.role || row?.selection || "").trim().toLowerCase();
  return usage !== "utility" && usage !== "utility-only" && usage !== "utility_only";
}

function normalizeModels(payload) {
  return rows(payload, "models").map(row => {
    const rawId = safeId(row?.id || row?.modelId);
    const provider = safeId(row?.provider || row?.providerId);
    const id = rawId.includes("/") ? rawId : (provider && rawId ? provider + "/" + rawId : "");
    if (!id || !modelIsManuallySelectable(row)) return null;
    return {
      id,
      name: String(row?.name || row?.displayName || id).slice(0, 120),
      available: true
    };
  }).filter(Boolean);
}

export function normalizeOracleOpenClawCatalog(payload, syncedAt = Date.now()) {
  const sourceAgents = rows(payload, "agents");
  const agents = sourceAgents
    .map(row => {
      const id = safeAgentId(row?.id || row?.agentId);
      if (!id || row?.kind === "system") return null;
      return {
        id,
        name: String(row?.name || row?.displayName || id).slice(0, 120),
        defaultModel: safeId(row?.defaultModel || row?.model?.primary || row?.model?.id || row?.model || row?.effectiveModel)
      };
    }).filter(Boolean);
  const modelsByAgent = Object.fromEntries(agents.map(agent => {
    const scoped = normalizeModels(payload?.modelsByAgent?.[agent.id]);
    return [agent.id, scoped];
  }));
  const models = [...new Map(Object.values(modelsByAgent).flat().map(model => [model.id, model])).values()];
  return {
    providerId: "openclaw-oracle",
    runtimeId: ORACLE_OPENCLAW_RUNTIME_ID,
    source: "oracle_bridge",
    agents: [...new Map(agents.map(agent => [agent.id, agent])).values()],
    models,
    modelsByAgent,
    defaultAgentId: safeAgentId(payload?.defaultAgentId || payload?.defaultId || "main") || "main",
    modelView: String(payload?.modelView || payload?.model_view || "configured"),
    syncedAt
  };
}

async function readCache(env) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(CACHE_KEY).first();
    const catalog = JSON.parse(row?.value || "null");
    return catalog?.providerId === "openclaw-oracle" ? catalog : null;
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
  let pendingRefresh = pendingRefreshes.get(env);
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const result = await openclawBridgeClient(env, ORACLE_OPENCLAW_RUNTIME_ID).getCatalog({ refresh: refreshModels });
      if (!result.ok) throw new Error(result.error || "oracle_catalog_unavailable");
      const catalog = normalizeOracleOpenClawCatalog(result.data);
      if (!catalog.agents.length || !catalog.models.length) throw new Error("oracle_catalog_empty");
      await writeCache(env, catalog);
      return catalog;
    })().finally(() => { pendingRefreshes.delete(env); });
    pendingRefreshes.set(env, pendingRefresh);
  }
  return pendingRefresh;
}

export async function getOracleOpenClawCatalog(env, { force = false } = {}) {
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
      error: cached ? undefined : (error?.message || "oracle_catalog_unavailable"),
      catalog: cached
    };
  }
}

export async function handleOracleOpenClawCatalog(request, env, url) {
  if (url.pathname !== "/api/openclaw/catalog/oracle") return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }
  const result = await getOracleOpenClawCatalog(env, { force: request.method === "POST" });
  const response = jsonResponse(result, result.ok ? 200 : 503);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function validateOracleOpenClawSelection(env, agentId, baseModelId) {
  const normalizedAgentId = safeAgentId(agentId || "main");
  const normalizedModelId = safeId(baseModelId);
  if (!normalizedAgentId || (baseModelId && (!normalizedModelId || !normalizedModelId.includes("/")))) return false;
  let catalog = await readCache(env);
  if (!catalog) {
    try { catalog = await refresh(env); } catch { return false; }
  }
  const agent = catalog.agents.find(item => item.id === normalizedAgentId);
  const scopedModels = catalog.modelsByAgent?.[normalizedAgentId];
  if (!agent || !Array.isArray(scopedModels)) return false;
  const effectiveModelId = normalizedModelId || safeId(agent.defaultModel);
  return Boolean(effectiveModelId)
    && scopedModels.some(model => model.id === effectiveModelId && model.available !== false);
}
