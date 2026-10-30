// In-memory Mock Hermes API server (v0.22.5 /v1/runs contract) for offline tests.
// It is installed as globalThis.fetch and refuses any URL outside the mock origin, so a
// test can never reach a real Hermes, model or Cloudflare endpoint.

export const MOCK_HERMES_ORIGIN = "https://oracle-hermes.hnsnowground.cfd";
export const MOCK_API_KEY = "test-hermes-key-0123456789abcdef";

export function hermesEnv(db, extra = {}) {
  return {
    DB: db,
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "password",
    SESSION_SECRET: "test-session-secret",
    HERMES_CATALOG_VISIBLE: "1",
    HERMES_EXECUTION_ENABLED: "1",
    HERMES_ORACLE_BASE_URL: MOCK_HERMES_ORIGIN,
    HERMES_ORACLE_API_KEY: MOCK_API_KEY,
    HERMES_ORACLE_ACCESS_CLIENT_ID: "access-id.access",
    HERMES_ORACLE_ACCESS_CLIENT_SECRET: "access-secret-value-xyz",
    ...extra
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function err(status, code, message, type = "invalid_request_error") {
  return json({ error: { message, type, param: null, code } }, status);
}

export class MockHermes {
  constructor({ durableIdempotency = true, unknownResolution = true } = {}) {
    this.calls = [];
    this.runs = new Map();
    this.idempotency = new Map();
    this.seq = 0;
    this.durableIdempotency = durableIdempotency;
    this.unknownResolution = unknownResolution;
    // Hooks: return a Response (or throw) to override default handling.
    this.onCreate = null;
    this.onGet = null;
    this.onStop = null;
    this.onApproval = null;
    this.onEvents = null;
    this.capabilities = null;
    this.modelOptions = {
      providers: [
        { slug: "openai-codex", name: "OpenAI Codex", is_current: true, is_user_defined: false, models: ["gpt-5.6-luna", "gpt-5.6-sol"], total_models: 2, source: "built-in", authenticated: true, key_env: "OPENAI_API_KEY", api_url: "https://internal.example/v1" },
        { slug: "minimax", name: "MiniMax", is_current: false, models: ["MiniMax-M3"], total_models: 1, authenticated: true, usage: { secret: "x" } },
        { slug: "anthropic", name: "Anthropic", is_current: false, models: ["claude-x"], authenticated: false, warning: "missing key sk-abcdefghijk" },
        { slug: "bad slug!", name: "Bad", models: ["m"] }
      ],
      model: "gpt-5.6-luna",
      provider: "openai-codex"
    };
    this.fetch = this.fetch.bind(this);
  }

  defaultCapabilities() {
    return {
      object: "hermes.api_server.capabilities",
      platform: "hermes-agent",
      model: "hermes-agent",
      auth: { type: "bearer", required: true },
      features: {
        run_submission: true, run_status: true, run_events_sse: true, run_stop: true,
        run_approval_response: true, approval_events: true, tool_progress_events: true, model_options: true,
        run_unknown_resolution: this.unknownResolution,
        runs_idempotency: { supported: true, durable: this.durableIdempotency, retention_seconds: 86400 }
      },
      endpoints: {}
    };
  }

  newRun(body) {
    const runId = "run_" + crypto.randomUUID().replace(/-/g, "");
    const run = {
      object: "hermes.run", run_id: runId, status: "queued", session_id: body.session_id || runId,
      model: body.model || "hermes-agent", created_at: Date.now() / 1000, admission_id: "adm_" + runId.slice(4, 12),
      execution_generation: 1, output: "", usage: {}, pending_controls: [], _body: body
    };
    this.runs.set(runId, run);
    return run;
  }

  run(runId) {
    return this.runs.get(runId);
  }

  complete(runId, output = "Hermes answer", runtime = { provider: "openai-codex", model: "gpt-5.6-luna", route_source: "global" }) {
    Object.assign(this.run(runId), { status: "completed", output, runtime, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
  }

  requestApproval(runId, approval = {}) {
    const run = this.run(runId);
    const executionGeneration = Number.isInteger(approval.execution_generation)
      ? approval.execution_generation
      : run.execution_generation;
    const control = {
      kind: "approval",
      prompt_id: approval.prompt_id || "prompt_" + crypto.randomUUID().replace(/-/g, ""),
      execution_generation: executionGeneration,
      tool: approval.tool || "terminal",
      command: approval.command || "ssh audit@example uptime",
      target: approval.target || "example",
      description: approval.description || "Remote command execution requires confirmation",
      risk: approval.risk || "The terminal tool will execute the displayed command",
      choices: approval.choices || ["once", "session", "always", "deny"]
    };
    Object.assign(run, {
      status: "waiting_for_approval",
      execution_generation: executionGeneration,
      pending_controls: [control]
    });
    return control;
  }

  only(path) {
    return this.calls.filter(call => call.path === path || call.pathPrefix === path);
  }

  posts() {
    return this.calls.filter(call => call.method === "POST" && call.path === "/v1/runs");
  }

  async fetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin !== MOCK_HERMES_ORIGIN) {
      throw new Error("MockHermes refused non-mock URL: " + url.origin);
    }
    const method = (init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    const call = { method, path: url.pathname, search: url.search, headers, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect };
    this.calls.push(call);
    if (headers.get("Authorization") !== "Bearer " + MOCK_API_KEY) {
      return json({ error: { message: "Invalid gateway API key (API_SERVER_KEY)", type: "gateway_auth_error", code: "gateway_auth_failed" } }, 401);
    }

    if (method === "GET" && url.pathname === "/v1/capabilities") return json(this.capabilities || this.defaultCapabilities());
    if (method === "GET" && url.pathname === "/api/model/options") return json(this.modelOptions);

    if (method === "POST" && url.pathname === "/v1/runs") {
      if (this.onCreate) {
        const override = await this.onCreate(call);
        if (override) return override;
      }
      const key = headers.get("Idempotency-Key") || "";
      const fingerprint = JSON.stringify(call.body);
      if (key && this.idempotency.has(key)) {
        const prior = this.idempotency.get(key);
        if (prior.fingerprint !== fingerprint) return err(409, "idempotency_key_conflict", "Idempotency-Key was already used with a different request payload");
        return json({ run_id: prior.runId, status: this.run(prior.runId).status, replayed: true }, 202, { "Idempotency-Replayed": "true" });
      }
      const run = this.newRun(call.body);
      if (key) this.idempotency.set(key, { fingerprint, runId: run.run_id });
      return json({ run_id: run.run_id, status: "started", replayed: false }, 202);
    }

    const match = url.pathname.match(/^\/v1\/runs\/([^/]+)(?:\/(events|stop|approval|resolve-unknown))?$/);
    if (match) {
      const [, runId, action] = match;
      call.pathPrefix = "/v1/runs/" + (action || "");
      const run = this.run(runId);
      if (!action && method === "GET") {
        if (this.onGet) {
          const override = await this.onGet(call, run);
          if (override) return override;
        }
        if (!run) return err(404, "run_not_found", "Run not found: " + runId);
        const { _body, ...visible } = run;
        return json(visible);
      }
      if (action === "stop" && method === "POST") {
        if (this.onStop) {
          const override = await this.onStop(call, run);
          if (override) return override;
        }
        if (!run) return err(404, "run_not_found", "Run not found: " + runId);
        if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
          const { _body, ...visible } = run;
          return json(visible);
        }
        run.status = "stopping";
        return json({ run_id: runId, status: "stopping", admission_id: run.admission_id });
      }
      if (action === "approval" && method === "POST") {
        if (this.onApproval) {
          const override = await this.onApproval(call, run);
          if (override) return override;
        }
        if (!run) return err(404, "run_not_found", "Run not found: " + runId);
        const control = Array.isArray(run.pending_controls) ? run.pending_controls[0] : null;
        if (run.status !== "waiting_for_approval" || !control) {
          return err(409, "approval_not_pending", "Run has no pending approval");
        }
        if (call.body?.request_id !== control.prompt_id
          || call.body?.execution_generation !== control.execution_generation) {
          return err(409, "stale_generation", "Approval identity is stale");
        }
        if (!["once", "deny"].includes(call.body?.choice)) {
          return err(400, "invalid_approval_choice", "Choice is not allowed");
        }
        run.status = "running";
        run.pending_controls = [];
        return json({
          object: "hermes.run.approval_response", run_id: runId,
          request_id: control.prompt_id, choice: call.body.choice, resolved: 1
        });
      }
      if (action === "resolve-unknown" && method === "POST") {
        if (!run) return err(404, "run_not_found", "Run not found: " + runId);
        if (call.body?.admission_id !== run.admission_id || call.body?.execution_generation !== run.execution_generation) {
          return err(409, "stale_generation", "stale_generation");
        }
        run.status = "cancelled";
        return json({ run_id: runId, admission_id: run.admission_id, status: "terminal", outcome: "interrupted" });
      }
      if (action === "events" && method === "GET") {
        if (this.onEvents) return this.onEvents(call, run);
        return err(404, "run_not_found", "Run not found: " + runId);
      }
    }
    return err(404, "not_found", "Not found");
  }
}

export function sseBody(frames, { close = true } = {}) {
  // Pull-based so a simulated reset happens after the frames were delivered
  // (controller.error() would otherwise discard queued chunks).
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index++]));
      } else if (close) {
        controller.close();
      } else {
        controller.error(new Error("connection reset"));
      }
    }
  });
}

export function sseFrame(seq, data) {
  return "id: " + seq + "\ndata: " + JSON.stringify({ ...data, seq }) + "\n\n";
}
