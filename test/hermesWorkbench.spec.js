import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { createSession } from "../src/lib/auth.js";
import { createHermesClient } from "../src/hermes/client.js";
import { MockHermes, hermesEnv } from "./helpers/mockHermes.js";

const ORIGIN = "http://example.com";
let mock;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["hermes_session_meta", "hermes_workbench_projects", "hermes_runs", "hermes_conversation_bindings", "messages", "conversations"]) {
    await env.DB.prepare("DELETE FROM " + table).run();
  }
  mock = new MockHermes();
  vi.stubGlobal("fetch", mock.fetch);
});

afterEach(() => vi.unstubAllGlobals());

function testEnv(extra = {}) {
  return hermesEnv(env.DB, extra);
}

async function cookie(user) {
  return "wa_session=" + await createSession(user, testEnv());
}

async function call(method, path, { body, user = "admin", envExtra = {} } = {}) {
  const response = await worker.fetch(new Request(ORIGIN + path, {
    method,
    headers: { Cookie: await cookie(user), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), testEnv(envExtra), { waitUntil() {} });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (err) { json = null; }
  return { status: response.status, text, json, headers: response.headers };
}

async function ownSession({ id = "session_owned", owner = "admin", title = "Owned", messages = [], updatedAt } = {}) {
  const now = updatedAt || Date.now();
  mock.newSession({ id, title, messages, created_at: now / 1000, updated_at: now / 1000 });
  const conversationId = "conv_" + crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, 'default')"
  ).bind(conversationId, title, now, now).run();
  await env.DB.prepare(
    `INSERT INTO hermes_conversation_bindings
     (conversation_id, owner_username, project_id, instance_id, hermes_session_id, created_at, updated_at)
     VALUES (?, ?, 'default', 'oracle-hermes', ?, ?, ?)`
  ).bind(conversationId, owner, id, now, now).run();
  return { id, conversationId };
}

describe("Hermes sessions and projects workbench", () => {
  it("uses fixed session path templates, documented query flags, and manual redirects", async () => {
    const session = mock.newSession({ id: "session_paths", messages: [] });
    const client = createHermesClient(testEnv(), "oracle-hermes", { fetchImpl: mock.fetch });
    await client.listSessions({ limit: 25, offset: 5, source: "api", includeChildren: false });
    await client.getSessionMessages(session.id);
    expect(mock.calls[0]).toMatchObject({ method: "GET", path: "/api/sessions", redirect: "manual" });
    expect(mock.calls[0].search).toBe("?limit=25&offset=5&include_children=false&source=api");
    expect(mock.calls[1]).toMatchObject({
      method: "GET", path: "/api/sessions/session_paths/messages", search: "?include_compacted=true&inline_images=false", redirect: "manual"
    });
    expect(() => client.getSession("../v1/runs/run_x")).toThrow(/Invalid Hermes session id/);
  });

  it("gates the list when Hermes explicitly advertises sessions but not session_list", async () => {
    mock.capabilities = mock.defaultCapabilities();
    mock.capabilities.features.session_list = false;
    delete mock.capabilities.endpoints.session_list;
    const result = await call("GET", "/api/hermes/sessions");
    expect(result.status).toBe(503);
    expect(result.json.error.code).toBe("hermes_session_capability_missing");
    expect(mock.calls.some(item => item.path === "/api/sessions")).toBe(false);
  });

  it("filters the global upstream list by authenticated ownership and sorts newest first", async () => {
    await ownSession({ id: "session_old", title: "Old", updatedAt: 1000 });
    await ownSession({ id: "session_new", title: "New", updatedAt: 3000 });
    mock.newSession({ id: "session_foreign", title: "Foreign", updated_at: 9 });

    const result = await call("GET", "/api/hermes/sessions");
    expect(result.status).toBe(200);
    expect(result.json.sessions.map(item => item.id)).toEqual(["session_new", "session_old"]);
    expect(result.text).not.toContain("session_foreign");
    expect(result.json.searchScope).toBe("title_and_metadata_only");
  });

  it("returns a clear empty result when the upstream sessions API is unavailable", async () => {
    await ownSession();
    mock.onSessions = () => new Response(JSON.stringify({ error: { code: "storage_unavailable", message: "down" } }), {
      status: 503, headers: { "Content-Type": "application/json" }
    });
    const result = await call("GET", "/api/hermes/sessions");
    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(result.json.sessions).toEqual([]);
    expect(result.json.upstreamError.code).toBeTruthy();
  });

  it("archives with a concurrency-safe D1 toggle and never patches end_reason upstream", async () => {
    const session = await ownSession();
    const first = await call("POST", `/api/hermes/sessions/${session.id}/archive`, { body: { archived: true } });
    const retry = await call("POST", `/api/hermes/sessions/${session.id}/archive`, { body: { archived: true } });
    expect(first.json).toMatchObject({ ok: true, archived: true, changed: true });
    expect(retry.json).toMatchObject({ ok: true, archived: true, changed: false });
    const meta = await env.DB.prepare("SELECT archived, archived_at FROM hermes_session_meta WHERE hermes_session_id = ?").bind(session.id).first();
    expect(meta.archived).toBe(1);
    expect(meta.archived_at).toBeTypeOf("number");
    expect(mock.calls.filter(item => item.method === "PATCH")).toHaveLength(0);
    expect(mock.calls.some(item => JSON.stringify(item.body || {}).includes("end_reason"))).toBe(false);

    const stale = await call("POST", `/api/hermes/sessions/${session.id}/archive`, {
      body: { archived: false, expected_archived: false }
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("hermes_archive_stale");
  });

  it("renames upstream with title only and records the local display override", async () => {
    const session = await ownSession();
    const result = await call("PATCH", `/api/hermes/sessions/${session.id}`, { body: { title: "Renamed" } });
    expect(result.status).toBe(200);
    const patch = mock.calls.find(item => item.method === "PATCH" && item.path === `/api/sessions/${session.id}`);
    expect(patch.body).toEqual({ title: "Renamed" });
    expect(await env.DB.prepare("SELECT title_override FROM hermes_session_meta WHERE hermes_session_id = ?").bind(session.id).first())
      .toMatchObject({ title_override: "Renamed" });
  });

  it("forks upstream and persists provenance without copying message history into D1", async () => {
    const session = await ownSession({ messages: [{ role: "user", content: "hello" }] });
    const result = await call("POST", `/api/hermes/sessions/${session.id}/fork`, { body: { title: "Branch" } });
    expect(result.status).toBe(201);
    expect(result.json.session.forkedFromSessionId).toBe(session.id);
    const meta = await env.DB.prepare("SELECT forked_from_session_id FROM hermes_session_meta WHERE hermes_session_id = ?")
      .bind(result.json.session.id).first();
    expect(meta.forked_from_session_id).toBe(session.id);
    const copied = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages").first();
    expect(copied.n).toBe(0);
  });

  it("sanitizes secrets in JSON and Markdown exports", async () => {
    const session = await ownSession({ title: "Export", messages: [
      { role: "user", content: "password=hunter2" },
      { role: "tool", name: "terminal", content: "Bearer abcdefghijklmnop" }
    ] });
    const json = await call("GET", `/api/hermes/sessions/${session.id}/export?format=json`);
    const markdown = await call("GET", `/api/hermes/sessions/${session.id}/export?format=md`);
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Disposition")).toContain(".json");
    expect(markdown.headers.get("Content-Disposition")).toContain(".md");
    for (const result of [json, markdown]) {
      expect(result.text).not.toContain("hunter2");
      expect(result.text).not.toContain("abcdefghijklmnop");
      expect(result.text).toContain("[redacted]");
    }
  });

  it("denies every cross-user session write before calling upstream", async () => {
    const session = await ownSession({ owner: "admin" });
    const before = mock.calls.length;
    const result = await call("PATCH", `/api/hermes/sessions/${session.id}`, { body: { title: "Stolen" }, user: "other" });
    expect(result.status).toBe(404);
    expect(mock.calls.length).toBe(before);
    expect(mock.calls.some(item => item.method === "PATCH")).toBe(false);
  });

  it("creates owner-scoped projects and rejects another user's rename", async () => {
    const created = await call("POST", "/api/hermes/projects", { body: { title: "Case A" } });
    expect(created.status).toBe(201);
    const denied = await call("PATCH", `/api/hermes/projects/${created.json.project.id}`, { body: { title: "Nope" }, user: "other" });
    expect(denied.status).toBe(404);
    const list = await call("GET", "/api/hermes/projects", { user: "other" });
    expect(list.json.projects).toEqual([]);
  });

  it("bounds tool message content and omits system content in history", async () => {
    const toolPayload = "TOOL_SECRET_" + "x".repeat(1200);
    const session = await ownSession({
      id: "session_bound_msgs",
      messages: [
        { role: "system", content: "SYSTEM_SHOULD_OMIT " + "y".repeat(200) },
        { role: "user", content: "please run" },
        { role: "tool", name: "terminal", content: toolPayload },
        { role: "assistant", content: "done" }
      ]
    });
    const result = await call("GET", `/api/hermes/sessions/${session.id}/messages`);
    expect(result.status).toBe(200);
    const byRole = Object.fromEntries(result.json.messages.map(item => [item.role, item]));
    expect(byRole.system.content).toBe("");
    expect(byRole.system.contentOmitted).toBe(true);
    expect(byRole.tool.content.length).toBeLessThanOrEqual(500);
    expect(byRole.tool.truncated).toBe(true);
    expect(result.text).not.toContain("SYSTEM_SHOULD_OMIT");
    expect(byRole.tool.content).not.toContain(toolPayload);
    expect(byRole.user.content).toBe("please run");
  });

  it("blocks create, fork, and title rename when Hermes execution is disabled", async () => {
    const session = await ownSession({ id: "session_exec_off" });
    const before = mock.calls.length;
    const disabled = { HERMES_EXECUTION_ENABLED: "0" };
    const created = await call("POST", "/api/hermes/sessions", { body: { title: "Nope" }, envExtra: disabled });
    expect(created.status).toBe(403);
    expect(created.json.error.code).toBe("hermes_execution_disabled");
    const forked = await call("POST", `/api/hermes/sessions/${session.id}/fork`, {
      body: { title: "Nope fork" }, envExtra: disabled
    });
    expect(forked.status).toBe(403);
    expect(forked.json.error.code).toBe("hermes_execution_disabled");
    const renamed = await call("PATCH", `/api/hermes/sessions/${session.id}`, {
      body: { title: "Nope rename" }, envExtra: disabled
    });
    expect(renamed.status).toBe(403);
    expect(renamed.json.error.code).toBe("hermes_execution_disabled");
    const mutating = mock.calls.slice(before).filter(item => ["POST", "PATCH", "DELETE"].includes(item.method));
    expect(mutating).toEqual([]);
  });

  it("still allows local project assignment when Hermes execution is disabled", async () => {
    const session = await ownSession({ id: "session_local_assign" });
    const project = await call("POST", "/api/hermes/projects", { body: { title: "Local only" } });
    const assigned = await call("PATCH", `/api/hermes/sessions/${session.id}`, {
      body: { project_id: project.json.project.id },
      envExtra: { HERMES_EXECUTION_ENABLED: "0" }
    });
    expect(assigned.status).toBe(200);
    expect(assigned.json.session.projectId).toBe(project.json.project.id);
    expect(mock.calls.some(item => item.method === "PATCH")).toBe(false);
  });

  it("exports with Cache-Control no-store and bounded tool content", async () => {
    const session = await ownSession({
      id: "session_export_bound",
      title: "ExportBound",
      messages: [
        { role: "system", content: "sys-secret-should-omit" },
        { role: "tool", name: "shell", content: "z".repeat(900) }
      ]
    });
    const json = await call("GET", `/api/hermes/sessions/${session.id}/export?format=json`);
    expect(json.status).toBe(200);
    expect(json.headers.get("Cache-Control")).toBe("no-store");
    expect(json.text).not.toContain("sys-secret-should-omit");
    const body = JSON.parse(json.text);
    const tool = body.messages.find(item => item.role === "tool");
    expect(tool.content.length).toBeLessThanOrEqual(500);
    expect(tool.truncated).toBe(true);
    const system = body.messages.find(item => item.role === "system");
    expect(system.content).toBe("");
    expect(system.contentOmitted).toBe(true);
  });

  it("resume returns the bound conversation projectId after re-read", async () => {
    const session = await ownSession({ id: "session_resume_bound" });
    const project = await call("POST", "/api/hermes/projects", { body: { title: "Resume Project" } });
    const projectId = project.json.project.id;
    await env.DB.prepare(
      "UPDATE hermes_conversation_bindings SET project_id = ? WHERE hermes_session_id = ?"
    ).bind(projectId, session.id).run();
    await env.DB.prepare(
      "UPDATE conversations SET project_id = ? WHERE id = ?"
    ).bind(projectId, session.conversationId).run();
    const resumed = await call("POST", `/api/hermes/sessions/${session.id}/resume`, { body: {} });
    expect(resumed.status).toBe(200);
    expect(resumed.json.resume.sessionId).toBe(session.id);
    expect(resumed.json.resume.conversationId).toBe(session.conversationId);
    expect(resumed.json.resume.projectId).toBe(projectId);
  });

  it("assigns an owned session to an owned project through metadata only", async () => {
    const session = await ownSession();
    const project = await call("POST", "/api/hermes/projects", { body: { title: "Group" } });
    const assigned = await call("PATCH", `/api/hermes/sessions/${session.id}`, {
      body: { project_id: project.json.project.id }
    });
    expect(assigned.status).toBe(200);
    expect(assigned.json.session.projectId).toBe(project.json.project.id);
    expect(mock.calls.some(item => item.method === "PATCH")).toBe(false);
  });
});
