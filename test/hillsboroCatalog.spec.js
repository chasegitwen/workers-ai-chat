import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHillsboroOpenClawCatalog,
  normalizeHillsboroGatewayCatalog,
  validateHillsboroOpenClawSelection
} from "../src/api/hillsboroCatalog.js";
import { hillsboroAgentRoute, normalizeHillsboroAgentId } from "../src/api/hillsboroAgentRouting.js";

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              const value = rows.get(values[0]);
              return value === undefined ? null : { value };
            },
            async run() {
              rows.set(values[0], values[1]);
              return { success: true };
            }
          };
        }
      };
    }
  };
}

const upstreamCatalog = {
  agents: [
    { id: "main", name: "main", defaultModel: "openai/gpt-5.6-terra", secret: "hidden" },
    { id: "glm", name: "GLM", defaultModel: "zai/glm-5.2" },
    { id: "kimi", name: "Kimi", defaultModel: "kimi/kimi-for-coding" },
    { id: "glm51", name: "glm51", defaultModel: "zai/glm-5.1" },
    { id: "glm5-2", name: "glm5-2", defaultModel: "zai/glm-5.2" },
    { id: "kimi-for-coding", name: "kimi-for-coding", defaultModel: "kimi/kimi-for-coding" }
  ],
  models: [
    { id: "gpt-5.6-terra", provider: "openai", name: "GPT-5.6 Terra", available: true, manualSelectionAllowed: true },
    { id: "gpt-5.6-sol", provider: "openai", name: "GPT-5.6 Sol", available: true, manualSelectionAllowed: true },
    { id: "gpt-5.6-luna", provider: "openai", name: "GPT-5.6 Luna", available: true, manualSelectionAllowed: true },
    { id: "gpt-6-astra", provider: "openai", name: "GPT-6 Astra", available: true, manualSelectionAllowed: true },
    { id: "gpt-5.5", provider: "openai", name: "GPT-5.5", available: true, manualSelectionAllowed: true },
    { id: "gpt-6-sol", provider: "openai", name: "GPT-6 Sol", available: true, manualSelectionAllowed: true },
    { id: "gpt-6-luna", provider: "openai", name: "GPT-6 Luna", available: true, manualSelectionAllowed: true },
    { id: "gpt-6.1-sol", provider: "openai", name: "GPT-6.1 Sol", available: true, manualSelectionAllowed: true },
    { id: "glm-5.0-turbo", provider: "zai", name: "GLM-5.0 Turbo", available: true, manualSelectionAllowed: true },
    { id: "glm-5", provider: "zai", name: "GLM-5", available: true, manualSelectionAllowed: true },
    { id: "glm-5.1", provider: "zai", name: "GLM-5.1", available: true, manualSelectionAllowed: true },
    { id: "glm-5.2", provider: "zai", name: "GLM-5.2", available: true, manualSelectionAllowed: true },
    { id: "kimi-for-coding", provider: "kimi", name: "Kimi for Coding", available: true, manualSelectionAllowed: true },
    { id: "hidden", provider: "zai", manualSelectionAllowed: false }
  ],
  modelsByAgent: {
    main: [
      { id: "gpt-5.6-terra", provider: "openai", name: "GPT-5.6 Terra", available: true, manualSelectionAllowed: true },
      { id: "gpt-5.6-sol", provider: "openai", name: "GPT-5.6 Sol", available: true, manualSelectionAllowed: true },
      { id: "gpt-5.6-luna", provider: "openai", name: "GPT-5.6 Luna", available: true, manualSelectionAllowed: true },
      { id: "gpt-6-astra", provider: "openai", name: "GPT-6 Astra", available: true, manualSelectionAllowed: true },
      { id: "gpt-5.5", provider: "openai", name: "GPT-5.5", available: true, manualSelectionAllowed: true }
    ],
    glm: [
      { id: "glm-5.0-turbo", provider: "zai", name: "GLM-5.0 Turbo", available: true, manualSelectionAllowed: true },
      { id: "glm-5", provider: "zai", name: "GLM-5", available: true, manualSelectionAllowed: true },
      { id: "glm-5.1", provider: "zai", name: "GLM-5.1", available: true, manualSelectionAllowed: true },
      { id: "glm-5.2", provider: "zai", name: "GLM-5.2", available: true, manualSelectionAllowed: true },
      { id: "hidden", provider: "zai", available: true, manualSelectionAllowed: false }
    ],
    kimi: [
      { id: "kimi-for-coding", provider: "kimi", name: "Kimi for Coding", available: true, manualSelectionAllowed: true }
    ],
    glm51: [
      { id: "glm-5.0-turbo", provider: "zai", available: true, manualSelectionAllowed: true },
      { id: "glm-5", provider: "zai", available: true, manualSelectionAllowed: true },
      { id: "glm-5.1", provider: "zai", available: true, manualSelectionAllowed: true },
      { id: "glm-5.2", provider: "zai", available: true, manualSelectionAllowed: true }
    ],
    "glm5-2": [
      { id: "glm-5.0-turbo", provider: "zai", available: true, manualSelectionAllowed: true },
      { id: "glm-5", provider: "zai", available: true, manualSelectionAllowed: true },
      { id: "glm-5.1", provider: "zai", available: true, manualSelectionAllowed: true },
      { id: "glm-5.2", provider: "zai", available: true, manualSelectionAllowed: true }
    ],
    "kimi-for-coding": [
      { id: "kimi-for-coding", provider: "kimi", available: true, manualSelectionAllowed: true }
    ]
  },
  defaultAgentId: "main",
  modelView: "configured"
};

afterEach(() => vi.unstubAllGlobals());

describe("Hillsboro Gateway catalog", () => {
  it("normalizes only public configured Agent and model fields", () => {
    const catalog = normalizeHillsboroGatewayCatalog(upstreamCatalog, 123);
    expect(catalog).toMatchObject({
      providerId: "openclaw-hillsboro",
      source: "gateway_rpc",
      defaultAgentId: "main",
      modelView: "configured",
      syncedAt: 123
    });
    expect(catalog.agents[0]).toEqual({ id: "main", name: "main", defaultModel: "openai/gpt-5.6-terra" });
    expect(catalog.agents.map(agent => agent.id)).toEqual([
      "main", "glm", "kimi", "glm51", "glm5-2", "kimi-for-coding"
    ]);
    expect(catalog.models.map(model => model.id)).toEqual([
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-luna",
      "openai/gpt-6-astra",
      "zai/glm-5.0-turbo",
      "zai/glm-5",
      "zai/glm-5.1",
      "zai/glm-5.2",
      "kimi/kimi-for-coding"
    ]);
    expect(catalog.modelsByAgent.main.map(model => model.id)).toEqual([
      "openai/gpt-5.6-terra", "openai/gpt-5.6-sol", "openai/gpt-5.6-luna", "openai/gpt-6-astra"
    ]);
    expect(catalog.modelsByAgent.glm.map(model => model.id)).toEqual([
      "zai/glm-5.0-turbo", "zai/glm-5", "zai/glm-5.1", "zai/glm-5.2"
    ]);
    expect(catalog.modelsByAgent.kimi.map(model => model.id)).toEqual(["kimi/kimi-for-coding"]);
    expect(JSON.stringify(catalog)).not.toContain("hidden");
  });

  it("refreshes through the fixed authenticated Bridge catalog route and caches separately", async () => {
    const db = fakeDb();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(upstreamCatalog), {
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test/",
      OPENCLAW_BRIDGE_TOKEN: "server-only-token"
    };
    const result = await getHillsboroOpenClawCatalog(env, { force: true });
    expect(result.status).toBe("fresh");
    expect(result.catalog.models[0].id).toBe("openai/gpt-5.6-terra");
    expect(JSON.stringify(result)).not.toContain("server-only-token");
    expect(fetchMock.mock.calls[0][0]).toBe("https://bridge.example.test/v1/openclaw/catalog?refresh=1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer server-only-token");
    expect(db.rows.has("openclaw_catalog_hillsboro_v1")).toBe(true);
    await getHillsboroOpenClawCatalog(env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the Hillsboro cache as stale after an upstream refresh failure", async () => {
    const db = fakeDb();
    let fail = false;
    vi.stubGlobal("fetch", vi.fn(async () => fail
      ? new Response(JSON.stringify({ error: "gateway unavailable" }), { status: 502 })
      : new Response(JSON.stringify(upstreamCatalog))));
    const env = { DB: db, OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test", OPENCLAW_BRIDGE_TOKEN: "secret" };
    await getHillsboroOpenClawCatalog(env, { force: true });
    fail = true;
    const result = await getHillsboroOpenClawCatalog(env, { force: true });
    expect(result.status).toBe("stale");
    expect(result.catalog.agents.map(agent => agent.id)).toContain("glm51");
  });

  it("refreshes a legacy unscoped Hillsboro cache instead of reusing its global model list", async () => {
    const db = fakeDb();
    db.rows.set("openclaw_catalog_hillsboro_v1", JSON.stringify({
      providerId: "openclaw-hillsboro",
      syncedAt: Date.now(),
      agents: [{ id: "main", defaultModel: "openai/gpt-5.6-terra" }],
      models: [
        { id: "openai/gpt-5.6-terra", available: true },
        { id: "zai/glm-5.2", available: true }
      ]
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(upstreamCatalog)));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test",
      OPENCLAW_BRIDGE_TOKEN: "secret"
    };

    const result = await getHillsboroOpenClawCatalog(env);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("fresh");
    expect(result.catalog.modelsByAgent.main.map(model => model.id)).toEqual([
      "openai/gpt-5.6-terra", "openai/gpt-5.6-sol", "openai/gpt-5.6-luna", "openai/gpt-6-astra"
    ]);
  });

  it("accepts only agents and available base models present in the current Hillsboro cache", async () => {
    const db = fakeDb();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(upstreamCatalog))));
    const env = { DB: db, OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test", OPENCLAW_BRIDGE_TOKEN: "secret" };
    await getHillsboroOpenClawCatalog(env, { force: true });
    expect(await validateHillsboroOpenClawSelection(env, "glm", "")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "glm", "zai/glm-5.1")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "kimi", "kimi/kimi-for-coding")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "glm51", "")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "glm5-2", "zai/glm-5.1")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "kimi-for-coding", "kimi/kimi-for-coding")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-5.6-sol")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6-astra")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "zai/glm-5.2")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "glm", "openai/gpt-5.6-terra")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "kimi", "zai/glm-5.2")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-5.5")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6-sol")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6-luna")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6.1-sol")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "glm", "zai/not-configured")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "unknown", "zai/glm-5.1")).toBe(false);
  });

  it("maps only Hillsboro legacy agents to the current routes", () => {
    expect(normalizeHillsboroAgentId("main")).toBe("main");
    expect(normalizeHillsboroAgentId("glm")).toBe("glm");
    expect(normalizeHillsboroAgentId("kimi")).toBe("kimi");
    expect(normalizeHillsboroAgentId("glm51")).toBe("glm");
    expect(normalizeHillsboroAgentId("glm5-2")).toBe("glm");
    expect(normalizeHillsboroAgentId("kimi-for-coding")).toBe("kimi");
    expect(hillsboroAgentRoute("glm51")).toBe("openclaw/glm");
    expect(hillsboroAgentRoute("kimi-for-coding")).toBe("openclaw/kimi");
  });
});
