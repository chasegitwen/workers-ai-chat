import { createProviderHttpError, ProviderError } from "./errors.js";
import { filterEmptySystemMessages } from "./messages.js";

function normalizeApiBase(apiBase) {
  return String(apiBase || "").replace(/\/+$/g, "");
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

  try {
    response = await fetch(apiBase + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller?.signal
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw createProviderHttpError({
      provider: config.provider,
      model: config.id,
      status: response.status,
      raw: errorText
    });
  }

  return stream ? response.body : response.json();
}
