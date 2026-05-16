import { callProvider } from "../lib/providers/index.js";
import { jsonResponse } from "../utils/response.js";

function extractProviderMessage(result) {
  const response = result?.response;

  return (
    response?.choices?.[0]?.message?.content ||
    response?.choices?.[0]?.text ||
    response?.response ||
    response?.result?.response ||
    response?.text ||
    ""
  );
}

function providerConfigured(provider, env) {
  if (provider === "workers-ai") {
    return true;
  }

  if (String(env.EXTERNAL_PROVIDER_ENABLED || "").toLowerCase() !== "true") {
    return false;
  }

  if (provider === "glm") {
    return Boolean(env.GLM_API_KEY && env.GLM_BASE_URL && env.GLM_MODEL);
  }

  if (provider === "kimi") {
    return Boolean(env.KIMI_API_KEY && env.KIMI_BASE_URL && env.KIMI_MODEL);
  }

  return false;
}

function configuredModel(provider, env) {
  if (provider === "glm") {
    return env.GLM_MODEL || "";
  }

  if (provider === "kimi") {
    return env.KIMI_MODEL || "";
  }

  return env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";
}

export async function handleProvider(request, env, url) {
  if (request.method !== "POST" || url.pathname !== "/api/provider/test") {
    return null;
  }

  const { provider = "workers-ai" } = await request.json().catch(() => ({}));

  if (!providerConfigured(provider, env)) {
    return jsonResponse({
      ok: false,
      provider,
      error: "Provider is not configured or external providers are disabled"
    }, 400);
  }

  try {
    const result = await callProvider({
      env,
      provider,
      model: provider,
      messages: [
        {
          role: "user",
          content: "Reply with provider-ok only."
        }
      ],
      stream: false,
      options: {
        temperature: 0,
        max_tokens: 16
      }
    });

    return jsonResponse({
      ok: true,
      provider: result.provider,
      model: result.model || configuredModel(provider, env),
      message: extractProviderMessage(result) || "provider-ok"
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      provider: err.provider || provider,
      status: err.status || 0,
      code: err.code || "provider_test_error",
      error: err.message || "Provider test failed"
    }, err.status || 500);
  }
}
