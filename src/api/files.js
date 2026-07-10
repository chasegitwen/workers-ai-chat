import { jsonResponse } from "../utils/response.js";
import {
  getQueryTerms,
  scoreChunk,
  splitTextIntoChunks
} from "../utils/chunks.js";

function createId() {
  return crypto.randomUUID();
}

export const NATIVE_ATTACHMENT_LIMITS = {
  maxAttachments: 5,
  maxImageBytes: 4 * 1024 * 1024,
  maxFileBytes: 6 * 1024 * 1024,
  maxTotalRawBytes: 16 * 1024 * 1024,
  maxEstimatedPayloadBytes: 24 * 1024 * 1024
};

const NATIVE_ATTACHMENT_MIME_ALLOWLIST = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

const NATIVE_ATTACHMENT_EXTENSION_MIME = new Map([
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".zip", "application/zip"],
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]
]);

function fileExtension(filename) {
  const name = String(filename || "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function normalizeMimeForNativeAttachment(contentType, filename) {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (mime) {
    return mime;
  }
  return NATIVE_ATTACHMENT_EXTENSION_MIME.get(fileExtension(filename)) || "application/octet-stream";
}

function nativeAttachmentAllowed(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("video/")) {
    return false;
  }
  return mime.startsWith("image/")
    || mime.startsWith("audio/")
    || mime.startsWith("text/")
    || NATIVE_ATTACHMENT_MIME_ALLOWLIST.has(mime);
}

export function estimateBase64Length(byteLength) {
  const size = Number(byteLength || 0);
  return size > 0 ? 4 * Math.ceil(size / 3) : 0;
}

function estimateNativeAttachmentPayloadBytes(message, attachments) {
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(String(message || "")).length;
  return (Array.isArray(attachments) ? attachments : []).reduce((total, attachment) => {
    const filenameBytes = encoder.encode(String(attachment.fileName || "")).length;
    const mimeBytes = encoder.encode(String(attachment.mimeType || "")).length;
    return total + estimateBase64Length(attachment.size) + filenameBytes + mimeBytes + 256;
  }, messageBytes + 2048);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function sanitizeFilename(name) {
  return (name || "file")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "file";
}

export async function buildNativeOpenClawAttachments(env, fileIds = [], options = {}) {
  const bindingError = requireFilesBindings(env);
  if (bindingError) {
    return {
      ok: false,
      error: bindingError,
      code: "attachment_storage_unavailable"
    };
  }

  const uniqueIds = [...new Set((Array.isArray(fileIds) ? fileIds : [])
    .map(id => String(id || "").trim())
    .filter(Boolean))];
  if (!uniqueIds.length) {
    return {
      ok: true,
      attachments: [],
      totalBytes: 0,
      estimatedPayloadBytes: estimateNativeAttachmentPayloadBytes(options.message || "", [])
    };
  }
  if (uniqueIds.length > NATIVE_ATTACHMENT_LIMITS.maxAttachments) {
    return {
      ok: false,
      error: "Too many native attachments",
      code: "attachment_too_many"
    };
  }

  const conversationId = String(options.conversationId || "").trim();
  const attachments = [];
  let totalBytes = 0;

  for (const fileId of uniqueIds) {
    const file = await env.DB.prepare(
      `SELECT id, conversation_id, filename, content_type, size, r2_key, created_at
       FROM files
       WHERE id = ?`
    ).bind(fileId).first();

    if (!file) {
      return {
        ok: false,
        error: "Attachment file not found",
        code: "attachment_not_found",
        file_id: fileId
      };
    }

    const ownerConversationId = String(file.conversation_id || "").trim();
    if (ownerConversationId && conversationId && ownerConversationId !== conversationId) {
      return {
        ok: false,
        error: "Attachment is outside the current conversation scope",
        code: "attachment_permission_denied",
        file_id: fileId
      };
    }

    const filename = sanitizeFilename(file.filename);
    const mimeType = normalizeMimeForNativeAttachment(file.content_type, filename);
    if (!nativeAttachmentAllowed(mimeType)) {
      return {
        ok: false,
        error: "Attachment type is not supported",
        code: "attachment_type_not_supported",
        file_id: fileId,
        mime_type: mimeType
      };
    }

    const size = Number(file.size || 0);
    const maxBytes = mimeType.startsWith("image/")
      ? NATIVE_ATTACHMENT_LIMITS.maxImageBytes
      : NATIVE_ATTACHMENT_LIMITS.maxFileBytes;
    if (size > maxBytes) {
      return {
        ok: false,
        error: "Attachment is too large",
        code: "attachment_too_large",
        file_id: fileId,
        size,
        max_size: maxBytes
      };
    }

    totalBytes += size;
    if (totalBytes > NATIVE_ATTACHMENT_LIMITS.maxTotalRawBytes) {
      return {
        ok: false,
        error: "Native attachment total size is too large",
        code: "attachment_total_too_large",
        total_size: totalBytes,
        max_total_size: NATIVE_ATTACHMENT_LIMITS.maxTotalRawBytes
      };
    }

    const object = await env.FILES_BUCKET.get(file.r2_key);
    if (!object) {
      return {
        ok: false,
        error: "Attachment object not found",
        code: "attachment_not_found",
        file_id: fileId
      };
    }

    let contentBase64 = "";
    try {
      contentBase64 = bytesToBase64(new Uint8Array(await object.arrayBuffer()));
    } catch (err) {
      return {
        ok: false,
        error: "Attachment base64 encoding failed",
        code: "attachment_base64_failed",
        file_id: fileId
      };
    }

    attachments.push({
      type: "file",
      source: "web_ai_assistant_native_attachment",
      fileId: file.id,
      file_id: file.id,
      fileName: filename,
      file_name: filename,
      filename,
      mimeType,
      mime_type: mimeType,
      size,
      contentBase64,
      content_base64: contentBase64
    });
  }

  const estimatedPayloadBytes = estimateNativeAttachmentPayloadBytes(options.message || "", attachments);
  if (estimatedPayloadBytes > NATIVE_ATTACHMENT_LIMITS.maxEstimatedPayloadBytes) {
    return {
      ok: false,
      error: "Estimated OpenClaw Gateway payload is too large",
      code: "gateway_payload_too_large",
      estimated_payload_bytes: estimatedPayloadBytes,
      max_estimated_payload_bytes: NATIVE_ATTACHMENT_LIMITS.maxEstimatedPayloadBytes
    };
  }

  return {
    ok: true,
    attachments,
    totalBytes,
    estimatedPayloadBytes,
    mimeTypes: attachments.map(attachment => attachment.mimeType)
  };
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
      `SELECT id, conversation_id, filename, content_type, size, r2_key, text_content
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
          size: file.size || null,
          r2Key: file.r2_key || "",
          conversationId: file.conversation_id || "",
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
        size: file.size || null,
        r2Key: file.r2_key || "",
        conversationId: file.conversation_id || "",
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
        size: file.size || null,
        r2Key: file.r2Key || "",
        conversationId: file.conversationId || "",
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

    const chunkCount = await saveFileChunks(env.DB, id, textContent);

    return jsonResponse({
      ok: true,
      file: {
        id,
        filename,
        content_type: file.type || "application/octet-stream",
        size: file.size,
        created_at: createdAt,
        chunk_count: chunkCount
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/api/files") {
    const q = (url.searchParams.get("q") || "").trim();
    const like = "%" + q + "%";
    const result = await env.DB.prepare(
      `SELECT
         f.id,
         f.conversation_id,
         f.filename,
         f.content_type,
         f.size,
         f.created_at,
         (
           SELECT COUNT(*)
           FROM file_chunks fc
           WHERE fc.file_id = f.id
         ) AS chunk_count
       FROM files f
       WHERE (? = '' OR f.filename LIKE ? OR f.text_content LIKE ?)
       ORDER BY f.created_at DESC
       LIMIT 50`
    ).bind(q, like, like).all();

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

  const chunksMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/chunks$/);

  if (request.method === "GET" && chunksMatch) {
    const file = await env.DB.prepare(
      `SELECT id, filename, content_type, size, created_at
       FROM files
       WHERE id = ?`
    ).bind(chunksMatch[1]).first();

    if (!file) {
      return jsonResponse({
        ok: false,
        error: "file not found"
      }, 404);
    }

    const chunks = await env.DB.prepare(
      `SELECT
         chunk_index,
         substr(content, 1, 300) AS content_preview,
         length(content) AS length
       FROM file_chunks
       WHERE file_id = ?
       ORDER BY chunk_index ASC`
    ).bind(file.id).all();

    return jsonResponse({
      ok: true,
      file,
      chunks: chunks.results || []
    });
  }

  const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);

  if (request.method === "GET" && fileMatch) {
    const file = await env.DB.prepare(
      `SELECT
         f.id,
         f.conversation_id,
         f.filename,
         f.content_type,
         f.size,
         f.r2_key,
         f.created_at,
         substr(COALESCE(f.text_content, ''), 1, 1000) AS text_preview,
         (
           SELECT COUNT(*)
           FROM file_chunks fc
           WHERE fc.file_id = f.id
         ) AS chunk_count
       FROM files f
       WHERE f.id = ?`
    ).bind(fileMatch[1]).first();

    if (!file) {
      return jsonResponse({
        ok: false,
        error: "file not found"
      }, 404);
    }

    return jsonResponse({
      ok: true,
      file
    });
  }

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
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM file_chunks WHERE file_id = ?"
      ).bind(file.id),
      env.DB.prepare(
        "DELETE FROM files WHERE id = ?"
      ).bind(file.id)
    ]);

    return jsonResponse({
      ok: true
    });
  }

  return null;
}
