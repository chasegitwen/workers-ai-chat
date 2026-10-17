import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHillsboroOpenClawCatalog,
  normalizeHillsboroGatewayCatalog,
  validateHillsboroOpenClawSelection
} from "../src/api/hillsboroCatalog.js";

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
    { id: "glm51", name: "glm51", defaultModel: "zai/glm-5.1" }
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
    { id: "glm-5.1", provider: "zai", name: "GLM-5.1", available: true, manualSelectionAllowed: true },
    { id: "glm-5.2", provider: "zai", name: "GLM-5.2", available: true, manualSelectionAllowed: true },
    { id: "kimi-for-coding", provider: "kimi", name: "Kimi for Coding", available: true, manualSelectionAllowed: true },
    { id: "hidden", provider: "zai", manualSelectionAllowed: false }
  ],
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
    expect(catalog.agents[1]).toEqual({ id: "glm51", name: "glm51", defaultModel: "zai/glm-5.1" });
    expect(catalog.models.map(model => model.id)).toEqual([
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-luna",
      "openai/gpt-6-astra",
      "zai/glm-5.0-turbo",
      "zai/glm-5.1",
      "zai/glm-5.2",
      "kimi/kimi-for-coding"
    ]);
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

  it("accepts only agents and available base models present in the current Hillsboro cache", async () => {
    const db = fakeDb();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(upstreamCatalog))));
    const env = { DB: db, OPENCLAW_BRIDGE_BASE_URL: "https://bridge.example.test", OPENCLAW_BRIDGE_TOKEN: "secret" };
    await getHillsboroOpenClawCatalog(env, { force: true });
    expect(await validateHillsboroOpenClawSelection(env, "glm51", "")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "glm51", "zai/glm-5.1")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-5.6-sol")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6-astra")).toBe(true);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-5.5")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6-sol")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6-luna")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "main", "openai/gpt-6.1-sol")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "glm51", "zai/not-configured")).toBe(false);
    expect(await validateHillsboroOpenClawSelection(env, "unknown", "zai/glm-5.1")).toBe(false);
  });
});
