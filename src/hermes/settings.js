// Hermes common run settings: only fields Hermes /v1/runs actually accepts.
// Writable today: model_options.reasoning (+ optional service_tier) and provider/model
// (already on the run create body). Max turns / max_iterations come from server policy
// and are NOT accepted on the runs body — exposed as an honest gap. Approval policy is
// Worker-enforced (once_or_deny) and display-only.

import { HERMES_APPROVAL_CHOICES, HERMES_APPROVAL_POLICY } from "./permissions.js";
import { HermesError } from "./errors.js";

export const HERMES_REASONING_EFFORTS = Object.freeze([
  "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"
]);

const SERVICE_TIER_MAX = 32;

function cleanEffort(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return HERMES_REASONING_EFFORTS.includes(text) ? text : "";
}

function cleanServiceTier(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text.length > SERVICE_TIER_MAX || /[\u0000-\u001f\u007f]/.test(text)) return "";
  if (!/^[a-z0-9_-]+$/.test(text)) return "";
  return text;
}

/**
 * Normalize client model_options for /v1/runs.
 * Empty / missing => inherit (omit from upstream body).
 * Returns { ok:true, modelOptions, inherit:boolean } or { ok:false, code, message }.
 */
export function parseHermesModelOptions(raw) {
  if (raw == null || raw === "") {
    return { ok: true, inherit: true, modelOptions: null };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "hermes_invalid_model_options", message: "model_options must be an object" };
  }
  const keys = Object.keys(raw);
  const allowed = new Set(["reasoning", "service_tier", "fast"]);
  for (const key of keys) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: "hermes_unsupported_model_option",
        message: "Unsupported model_options field: " + key
      };
    }
  }

  const out = {};
  if (Object.prototype.hasOwnProperty.call(raw, "reasoning")) {
    const reasoning = raw.reasoning;
    if (reasoning == null) {
      // explicit null => inherit reasoning
    } else if (typeof reasoning !== "object" || Array.isArray(reasoning)) {
      return { ok: false, code: "hermes_invalid_reasoning", message: "model_options.reasoning must be an object" };
    } else {
      const block = {};
      if (Object.prototype.hasOwnProperty.call(reasoning, "enabled")) {
        if (typeof reasoning.enabled !== "boolean") {
          return { ok: false, code: "hermes_invalid_reasoning", message: "reasoning.enabled must be boolean" };
        }
        block.enabled = reasoning.enabled;
      }
      if (Object.prototype.hasOwnProperty.call(reasoning, "effort")) {
        const effort = cleanEffort(reasoning.effort);
        if (!effort) {
          return {
            ok: false,
            code: "hermes_invalid_reasoning_effort",
            message: "reasoning.effort must be one of: " + HERMES_REASONING_EFFORTS.join(", ")
          };
        }
        block.effort = effort;
        if (!Object.prototype.hasOwnProperty.call(block, "enabled")) block.enabled = effort !== "none";
      }
      if (!Object.keys(block).length) {
        return { ok: false, code: "hermes_invalid_reasoning", message: "reasoning requires enabled and/or effort" };
      }
      out.reasoning = block;
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, "service_tier")) {
    if (raw.service_tier == null || raw.service_tier === "") {
      // inherit
    } else {
      const tier = cleanServiceTier(raw.service_tier);
      if (!tier) {
        return { ok: false, code: "hermes_invalid_service_tier", message: "service_tier is invalid" };
      }
      out.service_tier = tier;
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, "fast")) {
    if (typeof raw.fast !== "boolean") {
      return { ok: false, code: "hermes_invalid_model_options", message: "fast must be boolean" };
    }
    if (raw.fast) out.fast = true;
  }

  if (!Object.keys(out).length) {
    return { ok: true, inherit: true, modelOptions: null };
  }
  return { ok: true, inherit: false, modelOptions: out };
}

export function requireHermesModelOptions(raw) {
  const parsed = parseHermesModelOptions(raw);
  if (!parsed.ok) {
    throw new HermesError(parsed.code, parsed.message, { httpStatus: 400 });
  }
  return parsed;
}

/**
 * Read-only settings panel payload. Distinguishes request / session / global scopes.
 * Writable flags reflect what the Worker will forward to Hermes — never invent admin APIs.
 */
export function buildHermesRunSettingsPanel({ catalog, capabilities } = {}) {
  const features = capabilities?.features || catalog?.capabilities?.features || {};
  const modelOptionsFeature = features.model_options === true;
  const agents = Array.isArray(catalog?.agents) ? catalog.agents : [];
  const agent = agents[0] || null;
  const defaultProvider = agent?.defaultProvider || catalog?.defaultProvider || "";
  const defaultModel = agent?.defaultModel || catalog?.defaultModel || "";

  return {
    object: "hermes.run_settings",
    scopes: {
      request: {
        label: "后续请求（本浏览器）",
        description: "写入后续 Hermes 执行请求（本浏览器本地偏好）；默认继承，仅在覆盖时发送 model_options / provider / model。Worker 按 Hermes v0.22.5 api_server 契约转发 model_options.reasoning / service_tier。"
      },
      session: {
        label: "当前会话",
        description: "Hermes 可在会话上持久化 model lock；本面板不通过聊天命令或伪造管理 API 修改会话锁。",
        writableViaWorkbench: false,
        note: "会话级 model lock（POST /api/sessions/{id}/model）未在本阶段对普通用户开放写入，避免扩大权限。"
      },
      global: {
        label: "全局配置",
        description: "Hermes config.yaml / .env / API Key 不在 Web 面修改。",
        writable: false
      }
    },
    defaults: {
      inherit: true,
      provider: defaultProvider || null,
      model: defaultModel || null
    },
    fields: {
      reasoning_effort: {
        writable: modelOptionsFeature,
        inheritDefault: true,
        efforts: modelOptionsFeature ? [...HERMES_REASONING_EFFORTS] : [],
        requestPath: "model_options.reasoning.effort",
        unavailableReason: modelOptionsFeature ? null : "Upstream does not advertise model_options"
      },
      provider_model: {
        writable: true,
        inheritDefault: true,
        requestPath: "provider + model",
        note: "空 provider/model = Agent 默认（agent_default）；显式选择会写入 runs 请求体。"
      },
      service_tier: {
        writable: modelOptionsFeature,
        inheritDefault: true,
        requestPath: "model_options.service_tier",
        unavailableReason: modelOptionsFeature ? null : "Upstream does not advertise model_options"
      },
      max_turns: {
        writable: false,
        inheritDefault: true,
        unavailableReason: "Hermes max_iterations / max turns come from server policy; not accepted on POST /v1/runs body"
      },
      approval_policy: {
        writable: false,
        displayOnly: true,
        policy: HERMES_APPROVAL_POLICY,
        choices: [...HERMES_APPROVAL_CHOICES],
        note: "Worker 仅转发 once / deny；session/permanent 授权不会从浏览器扩大。"
      }
    },
    gaps: [
      {
        id: "max_turns",
        summary: "执行轮数上限不可在 Web 设置中覆盖",
        detail: "api_server 从策略/_current_max_iterations 读取，未从 runs model_options 接受 max_turns。"
      },
      {
        id: "session_model_lock_write",
        summary: "会话级 model lock 写入未对 Web 用户开放",
        detail: "避免通过 Web 模拟 admin 或扩大 Hermes 管理面；请求级覆盖仍可用。"
      },
      {
        id: "config_yaml",
        summary: "不修改 Hermes config.yaml / .env / API Key",
        detail: "全局配置保持后端管理。"
      }
    ]
  };
}
