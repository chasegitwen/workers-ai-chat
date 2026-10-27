import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChat } from "../src/api/chat.js";

const runtime = {
  id: "oracle-openclaw",
  display_name: "Oracle OpenClaw",
  slug: "oracle-openclaw",
  provider_id: "openclaw-oracle",
  base_url: "https://oracle.example.test/v1",
  callback_url: "",
  capabilities_json: JSON.stringify({ bridge_callback: true, progress_callback: true }),
  agents_json: JSON.stringify([
    { agent_id: "main" },
    { agent_id: "glm" },
    { agent_id: "kimi" }
  ]),
  bridge_mode: "bridge",
  status: "verified",
  is_enabled: 1,
  last_verified_at: "2026-10-27T00:00:00.000Z",
  created_at: "2026-10-27T00:00:00.000Z",
  updated_at: "2026-10-27T00:00:00.000Z"
};

const bindingRow = {
  project_id: "default",
  runtime_id: "oracle-openclaw",
  binding_is_default: 0,
  binding_is_enabled: 1,
  allowed_agents_json: JSON.stringify(["main", "glm", "kimi"]),
  default_agent_id: "main",
  binding_created_at: "2026-10-27T00:00:00.000Z",
  binding_updated_at: "2026-10-27T00:00:00.000Z",
  ...runtime
};

const provider = {
  id: "openclaw-oracle",
  label: "Oracle OpenClaw",
  providerType: "openai-compatible",
  apiBase: "https://oracle.example.test/v1",
  openclawExecutionMode: "bridge",
  enabled: true,
  models: [{
    id: "openclaw-oracle-main",
    label: "Oracle OpenClaw",
    modelName: "openclaw/main",
    upstreamModelName: "openclaw/main",
    providerType: "openai-compatible",
    enabled: true
  }]
};

const bridgeCatalog = {
  defaultAgentId: "main",
  agents: [
    { id: "main", name: "Main", defaultModel: "openai/gpt-5.6-sol" },
    { id: "glm", name: "GLM", defaultModel: "zai/glm-5.2" },
    { id: "kimi", name: "Kimi", defaultModel: "kimi/kimi-for-coding" }
  ],
  modelsByAgent: {
    main: [{ id: "openai/gpt-5.6-sol", available: true, configured: true }],
    glm: [{ id: "zai/glm-5.2", available: true, configured: true }],
    kimi: [{ id: "kimi/kimi-for-coding", available: true, configured: true }]
  }
};

class FakeDb {
  constructor() {
    this.taskInserts = [];
    this.settings = new Map([
      ["model_settings", JSON.stringify({
        providers: [provider],
        openClawInstances: [{
          id: "openclaw-oracle",
          label: "Oracle OpenClaw",
          targetId: "oracle",
          connectionId: "openclaw-oracle"
        }]
      })]
    ]);
  }

  prepare(sql) {
    const db = this;
    const bindings = [];

    return {
      bind(...values) {
        bindings.splice(0, bindings.length, ...values);
        return this;
      },

      async first() {
        const text = String(sql);

        if (text.includes("FROM project_openclaw_runtime_bindings b")) {
          return { ...bindingRow };
        }

        if (text.includes("FROM openclaw_runtimes") && !text.includes("JOIN")) {
          return { ...runtime };
        }

        if (text.includes("settings")) {
          const value = db.settings.get(bindings[0]);
          return value === undefined ? null : { value };
        }

        return null;
      },

      async all() {
        if (String(sql).includes("FROM project_openclaw_runtime_bindings b")) {
          return { results: [{ ...bindingRow }] };
        }
        return { results: [] };
      },

      async run() {
        const text = String(sql);

        if (text.includes("settings") && bindings.length >= 2) {
          db.settings.set(bindings[0], bindings[1]);
        }

        if (text.includes("INSERT INTO openclaw_tasks")) {
          db.taskInserts.push([...bindings]);
        }

        return { success: true, meta: { changes: 1 } };
      }
    };
  }

  async batch(statements) {
    return Promise.all(statements.map(statement => statement.run()));
  }
}

function requestBody(agentId) {
  return {
    project_id: "default",
    conversationId: "oracle-agent-route-" + agentId,
    messages: [{ role: "user", content: "route verification" }],
    selection_mode: "openclaw-agent",
    instance_id: "openclaw-oracle",
    provider: "openclaw-oracle",
    model: "openclaw-oracle-main",
    runtime_id: "oracle-openclaw",
    agent_id: agentId,
    providers: [provider]
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Oracle Agent routing metadata", () => {
  it.each([
    ["main", "openclaw/main"],
    ["glm", "openclaw/glm"],
    ["kimi", "openclaw/kimi"]
  ])("stores and submits Oracle Bridge agent %s as %s", async (agentId, expectedRoute) => {
    const bridgeBodies = [];

    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const href = String(url);

      if (href.includes("/v1/openclaw/catalog")) {
        return new Response(JSON.stringify(bridgeCatalog), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (href.endsWith("/v1/openclaw/tasks")) {
        const body = JSON.parse(init.body);
        bridgeBodies.push(body);

        return new Response(JSON.stringify({
          task_id: "oracle-bridge-task-" + agentId,
          status: "running",
          agent_id: body.agent_id,
          requested_base_model_id: body.base_model_id || ""
        }), {
          status: 202,
          headers: { "Content-Type": "application/json" }
        });
      }

      throw new Error("unexpected request: " + href);
    }));

    const db = new FakeDb();
    const env = {
      DB: db,
      ORACLE_OPENCLAW_BRIDGE_URL: "https://oracle-bridge.example.test",
      ORACLE_OPENCLAW_BRIDGE_TOKEN: "oracle-token"
    };

    const response = await handleChat(new Request("https://app.example/api/chat", {
      method: "POST",
      body: JSON.stringify(requestBody(agentId))
    }), env, { waitUntil() {} });

    const responseText = await response.text();

    expect(response.status, responseText).toBe(202);
    expect(bridgeBodies).toHaveLength(1);
    expect(bridgeBodies[0].agent_id).toBe(agentId);
    expect(bridgeBodies[0].session_key).toContain("agent:" + agentId + ":");

    expect(db.taskInserts).toHaveLength(1);

    const insertedTask = db.taskInserts[0];

    expect(insertedTask[2]).toBe("openclaw-oracle");
    expect(insertedTask[3]).toBe("openclaw-oracle-main");
    expect(insertedTask[4]).toBe(expectedRoute);
    expect(insertedTask[10]).toBe("oracle-openclaw");
    expect(insertedTask[12]).toBe(agentId);
  });
});