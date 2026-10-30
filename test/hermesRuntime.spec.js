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
import { resolveHermesUpstream } from "../src/hermes/config.js";
import { errorFromUpstream, redactSecrets } from "../src/hermes/errors.js";
import { createSseParser } from "../src/hermes/sse.js";
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

function getRun(id, { project = "default", user = "admin" } = {}) {
  return call("GET", "/api/hermes/runs/" + id + "?project_id=" + project, { user });
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
      sseFrame(1, { event: "message.delta", delta: "Hello " }),
      sseFrame(2, { event: "subagent.start", goal: "internal" }),
      "data: not-json\n\n"
    ], { close: false }), { headers: { "Content-Type": "text/event-stream" } });

    const firstStream = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default");
    expect(firstStream.headers.get("Content-Type")).toContain("text/event-stream");
    expect(firstStream.text).toContain("\"event\":\"message.delta\"");
    expect(firstStream.text).toContain("\"event\":\"tool.started\"");
    expect(firstStream.text).not.toContain("subagent");
    expect(firstStream.text).not.toContain("sk-secret123456");
    expect(firstStream.text).not.toContain("TOKEN=abc");
    expect(firstStream.text).toContain("hermes.stream_closed");

    const afterDrop = (await getRun(run.id)).json.run;
    expect(afterDrop).toMatchObject({ status: "running", lastEventSeq: 2 });
    expect(await messages(run.conversationId)).toHaveLength(1);

    // A new connection never asks upstream to replay, even when the browser offers a cursor.
    let upstreamHeaders = null;
    mock.onEvents = callInfo => {
      upstreamHeaders = callInfo.headers;
      mock.complete(upstreamId, "Hello world");
      return new Response(sseBody([
        sseFrame(3, { event: "message.delta", delta: "world" }),
        sseFrame(4, { event: "run.completed", output: "SSE output must not be trusted alone" })
      ]), { headers: { "Content-Type": "text/event-stream" } });
    };
    const resumed = await call("GET", "/api/hermes/runs/" + run.id + "/events?project_id=default&last_seq=1",
      { headers: { "Last-Event-ID": "1" } });
    expect(upstreamHeaders.has("Last-Event-ID")).toBe(false);
    const eventsCall = mock.calls.filter(item => item.path.endsWith("/events")).at(-1);
    expect(eventsCall.search).toBe("");
    expect(resumed.text).toContain("id: 3");
    expect(resumed.text).toContain("hermes.snapshot");
    const done = (await getRun(run.id)).json.run;
    expect(done.status).toBe("completed");
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
