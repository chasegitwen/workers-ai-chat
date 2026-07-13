import { describe, expect, it } from "vitest";
import { handleHistory, saveMessage } from "../src/api/history.js";
import { DEFAULT_PROJECT_ID } from "../src/api/projects.js";

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
    return { results: this.db.all(this.sql, this.bindings) };
  }

  async run() {
    this.db.run(this.sql, this.bindings);
    return { success: true };
  }
}

class FakeD1 {
  constructor() {
    this.conversations = new Map();
    this.messages = new Map();
    this.settings = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      await statement.run();
    }
  }

  normalize(sql) {
    return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  first(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from settings")) {
      const value = this.settings.get(bindings[0]);
      return value ? { value } : null;
    }
    if (normalized.includes("from conversations") && normalized.includes("where id = ?")) {
      return this.conversations.get(bindings[0]) || null;
    }
    return null;
  }

  all(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from conversations c")) {
      const fallbackProjectId = bindings[1];
      const projectId = bindings[2];
      const includeArchived = Number(bindings[3] || 0) === 1;
      return [...this.conversations.values()]
        .filter(conversation => (conversation.project_id || fallbackProjectId) === projectId)
        .filter(conversation => includeArchived || Number(conversation.is_archived || 0) === 0)
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
    return [];
  }

  run(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.startsWith("update conversations") && normalized.includes("set is_archived = 1") && normalized.includes("updated_at <= ?")) {
      const [archivedAt, fallbackProjectId, projectId, cutoff] = bindings;
      for (const [id, conversation] of this.conversations.entries()) {
        if ((conversation.project_id || fallbackProjectId) === projectId
          && Number(conversation.is_archived || 0) === 0
          && Number(conversation.pinned || 0) === 0
          && Number(conversation.updated_at || 0) <= Number(cutoff)) {
          this.conversations.set(id, {
            ...conversation,
            is_archived: 1,
            archived_at: archivedAt
          });
        }
      }
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set pinned = 1")) {
      const conversation = this.conversations.get(bindings[0]);
      this.conversations.set(bindings[0], { ...conversation, pinned: 1 });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set pinned = 0")) {
      const conversation = this.conversations.get(bindings[0]);
      this.conversations.set(bindings[0], { ...conversation, pinned: 0 });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set is_archived = 1, archived_at = ? where id = ?")) {
      const [archivedAt, id] = bindings;
      const conversation = this.conversations.get(id);
      this.conversations.set(id, { ...conversation, is_archived: 1, archived_at: archivedAt });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set is_archived = 0, archived_at = null where id = ?")) {
      const conversation = this.conversations.get(bindings[0]);
      this.conversations.set(bindings[0], { ...conversation, is_archived: 0, archived_at: null });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set updated_at = ?, is_archived = 0")) {
      const [updatedAt, id] = bindings;
      const conversation = this.conversations.get(id);
      this.conversations.set(id, { ...conversation, updated_at: updatedAt, is_archived: 0, archived_at: null });
      return;
    }
    if (normalized.startsWith("insert into messages")) {
      const [id, conversationId, role, content, createdAt] = bindings;
      this.messages.set(id, { id, conversation_id: conversationId, role, content, created_at: createdAt });
      return;
    }
    if (normalized.startsWith("delete from conversations")) {
      this.conversations.delete(bindings[0]);
    }
  }
}

function env(db) {
  return { DB: db };
}

async function json(response) {
  return response.json();
}

function addConversation(db, id, updatedAt, extras = {}) {
  db.conversations.set(id, {
    id,
    title: id,
    project_id: DEFAULT_PROJECT_ID,
    created_at: updatedAt,
    updated_at: updatedAt,
    is_archived: 0,
    archived_at: null,
    pinned: 0,
    ...extras
  });
}

describe("conversation archive state", () => {
  it("auto-archives inactive conversations after the default 90 days", async () => {
    const db = new FakeD1();
    addConversation(db, "old-chat", Date.now() - 91 * 24 * 60 * 60 * 1000);

    const body = await json(await handleHistory(
      new Request("http://example.com/api/conversations?include_archived=1"),
      env(db),
      new URL("http://example.com/api/conversations?include_archived=1")
    ));

    expect(body.conversations.find(item => item.id === "old-chat").is_archived).toBe(true);
    expect(db.conversations.get("old-chat").archived_at).toBeTruthy();
  });

  it("does not auto-archive pinned conversations", async () => {
    const db = new FakeD1();
    addConversation(db, "pinned-chat", Date.now() - 120 * 24 * 60 * 60 * 1000, { pinned: 1 });

    await handleHistory(
      new Request("http://example.com/api/conversations?include_archived=1"),
      env(db),
      new URL("http://example.com/api/conversations?include_archived=1")
    );

    expect(db.conversations.get("pinned-chat").is_archived).toBe(0);
  });

  it("archives, restores, pins, and deletes through the existing conversation route", async () => {
    const db = new FakeD1();
    addConversation(db, "manual-chat", Date.now());

    let body = await json(await handleHistory(
      new Request("http://example.com/api/conversations/manual-chat", {
        method: "PATCH",
        body: JSON.stringify({ action: "pin" })
      }),
      env(db),
      new URL("http://example.com/api/conversations/manual-chat")
    ));
    expect(body.conversation.pinned).toBe(true);

    body = await json(await handleHistory(
      new Request("http://example.com/api/conversations/manual-chat", {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" })
      }),
      env(db),
      new URL("http://example.com/api/conversations/manual-chat")
    ));
    expect(body.conversation.is_archived).toBe(true);
    expect(body.conversation.archived_at).toBeTruthy();

    body = await json(await handleHistory(
      new Request("http://example.com/api/conversations/manual-chat", {
        method: "PATCH",
        body: JSON.stringify({ action: "restore" })
      }),
      env(db),
      new URL("http://example.com/api/conversations/manual-chat")
    ));
    expect(body.conversation.is_archived).toBe(false);

    const deleteResponse = await handleHistory(
      new Request("http://example.com/api/conversations/manual-chat", { method: "DELETE" }),
      env(db),
      new URL("http://example.com/api/conversations/manual-chat")
    );
    expect((await json(deleteResponse)).ok).toBe(true);
    expect(db.conversations.has("manual-chat")).toBe(false);
  });

  it("restores an archived conversation when a new message is saved", async () => {
    const db = new FakeD1();
    addConversation(db, "active-again", Date.now() - 1000, { is_archived: 1, archived_at: Date.now() - 500 });

    await saveMessage(db, "active-again", "user", "hello again");

    expect(db.conversations.get("active-again").is_archived).toBe(0);
    expect(db.conversations.get("active-again").archived_at).toBe(null);
  });

  it("honors persisted Never auto-archive setting", async () => {
    const db = new FakeD1();
    db.settings.set("model_settings", JSON.stringify({ autoArchiveDays: "never" }));
    addConversation(db, "never-chat", Date.now() - 365 * 24 * 60 * 60 * 1000);

    await handleHistory(
      new Request("http://example.com/api/conversations?include_archived=1"),
      env(db),
      new URL("http://example.com/api/conversations?include_archived=1")
    );

    expect(db.conversations.get("never-chat").is_archived).toBe(0);
  });
});
