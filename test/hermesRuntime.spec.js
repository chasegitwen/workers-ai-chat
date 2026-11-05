import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import { handleChat } from "../src/api/chat.js";
import { createSession } from "../src/lib/auth.js";
import {
  normalizeHermesCapabilities,
  normalizeHermesModelOptions,
  validateHermesModelSelection
} from "../src/hermes/catalog.js";
import {
  normalizeHermesExecutionEnvironment,
  normalizeHermesSkills,
  normalizeHermesToolsets
} from "../src/hermes/capabilitiesPanel.js";
import { resolveHermesUpstream } from "../src/hermes/config.js";
import { errorFromUpstream, redactSecrets } from "../src/hermes/errors.js";
import { createSseParser } from "../src/hermes/sse.js";
import { sanitizeHermesTimelineEvent } from "../src/hermes/timeline.js";
import { MOCK_API_KEY, MockHermes, hermesEnv, sseBody, sseFrame } from "./helpers/mockHermes.js";

// Runs against local Miniflare D1 with the repository migrations (remoteBindings is off in
// vitest.config.js) and a Mock Hermes installed as fetch. No network, no real models.

const ORIGIN = "http://example.com";
let mock;
let logs;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["hermes_runs", "hermes_conversation_bindings", "hermes_catalog_cache", "messages", "conversations"]) {
    await env.DB.prepare("DELETE FROM " + table).run();
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO projects (id, name, slug, is_default, is_archived, created_at, updated_at) VALUES ('proj-b', 'B', 'proj-b', 0, 0, 'now', 'now')"
  ).run();
  mock = new MockHermes();
  vi.stubGlobal("fetch", mock.fetch);
  logs = [];
  for (const level of ["log", "info", "warn", "error"]) {
    vi.spyOn(console, level).mockImplementation((...args) => logs.push(args));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function testEnv(extra = {}) {
  return hermesEnv(env.DB, extra);
}

async function cookie(user = "admin") {
  return "wa_session=" + await createSession(user, testEnv());
}

async function call(method, path, { body, user = "admin", envExtra = {}, headers = {} } = {}) {
  const response = await worker.fetch(new Request(ORIGIN + path, {
    method,
    headers: { Cookie: await cookie(user), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  }), testEnv(envExtra), { waitUntil() {} });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { json = null; }
  return { status: response.status, json, text, headers: response.headers };
}

let requestCounter = 0;
function submitBody(extra = {}) {
  requestCounter += 1;
  return {
    project_id: "default",
    instance_id: "oracle-hermes",
    agent_id: "hermes-agent",
    client_request_id: "req-" + requestCounter + "-" + crypto.randomUUID().slice(0, 8),
    input: "Explain wheel-rail contact",
    ...extra
  };
}

function submit(extra = {}, options = {}) {
  return call("POST", "/api/hermes/runs", { body: submitBody(extra), ...options });
}

function getRun(id, { project = "default", user = "admin", envExtra = {} } = {}) {
  return call("GET", "/api/hermes/runs/" + id + "?project_id=" + project, { user, envExtra });
}

function action(id, name, { project = "default", user = "admin", body = {} } = {}) {
  return call("POST", "/api/hermes/runs/" + id + "/" + name, { body: { project_id: project, ...body }, user });
}

async function messages(conversationId) {
  const result = await env.DB.prepare(
    "SELECT id, role, content, metadata FROM messages WHERE conversation_id = ? ORDER BY created_at, id"
  ).bind(conversationId).all();
  return result.results;
}

async function slotHolder() {
  return env.DB.prepare("SELECT id, status FROM hermes_runs WHERE holds_slot = 1").first();
}

async function insertDiagnosticRun({ id, owner = "admin", status = "failed", createdAt = Date.now(), completedAt = null,
  timelineJson = null, errorCode = null, errorMessage = null } = {}) {
  const runId = id || "hrun_" + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(`INSERT INTO hermes_runs
    (id, owner_username, project_id, conversation_id, instance_id, agent_id, client_request_id,
     request_fingerprint, upstream_idempotency_key, upstream_request_json, model_mode, status,
     error_code, error_message, last_event_seq, timeline_json, submitted_at, completed_at, created_at, updated_at)
    VALUES (?, ?, 'default', ?, 'oracle-hermes', 'hermes-agent', ?, ?, ?, '{}', 'agent_default', ?, ?, ?, -1, ?, ?, ?, ?, ?)`)
    .bind(runId, owner, "conv-" + runId, "request-" + runId, "fingerprint-" + runId,
      "idem-" + runId, status, errorCode, errorMessage, timelineJson, createdAt, completedAt, createdAt, createdAt).run();
  return runId;
}

// The only way to release a slot whose remote outcome is unknown: an operator runs this guarded
// statement manually after confirming on the Hermes side that the run does not exist or has stopped.
async function releaseSlotAsOperator(id) {
  const ts = Date.now();
  await env.DB.prepare(
    `UPDATE hermes_runs SET status = 'abandoned', holds_slot = NULL, status_detail = 'released_by_operator',
       completed_at = ?, updated_at = ?
     WHERE id = ? AND holds_slot = 1 AND status IN ('submission_unknown', 'unknown')`
  ).bind(ts, ts, id).run();
}

function upstreamRunId(localRun) {
  return localRun.upstreamRunId;
}

function expectNoSecrets(text) {
  for (const secret of [MOCK_API_KEY, "access-secret-value-xyz", "access-id.access"]) {
    expect(text).not.toContain(secret);
  }
}

function dbWithFailingTimelineWrites(failures = Number.POSITIVE_INFINITY) {
  let remaining = failures;
  return {
    prepare(sql) {
      const statement = env.DB.prepare(sql);
      if (!/^UPDATE hermes_runs SET timeline_json/.test(sql)) return statement;
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            async run() {
              if (remaining > 0) {
                remaining -= 1;
                throw new Error("simulated timeline write failure");
              }
              return bound.run();
            }
          };
        }
      };
    },
    batch(statements) {
      return env.DB.batch(statements);
    }
  };
}

describe("Hermes catalog and provider selection", () => {
  it("whitelists provider/model fields and marks unauthenticated providers unselectable", () => {
    const options = normalizeHermesModelOptions(mock.modelOptions);
    expect(options.defaultProvider).toBe("openai-codex");
    expect(options.defaultModel).toBe("gpt-5.6-luna");
    expect(options.providers.map(row => row.id)).toEqual(["openai-codex", "minimax", "anthropic"]);
    expect(options.providers[0]).toEqual({
      id: "openai-codex", name: "OpenAI Codex", isCurrent: true, authenticated: true, selectable: true,
      models: [{ id: "gpt-5.6-luna", name: "gpt-5.6-luna" }, { id: "gpt-5.6-sol", name: "gpt-5.6-sol" }]
    });
    expect(options.providers[2].selectable).toBe(false);
    const serialized = JSON.stringify(options);
    for (const leaked of ["api_url", "key_env", "OPENAI_API_KEY", "internal.example", "usage", "warning", "sk-abc"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("validates explicit provider/model and maps the agent default to no override", () => {
    const catalog = { providers: normalizeHermesModelOptions(mock.modelOptions).providers };
    expect(validateHermesModelSelection(catalog, {})).toMatchObject({ ok: true, mode: "agent_default", provider: "", model: "" });
    expect(validateHermesModelSelection(catalog, { provider: "minimax", model: "MiniMax-M3" })).toMatchObject({ ok: true, mode: "explicit" });
    expect(validateHermesModelSelection(catalog, { provider: "minimax", model: "gpt-5.6-luna" }).code).toBe("hermes_unknown_model");
    expect(validateHermesModelSelection(catalog, { provider: "anthropic", model: "claude-x" }).code).toBe("hermes_provider_unavailable");
    expect(validateHermesModelSelection(catalog, { provider: "nope", model: "x" }).code).toBe("hermes_unknown_provider");
    expect(validateHermesModelSelection(catalog, { provider: "minimax" }).code).toBe("hermes_model_selection_incomplete");
  });

  it("negotiates capabilities and fails closed when a required feature is missing", () => {
    const ok = normalizeHermesCapabilities(mock.defaultCapabilities());
    expect(ok.executionReady).toBe(true);
    expect(ok.runsIdempotency).toEqual({ supported: true, durable: true, retentionSeconds: 86400 });
    const caps = mock.defaultCapabilities();
    caps.features.run_stop = false;
    expect(normalizeHermesCapabilities(caps)).toMatchObject({ executionReady: false, missing: ["run_stop"] });
    expect(normalizeHermesCapabilities({ object: "list" }).recognized).toBe(false);
    const aggregateClarify = mock.defaultCapabilities();
    aggregateClarify.features.run_clarify = true;
    delete aggregateClarify.features.run_clarify_response;
    delete aggregateClarify.features.clarify_events;
    expect(normalizeHermesCapabilities(aggregateClarify).features).toMatchObject({
      run_clarify: true, run_clarify_response: true, clarify_events: true
    });
  });

  it("preserves explicit false Clarify flags when inferring from run_clarify", () => {
    const noResponse = mock.defaultCapabilities();
    noResponse.features.run_clarify = true;
    noResponse.features.run_clarify_response = false;
    delete noResponse.features.clarify_events;
    expect(normalizeHermesCapabilities(noResponse).features).toMatchObject({
      run_clarify: true, run_clarify_response: false, clarify_events: true
    });

    const noEvents = mock.defaultCapabilities();
    noEvents.features.run_clarify = true;
    delete noEvents.features.run_clarify_response;
    noEvents.features.clarify_events = false;
    expect(normalizeHermesCapabilities(noEvents).features).toMatchObject({
      run_clarify: true, run_clarify_response: true, clarify_events: false
    });
  });

  it("serves the catalog through the API without credentials and caches it", async () => {
    const first = await call("GET", "/api/hermes/catalog");
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, visible: true, executionEnabled: true, approvalPolicy: "once_or_deny" });
    expect(first.json.instances).toEqual([{ id: "oracle-hermes", label: "Oracle Hermes", configured: true, agents: [{ id: "hermes-agent", name: "Hermes Agent" }] }]);
    expect(first.json.catalog.agents[0]).toMatchObject({ id: "hermes-agent", defaultModel: "gpt-5.6-luna", defaultProvider: "openai-codex" });
    expectNoSecrets(first.text);
    const capabilityCall = mock.calls.find(item => item.path === "/v1/capabilities");
    expect(capabilityCall.headers.get("Authorization")).toBe("Bearer " + MOCK_API_KEY);
    expect(capabilityCall.headers.get("CF-Access-Client-Secret")).toBe("access-secret-value-xyz");
    expect(capabilityCall.redirect).toBe("manual");
    const before = mock.calls.length;
    await call("GET", "/api/hermes/catalog");
    expect(mock.calls.length).toBe(before);
    await call("GET", "/api/hermes/catalog?refresh=1");
    expect(mock.calls.length).toBeGreaterThan(before);
  });

  it("only talks to the fixed allowlisted origin", () => {
    expect(resolveHermesUpstream(testEnv(), "oracle-hermes").ok).toBe(true);
    for (const base of ["https://evil.example", "http://oracle-hermes.hnsnowground.cfd", "https://oracle-hermes.hnsnowground.cfd/v1",
      "https://user:pw@oracle-hermes.hnsnowground.cfd", "https://oracle-hermes.hnsnowground.cfd?x=1"]) {
      expect(resolveHermesUpstream(testEnv({ HERMES_ORACLE_BASE_URL: base }), "oracle-hermes")).toMatchObject({ ok: false });
    }
    expect(resolveHermesUpstream(testEnv({ HERMES_ORACLE_API_KEY: "" }), "oracle-hermes").code).toBe("hermes_not_configured");
    expect(resolveHermesUpstream(testEnv(), "../other").ok).toBe(false);
  });
});

describe("Hermes read-only capabilities panel", () => {
  it("normalizes array and list envelopes through strict field allowlists", () => {
    expect(normalizeHermesSkills(mock.skills)).toEqual([
      { name: "github-pr-workflow", description: "Review and prepare pull requests", category: "development", version: "1.2.0", tags: ["git", "review"] },
      { name: "incident-response", description: "Triage incidents", category: "operations" }
    ]);
    expect(normalizeHermesToolsets({ data: mock.toolsets })[0]).toEqual({
      name: "coding", label: "Coding", description: "File and terminal tools",
      enabled: true, configured: true, tools: ["read_file", "terminal"]
    });
    const serialized = JSON.stringify({ skills: normalizeHermesSkills(mock.skills), toolsets: normalizeHermesToolsets(mock.toolsets) });
    for (const leaked of ["/home/hermes", "GITHUB_TOKEN", "TERMINAL_KEY", "api_key", "secret"]) expect(serialized).not.toContain(leaked);
    expect(normalizeHermesSkills([{ name: "safe", category: "test", description: "token=ghp_abcdefghijk" }])[0].description)
      .toBe("token=[redacted]");
    expect(normalizeHermesSkills([
      { name: "safe", category: "test", description: "credential " + MOCK_API_KEY }
    ], [MOCK_API_KEY])[0].description).toBe("credential [redacted]");
    expect(normalizeHermesExecutionEnvironment(mock.defaultCapabilities())).toEqual({
      status: "available", platform: "hermes-agent", model: "hermes-agent", apiSurface: "Hermes API Server",
      workingDirectory: { status: "unavailable", selectable: false },
      artifacts: { status: "unavailable", downloadable: false }, error: null
    });
  });

  it("proxies advertised endpoints with server-side auth and preserves real states", async () => {
    mock.toolsets.push({ name: "future", label: "Future", description: "No state fields", tools: [] });
    const response = await call("GET", "/api/hermes/capabilities-panel?instance_id=oracle-hermes");
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      ok: true, configured: true,
      environment: {
        status: "available", platform: "hermes-agent", model: "hermes-agent",
        workingDirectory: { status: "unavailable", selectable: false },
        artifacts: { status: "unavailable", downloadable: false }
      },
      skills: { status: "available" }, toolsets: { status: "available" }
    });
    expect(response.json.skills.items).toHaveLength(2);
    expect(response.json.toolsets.items[0]).toMatchObject({ name: "coding", enabled: true, configured: true, tools: ["read_file", "terminal"] });
    expect(response.json.toolsets.items[2]).toMatchObject({ enabled: null, configured: null });
    for (const path of ["/v1/skills", "/v1/toolsets"]) {
      const upstream = mock.calls.find(item => item.path === path);
      expect(upstream.headers.get("Authorization")).toBe("Bearer " + MOCK_API_KEY);
      expect(upstream.redirect).toBe("manual");
    }
    expectNoSecrets(response.text);
  });

  it("labels the known v0.22.x skills enumeration failure without hiding toolsets", async () => {
    mock.onSkills = () => new Response(JSON.stringify({
      error: { message: "Failed to enumerate skills", type: "server_error" }
    }), { status: 500, headers: { "Content-Type": "application/json" } });

    const response = await call("GET", "/api/hermes/capabilities-panel");

    expect(response.status).toBe(200);
    expect(response.json.skills).toMatchObject({
      status: "error",
      items: [],
      error: {
        code: "hermes_upstream_error",
        upstreamStatus: 500,
        knownIssue: "hermes_skills_enumerate_v022",
        message: expect.stringContaining("Suspected Hermes upstream v0.22.x GET /v1/skills defect")
      }
    });
    mock.onSkills = () => new Response(JSON.stringify({
      error: { message: "skills storage unavailable", type: "server_error" }
    }), { status: 500, headers: { "Content-Type": "application/json" } });
    const other = await call("GET", "/api/hermes/capabilities-panel");
    expect(other.json.skills.error).toMatchObject({
      code: "hermes_upstream_error",
      upstreamStatus: 500,
      message: "skills storage unavailable"
    });
    expect(other.json.skills.error.knownIssue).toBeUndefined();
    expect(response.json.toolsets).toMatchObject({ status: "available" });
    expect(response.json.toolsets.items).toHaveLength(mock.toolsets.length);
  });

  it("reports unadvertised, unconfigured and failed endpoints without inventing availability", async () => {
    mock.capabilities = mock.defaultCapabilities();
    delete mock.capabilities.endpoints.skills;
    mock.onToolsets = () => new Response(JSON.stringify({ error: { code: "enumeration_failed", message: "failed" } }), { status: 500, headers: { "Content-Type": "application/json" } });
    const partial = await call("GET", "/api/hermes/capabilities-panel");
    expect(partial.json.skills).toEqual({ status: "unavailable", items: [], error: null });
    expect(partial.json.toolsets).toMatchObject({
      status: "error", items: [], error: { code: "hermes_upstream_error", upstreamCode: "enumeration_failed" }
    });
    expect(mock.calls.some(item => item.path === "/v1/skills")).toBe(false);

    const before = mock.calls.length;
    const missing = await call("GET", "/api/hermes/capabilities-panel", { envExtra: { HERMES_ORACLE_API_KEY: "" } });
    expect(missing.json).toMatchObject({
      configured: false, environment: { status: "unconfigured", workingDirectory: { status: "unavailable" } },
      skills: { status: "unconfigured" }, toolsets: { status: "unconfigured" }
    });
    expect(mock.calls).toHaveLength(before);
  });

  it("requires the web session and never exposes mutating capability routes", async () => {
    const unauthenticated = await worker.fetch(new Request(ORIGIN + "/api/hermes/capabilities-panel"), testEnv(), { waitUntil() {} });
    expect(unauthenticated.status).toBe(401);
    expect((await call("POST", "/api/hermes/capabilities-panel", { body: {} })).status).toBe(404);
  });
});

describe("Hermes run settings payload wiring", () => {
  it("exposes read-only run-settings with honest gaps", async () => {
    const response = await call("GET", "/api/hermes/run-settings?instance_id=oracle-hermes");
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(true);
    expect(response.json.settings.fields.reasoning_effort.writable).toBe(true);
    expect(response.json.settings.fields.max_turns.writable).toBe(false);
    expect(response.json.settings.fields.approval_policy.policy).toBe("once_or_deny");
    expect(response.json.approvalPolicy).toMatchObject({ policy: "once_or_deny", writable: false });
    expect((await call("POST", "/api/hermes/run-settings", { body: {} })).status).toBe(404);
  });

  it("forwards model_options into the upstream /v1/runs body when overridden", async () => {
    const submitted = await submit({
      provider: "minimax",
      model: "MiniMax-M3",
      model_options: { reasoning: { effort: "high" }, service_tier: "priority" }
    });
    expect(submitted.status).toBe(202);
    const post = mock.posts()[0];
    expect(post.body).toEqual({
      input: "Explain wheel-rail contact",
      session_id: expect.stringMatching(/^webai-/),
      provider: "minimax",
      model: "MiniMax-M3",
      model_options: {
        reasoning: { effort: "high", enabled: true },
        service_tier: "priority"
      }
    });
    const row = await env.DB.prepare(
      "SELECT upstream_request_json FROM hermes_runs WHERE id = ?"
    ).bind(submitted.json.run.id).first();
    expect(JSON.parse(row.upstream_request_json).model_options).toEqual({
      reasoning: { effort: "high", enabled: true },
      service_tier: "priority"
    });
  });

  it("omits model_options when inheriting and rejects unsupported option keys", async () => {
    const inherited = await submit({ provider: "minimax", model: "MiniMax-M3" });
    expect(inherited.status).toBe(202);
    expect(mock.posts()[0].body.model_options).toBeUndefined();

    const rejected = await submit({
      provider: "minimax",
      model: "MiniMax-M3",
      model_options: { temperature: 0.1 }
    });
    expect(rejected.status).toBe(400);
    expect(rejected.json.error.code).toBe("hermes_unsupported_model_option");
    expect(mock.posts()).toHaveLength(1);
  });
});

describe("Hermes run submission and completion", () => {
  it("submits through /v1/runs, completes once, and records the actual model", async () => {
    const submitted = await submit({ provider: "minimax", model: "MiniMax-M3" });
    expect(submitted.status).toBe(202);
    const run = submitted.json.run;
    expect(run).toMatchObject({ status: "queued", runtimeType: "hermes", modelMode: "explicit", requestedProvider: "minimax", requestedModel: "MiniMax-M3" });
    expect(run.actions).toContain("cancel");
    expectNoSecrets(submitted.text);

    const post = mock.posts()[0];
    expect(post.body).toEqual({ input: "Explain wheel-rail contact", session_id: expect.stringMatching(/^webai-/), provider: "minimax", model: "MiniMax-M3" });
    expect(post.headers.get("Idempotency-Key")).toBe("webai-" + run.id);

    mock.run(upstreamRunId(run)).status = "running";
    expect((await getRun(run.id)).json.run.status).toBe("running");

    mock.complete(upstreamRunId(run), "Creep forces arise from ...", { provider: "minimax", model: "MiniMax-M3", route_source: "raw_request" });
    const done = (await getRun(run.id)).json.run;
    expect(done).toMatchObject({ status: "completed", terminal: true, actualProvider: "minimax", actualModel: "MiniMax-M3", routeSource: "raw_request" });
    expect(done.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(await slotHolder()).toBeNull();

    // Polling again (or concurrently) never writes a second assistant message.
    await Promise.all([getRun(run.id), getRun(run.id), getRun(run.id)]);
    const rows = await messages(run.conversationId);
    expect(rows.map(row => row.role)).toEqual(["user", "assistant"]);
    expect(rows[1]).toMatchObject({ id: "hermes-assistant-" + run.id, content: "Creep forces arise from ..." });
    expect(JSON.parse(rows[1].metadata)).toMatchObject({ runtime: "hermes", runtime_id: "oracle-hermes", model: "MiniMax-M3", provider: "minimax" });
  });

  it("applies an authoritative snapshot when its timeline persistence fails", async () => {
    const run = (await submit()).json.run;
    const upstream = mock.run(upstreamRunId(run));
    upstream.timeline = [{ event: "tool.completed", seq: 3, tool: "terminal", result_preview: "result" }];
    mock.complete(upstreamRunId(run), "authoritative answer");

    const response = await getRun(run.id, { envExtra: { DB: dbWithFailingTimelineWrites() } });

    expect(response.json.run).toMatchObject({ status: "completed", terminal: true, timeline: [] });
    expect(logs.some(args => args[0] === "[hermes] timeline_write_failed" && args[1]?.path === "snapshot")).toBe(true);
    const rows = await messages(run.conversationId);
    expect(rows.filter(row => row.role === "assistant").map(row => row.content)).toEqual(["authoritative answer"]);
    expect(await slotHolder()).toBeNull();
  });

  it("omits provider/model for the Agent default and reuses the conversation's Hermes session", async () => {
    const first = (await submit()).json.run;
    expect(mock.posts()[0].body).toEqual({ input: "Explain wheel-rail contact", session_id: expect.any(String) });
    mock.complete(upstreamRunId(first));
    await getRun(first.id);
    const second = (await submit({ conversation_id: first.conversationId, input: "And hunting stability?" })).json.run;
    expect(second.conversationId).toBe(first.conversationId);
    expect(mock.posts()[1].body.session_id).toBe(mock.posts()[0].body.session_id);
  });

  it("rejects an invalid model before anything is sent upstream", async () => {
    const response = await submit({ provider: "minimax", model: "not-a-model" });
    expect(response.status).toBe(400);
    expect(response.json.error.code).toBe("hermes_unknown_model");
    expect(mock.posts()).toHaveLength(0);
    expect(await slotHolder()).toBeNull();
  });

  it("refuses to submit when capabilities are incomplete", async () => {
    mock.capabilities = mock.defaultCapabilities();
    mock.capabilities.features.runs_idempotency = { supported: false };
    const response = await submit();
    expect(response.status).toBe(503);
    expect(response.json.error.code).toBe("hermes_capability_missing");
    expect(mock.posts()).toHaveLength(0);
  });
});

describe("Hermes idempotency", () => {
  it("replays the same client_request_id without a second upstream submit", async () => {
    const body = submitBody();
    const first = await call("POST", "/api/hermes/runs", { body });
    const second = await call("POST", "/api/hermes/runs", { body });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    expect(second.json.run.id).toBe(first.json.run.id);
    expect(mock.posts()).toHaveLength(1);
    expect(await messages(first.json.run.conversationId)).toHaveLength(1);
  });

  it("rejects a reused client_request_id with a different payload", async () => {
    const body = submitBody();
    await call("POST", "/api/hermes/runs", { body });
    const conflict = await call("POST", "/api/hermes/runs", { body: { ...body, input: "different" } });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("hermes_idempotency_conflict");
    expect(mock.posts()).toHaveLength(1);
  });

  it("scopes client_request_id per user", async () => {
    const body = submitBody();
    const alice = await call("POST", "/api/hermes/runs", { body, user: "alice" });
    mock.complete(upstreamRunId(alice.json.run));
    await getRun(alice.json.run.id, { user: "alice" });
    const bob = await call("POST", "/api/hermes/runs", { body, user: "bob" });
    expect(bob.status).toBe(202);
    expect(bob.json.run.id).not.toBe(alice.json.run.id);
  });
});

describe("Hermes submission timeout and unknown submission", () => {
  it("marks a timed-out submit as submission_unknown, holds the slot and never retries", async () => {
    mock.onCreate = () => { throw Object.assign(new Error("network lost"), { name: "TypeError" }); };
    const response = await submit();
    expect(response.status).toBe(202);
    const run = response.json.run;
    expect(run).toMatchObject({ status: "submission_unknown", upstreamRunId: null, error: { code: "hermes_network_error" } });
    expect(run.actions).toEqual(["reconcile"]);
    expect(run.actions).not.toContain("cancel");
    expect((await slotHolder()).id).toBe(run.id);

    // Polling and new submits do not resubmit or queue.
    await getRun(run.id);
    expect((await submit()).json.error.code).toBe("hermes_busy");
    expect(mock.posts()).toHaveLength(1);
    expect((await action(run.id, "cancel")).json.error.code).toBe("hermes_cancel_unavailable");
  });

  it("treats gateway 5xx as ambiguous but definite 4xx/draining as rejected", async () => {
    mock.onCreate = () => new Response("<html>Bad gateway</html>", { status: 502 });
    const unknown = (await submit()).json.run;
    expect(unknown.status).toBe("submission_unknown");
    expect((await slotHolder()).id).toBe(unknown.id);
    await releaseSlotAsOperator(unknown.id);

    mock.onCreate = () => new Response(JSON.stringify({ error: { message: "draining", type: "server_error", code: "gateway_draining" } }), { status: 503 });
    const rejected = (await submit()).json.run;
    expect(rejected).toMatchObject({ status: "rejected", terminal: true, error: { code: "hermes_unavailable" } });
    expect(await slotHolder()).toBeNull();
  });

  it("reclassifies a stale in-flight submit (Worker died) as submission_unknown", async () => {
    // Simulates a Worker that took the slot and died while the POST was in flight.
    const old = Date.now() - 10 * 60 * 1000;
    const id = "hrun_" + "a".repeat(32);
    await env.DB.prepare(
      `INSERT INTO hermes_runs (id, owner_username, project_id, conversation_id, instance_id, agent_id, client_request_id,
        request_fingerprint, upstream_idempotency_key, upstream_request_json, status, holds_slot, created_at, updated_at)
       VALUES (?, 'admin', 'default', 'conv-x', 'oracle-hermes', 'hermes-agent', 'req-stale-0001', 'f', ?, '{}', 'submitting', 1, ?, ?)`
    ).bind(id, "webai-" + id, old, old).run();
    const view = (await getRun(id)).json.run;
    expect(view).toMatchObject({ status: "submission_unknown", statusDetail: "worker_interrupted" });
    expect((await slotHolder()).id).toBe(id);
    expect(mock.posts()).toHaveLength(0);
  });

  it("reconciles with the persisted Idempotency-Key and links the original upstream run", async () => {
    let first = true;
    mock.onCreate = async () => {
      if (!first) return null;
      first = false;
      // Upstream created the run, but the response never arrived.
      await mock.fetch("https://oracle-hermes.hnsnowground.cfd/v1/runs", {
        method: "POST", headers: mock.calls.at(-1).headers, body: JSON.stringify(mock.calls.at(-1).body)
      });
      throw new Error("response lost");
    };
    const run = (await submit()).json.run;
    expect(run.status).toBe("submission_unknown");
    const createdUpstream = [...mock.runs.keys()][0];

    const reconciled = await action(run.id, "reconcile");
    expect(reconciled.status).toBe(200);
    expect(reconciled.json.run).toMatchObject({ status: "queued", upstreamRunId: createdUpstream, statusDetail: "idempotent_replay" });
    const keys = mock.posts().map(item => item.headers.get("Idempotency-Key"));
    expect(new Set(keys)).toEqual(new Set(["webai-" + run.id]));
    expect(mock.runs.size).toBe(1);
  });

  it("refuses reconcile without durable upstream idempotency and keeps the slot", async () => {
    mock.durableIdempotency = false;
    mock.onCreate = () => { throw new Error("timeout"); };
    const run = (await submit()).json.run;
    expect(run.actions).toEqual([]);
    const reconcile = await action(run.id, "reconcile");
    expect(reconcile.status).toBe(409);
    expect(reconcile.json.error.code).toBe("hermes_idempotency_not_durable");
    expect((await getRun(run.id)).json.run.status).toBe("submission_unknown");
    expect((await slotHolder()).id).toBe(run.id);
  });

  it("keeps submission_unknown and the slot when a reconcile is refused upstream", async () => {
    mock.onCreate = () => { throw new Error("timeout"); };
    const run = (await submit()).json.run;
    mock.onCreate = () => new Response(JSON.stringify({ error: { message: "draining", type: "server_error", code: "gateway_draining" } }), { status: 503 });
    const reconciled = (await action(run.id, "reconcile")).json.run;
    expect(reconciled).toMatchObject({ status: "submission_unknown", terminal: false, error: { code: "hermes_unavailable" } });
    expect((await slotHolder()).id).toBe(run.id);
  });

  it("exposes no public endpoint that releases the slot of a submission_unknown run", async () => {
    mock.onCreate = () => { throw new Error("timeout"); };
    const run = (await submit()).json.run;
    const abandon = await action(run.id, "abandon");
    expect(abandon.status).toBe(404);
    expect(abandon.json.error.code).toBe("hermes_not_found");
    for (let i = 0; i < 3; i += 1) await getRun(run.id);
    const row = await env.DB.prepare("SELECT status, holds_slot FROM hermes_runs WHERE id = ?").bind(run.id).first();
    expect(row).toEqual({ status: "submission_unknown", holds_slot: 1 });
    expect((await submit()).json.error.code).toBe("hermes_busy");
    expect(mock.posts()).toHaveLength(1);
  });
});

describe("Hermes SSE proxy, disconnect and resume", () => {
  it("re-emits whitelisted events, survives a disconnect without changing state, and never asks upstream to replay", async () => {
    const run = (await submit()).json.run;
    const upstreamId = upstreamRunId(run);
    mock.run(upstreamId).status = "running";
    mock.onEvents = () => new Response(sseBody([
      ": open\n\n",
      sseFrame(0, { event: "tool.started", tool: "terminal", preview: "export TOKEN=abc Bearer sk-secret123456" }),
      sseFrame(1, { event: "tool.completed", tool: "terminal", duration: 125, result_preview: "COOKIE=session-value " + "x".repeat(700), error: false }),
      sseFrame(2, { event: "subagent.start", goal: "inspect TOKEN=agent-secret" }),
      sseFrame(3, { event: "subagent.complete", status: "completed", duration: 240, summary: "found api_key=key-secret" }),
      sseFrame(4, { event: "message.delta", delta: "Hello " }),
      "data: not-json\n\n"
    ], { close: false }), { headers: { "Content-Type": "text/event-stream" } });

    const firstStream = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default");
    expect(firstStream.headers.get("Content-Type")).toContain("text/event-stream");
    expect(firstStream.text).toContain("\"event\":\"message.delta\"");
    expect(firstStream.text).toContain("\"event\":\"tool.started\"");
    expect(firstStream.text).toContain("\"event\":\"tool.completed\"");
    expect(firstStream.text).toContain("\"result\":\"COOKIE=[redacted] x");
    expect(firstStream.text).toContain("\"event\":\"subagent.start\"");
    expect(firstStream.text).toContain("\"event\":\"subagent.complete\"");
    expect(firstStream.text).not.toContain("sk-secret123456");
    expect(firstStream.text).not.toContain("TOKEN=abc");
    expect(firstStream.text).not.toContain("session-value");
    expect(firstStream.text).not.toContain("agent-secret");
    expect(firstStream.text).not.toContain("key-secret");
    expect(firstStream.text).toContain("hermes.stream_closed");

    const afterDrop = (await getRun(run.id)).json.run;
    expect(afterDrop).toMatchObject({ status: "running", lastEventSeq: 4 });
    expect(afterDrop.timeline).toHaveLength(4);
    expect(afterDrop.timeline[1]).toMatchObject({ event: "tool.completed", tool: "terminal", duration: 125, error: false });
    expect(afterDrop.timeline[1].result).toHaveLength(500);
    expect(JSON.stringify(afterDrop.timeline)).not.toMatch(/session-value|agent-secret|key-secret/);
    expectNoSecrets(JSON.stringify(afterDrop.timeline));
    expect(await messages(run.conversationId)).toHaveLength(1);

    // A new connection never asks upstream to replay, even when the browser offers a cursor.
    let upstreamHeaders = null;
    mock.onEvents = callInfo => {
      upstreamHeaders = callInfo.headers;
      mock.complete(upstreamId, "Hello world");
      return new Response(sseBody([
        sseFrame(5, { event: "message.delta", delta: "world" }),
        sseFrame(6, { event: "run.completed", output: "SSE output must not be trusted alone" })
      ]), { headers: { "Content-Type": "text/event-stream" } });
    };
    const resumed = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default&last_seq=1",
      { headers: { "Last-Event-ID": "1" } });
    expect(upstreamHeaders.has("Last-Event-ID")).toBe(false);
    const eventsCall = mock.calls.filter(item => item.path.endsWith("/events")).at(-1);
    expect(eventsCall.search).toBe("");
    expect(resumed.text).toContain("id: 5");
    expect(resumed.text).toContain("hermes.snapshot");
    const done = (await getRun(run.id)).json.run;
    expect(done.status).toBe("completed");
    expect(done.timeline).toHaveLength(4);
    const rows = await messages(run.conversationId);
    expect(rows.filter(row => row.role === "assistant").map(row => row.content)).toEqual(["Hello world"]);
  });

  it("reports an unavailable upstream stream without touching run state", async () => {
    const run = (await submit()).json.run;
    mock.run(upstreamRunId(run)).status = "running";
    const stream = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default");
    expect(stream.text).toContain("hermes.stream_unavailable");
    expect((await getRun(run.id)).json.run.status).toBe("running");
  });

  it("continues forwarding SSE events when timeline persistence fails", async () => {
    const run = (await submit()).json.run;
    mock.run(upstreamRunId(run)).status = "running";
    mock.onEvents = () => new Response(sseBody([
      sseFrame(0, { event: "tool.completed", tool: "terminal", result_preview: "still forwarded" }),
      sseFrame(1, { event: "message.delta", delta: "answer continues" })
    ]), { headers: { "Content-Type": "text/event-stream" } });

    const stream = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default", {
      envExtra: { DB: dbWithFailingTimelineWrites() }
    });

    expect(stream.text).toContain("\"event\":\"tool.completed\"");
    expect(stream.text).toContain("answer continues");
    expect(stream.text).toContain("hermes.stream_closed");
    expect(logs.some(args => args[0] === "[hermes] timeline_write_failed" && args[1]?.path === "sse")).toBe(true);
    expect((await getRun(run.id)).json.run).toMatchObject({ status: "running", timeline: [] });
  });

  it("parses split chunks, CRLF and comment frames", () => {
    const parser = createSseParser();
    expect(parser.push("id: 7\r\nda")).toEqual([]);
    const frames = parser.push("ta: {\"event\":\"message.delta\",\"delta\":\"x\",\"seq\":7}\r\n\r\n: keepalive\n\n");
    expect(frames).toEqual([
      { type: "event", id: "7", seq: 7, event: "message.delta", data: { event: "message.delta", delta: "x", seq: 7 } },
      { type: "comment", comment: "keepalive" }
    ]);
  });
});

describe("Hermes cancellation", () => {
  it("stops a running run and records a user cancellation", async () => {
    const run = (await submit()).json.run;
    mock.run(upstreamRunId(run)).status = "running";
    const cancelled = (await action(run.id, "cancel")).json.run;
    expect(cancelled).toMatchObject({ status: "stopping", cancelRequested: true });
    expect(mock.calls.some(item => item.method === "POST" && item.path.endsWith("/stop"))).toBe(true);
    mock.run(upstreamRunId(run)).status = "cancelled";
    const settled = (await getRun(run.id)).json.run;
    expect(settled).toMatchObject({ status: "cancelled", statusDetail: "cancelled_by_user", terminal: true });
    expect(await slotHolder()).toBeNull();
    expect((await messages(run.conversationId)).map(row => row.role)).toEqual(["user"]);
  });

  it("keeps cancel_requested when the stop call times out", async () => {
    const run = (await submit()).json.run;
    mock.run(upstreamRunId(run)).status = "running";
    mock.onStop = () => { throw new Error("timeout"); };
    const view = (await action(run.id, "cancel")).json;
    expect(view.run).toMatchObject({ status: "cancel_requested", statusDetail: "stop_unconfirmed" });
    expect(view.cancelError.code).toBe("hermes_network_error");
    expect((await slotHolder()).id).toBe(run.id);
    // Upstream finished first: the completed answer is kept, once.
    mock.complete(upstreamRunId(run), "finished before stop");
    expect((await getRun(run.id)).json.run.status).toBe("completed");
    expect((await messages(run.conversationId)).filter(row => row.role === "assistant")).toHaveLength(1);
  });
});

describe("Hermes run approvals", () => {
  it("restores a sanitized pending operation and approves only the exact current prompt once", async () => {
    const run = (await submit()).json.run;
    const prompt = mock.requestApproval(upstreamRunId(run), {
      prompt_id: "prompt-current",
      execution_generation: 4,
      command: "ssh audit@hillsboro 'uptime'\necho Bearer sk-secret123456",
      target: "Hillsboro VPS",
      risk: "Executes the displayed read-only command on a remote VPS"
    });

    const waiting = (await getRun(run.id)).json.run;
    expect(waiting).toMatchObject({
      status: "waiting_for_approval",
      approval: {
        requestId: prompt.prompt_id,
        executionGeneration: 4,
        tool: "terminal",
        target: "Hillsboro VPS",
        respondable: true,
        choices: ["once", "deny"]
      }
    });
    expect(waiting.approval.command).toContain("ssh audit@hillsboro");
    expect(waiting.approval.command).toContain("\n");
    expect(waiting.approval.command).not.toContain("sk-secret123456");
    expect(waiting.actions).toEqual(["approve_once", "deny", "refresh", "cancel"]);

    // A fresh page restores both the card and its safe actions from the scoped run list.
    const restored = await call("GET", "/api/hermes/runs?project_id=default&conversation_id=" + run.conversationId);
    expect(restored.json.runs[0].approval).toMatchObject({ requestId: prompt.prompt_id, respondable: true });

    const approved = await action(run.id, "approval", { body: {
      request_id: prompt.prompt_id,
      execution_generation: 4,
      choice: "once"
    } });
    expect(approved.status).toBe(200);
    expect(approved.json.run).toMatchObject({ status: "running", approval: null });
    expect(approved.json.approvalResponse).toMatchObject({ choice: "once", requestId: prompt.prompt_id, resolved: 1 });
    const upstream = mock.calls.filter(item => item.method === "POST" && item.path.endsWith("/approval"));
    expect(upstream).toHaveLength(1);
    expect(upstream[0].body).toEqual({
      request_id: prompt.prompt_id,
      execution_generation: 4,
      choice: "once"
    });
    const stored = await env.DB.prepare(
      "SELECT approval_request_id, approval_json, approval_response_pending FROM hermes_runs WHERE id = ?"
    ).bind(run.id).first();
    expect(stored).toEqual({ approval_request_id: null, approval_json: null, approval_response_pending: 0 });
  });

  it("forwards an explicit denial without offering session or permanent grants", async () => {
    const run = (await submit()).json.run;
    const prompt = mock.requestApproval(upstreamRunId(run), { prompt_id: "prompt-deny" });
    const waiting = (await getRun(run.id)).json.run;
    expect(waiting.approval.choices).toEqual(["once", "deny"]);
    expect(JSON.stringify(waiting)).not.toMatch(/session|always/);

    const denied = await action(run.id, "approval", { body: {
      request_id: prompt.prompt_id,
      execution_generation: prompt.execution_generation,
      choice: "deny"
    } });
    expect(denied.status).toBe(200);
    expect(mock.calls.find(item => item.path.endsWith("/approval")).body.choice).toBe("deny");
  });

  it("fails closed when Hermes does not advertise both approval capabilities", async () => {
    mock.capabilities = mock.defaultCapabilities();
    mock.capabilities.features.run_approval_response = false;
    const run = (await submit()).json.run;
    const prompt = mock.requestApproval(upstreamRunId(run), { prompt_id: "prompt-no-capability" });
    const waiting = (await getRun(run.id)).json.run;
    expect(waiting.approval.respondable).toBe(false);
    expect(waiting.actions).not.toContain("approve_once");
    const response = await action(run.id, "approval", { body: {
      request_id: prompt.prompt_id,
      execution_generation: prompt.execution_generation,
      choice: "once"
    } });
    expect(response.status).toBe(409);
    expect(response.json.error.code).toBe("hermes_approval_unavailable");
    expect(mock.calls.filter(item => item.path.endsWith("/approval"))).toHaveLength(0);
  });

  it("rejects cross-user, stale-id and stale-generation responses before forwarding", async () => {
    const run = (await submit({}, { user: "alice" })).json.run;
    const prompt = mock.requestApproval(upstreamRunId(run), {
      prompt_id: "prompt-a",
      execution_generation: 2
    });
    await getRun(run.id, { user: "alice" });
    const body = { request_id: prompt.prompt_id, execution_generation: 2, choice: "once" };

    expect((await action(run.id, "approval", { user: "bob", body })).status).toBe(404);
    expect((await action(run.id, "approval", { user: "alice", body: { ...body, request_id: "prompt-foreign" } })).status).toBe(409);
    expect((await action(run.id, "approval", { user: "alice", body: { ...body, execution_generation: 1 } })).status).toBe(409);
    expect(mock.calls.filter(item => item.path.endsWith("/approval"))).toHaveLength(0);

    mock.requestApproval(upstreamRunId(run), { prompt_id: "prompt-b", execution_generation: 3 });
    const expired = await action(run.id, "approval", { user: "alice", body });
    expect(expired.status).toBe(409);
    expect(expired.json.error.code).toBe("hermes_approval_stale");
    expect(mock.calls.filter(item => item.path.endsWith("/approval"))).toHaveLength(0);
  });

  it("allows only one concurrent click and returns 409 for the duplicate", async () => {
    const run = (await submit()).json.run;
    const prompt = mock.requestApproval(upstreamRunId(run), { prompt_id: "prompt-race", execution_generation: 5 });
    await getRun(run.id);
    mock.onApproval = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return null;
    };
    const options = { body: {
      request_id: prompt.prompt_id,
      execution_generation: 5,
      choice: "once"
    } };
    const responses = await Promise.all([
      action(run.id, "approval", options),
      action(run.id, "approval", options)
    ]);
    expect(responses.map(item => item.status).sort()).toEqual([200, 409]);
    expect(mock.calls.filter(item => item.path.endsWith("/approval"))).toHaveLength(1);
  });

  it("recovers the approval card after a timeout and surfaces upstream 409 conflicts", async () => {
    const run = (await submit()).json.run;
    const prompt = mock.requestApproval(upstreamRunId(run), { prompt_id: "prompt-retry", execution_generation: 6 });
    await getRun(run.id);
    const body = { request_id: prompt.prompt_id, execution_generation: 6, choice: "once" };

    mock.onApproval = () => { throw new Error("approval response lost"); };
    const timedOut = await action(run.id, "approval", { body });
    expect(timedOut.status).toBe(504);
    const afterTimeout = (await getRun(run.id)).json.run;
    expect(afterTimeout.approval).toMatchObject({ requestId: prompt.prompt_id, respondable: true, responding: false });

    mock.onApproval = () => new Response(JSON.stringify({
      error: { code: "approval_not_pending", type: "invalid_request_error", message: "already settled" }
    }), { status: 409, headers: { "Content-Type": "application/json" } });
    const conflict = await action(run.id, "approval", { body });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("hermes_approval_stale");
    const row = await env.DB.prepare(
      "SELECT approval_response_pending FROM hermes_runs WHERE id = ?"
    ).bind(run.id).first();
    expect(row.approval_response_pending).toBe(0);
  });
});

describe("Hermes run clarifications", () => {
  it("restores a distinct Clarify prompt, answers the same run, and re-syncs authoritative state", async () => {
    const run = (await submit()).json.run;
    const prompt = mock.requestClarify(upstreamRunId(run), {
      prompt_id: "clarify-current",
      execution_generation: 7,
      question: "Use loaded or empty vehicle conditions?"
    });

    const waiting = (await getRun(run.id)).json.run;
    expect(waiting).toMatchObject({
      status: "waiting_for_clarification",
      approval: null,
      clarify: {
        kind: "clarify",
        status: "pending",
        requestId: prompt.prompt_id,
        executionGeneration: 7,
        question: "Use loaded or empty vehicle conditions?",
        respondable: true
      }
    });
    expect(waiting.actions).toEqual(["answer_clarify", "refresh", "cancel"]);
    const getsBefore = mock.calls.filter(item => item.method === "GET" && item.path === "/v1/runs/" + upstreamRunId(run)).length;

    const answered = await action(run.id, "clarify", { body: {
      request_id: prompt.prompt_id,
      execution_generation: 7,
      answer: "Use the fully loaded condition."
    } });
    expect(answered.status).toBe(200);
    expect(answered.json.run).toMatchObject({ status: "running", clarify: null, approval: null });
    expect(answered.json.clarifyResponse).toMatchObject({ requestId: prompt.prompt_id, executionGeneration: 7, resolved: 1 });
    const upstream = mock.calls.filter(item => item.method === "POST" && item.path.endsWith("/clarify"));
    expect(upstream).toHaveLength(1);
    expect(upstream[0].body).toEqual({
      request_id: prompt.prompt_id,
      execution_generation: 7,
      answer: "Use the fully loaded condition."
    });
    const getsAfter = mock.calls.filter(item => item.method === "GET" && item.path === "/v1/runs/" + upstreamRunId(run)).length;
    expect(getsAfter - getsBefore).toBeGreaterThanOrEqual(2);
    expect(mock.posts()).toHaveLength(1);
    const stored = await env.DB.prepare(
      "SELECT clarify_request_id, clarify_json, clarify_response_pending FROM hermes_runs WHERE id = ?"
    ).bind(run.id).first();
    expect(stored).toEqual({ clarify_request_id: null, clarify_json: null, clarify_response_pending: 0 });
  });

  it("rejects foreign users and stale clarification identities without forwarding", async () => {
    const run = (await submit({}, { user: "alice" })).json.run;
    const prompt = mock.requestClarify(upstreamRunId(run), { prompt_id: "clarify-a", execution_generation: 2 });
    await getRun(run.id, { user: "alice" });
    const body = { request_id: prompt.prompt_id, execution_generation: 2, answer: "loaded" };

    expect((await action(run.id, "clarify", { user: "bob", body })).status).toBe(404);
    expect((await action(run.id, "clarify", { user: "alice", body: { ...body, request_id: "clarify-foreign" } })).json.error.code)
      .toBe("hermes_clarify_stale");
    expect((await action(run.id, "clarify", { user: "alice", body: { ...body, execution_generation: 1 } })).json.error.code)
      .toBe("hermes_clarify_stale");

    mock.requestClarify(upstreamRunId(run), { prompt_id: "clarify-b", execution_generation: 3 });
    const expired = await action(run.id, "clarify", { user: "alice", body });
    expect(expired.status).toBe(409);
    expect(expired.json.error.code).toBe("hermes_clarify_stale");
    expect(mock.calls.filter(item => item.path.endsWith("/clarify"))).toHaveLength(0);
  });

  it("allows only one concurrent clarification answer and keeps approval policy unchanged", async () => {
    const run = (await submit()).json.run;
    const prompt = mock.requestClarify(upstreamRunId(run), { prompt_id: "clarify-race", execution_generation: 5 });
    await getRun(run.id);
    mock.onClarify = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return null;
    };
    const options = { body: { request_id: prompt.prompt_id, execution_generation: 5, answer: "loaded" } };
    const responses = await Promise.all([
      action(run.id, "clarify", options),
      action(run.id, "clarify", options)
    ]);
    expect(responses.map(item => item.status).sort()).toEqual([200, 409]);
    expect(mock.calls.filter(item => item.path.endsWith("/clarify"))).toHaveLength(1);

    mock.complete(upstreamRunId(run));
    await getRun(run.id);
    const approvalRun = (await submit()).json.run;
    const approval = mock.requestApproval(upstreamRunId(approvalRun), { prompt_id: "approval-regression" });
    const denied = await action(approvalRun.id, "approval", { body: {
      request_id: approval.prompt_id,
      execution_generation: approval.execution_generation,
      choice: "deny"
    } });
    expect(denied.status).toBe(200);
    expect(mock.calls.find(item => item.path.endsWith("/approval")).body.choice).toBe("deny");
  });

  it("fails closed without explicit Clarify capabilities and sanitizes Clarify SSE separately", async () => {
    mock.capabilities = mock.defaultCapabilities();
    mock.capabilities.features.run_clarify_response = false;
    const run = (await submit()).json.run;
    const prompt = mock.requestClarify(upstreamRunId(run), {
      prompt_id: "clarify-no-capability",
      question: "Token Bearer sk-secret123456 — which mode?"
    });
    const waiting = (await getRun(run.id)).json.run;
    expect(waiting.clarify).toMatchObject({ kind: "clarify", respondable: false });
    expect(waiting.actions).not.toContain("answer_clarify");
    const refused = await action(run.id, "clarify", { body: {
      request_id: prompt.prompt_id,
      execution_generation: prompt.execution_generation,
      answer: "safe"
    } });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("hermes_clarify_unavailable");
    expect(mock.calls.filter(item => item.path.endsWith("/clarify"))).toHaveLength(0);

    mock.onEvents = () => new Response(sseBody([
      sseFrame(8, { event: "clarify.request", prompt_id: prompt.prompt_id,
        execution_generation: prompt.execution_generation, question: "Token Bearer sk-secret123456 — which mode?" }),
      sseFrame(9, { event: "clarify.settled" })
    ]), { headers: { "Content-Type": "text/event-stream" } });
    const stream = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default");
    expect(stream.text).toContain("clarify.request");
    expect(stream.text).toContain("clarify.settled");
    expect(stream.text).toContain('"respondable":false');
    expect(stream.text).not.toContain("sk-secret123456");
    expect(stream.text).not.toContain("approval.request");
  });
});

describe("Hermes unknown and interrupted runs", () => {
  it("holds the slot on unknown and resolves it only on explicit request", async () => {
    const run = (await submit()).json.run;
    Object.assign(mock.run(upstreamRunId(run)), { status: "unknown", execution_generation: 3 });
    const unknown = (await getRun(run.id)).json.run;
    expect(unknown).toMatchObject({ status: "unknown", terminal: false, statusDetail: "upstream_unknown" });
    expect(unknown.actions).toContain("resolve_unknown");
    expect(unknown.actions).not.toContain("abandon");
    expect((await slotHolder()).id).toBe(run.id);
    expect(mock.calls.some(item => item.path.endsWith("/resolve-unknown"))).toBe(false);

    const resolved = (await action(run.id, "resolve-unknown")).json.run;
    const resolveCall = mock.calls.find(item => item.path.endsWith("/resolve-unknown"));
    expect(resolveCall.body).toEqual({ admission_id: mock.run(upstreamRunId(run)).admission_id, execution_generation: 3 });
    // Authority mode reports the interrupted outcome as cancelled; it is not a user cancel.
    expect(resolved).toMatchObject({ status: "cancelled", statusDetail: "cancelled_upstream_without_request" });
    expect(mock.posts()).toHaveLength(1);
  });

  it("settles interrupted as terminal without retrying", async () => {
    const run = (await submit()).json.run;
    Object.assign(mock.run(upstreamRunId(run)), { status: "interrupted", error: "The gateway restarted before this run settled." });
    const view = (await getRun(run.id)).json.run;
    expect(view).toMatchObject({ status: "interrupted", terminal: true, error: { code: "hermes_run_interrupted" } });
    expect(view.error.message).toContain("gateway restarted");
    expect(await slotHolder()).toBeNull();
    expect(mock.posts()).toHaveLength(1);
    expect((await messages(run.conversationId)).map(row => row.role)).toEqual(["user"]);
  });

  it("treats a vanished upstream run as unknown (not failed) and keeps the slot", async () => {
    const run = (await submit()).json.run;
    const saved = new Map(mock.runs);
    mock.runs.clear();
    const view = (await getRun(run.id)).json.run;
    expect(view).toMatchObject({ status: "unknown", statusDetail: "upstream_not_found", terminal: false });
    expect(view.actions).toEqual(["refresh"]);
    expect((await action(run.id, "abandon")).status).toBe(404);
    expect((await slotHolder()).id).toBe(run.id);
    expect((await submit()).json.error.code).toBe("hermes_busy");

    // Only an authoritative terminal status releases it.
    for (const [id, value] of saved) mock.runs.set(id, value);
    mock.complete(upstreamRunId(run), "late answer");
    expect((await getRun(run.id)).json.run.status).toBe("completed");
    expect(await slotHolder()).toBeNull();
  });

  it("lets an operator release a confirmed-dead run's slot only through the guarded D1 step", async () => {
    mock.onCreate = () => { throw new Error("timeout"); };
    const run = (await submit()).json.run;
    await releaseSlotAsOperator(run.id);
    const view = (await getRun(run.id)).json.run;
    expect(view).toMatchObject({ status: "abandoned", terminal: true, actions: [] });
    expect(await slotHolder()).toBeNull();
    // The guarded statement never touches a run that already reached a terminal state.
    mock.onCreate = null;
    const next = (await submit()).json.run;
    mock.complete(upstreamRunId(next));
    await getRun(next.id);
    await releaseSlotAsOperator(next.id);
    expect((await getRun(next.id)).json.run.status).toBe("completed");
  });

  it("keeps state on transient status errors", async () => {
    const run = (await submit()).json.run;
    mock.onGet = () => new Response("upstream down", { status: 504 });
    const view = (await getRun(run.id)).json;
    expect(view.run.status).toBe("queued");
    expect(view.syncError.code).toBe("hermes_upstream_error");
  });
});

describe("Hermes execution slot", () => {
  it("lets exactly one of two concurrent submits take the slot, without queueing", async () => {
    const [a, b] = await Promise.all([submit(), submit({ input: "second" })]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([202, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error.code).toBe("hermes_busy");
    expect(loser.json.activeRunId).toBeTruthy();
    expect(mock.posts()).toHaveLength(1);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM hermes_runs").first();
    expect(count.n).toBe(1);
  });

  it("does not reveal another user's active run id", async () => {
    await submit({}, { user: "alice" });
    const bob = await submit({}, { user: "bob" });
    expect(bob.json.error.code).toBe("hermes_busy");
    expect(bob.json.activeRunId).toBeUndefined();
  });

  it("frees the slot after a terminal state so the next run can start", async () => {
    const first = (await submit()).json.run;
    mock.complete(upstreamRunId(first));
    await getRun(first.id);
    expect((await submit()).status).toBe(202);
  });
});

describe("Hermes user and project isolation", () => {
  it("hides runs from other users and other projects", async () => {
    const run = (await submit({}, { user: "alice" })).json.run;
    expect((await getRun(run.id, { user: "bob" })).status).toBe(404);
    expect((await getRun(run.id, { user: "alice", project: "proj-b" })).status).toBe(404);
    expect((await action(run.id, "cancel", { user: "bob" })).status).toBe(404);
    expect((await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default", { user: "bob" })).status).toBe(404);
    expect((await call("GET", "/api/hermes/runs/" + run.id, { user: "alice" })).status).toBe(400);
    expect((await getRun(run.id, { user: "alice" })).status).toBe(200);
  });

  it("refuses to use a conversation bound to another user or project", async () => {
    const run = (await submit({}, { user: "alice" })).json.run;
    mock.complete(upstreamRunId(run));
    await getRun(run.id, { user: "alice" });

    const bob = await submit({ conversation_id: run.conversationId }, { user: "bob" });
    expect(bob.status).toBe(403);
    expect(bob.json.error.code).toBe("hermes_conversation_forbidden");
    const otherProject = await submit({ conversation_id: run.conversationId, project_id: "proj-b" }, { user: "alice" });
    expect(otherProject.status).toBe(403);
    const list = await call("GET", "/api/hermes/runs?project_id=default&conversation_id=" + run.conversationId, { user: "bob" });
    expect(list.status).toBe(403);
    const own = await call("GET", "/api/hermes/runs?project_id=default&conversation_id=" + run.conversationId, { user: "alice" });
    expect(own.json.runs.map(item => item.id)).toEqual([run.id]);
    expect(mock.posts()).toHaveLength(1);
  });

  it("requires authentication", async () => {
    const response = await worker.fetch(new Request(ORIGIN + "/api/hermes/catalog"), testEnv(), {});
    expect(response.status).toBe(401);
  });
});

describe("Hermes run diagnostics", () => {
  it("lists only owned runs newest-first and applies time windows", async () => {
    const now = Date.now();
    const newest = await insertDiagnosticRun({ owner:"alice", status:"failed", createdAt:now - 1000 });
    const older = await insertDiagnosticRun({ owner:"alice", status:"completed", createdAt:now - 2000, completedAt:now - 1500 });
    await insertDiagnosticRun({ owner:"bob", status:"failed", createdAt:now - 500 });
    await insertDiagnosticRun({ owner:"alice", status:"interrupted", createdAt:now - 8 * 24 * 60 * 60 * 1000 });

    const day = await call("GET", "/api/hermes/diagnostics/runs?window=24h", { user:"alice" });
    expect(day.status).toBe(200);
    expect(day.json.runs.map(run => run.id)).toEqual([newest, older]);
    expect(day.json.runs.every(run => run.dataSource === "D1 persisted Hermes runs")).toBe(true);
    expect(day.json.pagination).toMatchObject({ total:2, offset:0, hasMore:false });

    const month = await call("GET", "/api/hermes/diagnostics/runs?window=30d&limit=2&offset=2", { user:"alice" });
    expect(month.json.pagination).toMatchObject({ total:3, limit:2, offset:2, hasMore:false });
    expect(month.json.runs).toHaveLength(1);
  });

  it.each([
    ["failed", "failed"], ["cancelled", "cancelled"], ["interrupted", "interrupted"],
    ["unknown", "unknown"], ["success", "completed"], ["stopping", "stopping"]
  ])("maps the %s filter to authoritative %s rows", async (filter, status) => {
    const expected = await insertDiagnosticRun({ status });
    await insertDiagnosticRun({ status:status === "failed" ? "completed" : "failed" });
    const response = await call("GET", "/api/hermes/diagnostics/runs?window=24h&status=" + filter);
    expect(response.status).toBe(200);
    expect(response.json.runs.map(run => run.id)).toEqual([expected]);
  });

  it("returns honest empty reasons and flags missing, empty, and persisted timelines", async () => {
    const missing = await insertDiagnosticRun({ status:"failed", errorCode:"tool_failed", errorMessage:"token=secret-value" });
    const empty = await insertDiagnosticRun({ status:"cancelled", timelineJson:"[]" });
    const available = await insertDiagnosticRun({ status:"completed", timelineJson:JSON.stringify([{ event:"tool.completed", tool:"terminal", error:false, result:"ok", seq:1 }]) });
    const list = await call("GET", "/api/hermes/diagnostics/runs?window=24h");
    expect(list.json.runs.find(run => run.id === missing).timelineCoverage).toBe("expired_or_missing");
    expect(list.json.runs.find(run => run.id === empty).timelineCoverage).toBe("empty");
    expect(list.json.runs.find(run => run.id === available).timelineCoverage).toBe("available");
    expect(JSON.stringify(list.json)).not.toContain("secret-value");

    const none = await call("GET", "/api/hermes/diagnostics/runs?window=24h&status=interrupted");
    expect(none.json.runs).toEqual([]);
    expect(none.json.emptyReason).toMatch(/No owned Hermes runs matched/);
  });

  it("detail sync performs one authoritative GET and never submits or retries", async () => {
    const created = await submit();
    const local = created.json.run;
    mock.run(upstreamRunId(local)).status = "failed";
    mock.run(upstreamRunId(local)).error = { code:"model_failed", message:"provider failed" };
    const postsBefore = mock.posts().length;
    const callsBefore = mock.calls.length;
    const detail = await call("GET", "/api/hermes/diagnostics/runs/" + local.id);
    expect(detail.status).toBe(200);
    expect(detail.json.run).toMatchObject({ id:local.id, status:"failed", timelineCoverage:"expired_or_missing" });
    expect(mock.posts()).toHaveLength(postsBefore);
    expect(mock.calls.slice(callsBefore)).toEqual(expect.arrayContaining([
      expect.objectContaining({ method:"GET", path:"/v1/runs/" + upstreamRunId(local) })
    ]));
    expect(mock.calls.slice(callsBefore).every(item => item.method === "GET")).toBe(true);
  });

  it("requires auth, hides cross-user details, and validates queries", async () => {
    const id = await insertDiagnosticRun({ owner:"alice" });
    const unauth = await worker.fetch(new Request(ORIGIN + "/api/hermes/diagnostics/runs"), testEnv(), {});
    expect(unauth.status).toBe(401);
    expect((await call("GET", "/api/hermes/diagnostics/runs/" + id, { user:"bob" })).status).toBe(404);
    expect((await call("GET", "/api/hermes/diagnostics/runs?window=1h", { user:"alice" })).status).toBe(400);
    expect((await call("GET", "/api/hermes/diagnostics/runs?status=made_up", { user:"alice" })).status).toBe(400);
    expect((await call("GET", "/api/hermes/diagnostics/runs", { user:"alice", envExtra:{ HERMES_CATALOG_VISIBLE:"" } })).status).toBe(404);
  });
});

describe("Hermes disabled and existing features", () => {
  it("hides every Hermes route when the catalog flag is off (default)", async () => {
    const off = { HERMES_CATALOG_VISIBLE: "", HERMES_EXECUTION_ENABLED: "1" };
    expect((await call("GET", "/api/hermes/catalog", { envExtra: off })).status).toBe(404);
    expect((await call("POST", "/api/hermes/runs", { body: submitBody(), envExtra: off })).json.error.code).toBe("hermes_disabled");
    expect(mock.calls).toHaveLength(0);
    const models = await call("GET", "/api/models", { envExtra: off });
    expect(models.status).toBe(200);
    expect(Array.isArray(models.json.models)).toBe(true);
  });

  it("shows the catalog but refuses execution when only the catalog flag is on", async () => {
    const catalogOnly = { HERMES_EXECUTION_ENABLED: "0" };
    const catalog = await call("GET", "/api/hermes/catalog", { envExtra: catalogOnly });
    expect(catalog.json).toMatchObject({ ok: true, visible: true, executionEnabled: false });
    const response = await call("POST", "/api/hermes/runs", { body: submitBody(), envExtra: catalogOnly });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe("hermes_execution_disabled");
    expect(mock.posts()).toHaveLength(0);
  });

  it("never serves a Hermes selection through the normal chat endpoint", async () => {
    const response = await handleChat(new Request(ORIGIN + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection_mode: "hermes", messages: [{ role: "user", content: "hi" }], model: "hermes-agent" })
    }), testEnv(), {});
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("hermes_wrong_endpoint");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("Hermes secret handling", () => {
  it("redacts private keys, JWTs, URL credentials, common token prefixes and Basic auth", () => {
    const secrets = [
      "-----BEGIN RSA PRIVATE KEY-----\nprivate-material\n-----END RSA PRIVATE KEY-----",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_value",
      "postgres://dbuser:dbpass@database.example/app",
      "https://webuser:webpass@example.com/path",
      "ghp_1234567890abcdef",
      "github_pat_1234567890_ABCDEF",
      "AKIA1234567890ABCDEF",
      "xoxb-12345678-abcdefghijkl",
      "xoxp-12345678-abcdefghijkl",
      "sk_live_1234567890abcdef",
      "sk_test_1234567890abcdef",
      "Authorization: Basic dXNlcjpwYXNz"
    ];

    const redacted = redactSecrets(secrets.join("\n"));

    for (const leaked of ["private-material", "eyJhbGci", "dbuser", "dbpass", "webuser", "webpass",
      "ghp_", "github_pat_", "AKIA", "xoxb-", "xoxp-", "sk_live_", "sk_test_", "dXNlcjpwYXNz"]) {
      expect(redacted).not.toContain(leaked);
    }
  });

  it("redacts tool results before retaining the bounded preview", () => {
    const secret = "github_pat_1234567890_ABCDEF";
    const event = sanitizeHermesTimelineEvent("tool.completed", {
      tool: "terminal",
      result_preview: "prefix " + secret + " " + "x".repeat(700)
    }, 1);

    expect(event.result).toHaveLength(500);
    expect(event.result).not.toContain(secret);
    expect(event.result).toContain("[redacted token]");
  });

  it("redacts a truncated private key that has no END marker", () => {
    const event = sanitizeHermesTimelineEvent("tool.completed", {
      tool: "terminal",
      result_preview: "prefix -----BEGIN RSA PRIVATE KEY-----\nprivate-material"
    }, 1);

    expect(event.result).toBe("prefix [redacted private key]");
    expect(event.result).not.toContain("private-material");
  });

  it("redacts a secret crossing the retained preview boundary before truncation", () => {
    const secret = "github_pat_1234567890_ABCDEF";
    const event = sanitizeHermesTimelineEvent("tool.completed", {
      tool: "terminal",
      result_preview: "x".repeat(489) + " " + secret + " trailing output"
    }, 1);

    expect(event.result).toHaveLength(500);
    expect(event.result).not.toContain(secret);
    expect(event.result).toContain("[redacted");
  });

  it("redacts upstream error text and never logs credentials", async () => {
    mock.onCreate = () => new Response(JSON.stringify({
      error: { message: "bad key Bearer " + MOCK_API_KEY + " api_key=\"zzz\"", type: "invalid_request_error", code: "bad" }
    }), { status: 400 });
    const response = await submit();
    expect(response.json.run.status).toBe("rejected");
    expectNoSecrets(response.text);
    expect(response.text).not.toContain("zzz");
    expectNoSecrets(JSON.stringify(logs));
    const row = await env.DB.prepare("SELECT * FROM hermes_runs").first();
    expectNoSecrets(JSON.stringify(row));
  });

  it("maps auth failures and redirects without echoing bodies", () => {
    expect(errorFromUpstream(401, { error: { message: "nope" } }).code).toBe("hermes_upstream_auth");
    expect(errorFromUpstream(302, null).code).toBe("hermes_upstream_auth");
    expect(errorFromUpstream(502, null, { mutating: true }).ambiguous).toBe(true);
    expect(errorFromUpstream(400, null, { mutating: true }).ambiguous).toBe(false);
    expect(redactSecrets("token: abc, Authorization=Bearer xyz", [])).not.toMatch(/abc|xyz/);
  });
});
