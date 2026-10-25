import { jsonResponse } from "../utils/response.js";

const MODEL_SETTINGS_KEY = "model_settings";
const OPENCLAW_INSTANCE_TARGETS = Object.freeze({
  seattle: Object.freeze({
    connectionId: "openclaw-seattle",
    endpoint: "https://act.hnsnowground.cfd/v1",
    runtimeId: "seattle-openclaw",
    catalogId: "seattle"
  }),
  hillsboro: Object.freeze({
    connectionId: "openclaw-hillsboro",
    endpoint: "https://hill.hnsnowground.cfd/v1",
    runtimeId: "hillsboro-openclaw",
    catalogId: "hillsboro"
  }),
  oracle: Object.freeze({
    connectionId: "openclaw-oracle",
    endpoint: "https://oracle-ai.hnsnowground.cfd/v1",
    runtimeId: "oracle-openclaw",
    catalogId: "oracle"
  })
});
const OPENCLAW_INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const OPENCLAW_INSTANCE_CONFIG_VERSION = 3;
const ORACLE_OPENCLAW_PROVIDER = Object.freeze({
  id: "openclaw-oracle",
  label: "Oracle / Phoenix OpenClaw",
  providerType: "openai-compatible",
  apiBase: "https://oracle-ai.hnsnowground.cfd/v1",
  apiKeyEnv: "ORACLE_OPENCLAW_BRIDGE_TOKEN",
  openclawExecutionMode: "bridge",
  builtin: true,
  enabled: true,
  models: [{
    id: "openclaw-oracle-main",
    label: "Oracle main",
    modelName: "openclaw/main",
    providerType: "openai-compatible",
    capabilities: { text: true, streaming: true },
    enabled: true
  }]
});

function openClawTargetLabel(targetId) {
  if (targetId === "seattle") return "Seattle OpenClaw";
  if (targetId === "oracle") return "Oracle / Phoenix OpenClaw";
  return "Hillsboro OpenClaw";
}

function ensureSettingsDb(env) {
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured"
    }, 500);
  }

  return null;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function settingVersion(settings, rowUpdatedAt = 0) {
  const value = Number(settings?.version || settings?.updatedAt || settings?.clientUpdatedAt || rowUpdatedAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeAutoArchiveDays(value) {
  if (value === "never" || value === "Never" || value === 0 || value === "0") {
    return "never";
  }
  const days = Number(value || 90);
  return [30, 60, 90].includes(days) ? days : 90;
}

function normalizeProviderId(provider) {
  return String(provider?.id || provider?.providerId || "").trim();
}

function normalizeModelId(model) {
  return String(model?.id || model?.modelId || "").trim();
}

function isOpenClawProvider(provider) {
  const values = [
    provider?.type,
    provider?.provider,
    provider?.providerId,
    provider?.id,
    provider?.providerName,
    provider?.label,
    provider?.baseUrl,
    provider?.apiBase
  ].map(value => String(value || "").trim().toLowerCase()).filter(Boolean);
  return values.some(value => value === "openclaw" || value.startsWith("openclaw-") || value.includes("openclaw"));
}

export function normalizeOpenClawInstances(instances, { providers = [], inferDefault = false } = {}) {
  const rows = Array.isArray(instances) ? instances : [];
  const normalized = [];
  const seenIds = new Set();
  rows.forEach(instance => {
    const id = String(instance?.id || "").trim();
    const targetId = String(instance?.targetId || instance?.target || "").trim().toLowerCase();
    const target = OPENCLAW_INSTANCE_TARGETS[targetId];
    if (!OPENCLAW_INSTANCE_ID_PATTERN.test(id) || !target || seenIds.has(id)) return;
    seenIds.add(id);
    normalized.push({
      id,
      label: String(instance?.label || instance?.displayName || id).trim().slice(0, 120) || id,
      targetId,
      connectionId: target.connectionId,
      endpoint: target.endpoint,
      runtimeId: target.runtimeId,
      catalogId: target.catalogId
    });
  });
  if (!normalized.length && inferDefault) {
    for (const [targetId, target] of Object.entries(OPENCLAW_INSTANCE_TARGETS)) {
      if (!providers.some(provider => normalizeProviderId(provider) === target.connectionId)) continue;
      normalized.push({
        id: target.connectionId,
        label: openClawTargetLabel(targetId),
        targetId,
        ...target
      });
    }
  }
  return normalized;
}

function migrateOpenClawInstances(instances, configVersion) {
  let normalized = normalizeOpenClawInstances(instances);
  if (Number(configVersion || 0) < 2 && !normalized.some(instance => instance.targetId === "hillsboro")) {
    normalized = normalizeOpenClawInstances([...normalized, {
      id: "openclaw-hillsboro",
      label: "Hillsboro OpenClaw",
      targetId: "hillsboro"
    }]);
  }
  if (Number(configVersion || 0) < 3 && !normalized.some(instance => instance.targetId === "oracle")) {
    normalized = normalizeOpenClawInstances([...normalized, {
      id: "openclaw-oracle",
      label: "Oracle / Phoenix OpenClaw",
      targetId: "oracle"
    }]);
  }
  return normalized;
}

export function upsertOpenClawInstanceSettings(instances, draft) {
  const id = String(draft?.id || "").trim();
  return normalizeOpenClawInstances([
    ...(Array.isArray(instances) ? instances : []).filter(instance => String(instance?.id || "").trim() !== id),
    draft
  ]);
}

export function removeOpenClawInstanceSettings(instances, instanceId) {
  const id = String(instanceId || "").trim();
  return normalizeOpenClawInstances((Array.isArray(instances) ? instances : [])
    .filter(instance => String(instance?.id || "").trim() !== id));
}

function normalizeOpenClawExecutionMode(provider) {
  if (!isOpenClawProvider(provider)) {
    return undefined;
  }
  return provider?.openclawExecutionMode === "bridge" ? "bridge" : "legacy";
}

function mergeProviderLists(currentProviders, incomingProviders, preserveMissing) {
  if (!Array.isArray(currentProviders) && !Array.isArray(incomingProviders)) {
    return undefined;
  }

  const merged = new Map();
  const order = [];

  function addProvider(provider, source) {
    const id = normalizeProviderId(provider);
    if (!id) {
      return;
    }

    if (!merged.has(id)) {
      order.push(id);
      merged.set(id, {
        ...provider,
        id: provider.id || provider.providerId || id,
        openclawExecutionMode: normalizeOpenClawExecutionMode(provider)
      });
      return;
    }

    const existing = merged.get(id);
    const existingModels = Array.isArray(existing.models) ? existing.models : [];
    const nextModels = Array.isArray(provider.models) ? provider.models : [];
    const models = new Map();
    const modelOrder = [];

    function addModel(model) {
      const modelId = normalizeModelId(model);
      if (!modelId) {
        return;
      }
      if (!models.has(modelId)) {
        modelOrder.push(modelId);
        models.set(modelId, {
          ...model,
          id: model.id || model.modelId || modelId
        });
        return;
      }
      models.set(modelId, {
        ...models.get(modelId),
        ...model
      });
    }

    if (source === "incoming" && !preserveMissing) {
      nextModels.forEach(addModel);
    } else {
      existingModels.forEach(addModel);
      nextModels.forEach(addModel);
    }

    merged.set(id, {
      ...existing,
      ...provider,
      id: provider.id || provider.providerId || existing.id || existing.providerId || id,
      openclawExecutionMode: normalizeOpenClawExecutionMode({
        ...existing,
        ...provider,
        id: provider.id || provider.providerId || existing.id || existing.providerId || id
      }),
      models: modelOrder.map(modelId => models.get(modelId))
    });
  }

  (currentProviders || []).forEach(provider => addProvider(provider, "current"));

  if (!preserveMissing) {
    merged.clear();
    order.length = 0;
  }

  (incomingProviders || []).forEach(provider => addProvider(provider, "incoming"));

  if (preserveMissing) {
    (currentProviders || []).forEach(provider => {
      const id = normalizeProviderId(provider);
      if (id && !merged.has(id)) {
        addProvider(provider, "current");
      }
    });
  }

  return order.map(id => merged.get(id)).filter(Boolean);
}

function providersFromCategories(categories) {
  const providers = [];

  (categories || []).forEach(category => {
    const type = String(category?.type || category?.category || "").trim();

    if (type === "workers-hosted") {
      providers.push({
        id: "workers-ai",
        label: "Workers 托管",
        providerType: "workers-ai",
        apiBase: "",
        apiKeyEnv: "",
        builtin: true,
        enabled: true,
        models: (category.models || []).map(model => ({
          id: model.modelId || model.id,
          label: model.displayName || model.label || model.modelId || model.id,
          modelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
          providerType: "workers-ai",
          capabilities: model.capabilities || { text: true, streaming: true },
          enabled: model.enabled !== false
        }))
      });
      return;
    }

    if (type === "claude-compatible" || type === "openai-compatible") {
      (category.providers || []).forEach(provider => {
        providers.push({
          id: provider.providerId || provider.id,
          label: provider.providerName || provider.label || provider.providerId || provider.id,
          providerType: type,
          apiBase: provider.baseUrl || provider.apiBase || "",
          apiKeyEnv: provider.apiKeyEnv || "",
          openclawExecutionMode: normalizeOpenClawExecutionMode(provider),
          builtin: Boolean(provider.builtin),
          enabled: provider.enabled !== false,
          models: (provider.models || []).map(model => ({
            id: model.modelId || model.id,
            label: model.displayName || model.label || model.modelId || model.id,
            modelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
            providerType: type,
            capabilities: model.capabilities || { text: true, streaming: true },
            enabled: model.enabled !== false
          }))
        });
      });
    }
  });

  return providers.filter(provider => provider.id);
}

function providerToCategoryProvider(provider) {
  return {
    providerId: provider.providerId || provider.id,
    providerName: provider.providerName || provider.label || provider.providerId || provider.id,
    baseUrl: provider.baseUrl || provider.apiBase || "",
    apiKeyEnv: provider.apiKeyEnv || "",
    openclawExecutionMode: normalizeOpenClawExecutionMode(provider),
    builtin: Boolean(provider.builtin),
    enabled: provider.enabled !== false,
    models: (provider.models || []).map(model => ({
      modelId: model.modelId || model.id,
      displayName: model.displayName || model.label || model.modelId || model.id,
      upstreamModelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
      capabilities: model.capabilities || { text: true, streaming: true },
      enabled: model.enabled !== false
    }))
  };
}

function providersToCategories(providers, baseCategories) {
  const categories = Array.isArray(baseCategories) && baseCategories.length
    ? JSON.parse(JSON.stringify(baseCategories))
    : [
      { type: "workers-hosted", models: [] },
      { type: "claude-compatible", providers: [] },
      { type: "openai-compatible", providers: [] }
    ];

  function getCategory(type) {
    let category = categories.find(item => item.type === type);
    if (!category) {
      category = type === "workers-hosted" ? { type, models: [] } : { type, providers: [] };
      categories.push(category);
    }
    return category;
  }

  const workers = (providers || []).find(provider => (provider.providerType || "") === "workers-ai" || normalizeProviderId(provider) === "workers-ai");
  if (workers) {
    getCategory("workers-hosted").models = (workers.models || []).map(model => ({
      modelId: model.modelId || model.id,
      displayName: model.displayName || model.label || model.modelId || model.id,
      upstreamModelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
      capabilities: model.capabilities || { text: true, streaming: true },
      enabled: model.enabled !== false
    }));
  }

  ["claude-compatible", "openai-compatible"].forEach(type => {
    const category = getCategory(type);
    const existing = new Map((category.providers || []).map(provider => [normalizeProviderId(provider), provider]));
    const next = [];
    (providers || [])
      .filter(provider => (provider.providerType || "") === type)
      .forEach(provider => {
        const id = normalizeProviderId(provider);
        const merged = {
          ...(existing.get(id) || {}),
          ...providerToCategoryProvider(provider)
        };
        next.push(merged);
      });
    category.providers = next;
  });

  return categories;
}

function sourceProviders(settings) {
  if (Array.isArray(settings?.providers) && settings.providers.length) {
    return settings.providers.map(provider => ({
      ...provider,
      openclawExecutionMode: normalizeOpenClawExecutionMode(provider)
    }));
  }
  if (Array.isArray(settings?.categories) || Array.isArray(settings?.modelCategories)) {
    return providersFromCategories(settings.categories || settings.modelCategories);
  }
  return [];
}

export function normalizeModelSettings(settings) {
  if (!isObject(settings)) {
    return settings;
  }
  const normalized = { ...settings };
  const providers = sourceProviders(normalized);
  if (!providers.some(provider => normalizeProviderId(provider) === ORACLE_OPENCLAW_PROVIDER.id)) {
    providers.push(JSON.parse(JSON.stringify(ORACLE_OPENCLAW_PROVIDER)));
  }
  normalized.showPerMessageModelInfo = Boolean(normalized.showPerMessageModelInfo);
  normalized.autoArchiveDays = normalizeAutoArchiveDays(normalized.autoArchiveDays);
  const legacySelected = String(normalized.lastModel || normalized.selectedModel || normalized.defaultModel || "");
  const previousAgentMode = normalized.selectionMode === "openclaw-agent";
  normalized.selectionMode = normalized.selectionMode === "modern" || previousAgentMode ? "modern" : "classic";
  normalized.newModeTarget = normalized.newModeTarget === "openclaw" || previousAgentMode ? "openclaw" : "model";
  normalized.classicSelectedModel = String(normalized.classicSelectedModel || legacySelected).slice(0, 200);
  normalized.modernSelectedModel = String(normalized.modernSelectedModel
    || (!legacySelected.startsWith("openclaw-") ? legacySelected : "")).slice(0, 200);
  const openClawSelection = isObject(normalized.openClawSelection) ? normalized.openClawSelection : {};
  normalized.openClawSelection = {
    instanceId: String(openClawSelection.instanceId || "").slice(0, 160),
    agentId: String(openClawSelection.agentId || "").slice(0, 160),
    baseModelId: String(openClawSelection.baseModelId || "").slice(0, 160)
  };
  const hasExplicitInstances = Object.prototype.hasOwnProperty.call(normalized, "openClawInstances");
  normalized.openClawInstances = normalizeOpenClawInstances(normalized.openClawInstances, {
    providers,
    inferDefault: !hasExplicitInstances
  });
  normalized.openClawInstances = migrateOpenClawInstances(
    normalized.openClawInstances,
    normalized.openClawInstanceConfigVersion
  );
  normalized.openClawInstanceConfigVersion = OPENCLAW_INSTANCE_CONFIG_VERSION;

  if (providers.length) {
    normalized.providers = providers;
    normalized.categories = providersToCategories(providers, normalized.categories || normalized.modelCategories);
    normalized.modelCategories = normalized.categories;
  }

  return normalized;
}

export function mergeModelSettings(currentSettings, incomingSettings, rowUpdatedAt, saveTime) {
  const current = isObject(currentSettings) ? currentSettings : {};
  const incoming = isObject(incomingSettings) ? incomingSettings : {};
  const currentVersion = settingVersion(current, rowUpdatedAt);
  const incomingVersion = settingVersion(incoming, 0);
  const stalePayload = Boolean(currentVersion && (!incomingVersion || incomingVersion < currentVersion));
  const merged = {
    ...current,
    ...incoming
  };

  const mergedProviders = mergeProviderLists(
    sourceProviders(current),
    sourceProviders(incoming),
    stalePayload
  );

  if (mergedProviders) {
    merged.providers = mergedProviders;
    merged.categories = providersToCategories(mergedProviders, stalePayload ? current.categories : incoming.categories);
    merged.modelCategories = merged.categories;
  }

  merged.updatedAt = saveTime;
  merged.version = saveTime;
  merged.mergeGuard = {
    stalePayload,
    previousVersion: currentVersion || null,
    incomingVersion: incomingVersion || null
  };

  return normalizeModelSettings(merged);
}

export async function handleSettings(request, env, url) {
  if (url.pathname !== "/api/settings") {
    return null;
  }

  const dbError = ensureSettingsDb(env);

  if (dbError) {
    return dbError;
  }

  if (request.method === "GET") {
    try {
      const row = await env.DB.prepare(
        "SELECT value, updated_at FROM settings WHERE key = ?"
      ).bind(MODEL_SETTINGS_KEY).first();

      if (!row) {
        return jsonResponse({
          ok: true,
          settings: null,
          providers: null
        });
      }

      try {
        const settings = normalizeModelSettings(JSON.parse(row.value || "null"));
        if (isObject(settings)) {
          settings.updatedAt = settingVersion(settings, row.updated_at);
          settings.version = settingVersion(settings, row.updated_at);
        }

        return jsonResponse({
          ok: true,
          settings: isObject(settings) ? settings : null,
          providers: isObject(settings) ? (settings.providers || null) : null,
          updated_at: row.updated_at,
          updatedAt: isObject(settings) ? settings.updatedAt : row.updated_at,
          version: isObject(settings) ? settings.version : row.updated_at
        });
      } catch (err) {
        return jsonResponse({
          ok: true,
          settings: null,
          providers: null,
          warning: "Stored settings JSON could not be parsed"
        });
      }
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to read settings. Make sure the settings table migration has been applied.",
        detail: err.message || String(err)
      }, 500);
    }
  }

  if (request.method === "POST") {
    let body;

    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Request body must be JSON"
      }, 400);
    }

    if (!isObject(body) || !isObject(body.settings)) {
      return jsonResponse({
        ok: false,
        error: "settings must be an object"
      }, 400);
    }

    try {
      const row = await env.DB.prepare(
        "SELECT value, updated_at FROM settings WHERE key = ?"
      ).bind(MODEL_SETTINGS_KEY).first();
      let currentSettings = null;

      if (row?.value) {
        try {
          currentSettings = JSON.parse(row.value || "null");
        } catch (err) {
          currentSettings = null;
        }
      }

      const saveTime = Date.now();
      const mergedSettings = mergeModelSettings(currentSettings, body.settings, row?.updated_at, saveTime);

      await env.DB.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).bind(
        MODEL_SETTINGS_KEY,
        JSON.stringify(mergedSettings),
        saveTime
      ).run();

      return jsonResponse({
        ok: true,
        settings: mergedSettings,
        providers: mergedSettings.providers || null,
        updatedAt: saveTime,
        version: saveTime,
        merged: true,
        stalePayload: Boolean(mergedSettings.mergeGuard?.stalePayload)
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to save settings. Make sure the settings table migration has been applied.",
        detail: err.message || String(err)
      }, 500);
    }
  }

  return jsonResponse({
    ok: false,
    error: "Method not allowed"
  }, 405);
}
