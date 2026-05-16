import { DEFAULT_TEXT_MODEL } from "../../providers/models.js";
import { callOpenAICompatibleProvider } from "./openai-compatible.js";
import { callWorkersAIProvider } from "./workers-ai.js";

const EXTERNAL_PROVIDERS = new Set(["glm", "kimi"]);

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

  if (EXTERNAL_PROVIDERS.has(requested) && !externalProvidersEnabled(env)) {
    return "workers-ai";
  }

  return requested;
}

function resolveExternalConfig(provider, env, model) {
  if (provider === "glm") {
    return {
      provider,
      apiKey: env.GLM_API_KEY,
      baseUrl: env.GLM_BASE_URL,
      model: model && model !== "glm" ? model : env.GLM_MODEL
    };
  }

  if (provider === "kimi") {
    return {
      provider,
      apiKey: env.KIMI_API_KEY,
      baseUrl: env.KIMI_BASE_URL,
      model: model && model !== "kimi" ? model : env.KIMI_MODEL
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
      {
        id: "glm",
        label: "GLM Coding",
        provider: "glm",
        enabled: true,
        capabilities: { text: true }
      },
      {
        id: "kimi",
        label: "Kimi Coding",
        provider: "kimi",
        enabled: true,
        capabilities: { text: true }
      }
    );
  }

  return models;
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
  const resolvedProvider = resolveProvider(provider, env);

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
