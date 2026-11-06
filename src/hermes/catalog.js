// Hermes capability negotiation and Provider/Model catalog.
//
// Sources: GET /v1/capabilities and GET /api/model/options (Hermes v0.22.5). Both payloads
// are reduced to a field whitelist before they are cached or returned; credentials-related
// fields (api_url, key_env, auth_type, warning, usage, limit, ...) are dropped. Pricing is
// retained only through the scalar whitelist below; URLs, credentials and account data never are.

import { HERMES_AGENT_ID, HERMES_CATALOG_MAX_AGE_MS, hermesInstance } from "./config.js";
import { createHermesClient } from "./client.js";
import { HermesError } from "./errors.js";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/;
const MAX_PROVIDERS = 64;
const MAX_MODELS_PER_PROVIDER = 500;
const PRICE_TEXT_PATTERN = /^\d{1,18}(?:\.\d{1,12})?$/;
const PRICE_TIERS = ["default", "standard", "fast", "ultrafast"];

// Features required before runs may be submitted. Anything missing fails closed.
const REQUIRED_FEATURES = ["run_submission", "run_status", "run_events_sse", "run_stop"];
const BOOLEAN_FEATURES = [
  ...REQUIRED_FEATURES,
  "run_approval_response",
  "approval_events",
  "run_clarify",
  "run_clarify_response",
  "clarify_events",
  "tool_progress_events",
  "run_unknown_resolution",
  "model_options"
];

function cleanName(value, fallback) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 120);
}

function cleanPrice(value) {
  if (value === null || value === undefined || value === "" || value === "?") return null;
  if (String(value).trim().toLowerCase() === "free") return "0";
  const text = String(value).trim().replace(/^\$/, "");
  if (!PRICE_TEXT_PATTERN.test(text)) return null;
  const normalized = text.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return normalized || "0";
}

function cleanPriceSource(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,79}$/.test(text) ? text : "hermes_model_options";
}

function cleanPricingVersion(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,119}$/.test(text) ? text : null;
}

function normalizePriceRates(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = cleanPrice(raw.input ?? raw.input_cost_per_million);
  const output = cleanPrice(raw.output ?? raw.output_cost_per_million);
  const cacheRead = cleanPrice(raw.cache_read ?? raw.cache ?? raw.cache_read_cost_per_million);
  const cacheWrite = cleanPrice(raw.cache_write ?? raw.cache_write_cost_per_million);
  const request = cleanPrice(raw.request_cost);
  if ([input, output, cacheRead, cacheWrite, request].every(value => value === null)) return null;
  return { input, output, cacheRead, cacheWrite, request };
}

function normalizeModelPrice(raw, collectedAt) {
  const rates = normalizePriceRates(raw);
  if (!rates) return null;
  const tiers = {};
  const rawTiers = raw?.service_tiers && typeof raw.service_tiers === "object" ? raw.service_tiers : {};
  for (const tier of PRICE_TIERS) {
    const tierRates = normalizePriceRates(rawTiers[tier] || raw?.[tier]);
    if (tierRates) tiers[tier] = tierRates;
  }
  return {
    source: cleanPriceSource(raw?.source),
    currency: "USD",
    unit: "usd_per_million_tokens",
    collectedAt,
    pricingVersion: cleanPricingVersion(raw?.pricing_version),
    free: raw?.free === true,
    rates,
    serviceTiers: tiers
  };
}

function providerBillingMode(row, id) {
  if (id === "openai-codex") return "subscription_included";
  if (id.startsWith("custom:") || row?.is_user_defined === true) return "custom_unknown";
  if (row?.plan_usage && typeof row.plan_usage === "object") return "fixed_quota";
  const authType = String(row?.auth_type || "").toLowerCase();
  if (authType.includes("oauth") || id === "zai" || id === "kimi-coding"
      || /(?:coding[-_]?plan|coding|oauth)/.test(id)) return "reference_only";
  const declaredMode = String(row?.billing_mode || row?.billingMode || "").trim().toLowerCase();
  if (row?.metered === true || ["metered", "usage_metered", "payg", "pay_as_you_go"].includes(declaredMode)) {
    return "metered";
  }
  return "reference_only";
}

export function normalizeHermesCapabilities(payload) {
  const features = payload && typeof payload.features === "object" && payload.features ? payload.features : {};
  const out = {};
  BOOLEAN_FEATURES.forEach(name => {
    out[name] = features[name] === true;
  });
  // Hermes may advertise Clarify as one aggregate run capability or as separate response/event
  // flags. Both forms are explicit declarations; absence of both continues to fail closed.
  if (out.run_clarify) {
    if (features.run_clarify_response == null) out.run_clarify_response = true;
    if (features.clarify_events == null) out.clarify_events = true;
  }
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

export function normalizeHermesModelOptions(payload, { collectedAt = Date.now() } = {}) {
  const rows = Array.isArray(payload?.providers) ? payload.providers : [];
  const seen = new Set();
  const providers = [];
  for (const row of rows) {
    if (providers.length >= MAX_PROVIDERS) break;
    const id = String(row?.slug || "").trim();
    if (!PROVIDER_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const rawModels = Array.isArray(row?.models) ? row.models : [];
    const modelById = new Map(rawModels.map(model => [
      String(typeof model === "string" ? model : (model?.id || "")).trim(), model
    ]));
    const models = [...new Set(rawModels
      .map(model => String(typeof model === "string" ? model : (model?.id || "")).trim())
      .filter(model => MODEL_ID_PATTERN.test(model)))]
      .slice(0, MAX_MODELS_PER_PROVIDER)
      .map(model => {
        const rawModel = modelById.get(model);
        const rawPrice = (rawModel && typeof rawModel === "object" ? rawModel.pricing : null)
          || (row?.pricing && typeof row.pricing === "object" ? row.pricing[model] : null);
        const pricing = normalizeModelPrice(rawPrice, collectedAt);
        return { id: model, name: model, ...(pricing ? { pricing } : {}) };
      });
    const authenticated = row?.authenticated !== false;
    providers.push({
      id,
      name: cleanName(row?.name, id),
      isCurrent: row?.is_current === true,
      authenticated,
      selectable: authenticated && models.length > 0,
      billingMode: providerBillingMode(row, id),
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
  const syncedAt = Date.now();
  const modelOptions = normalizeHermesModelOptions(optionsResponse.body, { collectedAt: syncedAt });
  return buildHermesCatalog(instanceId, capabilities, modelOptions, syncedAt);
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

export async function readCachedHermesCatalog(db, instanceId) {
  return (await readCache(db, instanceId))?.catalog || null;
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
