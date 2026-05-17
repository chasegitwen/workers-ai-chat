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

function maskApiKey(apiKey) {
  const value = String(apiKey || "");

  if (!value) {
    return "";
  }

  if (value.length <= 10) {
    return value.slice(0, 2) + "***";
  }

  return value.slice(0, 6) + "***" + value.slice(-4);
}

function getBodySchema(body) {
  return {
    keys: Object.keys(body),
    model: body.model,
    stream: body.stream,
    messages_count: Array.isArray(body.messages) ? body.messages.length : 0,
    message_roles: Array.isArray(body.messages)
      ? body.messages.map(message => message?.role || "")
      : [],
    has_temperature: Object.prototype.hasOwnProperty.call(body, "temperature"),
    has_max_tokens: Object.prototype.hasOwnProperty.call(body, "max_tokens")
  };
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
  const finalUrl = normalizedBaseUrl + "/chat/completions";
  const requestHeadersDebug = {
    Authorization: apiKey ? "Bearer " + maskApiKey(apiKey) : "",
    "Content-Type": "application/json"
  };

  console.log("[openai-compatible] request", {
    provider,
    final_url: finalUrl,
    model,
    headers: requestHeadersDebug,
    body_schema: getBodySchema(body),
    fixed_path: "/chat/completions"
  });

  try {
    const response = await fetch(finalUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: signal || controller?.signal
    });

    console.log("[openai-compatible] response", {
      provider,
      final_url: finalUrl,
      model,
      status: response.status
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      console.warn("[openai-compatible] error_response", {
        provider,
        final_url: finalUrl,
        model,
        status: response.status,
        body_preview: errorText.slice(0, 1000)
      });

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
