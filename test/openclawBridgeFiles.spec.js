import { describe, expect, it } from "vitest";
import {
  buildOpenClawBridgeFileAttachments,
  buildOpenClawBridgeMessageWithFiles,
  buildOpenClawBridgeMessageWithNativeAttachments
} from "../src/api/chat.js";

const storedChunk = {
  id: "chunk-1",
  fileId: "file-1",
  filename: "incident-report.md",
  contentType: "text/markdown",
  size: 1234,
  r2Key: "files/file-1/incident-report.md",
  conversationId: "conversation-1",
  chunkIndex: 0,
  content: "OpenClaw must be able to read this uploaded report content.",
  score: 7
};

describe("OpenClaw Bridge file attachments", () => {
  it("builds Common Chat Native Bridge payload with uploaded file metadata and readable chunks", () => {
    const files = buildOpenClawBridgeFileAttachments({
      fileChunks: [storedChunk],
      conversationId: "conversation-1",
      projectId: "default",
      runtimeId: "hillsboro-openclaw"
    });

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      type: "file",
      source: "web_ai_assistant_file_library",
      file_id: "file-1",
      filename: "incident-report.md",
      mime_type: "text/markdown",
      r2_key: "files/file-1/incident-report.md",
      conversation_id: "conversation-1",
      project_id: "default",
      runtime_id: "hillsboro-openclaw",
      access: {
        mode: "inline_chunks",
        r2_key: "files/file-1/incident-report.md"
      }
    });
    expect(files[0].chunks[0]).toMatchObject({
      chunk_index: 0,
      content: "OpenClaw must be able to read this uploaded report content."
    });

    const message = buildOpenClawBridgeMessageWithFiles("Analyze the attached report.", files);
    expect(message).toContain("The following uploaded files are attached to this task");
    expect(message).toContain("not in the OpenClaw workspace");
    expect(message).toContain("incident-report.md");
    expect(message).toContain("files/file-1/incident-report.md");
    expect(message).toContain("OpenClaw must be able to read this uploaded report content.");
  });

  it("builds Project Chat Native Bridge payload with project scope and inline upload text", () => {
    const files = buildOpenClawBridgeFileAttachments({
      file: {
        id: "file-2",
        name: "project-plan.txt",
        type: "text/plain",
        text: "Project-scoped uploaded file content for OpenClaw."
      },
      fileChunks: [{
        ...storedChunk,
        fileId: "file-2",
        filename: "project-plan.txt",
        contentType: "text/plain",
        r2Key: "files/file-2/project-plan.txt",
        conversationId: "conversation-project"
      }],
      conversationId: "conversation-project",
      projectId: "project-alpha",
      runtimeId: "hillsboro-openclaw"
    });

    expect(files.map(file => file.source)).toEqual([
      "web_ai_assistant_inline_upload",
      "web_ai_assistant_file_library"
    ]);
    expect(files[0]).toMatchObject({
      file_id: "file-2",
      filename: "project-plan.txt",
      mime_type: "text/plain",
      content_text: "Project-scoped uploaded file content for OpenClaw.",
      project_id: "project-alpha",
      runtime_id: "hillsboro-openclaw",
      access: {
        mode: "inline_text"
      }
    });
    expect(files[1]).toMatchObject({
      file_id: "file-2",
      r2_key: "files/file-2/project-plan.txt",
      project_id: "project-alpha",
      runtime_id: "hillsboro-openclaw"
    });
    expect(files[1].chunks[0].content).toContain("uploaded report content");
  });

  it("builds native attachment messages without legacy chunk or storage metadata", () => {
    const message = buildOpenClawBridgeMessageWithNativeAttachments(
      "Read the last page marker.",
      [{
        type: "file",
        fileId: "file-1",
        fileName: "vehicle-dynamics.pdf",
        mimeType: "application/pdf",
        size: 123,
        contentBase64: "cGRm"
      }, {
        type: "file",
        fileId: "file-1",
        fileName: "vehicle-dynamics.pdf",
        mimeType: "application/pdf",
        size: 123,
        contentBase64: "cGRm"
      }]
    );

    expect(message).toBe("Read the last page marker.");
    expect(message).not.toContain("vehicle-dynamics.pdf");
    expect(message).not.toContain("File 1");
    expect(message).not.toContain("File 2");
    expect(message).not.toContain("File ID");
    expect(message).not.toContain("Chunk 0");
    expect(message).not.toContain("Chunk 4");
    expect(message).not.toContain("R2");
    expect(message).not.toContain("R2 object key");
    expect(message).not.toContain("MIME type");
    expect(message).not.toContain("application/pdf");
    expect(message).not.toContain("OpenClaw must be able to read this uploaded report content.");
  });
});
