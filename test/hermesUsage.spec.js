import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import { createSession } from "../src/lib/auth.js";
import { pruneHermesDiagnosticPayloads } from "../src/hermes/persistence.js";
import {
  MAX_SAFE_TOKEN_COUNT,
  normalizeHermesAttribution,
  normalizeHermesUsage,
  persistHermesRunUsage
} from "../src/hermes/usage.js";
import { gradeHermesCost, MAX_SAFE_MICROS } from "../src/hermes/pricing.js";
import { MockHermes, hermesEnv } from "./helpers/mockHermes.js";

const ORIGIN = "http://example.com";
let mock;

beforeAll(async () => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));

beforeEach(async () => {
  for (const table of ["hermes_run_usage", "hermes_runs", "hermes_conversation_bindings", "messages", "conversations"]) {
    await env.DB.prepare("DELETE FROM " + table).run();
  }
  mock = new MockHermes();
  vi.stubGlobal("fetch", mock.fetch);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function testEnv(extra = {}) { return hermesEnv(env.DB, extra); }

async function cookie(user = "admin", extra = {}) {
  return "wa_session=" + await createSession(user, testEnv(extra));
}

async function call(path, { user = "admin", envExtra = {}, method = "GET", body } = {}) {
  const response = await worker.fetch(new Request(ORIGIN + path, {
    method,
    headers: { Cookie: await cookie(user, envExtra), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), testEnv(envExtra), { waitUntil() {} });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { /* response under test is not JSON */ }
  return { status: response.status, json, text };
}

async function insertRun({
  owner = "admin", status = "running", requestedProvider = "openai-codex",
  requestedModel = "gpt-requested", completedAt = null, diagnostics = null
} = {}) {
  const id = "hrun_" + crypto.randomUUID().replace(/-/g, "");
  const upstream = mock.newRun({ input: "usage test" });
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO hermes_runs
     (id, owner_username, project_id, conversation_id, instance_id, agent_id, client_request_id,
      request_fingerprint, upstream_idempotency_key, upstream_request_json, upstream_run_id,
      upstream_session_id, model_mode, requested_provider, requested_model, status, upstream_status,
      holds_slot, last_event_seq, timeline_json, diagnostics_json, created_at, updated_at, completed_at)
     VALUES (?, ?, 'default', ?, 'oracle-hermes', 'hermes-agent', ?, ?, ?, '{}', ?, ?,
      'explicit', ?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?)`
  ).bind(
    id, owner, "conv-" + id, "request-" + id, "fingerprint-" + id, "idem-" + id,
    upstream.run_id, upstream.session_id, requestedProvider, requestedModel, status, status,
    status === "running" ? 1 : null, diagnostics ? "[]" : null, diagnostics,
    now, now, completedAt
  ).run();
  return { id, upstream, owner, now };
}

describe("Hermes B2-1 usage normalization", () => {
  it("accepts Hermes legacy and token-key shapes without double-counting cache", () => {
    expect(normalizeHermesUsage({ input: 100, output: 20, total: 120, cache_read: 60 })).toMatchObject({
      input: 100, output: 20, total: 120, cacheRead: 60, cacheWrite: null,
      reasoning: null, collectionStatus: "collected"
    });
    expect(normalizeHermesUsage({ input_tokens: 40, output_tokens: 5, total_tokens: 45 })).toMatchObject({
      input: 40, output: 5, total: 45, cacheRead: null, cacheWrite: null
    });
    expect(normalizeHermesUsage(null)).toMatchObject({
      input: null, output: null, total: null, collectionStatus: "missing"
    });
  });

  it("keeps Responses totals but flags unverified cache details and isolates hard raw markers", () => {
    const openAi = normalizeHermesUsage({
      input_tokens: 100000, output_tokens: 20, total_tokens: 100020,
      input_tokens_details: { cached_tokens: 90000 }
    });
    expect(openAi).toMatchObject({
      input: 100000, output: 20, total: 100020, cacheRead: null, collectionStatus: "partial"
    });
    expect(openAi.validationFlags).toEqual(["usage_cache_convention_unverified"]);

    const normalizedDetails = normalizeHermesUsage({
      input_tokens: 100000, output_tokens: 20, total_tokens: 100020,
      cache_read_tokens: 90000, input_tokens_details: { cached_tokens: 90000 }
    });
    expect(normalizedDetails).toMatchObject({ cacheRead: 90000, collectionStatus: "collected" });
    expect(normalizedDetails.validationFlags).toEqual([]);

    const invalidCanonical = normalizeHermesUsage({
      input_tokens: { invalid: true }, input_tokens_details: { cached_tokens: 60 }, prompt_tokens: 100
    });
    expect(invalidCanonical).toMatchObject({ input: null, collectionStatus: "missing" });
    expect(invalidCanonical.validationFlags).toContain("usage_shape_openai_raw_ignored");

    const anthropic = normalizeHermesUsage({
      input_tokens: 40, output_tokens: 5, cache_read_input_tokens: 60000,
      cache_creation_input_tokens: 10000
    });
    expect(anthropic).toMatchObject({
      input: null, output: null, total: null, cacheRead: null, cacheWrite: null,
      collectionStatus: "missing"
    });
    expect(anthropic.validationFlags).toEqual(expect.arrayContaining([
      "usage_shape_anthropic_raw_ignored", "input_includes_cache_false"
    ]));

    const openAiChat = normalizeHermesUsage({
      input_tokens: 100, output_tokens: 5, prompt_tokens: 100, completion_tokens: 5, cached_tokens: 80
    });
    expect(openAiChat).toMatchObject({ input: null, output: null, collectionStatus: "missing" });
    expect(openAiChat.validationFlags).toContain("usage_shape_openai_raw_ignored");
  });

  it("grades no-price, included, actual, cache-aware and service-tier costs honestly", () => {
    const normalized = normalizeHermesUsage({
      input_tokens: 1000000, output_tokens: 500000, total_tokens: 1800000,
      cache_read_tokens: 200000, cache_write_tokens: 100000
    });
    const attribution = { actualProvider: "metered", actualModel: "m", serviceTier: null };
    expect(gradeHermesCost({ normalized, attribution, snapshot: {}, catalog: null })).toMatchObject({
      costStatus: "n_a", costMicros: null, priceSnapshot: null
    });
    const includedCatalog = { providers: [{ id: "openai-codex", billingMode: "subscription_included", models: [{ id: "m" }] }] };
    expect(gradeHermesCost({ normalized, attribution: { ...attribution, actualProvider: "openai-codex" }, snapshot: {}, catalog: includedCatalog }))
      .toMatchObject({ costStatus: "included", costMicros: null, priceSnapshot: null });
    const customCatalog = { providers: [{ id: "custom:x", billingMode: "custom_unknown", models: [{ id: "m" }] }] };
    expect(gradeHermesCost({ normalized, attribution: { ...attribution, actualProvider: "custom:x" }, snapshot: {}, catalog: customCatalog }))
      .toMatchObject({ costStatus: "n_a", costMicros: null, note: { code: "custom_pricing_unknown" } });

    const pricing = {
      source: "hermes_model_options", currency: "USD", unit: "usd_per_million_tokens", collectedAt: 100,
      pricingVersion: "v1", free: false,
      rates: { input: "2", output: "4", cacheRead: "0.5", cacheWrite: "1", request: null },
      serviceTiers: { fast: { input: "3", output: "6", cacheRead: "0.75", cacheWrite: "1.5", request: null } }
    };
    const catalog = { providers: [{ id: "metered", billingMode: "metered", models: [{ id: "m", pricing }] }] };
    expect(gradeHermesCost({ normalized, attribution, snapshot: {}, catalog })).toMatchObject({
      costStatus: "estimated", costMicros: 4200000,
      priceSnapshot: { provider: "metered", model: "m", collectedAt: 100 }
    });
    for (const provider of ["zai", "kimi-coding", "unknown-api"]) {
      const referenceCatalog = { providers: [{ id: provider, billingMode: "reference_only", models: [{ id: "m", pricing }] }] };
      expect(gradeHermesCost({
        normalized, attribution: { ...attribution, actualProvider: provider }, snapshot: {}, catalog: referenceCatalog
      })).toMatchObject({
        costStatus: "n_a", costMicros: null, note: { code: "reference_price_not_spend" }
      });
    }
    expect(gradeHermesCost({ normalized, attribution: { ...attribution, serviceTier: "fast" }, snapshot: {}, catalog }))
      .toMatchObject({ costStatus: "estimated", costMicros: 6300000 });
    expect(gradeHermesCost({ normalized, attribution: { ...attribution, serviceTier: "mystery" }, snapshot: {}, catalog }))
      .toMatchObject({ costStatus: "unknown", costMicros: null, note: { code: "service_tier_price_unknown" } });
    const unverifiedDetails = normalizeHermesUsage({
      input_tokens: 100000, output_tokens: 20, total_tokens: 100020,
      input_tokens_details: { cached_tokens: 90000 }
    });
    expect(gradeHermesCost({ normalized: unverifiedDetails, attribution, snapshot: {}, catalog }))
      .toMatchObject({ costStatus: "unknown", costMicros: null, note: { code: "usage_cache_convention_unverified" } });
    const freeCatalog = structuredClone(catalog);
    freeCatalog.providers[0].models[0].pricing.free = true;
    expect(gradeHermesCost({ normalized, attribution, snapshot: {}, catalog: freeCatalog }))
      .toMatchObject({ costStatus: "included", costMicros: null, note: { code: "price_explicitly_free" } });

    const missingCache = structuredClone(catalog);
    missingCache.providers[0].models[0].pricing.rates.cacheWrite = null;
    expect(gradeHermesCost({ normalized, attribution, snapshot: {}, catalog: missingCache })).toMatchObject({
      costStatus: "unknown", costMicros: null, note: { code: "cache_write_price_missing" }
    });
    expect(gradeHermesCost({ normalized, attribution, snapshot: {
      billing: { status: "actual", source: "provider_response", currency: "USD", amount_usd: "1.234567" }
    }, catalog })).toMatchObject({ costStatus: "actual", costMicros: 1234567 });
    expect(gradeHermesCost({ normalized, attribution, snapshot: {
      usage: { estimated_cost_usd: "99" }, billing: { status: "estimated", source: "provider_response", amount_usd: "99" }
    }, catalog })).toMatchObject({ costStatus: "estimated", costMicros: 4200000 });
  });

  it("uses integer-micro precision, never a fake free zero, and rejects cost overflow", () => {
    const tiny = normalizeHermesUsage({ input_tokens: 1, output_tokens: 0, total_tokens: 1 });
    const pricing = { source: "test", currency: "USD", unit: "usd_per_million_tokens", collectedAt: 1,
      pricingVersion: null, free: false, rates: { input: "0.1", output: "1", cacheRead: null, cacheWrite: null, request: null }, serviceTiers: {} };
    const attribution = { actualProvider: "p", actualModel: "m", serviceTier: null };
    const catalog = { providers: [{ id: "p", billingMode: "metered", models: [{ id: "m", pricing }] }] };
    expect(gradeHermesCost({ normalized: tiny, attribution, snapshot: {}, catalog }))
      .toMatchObject({ costStatus: "estimated", costMicros: 1 });

    const hugePricing = structuredClone(pricing);
    hugePricing.rates.input = "999999999999";
    const hugeCatalog = { providers: [{ id: "p", billingMode: "metered", models: [{ id: "m", pricing: hugePricing }] }] };
    expect(gradeHermesCost({
      normalized: normalizeHermesUsage({ input_tokens: MAX_SAFE_TOKEN_COUNT, output_tokens: 0, total_tokens: MAX_SAFE_TOKEN_COUNT }),
      attribution, snapshot: {}, catalog: hugeCatalog
    })).toMatchObject({ costStatus: "unknown", costMicros: null, overflow: true });
    expect(MAX_SAFE_MICROS).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("rejects unsafe token precision with an explicit overflow flag", () => {
    const normalized = normalizeHermesUsage({
      input_tokens: String(BigInt(MAX_SAFE_TOKEN_COUNT) + 1n), output_tokens: 2, total_tokens: 3
    });
    expect(normalized).toMatchObject({ input: null, output: 2, total: 3, collectionStatus: "partial", overflowDetected: true });
    expect(normalized.validationFlags).toContain("input_overflow");
  });

  it("marks fallback only when comparable requested and actual routing differs", () => {
    expect(normalizeHermesAttribution(
      { provider: "anthropic", model: "claude-x", route_source: "fallback" },
      { provider: "openai-codex", model: "gpt-requested" }
    )).toMatchObject({ actualProvider: "anthropic", actualModel: "claude-x", fallbackUsed: true });
    expect(normalizeHermesAttribution({ provider: "openai-codex" }, {} ).fallbackUsed).toBeNull();
  });
});
describe("Hermes B2-1 collection and API", () => {
  it("applies the additive usage schema and owner/time indexes", async () => {
    const columns = (await env.DB.prepare("PRAGMA table_info(hermes_run_usage)").all()).results.map(row => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      "input_tokens", "cache_read_tokens", "reasoning_tokens", "actual_provider", "requested_provider",
      "collection_status", "occurred_at", "collected_at", "price_snapshot_json", "estimated_cost_micros",
      "actual_cost_micros", "cost_note", "cost_note_code", "coverage_incomplete", "coverage_note"
    ]));
    const indexes = (await env.DB.prepare("PRAGMA index_list(hermes_run_usage)").all()).results.map(row => row.name);
    expect(indexes).toEqual(expect.arrayContaining([
      "idx_hermes_run_usage_owner_time", "idx_hermes_run_usage_owner_status_time",
      "idx_hermes_usage_owner_provider_time", "idx_hermes_usage_owner_model_time",
      "idx_hermes_usage_owner_session_time", "idx_hermes_usage_owner_project_time",
      "idx_hermes_usage_owner_job_time"
    ]));
  });

  it("upserts terminal usage and fixes actual runtime attribution on hermes_runs", async () => {
    const local = await insertRun();
    Object.assign(local.upstream, {
      status: "completed", output: "",
      runtime: { provider: "anthropic", model: "claude-x", route_source: "fallback", service_tier: "standard" },
      usage: { input: 2000001, output: 9, total: 2000010, cache_read: 1500000, reasoning: 3 }
    });
    const response = await call("/api/hermes/runs/" + local.id + "?project_id=default");
    expect(response.status).toBe(200);
    const stored = await env.DB.prepare("SELECT * FROM hermes_run_usage WHERE run_id = ?").bind(local.id).first();
    expect(stored).toMatchObject({
      input_tokens: 2000001, output_tokens: 9, total_tokens: 2000010, cache_read_tokens: 1500000,
      cache_write_tokens: null, reasoning_tokens: 3, actual_provider: "anthropic", actual_model: "claude-x",
      requested_provider: "openai-codex", requested_model: "gpt-requested", route_source: "fallback",
      fallback_used: 1, collection_status: "collected", collection_source: "get_run",
      price_snapshot_json: null, estimated_cost_micros: null, currency: null
    });
    expect(await env.DB.prepare("SELECT actual_provider, actual_model, route_source FROM hermes_runs WHERE id = ?")
      .bind(local.id).first()).toEqual({ actual_provider: "anthropic", actual_model: "claude-x", route_source: "fallback" });
  });

  it("deduplicates repeated terminal/SSE persistence by owner and run", async () => {
    const local = await insertRun({ status: "completed", completedAt: Date.now() });
    const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
    const snapshot = { status: "completed", runtime: { provider: "openai-codex", model: "gpt-requested" }, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    await persistHermesRunUsage(testEnv(), row, snapshot, { source: "sse_terminal" });
    expect(await env.DB.prepare("SELECT collection_source FROM hermes_run_usage WHERE run_id = ?").bind(local.id).first())
      .toEqual({ collection_source: "sse_terminal" });
    await persistHermesRunUsage(testEnv(), row, snapshot, { source: "get_run" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM hermes_run_usage WHERE run_id = ?").bind(local.id).first()).toEqual({ n: 1 });
  });

  it("attaches estimates from the cached catalog, exposes coverage, and keeps price snapshots immutable", async () => {
    const local = await insertRun({ requestedProvider: "metered", requestedModel: "m", status: "completed", completedAt: Date.now() });
    const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
    const catalog = rate => ({
      providers: [{ id: "metered", billingMode: "metered", models: [{ id: "m", pricing: {
        source: "hermes_model_options", currency: "USD", unit: "usd_per_million_tokens", collectedAt: 111,
        pricingVersion: "v1", free: false,
        rates: { input: rate, output: "4", cacheRead: "0.5", cacheWrite: "1", request: null }, serviceTiers: {}
      } }] }]
    });
    await env.DB.prepare(
      `INSERT INTO hermes_catalog_cache (instance_id, catalog_json, capabilities_json, synced_at)
       VALUES ('oracle-hermes', ?, '{}', 111)`
    ).bind(JSON.stringify(catalog("2"))).run();
    const snapshot = {
      status: "completed", runtime: { provider: "metered", model: "m" },
      usage: { input_tokens: 1000000, output_tokens: 500000, total_tokens: 1700000, cache_read_tokens: 200000 }
    };
    await persistHermesRunUsage(testEnv(), row, snapshot);
    let stored = await env.DB.prepare(
      "SELECT price_snapshot_json, estimated_cost_micros, cost_status, coverage_incomplete FROM hermes_run_usage WHERE run_id = ?"
    ).bind(local.id).first();
    expect(stored).toMatchObject({ estimated_cost_micros: 4100000, cost_status: "estimated", coverage_incomplete: 1 });
    expect(JSON.parse(stored.price_snapshot_json)).toMatchObject({
      provider: "metered", model: "m", collectedAt: 111, rates: { input: "2" }
    });

    await env.DB.prepare("UPDATE hermes_catalog_cache SET catalog_json = ?, synced_at = 222 WHERE instance_id = 'oracle-hermes'")
      .bind(JSON.stringify(catalog("200"))).run();
    await persistHermesRunUsage(testEnv(), row, {
      ...snapshot,
      usage: { input_tokens: 1000000, output_tokens: 500000, total_tokens: 1700000 }
    });
    stored = await env.DB.prepare(
      "SELECT price_snapshot_json, estimated_cost_micros FROM hermes_run_usage WHERE run_id = ?"
    ).bind(local.id).first();
    expect(stored.estimated_cost_micros).toBe(4100000);
    expect(JSON.parse(stored.price_snapshot_json).rates.input).toBe("2");

    const detail = await call("/api/hermes/usage/runs/" + local.id);
    expect(detail.json.usage).toMatchObject({
      costStatus: "estimated", estimatedCostMicros: 4100000, actualCostMicros: null,
      coverageIncomplete: true,
      coverageNote: expect.stringContaining("not total-system cost"),
      priceSnapshot: { provider: "metered", model: "m", rates: { input: "2" } }
    });
    expect(detail.json.usage.costNoteCode).toBe("reference_price_estimate");
    const list = await call("/api/hermes/usage/runs?window=24h");
    expect(list.json.runs[0]).toMatchObject({ runId: local.id, costStatus: "estimated", estimatedCostMicros: 4100000 });
  });

  it("regrades merged token buckets and lets unknown replace a stale estimate while actual stays sticky", async () => {
    const local = await insertRun({ requestedProvider: "metered", requestedModel: "m", status: "completed", completedAt: Date.now() });
    const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
    const pricing = {
      source: "test", currency: "USD", unit: "usd_per_million_tokens", collectedAt: 1,
      pricingVersion: "v1", free: false,
      rates: { input: "2", output: "4", cacheRead: null, cacheWrite: null, request: null }, serviceTiers: {}
    };
    await env.DB.prepare(
      `INSERT INTO hermes_catalog_cache (instance_id, catalog_json, capabilities_json, synced_at)
       VALUES ('oracle-hermes', ?, '{}', 1)`
    ).bind(JSON.stringify({ providers: [{ id: "metered", billingMode: "metered", models: [{ id: "m", pricing }] }] })).run();

    await persistHermesRunUsage(testEnv(), row, {
      status: "completed", runtime: { provider: "metered", model: "m" },
      usage: { input_tokens: 1000000, output_tokens: 500000, total_tokens: 1500000 }
    });
    expect(await env.DB.prepare(
      "SELECT estimated_cost_micros, cost_status FROM hermes_run_usage WHERE run_id = ?"
    ).bind(local.id).first()).toEqual({ estimated_cost_micros: 4000000, cost_status: "estimated" });

    await persistHermesRunUsage(testEnv(), row, {
      status: "completed", runtime: { provider: "metered", model: "m" }, usage: { cache_read_tokens: 200000 }
    });
    expect(await env.DB.prepare(
      "SELECT input_tokens, cache_read_tokens, estimated_cost_micros, cost_status, cost_note_code FROM hermes_run_usage WHERE run_id = ?"
    ).bind(local.id).first()).toEqual({
      input_tokens: 1000000, cache_read_tokens: 200000, estimated_cost_micros: null,
      cost_status: "unknown", cost_note_code: "cache_read_price_missing"
    });

    await persistHermesRunUsage(testEnv(), row, {
      status: "completed", runtime: { provider: "metered", model: "m" }, usage: {},
      billing: { status: "actual", source: "provider_response", currency: "USD", amount_usd: "1.25" }
    });
    await persistHermesRunUsage(testEnv(), row, {
      status: "completed", runtime: { provider: "metered", model: "m" }, usage: {}
    });
    expect(await env.DB.prepare(
      "SELECT actual_cost_micros, cost_status, cost_note_code FROM hermes_run_usage WHERE run_id = ?"
    ).bind(local.id).first()).toEqual({
      actual_cost_micros: 1250000, cost_status: "actual", cost_note_code: "provider_charged"
    });
  });

  it.each([
    ["failed", { input_tokens: 7, output_tokens: 1, total_tokens: 8 }, "collected"],
    ["cancelled", {}, "missing"],
    ["interrupted", { input_tokens: 7 }, "partial"]
  ])("stores explicit nullable coverage for %s terminal runs", async (status, usage, collectionStatus) => {
    const local = await insertRun();
    Object.assign(local.upstream, { status, error: "stopped", usage });
    await call("/api/hermes/runs/" + local.id + "?project_id=default");
    const stored = await env.DB.prepare("SELECT collection_status, input_tokens, output_tokens, total_tokens FROM hermes_run_usage WHERE run_id = ?")
      .bind(local.id).first();
    expect(stored.collection_status).toBe(collectionStatus);
    if (collectionStatus === "missing") expect(stored).toMatchObject({ input_tokens: null, output_tokens: null, total_tokens: null });
  });

  it("backfills an owned terminal run with GET only after restart", async () => {
    const local = await insertRun({ status: "completed", completedAt: Date.now() });
    Object.assign(local.upstream, { status: "completed", usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } });
    mock.calls.length = 0;
    const response = await call("/api/hermes/usage/runs/" + local.id);
    expect(response.status).toBe(200);
    expect(response.json.usage).toMatchObject({ collectionSource: "backfill", collectionStatus: "collected", tokens: { input: 12, output: 4, total: 16 } });
    expect(mock.calls.map(call => call.method)).toEqual(["GET"]);
    expect(mock.calls[0].path).toContain("/v1/runs/");
  });

  it("persists cancel usage only from the authoritative GET after stop", async () => {
    const local = await insertRun();
    mock.onStop = async (_call, run) => {
      Object.assign(run, {
        status: "cancelled",
        usage: { input_tokens: 11, output_tokens: 2, total_tokens: 13 }
      });
      return new Response(JSON.stringify({
        run_id: run.run_id, status: "cancelled",
        usage: { input_tokens: 999, output_tokens: 999, total_tokens: 1998 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    mock.calls.length = 0;
    const response = await call("/api/hermes/runs/" + local.id + "/cancel?project_id=default", { method: "POST", body: {} });
    expect(response.status).toBe(200);
    expect(response.json.run.status).toBe("cancelled");
    expect(mock.calls.map(item => item.method)).toEqual(["POST", "GET"]);
    expect(await env.DB.prepare(
      "SELECT input_tokens, output_tokens, total_tokens, collection_source FROM hermes_run_usage WHERE run_id = ?"
    ).bind(local.id).first()).toEqual({
      input_tokens: 11, output_tokens: 2, total_tokens: 13, collection_source: "get_run"
    });
  });

  it("upgrades a prior missing row when a later authoritative GET has usage", async () => {
    const local = await insertRun({ status: "completed", completedAt: Date.now() });
    const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
    await persistHermesRunUsage(testEnv(), row, { status: "completed", usage: {} }, { source: "backfill" });
    Object.assign(local.upstream, {
      status: "completed", usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 }
    });
    const response = await call("/api/hermes/usage/runs/" + local.id);
    expect(response.json.usage).toMatchObject({
      collectionStatus: "collected", collectionSource: "backfill",
      tokens: { input: 8, output: 3, total: 11 }, validationFlags: []
    });
  });

  it("exposes paginated owner-only usage and hides cross-user detail", async () => {
    const alice = await insertRun({ owner: "alice", status: "completed", completedAt: Date.now() });
    const bob = await insertRun({ owner: "bob", status: "completed", completedAt: Date.now() });
    for (const local of [alice, bob]) {
      const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
      await persistHermesRunUsage(testEnv(), row, { status: "completed", usage: { input: 1, output: 2, total: 3 } });
    }
    const list = await call("/api/hermes/usage/runs?window=24h&limit=10&offset=0", { user: "alice" });
    expect(list.status).toBe(200);
    expect(list.json.runs.map(run => run.runId)).toEqual([alice.id]);
    expect(list.json.coverage.historicalDataMayBeIncomplete).toBe(true);
    expect((await call("/api/hermes/usage/runs/" + bob.id, { user: "alice" })).status).toBe(404);
  });

  it("aggregates owner-scoped totals and daily trends that reconcile with filtered details", async () => {
    const aliceA = await insertRun({ owner: "alice", status: "completed", completedAt: Date.now() - 2000 });
    const aliceB = await insertRun({ owner: "alice", status: "completed", completedAt: Date.now() - 1000 });
    const bob = await insertRun({ owner: "bob", status: "completed", completedAt: Date.now() });
    const samples = [
      [aliceA, "metered", "model-a", 10, 2, 12, "session-a", "job-a"],
      [aliceB, "metered", "model-b", 20, 3, 23, "session-b", null],
      [bob, "metered", "model-a", 999, 1, 1000, "session-bob", "job-bob"]
    ];
    for (const [local, provider, model, input, output, total, session, job] of samples) {
      const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
      await persistHermesRunUsage(testEnv(), row, {
        status: "completed", session_id: session, job_id: job,
        runtime: { provider, model }, usage: { input_tokens: input, output_tokens: output, total_tokens: total }
      });
    }
    await env.DB.prepare(
      `UPDATE hermes_run_usage SET cost_status = 'estimated', estimated_cost_micros = 1200,
       currency = 'USD', cost_note_code = 'catalog_estimate' WHERE run_id = ?`
    ).bind(aliceA.id).run();
    await env.DB.prepare(
      `UPDATE hermes_run_usage SET cost_status = 'included', estimated_cost_micros = NULL,
       currency = NULL, cost_note_code = 'subscription_included' WHERE run_id = ?`
    ).bind(aliceB.id).run();

    const analytics = await call("/api/hermes/usage/analytics?window=24h&provider=metered", { user: "alice" });
    expect(analytics.status).toBe(200);
    expect(analytics.json.summary).toMatchObject({
      runCount: 2,
      tokens: { input: { value: 30, knownRuns: 2 }, output: { value: 5, knownRuns: 2 }, total: { value: 35, knownRuns: 2 } },
      costs: { estimatedMicros: 1200, estimatedRuns: 1, includedRuns: 1 },
      coverage: { totalKnownRuns: 2 }
    });
    expect(analytics.json.daily.reduce((sum, day) => sum + day.totalTokens, 0)).toBe(35);
    expect(analytics.json.facets.model.map(item => item.value)).toEqual(expect.arrayContaining(["model-a", "model-b"]));
    expect(analytics.json.coverage.note).toContain("Pre-collection");

    const details = await call("/api/hermes/usage/runs?window=24h&provider=metered&model=model-a&limit=1&offset=0", { user: "alice" });
    expect(details.json.page).toMatchObject({ total: 1, hasMore: false });
    expect(details.json.runs.map(run => run.runId)).toEqual([aliceA.id]);
    expect(details.json.runs[0]).toMatchObject({ costStatus: "estimated", costNoteCode: "catalog_estimate" });
  });

  it("rejects unbounded or malformed analytics inputs", async () => {
    expect((await call("/api/hermes/usage/analytics?window=365d")).status).toBe(400);
    expect((await call("/api/hermes/usage/runs?provider=%20bad%20value")).status).toBe(400);
    expect((await call("/api/hermes/usage/runs?limit=101")).status).toBe(400);
  });

  it("keeps terminalization successful when the usage write fails", async () => {
    const local = await insertRun();
    Object.assign(local.upstream, { status: "completed", output: "", usage: { input: 1, output: 1, total: 2 } });
    const failingDb = {
      prepare(sql) {
        if (/INSERT INTO hermes_run_usage/.test(sql)) {
          return { bind() { return { run: async () => { throw new Error("simulated usage outage"); } }; } };
        }
        return env.DB.prepare(sql);
      },
      batch(statements) { return env.DB.batch(statements); }
    };
    const response = await call("/api/hermes/runs/" + local.id + "?project_id=default", { envExtra: { DB: failingDb } });
    expect(response.status).toBe(200);
    expect(response.json.run.status).toBe("completed");
    expect(await env.DB.prepare("SELECT status FROM hermes_runs WHERE id = ?").bind(local.id).first()).toEqual({ status: "completed" });
  });

  it("records a historical gap when backfill returns no explicit usage", async () => {
    const local = await insertRun({ status: "completed", completedAt: Date.now() });
    Object.assign(local.upstream, { status: "completed", usage: {} });
    const response = await call("/api/hermes/usage/runs/" + local.id);
    expect(response.json.usage).toMatchObject({ collectionStatus: "missing", historicalGap: true, tokens: { input: null, output: null, total: null } });
  });

  it("uses retained local usage when upstream backfill is not found", async () => {
    const local = await insertRun({ status: "completed", completedAt: Date.now() });
    await env.DB.prepare("UPDATE hermes_runs SET usage_json = ? WHERE id = ?")
      .bind(JSON.stringify({ input_tokens: 14, output_tokens: 6, total_tokens: 20 }), local.id).run();
    mock.onGet = async () => new Response(JSON.stringify({
      error: { code: "run_not_found", message: "Run not found", type: "not_found" }
    }), { status: 404, headers: { "Content-Type": "application/json" } });
    const response = await call("/api/hermes/usage/runs/" + local.id);
    expect(response.json.usage).toMatchObject({
      collectionStatus: "collected", historicalGap: true,
      tokens: { input: 14, output: 6, total: 20 }
    });
  });

  it("backs off repeated detail backfill after a transient upstream error", async () => {
    const local = await insertRun({ status: "completed", completedAt: Date.now() });
    mock.onGet = async () => new Response(JSON.stringify({
      error: { code: "upstream_busy", message: "Try later", type: "server_error" }
    }), { status: 503, headers: { "Content-Type": "application/json" } });
    mock.calls.length = 0;
    expect((await call("/api/hermes/usage/runs/" + local.id)).json.collectionPending).toBe(true);
    expect((await call("/api/hermes/usage/runs/" + local.id)).json.collectionPending).toBe(true);
    expect(mock.calls.filter(item => item.method === "GET" && item.path.includes("/v1/runs/")).length).toBe(1);
  });

  it("diagnostic pruning never deletes durable usage", async () => {
    const old = Date.now() - 40 * 86400000;
    const local = await insertRun({ status: "failed", completedAt: old, diagnostics: JSON.stringify({ status: "failed" }) });
    await env.DB.prepare("UPDATE hermes_runs SET created_at = ?, updated_at = ? WHERE id = ?").bind(old, old, local.id).run();
    const row = await env.DB.prepare("SELECT * FROM hermes_runs WHERE id = ?").bind(local.id).first();
    await persistHermesRunUsage(testEnv(), row, { status: "failed", usage: { input: 3, output: 1, total: 4 } }, { now: old });
    expect(await pruneHermesDiagnosticPayloads(testEnv(), { now: Date.now() })).toBe(1);
    expect(await env.DB.prepare("SELECT total_tokens FROM hermes_run_usage WHERE run_id = ?").bind(local.id).first()).toEqual({ total_tokens: 4 });
  });
});
