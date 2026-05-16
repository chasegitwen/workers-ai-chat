function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/g, "");
}

function createProviderError(provider, status, code, message) {
  const error = new Error(message);
  error.name = "ExternalProviderError";
  error.provider = provider;
  error.status = status || 0;
  error.code = code;
  return error;
}

function errorCodeForStatus(status) {
  if (status === 401 || status === 403) {
    return "provider_auth_error";
  }

  if (status === 429) {
    return "provider_rate_limited";
  }

  if (status >= 500) {
    return "provider_server_error";
  }

  return "provider_http_error";
}

export async function callOpenAICompatibleProvider({
  provider,
  env,
  messages,
  model,
  baseUrl,
  apiKey,
  stream = true,
  signal,
  options = {}
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (!normalizedBaseUrl) {
    throw createProviderError(provider, 0, "provider_config_error", "External provider base URL is not configured");
  }

  if (!apiKey) {
    throw createProviderError(provider, 0, "provider_auth_error", "External provider API key is not configured");
  }

  if (!model) {
    throw createProviderError(provider, 0, "provider_config_error", "External provider model is not configured");
  }

  const body = {
    model,
    messages,
    stream
  };

  if (typeof options.temperature === "number") {
    body.temperature = options.temperature;
  }

  if (typeof options.max_tokens === "number") {
    body.max_tokens = options.max_tokens;
  }

  const timeoutMs = typeof options.timeout_ms === "number" ? options.timeout_ms : 60000;
  const controller = signal ? null : new AbortController();
  const timeoutId = controller
    ? setTimeout(() => controller.abort("timeout"), timeoutMs)
    : null;

  try {
    const response = await fetch(normalizedBaseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: signal || controller?.signal
    });

    if (!response.ok) {
      throw createProviderError(
        provider,
        response.status,
        errorCodeForStatus(response.status),
        "External provider request failed"
      );
    }

    return {
      provider,
      model,
      response: stream ? response.body : await response.json()
    };
  } catch (err) {
    if (err.name === "ExternalProviderError") {
      throw err;
    }

    throw createProviderError(
      provider,
      0,
      "provider_network_error",
      "External provider network request failed"
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
