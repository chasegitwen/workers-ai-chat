// Authenticated, owner-scoped facade for Hermes' instance-global /api/jobs API.

import { createHermesClient, isHermesJobId } from "./client.js";
import { ORACLE_HERMES_INSTANCE_ID, hermesExecutionEnabled, hermesInstance } from "./config.js";
import { HermesError, publicError, redactSecrets } from "./errors.js";

const CREATE_FIELDS = new Set(["name", "schedule", "prompt", "deliver", "skills", "repeat", "paused", "paused_reason"]);
const PATCH_FIELDS = new Set(["name", "schedule", "prompt", "deliver", "skills", "skill", "repeat", "enabled"]);
const PROMPT_LIMIT = 5000;
const ERROR_LIMIT = 500;

function decode(value) {
  try { return decodeURIComponent(String(value || "")); }
  catch (err) { throw new HermesError("hermes_invalid_path", "Invalid path parameter", { httpStatus: 400 }); }
}

function jobId(value) {
  const id = String(value || "");
  if (!isHermesJobId(id)) throw new HermesError("hermes_invalid_job_id", "Invalid Hermes job id", { httpStatus: 400 });
  return id;
}

function cleanText(value, max, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new HermesError("hermes_invalid_job", "Job text fields must be strings", { httpStatus: 400 });
  const result = value.trim();
  if (required && !result) throw new HermesError("hermes_invalid_job", "A required job field is empty", { httpStatus: 400 });
  if (result.length > max) throw new HermesError("hermes_invalid_job", "Job text field exceeds " + max + " characters", { httpStatus: 400 });
  return result;
}

function cleanSkills(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new HermesError("hermes_invalid_job", "skills must be an array of strings", { httpStatus: 400 });
  }
  return value.map(item => item.trim().slice(0, 160)).filter(Boolean).slice(0, 100);
}

function cleanRepeat(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const repeat = Number(value);
  if (!Number.isInteger(repeat) || repeat <= 0) throw new HermesError("hermes_invalid_job", "repeat must be a positive integer", { httpStatus: 400 });
  return repeat;
}

function unknownFields(body, allowed) {
  return Object.keys(body).filter(key => !allowed.has(key) && key !== "project_id" && key !== "instance_id");
}

function createBody(body) {
  const unknown = unknownFields(body, CREATE_FIELDS);
  if (unknown.length) throw new HermesError("hermes_invalid_job_fields", "Unsupported job fields: " + unknown.join(", "), { httpStatus: 400 });
  const out = {
    name: cleanText(body.name, 200, { required: true }),
    schedule: cleanText(body.schedule, 500, { required: true }),
    prompt: cleanText(body.prompt === undefined ? "" : body.prompt, PROMPT_LIMIT),
    deliver: cleanText(body.deliver === undefined ? "local" : body.deliver, 160, { required: true })
  };
  const skills = cleanSkills(body.skills);
  const repeat = cleanRepeat(body.repeat);
  if (skills !== undefined) out.skills = skills;
  if (repeat !== undefined) out.repeat = repeat;
  if (body.paused !== undefined) {
    if (typeof body.paused !== "boolean") throw new HermesError("hermes_invalid_job", "paused must be boolean", { httpStatus: 400 });
    out.paused = body.paused;
  }
  const pausedReason = cleanText(body.paused_reason, 500);
  if (pausedReason !== undefined) out.paused_reason = pausedReason;
  return out;
}

function patchBody(body) {
  const unknown = unknownFields(body, PATCH_FIELDS);
  if (unknown.length) throw new HermesError("hermes_invalid_job_fields", "Unsupported job fields: " + unknown.join(", "), { httpStatus: 400 });
  const out = {};
  for (const field of ["name", "schedule", "prompt", "deliver", "skill"]) {
    if (body[field] !== undefined) out[field] = cleanText(body[field], field === "prompt" ? PROMPT_LIMIT : (field === "name" ? 200 : 500), { required: true });
  }
  if (body.skills !== undefined) out.skills = cleanSkills(body.skills);
  if (body.repeat !== undefined) out.repeat = cleanRepeat(body.repeat);
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new HermesError("hermes_invalid_job", "enabled must be boolean", { httpStatus: 400 });
    out.enabled = body.enabled;
  }
  if (!Object.keys(out).length) throw new HermesError("hermes_invalid_job", "At least one writable job field is required", { httpStatus: 400 });
  return out;
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body;
  } catch (err) {
    throw new HermesError("hermes_invalid_json", "Request body must be a JSON object", { httpStatus: 400 });
  }
}

async function readOptionalBody(request) {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) return {};
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body;
  } catch (err) {
    throw new HermesError("hermes_invalid_json", "Request body must be a JSON object", { httpStatus: 400 });
  }
}

function instance(value) {
  const id = String(value || ORACLE_HERMES_INSTANCE_ID).trim().slice(0, 80);
  if (!hermesInstance(id)) throw new HermesError("hermes_unknown_instance", "Unknown Hermes instance", { httpStatus: 400 });
  return id;
}

function sourceJobs(body) {
  if (Array.isArray(body?.jobs)) return body.jobs;
  if (Array.isArray(body)) return body;
  return [];
}

function sourceJob(body) {
  return body?.job && typeof body.job === "object" ? body.job : body;
}

function safeTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedRedacted(value, max, secrets) {
  const raw = String(value ?? "");
  return redactSecrets(raw.slice(0, max + 512), secrets).slice(0, max);
}

function publicJob(job, meta, secrets) {
  return {
    id: String(job?.id || meta.hermes_job_id),
    name: boundedRedacted(meta.title_override || job?.name || "Untitled job", 200, secrets),
    schedule: boundedRedacted(job?.schedule, 500, secrets),
    prompt: boundedRedacted(job?.prompt, PROMPT_LIMIT, secrets),
    deliver: boundedRedacted(job?.deliver || "local", 160, secrets),
    skills: Array.isArray(job?.skills) ? job.skills.slice(0, 100).map(value => boundedRedacted(value, 160, secrets)) : [],
    enabled: job?.enabled !== false,
    state: boundedRedacted(job?.state || (job?.enabled === false ? "paused" : "scheduled"), 40, secrets),
    nextRunAt: safeTime(job?.next_run_at),
    lastRunAt: safeTime(job?.last_run_at),
    lastStatus: boundedRedacted(job?.last_status, 40, secrets) || null,
    lastError: boundedRedacted(job?.last_error, ERROR_LIMIT, secrets) || null,
    repeat: Number.isInteger(job?.repeat) && job.repeat > 0 ? job.repeat : null,
    projectId: meta.project_id || null,
    instanceId: meta.instance_id
  };
}

async function requireOwnedJob(db, owner, id) {
  const row = await db.prepare(`SELECT hermes_job_id, owner_username, instance_id, project_id,
    title_override, created_at, updated_at FROM hermes_job_meta WHERE hermes_job_id = ? AND owner_username = ?`)
    .bind(id, owner).first();
  if (!row) throw new HermesError("hermes_job_not_found", "Job not found", { httpStatus: 404 });
  return row;
}

async function jobCapabilities(client) {
  try {
    const body = (await client.getCapabilities()).body || {};
    const features = body.features && typeof body.features === "object" ? body.features : {};
    const endpoints = body.endpoints && typeof body.endpoints === "object" ? body.endpoints : {};
    // v0.22.5 advertises static jobs_admin:false without listing /api/jobs endpoints.
    // Treat that noise as non-advertisement and probe the documented jobs routes by default.
    const ignoreFeature = new Set(["jobs_admin", "admin_config_rw"]);
    const relevant = [...Object.keys(features), ...Object.keys(endpoints)].filter(key =>
      /^(?:job|jobs|cron)(?:_|$)/.test(key) && !ignoreFeature.has(key));
    const endpointEntries = Object.entries(endpoints);
    const advertised = relevant.length > 0 || endpointEntries.some(([, value]) => String(value?.path || "").startsWith("/api/jobs"));
    const paths = {
      list: ["GET", "/api/jobs"], create: ["POST", "/api/jobs"], get: ["GET", "/api/jobs/{id}"],
      patch: ["PATCH", "/api/jobs/{id}"], delete: ["DELETE", "/api/jobs/{id}"],
      pause: ["POST", "/api/jobs/{id}/pause"], resume: ["POST", "/api/jobs/{id}/resume"], run: ["POST", "/api/jobs/{id}/run"]
    };
    const has = operation => {
      if (!advertised) return true;
      if (features.jobs === false || features.job_api === false || features.cron === false) return false;
      const names = [`job_${operation}`, `jobs_${operation}`];
      if (names.some(name => features[name] === true || Boolean(endpoints[name]))) return true;
      if (names.some(name => features[name] === false)) return false;
      const [method, path] = paths[operation];
      return endpointEntries.some(([, value]) => String(value?.path || "") === path
        && String(value?.method || "").toUpperCase() === method);
    };
    return {
      advertised,
      list: has("list"), create: has("create"), get: has("get"), patch: has("patch"), delete: has("delete"),
      pause: has("pause"), resume: has("resume"), run: has("run")
    };
  } catch (err) {
    return { advertised: false, list: true, create: true, get: true, patch: true, delete: true, pause: true, resume: true, run: true };
  }
}

function requireCapability(capabilities, operation) {
  if (!capabilities[operation]) throw new HermesError("hermes_jobs_unavailable", "Hermes does not advertise this jobs operation", { httpStatus: 501 });
}

function unavailableError(err) {
  return publicError(err instanceof HermesError ? err : new HermesError("hermes_jobs_unavailable", "Hermes jobs API is unavailable", { httpStatus: 502 }));
}

async function jobsCall(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof HermesError && err.upstreamStatus === 501) {
      throw new HermesError("hermes_jobs_unavailable", "Hermes jobs API is unavailable", { httpStatus: 501, upstreamStatus: 501 });
    }
    throw err;
  }
}

async function persistOwner(db, { id, owner, instanceId, projectId = null, title = null }) {
  const now = Date.now();
  await db.prepare(`INSERT INTO hermes_job_meta
    (hermes_job_id, owner_username, instance_id, project_id, title_override, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hermes_job_id) DO UPDATE SET project_id = excluded.project_id,
      title_override = COALESCE(excluded.title_override, hermes_job_meta.title_override), updated_at = excluded.updated_at
    WHERE hermes_job_meta.owner_username = excluded.owner_username`)
    .bind(id, owner, instanceId, projectId, title, now, now).run();
  return requireOwnedJob(db, owner, id);
}

export async function handleHermesJobs(request, env, url, { owner, fetchImpl } = {}) {
  const match = url.pathname.match(/^\/api\/hermes\/jobs(?:\/([^/]+)(?:\/(pause|resume|run))?)?$/);
  if (!match) return null;
  const id = match[1] ? jobId(decode(match[1])) : "";
  const action = match[2] || "";

  if (!id && request.method === "GET") {
    const metaResult = await env.DB.prepare(`SELECT hermes_job_id, owner_username, instance_id, project_id,
      title_override, created_at, updated_at FROM hermes_job_meta WHERE owner_username = ? ORDER BY updated_at DESC`)
      .bind(owner).all();
    const metas = Array.isArray(metaResult?.results) ? metaResult.results : [];
    const grouped = new Map();
    for (const meta of metas) grouped.set(meta.instance_id, [...(grouped.get(meta.instance_id) || []), meta]);
    // Probe and discard the global list even for a new owner so API availability is reported
    // honestly; no unowned definition is ever copied into the browser response.
    if (!grouped.size) grouped.set(ORACLE_HERMES_INSTANCE_ID, []);
    const jobs = [];
    let firstError = null;
    let available = true;
    let exposedCapabilities = null;
    for (const [instanceId, owned] of grouped) {
      const client = createHermesClient(env, instanceId, { fetchImpl });
      const capabilities = await jobCapabilities(client);
      exposedCapabilities ||= capabilities;
      if (!capabilities.list) {
        available = false;
        firstError ||= { code: "hermes_jobs_unavailable", message: "Hermes does not advertise the jobs API" };
        continue;
      }
      try {
        const upstream = sourceJobs((await jobsCall(client.listJobs({ includeDisabled: true }))).body);
        const byId = new Map(upstream.filter(job => isHermesJobId(job?.id)).map(job => [job.id, job]));
        for (const meta of owned) {
          const job = byId.get(meta.hermes_job_id);
          if (job) jobs.push(publicJob(job, meta, client.secrets));
        }
      } catch (err) {
        available = false;
        firstError ||= unavailableError(err);
      }
    }
    jobs.sort((a, b) => (a.nextRunAt || Number.MAX_SAFE_INTEGER) - (b.nextRunAt || Number.MAX_SAFE_INTEGER)
      || (b.lastRunAt || 0) - (a.lastRunAt || 0));
    return Response.json({
      ok: true, jobs, available, executionEnabled: hermesExecutionEnabled(env), capabilities: exposedCapabilities, upstreamError: firstError
    });
  }

  if (!id && request.method === "POST") {
    if (!hermesExecutionEnabled(env)) throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
    const body = await readBody(request);
    const instanceId = instance(body.instance_id);
    const client = createHermesClient(env, instanceId, { fetchImpl });
    const capabilities = await jobCapabilities(client);
    requireCapability(capabilities, "create");
    const result = await jobsCall(client.createJob(createBody(body)));
    const job = sourceJob(result.body);
    const createdId = jobId(job?.id);
    let meta;
    try {
      meta = await persistOwner(env.DB, {
        id: createdId, owner, instanceId, projectId: body.project_id ? String(body.project_id).slice(0, 160) : null,
        title: typeof body.name === "string" ? body.name.trim().slice(0, 200) : null
      });
    } catch (err) {
      try { await client.deleteJob(createdId); } catch (cleanupErr) { /* best-effort orphan cleanup */ }
      throw err;
    }
    return Response.json({ ok: true, job: publicJob(job, meta, client.secrets), capabilities }, { status: 201 });
  }

  if (!id) throw new HermesError("hermes_method_not_allowed", "Method not allowed", { httpStatus: 405 });
  // Ownership is always established before capability probing or any upstream write.
  const meta = await requireOwnedJob(env.DB, owner, id);
  const client = createHermesClient(env, meta.instance_id, { fetchImpl });
  const capabilities = await jobCapabilities(client);

  if (!action && request.method === "GET") {
    requireCapability(capabilities, "get");
    return Response.json({ ok: true, job: publicJob(sourceJob((await jobsCall(client.getJob(id))).body), meta, client.secrets), capabilities });
  }
  if (!hermesExecutionEnabled(env)) throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });

  if (!action && request.method === "PATCH") {
    requireCapability(capabilities, "patch");
    const body = await readBody(request);
    const patch = patchBody(body);
    const job = sourceJob((await jobsCall(client.patchJob(id, patch))).body);
    const title = typeof patch.name === "string" ? patch.name : meta.title_override;
    const nextMeta = await persistOwner(env.DB, { id, owner, instanceId: meta.instance_id, projectId: meta.project_id, title });
    return Response.json({ ok: true, job: publicJob(job, nextMeta, client.secrets), capabilities });
  }
  if (!action && request.method === "DELETE") {
    requireCapability(capabilities, "delete");
    await jobsCall(client.deleteJob(id));
    await env.DB.prepare("DELETE FROM hermes_job_meta WHERE hermes_job_id = ? AND owner_username = ?").bind(id, owner).run();
    return Response.json({ ok: true });
  }
  if (action && request.method === "POST") {
    requireCapability(capabilities, action);
    let result;
    if (action === "pause") result = await jobsCall(client.pauseJob(id));
    else if (action === "resume") result = await jobsCall(client.resumeJob(id));
    else {
      const body = await readOptionalBody(request);
      const override = body.prompt === undefined ? undefined : cleanText(body.prompt, PROMPT_LIMIT, { required: true });
      const unknown = Object.keys(body).filter(key => key !== "prompt");
      if (unknown.length) throw new HermesError("hermes_invalid_job_fields", "Unsupported run fields: " + unknown.join(", "), { httpStatus: 400 });
      result = await jobsCall(client.runJob(id, override === undefined ? undefined : { prompt: override }));
    }
    const job = sourceJob(result.body);
    return Response.json({ ok: true, job: publicJob(job?.id ? job : { ...job, id }, meta, client.secrets), capabilities });
  }
  throw new HermesError("hermes_method_not_allowed", "Method not allowed", { httpStatus: 405 });
}
