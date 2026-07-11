import { jsonResponse } from "../utils/response.js";
import {
  estimateBase64Length,
  NATIVE_ATTACHMENT_LIMITS
} from "./files.js";

const TOKEN_VERSION = "ca_v1";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const R2_PREFIX = "conversation-attachments/";

const MIME_EXTENSION = new Map([
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

const MIME_ALLOWLIST = new Set([
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

function cleanId(value) {
  return String(value || "").trim();
}

function fileExtension(filename) {
  const name = String(filename || "").toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function normalizeMime(contentType, filename) {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  return mime || MIME_EXTENSION.get(fileExtension(filename)) || "application/octet-stream";
}

function nativeAttachmentAllowed(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("video/")) {
    return false;
  }
  return mime.startsWith("image/")
    || mime.startsWith("audio/")
    || mime.startsWith("text/")
    || MIME_ALLOWLIST.has(mime);
}

function maxBytesForMime(mimeType) {
  return String(mimeType || "").toLowerCase().startsWith("image/")
    ? NATIVE_ATTACHMENT_LIMITS.maxImageBytes
    : NATIVE_ATTACHMENT_LIMITS.maxFileBytes;
}

function objectContentType(object) {
  return String(
    object?.httpMetadata?.contentType ||
    object?.httpMetadata?.content_type ||
    object?.customMetadata?.contentType ||
    object?.customMetadata?.content_type ||
    object?.contentType ||
    ""
  ).split(";")[0].trim().toLowerCase();
}

function objectSize(object) {
  const size = Number(object?.size ?? object?.httpMetadata?.contentLength ?? object?.httpMetadata?.content_length);
  return Number.isFinite(size) ? size : null;
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

function base64UrlEncode(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function tokenSecret(env) {
  // Prefer a dedicated production secret; SESSION_SECRET is a compatibility fallback.
  return String(
    env?.CONVERSATION_ATTACHMENT_SECRET ||
    env?.SESSION_SECRET ||
    ""
  ).trim();
}

function tokenSecretError(env) {
  return tokenSecret(env)
    ? ""
    : "CONVERSATION_ATTACHMENT_SECRET or SESSION_SECRET is not configured";
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(left || "");
  const b = new TextEncoder().encode(right || "");
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    diff |= (a[index] || 0) ^ (b[index] || 0);
  }
  return diff === 0;
}

async function encodeAttachmentId(env, descriptor) {
  const secret = tokenSecret(env);
  if (!secret) {
    return {
      ok: false,
      error: "CONVERSATION_ATTACHMENT_SECRET or SESSION_SECRET is not configured",
      code: "attachment_secret_missing"
    };
  }
  const payload = base64UrlEncode(JSON.stringify(descriptor));
  const signature = await sign(payload, secret);
  return {
    ok: true,
    id: [TOKEN_VERSION, payload, signature].join(".")
  };
}

async function decodeAttachmentId(env, attachmentId) {
  const secret = tokenSecret(env);
  if (!secret) {
    return {
      ok: false,
      error: "CONVERSATION_ATTACHMENT_SECRET or SESSION_SECRET is not configured",
      code: "attachment_secret_missing"
    };
  }

  const parts = String(attachmentId || "").split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return {
      ok: false,
      error: "Invalid attachment ID",
      code: "attachment_id_invalid"
    };
  }

  const expected = await sign(parts[1], secret);
  if (!timingSafeEqual(expected, parts[2])) {
    return {
      ok: false,
      error: "Invalid attachment ID signature",
      code: "attachment_id_invalid"
    };
  }

  try {
    const descriptor = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    const createdAtMs = Date.parse(descriptor.created_at || "");
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > TOKEN_TTL_MS) {
      return {
        ok: false,
        error: "Attachment ID expired",
        code: "attachment_id_expired"
      };
    }
    return {
      ok: true,
      descriptor
    };
  } catch (err) {
    return {
      ok: false,
      error: "Invalid attachment ID payload",
      code: "attachment_id_invalid"
    };
  }
}

function requireBucket(env) {
  return env?.FILES_BUCKET ? "" : "R2 binding FILES_BUCKET is not configured";
}

function estimateNativePayloadBytes(message, attachments) {
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(String(message || "")).length;
  return (Array.isArray(attachments) ? attachments : []).reduce((total, attachment) => {
    const filenameBytes = encoder.encode(String(attachment.fileName || "")).length;
    const mimeBytes = encoder.encode(String(attachment.mimeType || "")).length;
    return total + estimateBase64Length(attachment.size) + filenameBytes + mimeBytes + 256;
  }, messageBytes + 2048);
}

export async function handleConversationAttachments(request, env, url) {
  if (request.method !== "POST" || url.pathname !== "/api/conversation-attachments/upload") {
    return null;
  }

  const bindingError = requireBucket(env);
  if (bindingError) {
    return jsonResponse({
      ok: false,
      error: bindingError
    }, 500);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({
      ok: false,
      error: "file field is required"
    }, 400);
  }

  const conversationId = cleanId(form.get("conversation_id"));
  const draftId = cleanId(form.get("draft_id"));
  if (!conversationId && !draftId) {
    return jsonResponse({
      ok: false,
      error: "conversation_id or draft_id is required"
    }, 400);
  }

  const id = createId();
  const filename = sanitizeFilename(file.name);
  const mimeType = normalizeMime(file.type, filename);
  if (!nativeAttachmentAllowed(mimeType)) {
    return jsonResponse({
      ok: false,
      error: "Attachment type is not supported",
      code: "attachment_type_not_supported",
      mime_type: mimeType
    }, 400);
  }

  const maxBytes = maxBytesForMime(mimeType);
  if (Number(file.size || 0) > maxBytes) {
    return jsonResponse({
      ok: false,
      error: "Attachment is too large",
      code: "attachment_too_large",
      size: file.size,
      max_size: maxBytes
    }, 400);
  }

  const secretError = tokenSecretError(env);
  if (secretError) {
    return jsonResponse({
      ok: false,
      error: secretError,
      code: "attachment_secret_missing"
    }, 500);
  }

  const createdAt = new Date().toISOString();
  const ownerKind = conversationId ? "conversation" : "draft";
  const ownerId = conversationId || draftId;
  const r2Key = [
    R2_PREFIX.replace(/\/$/g, ""),
    ownerKind,
    encodeURIComponent(ownerId),
    id,
    filename
  ].join("/");

  const descriptor = {
    id,
    conversation_id: conversationId,
    draft_id: draftId,
    filename,
    content_type: mimeType,
    normalized_mime_type: mimeType,
    size: file.size,
    r2_key: r2Key,
    created_at: createdAt
  };

  try {
    await env.FILES_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: mimeType
      }
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: "Conversation attachment upload failed",
      code: "attachment_r2_put_failed",
      detail: err?.message || String(err)
    }, 502);
  }

  let encoded = null;
  try {
    encoded = await encodeAttachmentId(env, descriptor);
  } catch (err) {
    await env.FILES_BUCKET.delete(r2Key).catch(() => {});
    return jsonResponse({
      ok: false,
      error: "Conversation attachment token generation failed",
      code: "attachment_token_failed",
      detail: err?.message || String(err)
    }, 500);
  }
  if (!encoded.ok) {
    await env.FILES_BUCKET.delete(r2Key).catch(() => {});
    return jsonResponse({
      ok: false,
      error: encoded.error,
      code: encoded.code
    }, 500);
  }

  return jsonResponse({
    ok: true,
    attachment: {
      id: encoded.id,
      filename,
      content_type: mimeType,
      size: file.size,
      created_at: createdAt,
      draft_id: draftId || undefined,
      conversation_id: conversationId || undefined
    }
  });
}

export async function buildNativeOpenClawConversationAttachments(env, attachmentIds = [], options = {}) {
  const bindingError = requireBucket(env);
  if (bindingError) {
    return {
      ok: false,
      error: bindingError,
      code: "attachment_storage_unavailable"
    };
  }

  const uniqueIds = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : [])
    .map(id => String(id || "").trim())
    .filter(Boolean))];
  if (!uniqueIds.length) {
    return {
      ok: true,
      attachments: [],
      totalBytes: 0,
      estimatedPayloadBytes: estimateNativePayloadBytes(options.message || "", [])
    };
  }
  if (uniqueIds.length > NATIVE_ATTACHMENT_LIMITS.maxAttachments) {
    return {
      ok: false,
      error: "Too many native attachments",
      code: "attachment_too_many"
    };
  }

  const conversationId = cleanId(options.conversationId);
  const draftId = cleanId(options.draftId);
  const attachments = [];
  let totalBytes = 0;

  for (const attachmentId of uniqueIds) {
    const decoded = await decodeAttachmentId(env, attachmentId);
    if (!decoded.ok) {
      return decoded;
    }

    const descriptor = decoded.descriptor || {};
    const descriptorConversationId = cleanId(descriptor.conversation_id);
    const descriptorDraftId = cleanId(descriptor.draft_id);
    const conversationMatches = descriptorConversationId && conversationId && descriptorConversationId === conversationId;
    const draftMatches = descriptorDraftId && draftId && descriptorDraftId === draftId;
    if (!conversationMatches && !draftMatches) {
      return {
        ok: false,
        error: "Attachment is outside the current conversation scope",
        code: "attachment_permission_denied",
        attachment_id: descriptor.id || ""
      };
    }

    const filename = sanitizeFilename(descriptor.filename);
    const mimeType = normalizeMime(descriptor.normalized_mime_type || descriptor.content_type, filename);
    const r2Key = String(descriptor.r2_key || "");
    if (!r2Key.startsWith(R2_PREFIX)) {
      return {
        ok: false,
        error: "Attachment object key is outside the controlled prefix",
        code: "attachment_r2_key_invalid",
        attachment_id: descriptor.id || ""
      };
    }

    if (!nativeAttachmentAllowed(mimeType)) {
      return {
        ok: false,
        error: "Attachment type is not supported",
        code: "attachment_type_not_supported",
        attachment_id: descriptor.id || "",
        mime_type: mimeType
      };
    }

    const maxBytes = mimeType.startsWith("image/")
      ? NATIVE_ATTACHMENT_LIMITS.maxImageBytes
      : NATIVE_ATTACHMENT_LIMITS.maxFileBytes;
    const declaredSize = Number(descriptor.size || 0);
    if (declaredSize > maxBytes) {
      return {
        ok: false,
        error: "Attachment is too large",
        code: "attachment_too_large",
        attachment_id: descriptor.id || "",
        size: declaredSize,
        max_size: maxBytes
      };
    }

    const object = await env.FILES_BUCKET.get(r2Key);
    if (!object) {
      return {
        ok: false,
        error: "Attachment object not found",
        code: "attachment_not_found",
        attachment_id: descriptor.id || ""
      };
    }

    const metadataSize = objectSize(object);
    if (metadataSize !== null && metadataSize !== declaredSize) {
      return {
        ok: false,
        error: "Attachment object size does not match the signed descriptor",
        code: "attachment_size_mismatch",
        attachment_id: descriptor.id || "",
        size: metadataSize,
        expected_size: declaredSize
      };
    }

    const metadataContentType = objectContentType(object);
    if (metadataContentType && metadataContentType !== mimeType) {
      return {
        ok: false,
        error: "Attachment object content type does not match the signed descriptor",
        code: "attachment_type_mismatch",
        attachment_id: descriptor.id || "",
        mime_type: metadataContentType,
        expected_mime_type: mimeType
      };
    }

    let contentBase64 = "";
    let actualSize = 0;
    try {
      const bytes = new Uint8Array(await object.arrayBuffer());
      actualSize = bytes.byteLength;
      if (actualSize > maxBytes) {
        return {
          ok: false,
          error: "Attachment is too large",
          code: "attachment_too_large",
          attachment_id: descriptor.id || "",
          size: actualSize,
          max_size: maxBytes
        };
      }
      if (actualSize !== declaredSize) {
        return {
          ok: false,
          error: "Attachment object size does not match the signed descriptor",
          code: "attachment_size_mismatch",
          attachment_id: descriptor.id || "",
          size: actualSize,
          expected_size: declaredSize
        };
      }
      totalBytes += actualSize;
      if (totalBytes > NATIVE_ATTACHMENT_LIMITS.maxTotalRawBytes) {
        return {
          ok: false,
          error: "Native attachment total size is too large",
          code: "attachment_total_too_large",
          total_size: totalBytes,
          max_total_size: NATIVE_ATTACHMENT_LIMITS.maxTotalRawBytes
        };
      }
      contentBase64 = bytesToBase64(bytes);
    } catch (err) {
      return {
        ok: false,
        error: "Attachment base64 encoding failed",
        code: "attachment_base64_failed",
        attachment_id: descriptor.id || ""
      };
    }

    attachments.push({
      type: "file",
      source: "web_ai_assistant_conversation_attachment",
      attachmentId: descriptor.id || "",
      attachment_id: descriptor.id || "",
      fileName: filename,
      file_name: filename,
      filename,
      mimeType,
      mime_type: mimeType,
      size: actualSize,
      contentBase64,
      content_base64: contentBase64
    });
  }

  const estimatedPayloadBytes = estimateNativePayloadBytes(options.message || "", attachments);
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
