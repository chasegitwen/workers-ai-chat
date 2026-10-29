// Hermes capability negotiation and Provider/Model catalog.
//
// Sources: GET /v1/capabilities and GET /api/model/options (Hermes v0.22.5). Both payloads
// are reduced to a field whitelist before they are cached or returned; credentials-related
// fields (api_url, key_env, auth_type, warning, usage, limit, pricing, ...) are dropped.

import { HERMES_AGENT_ID, HERMES_CATALOG_MAX_AGE_MS, hermesInstance } from "./config.js";
import { createHermesClient } from "./client.js";
import { HermesError } from "./errors.js";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/;
const MAX_PROVIDERS = 64;
const MAX_MODELS_PER_PROVIDER = 500;

// Features required before runs may be submitted. Anything missing fails closed.
const REQUIRED_FEATURES = ["run_submission", "run_status", "run_events_sse", "run_stop"];
const BOOLEAN_FEATURES = [
  ...REQUIRED_FEATURES,
  "run_approval_response",
  "approval_events",
  "tool_progress_events",
  "run_unknown_resolution",
  "model_options"
];

function cleanName(value, fallback) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 120);
}

export function normalizeHermesCapabilities(payload) {
  const features = payload && typeof payload.features === "object" && payload.features ? payload.features : {};
  const out = {};
  BOOLEAN_FEATURES.forEach(name => {
    out[name] = features[name] === true;
  });
  const idem = features.runs_idempotency && typeof features.runs_idempotency === "object" ? features.runs_idempotency : {};
  const runsIdempotency = {
    supported: idem.supported === true,
    durable: idem.durable === true,
    retentionSeconds: Number.isFinite(idem.retention_seconds) ? Math.max(0, Math.floor(idem.retention_seconds)) : 0
  };
  const missing = REQUIRED_FEATURES.filter(name => !out[name]);
  if (!runsIdempotency.supported) missing.push("runs_idempotency");
  const recognized = payload?.object === "hermes.api_server.capabilities" && payload?.platform === "hermes-agent";
  if (!recognized) missing.unshift("hermes_platform");
  return {
    recognized,
    features: out,
    runsIdempotency,
    executionReady: missing.length === 0,
    missing
  };
}

export function normalizeHermesModelOptions(payload) {
  const rows = Array.isArray(payload?.providers) ? payload.providers : [];
  const seen = new Set();
  const providers = [];
  for (const row of rows) {
    if (providers.length >= MAX_PROVIDERS) break;
    const id = String(row?.slug || "").trim();
    if (!PROVIDER_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const models = [...new Set((Array.isArray(row?.models) ? row.models : [])
      .map(model => String(typeof model === "string" ? model : (model?.id || "")).trim())
      .filter(model => MODEL_ID_PATTERN.test(model)))]
      .slice(0, MAX_MODELS_PER_PROVIDER)
      .map(model => ({ id: model, name: model }));
    const authenticated = row?.authenticated !== false;
    providers.push({
      id,
      name: cleanName(row?.name, id),
      isCurrent: row?.is_current === true,
      authenticated,
      selectable: authenticated && models.length > 0,
      models
    });
  }
  const defaultProvider = PROVIDER_ID_PATTERN.test(String(payload?.provider || "")) ? String(payload.provider) : "";
  const defaultModel = MODEL_ID_PATTERN.test(String(payload?.model || "")) ? String(payload.model) : "";
  return { providers, defaultProvider, defaultModel };
}

export function buildHermesCatalog(instanceId, capabilities, modelOptions, syncedAt) {
  const instance = hermesInstance(instanceId);
  return {
    runtimeType: "hermes",
    instanceId,
    instanceLabel: instance?.label || instanceId,
    agents: (instance?.agents || []).map(agent => ({
      id: agent.id,
      name: agent.label,
      // "Agent 默认模型" maps to omitting provider/model in POST /v1/runs, which Hermes
      // resolves to its configured default (shown here for display only).
      defaultModel: modelOptions.defaultModel,
      defaultProvider: modelOptions.defaultProvider
    })),
    defaultAgentId: HERMES_AGENT_ID,
    providers: modelOptions.providers,
    capabilities,
    syncedAt
  };
}

async function readCache(db, instanceId) {
  if (!db) return null;
  const row = await db.prepare(
    "SELECT catalog_json, synced_at FROM hermes_catalog_cache WHERE instance_id = ?"
  ).bind(instanceId).first();
  if (!row) return null;
  try {
    return { catalog: JSON.parse(row.catalog_json), syncedAt: Number(row.synced_at) || 0 };
  } catch (err) {
    return null;
  }
}

async function writeCache(db, instanceId, catalog) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO hermes_catalog_cache (instance_id, catalog_json, capabilities_json, synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(instance_id) DO UPDATE SET
       catalog_json = excluded.catalog_json,
       capabilities_json = excluded.capabilities_json,
       synced_at = excluded.synced_at`
  ).bind(instanceId, JSON.stringify(catalog), JSON.stringify(catalog.capabilities), catalog.syncedAt).run();
}

export async function fetchHermesCatalog(env, instanceId, { refresh = false, fetchImpl } = {}) {
  const client = createHermesClient(env, instanceId, { fetchImpl });
  const capabilitiesResponse = await client.getCapabilities();
  const capabilities = normalizeHermesCapabilities(capabilitiesResponse.body);
  if (!capabilities.recognized) {
    throw new HermesError("hermes_capabilities_unrecognized", "Upstream is not a recognized Hermes API server", { httpStatus: 502 });
  }
  if (!capabilities.features.model_options) {
    throw new HermesError("hermes_capability_missing", "Hermes model options are not available", { httpStatus: 502 });
  }
  const optionsResponse = await client.getModelOptions({ refresh });
  const modelOptions = normalizeHermesModelOptions(optionsResponse.body);
  return buildHermesCatalog(instanceId, capabilities, modelOptions, Date.now());
}

// Returns { catalog, stale, source, error? }. Falls back to the last cached snapshot when the
// upstream is unreachable; callers that execute runs must check capabilities themselves.
export async function getHermesCatalog(env, instanceId, { refresh = false, fetchImpl, now = Date.now() } = {}) {
  const cached = await readCache(env.DB, instanceId);
  if (!refresh && cached && now - cached.syncedAt < HERMES_CATALOG_MAX_AGE_MS) {
    return { catalog: cached.catalog, stale: false, source: "cache" };
  }
  try {
    const catalog = await fetchHermesCatalog(env, instanceId, { refresh, fetchImpl });
    await writeCache(env.DB, instanceId, catalog);
    return { catalog, stale: false, source: "upstream" };
  } catch (err) {
    if (cached) return { catalog: cached.catalog, stale: true, source: "cache", error: err };
    throw err;
  }
}

// Validates a requested provider/model against the catalog. Empty provider and model means
// the Agent default. Returns { ok, mode, provider, model } or { ok:false, code, message }.
export function validateHermesModelSelection(catalog, { provider = "", model = "" } = {}) {
  const providerId = String(provider || "").trim();
  const modelId = String(model || "").trim();
  if (!providerId && !modelId) return { ok: true, mode: "agent_default", provider: "", model: "" };
  if (!providerId || !modelId) {
    return { ok: false, code: "hermes_model_selection_incomplete", message: "Provider and model must be selected together" };
  }
  const row = (catalog?.providers || []).find(item => item.id === providerId);
  if (!row) return { ok: false, code: "hermes_unknown_provider", message: "Provider is not in the Hermes catalog" };
  if (!row.selectable) return { ok: false, code: "hermes_provider_unavailable", message: "Provider is not available on Hermes" };
  if (!row.models.some(item => item.id === modelId)) {
    return { ok: false, code: "hermes_unknown_model", message: "Model is not offered by this provider" };
  }
  return { ok: true, mode: "explicit", provider: providerId, model: modelId };
}
