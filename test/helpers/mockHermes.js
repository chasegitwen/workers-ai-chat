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
    this.sessions = new Map();
    this.jobs = new Map();
    this.idempotency = new Map();
    this.seq = 0;
    this.durableIdempotency = durableIdempotency;
    this.unknownResolution = unknownResolution;
    // Hooks: return a Response (or throw) to override default handling.
    this.onCreate = null;
    this.onGet = null;
    this.onStop = null;
    this.onApproval = null;
    this.onClarify = null;
    this.onEvents = null;
    this.onSessions = null;
    this.onJobs = null;
    this.capabilities = null;
    this.onSkills = null;
    this.onToolsets = null;
    this.skills = [
      { name: "github-pr-workflow", description: "Review and prepare pull requests", category: "development", version: "1.2.0", tags: ["git", "review"], path: "/home/hermes/.hermes/skills/github", env: { GITHUB_TOKEN: "secret" } },
      { name: "incident-response", description: "Triage incidents", category: "operations" }
    ];
    this.toolsets = [
      { name: "coding", label: "Coding", description: "File and terminal tools", enabled: true, configured: true, tools: ["read_file", "terminal"], key_env: "TERMINAL_KEY" },
      { name: "browser", label: "Browser", description: "Browser automation", enabled: false, configured: false, tools: ["browser_open"], api_key: "secret" }
    ];
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
        run_clarify_response: true, clarify_events: true,
        run_unknown_resolution: this.unknownResolution,
        jobs_admin: false, admin_config_rw: false,
        session_list: true, session_create: true, session_get: true, session_patch: true,
        session_messages: true, session_fork: true,
        job_list: true, job_create: true, job_get: true, job_patch: true,
        job_delete: true, job_pause: true, job_resume: true, job_run: true,
        runs_idempotency: { supported: true, durable: this.durableIdempotency, retention_seconds: 86400 }
      },
      endpoints: {
        skills: { method: "GET", path: "/v1/skills" },
        toolsets: { method: "GET", path: "/v1/toolsets" },
        session_list: { method: "GET", path: "/api/sessions" },
        session_create: { method: "POST", path: "/api/sessions" },
        session_get: { method: "GET", path: "/api/sessions/{id}" },
        session_patch: { method: "PATCH", path: "/api/sessions/{id}" },
        session_messages: { method: "GET", path: "/api/sessions/{id}/messages" },
        session_fork: { method: "POST", path: "/api/sessions/{id}/fork" },
        job_list: { method: "GET", path: "/api/jobs" },
        job_create: { method: "POST", path: "/api/jobs" },
        job_get: { method: "GET", path: "/api/jobs/{id}" },
        job_patch: { method: "PATCH", path: "/api/jobs/{id}" },
        job_delete: { method: "DELETE", path: "/api/jobs/{id}" },
        job_pause: { method: "POST", path: "/api/jobs/{id}/pause" },
        job_resume: { method: "POST", path: "/api/jobs/{id}/resume" },
        job_run: { method: "POST", path: "/api/jobs/{id}/run" }
      }
    };
  }

  newSession({ id, title = "Untitled session", messages = [], created_at, updated_at, source = "api" } = {}) {
    const sessionId = id || "session_" + crypto.randomUUID().replace(/-/g, "");
    const now = Date.now() / 1000;
    const session = {
      id: sessionId, title, source, created_at: created_at || now, updated_at: updated_at || now,
      messages: messages.map(message => ({ ...message }))
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  newRun(body) {
    const runId = "run_" + crypto.randomUUID().replace(/-/g, "");
    const run = {
      object: "hermes.run", run_id: runId, status: "queued", session_id: body.session_id || runId,
      model: body.model || "hermes-agent", created_at: Date.now() / 1000, admission_id: "adm_" + runId.slice(4, 12),
      execution_generation: 1, output: "", usage: {}, pending_controls: [], _body: body
    };
    this.runs.set(runId, run);
    const session = this.sessions.get(run.session_id) || this.newSession({ id: run.session_id, title: String(body.input || "Hermes session").slice(0, 160) });
    session.updated_at = Date.now() / 1000;
    if (body.input) session.messages.push({ role: "user", content: body.input, created_at: session.updated_at });
    return run;
  }

  newJob({ id, name = "Scheduled job", schedule = "0 9 * * *", prompt = "Run the job",
    deliver = "local", skills = [], repeat = null, enabled = true, paused = false, state, next_run_at,
    last_run_at = null, last_status = null, last_error = null } = {}) {
    const jobId = id || crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const job = {
      id: jobId, name, schedule, prompt, deliver, skills: [...skills], enabled: paused ? false : enabled,
      state: state || ((enabled && !paused) ? "scheduled" : "paused"),
      next_run_at: next_run_at ?? Date.now() / 1000 + 3600,
      last_run_at, last_status, last_error, repeat
    };
    this.jobs.set(jobId, job);
    return job;
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

  requestClarify(runId, clarify = {}) {
    const run = this.run(runId);
    const executionGeneration = Number.isInteger(clarify.execution_generation)
      ? clarify.execution_generation
      : run.execution_generation;
    const control = {
      kind: "clarify",
      prompt_id: clarify.prompt_id || "clarify_" + crypto.randomUUID().replace(/-/g, ""),
      execution_generation: executionGeneration,
      question: clarify.question || "Which operating condition should Hermes use?"
    };
    Object.assign(run, {
      status: "waiting_for_clarification",
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
    if (method === "GET" && url.pathname === "/v1/skills") {
      if (this.onSkills) {
        const override = await this.onSkills(call);
        if (override) return override;
      }
      return json({ object: "list", data: this.skills });
    }
    if (method === "GET" && url.pathname === "/v1/toolsets") {
      if (this.onToolsets) {
        const override = await this.onToolsets(call);
        if (override) return override;
      }
      return json({ object: "list", platform: "api_server", data: this.toolsets });
    }

    if (url.pathname === "/api/jobs") {
      if (this.onJobs) {
        const override = await this.onJobs(call);
        if (override) return override;
      }
      if (method === "GET") {
        const includeDisabled = url.searchParams.get("include_disabled") === "true";
        return json({ jobs: [...this.jobs.values()].filter(job => includeDisabled || job.enabled !== false) });
      }
      if (method === "POST") {
        if (typeof call.body?.name !== "string" || !call.body.name.trim()
          || typeof call.body?.schedule !== "string" || typeof call.body?.prompt !== "string") {
          return err(400, "invalid_params", "name and schedule are required");
        }
        const job = this.newJob(call.body);
        return json({ job }, 201);
      }
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]{12})(?:\/(pause|resume|run))?$/);
    if (jobMatch) {
      if (this.onJobs) {
        const override = await this.onJobs(call);
        if (override) return override;
      }
      const [, id, action] = jobMatch;
      const job = this.jobs.get(id);
      if (!job) return err(404, "job_not_found", "Job not found");
      if (!action && method === "GET") return json({ job });
      if (!action && method === "PATCH") {
        Object.assign(job, call.body);
        if (call.body?.enabled !== undefined) job.state = call.body.enabled ? "scheduled" : "paused";
        return json({ job });
      }
      if (!action && method === "DELETE") {
        this.jobs.delete(id);
        return json({ ok: true });
      }
      if (action === "pause" && method === "POST") {
        Object.assign(job, { enabled: false, state: "paused" });
        return json({ job });
      }
      if (action === "resume" && method === "POST") {
        Object.assign(job, { enabled: true, state: "scheduled" });
        return json({ job });
      }
      if (action === "run" && method === "POST") {
        Object.assign(job, { last_run_at: Date.now() / 1000, last_status: "ok", last_error: null });
        if (call.body?.prompt) job.last_prompt_override = call.body.prompt;
        return json({ job });
      }
    }

    if (url.pathname === "/api/sessions") {
      if (this.onSessions) {
        const override = await this.onSessions(call);
        if (override) return override;
      }
      if (method === "GET") {
        const limit = Math.max(1, Number(url.searchParams.get("limit") || 100));
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
        const sessions = [...this.sessions.values()].sort((a, b) => b.updated_at - a.updated_at)
          .slice(offset, offset + limit).map(({ messages, ...session }) => session);
        return json({ sessions, total: this.sessions.size, limit, offset });
      }
      if (method === "POST") {
        if (!call.body?.title) return err(400, "invalid_params", "title is required");
        const { messages, ...session } = this.newSession({ title: call.body.title });
        return json(session, 201);
      }
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(messages|fork))?$/);
    if (sessionMatch) {
      const [, sessionId, action] = sessionMatch;
      const session = this.sessions.get(decodeURIComponent(sessionId));
      if (!session) return err(404, "session_not_found", "Session not found");
      if (!action && method === "GET") {
        const { messages, ...visible } = session;
        return json(visible);
      }
      if (!action && method === "PATCH") {
        if (typeof call.body?.title !== "string" || !call.body.title.trim()) return err(400, "invalid_params", "title is required");
        session.title = call.body.title.trim();
        session.updated_at = Date.now() / 1000;
        const { messages, ...visible } = session;
        return json(visible);
      }
      if (action === "messages" && method === "GET") return json({ messages: session.messages });
      if (action === "fork" && method === "POST") {
        const fork = this.newSession({
          title: call.body?.title || session.title + " (fork)", messages: session.messages,
          created_at: Date.now() / 1000, updated_at: Date.now() / 1000
        });
        const { messages, ...visible } = fork;
        return json(visible, 201);
      }
    }

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

    const match = url.pathname.match(/^\/v1\/runs\/([^/]+)(?:\/(events|stop|approval|clarify|resolve-unknown))?$/);
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
      if (action === "clarify" && method === "POST") {
        if (this.onClarify) {
          const override = await this.onClarify(call, run);
          if (override) return override;
        }
        if (!run) return err(404, "run_not_found", "Run not found: " + runId);
        const control = Array.isArray(run.pending_controls)
          ? run.pending_controls.find(item => item.kind === "clarify")
          : null;
        if (run.status !== "waiting_for_clarification" || !control) {
          return err(409, "clarify_not_pending", "Run has no pending clarification");
        }
        if (call.body?.request_id !== control.prompt_id
          || call.body?.execution_generation !== control.execution_generation) {
          return err(409, "stale_generation", "Clarification identity is stale");
        }
        if (typeof call.body?.answer !== "string" || !call.body.answer.trim()) {
          return err(400, "invalid_params", "Answer is required");
        }
        run.status = "running";
        run.pending_controls = [];
        return json({
          object: "hermes.run.clarify_response", run_id: runId,
          request_id: control.prompt_id, answer: call.body.answer, resolved: 1
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
