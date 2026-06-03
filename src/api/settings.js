import { jsonResponse } from "../utils/response.js";

const MODEL_SETTINGS_KEY = "model_settings";

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

function normalizeProviderId(provider) {
  return String(provider?.id || provider?.providerId || "").trim();
}

function normalizeModelId(model) {
  return String(model?.id || model?.modelId || "").trim();
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
        id: provider.id || provider.providerId || id
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
    return settings.providers;
  }
  if (Array.isArray(settings?.categories) || Array.isArray(settings?.modelCategories)) {
    return providersFromCategories(settings.categories || settings.modelCategories);
  }
  return [];
}

function mergeModelSettings(currentSettings, incomingSettings, rowUpdatedAt, saveTime) {
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

  return merged;
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
        const settings = JSON.parse(row.value || "null");
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
