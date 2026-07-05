import { describe, expect, it } from "vitest";
import { createOpenClawTask } from "../src/api/chat.js";

class CaptureStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async run() {
    this.db.lastSql = this.sql;
    this.db.lastBindings = this.bindings;
    return {
      success: true,
      meta: { changes: 1 }
    };
  }
}

class CaptureD1 {
  prepare(sql) {
    return new CaptureStatement(this, sql);
  }
}

describe("OpenClaw task runtime audit fields", () => {
  it("persists project runtime resolution fields on new OpenClaw tasks", async () => {
    const db = new CaptureD1();

    const task = await createOpenClawTask({
      DB: db
    }, {
      conversationId: "conversation-runtime-audit",
      projectId: "default",
      runtimeId: "hillsboro-openclaw",
      runtimeSlug: "hillsboro-openclaw",
      agentId: "glm51",
      executionMode: "bridge",
      runtimeResolutionSource: "project_default",
      runtimeResolutionWarnings: [],
      provider: "openclaw-hillsboro",
      model: "openclaw-hillsboro-glm51",
      upstreamModelName: "openclaw/glm51",
      prompt: "hello"
    });

    expect(task).toMatchObject({
      projectId: "default",
      runtimeId: "hillsboro-openclaw",
      runtimeSlug: "hillsboro-openclaw",
      selectedAgentId: "glm51",
      executionMode: "bridge",
      runtimeResolutionSource: "project_default"
    });
    expect(db.lastSql).toContain("project_id");
    expect(db.lastSql).toContain("runtime_id");
    expect(db.lastSql).toContain("runtime_resolution_source");
    expect(db.lastBindings).toContain("hillsboro-openclaw");
    expect(db.lastBindings).toContain("project_default");
  });
});
