import { ModelNotFoundError, ProviderError } from "./errors.js";
import {
  DEFAULT_VISION_MODEL,
  FALLBACK_TEXT_MODEL,
  findModel
} from "./models.js";
import { callWorkersAI, callWorkersAIVision } from "./workersai.js";

function resolveTextModel(model) {
  const selected = findModel(model);

  if (selected) {
    return selected;
  }

  console.warn(
    "[provider-router] model not found, falling back:",
    model || "(empty)",
    "->",
    FALLBACK_TEXT_MODEL
  );

  const fallback = findModel(FALLBACK_TEXT_MODEL);

  if (!fallback) {
    throw new ModelNotFoundError("Fallback model is not configured", {
      provider: "workers-ai",
      model: FALLBACK_TEXT_MODEL
    });
  }

  return fallback;
}

export async function callModel({
  env,
  provider,
  model,
  messages,
  stream,
  max_tokens,
  temperature,
  prompt,
  image
}) {
  const requestedProvider = provider || "workers-ai";

  if (requestedProvider !== "workers-ai") {
    throw new ProviderError("Unsupported provider: " + requestedProvider, {
      provider: requestedProvider,
      model
    });
  }

  if (prompt || image) {
    const visionModel = model || DEFAULT_VISION_MODEL;
    const response = await callWorkersAIVision({
      env,
      model: visionModel,
      prompt,
      image,
      max_tokens
    });

    return {
      provider: "workers-ai",
      model: visionModel,
      stream: false,
      response
    };
  }

  const selectedModel = resolveTextModel(model);
  const response = await callWorkersAI({
    env,
    model: selectedModel.id,
    messages,
    stream,
    max_tokens,
    temperature
  });

  return {
    provider: selectedModel.provider,
    model: selectedModel.id,
    stream: Boolean(stream),
    response
  };
}
