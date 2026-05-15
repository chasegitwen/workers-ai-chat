import { MODELS } from "./models.js";

export function getEnabledModels() {
  return MODELS.filter(model => model.enabled);
}

export function findModel(id) {
  return MODELS.find(model => model.id === id && model.enabled);
}

export function getModelRuntimeConfig(id) {
  const model = findModel(id);

  if (!model) {
    return null;
  }

  return {
    id: model.id,
    label: model.label,
    providerType: model.providerType,
    provider: model.provider,
    apiBase: model.apiBase || "",
    apiKeyEnv: model.apiKeyEnv || "",
    modelName: model.modelName || model.id,
    capabilities: model.capabilities || {},
    contextWindow: model.contextWindow,
    maxOutput: model.maxOutput,
    recommended: Boolean(model.recommended),
    deprecated: Boolean(model.deprecated),
    enabled: Boolean(model.enabled)
  };
}
