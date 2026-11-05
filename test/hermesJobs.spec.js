import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { createSession } from "../src/lib/auth.js";
import { createHermesClient } from "../src/hermes/client.js";
import { MockHermes, hermesEnv } from "./helpers/mockHermes.js";

const ORIGIN = "http://example.com";
let mock;

beforeAll(async () => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM hermes_job_meta").run();
  mock = new MockHermes();
  vi.stubGlobal("fetch", mock.fetch);
});

afterEach(() => vi.unstubAllGlobals());

function testEnv(extra = {}) { return hermesEnv(env.DB, extra); }
async function cookie(user) { return "wa_session=" + await createSession(user, testEnv()); }

async function call(method, path, { body, user = "admin", envExtra = {} } = {}) {
  const response = await worker.fetch(new Request(ORIGIN + path, {
    method,
    headers: { Cookie: await cookie(user), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), testEnv(envExtra), { waitUntil() {} });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text), headers: response.headers };
}

async function ownJob({ id = "a1b2c3d4e5f6", owner = "admin", ...job } = {}) {
  const created = mock.newJob({ id, ...job });
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO hermes_job_meta
    (hermes_job_id, owner_username, instance_id, project_id, title_override, created_at, updated_at)
    VALUES (?, ?, 'oracle-hermes', NULL, NULL, ?, ?)`)
    .bind(id, owner, now, now).run();
  return created;
}

describe("Hermes jobs center", () => {
  it("uses only fixed documented job paths with manual redirects and validates ids", async () => {
    const job = mock.newJob({ id: "012345abcdef" });
    const client = createHermesClient(testEnv(), "oracle-hermes", { fetchImpl: mock.fetch });
    await client.listJobs({ includeDisabled: true });
    await client.getJob(job.id);
    await client.pauseJob(job.id);
    await client.resumeJob(job.id);
    await client.runJob(job.id, {});
    expect(mock.calls.map(item => [item.method, item.path])).toEqual([
      ["GET", "/api/jobs"], ["GET", `/api/jobs/${job.id}`], ["POST", `/api/jobs/${job.id}/pause`],
      ["POST", `/api/jobs/${job.id}/resume`], ["POST", `/api/jobs/${job.id}/run`]
    ]);
    expect(mock.calls[0]).toMatchObject({ search: "?include_disabled=true", redirect: "manual" });
    expect(() => client.deleteJob("../bad-id")).toThrow(/Invalid Hermes job id/);
  });

  it("filters the global jobs list to owned ids and redacts and bounds public results", async () => {
    const secret = "test-hermes-key-0123456789abcdef";
    await ownJob({
      id: "111111111111", name: "Owned", prompt: "password=hunter2 " + "p".repeat(6000),
      last_error: "Bearer abcdefghijklmnop " + secret + " " + "e".repeat(3000), next_run_at: 200
    });
    mock.newJob({ id: "222222222222", name: "Foreign", prompt: "do not leak", next_run_at: 100 });
    const result = await call("GET", "/api/hermes/jobs");
    expect(result.status).toBe(200);
    expect(result.json.jobs).toHaveLength(1);
    expect(result.json.jobs[0].id).toBe("111111111111");
    expect(result.json.jobs[0].prompt.length).toBeLessThanOrEqual(5000);
    expect(result.json.jobs[0].lastError.length).toBeLessThanOrEqual(2000);
    expect(result.text).not.toContain("hunter2");
    expect(result.text).not.toContain(secret);
    expect(result.text).not.toContain("Foreign");
  });

  it("creates upstream using documented fields and binds the authenticated owner", async () => {
    const result = await call("POST", "/api/hermes/jobs", { body: {
      name: "Morning brief", schedule: "0 9 * * *", prompt: "Summarize", deliver: "local", skills: ["news"], repeat: 2
    } });
    expect(result.status).toBe(201);
    expect(result.json.job.id).toMatch(/^[a-f0-9]{12}$/);
    const post = mock.calls.find(item => item.method === "POST" && item.path === "/api/jobs");
    expect(post.body).toEqual({ name: "Morning brief", schedule: "0 9 * * *", prompt: "Summarize", deliver: "local", skills: ["news"], repeat: 2 });
    const meta = await env.DB.prepare("SELECT owner_username, instance_id FROM hermes_job_meta WHERE hermes_job_id = ?")
      .bind(result.json.job.id).first();
    expect(meta).toEqual(expect.objectContaining({ owner_username: "admin", instance_id: "oracle-hermes" }));
  });

  it("returns 404 for a foreign id before any upstream mutation", async () => {
    const job = await ownJob({ owner: "admin" });
    const before = mock.calls.length;
    for (const [method, suffix, body] of [["PATCH", "", { name: "Stolen" }], ["DELETE", "", undefined], ["POST", "/run", {}]]) {
      const result = await call(method, `/api/hermes/jobs/${job.id}${suffix}`, { user: "other", body });
      expect(result.status).toBe(404);
    }
    expect(mock.calls.length).toBe(before);
  });

  it("blocks every write when execution is disabled without calling the jobs API", async () => {
    const job = await ownJob();
    const disabled = { HERMES_EXECUTION_ENABLED: "0" };
    const before = mock.calls.length;
    const create = await call("POST", "/api/hermes/jobs", { body: { schedule: "daily", prompt: "x" }, envExtra: disabled });
    const patch = await call("PATCH", `/api/hermes/jobs/${job.id}`, { body: { name: "x" }, envExtra: disabled });
    const pause = await call("POST", `/api/hermes/jobs/${job.id}/pause`, { body: {}, envExtra: disabled });
    expect([create.status, patch.status, pause.status]).toEqual([403, 403, 403]);
    expect(mock.calls.slice(before).filter(item => item.path.startsWith("/api/jobs"))).toEqual([]);
    const read = await call("GET", "/api/hermes/jobs", { envExtra: disabled });
    expect(read.status).toBe(200);
    expect(read.json.jobs).toHaveLength(1);
  });

  it("deletes upstream first and then removes owner metadata", async () => {
    const job = await ownJob();
    const result = await call("DELETE", `/api/hermes/jobs/${job.id}`);
    expect(result).toMatchObject({ status: 200, json: { ok: true } });
    expect(mock.jobs.has(job.id)).toBe(false);
    expect(await env.DB.prepare("SELECT * FROM hermes_job_meta WHERE hermes_job_id = ?").bind(job.id).first()).toBeNull();
  });

  it("pauses, resumes, and runs owned jobs with an optional bounded prompt override", async () => {
    const job = await ownJob();
    expect((await call("POST", `/api/hermes/jobs/${job.id}/pause`, { body: {} })).json.job.state).toBe("paused");
    expect((await call("POST", `/api/hermes/jobs/${job.id}/resume`, { body: {} })).json.job.state).toBe("scheduled");
    const ran = await call("POST", `/api/hermes/jobs/${job.id}/run`, { body: { prompt: "Run this version" } });
    expect(ran.json.job.lastStatus).toBe("ok");
    expect(mock.calls.find(item => item.path.endsWith("/run")).body).toEqual({ prompt: "Run this version" });
  });

  it("forwards only the documented PATCH whitelist", async () => {
    const job = await ownJob();
    const good = await call("PATCH", `/api/hermes/jobs/${job.id}`, { body: { name: "New", enabled: false, skills: ["one"] } });
    expect(good.status).toBe(200);
    expect(mock.calls.find(item => item.method === "PATCH").body).toEqual({ name: "New", enabled: false, skills: ["one"] });
    const before = mock.calls.length;
    const bad = await call("PATCH", `/api/hermes/jobs/${job.id}`, { body: { script: "rm -rf /" } });
    expect(bad.status).toBe(400);
    expect(mock.calls.length).toBe(before + 1); // capability probe only; no upstream PATCH
    expect(mock.calls.slice(before).some(item => item.method === "PATCH")).toBe(false);
  });

  it("rejects over-limit prompts before an upstream create or run", async () => {
    const job = await ownJob();
    const beforeCreate = mock.calls.length;
    const created = await call("POST", "/api/hermes/jobs", { body: { name: "Too long", schedule: "daily", prompt: "x".repeat(5001) } });
    expect(created.status).toBe(400);
    expect(mock.calls.slice(beforeCreate).some(item => item.path === "/api/jobs")).toBe(false);
    const beforeRun = mock.calls.length;
    const ran = await call("POST", `/api/hermes/jobs/${job.id}/run`, { body: { prompt: "x".repeat(5001) } });
    expect(ran.status).toBe(400);
    expect(mock.calls.slice(beforeRun).some(item => item.path.endsWith("/run"))).toBe(false);
  });

  it("degrades to a clear empty result when the jobs API is unavailable", async () => {
    await ownJob();
    mock.onJobs = call => call.method === "GET" && call.path === "/api/jobs"
      ? new Response(JSON.stringify({ error: { code: "storage_unavailable", message: "down" } }), { status: 503, headers: { "Content-Type": "application/json" } })
      : null;
    const result = await call("GET", "/api/hermes/jobs");
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ ok: true, jobs: [], available: false });
    expect(result.json.upstreamError.code).toBeTruthy();
  });

  it("surfaces an upstream cron-unavailable response as 501 for writes", async () => {
    mock.onJobs = call => call.method === "POST" && call.path === "/api/jobs"
      ? new Response(JSON.stringify({ error: "Cron module not available" }), { status: 501, headers: { "Content-Type": "application/json" } })
      : null;
    const result = await call("POST", "/api/hermes/jobs", { body: { name: "Unavailable", schedule: "daily", prompt: "" } });
    expect(result.status).toBe(501);
    expect(result.json.error.code).toBe("hermes_jobs_unavailable");
  });

  it("does not call jobs when capabilities explicitly omit the requested operation", async () => {
    await ownJob();
    mock.capabilities = mock.defaultCapabilities();
    mock.capabilities.features.job_list = false;
    delete mock.capabilities.endpoints.job_list;
    // Remove the other GET job endpoint so capability inference cannot claim list support.
    delete mock.capabilities.endpoints.job_get;
    const result = await call("GET", "/api/hermes/jobs");
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ jobs: [], available: false });
    expect(mock.calls.some(item => item.path === "/api/jobs")).toBe(false);
  });
});
