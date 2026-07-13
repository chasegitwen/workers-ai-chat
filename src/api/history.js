import { jsonResponse } from "../utils/response.js";
import { DEFAULT_PROJECT_ID, ensureDefaultProject, resolveProjectId } from "./projects.js";

const messageMetadataSchemaReady = new WeakSet();
const messageMetadataSchemaStatements = [
  "ALTER TABLE messages ADD COLUMN metadata TEXT"
];
const conversationArchiveSchemaReady = new WeakSet();
const conversationArchiveSchemaStatements = [
  "ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE conversations ADD COLUMN archived_at INTEGER",
  "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  `CREATE INDEX IF NOT EXISTS idx_conversations_project_archive_updated
   ON conversations(project_id, is_archived, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_project_archived_at
   ON conversations(project_id, is_archived, archived_at DESC)`
];

export function createId() {
  return crypto.randomUUID();
}

export function now() {
  return Date.now();
}

export function cleanTitle(title, maxLength = 80) {
  if (typeof title !== "string") {
    return "";
  }

  return title.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function isDefaultTitle(title) {
  const clean = cleanTitle(title);
  return !clean || clean === "New Chat" || clean === "\u65b0\u4f1a\u8bdd";
}

export function cleanSummary(summary) {
  if (typeof summary !== "string") {
    return null;
  }

  return summary.trim().slice(0, 8000);
}

function normalizeMessageMetadata(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function cleanMessageMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const cleaned = {};
  [
    "provider",
    "provider_label",
    "model",
    "model_label",
    "runtime",
    "runtime_id",
    "agent",
    "execution_mode"
  ].forEach(key => {
    const value = String(metadata[key] || "").trim();
    if (value) {
      cleaned[key] = value.slice(0, 160);
    }
  });
  return Object.keys(cleaned).length ? cleaned : null;
}

function isAlreadyAppliedSchemaError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return message.includes("duplicate column")
    || message.includes("already exists")
    || message.includes("duplicate column name");
}

async function runSchemaStatement(db, statement) {
  try {
    const prepared = db.prepare(statement);
    if (typeof prepared.run === "function") {
      await prepared.run();
    } else {
      await prepared.bind().run();
    }
  } catch (err) {
    if (!isAlreadyAppliedSchemaError(err)) {
      throw err;
    }
  }
}

export async function ensureConversationArchiveSchema(db) {
  if (!db || conversationArchiveSchemaReady.has(db)) {
    return;
  }

  for (const statement of conversationArchiveSchemaStatements) {
    await runSchemaStatement(db, statement);
  }

  conversationArchiveSchemaReady.add(db);
}

export async function ensureMessageMetadataSchema(db) {
  if (!db || messageMetadataSchemaReady.has(db)) {
    return;
  }

  for (const statement of messageMetadataSchemaStatements) {
    await runSchemaStatement(db, statement);
  }

  messageMetadataSchemaReady.add(db);
}

function normalizeConversation(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    project_id: row.project_id || DEFAULT_PROJECT_ID,
    is_archived: Number(row.is_archived || 0) === 1,
    archived: Number(row.is_archived || 0) === 1,
    archived_at: row.archived_at || null,
    pinned: Number(row.pinned || 0) === 1
  };
}

function normalizeAutoArchiveDays(value) {
  if (value === "never" || value === "Never" || value === 0 || value === "0") {
    return 0;
  }
  const days = Number(value || 90);
  return [30, 60, 90].includes(days) ? days : 90;
}

function isAlreadyAppliedSchemaError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return message.includes("duplicate column")
    || message.includes("already exists")
    || message.includes("duplicate column name");
}

async function runSchemaStatement(db, statement) {
  const prepared = db.prepare(statement);
  if (typeof prepared.run === "function") {
    return prepared.run();
  }
  return prepared.bind().run();
}

export async function ensureConversationArchiveSchema(db) {
  if (!db || conversationArchiveSchemaReady.has(db)) {
    return;
  }

  for (const statement of conversationArchiveSchemaStatements) {
    try {
      await runSchemaStatement(db, statement);
    } catch (err) {
      if (!isAlreadyAppliedSchemaError(err)) {
        throw err;
      }
    }
  }

  conversationArchiveSchemaReady.add(db);
}

async function readAutoArchiveDays(db) {
  try {
    const row = await db.prepare(
      "SELECT value FROM settings WHERE key = ?"
    ).bind("model_settings").first();
    const settings = row?.value ? JSON.parse(row.value) : null;
    return normalizeAutoArchiveDays(settings?.autoArchiveDays);
  } catch (err) {
    return 90;
  }
}

async function autoArchiveInactiveConversations(db, projectId) {
  const days = await readAutoArchiveDays(db);
  if (!days) {
    return;
  }
  const timestamp = now();
  const cutoff = timestamp - days * 24 * 60 * 60 * 1000;
  await db.prepare(
    `UPDATE conversations
     SET is_archived = 1,
       archived_at = ?
     WHERE COALESCE(project_id, ?) = ?
       AND COALESCE(is_archived, 0) = 0
       AND COALESCE(pinned, 0) = 0
       AND updated_at <= ?`
  ).bind(timestamp, DEFAULT_PROJECT_ID, projectId, cutoff).run();
}

export function titleFromMessage(content) {
  const clean = (content || "").replace(/\s+/g, " ").trim();

  if (!clean) {
    return "New Chat";
  }

  const hasCjk = /[\u3400-\u9fff]/.test(clean);
  const limit = hasCjk ? 20 : 40;

  if (clean.length <= limit) {
    return clean;
  }

  return clean.slice(0, limit) + "...";
}

function requestProjectId(data, url) {
  return data?.project_id || data?.projectId || url?.searchParams?.get("project_id") || url?.searchParams?.get("projectId") || "";
}

export async function createConversation(db, title = "New Chat", projectId = "") {
  await ensureConversationArchiveSchema(db);

  const id = createId();
  const timestamp = now();
  const resolvedProjectId = await resolveProjectId(db, projectId);

  await db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, title, timestamp, timestamp, resolvedProjectId).run();

  return {
    id,
    title,
    project_id: resolvedProjectId,
    created_at: timestamp,
    updated_at: timestamp,
    is_archived: false,
    archived: false,
    archived_at: null,
    pinned: false
  };
}

export async function ensureConversation(db, conversationId, title, projectId = "") {
  await ensureConversationArchiveSchema(db);

  const nextTitle = cleanTitle(title) || "New Chat";
  const resolvedProjectId = await resolveProjectId(db, projectId);

  if (conversationId) {
    const existing = await db.prepare(
      "SELECT id, title, project_id, created_at, updated_at, is_archived, archived_at, pinned FROM conversations WHERE id = ?"
    ).bind(conversationId).first();

    if (existing) {
      const existingProjectId = existing.project_id || DEFAULT_PROJECT_ID;
      if (isDefaultTitle(existing.title) && !isDefaultTitle(nextTitle)) {
        await db.prepare(
          "UPDATE conversations SET title = ? WHERE id = ?"
        ).bind(nextTitle, conversationId).run();

        return {
          ...normalizeConversation(existing),
          project_id: existingProjectId,
          title: nextTitle
        };
      }

      return {
        ...normalizeConversation(existing),
        project_id: existingProjectId
      };
    }
  }

  return createConversation(db, nextTitle, resolvedProjectId);
}

export async function saveMessage(db, conversationId, role, content, metadata = null) {
  await ensureConversationArchiveSchema(db);
  await ensureMessageMetadataSchema(db);

  const timestamp = now();
  const id = createId();
  const cleanMetadata = cleanMessageMetadata(metadata);

  await db.batch([
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, conversationId, role, content || "", timestamp, cleanMetadata ? JSON.stringify(cleanMetadata) : null),
    db.prepare(
      "UPDATE conversations SET updated_at = ?, is_archived = 0, archived_at = NULL WHERE id = ?"
    ).bind(timestamp, conversationId)
  ]);

  return {
    id,
    conversation_id: conversationId,
    role,
    content: content || "",
    created_at: timestamp,
    metadata: cleanMetadata
  };
}

export async function getRecentMessages(db, conversationId, limit = 20) {
  await ensureMessageMetadataSchema(db);

  const result = await db.prepare(
    `SELECT role, content, created_at, metadata
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(conversationId, limit).all();

  return (result.results || [])
    .reverse()
    .map(message => ({
      role: message.role,
      content: message.content,
      metadata: normalizeMessageMetadata(message.metadata)
    }));
}

export async function handleHistory(request, env, url) {
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured"
    }, 500);
  }

  await ensureConversationArchiveSchema(env.DB);
  await ensureMessageMetadataSchema(env.DB);

  if (request.method === "GET" && url.pathname === "/api/conversations") {
    await ensureDefaultProject(env.DB);
    const projectId = requestProjectId(null, url) || DEFAULT_PROJECT_ID;
    const includeArchived = ["1", "true"].includes(String(url.searchParams.get("include_archived") || url.searchParams.get("includeArchived") || "").toLowerCase());
    await autoArchiveInactiveConversations(env.DB, projectId);
    const result = await env.DB.prepare(
      `SELECT
         c.id,
         c.title,
         COALESCE(c.project_id, ?) AS project_id,
         c.created_at,
         c.updated_at,
         c.is_archived,
         c.archived_at,
         c.pinned,
         COUNT(m.id) AS message_count,
         (
           SELECT content
           FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message_preview
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE COALESCE(c.project_id, ?) = ?
         AND (? = 1 OR COALESCE(c.is_archived, 0) = 0)
       GROUP BY c.id, c.title, c.project_id, c.created_at, c.updated_at, c.is_archived, c.archived_at, c.pinned
       ORDER BY COALESCE(c.is_archived, 0) ASC, COALESCE(c.pinned, 0) DESC, c.updated_at DESC
       LIMIT 50`
    ).bind(DEFAULT_PROJECT_ID, DEFAULT_PROJECT_ID, projectId, includeArchived ? 1 : 0).all();

    return jsonResponse({
      ok: true,
      project_id: projectId,
      conversations: (result.results || []).map(item => ({
        ...normalizeConversation(item),
        last_message_preview: item.last_message_preview
          ? String(item.last_message_preview).replace(/\s+/g, " ").trim().slice(0, 80)
          : ""
      }))
    });
  }

  if (request.method === "POST" && url.pathname === "/api/conversations") {
    const data = await request.json().catch(() => ({}));
    const conversation = await createConversation(env.DB, data.title || "New Chat", requestProjectId(data, url));

    return jsonResponse({
      ok: true,
      conversation
    });
  }

  const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);

  if (request.method === "GET" && messagesMatch) {
    const conversationId = messagesMatch[1];
    const result = await env.DB.prepare(
      `SELECT id, conversation_id, role, content, created_at, metadata
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    ).bind(conversationId).all();

    return jsonResponse({
      ok: true,
      messages: (result.results || []).map(message => ({
        ...message,
        metadata: normalizeMessageMetadata(message.metadata)
      }))
    });
  }

  const summaryMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/summary$/);

  if (request.method === "GET" && summaryMatch) {
    const conversationId = summaryMatch[1];
    const conversation = await env.DB.prepare(
      `SELECT id, summary, summarized_message_id, summarized_at
       FROM conversations
       WHERE id = ?`
    ).bind(conversationId).first();

    if (!conversation) {
      return jsonResponse({
        ok: false,
        error: "conversation not found"
      }, 404);
    }

    return jsonResponse({
      ok: true,
      conversationId,
      summary: conversation.summary || "",
      summarizedAt: conversation.summarized_at || null,
      summarizedMessageId: conversation.summarized_message_id || null
    });
  }

  if (request.method === "PATCH" && summaryMatch) {
    const data = await request.json().catch(() => ({}));
    const summary = cleanSummary(data.summary);

    if (summary === null) {
      return jsonResponse({
        ok: false,
        error: "summary must be a string"
      }, 400);
    }

    const timestamp = now();

    await env.DB.prepare(
      `UPDATE conversations
       SET summary = ?, summarized_at = ?, summarized_message_id = NULL
       WHERE id = ?`
    ).bind(summary, summary ? timestamp : null, summaryMatch[1]).run();

    return jsonResponse({
      ok: true,
      conversationId: summaryMatch[1],
      summary,
      summarizedAt: summary ? timestamp : null,
      summarizedMessageId: null
    });
  }

  const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);

  if (request.method === "PATCH" && conversationMatch) {
    const data = await request.json().catch(() => ({}));
    const action = String(data.action || "").trim().toLowerCase();
    const timestamp = now();
    const conversationId = decodeURIComponent(conversationMatch[1]);

    if (action && !["pin", "unpin", "archive", "restore"].includes(action)) {
      return jsonResponse({
        ok: false,
        error: "unsupported conversation action"
      }, 400);
    }

    if (["pin", "unpin", "archive", "restore"].includes(action)) {
      if (action === "pin") {
        await env.DB.prepare(
          "UPDATE conversations SET pinned = 1 WHERE id = ?"
        ).bind(conversationId).run();
      } else if (action === "unpin") {
        await env.DB.prepare(
          "UPDATE conversations SET pinned = 0 WHERE id = ?"
        ).bind(conversationId).run();
      } else if (action === "archive") {
        await env.DB.prepare(
          "UPDATE conversations SET is_archived = 1, archived_at = ? WHERE id = ?"
        ).bind(timestamp, conversationId).run();
      } else if (action === "restore") {
        await env.DB.prepare(
          "UPDATE conversations SET is_archived = 0, archived_at = NULL WHERE id = ?"
        ).bind(conversationId).run();
      }

      const conversation = await env.DB.prepare(
        "SELECT id, title, project_id, created_at, updated_at, is_archived, archived_at, pinned FROM conversations WHERE id = ?"
      ).bind(conversationId).first();

      if (!conversation) {
        return jsonResponse({
          ok: false,
          error: "conversation not found"
        }, 404);
      }

      return jsonResponse({
        ok: true,
        conversation: normalizeConversation(conversation)
      });
    }

    const title = cleanTitle(data.title);

    if (!title) {
      return jsonResponse({
        ok: false,
        error: "title must be a non-empty string"
      }, 400);
    }

    await env.DB.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
    ).bind(title, timestamp, conversationMatch[1]).run();

    return jsonResponse({
      ok: true,
      conversation: {
        id: conversationMatch[1],
        title,
        updated_at: timestamp
      }
    });
  }

  if (request.method === "DELETE" && conversationMatch) {
    await env.DB.prepare(
      "DELETE FROM conversations WHERE id = ?"
    ).bind(conversationMatch[1]).run();

    return jsonResponse({
      ok: true
    });
  }

  return null;
}
