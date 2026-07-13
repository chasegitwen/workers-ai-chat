import { describe, expect, it } from "vitest";
import { ensureConversationArchiveSchema, handleHistory, saveMessage } from "../src/api/history.js";
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
    this.schemaStatements = [];
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
      const archivedMode = Number(bindings[3] || 0);
      const searchQuery = String(bindings[6] || "").toLowerCase();
      const hasCursor = Number(bindings[9] || 0) === 1;
      const cursorPinned = Number(bindings[10] || 0);
      const cursorUpdated = Number(bindings[12] || 0);
      const cursorId = String(bindings[14] || "");
      const limit = Number(bindings[15] || 50);
      return [...this.conversations.values()]
        .filter(conversation => (conversation.project_id || fallbackProjectId) === projectId)
        .filter(conversation => {
          if (archivedMode === 2) {
            return true;
          }
          if (archivedMode === 1) {
            return Number(conversation.is_archived || 0) === 1;
          }
          return Number(conversation.is_archived || 0) === 0;
        })
        .filter(conversation => !searchQuery
          || String(conversation.title || "").toLowerCase().includes(searchQuery)
          || [...this.messages.values()].some(message =>
            message.conversation_id === conversation.id
              && String(message.content || "").toLowerCase().includes(searchQuery)
          ))
        .filter(conversation => {
          if (!hasCursor) {
            return true;
          }
          const pinned = Number(conversation.pinned || 0);
          const updated = Number(conversation.updated_at || 0);
          return pinned < cursorPinned
            || (pinned === cursorPinned && (updated < cursorUpdated || (updated === cursorUpdated && conversation.id < cursorId)));
        })
        .sort((left, right) => {
          const pinnedDiff = Number(right.pinned || 0) - Number(left.pinned || 0);
          const updatedDiff = Number(right.updated_at || 0) - Number(left.updated_at || 0);
          return pinnedDiff || updatedDiff || String(right.id).localeCompare(String(left.id));
        })
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
        })
        .slice(0, limit);
    }
    return [];
  }

  run(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.startsWith("alter table conversations add column")
      || normalized.startsWith("create index if not exists idx_conversations_project_archive")) {
      this.schemaStatements.push(normalized);
      return;
    }
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
      if (!conversation) {
        return;
      }
      this.conversations.set(bindings[0], { ...conversation, pinned: 1 });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set pinned = 0")) {
      const conversation = this.conversations.get(bindings[0]);
      if (!conversation) {
        return;
      }
      this.conversations.set(bindings[0], { ...conversation, pinned: 0 });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set is_archived = 1, archived_at = ? where id = ?")) {
      const [archivedAt, id] = bindings;
      const conversation = this.conversations.get(id);
      if (!conversation) {
        return;
      }
      this.conversations.set(id, { ...conversation, is_archived: 1, archived_at: archivedAt });
      return;
    }
    if (normalized.startsWith("update conversations") && normalized.includes("set is_archived = 0, archived_at = null where id = ?")) {
      const conversation = this.conversations.get(bindings[0]);
      if (!conversation) {
        return;
      }
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
  it("self-heals archive schema fields before archive-aware queries run", async () => {
    const db = new FakeD1();

    await ensureConversationArchiveSchema(db);

    expect(db.schemaStatements).toEqual(expect.arrayContaining([
      expect.stringContaining("add column is_archived"),
      expect.stringContaining("add column archived_at"),
      expect.stringContaining("add column pinned"),
      expect.stringContaining("idx_conversations_project_archive_updated"),
      expect.stringContaining("idx_conversations_project_archived_at")
    ]));
  });

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

  it("orders pinned active conversations before newer unpinned conversations", async () => {
    const db = new FakeD1();
    addConversation(db, "newer-chat", Date.now());
    addConversation(db, "pinned-older-chat", Date.now() - 10 * 24 * 60 * 60 * 1000, { pinned: 1 });

    const body = await json(await handleHistory(
      new Request("http://example.com/api/conversations"),
      env(db),
      new URL("http://example.com/api/conversations")
    ));

    expect(body.conversations.map(item => item.id)).toEqual(["pinned-older-chat", "newer-chat"]);
  });

  it("paginates active conversations with a cursor", async () => {
    const db = new FakeD1();
    const timestamp = Date.now();
    for (let index = 0; index < 75; index += 1) {
      addConversation(db, "active-chat-" + String(index).padStart(2, "0"), timestamp - index);
    }

    const firstPage = await json(await handleHistory(
      new Request("http://example.com/api/conversations"),
      env(db),
      new URL("http://example.com/api/conversations")
    ));
    expect(firstPage.conversations).toHaveLength(50);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_cursor).toBeTruthy();

    const secondPage = await json(await handleHistory(
      new Request("http://example.com/api/conversations?cursor=" + encodeURIComponent(firstPage.next_cursor)),
      env(db),
      new URL("http://example.com/api/conversations?cursor=" + encodeURIComponent(firstPage.next_cursor))
    ));
    expect(secondPage.conversations).toHaveLength(25);
    expect(secondPage.has_more).toBe(false);
    const firstIds = new Set(firstPage.conversations.map(item => item.id));
    expect(secondPage.conversations.some(item => firstIds.has(item.id))).toBe(false);
  });

  it("searches active conversations beyond the first page without returning archived results", async () => {
    const db = new FakeD1();
    const timestamp = Date.now();
    for (let index = 0; index < 60; index += 1) {
      addConversation(db, "active-chat-" + index, timestamp - index);
    }
    addConversation(db, "deep-search-target", timestamp - 1000);
    addConversation(db, "deep-search-target-archived", timestamp - 1001, {
      is_archived: 1,
      archived_at: timestamp
    });

    const body = await json(await handleHistory(
      new Request("http://example.com/api/conversations?q=deep-search-target"),
      env(db),
      new URL("http://example.com/api/conversations?q=deep-search-target")
    ));

    expect(body.conversations.map(item => item.id)).toEqual(["deep-search-target"]);
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

  it("returns archived conversations even when more than 50 active conversations exist", async () => {
    const db = new FakeD1();
    const timestamp = Date.now();
    for (let index = 0; index < 60; index += 1) {
      addConversation(db, "active-chat-" + index, timestamp - index);
    }
    addConversation(db, "archived-chat", timestamp - 1000, {
      is_archived: 1,
      archived_at: timestamp
    });

    const body = await json(await handleHistory(
      new Request("http://example.com/api/conversations?include_archived=1"),
      env(db),
      new URL("http://example.com/api/conversations?include_archived=1")
    ));

    expect(body.conversations.some(item => item.id === "archived-chat" && item.is_archived)).toBe(true);
  });

  it("returns only archived conversations for archived-only requests", async () => {
    const db = new FakeD1();
    const timestamp = Date.now();
    addConversation(db, "old-active-chat", timestamp - 1000);
    addConversation(db, "archived-chat", timestamp - 2000, {
      is_archived: 1,
      archived_at: timestamp
    });

    const body = await json(await handleHistory(
      new Request("http://example.com/api/conversations?archived_only=1"),
      env(db),
      new URL("http://example.com/api/conversations?archived_only=1")
    ));

    expect(body.conversations.map(item => item.id)).toEqual(["archived-chat"]);
  });

  it("returns a clear 404 when a conversation action targets a missing conversation", async () => {
    const db = new FakeD1();

    const response = await handleHistory(
      new Request("http://example.com/api/conversations/missing-chat", {
        method: "PATCH",
        body: JSON.stringify({ action: "pin" })
      }),
      env(db),
      new URL("http://example.com/api/conversations/missing-chat")
    );
    const body = await json(response);

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("conversation not found");
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
