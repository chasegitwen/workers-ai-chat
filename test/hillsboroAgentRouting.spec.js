import { describe, expect, it, vi } from "vitest";
import { handleChat } from "../src/api/chat.js";
import { htmlPage } from "../src/frontend/page.js";

const runtime = {
  id: "hillsboro-openclaw",
  display_name: "Hillsboro OpenClaw",
  slug: "hillsboro-openclaw",
  provider_id: "openclaw-hillsboro",
  base_url: "https://hill.hnsnowground.cfd/v1",
  callback_url: "",
  capabilities_json: JSON.stringify({ bridge_callback: true, progress_callback: true }),
  agents_json: JSON.stringify([
    { agent_id: "main" },
    { agent_id: "glm51" },
    { agent_id: "glm5-2" },
    { agent_id: "kimi-for-coding" }
  ]),
  bridge_mode: "bridge",
  status: "verified",
  is_enabled: 1,
  last_verified_at: "2026-10-17T00:00:00.000Z",
  created_at: "2026-10-17T00:00:00.000Z",
  updated_at: "2026-10-17T00:00:00.000Z"
};

const bindingRow = {
  project_id: "default",
  runtime_id: "hillsboro-openclaw",
  binding_is_default: 1,
  binding_is_enabled: 1,
  allowed_agents_json: JSON.stringify(["main", "glm51", "glm5-2", "kimi-for-coding"]),
  default_agent_id: "main",
  binding_created_at: "2026-10-17T00:00:00.000Z",
  binding_updated_at: "2026-10-17T00:00:00.000Z",
  ...runtime
};

const provider = {
  id: "openclaw-hillsboro",
  label: "Hillsboro OpenClaw",
  providerType: "openai-compatible",
  apiBase: "https://hill.hnsnowground.cfd/v1",
  apiKeyEnv: "OPENCLAW_HILLSBORO_API_KEY",
  openclawExecutionMode: "bridge",
  models: [{
    id: "hillsboro-carrier",
    label: "Hillsboro OpenClaw",
    modelName: "openclaw/main",
    providerType: "openai-compatible",
    enabled: true
  }]
};

const catalog = {
  providerId: "openclaw-hillsboro",
  runtimeId: "hillsboro-openclaw",
  source: "gateway_rpc",
  agents: [
    { id: "main", defaultModel: "openai/gpt-5.6-terra" },
    { id: "glm", defaultModel: "zai/glm-5.2" },
    { id: "kimi", defaultModel: "kimi/kimi-for-coding" }
  ],
  models: [
    { id: "openai/gpt-5.6-terra", available: true },
    { id: "zai/glm-5.1", available: true },
    { id: "zai/glm-5.2", available: true },
    { id: "kimi/kimi-for-coding", available: true }
  ],
  modelsByAgent: {
    main: [{ id: "openai/gpt-5.6-terra", available: true }],
    glm: [
      { id: "zai/glm-5.1", available: true },
      { id: "zai/glm-5.2", available: true }
    ],
    kimi: [{ id: "kimi/kimi-for-coding", available: true }]
  },
  defaultAgentId: "main",
  modelView: "configured",
  syncedAt: Date.now()
};

class FakeDb {
  constructor() {
    this.settings = new Map([
      ["model_settings", JSON.stringify({
        providers: [provider],
        openClawInstances: [{
          id: "openclaw-hillsboro",
          label: "Hillsboro OpenClaw",
          targetId: "hillsboro",
          connectionId: "openclaw-hillsboro"
        }]
      })],
      ["openclaw_catalog_hillsboro_v1", JSON.stringify(catalog)]
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
        if (text.includes("FROM project_openclaw_runtime_bindings b")) return { ...bindingRow };
        if (text.includes("FROM openclaw_runtimes") && !text.includes("JOIN")) return { ...runtime };
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
        if (String(sql).includes("settings") && bindings.length >= 2) {
          db.settings.set(bindings[0], bindings[1]);
        }
        return { success: true, meta: { changes: 1 } };
      }
    };
  }

  async batch(statements) {
    return Promise.all(statements.map(statement => statement.run()));
  }
}

function requestBody(agentId, baseModelId) {
  return {
    conversationId: "hillsboro-agent-route-" + agentId + "-" + (baseModelId || "default"),
    messages: [{ role: "user", content: "route verification" }],
    selection_mode: "openclaw-agent",
    instance_id: "openclaw-hillsboro",
    provider: "openclaw-hillsboro",
    model: "hillsboro-carrier",
    runtime_id: "hillsboro-openclaw",
    agent_id: agentId,
    base_model_id: baseModelId || undefined,
    providers: [provider]
  };
}

describe("Hillsboro Agent routing", () => {
  it.each([
    ["main", "", "main", ""],
    ["glm", "", "glm", ""],
    ["glm", "zai/glm-5.1", "glm", "zai/glm-5.1"],
    ["kimi", "kimi/kimi-for-coding", "kimi", "kimi/kimi-for-coding"],
    ["glm51", "", "glm", ""],
    ["glm5-2", "zai/glm-5.1", "glm", "zai/glm-5.1"],
    ["kimi-for-coding", "kimi/kimi-for-coding", "kimi", "kimi/kimi-for-coding"]
  ])("routes agent %s with base model %s to Bridge agent %s", async (agentId, baseModelId, expectedAgent, expectedBaseModel) => {
    const bridgeBodies = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (!String(url).endsWith("/v1/openclaw/tasks")) throw new Error("unexpected request: " + url);
      const body = JSON.parse(init.body);
      bridgeBodies.push(body);
      return new Response(JSON.stringify({
        task_id: "bridge-task-" + bridgeBodies.length,
        status: "running",
        agent_id: body.agent_id,
        requested_base_model_id: body.base_model_id || ""
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    }));
    const env = {
      DB: new FakeDb(),
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test",
      OPENCLAW_BRIDGE_TOKEN: "server-only",
      OPENCLAW_HILLSBORO_API_KEY: "server-only"
    };

    const response = await handleChat(new Request("https://app.example/api/chat", {
      method: "POST",
      body: JSON.stringify(requestBody(agentId, baseModelId))
    }), env, { waitUntil() {} });
    const responseText = await response.text();

    expect(response.status, responseText).toBe(202);
    expect(bridgeBodies).toHaveLength(1);
    expect(bridgeBodies[0].agent_id).toBe(expectedAgent);
    expect(bridgeBodies[0].session_key).toContain("agent:" + expectedAgent + ":");
    expect(bridgeBodies[0].base_model_id).toBe(expectedBaseModel);
  });

  it.each([
    ["main", "zai/glm-5.2"],
    ["glm", "openai/gpt-5.6-terra"],
    ["kimi", "zai/glm-5.1"]
  ])("rejects Agent %s with model %s outside its policy", async (agentId, baseModelId) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: new FakeDb(),
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test",
      OPENCLAW_BRIDGE_TOKEN: "server-only",
      OPENCLAW_HILLSBORO_API_KEY: "server-only"
    };

    const response = await handleChat(new Request("https://app.example/api/chat", {
      method: "POST",
      body: JSON.stringify(requestBody(agentId, baseModelId))
    }), env, { waitUntil() {} });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_openclaw_selection" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("migrates saved Hillsboro Agent preferences without changing Seattle IDs", () => {
    const script = htmlPage().match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
    const declaration = script.match(/function normalizeHillsboroAgentId\([\s\S]*?\n\}/)?.[0] || "";
    const normalize = new Function(declaration + "; return normalizeHillsboroAgentId;")();

    expect(normalize("glm51")).toBe("glm");
    expect(normalize("glm5-2")).toBe("glm");
    expect(normalize("kimi-for-coding")).toBe("kimi");
    expect(script).toContain('instance?.catalogId === "hillsboro"');
    expect(script).toContain(': storedAgentId;');
  });
});
