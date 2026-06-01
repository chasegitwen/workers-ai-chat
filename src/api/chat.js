import { corsHeaders } from "../utils/response.js";
import { getRelevantFileChunksByIds } from "./files.js";
import {
  ensureConversation,
  saveMessage,
  titleFromMessage
} from "./history.js";
import {
  buildConversationContext,
  maybeUpdateConversationSummary
} from "./summary.js";
import { DEFAULT_TEXT_MODEL, MODELS } from "../providers/models.js";
import { callModel } from "../providers/router.js";
import { callOpenAICompatible } from "../providers/openaiCompatible.js";
import { getModelRuntimeConfig } from "../providers/config.js";
import { callWorkersAI } from "../providers/workersai.js";
import { normalizeProviderError, ProviderError } from "../providers/errors.js";
import { filterEmptySystemMessages } from "../providers/messages.js";
import { runTool } from "../tools/registry.js";

const defaultSystemMessage = {
  role: "system",
  content: "\u4f60\u662f\u4e00\u4e2a\u7f51\u9875 AI \u52a9\u624b\uff0c\u8bf7\u7b80\u6d01\u3001\u51c6\u786e\u3001\u53cb\u597d\u5730\u56de\u7b54\u3002\u53ef\u4ee5\u4f7f\u7528 Markdown\u3002"
};

const MAX_AUTO_URL_LENGTH = 2048;
const MAX_AUTO_SEARCH_QUERY_LENGTH = 300;
const MAX_TOOL_DEBUG_SUMMARY_LENGTH = 120;
const MAX_IMAGE_ATTACHMENTS = 3;
const BROWSER_TOOL_TIMEOUT_MS = 60000;
const MODEL_SETTINGS_KEY = "model_settings";
const AUTO_SEARCH_PATTERN = /搜索|查一下|查询|联网查|最新|最近|今天|现在|当前|目前|官网|价格|新闻|发布|更新|\bsearch\b|\blook up\b|\blatest\b|\brecent\b|\btoday\b|\bcurrent\b|\bnow\b|\bnews\b|\bprice\b|\brelease\b|\bupdate\b|\bofficial\b/i;

function getUserMessage(messages) {
  const userMessage = [...(messages || [])]
    .reverse()
    .find(message => message.role === "user");

  return (userMessage?.content || "").trim();
}

function cleanCandidateUrl(value) {
  return String(value || "").replace(/[)\].,;!?，。；！？）】]+$/u, "");
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".");

  if (parts.length !== 4 || !parts.every(part => /^\d+$/.test(part))) {
    return false;
  }

  const numbers = parts.map(part => Number(part));

  if (numbers.some(value => value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = numbers;

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedHostname(hostname) {
  const host = String(hostname || "").toLowerCase();

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    isPrivateIPv4(host)
  );
}

function isPrivateBrowserIPv4(hostname) {
  const parts = String(hostname || "").split(".");

  if (parts.length !== 4 || !parts.every(part => /^\d+$/.test(part))) {
    return false;
  }

  const numbers = parts.map(part => Number(part));

  if (numbers.some(value => value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = numbers;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function validateBrowserUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      ok: false,
      error: "URL is required"
    };
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch (err) {
    return {
      ok: false,
      error: "Invalid URL"
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "Only http and https URLs are allowed"
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const bareHostname = hostname.replace(/^\[|\]$/g, "");

  if (
    !bareHostname ||
    bareHostname === "localhost" ||
    bareHostname.endsWith(".localhost") ||
    bareHostname === "::1" ||
    bareHostname === "0.0.0.0" ||
    isPrivateBrowserIPv4(bareHostname)
  ) {
    return {
      ok: false,
      error: "Private or local URLs are not allowed"
    };
  }

  return {
    ok: true,
    url: parsed.href
  };
}

function browserJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function callBrowserTool(env, payload) {
  const endpoint = String(env.BROWSER_TOOL_ENDPOINT || "").trim();
  const authMode = String(env.BROWSER_TOOL_AUTH_MODE || "").trim().toLowerCase();
  const debug = {
    timeoutMs: BROWSER_TOOL_TIMEOUT_MS,
    endpointConfigured: Boolean(endpoint),
    authMode: authMode || "none"
  };

  if (!endpoint) {
    return {
      ok: false,
      error: "BROWSER_TOOL_ENDPOINT is not configured",
      debug
    };
  }

  const token = String(env.BROWSER_TOOL_TOKEN || "").trim();
  const headers = {
    "Content-Type": "application/json"
  };

  if (token && authMode === "x-browser-token") {
    headers["X-Browser-Token"] = token;
  } else if (token && authMode === "bearer") {
    headers.Authorization = "Bearer " + token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSER_TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      data = {
        text
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: data.error || "Browser tool upstream request failed",
        details: data.details || text || ("HTTP " + response.status),
        debug
      };
    }

    return {
      ok: true,
      url: data.url || payload.url,
      title: data.title || "",
      text: data.text || data.extractedText || "",
      screenshot: data.screenshot || data.screenshotBase64 || data.screenshotUrl || "",
      metadata: data.metadata || {}
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === "AbortError" ? "Browser tool request timed out" : "Browser tool request failed",
      details: err.message || String(err),
      debug
    };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectBrowserToolEndpoint(env) {
  const endpoint = String(env.BROWSER_TOOL_ENDPOINT || "").trim();

  if (!endpoint) {
    return {
      ok: false,
      error: "BROWSER_TOOL_ENDPOINT is not configured"
    };
  }

  let parsed;

  try {
    parsed = new URL(endpoint);
  } catch (err) {
    return {
      ok: false,
      error: "BROWSER_TOOL_ENDPOINT is not a valid URL"
    };
  }

  const endpointText = (parsed.hostname + " " + parsed.pathname).toLowerCase();
  const token = String(env.BROWSER_TOOL_TOKEN || "").trim();
  const authMode = String(env.BROWSER_TOOL_AUTH_MODE || "").trim().toLowerCase();
  const headers = {
    "Content-Type": "application/json"
  };

  if (token && authMode === "x-browser-token") {
    headers["X-Browser-Token"] = token;
  } else if (token && authMode === "bearer") {
    headers.Authorization = "Bearer " + token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSER_TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "https://example.com",
        mode: "extract"
      }),
      signal: controller.signal
    });
    const bodyText = await response.text();
    const responseHeaders = {};

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: true,
      endpoint: {
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        contains: {
          novnc: endpointText.includes("novnc"),
          vnc: endpointText.includes("vnc"),
          websockify: endpointText.includes("websockify"),
          playwright: endpointText.includes("playwright"),
          browser: endpointText.includes("browser"),
          openclaw: endpointText.includes("openclaw")
        }
      },
      upstream: {
        status: response.status,
        headers: responseHeaders,
        bodyPrefix: bodyText.slice(0, 200)
      }
    };
  } catch (err) {
    return {
      ok: false,
      endpoint: {
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        contains: {
          novnc: endpointText.includes("novnc"),
          vnc: endpointText.includes("vnc"),
          websockify: endpointText.includes("websockify"),
          playwright: endpointText.includes("playwright"),
          browser: endpointText.includes("browser"),
          openclaw: endpointText.includes("openclaw")
        }
      },
      error: err.name === "AbortError" ? "Browser tool request timed out" : "Browser tool request failed",
      details: err.message || String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleBrowserRequest(request, env) {
  let body = {};

  try {
    body = await request.json();
  } catch (err) {
    return browserJsonResponse({
      ok: false,
      error: "Invalid JSON request body"
    }, 400);
  }

  const validation = validateBrowserUrl(body.url);

  if (!validation.ok) {
    return browserJsonResponse({
      ok: false,
      error: validation.error
    }, 400);
  }

  const mode = ["extract", "screenshot", "full"].includes(body.mode)
    ? body.mode
    : "full";
  const result = await callBrowserTool(env, {
    url: validation.url,
    mode
  });

  return browserJsonResponse(result, result.ok ? 200 : 502);
}

function getAutoFetchToolCall(userContent) {
  const match = String(userContent || "").match(/https?:\/\/[^\s<>"']+/i);

  if (!match) {
    return null;
  }

  const candidate = cleanCandidateUrl(match[0]);

  if (!candidate || candidate.length > MAX_AUTO_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (isBlockedHostname(url.hostname)) {
      return null;
    }

    return {
      name: "fetch_url",
      args: {
        url: url.href
      }
    };
  } catch (err) {
    return null;
  }
}

function hasBlockedUrl(userContent) {
  const matches = String(userContent || "").match(/https?:\/\/[^\s<>"']+/gi) || [];

  return matches.some(value => {
    const candidate = cleanCandidateUrl(value);

    if (!candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return isBlockedHostname(url.hostname);
    } catch (err) {
      return false;
    }
  });
}

function cleanSearchQuery(userContent) {
  return String(userContent || "")
    .replace(/^\s*(帮我|请|麻烦你|麻烦|给我)?\s*(搜索|查一下|查询|联网查)\s*/i, "")
    .replace(/^\s*(please\s+)?(search|look up)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_AUTO_SEARCH_QUERY_LENGTH);
}

function isSearchQueryLongEnough(query) {
  const compact = String(query || "").trim();
  const chineseChars = compact.match(/[\u4e00-\u9fff]/g) || [];
  const latinChars = compact.match(/[a-z]/gi) || [];

  return chineseChars.length >= 2 || latinChars.length >= 3;
}

function getAutoSearchToolCall(userContent) {
  if (!AUTO_SEARCH_PATTERN.test(userContent || "")) {
    return null;
  }

  if (hasBlockedUrl(userContent)) {
    return null;
  }

  const query = cleanSearchQuery(userContent);

  if (!isSearchQueryLongEnough(query)) {
    return null;
  }

  return {
    name: "web_search",
    args: {
      query
    }
  };
}

function readStreamText(value) {
  if (value === "[DONE]") {
    return "";
  }

  try {
    const data = JSON.parse(value);

    return (
      data.response ||
      data.result?.response ||
      data.output_text ||
      data.text ||
      data.choices?.[0]?.delta?.content ||
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      ""
    );
  } catch (err) {
    return "";
  }
}

function createModelSelectionError(message) {
  const error = new Error(message);
  error.name = "ModelSelectionError";
  return error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeImageAttachment(attachment, index) {
    if (!isPlainObject(attachment)) {
      throw createModelSelectionError("Invalid image attachment at index " + index);
    }

    const type = String(attachment.type || "");
    const mimeType = String(attachment.mimeType || "");
    const dataUrl = String(attachment.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);

    if (type !== "image") {
      throw createModelSelectionError("Invalid image attachment type at index " + index);
    }

    if (!mimeType.startsWith("image/")) {
      throw createModelSelectionError("Invalid image attachment mimeType at index " + index);
    }

    if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) {
      throw createModelSelectionError("Invalid image attachment dataUrl at index " + index);
    }

    try {
      atob(match[2].replace(/\s/g, ""));
    } catch (err) {
      throw createModelSelectionError("Invalid image attachment base64 at index " + index);
    }

    return {
      type: "image",
      mimeType,
      dataUrl
    };
}

function normalizeImageAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_IMAGE_ATTACHMENTS).map((attachment, index) => {
    return normalizeImageAttachment(attachment, index);
  });
}

function imageDataUrlToAttachment(dataUrl, index = 0) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);

  if (!match) {
    throw createModelSelectionError("Invalid image dataUrl");
  }

  return normalizeImageAttachment({
    type: "image",
    mimeType: match[1],
    dataUrl: value
  }, index);
}

function buildMultimodalUserContent(text, attachments) {
  return [
    {
      type: "text",
      text
    },
    ...attachments.map(attachment => ({
      type: "image_url",
      image_url: {
        url: attachment.dataUrl
      }
    }))
  ];
}

function countProviderImages(messages) {
  return (messages || []).reduce((count, message) => {
    if (!Array.isArray(message?.content)) {
      return count;
    }

    return count + message.content.filter(part => part?.type === "image_url").length;
  }, 0);
}

function providerLabelFromModel(model) {
  if ((model.provider || "") === "cloudflare-proxied") {
    return "Cloudflare proxied Claude";
  }

  if ((model.provider || "") === "glm") {
    return "GLM Coding";
  }

  if ((model.provider || "") === "kimi") {
    return "Kimi";
  }

  if (model.providerType === "openai-compatible") {
    return "Custom OpenAI-compatible";
  }

  return "Workers AI";
}

function providersFromModels(models) {
  const providers = new Map();

  (models || []).forEach(model => {
    if (model.deprecated || model.enabled === false || !model.capabilities?.text) {
      return;
    }

    const isClaudeCompatible = (model.provider || "") === "cloudflare-proxied" ||
      String(model.id || model.modelName || "").startsWith("anthropic/claude");
    const providerType = isClaudeCompatible ? "claude-compatible" : (model.providerType || "workers-ai");
    const providerId = isClaudeCompatible ? (model.provider || "cloudflare-proxied") : (model.provider || model.providerType || "workers-ai");

    if (!providers.has(providerId)) {
      providers.set(providerId, {
        id: providerId,
        label: providerLabelFromModel(model),
        providerType,
        apiBase: model.apiBase || "",
        apiKeyEnv: model.apiKeyEnv || "",
        builtin: true,
        models: []
      });
    }

    providers.get(providerId).models.push({
      id: model.id,
      label: model.label || model.id,
      modelName: model.modelName || model.id,
      providerType,
      apiBase: model.apiBase || "",
      apiKeyEnv: model.apiKeyEnv || "",
      capabilities: model.capabilities || { text: true, streaming: true },
      enabled: model.enabled !== false,
      recommended: Boolean(model.recommended)
    });
  });

  return Array.from(providers.values());
}

function normalizeProvider(provider) {
  if (!isPlainObject(provider)) {
    return null;
  }

  const id = String(provider.providerId || provider.id || provider.provider || "").trim();

  if (!id) {
    return null;
  }

  return {
    id,
    label: String(provider.providerName || provider.label || id),
    providerType: String(provider.providerType || provider.type || provider.category || id || "workers-ai"),
    apiBase: String(provider.apiBase || provider.baseUrl || ""),
    apiKeyEnv: String(provider.apiKeyEnv || ""),
    builtin: Boolean(provider.builtin),
    enabled: provider.enabled !== false,
    models: Array.isArray(provider.models)
      ? provider.models
        .map(model => normalizeProviderModel(model, provider))
        .filter(Boolean)
      : []
  };
}

function normalizeProviderModel(model, provider) {
  if (!isPlainObject(model)) {
    return null;
  }

  const id = String(model.modelId || model.id || model.model || model.modelName || "").trim();

  if (!id) {
    return null;
  }

  return {
    id,
    label: String(model.displayName || model.label || id),
    modelName: String(model.upstreamModelName || model.modelName || model.model || id),
    providerType: String(model.providerType || provider.providerType || "workers-ai"),
    apiBase: String(model.apiBase || model.baseUrl || provider.apiBase || ""),
    apiKeyEnv: String(model.apiKeyEnv || provider.apiKeyEnv || ""),
    capabilities: model.capabilities || { text: true, streaming: true },
    enabled: model.enabled !== false,
    recommended: Boolean(model.recommended)
  };
}

function mergeProviders(baseProviders, nextProviders) {
  const merged = new Map();

  (baseProviders || []).forEach(provider => {
    const normalized = normalizeProvider(provider);

    if (normalized) {
      merged.set(normalized.id, normalized);
    }
  });

  (nextProviders || []).forEach(provider => {
    const normalized = normalizeProvider(provider);

    if (!normalized) {
      return;
    }

    const existing = merged.get(normalized.id);

    if (!existing) {
      merged.set(normalized.id, normalized);
      return;
    }

    const models = new Map((existing.models || []).map(model => [model.id, model]));
    (normalized.models || []).forEach(model => models.set(model.id, {
      ...models.get(model.id),
      ...model
    }));

    merged.set(normalized.id, {
      ...existing,
      ...normalized,
      models: Array.from(models.values())
    });
  });

  return Array.from(merged.values());
}

function providersFromCategories(categories) {
  const providers = [];

  (categories || []).forEach(category => {
    const type = String(category?.type || category?.category || "").trim();

    if (type === "workers-hosted") {
      providers.push({
        id: "workers-ai",
        label: "Workers 托管",
        providerType: "workers-ai",
        apiBase: "",
        apiKeyEnv: "",
        builtin: true,
        enabled: true,
        models: (category.models || []).map(model => ({
          id: model.modelId || model.id,
          label: model.displayName || model.label || model.modelId || model.id,
          modelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
          providerType: "workers-ai",
          capabilities: model.capabilities || { text: true, streaming: true },
          enabled: model.enabled !== false
        }))
      });
      return;
    }

    if (type === "claude-compatible" || type === "openai-compatible") {
      (category.providers || []).forEach(provider => {
        providers.push({
          id: provider.providerId || provider.id,
          label: provider.providerName || provider.label || provider.providerId || provider.id,
          providerType: type,
          apiBase: provider.baseUrl || provider.apiBase || "",
          apiKeyEnv: provider.apiKeyEnv || "",
          builtin: Boolean(provider.builtin),
          enabled: provider.enabled !== false,
          models: (provider.models || []).map(model => ({
            id: model.modelId || model.id,
            label: model.displayName || model.label || model.modelId || model.id,
            modelName: model.upstreamModelName || model.modelName || model.modelId || model.id,
            providerType: type,
            capabilities: model.capabilities || { text: true, streaming: true },
            enabled: model.enabled !== false
          }))
        });
      });
    }
  });

  return providers.filter(provider => provider.id);
}

async function readSavedProviders(env) {
  if (!env.DB) {
    return [];
  }

  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = ?"
    ).bind(MODEL_SETTINGS_KEY).first();

    if (!row?.value) {
      return [];
    }

    const settings = JSON.parse(row.value);
    if (Array.isArray(settings?.providers) && settings.providers.length) {
      return settings.providers;
    }
    if (Array.isArray(settings?.categories) || Array.isArray(settings?.modelCategories)) {
      return providersFromCategories(settings.categories || settings.modelCategories);
    }
    return [];
  } catch (err) {
    console.warn("[model-settings] failed to read settings.providers", err.message || String(err));
    return [];
  }
}

function customConfigToProvider(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const provider = String(config.provider || "").trim();
  const id = String(config.id || config.modelName || config.model || "").trim();

  if (!provider || !id) {
    return null;
  }

  return {
    id: provider,
    label: provider,
    providerType: String(config.providerType || "openai-compatible"),
    apiBase: String(config.apiBase || config.baseUrl || ""),
    apiKeyEnv: String(config.apiKeyEnv || ""),
    models: [{
      id,
      label: String(config.label || id),
      modelName: String(config.modelName || config.model || id),
      providerType: String(config.providerType || "openai-compatible"),
      apiBase: String(config.apiBase || config.baseUrl || ""),
      apiKeyEnv: String(config.apiKeyEnv || ""),
      capabilities: config.capabilities || { text: true, streaming: true },
      enabled: true
    }]
  };
}

export async function buildModelProviderCatalog(env, requestProviders, customModelConfig, fallbackCustomModelConfig) {
  const defaultProviders = providersFromModels(MODELS);
  const savedProviders = await readSavedProviders(env);
  const customProviders = [
    customConfigToProvider(customModelConfig),
    customConfigToProvider(fallbackCustomModelConfig)
  ].filter(Boolean);

  return mergeProviders(
    mergeProviders(defaultProviders, savedProviders),
    mergeProviders(requestProviders || [], customProviders)
  );
}

function findProviderModel(providerCatalog, providerId, modelId) {
  const requestedProvider = String(providerId || "").trim();
  const requestedModel = String(modelId || "").trim();
  const enabledProviders = (providerCatalog || []).filter(item => item.enabled !== false);
  const provider = requestedProvider
    ? enabledProviders.find(item => item.id === requestedProvider)
    : enabledProviders.find(item => (item.models || []).some(model => model.enabled !== false && (model.id === requestedModel || model.modelName === requestedModel)));
  const model = provider
    ? (provider.models || []).find(item => item.enabled !== false && (item.id === requestedModel || item.modelName === requestedModel))
    : null;

  console.log("[model-validation]", {
    selectedProvider: requestedProvider || provider?.id || "",
    selectedModel: requestedModel,
    providerFound: Boolean(provider),
    modelFound: Boolean(model),
    providerModelsCount: provider?.models?.length || 0
  });

  return { provider, model };
}

function normalizeCustomModelConfig(config, { required = false } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    if (required) {
      throw createModelSelectionError("Custom model config is required");
    }
    return null;
  }

  const providerType = String(config.providerType || config.provider || "").trim();
  const apiBase = String(config.apiBase || config.baseUrl || "").trim();
  const apiKeyEnv = String(config.apiKeyEnv || "").trim();
  const modelName = String(config.modelName || config.model || config.id || "").trim();
  const id = String(config.id || modelName).trim();
  const provider = String(config.provider || "").trim();

  if (!provider) {
    throw createModelSelectionError("Unknown provider: " + (config.provider || ""));
  }

  if (providerType !== "openai-compatible") {
    throw createModelSelectionError("Unknown provider: " + provider);
  }

  if (!apiBase) {
    throw createModelSelectionError("OpenAI-compatible provider " + provider + " is missing baseUrl");
  }

  if (!apiKeyEnv) {
    throw createModelSelectionError("OpenAI-compatible provider " + provider + " is missing apiKeyEnv");
  }

  if (!modelName || !id) {
    throw createModelSelectionError("Unknown model for provider " + provider + ": " + (config.model || config.modelName || config.id || ""));
  }

  return {
    id,
    label: String(config.label || id),
    provider,
    providerType: "openai-compatible",
    apiBase,
    apiKeyEnv,
    modelName,
    capabilities: {
      text: true,
      streaming: true,
      ...(config.capabilities || {})
    },
    enabled: true
  };
}

export async function callSelectedModel({ env, provider, model, messages, stream, providerCatalog, max_tokens, temperature }) {
  const requestedModel = String(model || "").trim();
  const requestedProvider = String(provider || "").trim();
  const providerMessages = filterEmptySystemMessages(messages);

  if (!requestedModel) {
    throw createModelSelectionError("Model is required");
  }

  const { provider: selectedProvider, model: selectedModel } = findProviderModel(providerCatalog, requestedProvider, requestedModel);

  if (!selectedProvider) {
    throw createModelSelectionError("Unknown provider: " + requestedProvider);
  }

  if (!selectedModel) {
    throw createModelSelectionError("Unknown model for provider " + selectedProvider.id + ": " + requestedModel);
  }

  const providerType = selectedModel.providerType || selectedProvider.providerType;

  if (providerType === "openai-compatible") {
    const config = normalizeCustomModelConfig({
      id: selectedModel.id,
      label: selectedModel.label,
      provider: selectedProvider.id,
      providerType,
      apiBase: selectedModel.apiBase || selectedProvider.apiBase,
      apiKeyEnv: selectedModel.apiKeyEnv || selectedProvider.apiKeyEnv,
      modelName: selectedModel.modelName || selectedModel.id
    }, { required: true });

    if (!env[config.apiKeyEnv]) {
      throw new ProviderError("API key env " + config.apiKeyEnv + " is not configured", {
        provider: config.provider,
        model: config.id,
        code: "missing_api_key"
      });
    }

    const response = await callOpenAICompatible({
      env,
      config,
      messages: providerMessages,
      stream,
      max_tokens,
      temperature
    });

    return {
      provider: config.provider,
      providerType: config.providerType,
      model: config.id,
      modelName: config.modelName,
      stream: Boolean(stream),
      response
    };
  }

  if (providerType === "workers-ai" || providerType === "claude-compatible") {
    const runtimeConfig = getModelRuntimeConfig(selectedModel.id);
    const response = runtimeConfig
      ? (await callModel({
        env,
        model: selectedModel.id,
        messages: providerMessages,
        stream,
        max_tokens,
        temperature
      })).response
      : await callWorkersAI({
        env,
        model: selectedModel.modelName || selectedModel.id,
        messages: providerMessages,
        stream,
        max_tokens,
        temperature
      });

    return {
      provider: selectedProvider.id,
      providerType,
      model: selectedModel.id,
      modelName: selectedModel.modelName || selectedModel.id,
      stream: Boolean(stream),
      response
    };
  }

  throw createModelSelectionError("Unknown provider: " + selectedProvider.id);
}

function buildFileSources(fileChunks) {
  const seen = new Set();

  return (fileChunks || [])
    .map(chunk => ({
      file_id: chunk.fileId,
      filename: chunk.filename,
      chunk_index: chunk.chunkIndex,
      score: Number(chunk.score || 0),
      preview: String(chunk.content || "").slice(0, 400)
    }))
    .filter(source => {
      if (!source.file_id || source.chunk_index === undefined || source.chunk_index === null) {
        return false;
      }

      const key = source.file_id + ":" + source.chunk_index;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.filename !== b.filename) {
        return String(a.filename || "").localeCompare(String(b.filename || ""));
      }

      return Number(a.chunk_index || 0) - Number(b.chunk_index || 0);
    })
    .slice(0, 8);
}

function formatToolContext(toolCall) {
  if (!toolCall) {
    return "";
  }

  const result = toolCall.result || {};

  if (toolCall.name === "web_search") {
    const results = Array.isArray(result.results) ? result.results : [];
    const freshness = result.freshness || "";
    const freshnessLines = freshness
      ? [
        "Freshness: " + freshness,
        "",
        "本次问题需要最新信息。",
        "请优先依据下面搜索结果回答。",
        "优先使用带有发布日期、age 或 page_age 的结果。",
        "不要使用未经搜索结果支持的旧知识补充新闻细节。",
        "",
        "This query requires up-to-date information.",
        "Prioritize the search results below.",
        "Prefer results with publish dates, age, or page_age metadata.",
        "Do not add unsupported news details from model prior knowledge.",
        ""
      ]
      : [];

    return [
      "Tool result: web_search",
      "Query: " + (result.query || toolCall.args?.query || ""),
      ...freshnessLines,
      "",
      results.length
        ? results.map((item, index) => [
          "[" + (index + 1) + "] " + (item.title || "Untitled"),
          "URL: " + (item.url || ""),
          item.source ? "Source: " + item.source : "",
          item.age ? "Age: " + item.age : "",
          item.page_age ? "Page age: " + item.page_age : "",
          item.published ? "Published: " + item.published : "",
          "Snippet: " + (item.snippet || item.description || "")
        ].filter(Boolean).join("\n")).join("\n\n")
        : "No search results returned."
    ].join("\n");
  }

  if (toolCall.name === "fetch_url") {
    return [
      "Tool result: fetch_url",
      "Title: " + (result.title || "Untitled Page"),
      "URL: " + (result.url || toolCall.args?.url || ""),
      result.truncated ? "Note: content was truncated for prompt size." : "",
      "",
      result.text || result.content || ""
    ].filter(Boolean).join("\n");
  }

  return [
    "Tool result: " + toolCall.name,
    JSON.stringify(result, null, 2)
  ].join("\n");
}

function buildToolSources(toolCall) {
  if (!toolCall || toolCall.error) {
    return [];
  }

  const result = toolCall.result || {};

  if (toolCall.name === "web_search") {
    return (Array.isArray(result.results) ? result.results : [])
      .map(item => ({
        type: "web_search",
        title: item.title || "Untitled",
        url: item.url || "",
        snippet: item.snippet || item.description || "",
        age: item.age || "",
        page_age: item.page_age || "",
        published: item.published || "",
        source: item.source || "",
        freshness: result.freshness || ""
      }))
      .filter(source => source.url)
      .slice(0, 8);
  }

  if (toolCall.name === "fetch_url") {
    const preview = String(result.text || result.content || "").slice(0, 500);

    return result.url
      ? [{
        type: "fetch_url",
        title: result.title || "Untitled Page",
        url: result.url,
        snippet: preview,
        preview
      }]
      : [];
  }

  return [];
}

function getToolArgUrl(args = {}) {
  return String(args.url || args.pageUrl || "").trim();
}

function truncateDebugValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TOOL_DEBUG_SUMMARY_LENGTH);
}

function getToolTargetSummary(toolCall = {}) {
  if (toolCall.name === "fetch_url") {
    return {
      url: truncateDebugValue(getToolArgUrl(toolCall.args))
    };
  }

  if (toolCall.name === "web_search") {
    return {
      query: truncateDebugValue(toolCall.args?.query)
    };
  }

  return {};
}

function getToolResultDebug(result = {}) {
  if (!result || !Array.isArray(result.results)) {
    return {};
  }

  return {
    query: truncateDebugValue(result.query || ""),
    freshness: result.freshness || "none",
    result_count: result.results.length,
    results: result.results.map(item => ({
      title: truncateDebugValue(item.title || ""),
      age: item.age || "",
      page_age: item.page_age || "",
      published: item.published || "",
      source: item.source || ""
    }))
  };
}

function withToolTrigger(toolCall, trigger) {
  if (!toolCall) {
    return null;
  }

  return {
    ...toolCall,
    trigger
  };
}

function normalizeToolError(name, error, args = {}) {
  const rawMessage = String(error?.message || error || "");
  const recoverable = true;

  if (name === "web_search") {
    if (/BRAVE_SEARCH_API_KEY/i.test(rawMessage)) {
      return {
        name,
        message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u7f3a\u5c11 BRAVE_SEARCH_API_KEY",
        recoverable,
        code: "missing_brave_search_api_key"
      };
    }

    if (/HTTP\s+\d+/i.test(rawMessage)) {
      return {
        name,
        message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u641c\u7d22 API \u8fd4\u56de\u9519\u8bef",
        recoverable,
        code: "search_api_error"
      };
    }

    if (/timeout|timed out|network|fetch failed|AbortError/i.test(rawMessage)) {
      return {
        name,
        message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25\u6216\u8d85\u65f6",
        recoverable,
        code: "network_or_timeout"
      };
    }

    return {
      name,
      message: "\u8054\u7f51\u641c\u7d22\u5931\u8d25\uff1a\u672a\u77e5\u5de5\u5177\u9519\u8bef",
      recoverable,
      code: "unknown_tool_error"
    };
  }

  if (name === "fetch_url") {
    if (rawMessage === "invalid_url") {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1aURL \u4e0d\u5408\u6cd5",
        recoverable,
        code: "invalid_url"
      };
    }

    if (rawMessage === "blocked_private_url") {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u5185\u7f51\u6216\u672c\u5730\u5730\u5740\u5df2\u88ab\u62e6\u622a",
        recoverable,
        code: "blocked_private_url"
      };
    }

    if (/valid http:\/\/ or https:\/\/ url|invalid url/i.test(rawMessage)) {
      return normalizeToolError(name, "invalid_url", args);
    }

    if (/HTTP\s+\d+/i.test(rawMessage)) {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u65e0\u6cd5\u8bbf\u95ee\u8be5\u7f51\u9875",
        recoverable,
        code: "fetch_http_error"
      };
    }

    if (/timeout|timed out|network|fetch failed|AbortError/i.test(rawMessage)) {
      return {
        name,
        message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25\u6216\u8d85\u65f6",
        recoverable,
        code: "network_or_timeout"
      };
    }

    return {
      name,
      message: "\u7f51\u9875\u6293\u53d6\u5931\u8d25\uff1a\u672a\u77e5\u5de5\u5177\u9519\u8bef",
      recoverable,
      code: "unknown_tool_error"
    };
  }

  return {
    name,
    message: "\u5de5\u5177\u8c03\u7528\u5931\u8d25\uff1a\u672a\u77e5\u5de5\u5177\u9519\u8bef",
    recoverable,
    code: "unknown_tool_error"
  };
}

function validateToolCall(toolCall) {
  if (!toolCall?.name) {
    return null;
  }

  if (toolCall.name !== "fetch_url") {
    return null;
  }

  const targetUrl = getToolArgUrl(toolCall.args);

  if (!targetUrl || targetUrl.length > MAX_AUTO_URL_LENGTH) {
    return normalizeToolError("fetch_url", "invalid_url", toolCall.args);
  }

  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return normalizeToolError("fetch_url", "invalid_url", toolCall.args);
    }

    if (isBlockedHostname(url.hostname)) {
      return normalizeToolError("fetch_url", "blocked_private_url", toolCall.args);
    }
  } catch (err) {
    return normalizeToolError("fetch_url", "invalid_url", toolCall.args);
  }

  return null;
}

async function runRequestedTool(toolCall, env) {
  if (!toolCall || !toolCall.name) {
    return null;
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const trigger = toolCall.trigger || "explicit";
  const target = getToolTargetSummary(toolCall);

  console.log("[tool]", {
    name: toolCall.name,
    trigger,
    started_at: startedAt,
    target
  });

  const validationError = validateToolCall(toolCall);

  if (validationError) {
    const durationMs = Date.now() - startedAtMs;
    const debug = {
      name: toolCall.name,
      trigger,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "error",
      code: validationError.code || "unknown_tool_error",
      target
    };

    console.warn("[tool]", debug);

    return {
      name: toolCall.name,
      args: toolCall.args || {},
      trigger,
      error: validationError.message,
      toolError: validationError,
      debug,
      result: {
        error: validationError.message
      }
    };
  }

  try {
    const result = await runTool(toolCall.name, toolCall.args || {}, env);
    const durationMs = Date.now() - startedAtMs;
    const debug = {
      name: toolCall.name,
      trigger,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "success",
      code: null,
      target,
      result: getToolResultDebug(result.result)
    };

    console.log("[tool]", debug);

    return {
      ...result,
      trigger,
      debug
    };
  } catch (err) {
    const toolError = normalizeToolError(toolCall.name, err, toolCall.args);
    const durationMs = Date.now() - startedAtMs;
    const debug = {
      name: toolCall.name,
      trigger,
      started_at: startedAt,
      duration_ms: durationMs,
      status: "error",
      code: toolError.code || "unknown_tool_error",
      target
    };

    console.warn("[tool]", debug);

    return {
      name: toolCall.name,
      args: toolCall.args || {},
      trigger,
      error: toolError.message,
      toolError,
      debug,
      result: {
        error: toolError.message
      }
    };
  }
}

function getToolStatusMessage(name, status) {
  const messages = {
    web_search: {
      running: "\u6b63\u5728\u8054\u7f51\u641c\u7d22...",
      done: "\u8054\u7f51\u641c\u7d22\u5b8c\u6210",
      error: "\u8054\u7f51\u641c\u7d22\u5931\u8d25"
    },
    fetch_url: {
      running: "\u6b63\u5728\u6293\u53d6\u7f51\u9875...",
      done: "\u7f51\u9875\u6293\u53d6\u5b8c\u6210",
      error: "\u7f51\u9875\u6293\u53d6\u5931\u8d25"
    }
  };

  return messages[name]?.[status] || "";
}

function encodeSseEvent(event, data) {
  return (
    (event ? "event: " + event + "\n" : "") +
    "data: " + JSON.stringify(data) + "\n\n"
  );
}

function appendReplyFromSseBuffer(bufferState, replyState) {
  const events = bufferState.value.split("\n\n");
  bufferState.value = events.pop() || "";

  for (const event of events) {
    const lines = event
      .split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart());

    for (const line of lines) {
      replyState.value += readStreamText(line);
    }
  }
}

function appendToolContext(modelMessages, executedToolCall) {
  if (!executedToolCall) {
    return;
  }

  const toolContext = executedToolCall.error
    ? [
      "A requested tool call failed.",
      "Tool: " + executedToolCall.name,
      "Error: " + executedToolCall.error,
      "The tool call failed, so you cannot use real-time network results from this request.",
      "Answer only from existing knowledge and any other provided context, and clearly say that live tool data was unavailable."
    ].join("\n")
    : [
      "The user requested a single tool call before answering.",
      "Use the following tool result as context. Do not claim to have browsed beyond this result.",
      "",
      formatToolContext(executedToolCall)
    ].join("\n");

  modelMessages.push({
    role: "user",
    content: toolContext
  });
}

function streamChatWithToolStatus({
  env,
  conversationId,
  model,
  provider,
  providerCatalog,
  autoFallbackEnabled,
  fallbackModel,
  customModelConfig,
  fallbackCustomModelConfig,
  modelMessages,
  historyMessages,
  userContent,
  attachments = [],
  requestedToolCall,
  ragSources,
  debugTools
}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const bufferState = { value: "" };
      const replyState = { value: "" };
      let toolSources = [];

      const enqueueText = text => controller.enqueue(encoder.encode(text));
      const enqueueToolStatus = (name, status) => {
        enqueueText(encodeSseEvent("tool_status", {
          name,
          status,
          message: getToolStatusMessage(name, status)
        }));
      };
      const enqueueToolError = toolError => {
        if (toolError) {
          enqueueText(encodeSseEvent("tool_error", toolError));
        }
      };
      const enqueueToolDebug = debug => {
        if (debugTools && debug) {
          enqueueText(encodeSseEvent("tool_debug", {
            name: debug.name,
            trigger: debug.trigger,
            duration_ms: debug.duration_ms,
            status: debug.status,
            code: debug.code || null
          }));
        }
      };

      try {
        const finalMessages = [...modelMessages];
        let executedToolCall = null;
        let fallbackCount = 0;
        let activeCallStartedAt = 0;
        let activeResult = null;

        if (requestedToolCall?.name) {
          enqueueToolStatus(requestedToolCall.name, "running");
          executedToolCall = await runRequestedTool(requestedToolCall, env);
          enqueueToolStatus(requestedToolCall.name, executedToolCall.error ? "error" : "done");
          enqueueToolError(executedToolCall.toolError);
          enqueueToolDebug(executedToolCall.debug);
          toolSources = buildToolSources(executedToolCall);
        }

        appendToolContext(finalMessages, executedToolCall);
        finalMessages.push(...historyMessages);
        finalMessages.push({
          role: "user",
          content: attachments.length
            ? buildMultimodalUserContent(userContent, attachments)
            : userContent
        });
        console.log("[phase10.3] provider image count", countProviderImages(finalMessages));

        let result;

        try {
          activeCallStartedAt = Date.now();
          result = await callSelectedModel({
            env,
            model: model || DEFAULT_TEXT_MODEL,
            provider,
            messages: finalMessages,
            stream: true,
            providerCatalog
          });
          activeResult = result;
        } catch (err) {
          if (!autoFallbackEnabled || !fallbackModel || fallbackModel === model) {
            throw err;
          }

          fallbackCount += 1;
          const normalizedError = normalizeProviderError(err, {
            provider,
            model: model || DEFAULT_TEXT_MODEL
          });

          enqueueText(encodeSseEvent("fallback", {
            from: model || DEFAULT_TEXT_MODEL,
            to: fallbackModel,
            reason: normalizedError.code || String(normalizedError.status || "provider_error"),
            message: normalizedError.message
          }));

          activeCallStartedAt = Date.now();
          result = await callSelectedModel({
            env,
            model: fallbackModel,
            provider: "",
            messages: finalMessages,
            stream: true,
            providerCatalog
          });
          activeResult = result;
        }

        const reader = result.response.getReader();

        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          controller.enqueue(value);
          bufferState.value += decoder.decode(value, { stream: true });
          appendReplyFromSseBuffer(bufferState, replyState);
        }

        if (bufferState.value.trim()) {
          appendReplyFromSseBuffer({ value: bufferState.value + "\n\n" }, replyState);
        }

        const latencyMs = activeCallStartedAt ? Date.now() - activeCallStartedAt : 0;

        if (env.DB && replyState.value) {
          await saveMessage(env.DB, conversationId, "assistant", replyState.value);
          await maybeUpdateConversationSummary(env, conversationId);
        }

        if (ragSources.length) {
          enqueueText(encodeSseEvent("sources", { sources: ragSources }));
        }

        if (toolSources.length) {
          enqueueText(encodeSseEvent("tool_sources", { sources: toolSources }));
        }

        enqueueText("data: " + JSON.stringify({ conversationId }) + "\n\n");
        enqueueText(encodeSseEvent("done", {
          provider: activeResult?.provider || "",
          model: activeResult?.model || activeResult?.modelName || "",
          latencyMs,
          fallbackCount
        }));
        enqueueText("data: [DONE]\n\n");
      } catch (err) {
        console.log("AI request failed", err);
        const providerError = normalizeProviderError(err, {
          provider,
          model: model || DEFAULT_TEXT_MODEL
        });

        enqueueText(encodeSseEvent("provider_error", providerError));
        enqueueText("data: " + JSON.stringify({
          response:
            "AI \u8bf7\u6c42\u5931\u8d25\uff1a\n\n" +
            "provider: " + providerError.provider + "\n" +
            "model: " + providerError.model + "\n" +
            "status: " + (providerError.status || "") + "\n" +
            "code: " + providerError.code + "\n" +
            "message: " + providerError.message
        }) + "\n\n");
        enqueueText("data: " + JSON.stringify({ conversationId }) + "\n\n");
        enqueueText(encodeSseEvent("done", {
          provider: providerError.provider,
          model: providerError.model,
          latencyMs: 0,
          fallbackCount: 0
        }));
        enqueueText("data: [DONE]\n\n");
      } finally {
        controller.close();
      }
    }
  });
}

function streamWithHistorySave(result, env, conversationId, sources = [], toolSources = []) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reply = "";

  return result.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const lines = event
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart());

        for (const line of lines) {
          reply += readStreamText(line);
        }
      }
    },
    async flush(controller) {
      if (buffer.trim()) {
        const lines = buffer
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart());

        for (const line of lines) {
          reply += readStreamText(line);
        }
      }

      if (env.DB && reply) {
        await saveMessage(env.DB, conversationId, "assistant", reply);
        await maybeUpdateConversationSummary(env, conversationId);
      }

      if (sources.length) {
        controller.enqueue(encoder.encode(
          "event: sources\n" +
          "data: " + JSON.stringify({ sources }) + "\n\n"
        ));
      }

      if (toolSources.length) {
        controller.enqueue(encoder.encode(
          "event: tool_sources\n" +
          "data: " + JSON.stringify({ sources: toolSources }) + "\n\n"
        ));
      }

      controller.enqueue(encoder.encode(
        "data: " + JSON.stringify({ conversationId }) + "\n\n"
      ));
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    }
  }));
}

async function prepareConversation(env, conversationId, userContent) {
  if (!env.DB) {
    return {
      id: conversationId || crypto.randomUUID()
    };
  }

  return ensureConversation(
    env.DB,
    conversationId,
    titleFromMessage(userContent)
  );
}

export async function handleChat(request, env) {
  if (new URL(request.url).pathname === "/api/browser/inspect") {
    return browserJsonResponse(await inspectBrowserToolEndpoint(env));
  }

  if (new URL(request.url).pathname === "/api/browser") {
    return handleBrowserRequest(request, env);
  }

  const {
    messages = [],
    model,
    provider = "",
    providers = [],
    autoFallbackEnabled = false,
    fallbackModel = "",
    customModelConfig = null,
    fallbackCustomModelConfig = null,
    image,
    attachments,
    file,
    fileIds = [],
    conversationId,
    toolCall,
    debugTools = false
  } = await request.json();
  let imageAttachments = [];
  let allImageAttachments = [];

  try {
    imageAttachments = normalizeImageAttachments(attachments);
    allImageAttachments = [
      ...(image ? [imageDataUrlToAttachment(image, 0)] : []),
      ...imageAttachments
    ].slice(0, MAX_IMAGE_ATTACHMENTS);
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message || "Invalid attachments"
    }), {
      status: 400,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  }
  console.log("[phase10.3] backend image count", allImageAttachments.length);

  const userContent = getUserMessage(messages) ||
    (allImageAttachments.length ? "\u8bf7\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\u3002" : "\u8bf7\u7ee7\u7eed\u3002");
  const providerCatalog = await buildModelProviderCatalog(
    env,
    Array.isArray(providers) ? providers : [],
    customModelConfig,
    fallbackCustomModelConfig
  );

  const conversation = await prepareConversation(env, conversationId, userContent);

  if (image && imageAttachments.length === 0) {
    try {
      console.log("received image");

      if (env.DB) {
        await saveMessage(env.DB, conversation.id, "user", userContent);
      }

      const base64 = image.split(",")[1];

      if (!base64) {
        throw new Error("Image DataURL format is invalid");
      }

      const imageBytes = Array.from(
        Uint8Array.from(
          atob(base64),
          c => c.charCodeAt(0)
        )
      );

      const result = await callModel({
        env,
        model: "@cf/meta/llama-3.2-11b-vision-instruct",
        prompt: "\u8bf7\u7528\u4e2d\u6587\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\uff0c\u8bf4\u660e\u56fe\u7247\u4e2d\u7684\u4e3b\u8981\u5bf9\u8c61\u3001\u573a\u666f\u548c\u53ef\u80fd\u7528\u9014\u3002",
        image: imageBytes,
        max_tokens: 256
      });
      const reply = result.response.response || JSON.stringify(result.response);

      if (env.DB) {
        await saveMessage(env.DB, conversation.id, "assistant", reply);
        await maybeUpdateConversationSummary(env, conversation.id);
      }

      return new Response(
        "data: " + JSON.stringify({
          response: reply
        }) + "\n\n" +
        "data: " + JSON.stringify({
          conversationId: conversation.id
        }) + "\n\n" +
        "data: [DONE]\n\n",
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "X-Conversation-Id": conversation.id,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    } catch (err) {
      console.log("image recognition failed", err);

      return new Response(
        "data: " + JSON.stringify({
          response:
            "\u56fe\u7247\u8bc6\u522b\u5931\u8d25\uff1a\n\n" +
            "name: " + (err.name || "") + "\n" +
            "message: " + (err.message || String(err))
        }) + "\n\n",
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "X-Conversation-Id": conversation.id,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    }
  }

  const savedUserMessage = env.DB
    ? await saveMessage(env.DB, conversation.id, "user", userContent)
    : null;

  const historyMessages = env.DB
    ? await buildConversationContext(env, conversation.id, {
      limit: 14,
      excludeMessageId: savedUserMessage?.id
    })
    : messages.filter(message => message.role !== "system");

  const modelMessages = [
    defaultSystemMessage
  ];

  const ragFiles = [];
  let ragSources = [];
  const autoFetchToolCall = getAutoFetchToolCall(userContent);
  const autoSearchToolCall = autoFetchToolCall ? null : getAutoSearchToolCall(userContent);
  const requestedToolCall = toolCall?.name
    ? withToolTrigger(toolCall, "explicit")
    : (autoFetchToolCall
      ? withToolTrigger(autoFetchToolCall, "auto_url")
      : withToolTrigger(autoSearchToolCall, "auto_search"));

  if (file && file.text) {
    ragFiles.push(file);
  }

  if (Array.isArray(fileIds) && fileIds.length) {
    const fileChunks = await getRelevantFileChunksByIds(env, fileIds, userContent, {
      perFileLimit: 5,
      totalLimit: 14
    });

    console.log("[file-rag]", "selected files:", fileIds.length, "retrieved chunks:", fileChunks.length);
    ragSources = buildFileSources(fileChunks);

    if (fileChunks.length) {
      ragFiles.push({
        name: "\u5df2\u9009\u62e9\u7684\u6587\u4ef6 chunks",
        type: "file-chunks",
        chunks: fileChunks
      });
    }
  }

  if (ragFiles.length) {
    const filePrompt =
      "\u7528\u6237\u9009\u62e9\u4e86\u6587\u4ef6\u4e0a\u4e0b\u6587\u3002\u4e0b\u9762\u662f\u4ece\u6587\u4ef6\u4e2d\u63d0\u53d6\u51fa\u7684\u76f8\u5173\u7247\u6bb5\uff0c\u8bf7\u4f18\u5148\u4f9d\u636e\u8fd9\u4e9b\u7247\u6bb5\u56de\u7b54\u7528\u6237\u95ee\u9898\uff1b\u5982\u679c\u7247\u6bb5\u4fe1\u606f\u4e0d\u8db3\uff0c\u8bf7\u660e\u786e\u8bf4\u660e\u3002\n\n" +
      ragFiles.map((item, index) => {
        if (Array.isArray(item.chunks)) {
          return item.chunks.map(chunk => {
            return [
              "[File: " + chunk.filename + "]",
              "Chunk " + chunk.chunkIndex + (chunk.fallback ? " (fallback)" : "") + ":",
              chunk.content
            ].join("\n");
          }).join("\n\n");
        }

        return [
          "\u3010\u6587\u4ef6 " + (index + 1) + "\u3011",
          "\u6587\u4ef6\u540d\uff1a" + item.name,
          "\u6587\u4ef6\u7c7b\u578b\uff1a" + (item.type || "unknown"),
          "\u8d44\u6599\u5185\u5bb9\uff1a",
          (item.text || "").slice(0, 12000)
        ].join("\n");
      }).join("\n\n");

    modelMessages.push({
      role: "user",
      content: filePrompt
    });
  }

  return new Response(streamChatWithToolStatus({
    env,
    conversationId: conversation.id,
    model,
    provider,
    providerCatalog,
    autoFallbackEnabled: Boolean(autoFallbackEnabled),
    fallbackModel,
    customModelConfig,
    fallbackCustomModelConfig,
    modelMessages,
    historyMessages,
    userContent,
    attachments: allImageAttachments,
    requestedToolCall,
    ragSources,
    debugTools: Boolean(debugTools)
  }), {
    headers: {
      ...corsHeaders(),
      "X-Conversation-Id": conversation.id,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
