import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenClawBridgeFileAttachments,
  buildOpenClawBridgeMessageWithFiles,
  handleChat
} from "../src/api/chat.js";
import { openclawBridgeClient } from "../src/api/openclawBridgeClient.js";
import {
  buildNativeOpenClawConversationAttachments,
  handleConversationAttachments
} from "../src/api/conversationAttachments.js";
import {
  buildNativeOpenClawAttachments,
  getRelevantFileChunksByIds,
  handleFiles
} from "../src/api/files.js";

class FileStatement {
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

class FileD1 {
  constructor() {
    this.files = new Map();
    this.chunks = [];
  }

  prepare(sql) {
    return new FileStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      await statement.run();
    }
    return statements.map(() => ({ success: true }));
  }

  normalize(sql) {
    return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  run(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.startsWith("insert into files")) {
      const [id, conversationId, filename, contentType, size, r2Key, textContent, createdAt] = bindings;
      this.files.set(id, {
        id,
        conversation_id: conversationId,
        filename,
        content_type: contentType,
        size,
        r2_key: r2Key,
        text_content: textContent,
        created_at: createdAt
      });
      return;
    }
    if (normalized.startsWith("insert into file_chunks")) {
      const [id, fileId, chunkIndex, content] = bindings;
      this.chunks.push({
        id,
        file_id: fileId,
        chunk_index: chunkIndex,
        content
      });
    }
  }

  first(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from files") && normalized.includes("where id = ?")) {
      return this.files.get(bindings[0]) || null;
    }
    return null;
  }

  all(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from file_chunks") && normalized.includes("where file_id = ?")) {
      return this.chunks
        .filter(chunk => chunk.file_id === bindings[0])
        .sort((a, b) => a.chunk_index - b.chunk_index);
    }
    return [];
  }
}

class MemoryR2Bucket {
  constructor(options = {}) {
    this.objects = new Map();
    this.options = options;
    this.deletedKeys = [];
  }

  async put(key, value, options = {}) {
    if (this.options.failPut) {
      throw new Error("simulated R2 put failure");
    }
    const arrayBuffer = await new Response(value).arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    this.objects.set(key, {
      arrayBuffer,
      text,
      options,
      size: arrayBuffer.byteLength,
      httpMetadata: options.httpMetadata || {}
    });
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      size: object.size,
      httpMetadata: object.httpMetadata,
      arrayBuffer: async () => object.arrayBuffer
    };
  }

  async delete(key) {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
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

async function signAttachmentPayload(payload, secret = "session-secret") {
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
    new TextEncoder().encode(payload)
  );
  return base64UrlEncode(new Uint8Array(signature));
}

async function testAttachmentId(descriptor, secret = "session-secret") {
  const payload = base64UrlEncode(JSON.stringify(descriptor));
  const signature = await signAttachmentPayload(payload, secret);
  return ["ca_v1", payload, signature].join(".");
}

describe("Native Bridge uploaded document visibility", () => {
  it("uploads conversation attachments to R2 without creating KB files or chunks", async () => {
    const db = new FileD1();
    const bucket = new MemoryR2Bucket();
    const env = {
      DB: db,
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };

    const content = "CONVERSATION_ATTACHMENT_ORIGINAL_BYTES";
    const form = new FormData();
    form.set("file", new File([content], "original.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-1");

    const uploadResponse = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const upload = await uploadResponse.json();

    expect(upload.ok).toBe(true);
    expect(upload.attachment.id).toBeTruthy();
    expect(upload.attachment.id).not.toContain("conversation-attachments");
    expect(bucket.objects.size).toBe(1);
    expect(db.files.size).toBe(0);
    expect(db.chunks).toHaveLength(0);

    const result = await buildNativeOpenClawConversationAttachments(env, [upload.attachment.id], {
      draftId: "draft-1",
      message: "read original"
    });

    expect(result.ok).toBe(true);
    expect(result.attachments[0]).toMatchObject({
      type: "file",
      source: "web_ai_assistant_conversation_attachment",
      fileName: "original.txt",
      mimeType: "text/plain",
      size: content.length
    });
    expect(atob(result.attachments[0].contentBase64)).toBe(content);
  });

  it("rejects conversation attachment IDs outside the current draft scope", async () => {
    const bucket = new MemoryR2Bucket();
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };

    const form = new FormData();
    form.set("file", new File(["scoped bytes"], "scoped.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-owned");

    const uploadResponse = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const upload = await uploadResponse.json();

    const result = await buildNativeOpenClawConversationAttachments(env, [upload.attachment.id], {
      draftId: "draft-other",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_permission_denied"
    });
  });

  it("rejects oversized conversation attachment uploads before writing R2", async () => {
    const bucket = new MemoryR2Bucket();
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };
    const form = new FormData();
    form.set("file", new File([new Uint8Array(6 * 1024 * 1024 + 1)], "huge.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-oversize");

    const response = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      code: "attachment_too_large"
    });
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects unsupported conversation attachment MIME before writing R2", async () => {
    const bucket = new MemoryR2Bucket();
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };
    const form = new FormData();
    form.set("file", new File(["video"], "clip.mp4", { type: "video/mp4" }));
    form.set("draft_id", "draft-video");

    const response = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      code: "attachment_type_not_supported"
    });
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects conversation attachment uploads without a signing secret before writing R2", async () => {
    const bucket = new MemoryR2Bucket();
    const env = {
      FILES_BUCKET: bucket
    };
    const form = new FormData();
    form.set("file", new File(["secret missing"], "secret.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-secret");

    const response = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      code: "attachment_secret_missing"
    });
    expect(bucket.objects.size).toBe(0);
  });

  it("returns a structured error when conversation attachment R2 put fails", async () => {
    const bucket = new MemoryR2Bucket({ failPut: true });
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };
    const form = new FormData();
    form.set("file", new File(["r2 fail"], "r2.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-r2");

    const response = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      code: "attachment_r2_put_failed"
    });
  });

  it("cleans up the R2 object when post-write token generation fails", async () => {
    const bucket = new MemoryR2Bucket();
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };
    const signSpy = vi.spyOn(crypto.subtle, "sign").mockRejectedValueOnce(new Error("token failure"));
    const form = new FormData();
    form.set("file", new File(["token fail"], "token.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-token");

    const response = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const body = await response.json();

    expect(signSpy).toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      code: "attachment_token_failed"
    });
    expect(bucket.deletedKeys).toHaveLength(1);
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects tampered conversation attachment IDs", async () => {
    const bucket = new MemoryR2Bucket();
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };
    const form = new FormData();
    form.set("file", new File(["tamper"], "tamper.txt", { type: "text/plain" }));
    form.set("draft_id", "draft-tamper");
    const uploadResponse = await handleConversationAttachments(new Request("http://example.com/api/conversation-attachments/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/conversation-attachments/upload"));
    const upload = await uploadResponse.json();
    const tampered = upload.attachment.id.replace(/.$/, char => char === "a" ? "b" : "a");

    const result = await buildNativeOpenClawConversationAttachments(env, [tampered], {
      draftId: "draft-tamper",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_id_invalid"
    });
  });

  it("rejects expired conversation attachment IDs", async () => {
    const env = {
      FILES_BUCKET: new MemoryR2Bucket(),
      SESSION_SECRET: "session-secret"
    };
    const attachmentId = await testAttachmentId({
      id: "expired",
      draft_id: "draft-expired",
      filename: "expired.txt",
      content_type: "text/plain",
      normalized_mime_type: "text/plain",
      size: 1,
      r2_key: "conversation-attachments/draft/draft-expired/expired/expired.txt",
      created_at: "2000-01-01T00:00:00.000Z"
    });

    const result = await buildNativeOpenClawConversationAttachments(env, [attachmentId], {
      draftId: "draft-expired",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_id_expired"
    });
  });

  it("rejects signed attachment IDs with non-controlled R2 key prefixes", async () => {
    const env = {
      FILES_BUCKET: new MemoryR2Bucket(),
      SESSION_SECRET: "session-secret"
    };
    const attachmentId = await testAttachmentId({
      id: "bad-prefix",
      draft_id: "draft-prefix",
      filename: "prefix.txt",
      content_type: "text/plain",
      normalized_mime_type: "text/plain",
      size: 1,
      r2_key: "files/bad-prefix/prefix.txt",
      created_at: new Date().toISOString()
    });

    const result = await buildNativeOpenClawConversationAttachments(env, [attachmentId], {
      draftId: "draft-prefix",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_r2_key_invalid"
    });
  });

  it("rejects attachments whose actual R2 byte length exceeds the limit", async () => {
    const bucket = new MemoryR2Bucket();
    const r2Key = "conversation-attachments/draft/draft-big/big/big.txt";
    bucket.objects.set(r2Key, {
      arrayBuffer: new Uint8Array(6 * 1024 * 1024 + 1).buffer,
      httpMetadata: {}
    });
    const env = {
      FILES_BUCKET: bucket,
      SESSION_SECRET: "session-secret"
    };
    const attachmentId = await testAttachmentId({
      id: "big",
      draft_id: "draft-big",
      filename: "big.txt",
      content_type: "text/plain",
      normalized_mime_type: "text/plain",
      size: 1,
      r2_key: r2Key,
      created_at: new Date().toISOString()
    });

    const result = await buildNativeOpenClawConversationAttachments(env, [attachmentId], {
      draftId: "draft-big",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_too_large"
    });
  });

  it("rejects mixing conversation attachments with knowledge base file IDs in one chat request", async () => {
    const response = await handleChat(new Request("http://example.com/", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "read both" }],
        provider: "workers-ai",
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        conversationAttachmentIds: ["ca_v1.payload.signature"],
        fileIds: ["kb-file-1"]
      })
    }), {}, {
      waitUntil() {}
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: "conversation_attachment_kb_mix_unsupported",
      message: "原文附件与知识库文件暂不能在同一条消息中同时使用。"
    });
  });

  it("rejects conversation attachments for models without native attachment support", async () => {
    const response = await handleChat(new Request("http://example.com/", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "read original" }],
        provider: "workers-ai",
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        conversationAttachmentIds: ["ca_v1.payload.signature"],
        draftId: "draft-unsupported"
      })
    }), {}, {
      waitUntil() {}
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: "native_attachment_unsupported",
      message: "当前模型不支持原文附件。"
    });
  });

  it("uploads a real document to Web AI Assistant storage and submits readable content to Bridge", async () => {
    const db = new FileD1();
    const bucket = new MemoryR2Bucket();
    const env = {
      DB: db,
      FILES_BUCKET: bucket,
      OPENCLAW_BRIDGE_MODE: "true",
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test",
      OPENCLAW_BRIDGE_TOKEN: "secret-token"
    };

    const content = "Cloudflare-side uploaded document. OpenClaw can only see this if Web AI Assistant injects it.";
    const form = new FormData();
    form.set("file", new File([content], "cloudflare-upload.txt", { type: "text/plain" }));
    form.set("conversation_id", "conversation-upload");

    const uploadResponse = await handleFiles(new Request("http://example.com/api/files/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/files/upload"));
    const upload = await uploadResponse.json();

    expect(upload.ok).toBe(true);
    expect(bucket.objects.size).toBe(1);

    const chunks = await getRelevantFileChunksByIds(env, [upload.file.id], "analyze upload", {
      perFileLimit: 5,
      totalLimit: 5
    });
    const fileAttachments = buildOpenClawBridgeFileAttachments({
      fileChunks: chunks,
      conversationId: "conversation-upload",
      projectId: "default",
      runtimeId: "hillsboro-openclaw"
    });
    const bridgeMessage = buildOpenClawBridgeMessageWithFiles("Analyze the uploaded document.", fileAttachments);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      task_id: "bridge-upload-task",
      status: "running"
    }), {
      status: 202,
      headers: {
        "Content-Type": "application/json"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await openclawBridgeClient(env).createTask({
      conversationId: "conversation-upload",
      projectId: "default",
      runtimeId: "hillsboro-openclaw",
      message: bridgeMessage,
      sessionKey: "agent:main:conversation-upload",
      sessionId: "agent:main:conversation-upload",
      agentId: "main",
      attachments: fileAttachments,
      fileAttachments,
      idempotencyKey: "local-upload-task"
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.file_ids).toEqual([upload.file.id]);
    expect(body.files[0]).toMatchObject({
      filename: "cloudflare-upload.txt",
      mime_type: "text/plain",
      r2_key: "files/" + upload.file.id + "/cloudflare-upload.txt",
      conversation_id: "conversation-upload",
      project_id: "default",
      runtime_id: "hillsboro-openclaw"
    });
    expect(body.files[0].chunks[0].content).toContain("Cloudflare-side uploaded document");
    expect(body.message).toContain("The following uploaded files are attached to this task");
    expect(body.message).toContain("cloudflare-upload.txt");
    expect(body.message).toContain("Cloudflare-side uploaded document");
    expect(body.prompt).toBe(body.message);
  });

  it("builds native OpenClaw attachments from the original R2 object", async () => {
    const db = new FileD1();
    const bucket = new MemoryR2Bucket();
    const env = {
      DB: db,
      FILES_BUCKET: bucket
    };

    const content = "OPENCLAW_NATIVE_ATTACHMENT_BEGIN\nNATIVE_ATTACHMENT_PROBE_OK\nOPENCLAW_NATIVE_ATTACHMENT_END";
    const form = new FormData();
    form.set("file", new File([content], "native-probe.txt", { type: "text/plain" }));
    form.set("conversation_id", "conversation-native");

    const uploadResponse = await handleFiles(new Request("http://example.com/api/files/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/files/upload"));
    const upload = await uploadResponse.json();

    const result = await buildNativeOpenClawAttachments(env, [upload.file.id], {
      conversationId: "conversation-native",
      projectId: "default",
      runtimeId: "hillsboro-openclaw",
      message: "read original"
    });

    expect(result.ok).toBe(true);
    expect(result.attachments[0]).toMatchObject({
      type: "file",
      source: "web_ai_assistant_native_attachment",
      fileId: upload.file.id,
      fileName: "native-probe.txt",
      mimeType: "text/plain",
      size: content.length
    });
    expect(atob(result.attachments[0].contentBase64)).toBe(content);
    expect(result.attachments[0].contentBase64).not.toContain("NATIVE_ATTACHMENT_PROBE_OK");
  });

  it("rejects unsupported video native attachments", async () => {
    const db = new FileD1();
    const bucket = new MemoryR2Bucket();
    const env = {
      DB: db,
      FILES_BUCKET: bucket
    };

    const form = new FormData();
    form.set("file", new File(["not really video"], "clip.mp4", { type: "video/mp4" }));
    form.set("conversation_id", "conversation-native");
    const uploadResponse = await handleFiles(new Request("http://example.com/api/files/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/files/upload"));
    const upload = await uploadResponse.json();

    const result = await buildNativeOpenClawAttachments(env, [upload.file.id], {
      conversationId: "conversation-native",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_type_not_supported",
      mime_type: "video/mp4"
    });
  });

  it("rejects native attachments when the original R2 object is missing", async () => {
    const db = new FileD1();
    const bucket = new MemoryR2Bucket();
    const env = {
      DB: db,
      FILES_BUCKET: bucket
    };

    const form = new FormData();
    form.set("file", new File(["original bytes"], "missing-object.txt", { type: "text/plain" }));
    form.set("conversation_id", "conversation-native");
    const uploadResponse = await handleFiles(new Request("http://example.com/api/files/upload", {
      method: "POST",
      body: form
    }), env, new URL("http://example.com/api/files/upload"));
    const upload = await uploadResponse.json();
    bucket.objects.clear();

    const result = await buildNativeOpenClawAttachments(env, [upload.file.id], {
      conversationId: "conversation-native",
      message: "read original"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "attachment_not_found",
      file_id: upload.file.id
    });
    expect(result.attachments).toBeUndefined();
  });
});
