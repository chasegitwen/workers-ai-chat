import { jsonResponse } from "../utils/response.js";
import {
  getQueryTerms,
  scoreChunk,
  splitTextIntoChunks
} from "../utils/chunks.js";

function createId() {
  return crypto.randomUUID();
}

function sanitizeFilename(name) {
  return (name || "file")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "file";
}

async function extractTextFromFile(file, providedText) {
  if (typeof providedText === "string" && providedText.trim()) {
    return providedText;
  }

  const type = file.type || "";
  const name = (file.name || "").toLowerCase();

  if (
    type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return file.text();
  }

  return "";
}

function requireFilesBindings(env) {
  if (!env.DB) {
    return "D1 binding DB is not configured";
  }

  if (!env.FILES_BUCKET) {
    return "R2 binding FILES_BUCKET is not configured";
  }

  return "";
}

export async function getFileTextsByIds(env, fileIds = []) {
  if (!env.DB || !Array.isArray(fileIds) || !fileIds.length) {
    return [];
  }

  const uniqueIds = [...new Set(fileIds.filter(id => typeof id === "string" && id.trim()))]
    .slice(0, 8);

  if (!uniqueIds.length) {
    return [];
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT id, filename, content_type, text_content
     FROM files
     WHERE id IN (${placeholders})`
  ).bind(...uniqueIds).all();

  return (result.results || [])
    .filter(file => (file.text_content || "").trim())
    .map(file => ({
      id: file.id,
      name: file.filename,
      type: file.content_type || "stored-file",
      text: file.text_content || ""
    }));
}

async function saveFileChunks(db, fileId, textContent) {
  const chunks = splitTextIntoChunks(textContent);

  if (!chunks.length) {
    return 0;
  }

  const statements = chunks.map((content, index) => db.prepare(
    `INSERT INTO file_chunks (id, file_id, chunk_index, content)
     VALUES (?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), fileId, index, content));

  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50));
  }

  return chunks.length;
}

export async function getRelevantFileChunksByIds(env, fileIds = [], query = "", options = {}) {
  if (!env.DB || !Array.isArray(fileIds) || !fileIds.length) {
    return [];
  }

  const maxFiles = options.maxFiles || 8;
  const perFileLimit = options.perFileLimit || 5;
  const totalLimit = options.totalLimit || 14;
  const uniqueIds = [...new Set(fileIds.filter(id => typeof id === "string" && id.trim()))]
    .slice(0, maxFiles);

  if (!uniqueIds.length) {
    return [];
  }

  const terms = getQueryTerms(query);
  const retrieved = [];
  const fallbackFiles = [];

  for (const fileId of uniqueIds) {
    const file = await env.DB.prepare(
      `SELECT id, filename, content_type, text_content
       FROM files
       WHERE id = ?`
    ).bind(fileId).first();

    if (!file) {
      continue;
    }

    const chunksResult = await env.DB.prepare(
      `SELECT id, file_id, chunk_index, content
       FROM file_chunks
       WHERE file_id = ?
       ORDER BY chunk_index ASC`
    ).bind(fileId).all();
    const chunks = chunksResult.results || [];

    if (!chunks.length) {
      if ((file.text_content || "").trim()) {
        fallbackFiles.push({
          id: file.id,
          name: file.filename,
          type: file.content_type || "stored-file",
          text: file.text_content || ""
        });
      }

      continue;
    }

    const ranked = chunks
      .map(chunk => ({
        id: chunk.id,
        fileId: file.id,
        filename: file.filename,
        contentType: file.content_type || "stored-file",
        chunkIndex: chunk.chunk_index,
        content: chunk.content,
        score: terms.length ? scoreChunk(chunk.content, terms) : 0
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return a.chunkIndex - b.chunkIndex;
      })
      .slice(0, perFileLimit);

    retrieved.push(...ranked);
  }

  const selected = retrieved
    .filter(chunk => !terms.length || chunk.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }

      return a.chunkIndex - b.chunkIndex;
    })
    .slice(0, totalLimit);

  if (!selected.length && retrieved.length) {
    selected.push(...retrieved.slice(0, Math.min(totalLimit, retrieved.length)));
  }

  if (fallbackFiles.length) {
    for (const file of fallbackFiles) {
      selected.push({
        id: file.id + ":fallback",
        fileId: file.id,
        filename: file.name,
        contentType: file.type,
        chunkIndex: 0,
        content: file.text.slice(0, 5000),
        score: 0,
        fallback: true
      });
    }
  }

  return selected.slice(0, totalLimit);
}

export async function handleFiles(request, env, url) {
  const bindingError = requireFilesBindings(env);

  if (bindingError) {
    return jsonResponse({
      ok: false,
      error: bindingError
    }, 500);
  }

  if (request.method === "POST" && url.pathname === "/api/files/upload") {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonResponse({
        ok: false,
        error: "file field is required"
      }, 400);
    }

    const id = createId();
    const filename = sanitizeFilename(file.name);
    const conversationId = String(form.get("conversation_id") || "").trim() || null;
    const providedText = form.get("text_content");
    const textContent = await extractTextFromFile(
      file,
      typeof providedText === "string" ? providedText : ""
    );
    const r2Key = "files/" + id + "/" + filename;
    const createdAt = new Date().toISOString();

    await env.FILES_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream"
      }
    });

    await env.DB.prepare(
      `INSERT INTO files
       (id, conversation_id, filename, content_type, size, r2_key, text_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      conversationId,
      filename,
      file.type || "application/octet-stream",
      file.size,
      r2Key,
      textContent,
      createdAt
    ).run();

    await saveFileChunks(env.DB, id, textContent);

    return jsonResponse({
      ok: true,
      file: {
        id,
        filename,
        content_type: file.type || "application/octet-stream",
        size: file.size,
        created_at: createdAt
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/api/files") {
    const result = await env.DB.prepare(
      `SELECT id, conversation_id, filename, content_type, size, created_at
       FROM files
       ORDER BY created_at DESC
       LIMIT 50`
    ).all();

    return jsonResponse({
      ok: true,
      files: result.results || []
    });
  }

  const textMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/text$/);

  if (request.method === "GET" && textMatch) {
    const file = await env.DB.prepare(
      "SELECT id, text_content FROM files WHERE id = ?"
    ).bind(textMatch[1]).first();

    if (!file) {
      return jsonResponse({
        ok: false,
        error: "file not found"
      }, 404);
    }

    return jsonResponse({
      ok: true,
      id: file.id,
      text_content: file.text_content || ""
    });
  }

  const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);

  if (request.method === "DELETE" && fileMatch) {
    const file = await env.DB.prepare(
      "SELECT id, r2_key FROM files WHERE id = ?"
    ).bind(fileMatch[1]).first();

    if (!file) {
      return jsonResponse({
        ok: false,
        error: "file not found"
      }, 404);
    }

    await env.FILES_BUCKET.delete(file.r2_key);
    await env.DB.prepare(
      "DELETE FROM files WHERE id = ?"
    ).bind(file.id).run();

    return jsonResponse({
      ok: true
    });
  }

  return null;
}
