import { describe, expect, it } from "vitest";
import { handleHistory } from "../src/api/history.js";
import { resolveOpenClawRuntimeForProject } from "../src/api/openclawRuntimes.js";
import { DEFAULT_PROJECT_ID, ensureDefaultProject, handleProjects } from "../src/api/projects.js";

const HILLSBORO_RUNTIME = {
  id: "hillsboro-openclaw",
  display_name: "Hillsboro OpenClaw",
  slug: "hillsboro-openclaw",
  provider_id: "openclaw-hillsboro",
  base_url: "https://hill.hnsnowground.cfd/v1",
  callback_url: "",
  capabilities_json: JSON.stringify({
    bridge_callback: true,
    progress_callback: true,
    sse_events: true,
    remote_console: true
  }),
  agents_json: JSON.stringify([
    { agent_id: "main", display_name: "Main", verified: true },
    { agent_id: "glm51", display_name: "GLM 5.1", verified: true }
  ]),
  bridge_mode: "bridge",
  status: "verified",
  is_enabled: 1,
  last_verified_at: "2026-07-02T00:00:00.000Z",
  created_at: "2026-07-05T00:00:00.000Z",
  updated_at: "2026-07-05T00:00:00.000Z"
};

const SEATTLE_RUNTIME = {
  id: "seattle-openclaw",
  display_name: "Seattle OpenClaw",
  slug: "seattle-openclaw",
  provider_id: "openclaw-seattle",
  base_url: "https://act.hnsnowground.cfd/v1",
  callback_url: "",
  capabilities_json: JSON.stringify({
    bridge_callback: false,
    progress_callback: false,
    sse_events: false,
    remote_console: false,
    legacy_only: true
  }),
  agents_json: "[]",
  bridge_mode: "legacy",
  status: "unverified",
  is_enabled: 0,
  last_verified_at: null,
  created_at: "2026-07-05T00:00:00.000Z",
  updated_at: "2026-07-05T00:00:00.000Z"
};

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.db.first(this.sql, this.bindings);
  }

  async all() {
    return {
      results: this.db.all(this.sql, this.bindings)
    };
  }

  async run() {
    this.db.run(this.sql, this.bindings);
    return {
      success: true,
      meta: { changes: 1 }
    };
  }
}

class FakeD1 {
  constructor() {
    this.projects = new Map();
    this.conversations = new Map();
    this.messages = new Map();
    this.runtimes = new Map([
      [HILLSBORO_RUNTIME.id, { ...HILLSBORO_RUNTIME }],
      [SEATTLE_RUNTIME.id, { ...SEATTLE_RUNTIME }]
    ]);
    this.bindings = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  normalize(sql) {
    return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  first(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from projects") && normalized.includes("where id = ?")) {
      return this.projects.get(bindings[0]) || null;
    }
    if (normalized.includes("from conversations") && normalized.includes("where id = ?")) {
      return this.conversations.get(bindings[0]) || null;
    }
    if (normalized.includes("from openclaw_runtimes") && normalized.includes("where id = ?")) {
      return this.runtimes.get(bindings[0]) || null;
    }
    if (normalized.includes("from project_openclaw_runtime_bindings")) {
      const binding = this.bindings.get(bindings[0] + ":" + bindings[1]);
      if (!binding) {
        return null;
      }
      return this.bindingRow(binding);
    }
    return null;
  }

  all(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from projects")) {
      const includeArchived = !normalized.includes("where is_archived = 0");
      return [...this.projects.values()]
        .filter(project => includeArchived || Number(project.is_archived || 0) === 0)
        .sort((left, right) => Number(right.is_default || 0) - Number(left.is_default || 0));
    }
    if (normalized.includes("from conversations c")) {
      const fallbackProjectId = bindings[1];
      const projectId = bindings[2];
      return [...this.conversations.values()]
        .filter(conversation => (conversation.project_id || fallbackProjectId) === projectId)
        .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0))
        .map(conversation => {
          const messages = [...this.messages.values()]
            .filter(message => message.conversation_id === conversation.id)
            .sort((left, right) => Number(left.created_at || 0) - Number(right.created_at || 0));
          return {
            ...conversation,
            project_id: conversation.project_id || bindings[0],
            message_count: messages.length,
            last_message_preview: messages[messages.length - 1]?.content || ""
          };
        });
    }
    if (normalized.includes("from messages") && normalized.includes("where conversation_id = ?")) {
      return [...this.messages.values()]
        .filter(message => message.conversation_id === bindings[0])
        .sort((left, right) => Number(left.created_at || 0) - Number(right.created_at || 0));
    }
    if (normalized.includes("from project_openclaw_runtime_bindings")) {
      return [...this.bindings.values()]
        .filter(binding => binding.project_id === bindings[0])
        .map(binding => this.bindingRow(binding));
    }
    return [];
  }

  bindingRow(binding) {
    const runtime = this.runtimes.get(binding.runtime_id);
    return {
      ...binding,
      binding_is_default: binding.is_default,
      binding_is_enabled: binding.is_enabled,
      binding_created_at: binding.created_at,
      binding_updated_at: binding.updated_at,
      ...(runtime || {})
    };
  }

  run(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.startsWith("insert into projects")) {
      const [id, name, slug, description, createdAt, updatedAt] = bindings;
      const existing = this.projects.get(id);
      const isDefault = normalized.includes("values (?, ?, ?, ?, 1, 0");
      this.projects.set(id, {
        id,
        name,
        slug,
        description,
        is_default: isDefault ? 1 : 0,
        is_archived: 0,
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt,
        archived_at: null
      });
      return;
    }
    if (normalized.startsWith("insert into conversations")) {
      const [id, title, createdAt, updatedAt, projectId] = bindings;
      this.conversations.set(id, {
        id,
        title,
        created_at: createdAt,
        updated_at: updatedAt,
        project_id: projectId
      });
      return;
    }
    if (normalized.startsWith("update projects") && normalized.includes("set is_archived = 1")) {
      const [archivedAt, updatedAt, id] = bindings;
      const project = this.projects.get(id);
      if (project) {
        this.projects.set(id, {
          ...project,
          is_archived: 1,
          archived_at: archivedAt,
          updated_at: updatedAt
        });
      }
      return;
    }
    if (normalized.startsWith("update project_openclaw_runtime_bindings") && normalized.includes("set is_default = 0")) {
      const [updatedAt, projectId] = bindings;
      for (const [key, binding] of this.bindings.entries()) {
        if (binding.project_id === projectId) {
          this.bindings.set(key, {
            ...binding,
            is_default: 0,
            updated_at: updatedAt
          });
        }
      }
      return;
    }
    if (normalized.startsWith("insert into project_openclaw_runtime_bindings")) {
      const [projectId, runtimeId, allowedAgentsJson, defaultAgentId, createdAt, updatedAt] = bindings;
      const key = projectId + ":" + runtimeId;
      const existing = this.bindings.get(key);
      this.bindings.set(key, {
        project_id: projectId,
        runtime_id: runtimeId,
        is_default: 1,
        is_enabled: 1,
        allowed_agents_json: allowedAgentsJson,
        default_agent_id: defaultAgentId,
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt
      });
      return;
    }
    if (normalized.startsWith("update projects") && normalized.includes("set name = ?")) {
      const [name, slug, description, updatedAt, id] = bindings;
      const project = this.projects.get(id);
      if (project) {
        this.projects.set(id, {
          ...project,
          name,
          slug,
          description,
          updated_at: updatedAt
        });
      }
    }
  }
}

async function json(response) {
  return response.json();
}

function env(db) {
  return { DB: db };
}

describe("Project workspace foundation", () => {
  it("creates exactly one Default Project", async () => {
    const db = new FakeD1();

    await ensureDefaultProject(db);
    await ensureDefaultProject(db);

    const defaults = [...db.projects.values()].filter(project => Number(project.is_default || 0) === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toMatchObject({
      id: DEFAULT_PROJECT_ID,
      name: "Default Project",
      is_archived: 0
    });
  });

  it("lists legacy NULL project conversations under Default Project", async () => {
    const db = new FakeD1();
    db.conversations.set("legacy-conversation", {
      id: "legacy-conversation",
      title: "Legacy",
      project_id: null,
      created_at: 1,
      updated_at: 1
    });

    const response = await handleHistory(
      new Request("http://example.com/api/conversations"),
      env(db),
      new URL("http://example.com/api/conversations")
    );
    const body = await json(response);

    expect(body.ok).toBe(true);
    expect(body.project_id).toBe(DEFAULT_PROJECT_ID);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).toMatchObject({
      id: "legacy-conversation",
      project_id: DEFAULT_PROJECT_ID
    });
  });

  it("creates new conversations with project_id", async () => {
    const db = new FakeD1();

    const response = await handleHistory(
      new Request("http://example.com/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "New project chat" })
      }),
      env(db),
      new URL("http://example.com/api/conversations")
    );
    const body = await json(response);

    expect(body.ok).toBe(true);
    expect(body.conversation.project_id).toBe(DEFAULT_PROJECT_ID);
    expect(db.conversations.get(body.conversation.id).project_id).toBe(DEFAULT_PROJECT_ID);
  });

  it("scopes conversation list by selected project", async () => {
    const db = new FakeD1();
    await ensureDefaultProject(db);
    db.projects.set("project-a", {
      id: "project-a",
      name: "Project A",
      slug: "project-a",
      description: "",
      is_default: 0,
      is_archived: 0,
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z",
      archived_at: null
    });
    db.projects.set("project-b", {
      id: "project-b",
      name: "Project B",
      slug: "project-b",
      description: "",
      is_default: 0,
      is_archived: 0,
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z",
      archived_at: null
    });

    const createdA = await json(await handleHistory(
      new Request("http://example.com/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "A chat", project_id: "project-a" })
      }),
      env(db),
      new URL("http://example.com/api/conversations")
    ));
    const createdB = await json(await handleHistory(
      new Request("http://example.com/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "B chat", project_id: "project-b" })
      }),
      env(db),
      new URL("http://example.com/api/conversations")
    ));

    const listA = await json(await handleHistory(
      new Request("http://example.com/api/conversations?project_id=project-a"),
      env(db),
      new URL("http://example.com/api/conversations?project_id=project-a")
    ));
    const listB = await json(await handleHistory(
      new Request("http://example.com/api/conversations?project_id=project-b"),
      env(db),
      new URL("http://example.com/api/conversations?project_id=project-b")
    ));

    expect(listA.conversations.map(item => item.id)).toEqual([createdA.conversation.id]);
    expect(listB.conversations.map(item => item.id)).toEqual([createdB.conversation.id]);
  });

  it("loads messages for legacy NULL project conversations", async () => {
    const db = new FakeD1();
    db.conversations.set("legacy-conversation", {
      id: "legacy-conversation",
      title: "Legacy",
      project_id: null,
      created_at: 1,
      updated_at: 1
    });
    db.messages.set("message-1", {
      id: "message-1",
      conversation_id: "legacy-conversation",
      role: "user",
      content: "hello",
      created_at: 1
    });

    const response = await handleHistory(
      new Request("http://example.com/api/conversations/legacy-conversation/messages"),
      env(db),
      new URL("http://example.com/api/conversations/legacy-conversation/messages")
    );
    const body = await json(response);

    expect(body.ok).toBe(true);
    expect(body.messages).toEqual([{
      id: "message-1",
      conversation_id: "legacy-conversation",
      role: "user",
      content: "hello",
      created_at: 1
    }]);
  });

  it("hides archived projects unless requested", async () => {
    const db = new FakeD1();
    await ensureDefaultProject(db);
    db.projects.set("archive-me", {
      id: "archive-me",
      name: "Archive Me",
      slug: "archive-me",
      description: "",
      is_default: 0,
      is_archived: 0,
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z",
      archived_at: null
    });

    await handleProjects(
      new Request("http://example.com/api/projects/archive-me/archive", { method: "POST" }),
      env(db),
      new URL("http://example.com/api/projects/archive-me/archive")
    );

    const normal = await json(await handleProjects(
      new Request("http://example.com/api/projects"),
      env(db),
      new URL("http://example.com/api/projects")
    ));
    const withArchived = await json(await handleProjects(
      new Request("http://example.com/api/projects?include_archived=1"),
      env(db),
      new URL("http://example.com/api/projects?include_archived=1")
    ));

    expect(normal.projects.map(project => project.id)).not.toContain("archive-me");
    expect(withArchived.projects.map(project => project.id)).toContain("archive-me");
  });

  it("soft-deletes real projects and rejects deleting Default Project", async () => {
    const db = new FakeD1();
    await ensureDefaultProject(db);
    db.projects.set("delete-me", {
      id: "delete-me",
      name: "Delete Me",
      slug: "delete-me",
      description: "",
      is_default: 0,
      is_archived: 0,
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z",
      archived_at: null
    });

    const defaultDelete = await json(await handleProjects(
      new Request("http://example.com/api/projects/default", { method: "DELETE" }),
      env(db),
      new URL("http://example.com/api/projects/default")
    ));
    const deleted = await json(await handleProjects(
      new Request("http://example.com/api/projects/delete-me", { method: "DELETE" }),
      env(db),
      new URL("http://example.com/api/projects/delete-me")
    ));
    const normal = await json(await handleProjects(
      new Request("http://example.com/api/projects"),
      env(db),
      new URL("http://example.com/api/projects")
    ));

    expect(defaultDelete).toMatchObject({
      ok: false,
      error: "default project cannot be deleted"
    });
    expect(deleted).toMatchObject({
      ok: true,
      delete_mode: "soft_delete",
      project: {
        id: "delete-me",
        is_archived: true
      }
    });
    expect(normal.projects.map(project => project.id)).not.toContain("delete-me");
  });

  it("creates, reads, and updates projects through the project API", async () => {
    const db = new FakeD1();
    const createResponse = await handleProjects(
      new Request("http://example.com/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: "project-api-test",
          name: "Project API Test",
          slug: "project-api-test",
          description: "before"
        })
      }),
      env(db),
      new URL("http://example.com/api/projects")
    );
    const created = await json(createResponse);

    expect(createResponse.status).toBe(201);
    expect(created.project).toMatchObject({
      id: "project-api-test",
      is_default: false,
      is_archived: false
    });

    const patchResponse = await handleProjects(
      new Request("http://example.com/api/projects/project-api-test", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Project API Updated",
          description: "after"
        })
      }),
      env(db),
      new URL("http://example.com/api/projects/project-api-test")
    );
    const patched = await json(patchResponse);

    expect(patched.project).toMatchObject({
      id: "project-api-test",
      name: "Project API Updated",
      description: "after"
    });

    const readResponse = await handleProjects(
      new Request("http://example.com/api/projects/project-api-test"),
      env(db),
      new URL("http://example.com/api/projects/project-api-test")
    );
    const read = await json(readResponse);

    expect(read.project.name).toBe("Project API Updated");
  });

  it("binds newly created projects to Hillsboro as the default OpenClaw runtime", async () => {
    const db = new FakeD1();

    const response = await handleProjects(
      new Request("http://example.com/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: "openclaw-project",
          name: "OpenClaw Project"
        })
      }),
      env(db),
      new URL("http://example.com/api/projects")
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(body.project.id).toBe("openclaw-project");
    expect(db.bindings.get("openclaw-project:hillsboro-openclaw")).toMatchObject({
      project_id: "openclaw-project",
      runtime_id: "hillsboro-openclaw",
      is_default: 1,
      is_enabled: 1,
      default_agent_id: "main"
    });
    expect(db.bindings.has("openclaw-project:seattle-openclaw")).toBe(false);
  });

  it("resolves OpenClaw tasks in newly created projects to Hillsboro", async () => {
    const db = new FakeD1();
    await handleProjects(
      new Request("http://example.com/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: "runtime-ready-project",
          name: "Runtime Ready Project"
        })
      }),
      env(db),
      new URL("http://example.com/api/projects")
    );

    const result = await resolveOpenClawRuntimeForProject(env(db), {
      projectId: "runtime-ready-project",
      executionMode: "bridge",
      modelAgentId: "glm51"
    });

    expect(result).toMatchObject({
      ok: true,
      project_id: "runtime-ready-project",
      runtime_id: "hillsboro-openclaw",
      runtime_slug: "hillsboro-openclaw",
      provider_id: "openclaw-hillsboro",
      agent_id: "glm51",
      execution_mode: "bridge",
      resolution_source: "project_default"
    });
  });
});
