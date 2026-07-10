import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenClawBridgeFileAttachments,
  buildOpenClawBridgeMessageWithFiles
} from "../src/api/chat.js";
import { openclawBridgeClient } from "../src/api/openclawBridgeClient.js";
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
  constructor() {
    this.objects = new Map();
  }

  async put(key, value, options = {}) {
    const arrayBuffer = await new Response(value).arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    this.objects.set(key, {
      arrayBuffer,
      text,
      options
    });
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      arrayBuffer: async () => object.arrayBuffer
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Native Bridge uploaded document visibility", () => {
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
});
