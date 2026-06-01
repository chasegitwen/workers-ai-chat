import {
  buildModelProviderCatalog,
  callSelectedModel
} from "./chat.js";
import { normalizeProviderError, ProviderTimeoutError } from "../providers/errors.js";
import { jsonResponse } from "../utils/response.js";

const MODEL_HEALTH_TIMEOUT_MS = 15000;
const OPENCLAW_MODEL_HEALTH_TIMEOUT_MS = 45000;
const MODEL_HEALTH_CONCURRENCY = 3;
const MODEL_HEALTH_SAMPLE_SIZE = 20;
const MODEL_HEALTH_CHECK_TYPE = "chat_completions";
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
        providerName: provider.providerName || provider.label || provider.id,
        providerType: model.providerType || provider.providerType,
        model: model.id || model.modelId,
        modelName: model.modelName || model.upstreamModelName || model.id || model.modelId,
        label: model.label || model.displayName || model.id || model.modelId
      })));
}

function isOpenClawTarget(target) {
  const providerId = String(target.provider || "").toLowerCase();
  const providerLabel = String(target.providerLabel || "").toLowerCase();
  const providerName = String(target.providerName || "").toLowerCase();
  return providerId.startsWith("openclaw-")
    || providerLabel.includes("openclaw")
    || providerName.includes("openclaw");
}

function healthTimeoutMs(target) {
  return isOpenClawTarget(target)
    ? OPENCLAW_MODEL_HEALTH_TIMEOUT_MS
    : MODEL_HEALTH_TIMEOUT_MS;
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

async function insertHealthResult(env, result) {
  if (!env.DB) {
    return;
  }

  await env.DB.prepare(
    `INSERT INTO model_health_checks (
      provider,
      model,
      ok,
      latency_ms,
      status,
      checked_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      result.provider,
      result.model,
      result.ok ? 1 : 0,
      Number.isFinite(result.latencyMs) ? result.latencyMs : null,
      String(result.status || ""),
      Date.parse(result.checkedAt) || Date.now()
    )
    .run();
}

async function readHealthSample(env, result) {
  if (!env.DB) {
    return [];
  }

  const rows = await env.DB.prepare(
    `SELECT ok
      FROM model_health_checks
      WHERE provider = ? AND model = ?
      ORDER BY checked_at DESC, id DESC
      LIMIT ?`
  )
    .bind(result.provider, result.model, MODEL_HEALTH_SAMPLE_SIZE)
    .all();

  return rows?.results || [];
}

async function addHealthHistory(env, result) {
  let sampleRows = [];

  try {
    await insertHealthResult(env, result);
  } catch (err) {
    console.warn("[model-health] failed to write health history", {
      provider: result.provider,
      model: result.model,
      error: err?.message || String(err)
    });
  }

  try {
    sampleRows = await readHealthSample(env, result);
  } catch (err) {
    console.warn("[model-health] failed to read health history", {
      provider: result.provider,
      model: result.model,
      error: err?.message || String(err)
    });
  }

  const sampleSize = sampleRows.length;
  const successCount = sampleRows.filter(row => Number(row.ok) === 1).length;
  return {
    ...result,
    successRate: sampleSize ? successCount / sampleSize : null,
    sampleSize
  };
}

async function checkModelHealth(env, providerCatalog, target) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const timeoutMs = healthTimeoutMs(target);
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
    }), timeoutMs, target);

    const result = {
      provider: target.provider,
      providerLabel: target.providerLabel,
      providerType: target.providerType,
      model: target.model,
      modelName: target.modelName,
      label: target.label,
      ok: true,
      status: 200,
      latencyMs: Date.now() - startedAt,
      error: "",
      checkedAt,
      checkType: MODEL_HEALTH_CHECK_TYPE,
      timeoutMs
    };
    const enriched = await addHealthHistory(env, result);
    logHealthResult(enriched);
    return enriched;
  } catch (err) {
    const normalized = normalizeProviderError(err, {
      provider: target.provider,
      model: target.model
    });

    const result = {
      provider: normalized.provider || target.provider,
      providerLabel: target.providerLabel,
      providerType: target.providerType,
      model: normalized.model || target.model,
      modelName: target.modelName,
      label: target.label,
      ok: false,
      status: normalized.status || normalized.code || "provider_error",
      latencyMs: Date.now() - startedAt,
      error: normalized.message || "Provider request failed.",
      checkedAt,
      checkType: MODEL_HEALTH_CHECK_TYPE,
      timeoutMs
    };
    const enriched = await addHealthHistory(env, result);
    logHealthResult(enriched);
    return enriched;
  }
}

function logHealthResult(result) {
  console.log("[model-health]", {
    provider: result.provider,
    model: result.model,
    label: result.label,
    status: result.status,
    latencyMs: result.latencyMs,
    timeoutMs: result.timeoutMs,
    successRate: result.successRate,
    sampleSize: result.sampleSize,
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
    openClawTimeoutMs: OPENCLAW_MODEL_HEALTH_TIMEOUT_MS,
    concurrency: MODEL_HEALTH_CONCURRENCY,
    results
  });
}
