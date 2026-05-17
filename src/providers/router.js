import {
  ModelNotFoundError,
  UnsupportedProviderTypeError
} from "./errors.js";
import {
  findModel,
  getModelRuntimeConfig
} from "./config.js";
import {
  DEFAULT_VISION_MODEL,
} from "./models.js";
import { callAnthropic } from "./anthropicRuntime.js";
import { callOpenAICompatible } from "./openaiCompatible.js";
import { callWorkersAI, callWorkersAIVision } from "./workersai.js";

function resolveTextConfig(model) {
  const selected = getModelRuntimeConfig(model);

  if (selected) {
    return selected;
  }

  throw new ModelNotFoundError("Model not found: " + (model || "(empty)"), {
    provider: "",
    model: model || ""
  });
}

function resolveVisionConfig(model) {
  const requested = model || DEFAULT_VISION_MODEL;
  const enabledModel = getModelRuntimeConfig(requested);
  const configuredModel = findModel(requested);

  return enabledModel || configuredModel || {
    id: requested,
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: requested,
    capabilities: {
      vision: true
    }
  };
}

async function callByProviderType({
  env,
  config,
  messages,
  stream,
  max_tokens,
  temperature,
  prompt,
  image
}) {
  switch (config.providerType) {
    case "workers-ai":
      if (prompt || image) {
        return callWorkersAIVision({
          env,
          model: config.modelName,
          prompt,
          image,
          max_tokens
        });
      }

      return callWorkersAI({
        env,
        model: config.modelName,
        messages,
        stream,
        max_tokens,
        temperature
      });

    case "openai-compatible":
      return callOpenAICompatible({
        env,
        config,
        messages,
        stream,
        max_tokens,
        temperature
      });

    case "anthropic":
      return callAnthropic({
        env,
        config,
        messages,
        stream,
        max_tokens,
        temperature,
        prompt,
        image
      });

    default:
      throw new UnsupportedProviderTypeError(
        "Unsupported provider type: " + config.providerType,
        {
          provider: config.provider,
          providerType: config.providerType,
          model: config.id
        }
      );
  }
}

export async function callModel({
  env,
  model,
  messages,
  stream,
  max_tokens,
  temperature,
  prompt,
  image
}) {
  const config = (prompt || image)
    ? resolveVisionConfig(model)
    : resolveTextConfig(model);
  const response = await callByProviderType({
    env,
    config,
    messages,
    stream,
    max_tokens,
    temperature,
    prompt,
    image
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
