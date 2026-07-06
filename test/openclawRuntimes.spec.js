import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureHillsboroRuntimeBindingForProject,
  handleOpenClawRuntimes,
  resolveOpenClawRuntimeForProject
} from "../src/api/openclawRuntimes.js";

const HILLSBORO_RUNTIME = {
  id: "hillsboro-openclaw",
  display_name: "Hillsboro OpenClaw",
  slug: "hillsboro-openclaw",
  provider_id: "openclaw-hillsboro",
  base_url: "https://hill.hnsnowground.cfd/v1",
  callback_url: "",
  capabilities_json: JSON.stringify({
    bridge_callback: true,
    progress_callback: true,
    sse_events: true,
    remote_console: true,
    production_validated: true
  }),
  agents_json: JSON.stringify([
    { agent_id: "main", display_name: "Main", verified: true },
    { agent_id: "glm51", display_name: "GLM 5.1", verified: true }
  ]),
  bridge_mode: "bridge",
  status: "verified",
  is_enabled: 1,
  last_verified_at: "2026-07-02T00:00:00.000Z",
  created_at: "2026-07-05T00:00:00.000Z",
  updated_at: "2026-07-05T00:00:00.000Z"
};

const SEATTLE_RUNTIME = {
  id: "seattle-openclaw",
  display_name: "Seattle OpenClaw",
  slug: "seattle-openclaw",
  provider_id: "openclaw-seattle",
  base_url: "https://act.hnsnowground.cfd/v1",
  callback_url: "",
  capabilities_json: JSON.stringify({
    bridge_callback: false,
    progress_callback: false,
    sse_events: false,
    remote_console: false,
    legacy_only: true,
    production_validated: false
  }),
  agents_json: "[]",
  bridge_mode: "legacy",
  status: "unverified",
  is_enabled: 0,
  last_verified_at: null,
  created_at: "2026-07-05T00:00:00.000Z",
  updated_at: "2026-07-05T00:00:00.000Z"
};

class FakeStatement {
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

class FakeD1 {
  constructor() {
    this.runtimes = new Map([
      [HILLSBORO_RUNTIME.id, { ...HILLSBORO_RUNTIME }],
      [SEATTLE_RUNTIME.id, { ...SEATTLE_RUNTIME }]
    ]);
    this.bindings = new Map([
      ["default:hillsboro-openclaw", {
        project_id: "default",
        runtime_id: "hillsboro-openclaw",
        is_default: 1,
        is_enabled: 1,
        allowed_agents_json: JSON.stringify(["main", "glm51", "glm5-2", "kimi-for-coding"]),
        default_agent_id: "main",
        created_at: "2026-07-05T00:00:00.000Z",
        updated_at: "2026-07-05T00:00:00.000Z"
      }]
    ]);
    this.settings = new Map([
      ["model_settings", {
        key: "model_settings",
        value: JSON.stringify({
          providers: [{
            id: "openclaw-hillsboro",
            openclawExecutionMode: "bridge"
          }, {
            id: "openclaw-seattle",
            openclawExecutionMode: "legacy"
          }]
        }),
        updated_at: 1
      }]
    ]);
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  normalize(sql) {
    return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  first(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from openclaw_runtimes") && normalized.includes("where id = ?")) {
      return this.runtimes.get(bindings[0]) || null;
    }
    if (normalized.includes("from project_openclaw_runtime_bindings")) {
      const binding = this.bindings.get(bindings[0] + ":" + bindings[1]);
      if (!binding) {
        return null;
      }
      const runtime = this.runtimes.get(binding.runtime_id);
      return {
        ...binding,
        binding_is_default: binding.is_default,
        binding_is_enabled: binding.is_enabled,
        binding_created_at: binding.created_at,
        binding_updated_at: binding.updated_at,
        ...(runtime || {})
      };
    }
    if (normalized.includes("from settings")) {
      return this.settings.get(bindings[0]) || null;
    }
    return null;
  }

  all(sql, bindings = []) {
    const normalized = this.normalize(sql);
    if (normalized.includes("from project_openclaw_runtime_bindings")) {
      return [...this.bindings.values()]
        .filter(binding => binding.project_id === bindings[0])
        .map(binding => {
          const runtime = this.runtimes.get(binding.runtime_id);
          return {
            ...binding,
            binding_is_default: binding.is_default,
            binding_is_enabled: binding.is_enabled,
            binding_created_at: binding.created_at,
            binding_updated_at: binding.updated_at,
            ...(runtime || {})
          };
        });
    }
    if (normalized.includes("from openclaw_runtimes")) {
      return [...this.runtimes.values()]
        .sort((left, right) => Number(right.is_enabled || 0) - Number(left.is_enabled || 0)
          || String(left.display_name).localeCompare(String(right.display_name)));
    }
    return [];
  }

  run(sql, bindings) {
    const normalized = this.normalize(sql);
    if (normalized.startsWith("update openclaw_runtimes")) {
      const [
        displayName,
        slug,
        providerId,
        baseUrl,
        callbackUrl,
        capabilitiesJson,
        agentsJson,
        bridgeMode,
        status,
        isEnabled,
        lastVerifiedAt,
        updatedAt,
        runtimeId
      ] = bindings;
      const runtime = this.runtimes.get(runtimeId);
      if (runtime) {
        this.runtimes.set(runtimeId, {
          ...runtime,
          display_name: displayName,
          slug,
          provider_id: providerId,
          base_url: baseUrl,
          callback_url: callbackUrl,
          capabilities_json: capabilitiesJson,
          agents_json: agentsJson,
          bridge_mode: bridgeMode,
          status,
          is_enabled: isEnabled,
          last_verified_at: lastVerifiedAt,
          updated_at: updatedAt
        });
      }
      return;
    }
    if (normalized.startsWith("update project_openclaw_runtime_bindings") && normalized.includes("set is_default = 0")) {
      const [updatedAt, projectId] = bindings;
      for (const [key, binding] of this.bindings.entries()) {
        if (binding.project_id === projectId) {
          this.bindings.set(key, {
            ...binding,
            is_default: 0,
            updated_at: updatedAt
          });
        }
      }
      return;
    }
    if (normalized.startsWith("insert into project_openclaw_runtime_bindings")) {
      const helperInsert = normalized.includes("values (?, ?, 1, 1");
      const [
        projectId,
        runtimeId,
        isDefaultOrAllowedAgentsJson,
        isEnabledOrDefaultAgentId,
        allowedAgentsJsonOrCreatedAt,
        defaultAgentIdOrUpdatedAt,
        createdAtFromApi,
        updatedAtFromApi
      ] = bindings;
      const isDefault = helperInsert ? 1 : isDefaultOrAllowedAgentsJson;
      const isEnabled = helperInsert ? 1 : isEnabledOrDefaultAgentId;
      const allowedAgentsJson = helperInsert ? isDefaultOrAllowedAgentsJson : allowedAgentsJsonOrCreatedAt;
      const defaultAgentId = helperInsert ? isEnabledOrDefaultAgentId : defaultAgentIdOrUpdatedAt;
      const createdAt = helperInsert ? allowedAgentsJsonOrCreatedAt : createdAtFromApi;
      const updatedAt = helperInsert ? defaultAgentIdOrUpdatedAt : updatedAtFromApi;
      const key = projectId + ":" + runtimeId;
      const existing = this.bindings.get(key);
      this.bindings.set(key, {
        project_id: projectId,
        runtime_id: runtimeId,
        is_default: isDefault,
        is_enabled: isEnabled,
        allowed_agents_json: allowedAgentsJson,
        default_agent_id: defaultAgentId,
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt
      });
      return;
    }
    if (normalized.startsWith("update project_openclaw_runtime_bindings")) {
      const [isDefault, isEnabled, allowedAgentsJson, defaultAgentId, updatedAt, projectId, runtimeId] = bindings;
      const key = projectId + ":" + runtimeId;
      const existing = this.bindings.get(key);
      if (existing) {
        this.bindings.set(key, {
          ...existing,
          is_default: isDefault,
          is_enabled: isEnabled,
          allowed_agents_json: allowedAgentsJson,
          default_agent_id: defaultAgentId,
          updated_at: updatedAt
        });
      }
      return;
    }
    if (normalized.startsWith("delete from project_openclaw_runtime_bindings")) {
      this.bindings.delete(bindings[0] + ":" + bindings[1]);
    }
  }
}

function env(db) {
  return { DB: db };
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function json(response) {
  return response.json();
}

describe("OpenClaw runtime registry", () => {
  it("lists Hillsboro and Seattle runtime records together", async () => {
    const db = new FakeD1();
    const response = await handleOpenClawRuntimes(
      new Request("http://example.com/api/openclaw/runtimes"),
      env(db),
      new URL("http://example.com/api/openclaw/runtimes")
    );
    const body = await json(response);

    expect(body.ok).toBe(true);
    expect(body.runtimes.map(runtime => runtime.id).sort()).toEqual([
      "hillsboro-openclaw",
      "seattle-openclaw"
    ]);
  });

  it("marks Hillsboro enabled and verified with Bridge callback capabilities", async () => {
    const db = new FakeD1();
    const body = await json(await handleOpenClawRuntimes(
      new Request("http://example.com/api/openclaw/runtimes/hillsboro-openclaw"),
      env(db),
      new URL("http://example.com/api/openclaw/runtimes/hillsboro-openclaw")
    ));

    expect(body.runtime).toMatchObject({
      id: "hillsboro-openclaw",
      status: "verified",
      is_enabled: true,
      bridge_mode: "bridge"
    });
    expect(body.runtime.capabilities).toMatchObject({
      bridge_callback: true,
      progress_callback: true,
      sse_events: true,
      remote_console: true
    });
  });

  it("does not mark Seattle Bridge-enabled by default", async () => {
    const db = new FakeD1();
    const body = await json(await handleOpenClawRuntimes(
      new Request("http://example.com/api/openclaw/runtimes/seattle-openclaw"),
      env(db),
      new URL("http://example.com/api/openclaw/runtimes/seattle-openclaw")
    ));

    expect(body.runtime).toMatchObject({
      id: "seattle-openclaw",
      status: "unverified",
      is_enabled: false,
      bridge_mode: "legacy"
    });
    expect(body.runtime.capabilities.bridge_callback).toBe(false);
    expect(body.runtime.capabilities.sse_events).toBe(false);
    expect(body.runtime.capabilities.remote_console).toBe(false);
  });

  it("updates runtime metadata without touching provider settings", async () => {
    const db = new FakeD1();
    const beforeSettings = db.settings.get("model_settings").value;

    const response = await handleOpenClawRuntimes(
      new Request("http://example.com/api/openclaw/runtimes/seattle-openclaw", {
        method: "PATCH",
        body: JSON.stringify({
          status: "legacy_only",
          is_enabled: false,
          capabilities: {
            bridge_callback: false,
            progress_callback: false,
            sse_events: false,
            remote_console: false,
            legacy_only: true
          }
        })
      }),
      env(db),
      new URL("http://example.com/api/openclaw/runtimes/seattle-openclaw")
    );
    const body = await json(response);

    expect(body.ok).toBe(true);
    expect(body.runtime.status).toBe("legacy_only");
    expect(body.runtime.capabilities.legacy_only).toBe(true);
    expect(db.settings.get("model_settings").value).toBe(beforeSettings);
  });

  it("binds Default Project to Hillsboro as the default runtime", () => {
    const db = new FakeD1();
    const binding = db.bindings.get("default:hillsboro-openclaw");

    expect(binding).toMatchObject({
      project_id: "default",
      runtime_id: "hillsboro-openclaw",
      is_default: 1,
      is_enabled: 1
    });
    expect(db.bindings.has("default:seattle-openclaw")).toBe(false);
  });

  it("repairs an existing project without a runtime binding by adding Hillsboro only", async () => {
    const db = new FakeD1();

    const repair = await ensureHillsboroRuntimeBindingForProject(db, "existing-project");
    const resolved = await resolveOpenClawRuntimeForProject(env(db), {
      projectId: "existing-project",
      executionMode: "bridge"
    });

    expect(repair.ok).toBe(true);
    expect(db.bindings.get("existing-project:hillsboro-openclaw")).toMatchObject({
      project_id: "existing-project",
      runtime_id: "hillsboro-openclaw",
      is_default: 1,
      is_enabled: 1,
      default_agent_id: "main"
    });
    expect(db.bindings.has("existing-project:seattle-openclaw")).toBe(false);
    expect(resolved).toMatchObject({
      ok: true,
      runtime_id: "hillsboro-openclaw",
      execution_mode: "bridge"
    });
  });

  it("lists and updates project runtime bindings", async () => {
    const db = new FakeD1();

    const list = await json(await handleOpenClawRuntimes(
      new Request("http://example.com/api/projects/default/openclaw-runtimes"),
      env(db),
      new URL("http://example.com/api/projects/default/openclaw-runtimes")
    ));
    expect(list.runtimes).toHaveLength(1);
    expect(list.runtimes[0]).toMatchObject({
      project_id: "default",
      runtime_id: "hillsboro-openclaw",
      is_default: true,
      default_agent_id: "main"
    });

    const patched = await json(await handleOpenClawRuntimes(
      new Request("http://example.com/api/projects/default/openclaw-runtimes/hillsboro-openclaw", {
        method: "PATCH",
        body: JSON.stringify({
          default_agent_id: "glm51",
          allowed_agents: ["main", "glm51"]
        })
      }),
      env(db),
      new URL("http://example.com/api/projects/default/openclaw-runtimes/hillsboro-openclaw")
    ));

    expect(patched.binding).toMatchObject({
      runtime_id: "hillsboro-openclaw",
      default_agent_id: "glm51",
      allowed_agents: ["main", "glm51"]
    });
  });

  it("resolves Default Project to Hillsboro with auditable fields", async () => {
    const result = await resolveOpenClawRuntimeForProject(env(new FakeD1()), {
      projectId: "default",
      modelAgentId: "glm51",
      executionMode: "bridge"
    });

    expect(result).toMatchObject({
      ok: true,
      project_id: "default",
      runtime_id: "hillsboro-openclaw",
      runtime_slug: "hillsboro-openclaw",
      provider_id: "openclaw-hillsboro",
      agent_id: "glm51",
      execution_mode: "bridge",
      resolution_source: "project_default"
    });
  });

  it("logs diagnostics when runtime resolution infers the only enabled project binding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new FakeD1();
    db.bindings.set("default:hillsboro-openclaw", {
      ...db.bindings.get("default:hillsboro-openclaw"),
      is_default: 0,
      is_enabled: 1
    });

    const result = await resolveOpenClawRuntimeForProject(env(db), {
      projectId: "default",
      executionMode: "bridge"
    });

    expect(result).toMatchObject({
      ok: true,
      runtime_id: "hillsboro-openclaw",
      resolution_source: "project_default"
    });
    expect(result.warnings).toContain("Inferred OpenClaw runtime from the only enabled project binding");
    expect(warn).toHaveBeenCalledWith(
      "[openclaw-runtime-resolution]",
      "project_single_binding_inference",
      expect.objectContaining({
        project_id: "default",
        runtime_id: "hillsboro-openclaw"
      })
    );
  });

  it("logs diagnostics when registry compatibility fallback is used", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await resolveOpenClawRuntimeForProject({}, {
      projectId: "default",
      executionMode: "bridge"
    });

    expect(result).toMatchObject({
      ok: true,
      resolution_source: "legacy_fallback"
    });
    expect(result.warnings).toContain("D1 unavailable; using legacy runtime fallback");
    expect(warn).toHaveBeenCalledWith(
      "[openclaw-runtime-resolution]",
      "legacy_fallback",
      expect.objectContaining({
        reason: "d1_unavailable",
        project_id: "default"
      })
    );
  });

  it("resolves explicit runtime only when bound and enabled", async () => {
    const ok = await resolveOpenClawRuntimeForProject(env(new FakeD1()), {
      projectId: "default",
      runtimeId: "hillsboro-openclaw",
      executionMode: "bridge"
    });
    const rejected = await resolveOpenClawRuntimeForProject(env(new FakeD1()), {
      projectId: "default",
      runtimeId: "seattle-openclaw",
      executionMode: "legacy"
    });

    expect(ok.ok).toBe(true);
    expect(ok.resolution_source).toBe("explicit");
    expect(rejected).toMatchObject({
      ok: false,
      error: "runtime_not_bound"
    });
  });

  it("rejects disabled Seattle for new Bridge runtime resolution", async () => {
    const db = new FakeD1();
    db.bindings.set("default:seattle-openclaw", {
      project_id: "default",
      runtime_id: "seattle-openclaw",
      is_default: 0,
      is_enabled: 1,
      allowed_agents_json: "[]",
      default_agent_id: "",
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z"
    });

    const result = await resolveOpenClawRuntimeForProject(env(db), {
      projectId: "default",
      runtimeId: "seattle-openclaw",
      executionMode: "bridge"
    });

    expect(result).toMatchObject({
      ok: false,
      error: "runtime_disabled",
      runtime_id: "seattle-openclaw"
    });
  });

  it("rejects setting disabled or unverified Seattle as the project default runtime", async () => {
    const db = new FakeD1();
    db.bindings.set("default:seattle-openclaw", {
      project_id: "default",
      runtime_id: "seattle-openclaw",
      is_default: 0,
      is_enabled: 1,
      allowed_agents_json: "[]",
      default_agent_id: "",
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z"
    });

    const response = await handleOpenClawRuntimes(
      new Request("http://example.com/api/projects/default/openclaw-runtimes/seattle-openclaw", {
        method: "PATCH",
        body: JSON.stringify({
          is_default: true,
          is_enabled: true
        })
      }),
      env(db),
      new URL("http://example.com/api/projects/default/openclaw-runtimes/seattle-openclaw")
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: "runtime_default_unsupported",
      runtime_id: "seattle-openclaw"
    });
    expect(db.bindings.get("default:seattle-openclaw").is_default).toBe(0);
  });

  it("requires explicit runtime when multiple enabled runtimes have no default", async () => {
    const db = new FakeD1();
    db.runtimes.set("seattle-openclaw", {
      ...db.runtimes.get("seattle-openclaw"),
      is_enabled: 1
    });
    db.bindings.set("default:hillsboro-openclaw", {
      ...db.bindings.get("default:hillsboro-openclaw"),
      is_default: 0,
      is_enabled: 1
    });
    db.bindings.set("default:seattle-openclaw", {
      project_id: "default",
      runtime_id: "seattle-openclaw",
      is_default: 0,
      is_enabled: 1,
      allowed_agents_json: "[]",
      default_agent_id: "",
      created_at: "2026-07-05T00:00:00.000Z",
      updated_at: "2026-07-05T00:00:00.000Z"
    });

    const result = await resolveOpenClawRuntimeForProject(env(db), {
      projectId: "default",
      executionMode: "legacy"
    });

    expect(result).toMatchObject({
      ok: false,
      error: "runtime_required"
    });
    expect(result.runtimes.map(item => item.runtime_id).sort()).toEqual([
      "hillsboro-openclaw",
      "seattle-openclaw"
    ]);
  });

  it("requires a runtime binding instead of using legacy fallback for new project resolution", async () => {
    const result = await resolveOpenClawRuntimeForProject(env(new FakeD1()), {
      projectId: "project-without-runtime",
      executionMode: "bridge"
    });

    expect(result).toMatchObject({
      ok: false,
      error: "runtime_required",
      project_id: "project-without-runtime"
    });
  });
});
