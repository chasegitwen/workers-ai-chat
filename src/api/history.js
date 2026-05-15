import { jsonResponse } from "../utils/response.js";

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

export async function createConversation(db, title = "New Chat") {
  const id = createId();
  const timestamp = now();

  await db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).bind(id, title, timestamp, timestamp).run();

  return {
    id,
    title,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export async function ensureConversation(db, conversationId, title) {
  const nextTitle = cleanTitle(title) || "New Chat";

  if (conversationId) {
    const existing = await db.prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?"
    ).bind(conversationId).first();

    if (existing) {
      if (isDefaultTitle(existing.title) && !isDefaultTitle(nextTitle)) {
        await db.prepare(
          "UPDATE conversations SET title = ? WHERE id = ?"
        ).bind(nextTitle, conversationId).run();

        return {
          ...existing,
          title: nextTitle
        };
      }

      return existing;
    }
  }

  return createConversation(db, nextTitle);
}

export async function saveMessage(db, conversationId, role, content) {
  const timestamp = now();

  await db.batch([
    db.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(createId(), conversationId, role, content || "", timestamp),
    db.prepare(
      "UPDATE conversations SET updated_at = ? WHERE id = ?"
    ).bind(timestamp, conversationId)
  ]);
}

export async function getRecentMessages(db, conversationId, limit = 20) {
  const result = await db.prepare(
    `SELECT role, content, created_at
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(conversationId, limit).all();

  return (result.results || [])
    .reverse()
    .map(message => ({
      role: message.role,
      content: message.content
    }));
}

export async function handleHistory(request, env, url) {
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured"
    }, 500);
  }

  if (request.method === "GET" && url.pathname === "/api/conversations") {
    const result = await env.DB.prepare(
      `SELECT
         c.id,
         c.title,
         c.created_at,
         c.updated_at,
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
       GROUP BY c.id, c.title, c.created_at, c.updated_at
       ORDER BY c.updated_at DESC
       LIMIT 50`
    ).all();

    return jsonResponse({
      ok: true,
      conversations: (result.results || []).map(item => ({
        ...item,
        last_message_preview: item.last_message_preview
          ? String(item.last_message_preview).replace(/\s+/g, " ").trim().slice(0, 80)
          : ""
      }))
    });
  }

  if (request.method === "POST" && url.pathname === "/api/conversations") {
    const data = await request.json().catch(() => ({}));
    const conversation = await createConversation(env.DB, data.title || "New Chat");

    return jsonResponse({
      ok: true,
      conversation
    });
  }

  const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);

  if (request.method === "GET" && messagesMatch) {
    const conversationId = messagesMatch[1];
    const result = await env.DB.prepare(
      `SELECT id, conversation_id, role, content, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    ).bind(conversationId).all();

    return jsonResponse({
      ok: true,
      messages: result.results || []
    });
  }

  const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);

  if (request.method === "PATCH" && conversationMatch) {
    const data = await request.json().catch(() => ({}));
    const title = cleanTitle(data.title);

    if (!title) {
      return jsonResponse({
        ok: false,
        error: "title must be a non-empty string"
      }, 400);
    }

    const timestamp = now();

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
