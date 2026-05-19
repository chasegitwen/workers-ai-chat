import {
  buildModelProviderCatalog,
  callSelectedModel
} from "./chat.js";
import { normalizeProviderError, ProviderTimeoutError } from "../providers/errors.js";
import { jsonResponse } from "../utils/response.js";

const MODEL_HEALTH_TIMEOUT_MS = 15000;
const MODEL_HEALTH_CONCURRENCY = 3;
const HEALTH_MESSAGES = [
  {
    role: "user",
    content: "Reply with OK."
  }
];

function modelSupportsText(model) {
  return model?.capabilities?.text !== false;
}

function flattenHealthTargets(providerCatalog) {
  return (providerCatalog || [])
    .filter(provider => provider.enabled !== false)
    .flatMap(provider => (provider.models || [])
      .filter(model => model.enabled !== false && modelSupportsText(model))
      .map(model => ({
        provider: provider.id,
        providerLabel: provider.label || provider.providerName || provider.id,
        providerType: model.providerType || provider.providerType,
        model: model.id || model.modelId,
        modelName: model.modelName || model.upstreamModelName || model.id || model.modelId,
        label: model.label || model.displayName || model.id || model.modelId
      })));
}

function healthModelOptions(target) {
  const modelName = String(target.modelName || target.model || "");

  if (modelName.startsWith("anthropic/claude")) {
    return {
      max_tokens: 16
    };
  }

  return {};
}

function withTimeout(promise, ms, target) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ProviderTimeoutError("Model health check timed out", {
        provider: target.provider,
        model: target.model,
        code: "timeout"
      }));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function checkModelHealth(env, providerCatalog, target) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const modelOptions = healthModelOptions(target);

  try {
    await withTimeout(callSelectedModel({
      env,
      provider: target.provider,
      model: target.model,
      messages: HEALTH_MESSAGES,
      stream: false,
      providerCatalog,
      ...modelOptions
    }), MODEL_HEALTH_TIMEOUT_MS, target);

    const result = {
      provider: target.provider,
      model: target.model,
      label: target.label,
      ok: true,
      status: 200,
      latencyMs: Date.now() - startedAt,
      error: "",
      checkedAt
    };
    logHealthResult(result);
    return result;
  } catch (err) {
    const normalized = normalizeProviderError(err, {
      provider: target.provider,
      model: target.model
    });

    const result = {
      provider: normalized.provider || target.provider,
      model: normalized.model || target.model,
      label: target.label,
      ok: false,
      status: normalized.status || normalized.code || "provider_error",
      latencyMs: Date.now() - startedAt,
      error: normalized.message || "Provider request failed.",
      checkedAt
    };
    logHealthResult(result);
    return result;
  }
}

function logHealthResult(result) {
  console.log("[model-health]", {
    provider: result.provider,
    model: result.model,
    label: result.label,
    status: result.status,
    latencyMs: result.latencyMs,
    error: result.error || ""
  });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function handleModelHealth(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const providerCatalog = await buildModelProviderCatalog(env, [], null, null);
  const targets = flattenHealthTargets(providerCatalog);
  const results = await runWithConcurrency(
    targets,
    MODEL_HEALTH_CONCURRENCY,
    target => checkModelHealth(env, providerCatalog, target)
  );

  return jsonResponse({
    ok: true,
    checkedAt: new Date().toISOString(),
    timeoutMs: MODEL_HEALTH_TIMEOUT_MS,
    concurrency: MODEL_HEALTH_CONCURRENCY,
    results
  });
}
