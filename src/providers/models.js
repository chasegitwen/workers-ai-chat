const textCapabilities = {
  text: true,
  vision: false,
  streaming: true,
  tools: false,
  reasoning: false,
  embeddings: false
};

export const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const DEFAULT_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
export const FALLBACK_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export const MODELS = [
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    label: "Llama 3.1 8B Fast",
    provider: "workers-ai",
    capabilities: {
      ...textCapabilities
    },
    contextWindow: 131072,
    maxOutput: 4096,
    recommended: true,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/zai-org/glm-4.7-flash",
    label: "GLM 4.7 Flash",
    provider: "workers-ai",
    capabilities: {
      ...textCapabilities
    },
    contextWindow: 131072,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4 26B",
    provider: "workers-ai",
    capabilities: {
      ...textCapabilities
    },
    contextWindow: 131072,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    provider: "workers-ai",
    capabilities: {
      ...textCapabilities
    },
    contextWindow: 131072,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  }
];

export function getEnabledModels() {
  return MODELS.filter(model => model.enabled);
}

export function findModel(id) {
  return MODELS.find(model => model.id === id && model.enabled);
}
