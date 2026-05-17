import { DEFAULT_TEXT_MODEL } from "../../providers/models.js";
import { callOpenAICompatibleProvider } from "./openai-compatible.js";
import { callWorkersAIProvider } from "./workers-ai.js";

const EXTERNAL_PROVIDERS = new Set(["glm", "kimi"]);
export const GLM_CODING_MODELS = [
  { id: "glm-5.1", label: "GLM-5.1" },
  { id: "glm-5-turbo", label: "GLM-5-Turbo" },
  { id: "glm-4.7", label: "GLM-4.7" },
  { id: "glm-4.5-air", label: "GLM-4.5-Air" }
];
export const KIMI_CODING_MODELS = [
  { id: "kimi-k2.5", label: "Kimi K2.5" }
];
const DEFAULT_GLM_MODEL = "glm-5.1";
const DEFAULT_GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_KIMI_MODEL = "kimi-k2.5";
const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.cn/v1";

function createProviderConfigError(provider, code, message) {
  const error = new Error(message);
  error.name = "ExternalProviderError";
  error.provider = provider;
  error.status = 400;
  error.code = code;
  return error;
}

function externalProvidersEnabled(env) {
  return String(env.EXTERNAL_PROVIDER_ENABLED || "").toLowerCase() === "true";
}

function fallbackProvider(env) {
  return env.FALLBACK_PROVIDER || "workers-ai";
}

function defaultProvider(env) {
  return env.DEFAULT_PROVIDER || "workers-ai";
}

function resolveProvider(provider, env) {
  const requested = provider || defaultProvider(env);

  if (!provider && EXTERNAL_PROVIDERS.has(requested) && !externalProvidersEnabled(env)) {
    return "workers-ai";
  }

  return requested;
}

function isGlmCodingModel(model) {
  return GLM_CODING_MODELS.some(item => item.id === model);
}

function isKimiCodingModel(model) {
  return KIMI_CODING_MODELS.some(item => item.id === model);
}

function resolveExternalConfig(provider, env, model) {
  if (provider === "glm") {
    const requestedModel = model && model !== "glm" ? model : (env.GLM_MODEL || DEFAULT_GLM_MODEL);

    if (!env.GLM_API_KEY) {
      throw createProviderConfigError("glm", "provider_auth_error", "GLM_API_KEY is not configured");
    }

    if (!GLM_CODING_MODELS.some(item => item.id === requestedModel)) {
      throw createProviderConfigError("glm", "provider_model_error", "Unsupported GLM model: " + requestedModel);
    }

    return {
      provider,
      apiKey: env.GLM_API_KEY,
      baseUrl: env.GLM_BASE_URL || DEFAULT_GLM_BASE_URL,
      model: requestedModel
    };
  }

  if (provider === "kimi") {
    const requestedModel = model && model !== "kimi" ? model : (env.KIMI_MODEL || DEFAULT_KIMI_MODEL);

    if (!env.KIMI_API_KEY) {
      throw createProviderConfigError("kimi", "provider_auth_error", "KIMI_API_KEY is not configured");
    }

    if (!KIMI_CODING_MODELS.some(item => item.id === requestedModel)) {
      throw createProviderConfigError("kimi", "provider_model_error", "Unsupported Kimi model: " + requestedModel);
    }

    return {
      provider,
      apiKey: env.KIMI_API_KEY,
      baseUrl: env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL,
      model: requestedModel
    };
  }

  return null;
}

export function getProviderModelOptions(env) {
  const models = [
    {
      id: "workers-ai",
      label: "Workers AI",
      provider: "workers-ai",
      enabled: true,
      capabilities: { text: true }
    }
  ];

  if (externalProvidersEnabled(env)) {
    models.push(
      ...GLM_CODING_MODELS.map(model => ({
        id: model.id,
        label: model.label,
        provider: "glm",
        enabled: true,
        capabilities: { text: true }
      })),
      ...KIMI_CODING_MODELS.map(model => ({
        id: model.id,
        label: model.label,
        provider: "kimi",
        enabled: true,
        capabilities: { text: true }
      }))
    );
  }

  return models;
}

export function getGlmModelOptions() {
  return GLM_CODING_MODELS.map(model => ({
    id: model.id,
    label: model.label,
    provider: "glm",
    enabled: true,
    capabilities: { text: true }
  }));
}

export function getKimiModelOptions() {
  return KIMI_CODING_MODELS.map(model => ({
    id: model.id,
    label: model.label,
    provider: "kimi",
    enabled: true,
    capabilities: { text: true }
  }));
}

export async function callProvider({
  provider,
  env,
  messages,
  model,
  stream = true,
  signal,
  options = {}
}) {
  const inferredProvider = provider || (isGlmCodingModel(model) ? "glm" : (isKimiCodingModel(model) ? "kimi" : ""));
  const resolvedProvider = resolveProvider(inferredProvider, env);

  if (resolvedProvider === "workers-ai") {
    return callWorkersAIProvider({
      env,
      messages,
      model: model || env.WORKERS_AI_MODEL || DEFAULT_TEXT_MODEL,
      stream,
      options
    });
  }

  const externalConfig = resolveExternalConfig(resolvedProvider, env, model);

  if (!externalConfig) {
    throw new Error("Unsupported provider: " + resolvedProvider);
  }

  return callOpenAICompatibleProvider({
    provider: resolvedProvider,
    env,
    messages,
    model: externalConfig.model,
    baseUrl: externalConfig.baseUrl,
    apiKey: externalConfig.apiKey,
    stream,
    signal,
    options
  });
}

export function shouldFallbackProvider(provider, env) {
  return EXTERNAL_PROVIDERS.has(provider) && fallbackProvider(env) === "workers-ai";
}

export function getFallbackProvider(env) {
  return fallbackProvider(env);
}
