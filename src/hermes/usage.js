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
import { priceHermesUsage } from "./pricing.js";
import { isHermesTerminal } from "./status.js";

const MAX_SAFE_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;
const COLLECTION_SOURCES = new Set(["get_run", "sse_terminal", "backfill"]);
const WINDOWS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "90d": 7776000000 };
const EXPORT_LIMIT_MAX = 5000;
const USAGE_FILTERS = {
  provider: "actual_provider",
  model: "actual_model",
  session: "upstream_session_id",
  project: "project_id",
  job: "hermes_job_id"
};
const BACKFILL_RETRY_MS = 15000;
const backfillRetryAfter = new Map();

function deferBackfill(key, now) {
  if (!backfillRetryAfter.has(key) && backfillRetryAfter.size >= 1024) {
    backfillRetryAfter.delete(backfillRetryAfter.keys().next().value);
  }
  backfillRetryAfter.set(key, now + BACKFILL_RETRY_MS);
}

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

function usableTokenValue(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  try { return BigInt(value) <= BigInt(MAX_SAFE_TOKEN_COUNT); } catch (err) { return false; }
}

export function normalizeHermesUsage(rawUsage) {
  const usage = rawUsage && typeof rawUsage === "object" && !Array.isArray(rawUsage) ? rawUsage : null;
  const flags = [];
  // GET /v1/runs is already normalized by Hermes. Raw provider shapes have
  // incompatible cache conventions, so do not blend their aliases into these
  // pricing buckets. A raw-shape marker makes the omission explicit.
  const openAiChatRaw = Boolean(usage && (
    own(usage, "prompt_tokens") || own(usage, "completion_tokens") || own(usage, "cached_tokens")
  ));
  const openAiDetails = Boolean(usage && (
    (usage.input_tokens_details && typeof usage.input_tokens_details === "object")
    || (usage.output_tokens_details && typeof usage.output_tokens_details === "object")
  ));
  const anthropicRaw = Boolean(usage && (
    own(usage, "cache_read_input_tokens") || own(usage, "cache_creation_input_tokens")
  ));
  if (openAiChatRaw || anthropicRaw) {
    if (openAiChatRaw) flags.push("usage_shape_openai_raw_ignored", "input_includes_cache_true");
    if (anthropicRaw) flags.push("usage_shape_anthropic_raw_ignored", "input_includes_cache_false");
    return {
      input: null, output: null, total: null, cacheRead: null, cacheWrite: null, reasoning: null,
      collectionStatus: "missing", overflowDetected: false, validationFlags: flags
    };
  }
  const hasCanonicalCache = Boolean(usage && ["cache_read_tokens", "cache_write_tokens"]
    .some(key => own(usage, key) && usableTokenValue(usage[key])));
  if (openAiDetails && !hasCanonicalCache) flags.push("usage_cache_convention_unverified");
  const candidates = usage ? {
    input: firstTokenValue(usage, ["input_tokens", "input"]),
    output: firstTokenValue(usage, ["output_tokens", "output"]),
    total: firstTokenValue(usage, ["total_tokens", "total"]),
    cacheRead: firstTokenValue(usage, ["cache_read_tokens", "cache_read"]),
    cacheWrite: firstTokenValue(usage, ["cache_write_tokens", "cache_write"]),
    reasoning: firstTokenValue(usage, ["reasoning_tokens", "reasoning"])
  } : null;
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
    coverageIncomplete: row.coverage_incomplete === null || row.coverage_incomplete === undefined
      ? true : Boolean(row.coverage_incomplete),
    coverageNote: row.coverage_note || null,
    priceSnapshot: (() => { try { return JSON.parse(row.price_snapshot_json || "null"); } catch (err) { return null; } })(),
    estimatedCostMicros: row.estimated_cost_micros ?? null,
    actualCostMicros: row.actual_cost_micros ?? null,
    costStatus: row.cost_status || null,
    currency: row.currency || null,
    costNote: row.cost_note || null,
    costNoteCode: row.cost_note_code || null
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
  let existing = null;
  try {
    existing = await env.DB.prepare(
      `SELECT price_snapshot_json, input_tokens, output_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens
       FROM hermes_run_usage WHERE owner_username = ? AND run_id = ?`
    )
      .bind(run.owner_username, run.id).first();
  } catch (err) {
    existing = null;
  }
  let priorPriceSnapshot = null;
  try { priorPriceSnapshot = JSON.parse(existing?.price_snapshot_json || "null"); } catch (err) { priorPriceSnapshot = null; }
  const mergedNormalized = {
    ...normalized,
    input: normalized.input ?? existing?.input_tokens ?? null,
    output: normalized.output ?? existing?.output_tokens ?? null,
    total: normalized.total ?? existing?.total_tokens ?? null,
    cacheRead: normalized.cacheRead ?? existing?.cache_read_tokens ?? null,
    cacheWrite: normalized.cacheWrite ?? existing?.cache_write_tokens ?? null,
    reasoning: normalized.reasoning ?? existing?.reasoning_tokens ?? null
  };
  const cost = await priceHermesUsage(env, run, mergedNormalized, attribution, snapshot, priorPriceSnapshot);
  const coverageComplete = snapshot?.usage?.coverage_complete === true || snapshot?.usage?.coverageComplete === true;
  const coverageNote = coverageComplete
    ? "Runtime reports complete run usage coverage."
    : "Auxiliary, title, compression, or subtask usage may be unavailable; this is not total-system cost.";
  const validationFlags = [...normalized.validationFlags];
  if (cost.overflow && !validationFlags.includes("cost_overflow")) validationFlags.push("cost_overflow");
  try {
    await env.DB.prepare(
      `INSERT INTO hermes_run_usage
       (run_id, owner_username, upstream_run_id, run_status, input_tokens, output_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens, actual_provider, actual_model,
        requested_provider, requested_model, route_source, fallback_used, instance_id, runtime_profile,
        service_tier, project_id, conversation_id, upstream_session_id, hermes_job_id, collection_status,
        collection_source, historical_gap, overflow_detected, validation_flags_json, occurred_at, collected_at,
        price_snapshot_json, estimated_cost_micros, actual_cost_micros, cost_status, currency, cost_note,
        cost_note_code, coverage_incomplete, coverage_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        validation_flags_json = CASE
          WHEN excluded.collection_status = 'collected' THEN excluded.validation_flags_json
          WHEN excluded.validation_flags_json = '[]' THEN hermes_run_usage.validation_flags_json
          ELSE excluded.validation_flags_json END,
        occurred_at = excluded.occurred_at,
        collected_at = excluded.collected_at,
        price_snapshot_json = COALESCE(hermes_run_usage.price_snapshot_json, excluded.price_snapshot_json),
        estimated_cost_micros = CASE
          WHEN hermes_run_usage.cost_status = 'actual' THEN hermes_run_usage.estimated_cost_micros
          WHEN excluded.cost_status = 'actual' THEN NULL
          WHEN excluded.cost_status = 'estimated' THEN excluded.estimated_cost_micros
          ELSE NULL END,
        actual_cost_micros = COALESCE(excluded.actual_cost_micros, hermes_run_usage.actual_cost_micros),
        cost_status = CASE
          WHEN hermes_run_usage.cost_status = 'actual' THEN 'actual'
          ELSE excluded.cost_status END,
        currency = CASE WHEN hermes_run_usage.cost_status = 'actual'
          THEN hermes_run_usage.currency ELSE excluded.currency END,
        cost_note = CASE WHEN hermes_run_usage.cost_status = 'actual'
          THEN hermes_run_usage.cost_note ELSE excluded.cost_note END,
        cost_note_code = CASE WHEN hermes_run_usage.cost_status = 'actual'
          THEN hermes_run_usage.cost_note_code ELSE excluded.cost_note_code END,
        coverage_incomplete = MIN(hermes_run_usage.coverage_incomplete, excluded.coverage_incomplete),
        coverage_note = excluded.coverage_note`
    ).bind(
      run.id, run.owner_username, run.upstream_run_id || null,
      cleanId(snapshot?.status, 40) || cleanId(run.status, 40) || "unknown",
      normalized.input, normalized.output, normalized.total, normalized.cacheRead, normalized.cacheWrite,
      normalized.reasoning, attribution.actualProvider, attribution.actualModel, attribution.requestedProvider,
      attribution.requestedModel, attribution.routeSource, attribution.fallbackUsed === null ? null : (attribution.fallbackUsed ? 1 : 0),
      run.instance_id, attribution.runtimeProfile, attribution.serviceTier, run.project_id || null,
      run.conversation_id || null,
      cleanId(snapshot?.session_id, 200) || cleanId(run.upstream_session_id, 200) || null, jobId,
      normalized.collectionStatus, safeSource, historicalGap ? 1 : 0, normalized.overflowDetected ? 1 : 0,
      JSON.stringify(validationFlags),
      Number(run.completed_at || run.submitted_at || run.created_at || now), now,
      cost.priceSnapshot ? JSON.stringify(cost.priceSnapshot) : null,
      cost.costStatus === "estimated" ? cost.costMicros : null,
      cost.costStatus === "actual" ? cost.costMicros : null,
      cost.costStatus, cost.currency, cost.note?.detail || null, cost.note?.code || null,
      coverageComplete ? 0 : 1, coverageNote
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
      let localUsage = null;
      try {
        localUsage = run.usage_json ? JSON.parse(run.usage_json) : null;
      } catch (parseError) {
        localUsage = null;
      }
      return persistHermesRunUsage(env, run, { status: run.status, usage: localUsage }, {
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

function usageWindow(url) {
  const name = String(url.searchParams.get("window") || "30d");
  if (!WINDOWS[name]) {
    throw new HermesError("hermes_usage_window_invalid", "window must be 24h, 7d, 30d, or 90d", { httpStatus: 400 });
  }
  return { name, since: Date.now() - WINDOWS[name] };
}

function usageFilters(url) {
  const filters = {};
  for (const name of Object.keys(USAGE_FILTERS)) {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") continue;
    const value = cleanId(raw, 200);
    if (!value || value !== raw.trim()) {
      throw new HermesError("hermes_usage_filter_invalid", name + " filter is invalid", { httpStatus: 400 });
    }
    filters[name] = value;
  }
  return filters;
}

function usagePredicate(owner, since, filters) {
  const clauses = ["owner_username = ?", "occurred_at >= ?"];
  const bindings = [owner, since];
  for (const [name, value] of Object.entries(filters)) {
    clauses.push(USAGE_FILTERS[name] + " = ?");
    bindings.push(value);
  }
  return { sql: clauses.join(" AND "), bindings };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Keep spreadsheet applications from interpreting exported metadata as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function usageExportRow(row) {
  return {
    run_id: row.run_id,
    occurred_at_utc: Number.isFinite(Number(row.occurred_at)) ? new Date(Number(row.occurred_at)).toISOString() : null,
    run_status: row.run_status,
    actual_provider: row.actual_provider,
    actual_model: row.actual_model,
    requested_provider: row.requested_provider,
    requested_model: row.requested_model,
    route_source: row.route_source,
    fallback_used: row.fallback_used,
    project_id: row.project_id,
    session_id: row.upstream_session_id,
    job_id: row.hermes_job_id,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_write_tokens: row.cache_write_tokens,
    reasoning_tokens: row.reasoning_tokens,
    collection_status: row.collection_status,
    historical_gap: row.historical_gap,
    overflow_detected: row.overflow_detected,
    estimated_cost_micros: row.estimated_cost_micros,
    actual_cost_micros: row.actual_cost_micros,
    cost_status: row.cost_status,
    currency: row.currency,
    cost_note_code: row.cost_note_code,
    coverage_incomplete: row.coverage_incomplete
  };
}

async function exportOwnedUsage(env, owner, url) {
  const window = usageWindow(url);
  const filters = usageFilters(url);
  const limit = pageNumber(url, "limit", EXPORT_LIMIT_MAX, EXPORT_LIMIT_MAX);
  const runId = String(url.searchParams.get("run_id") || "").trim();
  if (runId) {
    if (!/^hrun_[a-f0-9]{32}$/.test(runId)) {
      throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
    }
    // Targeted exports re-check ownership here instead of relying on a prior list result.
    const owned = await env.DB.prepare(
      "SELECT run_id FROM hermes_run_usage WHERE run_id = ? AND owner_username = ?"
    ).bind(runId, owner).first();
    if (!owned) throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
  }
  const predicate = usagePredicate(owner, window.since, filters);
  const clauses = [predicate.sql];
  const bindings = [...predicate.bindings];
  if (runId) {
    clauses.push("run_id = ?");
    bindings.push(runId);
  }
  const result = await env.DB.prepare(
    `SELECT run_id, occurred_at, run_status, actual_provider, actual_model,
      requested_provider, requested_model, route_source, fallback_used, project_id,
      upstream_session_id, hermes_job_id, input_tokens, output_tokens, total_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens, collection_status,
      historical_gap, overflow_detected, estimated_cost_micros, actual_cost_micros,
      cost_status, currency, cost_note_code, coverage_incomplete
     FROM hermes_run_usage WHERE ${clauses.join(" AND ")}
     ORDER BY occurred_at DESC, run_id DESC LIMIT ?`
  ).bind(...bindings, limit + 1).all();
  const truncated = (result.results || []).length > limit;
  const rows = (result.results || []).slice(0, limit).map(usageExportRow);
  const columns = Object.keys(usageExportRow({}));
  const csv = [columns.join(","), ...rows.map(row => columns.map(name => csvCell(row[name])).join(","))].join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hermes-usage-${window.name}${truncated ? "-truncated" : ""}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Hermes-Export-Window": window.name,
      "X-Hermes-Export-Rows": String(rows.length),
      "X-Hermes-Export-Truncated": truncated ? "true" : "false"
    }
  });
}

function safeAggregate(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function aggregateBucket(row, name) {
  const known = Number(row?.[name + "_known"] || 0);
  return { value: known ? safeAggregate(row?.[name + "_sum"]) : null, knownRuns: known };
}

function summaryRecord(row) {
  const runCount = Number(row?.run_count || 0);
  const currencyCount = Number(row?.currency_count || 0);
  return {
    runCount,
    tokens: {
      input: aggregateBucket(row, "input"),
      output: aggregateBucket(row, "output"),
      total: aggregateBucket(row, "total"),
      cacheRead: aggregateBucket(row, "cache_read"),
      cacheWrite: aggregateBucket(row, "cache_write")
    },
    costs: {
      actualMicros: Number(row?.actual_count || 0) && currencyCount <= 1 ? safeAggregate(row?.actual_sum) : null,
      actualRuns: Number(row?.actual_count || 0),
      estimatedMicros: Number(row?.estimated_count || 0) && currencyCount <= 1 ? safeAggregate(row?.estimated_sum) : null,
      estimatedRuns: Number(row?.estimated_count || 0),
      includedRuns: Number(row?.included_count || 0),
      unavailableRuns: Number(row?.unavailable_count || 0),
      currencies: currencyCount,
      currency: currencyCount === 1 ? (row?.currency_value || null) : null
    },
    coverage: {
      collectedRuns: Number(row?.collected_count || 0),
      partialRuns: Number(row?.partial_count || 0),
      missingRuns: Number(row?.missing_count || 0),
      completeRuns: Number(row?.coverage_complete_count || 0),
      historicalGapRuns: Number(row?.historical_gap_count || 0),
      totalKnownRuns: Number(row?.total_known || 0)
    }
  };
}

async function readCollectionCoverage(db, owner, since) {
  const row = await db.prepare(
    `SELECT MIN(collected_at) AS collection_start, MIN(occurred_at) AS earliest_occurrence,
      MAX(collected_at) AS last_collected_at,
      SUM(CASE WHEN occurred_at < ? THEN 1 ELSE 0 END) AS records_before_window
     FROM hermes_run_usage WHERE owner_username = ?`
  ).bind(since, owner).first();
  return {
    collectionStart: safeAggregate(row?.collection_start),
    earliestOccurrence: safeAggregate(row?.earliest_occurrence),
    lastCollectedAt: safeAggregate(row?.last_collected_at),
    recordsBeforeWindow: Number(row?.records_before_window || 0),
    retention: "Usage facts are retained separately from the 30-day diagnostics payload cleanup.",
    historicalDataMayBeIncomplete: true,
    note: "Collection began with schema 0029. Pre-collection and retained-away upstream history may be missing; auxiliary, title, compression, and subtask usage may be incomplete."
  };
}

async function usageAnalytics(env, owner, url) {
  const window = usageWindow(url);
  const filters = usageFilters(url);
  const predicate = usagePredicate(owner, window.since, filters);
  const totalsSql = `SELECT COUNT(*) AS run_count,
    SUM(input_tokens) AS input_sum, COUNT(input_tokens) AS input_known,
    SUM(output_tokens) AS output_sum, COUNT(output_tokens) AS output_known,
    SUM(total_tokens) AS total_sum, COUNT(total_tokens) AS total_known,
    SUM(cache_read_tokens) AS cache_read_sum, COUNT(cache_read_tokens) AS cache_read_known,
    SUM(cache_write_tokens) AS cache_write_sum, COUNT(cache_write_tokens) AS cache_write_known,
    SUM(CASE WHEN cost_status = 'actual' THEN actual_cost_micros END) AS actual_sum,
    SUM(CASE WHEN cost_status = 'actual' THEN 1 ELSE 0 END) AS actual_count,
    SUM(CASE WHEN cost_status = 'estimated' THEN estimated_cost_micros END) AS estimated_sum,
    SUM(CASE WHEN cost_status = 'estimated' THEN 1 ELSE 0 END) AS estimated_count,
    SUM(CASE WHEN cost_status = 'included' THEN 1 ELSE 0 END) AS included_count,
    SUM(CASE WHEN cost_status NOT IN ('actual','estimated','included') OR cost_status IS NULL THEN 1 ELSE 0 END) AS unavailable_count,
    COUNT(DISTINCT CASE WHEN cost_status IN ('actual','estimated') THEN currency END) AS currency_count,
    MIN(CASE WHEN cost_status IN ('actual','estimated') THEN currency END) AS currency_value,
    SUM(CASE WHEN collection_status = 'collected' THEN 1 ELSE 0 END) AS collected_count,
    SUM(CASE WHEN collection_status = 'partial' THEN 1 ELSE 0 END) AS partial_count,
    SUM(CASE WHEN collection_status = 'missing' THEN 1 ELSE 0 END) AS missing_count,
    SUM(CASE WHEN coverage_incomplete = 0 THEN 1 ELSE 0 END) AS coverage_complete_count,
    SUM(CASE WHEN historical_gap = 1 THEN 1 ELSE 0 END) AS historical_gap_count
    FROM hermes_run_usage WHERE ${predicate.sql}`;
  const trendSql = `SELECT strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch') AS day,
    COUNT(*) AS run_count, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
    SUM(total_tokens) AS total_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
    SUM(cache_write_tokens) AS cache_write_tokens,
    SUM(CASE WHEN cost_status = 'actual' THEN actual_cost_micros END) AS actual_cost_micros,
    SUM(CASE WHEN cost_status = 'estimated' THEN estimated_cost_micros END) AS estimated_cost_micros
    FROM hermes_run_usage WHERE ${predicate.sql} GROUP BY day ORDER BY day ASC`;
  const facetQueries = Object.entries(USAGE_FILTERS).map(([name, column]) => env.DB.prepare(
    `SELECT ${column} AS value, COUNT(*) AS run_count FROM hermes_run_usage
     WHERE owner_username = ? AND occurred_at >= ? AND ${column} IS NOT NULL
     GROUP BY ${column} ORDER BY run_count DESC, value ASC LIMIT 100`
  ).bind(owner, window.since).all().then(result => [name, (result.results || []).map(row => ({
    value: row.value, runCount: Number(row.run_count || 0)
  }))]));
  const [totals, trend, coverage, facetEntries] = await Promise.all([
    env.DB.prepare(totalsSql).bind(...predicate.bindings).first(),
    env.DB.prepare(trendSql).bind(...predicate.bindings).all(),
    readCollectionCoverage(env.DB, owner, window.since),
    Promise.all(facetQueries)
  ]);
  return {
    ok: true,
    window: window.name,
    filters,
    summary: summaryRecord(totals),
    daily: (trend.results || []).map(row => ({
      day: row.day, runCount: Number(row.run_count || 0),
      inputTokens: safeAggregate(row.input_tokens), outputTokens: safeAggregate(row.output_tokens),
      totalTokens: safeAggregate(row.total_tokens), cacheReadTokens: safeAggregate(row.cache_read_tokens),
      cacheWriteTokens: safeAggregate(row.cache_write_tokens), actualCostMicros: safeAggregate(row.actual_cost_micros),
      estimatedCostMicros: safeAggregate(row.estimated_cost_micros)
    })),
    facets: Object.fromEntries(facetEntries),
    coverage
  };
}

export async function handleHermesUsage(request, env, url, { owner, fetchImpl } = {}) {
  if (request.method !== "GET") return null;
  if (url.pathname === "/api/hermes/usage/export") {
    return exportOwnedUsage(env, owner, url);
  }
  if (url.pathname === "/api/hermes/usage/analytics") {
    return usageAnalytics(env, owner, url);
  }
  if (url.pathname === "/api/hermes/usage/runs") {
    const window = usageWindow(url);
    const filters = usageFilters(url);
    const limit = pageNumber(url, "limit", 50, 100);
    const offset = pageNumber(url, "offset", 0, 10000);
    const predicate = usagePredicate(owner, window.since, filters);
    const result = await env.DB.prepare(
      `SELECT * FROM hermes_run_usage WHERE ${predicate.sql} ORDER BY occurred_at DESC, run_id DESC LIMIT ? OFFSET ?`
    ).bind(...predicate.bindings, limit, offset).all();
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM hermes_run_usage WHERE ${predicate.sql}`
    ).bind(...predicate.bindings).first();
    const total = Number(count?.total || 0);
    const coverage = await readCollectionCoverage(env.DB, owner, window.since);
    return {
      ok: true,
      runs: (result.results || []).map(usageRecord),
      page: { limit, offset, total, hasMore: offset + (result.results || []).length < total, window: window.name },
      filters,
      coverage
    };
  }
  const match = url.pathname.match(/^\/api\/hermes\/usage\/runs\/(hrun_[a-f0-9]{32})$/);
  if (!match) return null;
  const runId = match[1];
  const run = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ? AND owner_username = ?")
    .bind(runId, owner).first();
  if (!run) throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
  let stored = await readOwnedUsage(env.DB, owner, runId);
  if (!stored || stored.collection_status !== "collected") {
    const retryKey = owner + ":" + runId;
    const now = Date.now();
    if (now >= (backfillRetryAfter.get(retryKey) || 0)) {
      deferBackfill(retryKey, now);
      await backfillHermesRunUsage(env, run, { fetchImpl });
    }
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
