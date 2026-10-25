import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOracleOpenClawCatalog,
  normalizeOracleOpenClawCatalog,
  validateOracleOpenClawSelection
} from "../src/api/oracleCatalog.js";

class SettingsDb {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  prepare(sql) {
    const db = this;
    return {
      bind(...bindings) {
        return {
          async first() {
            const value = db.values.get(bindings[0]);
            return value === undefined ? null : { value };
          },
          async run() {
            if (String(sql).startsWith("INSERT INTO settings")) db.values.set(bindings[0], bindings[1]);
            return { success: true, meta: { changes: 1 } };
          }
        };
      }
    };
  }
}

const bridgeCatalog = {
  defaultAgentId: "main",
  agents: [{ id: "main", name: "Main", defaultModel: "openai/gpt-5.6-sol" }],
  modelsByAgent: {
    main: [
      { id: "openai/gpt-5.6-sol", available: true, selectable: true },
      { id: "openai/gpt-6.1-sol", available: true, manualSelectionAllowed: true },
      { id: "openai/gpt-6-astra", available: true, configured: true },
      { id: "openai/gpt-5.6-terra", available: true, configured: true },
      { id: "openai/gpt-5.6-luna", available: true, usage: "utility-only" }
    ]
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("Oracle OpenClaw catalog", () => {
  it("uses normalized selection fields and excludes utility-only models", () => {
    const catalog = normalizeOracleOpenClawCatalog(bridgeCatalog, 123);
    expect(catalog).toMatchObject({
      providerId: "openclaw-oracle",
      runtimeId: "oracle-openclaw",
      defaultAgentId: "main",
      syncedAt: 123
    });
    expect(catalog.models.map(model => model.id)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-6.1-sol",
      "openai/gpt-6-astra",
      "openai/gpt-5.6-terra"
    ]);
    expect(catalog.models.map(model => model.id)).not.toContain("openai/gpt-5.6-luna");
  });

  it("uses an Oracle-only cache key and Oracle Bridge credentials", async () => {
    const db = new SettingsDb({
      openclaw_catalog_hillsboro_v1: JSON.stringify({ providerId: "openclaw-hillsboro", models: [{ id: "wrong" }] })
    });
    const fetchMock = vi.fn(async (url, init) => new Response(JSON.stringify(bridgeCatalog), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      OPENCLAW_BRIDGE_BASE_URL: "https://hillsboro.example.test",
      OPENCLAW_BRIDGE_TOKEN: "hillsboro-token",
      ORACLE_OPENCLAW_BRIDGE_URL: "https://oracle.example.test",
      ORACLE_OPENCLAW_BRIDGE_TOKEN: "oracle-token"
    };

    const result = await getOracleOpenClawCatalog(env, { force: true });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://oracle.example.test/v1/openclaw/catalog?refresh=1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer oracle-token");
    expect(db.values.has("openclaw_catalog_oracle_v1")).toBe(true);
    expect(db.values.get("openclaw_catalog_hillsboro_v1")).toContain("openclaw-hillsboro");
    expect(await validateOracleOpenClawSelection(env, "main", "openai/gpt-5.6-sol")).toBe(true);
    expect(await validateOracleOpenClawSelection(env, "main", "openai/gpt-5.6-luna")).toBe(false);
  });
});
