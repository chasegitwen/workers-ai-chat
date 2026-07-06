import { jsonResponse } from "../utils/response.js";

export const HILLSBORO_OPENCLAW_RUNTIME_ID = "hillsboro-openclaw";

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanId(value) {
  return cleanText(value, 160);
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeJsonField(value, fallback) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const parsed = safeJsonParse(value, null);
    if (parsed === null) {
      throw new Error("JSON field must contain valid JSON");
    }
    return JSON.stringify(parsed);
  }
  return JSON.stringify(value ?? fallback);
}

function normalizeEnabled(value) {
  if (value === undefined) {
    return undefined;
  }
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeStringListJson(value) {
  if (value === undefined) {
    return undefined;
  }
  const source = typeof value === "string" ? safeJsonParse(value, null) : value;
  if (!Array.isArray(source)) {
    throw new Error("allowed_agents_json must be an array");
  }
  return JSON.stringify(source.map(item => String(item || "").trim()).filter(Boolean));
}

function serializeRuntime(row) {
  if (!row) {
    return null;
  }
  const capabilitiesJson = String(row.capabilities_json || "{}");
  const agentsJson = String(row.agents_json || "[]");
  return {
    id: row.id,
    display_name: row.display_name,
    slug: row.slug,
    provider_id: row.provider_id || "",
    base_url: row.base_url || "",
    callback_url: row.callback_url || "",
    capabilities_json: capabilitiesJson,
    capabilities: safeJsonParse(capabilitiesJson, {}),
    agents_json: agentsJson,
    agents: safeJsonParse(agentsJson, []),
    bridge_mode: row.bridge_mode || "",
    status: row.status || "unverified",
    is_enabled: Number(row.is_enabled || 0) === 1,
    last_verified_at: row.last_verified_at || null,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

async function listRuntimes(db) {
  const result = await db.prepare(
    `SELECT id, display_name, slug, provider_id, base_url, callback_url,
      capabilities_json, agents_json, bridge_mode, status, is_enabled,
      last_verified_at, created_at, updated_at
     FROM openclaw_runtimes
     ORDER BY is_enabled DESC, display_name ASC`
  ).all();
  return (result.results || []).map(serializeRuntime);
}

export async function readOpenClawRuntime(db, runtimeId) {
  const id = cleanId(runtimeId);
  if (!id) {
    return null;
  }
  const row = await db.prepare(
    `SELECT id, display_name, slug, provider_id, base_url, callback_url,
      capabilities_json, agents_json, bridge_mode, status, is_enabled,
      last_verified_at, created_at, updated_at
     FROM openclaw_runtimes
     WHERE id = ?
     LIMIT 1`
  ).bind(id).first();
  return serializeRuntime(row);
}

async function readRuntime(db, runtimeId) {
  return readOpenClawRuntime(db, runtimeId);
}

function serializeProjectRuntimeBinding(row) {
  if (!row) {
    return null;
  }
  const runtime = serializeRuntime(row);
  const allowedAgentsJson = String(row.allowed_agents_json || "[]");
  return {
    project_id: row.project_id,
    runtime_id: row.runtime_id || row.id,
    is_default: Number(row.binding_is_default ?? row.is_default ?? 0) === 1,
    is_enabled: Number(row.binding_is_enabled ?? row.binding_enabled ?? 0) === 1,
    allowed_agents_json: allowedAgentsJson,
    allowed_agents: safeJsonParse(allowedAgentsJson, []),
    default_agent_id: row.default_agent_id || "",
    created_at: row.binding_created_at || row.created_at || "",
    updated_at: row.binding_updated_at || row.updated_at || "",
    runtime
  };
}

async function listProjectRuntimeBindings(db, projectId) {
  const result = await db.prepare(
    `SELECT
       b.project_id,
       b.runtime_id,
       b.is_default AS binding_is_default,
       b.is_enabled AS binding_is_enabled,
       b.allowed_agents_json,
       b.default_agent_id,
       b.created_at AS binding_created_at,
       b.updated_at AS binding_updated_at,
       r.id,
       r.display_name,
       r.slug,
       r.provider_id,
       r.base_url,
       r.callback_url,
       r.capabilities_json,
       r.agents_json,
       r.bridge_mode,
       r.status,
       r.is_enabled,
       r.last_verified_at,
       r.created_at,
       r.updated_at
     FROM project_openclaw_runtime_bindings b
     JOIN openclaw_runtimes r ON r.id = b.runtime_id
     WHERE b.project_id = ?
     ORDER BY b.is_default DESC, b.is_enabled DESC, r.display_name ASC`
  ).bind(projectId).all();
  return (result.results || []).map(serializeProjectRuntimeBinding);
}

async function readProjectRuntimeBinding(db, projectId, runtimeId) {
  const row = await db.prepare(
    `SELECT
       b.project_id,
       b.runtime_id,
       b.is_default AS binding_is_default,
       b.is_enabled AS binding_is_enabled,
       b.allowed_agents_json,
       b.default_agent_id,
       b.created_at AS binding_created_at,
       b.updated_at AS binding_updated_at,
       r.id,
       r.display_name,
       r.slug,
       r.provider_id,
       r.base_url,
       r.callback_url,
       r.capabilities_json,
       r.agents_json,
       r.bridge_mode,
       r.status,
       r.is_enabled,
       r.last_verified_at,
       r.created_at,
       r.updated_at
     FROM project_openclaw_runtime_bindings b
     JOIN openclaw_runtimes r ON r.id = b.runtime_id
     WHERE b.project_id = ?
       AND b.runtime_id = ?
     LIMIT 1`
  ).bind(projectId, runtimeId).first();
  return serializeProjectRuntimeBinding(row);
}

function runtimeSupportsExecutionMode(runtime, executionMode) {
  if (!runtime) {
    return false;
  }
  if (executionMode !== "bridge") {
    return true;
  }
  return runtime.bridge_mode === "bridge"
    && runtime.is_enabled
    && runtime.capabilities?.bridge_callback === true;
}

function runtimeIsVerifiedBridgeCapable(runtime) {
  return runtime?.id === HILLSBORO_OPENCLAW_RUNTIME_ID
    && runtime.is_enabled
    && runtime.status === "verified"
    && runtimeSupportsExecutionMode(runtime, "bridge");
}

function defaultAgentsForRuntime(runtime) {
  const agents = Array.isArray(runtime?.agents) ? runtime.agents : [];
  const agentIds = agents
    .map(agent => typeof agent === "string" ? agent : agent?.agent_id)
    .map(agentId => cleanText(agentId, 160))
    .filter(Boolean);
  const allowedAgents = agentIds.length ? agentIds : ["main"];
  const defaultAgentId = allowedAgents.includes("main") ? "main" : allowedAgents[0];
  return {
    allowedAgents,
    defaultAgentId
  };
}

export async function ensureHillsboroRuntimeBindingForProject(db, projectId) {
  const cleanProjectId = cleanId(projectId);
  if (!db || !cleanProjectId) {
    return {
      ok: false,
      reason: "missing_db_or_project"
    };
  }

  const runtime = await readOpenClawRuntime(db, HILLSBORO_OPENCLAW_RUNTIME_ID);
  if (!runtime) {
    return {
      ok: false,
      reason: "hillsboro_runtime_missing"
    };
  }
  if (!runtimeIsVerifiedBridgeCapable(runtime)) {
    return {
      ok: false,
      reason: "hillsboro_runtime_not_bridge_capable",
      runtime_id: HILLSBORO_OPENCLAW_RUNTIME_ID
    };
  }

  const timestamp = isoNow();
  const { allowedAgents, defaultAgentId } = defaultAgentsForRuntime(runtime);

  await db.prepare(
    `UPDATE project_openclaw_runtime_bindings
     SET is_default = 0,
       updated_at = ?
     WHERE project_id = ?`
  ).bind(timestamp, cleanProjectId).run();

  await db.prepare(
    `INSERT INTO project_openclaw_runtime_bindings (
      project_id,
      runtime_id,
      is_default,
      is_enabled,
      allowed_agents_json,
      default_agent_id,
      created_at,
      updated_at
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?)
    ON CONFLICT(project_id, runtime_id) DO UPDATE SET
      is_default = 1,
      is_enabled = 1,
      allowed_agents_json = excluded.allowed_agents_json,
      default_agent_id = excluded.default_agent_id,
      updated_at = excluded.updated_at`
  ).bind(
    cleanProjectId,
    HILLSBORO_OPENCLAW_RUNTIME_ID,
    JSON.stringify(allowedAgents),
    defaultAgentId,
    timestamp,
    timestamp
  ).run();

  return {
    ok: true,
    binding: await readProjectRuntimeBinding(db, cleanProjectId, HILLSBORO_OPENCLAW_RUNTIME_ID)
  };
}

function bridgeDefaultRejection(binding, isDefault, isEnabled) {
  if (!isDefault) {
    return "";
  }
  const runtime = binding?.runtime || binding;
  if (!isEnabled || !runtime?.is_enabled) {
    return "Default OpenClaw runtime must be enabled for both the project and runtime registry";
  }
  if (runtime.status !== "verified") {
    return "Default OpenClaw runtime must be verified before it can be selected for Bridge use";
  }
  if (!runtimeSupportsExecutionMode(runtime, "bridge")) {
    return "Default OpenClaw runtime must support verified Bridge callback mode";
  }
  return "";
}

function agentFromBinding(binding, requestedAgentId, modelAgentId) {
  const allowed = Array.isArray(binding?.allowed_agents) ? binding.allowed_agents.filter(Boolean) : [];
  const requested = cleanText(requestedAgentId, 160);
  if (requested && (!allowed.length || allowed.includes(requested))) {
    return requested;
  }
  const modelAgent = cleanText(modelAgentId, 160);
  if (modelAgent && (!allowed.length || allowed.includes(modelAgent))) {
    return modelAgent;
  }
  if (binding?.default_agent_id && (!allowed.length || allowed.includes(binding.default_agent_id))) {
    return binding.default_agent_id;
  }
  return allowed[0] || modelAgent || requested || "";
}

function warnRuntimeResolution(event, detail = {}) {
  console.warn("[openclaw-runtime-resolution]", event, detail);
}

export async function resolveOpenClawRuntimeForProject(env, options = {}) {
  const projectId = cleanId(options.projectId || options.project_id || "default") || "default";
  const explicitRuntimeId = cleanId(options.runtimeId || options.runtime_id);
  const requestedExecutionMode = cleanText(options.executionMode || options.execution_mode || "legacy", 40) || "legacy";
  const requestedAgentId = cleanText(options.agentId || options.agent_id, 160);
  const modelAgentId = cleanText(options.modelAgentId || options.model_agent_id, 160);
  const warnings = [];

  if (!env.DB) {
    warnings.push("D1 unavailable; using legacy runtime fallback");
    warnRuntimeResolution("legacy_fallback", {
      reason: "d1_unavailable",
      project_id: projectId
    });
    return {
      ok: true,
      project_id: projectId,
      runtime_id: "",
      runtime_slug: "",
      provider_id: cleanText(options.providerId || options.provider_id, 160),
      agent_id: requestedAgentId || modelAgentId || "",
      execution_mode: requestedExecutionMode,
      resolution_source: "legacy_fallback",
      warnings
    };
  }

  try {
    let binding = null;
    let resolutionSource = "project_default";

    if (explicitRuntimeId) {
      binding = await readProjectRuntimeBinding(env.DB, projectId, explicitRuntimeId);
      resolutionSource = "explicit";
      if (!binding) {
        return {
          ok: false,
          error: "runtime_not_bound",
          message: "OpenClaw runtime is not bound to this project",
          project_id: projectId,
          runtime_id: explicitRuntimeId
        };
      }
    } else {
      const bindings = (await listProjectRuntimeBindings(env.DB, projectId))
        .filter(item => item.is_enabled && item.runtime?.is_enabled);
      const defaults = bindings.filter(item => item.is_default);
      if (defaults.length === 1) {
        binding = defaults[0];
      } else if (bindings.length === 1) {
        binding = bindings[0];
        warnings.push("Inferred OpenClaw runtime from the only enabled project binding");
        warnRuntimeResolution("project_single_binding_inference", {
          project_id: projectId,
          runtime_id: binding.runtime_id
        });
      } else if (bindings.length > 1) {
        return {
          ok: false,
          error: "runtime_required",
          message: "Project has multiple enabled OpenClaw runtimes. Select runtime_id explicitly or set a default.",
          project_id: projectId,
          runtimes: bindings.map(item => ({
            runtime_id: item.runtime_id,
            display_name: item.runtime?.display_name || item.runtime_id,
            is_default: item.is_default
          }))
        };
      }
    }

    if (!binding) {
      return {
        ok: false,
        error: "runtime_required",
        message: "Project has no enabled OpenClaw runtime binding. Bind a runtime or select runtime_id explicitly.",
        project_id: projectId,
        runtimes: []
      };
    }

    if (!binding.is_enabled || !binding.runtime?.is_enabled) {
      return {
        ok: false,
        error: "runtime_disabled",
        message: "OpenClaw runtime is disabled for this project",
        project_id: projectId,
        runtime_id: binding.runtime_id
      };
    }

    const executionMode = requestedExecutionMode === "bridge"
      ? "bridge"
      : (binding.runtime.bridge_mode || requestedExecutionMode || "legacy");
    if (!runtimeSupportsExecutionMode(binding.runtime, executionMode)) {
      return {
        ok: false,
        error: "runtime_mode_unsupported",
        message: "OpenClaw runtime does not support requested execution mode",
        project_id: projectId,
        runtime_id: binding.runtime_id,
        execution_mode: executionMode
      };
    }

    return {
      ok: true,
      project_id: projectId,
      runtime_id: binding.runtime_id,
      runtime_slug: binding.runtime?.slug || "",
      provider_id: binding.runtime?.provider_id || cleanText(options.providerId || options.provider_id, 160),
      agent_id: agentFromBinding(binding, requestedAgentId, modelAgentId),
      execution_mode: executionMode,
      resolution_source: resolutionSource,
      warnings
    };
  } catch (err) {
    warnings.push("Runtime registry unavailable; using legacy runtime fallback");
    warnRuntimeResolution("legacy_fallback", {
      reason: "registry_unavailable",
      project_id: projectId,
      error: err?.message || String(err)
    });
    return {
      ok: true,
      project_id: projectId,
      runtime_id: "",
      runtime_slug: "",
      provider_id: cleanText(options.providerId || options.provider_id, 160),
      agent_id: requestedAgentId || modelAgentId || "",
      execution_mode: requestedExecutionMode,
      resolution_source: "legacy_fallback",
      warnings,
      detail: err?.message || String(err)
    };
  }
}

function patchRuntimeValues(current, body) {
  const next = {
    display_name: body.display_name === undefined ? current.display_name : cleanText(body.display_name, 160),
    slug: body.slug === undefined ? current.slug : cleanText(body.slug, 160),
    provider_id: body.provider_id === undefined ? current.provider_id : cleanText(body.provider_id, 160),
    base_url: body.base_url === undefined ? current.base_url : cleanText(body.base_url, 1000),
    callback_url: body.callback_url === undefined ? current.callback_url : cleanText(body.callback_url, 1000),
    capabilities_json: body.capabilities_json === undefined && body.capabilities === undefined
      ? current.capabilities_json
      : normalizeJsonField(body.capabilities_json === undefined ? body.capabilities : body.capabilities_json, {}),
    agents_json: body.agents_json === undefined && body.agents === undefined
      ? current.agents_json
      : normalizeJsonField(body.agents_json === undefined ? body.agents : body.agents_json, []),
    bridge_mode: body.bridge_mode === undefined ? current.bridge_mode : cleanText(body.bridge_mode, 40),
    status: body.status === undefined ? current.status : cleanText(body.status, 80),
    is_enabled: body.is_enabled === undefined ? (current.is_enabled ? 1 : 0) : normalizeEnabled(body.is_enabled),
    last_verified_at: body.last_verified_at === undefined ? current.last_verified_at : cleanText(body.last_verified_at, 80)
  };

  if (!next.display_name) {
    throw new Error("display_name is required");
  }
  if (!next.slug) {
    throw new Error("slug is required");
  }
  return next;
}

export async function handleOpenClawRuntimes(request, env, url) {
  const projectBindingsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/openclaw-runtimes$/);
  const projectBindingMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/openclaw-runtimes\/([^/]+)$/);
  if (!url.pathname.startsWith("/api/openclaw/runtimes") && !projectBindingsMatch && !projectBindingMatch) {
    return null;
  }
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured"
    }, 500);
  }

  if (projectBindingsMatch) {
    const projectId = decodeURIComponent(projectBindingsMatch[1]);
    if (request.method === "GET") {
      return jsonResponse({
        ok: true,
        project_id: projectId,
        runtimes: await listProjectRuntimeBindings(env.DB, projectId)
      });
    }

    if (request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({
          ok: false,
          error: "Request body must be JSON"
        }, 400);
      }
      const runtimeId = cleanId(body.runtime_id || body.runtimeId);
      if (!runtimeId) {
        return jsonResponse({
          ok: false,
          error: "runtime_id is required"
        }, 400);
      }
      const runtime = await readRuntime(env.DB, runtimeId);
      if (!runtime) {
        return jsonResponse({
          ok: false,
          error: "runtime not found"
        }, 404);
      }

      const isDefault = normalizeBoolean(body.is_default ?? body.isDefault, false);
      const isEnabled = normalizeBoolean(body.is_enabled ?? body.isEnabled, true);
      let allowedAgentsJson = "[]";
      try {
        allowedAgentsJson = normalizeStringListJson(body.allowed_agents_json ?? body.allowedAgents ?? body.allowed_agents) || "[]";
      } catch (err) {
        return jsonResponse({
          ok: false,
          error: err.message || "invalid allowed agents"
        }, 400);
      }
      const defaultAgentId = cleanText(body.default_agent_id || body.defaultAgentId, 160);
      const timestamp = isoNow();
      const defaultRejection = bridgeDefaultRejection({ runtime }, isDefault, isEnabled);
      if (defaultRejection) {
        return jsonResponse({
          ok: false,
          error: "runtime_default_unsupported",
          message: defaultRejection,
          runtime_id: runtimeId
        }, 400);
      }

      if (isDefault) {
        await env.DB.prepare(
          `UPDATE project_openclaw_runtime_bindings
           SET is_default = 0,
             updated_at = ?
           WHERE project_id = ?`
        ).bind(timestamp, projectId).run();
      }

      await env.DB.prepare(
        `INSERT INTO project_openclaw_runtime_bindings (
          project_id,
          runtime_id,
          is_default,
          is_enabled,
          allowed_agents_json,
          default_agent_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, runtime_id) DO UPDATE SET
          is_default = excluded.is_default,
          is_enabled = excluded.is_enabled,
          allowed_agents_json = excluded.allowed_agents_json,
          default_agent_id = excluded.default_agent_id,
          updated_at = excluded.updated_at`
      ).bind(
        projectId,
        runtimeId,
        isDefault ? 1 : 0,
        isEnabled ? 1 : 0,
        allowedAgentsJson,
        defaultAgentId,
        timestamp,
        timestamp
      ).run();

      return jsonResponse({
        ok: true,
        binding: await readProjectRuntimeBinding(env.DB, projectId, runtimeId)
      });
    }

    return jsonResponse({
      ok: false,
      error: "Method not allowed"
    }, 405);
  }

  if (projectBindingMatch) {
    const projectId = decodeURIComponent(projectBindingMatch[1]);
    const runtimeId = decodeURIComponent(projectBindingMatch[2]);
    const current = await readProjectRuntimeBinding(env.DB, projectId, runtimeId);
    if (!current) {
      return jsonResponse({
        ok: false,
        error: "runtime binding not found"
      }, 404);
    }

    if (request.method === "DELETE") {
      await env.DB.prepare(
        `DELETE FROM project_openclaw_runtime_bindings
         WHERE project_id = ?
           AND runtime_id = ?`
      ).bind(projectId, runtimeId).run();
      return jsonResponse({
        ok: true
      });
    }

    if (request.method !== "PATCH") {
      return jsonResponse({
        ok: false,
        error: "Method not allowed"
      }, 405);
    }

    let body = {};
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Request body must be JSON"
      }, 400);
    }

    const isDefault = normalizeBoolean(body.is_default ?? body.isDefault, current.is_default);
    const isEnabled = normalizeBoolean(body.is_enabled ?? body.isEnabled, current.is_enabled);
    let allowedAgentsJson = current.allowed_agents_json;
    try {
      allowedAgentsJson = normalizeStringListJson(body.allowed_agents_json ?? body.allowedAgents ?? body.allowed_agents) || allowedAgentsJson;
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: err.message || "invalid allowed agents"
      }, 400);
    }
    const defaultAgentId = body.default_agent_id === undefined && body.defaultAgentId === undefined
      ? current.default_agent_id
      : cleanText(body.default_agent_id || body.defaultAgentId, 160);
    const timestamp = isoNow();
    const defaultRejection = bridgeDefaultRejection(current, isDefault, isEnabled);
    if (defaultRejection) {
      return jsonResponse({
        ok: false,
        error: "runtime_default_unsupported",
        message: defaultRejection,
        runtime_id: runtimeId
      }, 400);
    }

    if (isDefault) {
      await env.DB.prepare(
        `UPDATE project_openclaw_runtime_bindings
         SET is_default = 0,
           updated_at = ?
         WHERE project_id = ?`
      ).bind(timestamp, projectId).run();
    }

    await env.DB.prepare(
      `UPDATE project_openclaw_runtime_bindings
       SET is_default = ?,
         is_enabled = ?,
         allowed_agents_json = ?,
         default_agent_id = ?,
         updated_at = ?
       WHERE project_id = ?
         AND runtime_id = ?`
    ).bind(
      isDefault ? 1 : 0,
      isEnabled ? 1 : 0,
      allowedAgentsJson,
      defaultAgentId,
      timestamp,
      projectId,
      runtimeId
    ).run();

    return jsonResponse({
      ok: true,
      binding: await readProjectRuntimeBinding(env.DB, projectId, runtimeId)
    });
  }

  if (request.method === "GET" && url.pathname === "/api/openclaw/runtimes") {
    return jsonResponse({
      ok: true,
      runtimes: await listRuntimes(env.DB)
    });
  }

  const match = url.pathname.match(/^\/api\/openclaw\/runtimes\/([^/]+)$/);
  if (!match) {
    return jsonResponse({
      ok: false,
      error: "Not found"
    }, 404);
  }

  const runtimeId = decodeURIComponent(match[1]);
  const current = await readRuntime(env.DB, runtimeId);
  if (!current) {
    return jsonResponse({
      ok: false,
      error: "runtime not found"
    }, 404);
  }

  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      runtime: current
    });
  }

  if (request.method === "PATCH") {
    let body = {};
    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Request body must be JSON"
      }, 400);
    }

    let next = null;
    try {
      next = patchRuntimeValues(current, body || {});
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: err.message || "invalid runtime payload"
      }, 400);
    }

    const timestamp = isoNow();
    try {
      await env.DB.prepare(
        `UPDATE openclaw_runtimes
         SET display_name = ?,
           slug = ?,
           provider_id = ?,
           base_url = ?,
           callback_url = ?,
           capabilities_json = ?,
           agents_json = ?,
           bridge_mode = ?,
           status = ?,
           is_enabled = ?,
           last_verified_at = ?,
           updated_at = ?
         WHERE id = ?`
      ).bind(
        next.display_name,
        next.slug,
        next.provider_id,
        next.base_url,
        next.callback_url,
        next.capabilities_json,
        next.agents_json,
        next.bridge_mode,
        next.status,
        next.is_enabled,
        next.last_verified_at,
        timestamp,
        runtimeId
      ).run();
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "failed to update runtime",
        detail: err?.message || String(err)
      }, 409);
    }

    return jsonResponse({
      ok: true,
      runtime: await readRuntime(env.DB, runtimeId)
    });
  }

  return jsonResponse({
    ok: false,
    error: "Method not allowed"
  }, 405);
}
