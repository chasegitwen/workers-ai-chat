import { createProviderHttpError, ProviderError } from "./errors.js";
import { filterEmptySystemMessages } from "./messages.js";

function normalizeApiBase(apiBase) {
  return String(apiBase || "").replace(/\/+$/g, "");
}

function isOpenClawConfig(config) {
  const values = [
    config?.provider,
    config?.id,
    config?.modelName,
    config?.label,
    config?.apiBase
  ].map(value => String(value || "").toLowerCase());
  return values.some(value => value.startsWith("openclaw-") || value.includes("openclaw"));
}

export function maybeAttachCfAccessHeaders(env, url, headers) {
  const clientId = env?.ACT_CF_ACCESS_CLIENT_ID;
  const clientSecret = env?.ACT_CF_ACCESS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return headers;
  }

  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return headers;
  }

  if (parsed.hostname !== "act.hnsnowground.cfd") {
    return headers;
  }
  if (parsed.pathname !== "/v1" && !parsed.pathname.startsWith("/v1/")) {
    return headers;
  }

  if (headers instanceof Headers) {
    headers.set("CF-Access-Client-Id", clientId);
    headers.set("CF-Access-Client-Secret", clientSecret);
  } else {
    headers["CF-Access-Client-Id"] = clientId;
    headers["CF-Access-Client-Secret"] = clientSecret;
  }
  return headers;
}

function isCloudflareAccessRedirect(response) {
  const location = response?.headers?.get?.("Location") || "";
  return response?.status === 302 && location.includes("cloudflareaccess.com/cdn-cgi/access/login/");
}

export async function callOpenAICompatible({
  env,
  config,
  messages,
  stream = true,
  max_tokens,
  temperature,
  timeoutMs
}) {
  const apiBase = normalizeApiBase(config?.apiBase);
  const apiKeyEnv = config?.apiKeyEnv || "";
  const apiKey = apiKeyEnv ? env[apiKeyEnv] : "";

  if (!apiBase) {
    throw new ProviderError("OpenAI-compatible apiBase is not configured", {
      provider: config?.provider || "openai-compatible",
      model: config?.id || ""
    });
  }

  if (!apiKey) {
    throw new ProviderError("OpenAI-compatible API key is not configured: " + apiKeyEnv, {
      provider: config?.provider || "openai-compatible",
      model: config?.id || ""
    });
  }

  const body = {
    model: config.modelName || config.id,
    messages: filterEmptySystemMessages(messages),
    stream
  };

  if (typeof temperature === "number") {
    body.temperature = temperature;
  }

  if (typeof max_tokens === "number") {
    body.max_tokens = max_tokens;
  }

  const controller = typeof timeoutMs === "number" && timeoutMs > 0
    ? new AbortController()
    : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;

  const openClawConfig = isOpenClawConfig(config);
  let cfAccessHeadersAttached = false;

  try {
    const headers = {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json; charset=utf-8"
    };
    if (openClawConfig) {
      headers["X-OpenClaw-Task-Events"] = "1";
    }
    const requestUrl = apiBase + "/chat/completions";
    maybeAttachCfAccessHeaders(env, requestUrl, headers);
    cfAccessHeadersAttached = Boolean(headers["CF-Access-Client-Id"] && headers["CF-Access-Client-Secret"]);
    response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: openClawConfig ? "manual" : "follow",
      signal: controller?.signal
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  if (!response.ok) {
    if (openClawConfig && isCloudflareAccessRedirect(response)) {
      throw new ProviderError(
        "Cloudflare Access blocked the OpenClaw upstream request. "
          + (cfAccessHeadersAttached
            ? "Service token headers were attached, so verify the Access application policy accepts this service token."
            : "Service token headers were not attached, so verify ACT_CF_ACCESS_CLIENT_ID and ACT_CF_ACCESS_CLIENT_SECRET are set."),
        {
          provider: config.provider,
          model: config.id,
          status: response.status,
          code: "cloudflare_access_blocked",
          raw: ""
        }
      );
    }

    const errorText = await response.text().catch(() => "");
    throw createProviderHttpError({
      provider: config.provider,
      model: config.id,
      status: response.status,
      raw: errorText
    });
  }

  if (stream && openClawConfig) {
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("text/event-stream")) {
      const raw = await response.clone().text().catch(() => "");
      throw new ProviderError(
        "OpenClaw upstream returned a non-SSE response. Check Cloudflare Access, upstream auth, and Seattle Legacy SSE compatibility.",
        {
          provider: config.provider,
          model: config.id,
          status: response.status,
          code: "invalid_stream_content_type",
          raw: raw.slice(0, 1000)
        }
      );
    }
  }

  return stream ? response.body : response.json();
}
