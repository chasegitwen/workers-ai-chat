// Trusted Hermes usage normalization and durable storage.
//
// Token buckets are copied from the authoritative GET /v1/runs/{id} snapshot.
// In particular, cache tokens are NEVER added to input or total: provider totals
// commonly already include them, while providers that report uncached input keep
// cache_read/cache_write as separate facts. Missing buckets stay null, not zero.
// Only scalar usage and routing metadata is accepted; prompts, output and tool data
// are never passed to the persistence layer.

import { createHermesClient } from "./client.js";
import { HermesError } from "./errors.js";
import { isHermesTerminal } from "./status.js";

const MAX_SAFE_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;
const COLLECTION_SOURCES = new Set(["get_run", "sse_terminal", "backfill"]);
const WINDOWS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "90d": 7776000000 };

function cleanId(value, max = 200) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$/.test(text) ? text.slice(0, max) : "";
}

function own(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function firstTokenValue(usage, keys) {
  for (const key of keys) {
    if (own(usage, key)) return { present: true, value: usage[key], key };
  }
  return { present: false, value: null, key: keys[0] };
}

function tokenInteger(candidate, bucket, flags) {
  if (!candidate.present || candidate.value === null || candidate.value === undefined) return null;
  const value = candidate.value;
  let number;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      const exact = BigInt(value);
      if (exact > BigInt(MAX_SAFE_TOKEN_COUNT)) {
        flags.push(bucket + "_overflow");
        return null;
      }
      number = Number(exact);
    } catch (err) {
      flags.push(bucket + "_invalid");
      return null;
    }
  } else {
    number = value;
  }
  if (typeof number !== "number" || !Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
    flags.push(bucket + "_invalid");
    return null;
  }
  if (!Number.isSafeInteger(number)) {
    flags.push(bucket + "_overflow");
    return null;
  }
  return number;
}

export function normalizeHermesUsage(rawUsage) {
  const usage = rawUsage && typeof rawUsage === "object" && !Array.isArray(rawUsage) ? rawUsage : null;
  const flags = [];
  const candidates = usage ? {
    input: firstTokenValue(usage, ["input_tokens", "input", "prompt_tokens"]),
    output: firstTokenValue(usage, ["output_tokens", "output", "completion_tokens"]),
    total: firstTokenValue(usage, ["total_tokens", "total"]),
    cacheRead: firstTokenValue(usage, ["cache_read_tokens", "cache_read", "cached_tokens", "cache_read_input_tokens"]),
    cacheWrite: firstTokenValue(usage, ["cache_write_tokens", "cache_write", "cache_creation_input_tokens"]),
    reasoning: firstTokenValue(usage, ["reasoning_tokens", "reasoning"])
  } : null;
  // Some OpenAI-compatible responses nest optional token details. These remain
  // separate buckets and are not folded into confirmed input/output.
  if (usage && !candidates.cacheRead.present && usage.input_tokens_details && typeof usage.input_tokens_details === "object") {
    candidates.cacheRead = firstTokenValue(usage.input_tokens_details, ["cached_tokens"]);
  }
  if (usage && !candidates.reasoning.present && usage.output_tokens_details && typeof usage.output_tokens_details === "object") {
    candidates.reasoning = firstTokenValue(usage.output_tokens_details, ["reasoning_tokens"]);
  }
  const tokens = {
    input: candidates ? tokenInteger(candidates.input, "input", flags) : null,
    output: candidates ? tokenInteger(candidates.output, "output", flags) : null,
    total: candidates ? tokenInteger(candidates.total, "total", flags) : null,
    cacheRead: candidates ? tokenInteger(candidates.cacheRead, "cache_read", flags) : null,
    cacheWrite: candidates ? tokenInteger(candidates.cacheWrite, "cache_write", flags) : null,
    reasoning: candidates ? tokenInteger(candidates.reasoning, "reasoning", flags) : null
  };
  const validCount = Object.values(tokens).filter(value => value !== null).length;
  const explicitCount = candidates ? Object.values(candidates).filter(value => value.present).length : 0;
  const coreComplete = tokens.input !== null && tokens.output !== null && tokens.total !== null;
  return {
    ...tokens,
    collectionStatus: coreComplete && !flags.length ? "collected" : (validCount || explicitCount ? "partial" : "missing"),
    overflowDetected: flags.some(flag => flag.endsWith("_overflow")),
    validationFlags: flags
  };
}

export function normalizeHermesAttribution(runtime, requested = {}) {
  const value = runtime && typeof runtime === "object" && !Array.isArray(runtime) ? runtime : {};
  const actualProvider = cleanId(value.provider || value.actual_provider, 160) || null;
  const actualModel = cleanId(value.model || value.actual_model, 200) || null;
  const requestedProvider = cleanId(requested.provider || value.requested_provider, 160) || null;
  const requestedModel = cleanId(requested.model || value.requested_model, 200) || null;
  let fallbackUsed = null;
  if (actualProvider && requestedProvider) fallbackUsed = actualProvider !== requestedProvider;
  if (actualModel && requestedModel) fallbackUsed = Boolean(fallbackUsed || actualModel !== requestedModel);
  return {
    actualProvider,
    actualModel,
    requestedProvider,
    requestedModel,
    routeSource: cleanId(value.route_source || value.routeSource, 160) || null,
    runtimeProfile: cleanId(value.profile || value.profile_id || value.runtime_profile, 160) || null,
    serviceTier: cleanId(value.service_tier, 80) || null,
    fallbackUsed
  };
}

function usageRecord(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    upstreamRunId: row.upstream_run_id || null,
    runStatus: row.run_status,
    tokens: {
      input: row.input_tokens ?? null,
      output: row.output_tokens ?? null,
      total: row.total_tokens ?? null,
      cacheRead: row.cache_read_tokens ?? null,
      cacheWrite: row.cache_write_tokens ?? null,
      reasoning: row.reasoning_tokens ?? null
    },
    attribution: {
      actualProvider: row.actual_provider || null,
      actualModel: row.actual_model || null,
      requestedProvider: row.requested_provider || null,
      requestedModel: row.requested_model || null,
      routeSource: row.route_source || null,
      fallbackUsed: row.fallback_used === null || row.fallback_used === undefined ? null : Boolean(row.fallback_used),
      instanceId: row.instance_id,
      runtimeProfile: row.runtime_profile || null,
      serviceTier: row.service_tier || null
    },
    scope: {
      projectId: row.project_id || null,
      conversationId: row.conversation_id || null,
      sessionId: row.upstream_session_id || null,
      jobId: row.hermes_job_id || null
    },
    collectionStatus: row.collection_status,
    collectionSource: row.collection_source,
    historicalGap: Boolean(row.historical_gap),
    overflowDetected: Boolean(row.overflow_detected),
    validationFlags: (() => { try { return JSON.parse(row.validation_flags_json || "[]"); } catch (err) { return []; } })(),
    occurredAt: row.occurred_at,
    collectedAt: row.collected_at,
    priceSnapshot: null,
    estimatedCostMicros: null,
    costStatus: row.cost_status || null,
    currency: row.currency || null
  };
}

export async function persistHermesRunUsage(env, run, snapshot, {
  source = "get_run", historicalGap = false, now = Date.now()
} = {}) {
  if (!env?.DB || !run?.id || !run?.owner_username) return false;
  const safeSource = COLLECTION_SOURCES.has(source) ? source : "get_run";
  const normalized = normalizeHermesUsage(snapshot?.usage);
  const snapshotRuntime = snapshot?.runtime && typeof snapshot.runtime === "object"
    ? { ...snapshot.runtime, service_tier: snapshot.runtime.service_tier || snapshot?.service_tier }
    : (snapshot?.service_tier ? { service_tier: snapshot.service_tier } : null);
  const attribution = normalizeHermesAttribution(snapshotRuntime, {
    provider: run.requested_provider, model: run.requested_model
  });
  const runtime = snapshot?.runtime && typeof snapshot.runtime === "object" ? snapshot.runtime : {};
  const jobId = cleanId(snapshot?.job_id || runtime.job_id, 160) || null;
  try {
    await env.DB.prepare(
      `INSERT INTO hermes_run_usage
       (run_id, owner_username, upstream_run_id, run_status, input_tokens, output_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens, actual_provider, actual_model,
        requested_provider, requested_model, route_source, fallback_used, instance_id, runtime_profile,
        service_tier, project_id, conversation_id, upstream_session_id, hermes_job_id, collection_status,
        collection_source, historical_gap, overflow_detected, validation_flags_json, occurred_at, collected_at,
        price_snapshot_json, estimated_cost_micros, cost_status, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
       ON CONFLICT(owner_username, run_id) DO UPDATE SET
        upstream_run_id = COALESCE(excluded.upstream_run_id, hermes_run_usage.upstream_run_id),
        run_status = excluded.run_status,
        input_tokens = COALESCE(excluded.input_tokens, hermes_run_usage.input_tokens),
        output_tokens = COALESCE(excluded.output_tokens, hermes_run_usage.output_tokens),
        total_tokens = COALESCE(excluded.total_tokens, hermes_run_usage.total_tokens),
        cache_read_tokens = COALESCE(excluded.cache_read_tokens, hermes_run_usage.cache_read_tokens),
        cache_write_tokens = COALESCE(excluded.cache_write_tokens, hermes_run_usage.cache_write_tokens),
        reasoning_tokens = COALESCE(excluded.reasoning_tokens, hermes_run_usage.reasoning_tokens),
        actual_provider = COALESCE(excluded.actual_provider, hermes_run_usage.actual_provider),
        actual_model = COALESCE(excluded.actual_model, hermes_run_usage.actual_model),
        requested_provider = COALESCE(excluded.requested_provider, hermes_run_usage.requested_provider),
        requested_model = COALESCE(excluded.requested_model, hermes_run_usage.requested_model),
        route_source = COALESCE(excluded.route_source, hermes_run_usage.route_source),
        fallback_used = COALESCE(excluded.fallback_used, hermes_run_usage.fallback_used),
        runtime_profile = COALESCE(excluded.runtime_profile, hermes_run_usage.runtime_profile),
        service_tier = COALESCE(excluded.service_tier, hermes_run_usage.service_tier),
        upstream_session_id = COALESCE(excluded.upstream_session_id, hermes_run_usage.upstream_session_id),
        hermes_job_id = COALESCE(excluded.hermes_job_id, hermes_run_usage.hermes_job_id),
        collection_status = CASE
          WHEN hermes_run_usage.collection_status = 'collected' OR excluded.collection_status = 'collected' THEN 'collected'
          WHEN hermes_run_usage.collection_status = 'partial' OR excluded.collection_status = 'partial' THEN 'partial'
          ELSE 'missing' END,
        collection_source = excluded.collection_source,
        historical_gap = MAX(hermes_run_usage.historical_gap, excluded.historical_gap),
        overflow_detected = MAX(hermes_run_usage.overflow_detected, excluded.overflow_detected),
        validation_flags_json = CASE WHEN excluded.validation_flags_json = '[]'
          THEN hermes_run_usage.validation_flags_json ELSE excluded.validation_flags_json END,
        occurred_at = excluded.occurred_at,
        collected_at = excluded.collected_at`
    ).bind(
      run.id, run.owner_username, run.upstream_run_id || null, String(snapshot?.status || run.status || "unknown").slice(0, 40),
      normalized.input, normalized.output, normalized.total, normalized.cacheRead, normalized.cacheWrite,
      normalized.reasoning, attribution.actualProvider, attribution.actualModel, attribution.requestedProvider,
      attribution.requestedModel, attribution.routeSource, attribution.fallbackUsed === null ? null : (attribution.fallbackUsed ? 1 : 0),
      run.instance_id, attribution.runtimeProfile, attribution.serviceTier, run.project_id || null,
      run.conversation_id || null, snapshot?.session_id || run.upstream_session_id || null, jobId,
      normalized.collectionStatus, safeSource, historicalGap ? 1 : 0, normalized.overflowDetected ? 1 : 0,
      JSON.stringify(normalized.validationFlags),
      Number(run.completed_at || run.submitted_at || run.created_at || now), now
    ).run();
    return true;
  } catch (err) {
    console.warn("[hermes] usage_write_failed", { run_id: run.id });
    return false;
  }
}

async function readOwnedUsage(db, owner, runId) {
  return db.prepare("SELECT * FROM hermes_run_usage WHERE owner_username = ? AND run_id = ?")
    .bind(owner, runId).first();
}

export async function backfillHermesRunUsage(env, run, { fetchImpl } = {}) {
  if (!run || !isHermesTerminal(run.status) || !run.upstream_run_id) return false;
  try {
    const response = await createHermesClient(env, run.instance_id, { fetchImpl }).getRun(run.upstream_run_id);
    const snapshot = response.body;
    const attribution = normalizeHermesAttribution(snapshot?.runtime, {
      provider: run.requested_provider, model: run.requested_model
    });
    try {
      await env.DB.prepare(
        `UPDATE hermes_runs SET actual_provider = COALESCE(?, actual_provider),
          actual_model = COALESCE(?, actual_model), route_source = COALESCE(?, route_source)
         WHERE id = ? AND owner_username = ?`
      ).bind(attribution.actualProvider, attribution.actualModel, attribution.routeSource, run.id, run.owner_username).run();
    } catch (err) {
      console.warn("[hermes] usage_attribution_write_failed", { run_id: run.id });
    }
    return persistHermesRunUsage(env, run, snapshot, {
      source: "backfill", historicalGap: normalizeHermesUsage(snapshot?.usage).collectionStatus === "missing"
    });
  } catch (err) {
    if (err instanceof HermesError && err.code === "hermes_run_not_found") {
      return persistHermesRunUsage(env, run, { status: run.status }, {
        source: "backfill", historicalGap: true
      });
    }
    return false;
  }
}

function pageNumber(url, name, fallback, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max || (name === "limit" && value < 1)) {
    throw new HermesError("hermes_usage_pagination_invalid", name + " is out of range", { httpStatus: 400 });
  }
  return value;
}

export async function handleHermesUsage(request, env, url, { owner, fetchImpl } = {}) {
  if (request.method !== "GET") return null;
  if (url.pathname === "/api/hermes/usage/runs") {
    const windowName = String(url.searchParams.get("window") || "30d");
    if (!WINDOWS[windowName]) {
      throw new HermesError("hermes_usage_window_invalid", "window must be 24h, 7d, 30d, or 90d", { httpStatus: 400 });
    }
    const limit = pageNumber(url, "limit", 50, 100);
    const offset = pageNumber(url, "offset", 0, 10000);
    const since = Date.now() - WINDOWS[windowName];
    const result = await env.DB.prepare(
      "SELECT * FROM hermes_run_usage WHERE owner_username = ? AND occurred_at >= ? ORDER BY occurred_at DESC, run_id DESC LIMIT ? OFFSET ?"
    ).bind(owner, since, limit, offset).all();
    const start = await env.DB.prepare(
      "SELECT MIN(collected_at) AS collection_start FROM hermes_run_usage WHERE owner_username = ?"
    ).bind(owner).first();
    return {
      ok: true,
      runs: (result.results || []).map(usageRecord),
      page: { limit, offset, window: windowName },
      coverage: {
        collectionStart: start?.collection_start ?? null,
        historicalDataMayBeIncomplete: true,
        note: "Usage is collected from authoritative Hermes run snapshots; pre-0029 and retained-away usage may be missing."
      }
    };
  }
  const match = url.pathname.match(/^\/api\/hermes\/usage\/runs\/(hrun_[a-f0-9]{32})$/);
  if (!match) return null;
  const runId = match[1];
  const run = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ? AND owner_username = ?")
    .bind(runId, owner).first();
  if (!run) throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
  let stored = await readOwnedUsage(env.DB, owner, runId);
  if (!stored) {
    await backfillHermesRunUsage(env, run, { fetchImpl });
    stored = await readOwnedUsage(env.DB, owner, runId);
  }
  return {
    ok: true,
    usage: usageRecord(stored),
    collectionPending: !stored,
    historicalGap: Boolean(stored?.historical_gap)
  };
}

export { MAX_SAFE_TOKEN_COUNT, usageRecord };

