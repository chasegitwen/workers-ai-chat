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

  it("isolates raw OpenAI and Anthropic cache conventions from pricing buckets", () => {
    const openAi = normalizeHermesUsage({
      input_tokens: 100, output_tokens: 20, total_tokens: 120,
      input_tokens_details: { cached_tokens: 60 }
    });
    expect(openAi).toMatchObject({
      input: null, output: null, total: null, cacheRead: null, collectionStatus: "missing"
    });
    expect(openAi.validationFlags).toEqual(expect.arrayContaining([
      "usage_shape_openai_raw_ignored", "input_includes_cache_true"
    ]));

    const anthropic = normalizeHermesUsage({
      input_tokens: 40, output_tokens: 5, cache_read_input_tokens: 60,
      cache_creation_input_tokens: 10
    });
    expect(anthropic).toMatchObject({
      input: null, output: null, total: null, cacheRead: null, cacheWrite: null,
      collectionStatus: "missing"
    });
    expect(anthropic.validationFlags).toEqual(expect.arrayContaining([
      "usage_shape_anthropic_raw_ignored", "input_includes_cache_false"
    ]));
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
      "collection_status", "occurred_at", "collected_at", "price_snapshot_json", "estimated_cost_micros"
    ]));
    const indexes = (await env.DB.prepare("PRAGMA index_list(hermes_run_usage)").all()).results.map(row => row.name);
    expect(indexes).toEqual(expect.arrayContaining([
      "idx_hermes_run_usage_owner_time", "idx_hermes_run_usage_owner_status_time"
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
