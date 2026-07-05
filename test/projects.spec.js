import { describe, expect, it } from "vitest";
import { handleHistory } from "../src/api/history.js";
import { DEFAULT_PROJECT_ID, ensureDefaultProject, handleProjects } from "../src/api/projects.js";

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
    return [];
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
});
