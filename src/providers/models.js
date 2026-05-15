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
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/meta/llama-3.1-8b-instruct-fast",
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
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/zai-org/glm-4.7-flash",
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
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/google/gemma-4-26b-a4b-it",
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
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/moonshotai/kimi-k2.6",
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
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    label: "Qwen2.5 Coder 32B",
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/qwen/qwen2.5-coder-32b-instruct",
    capabilities: {
      ...textCapabilities
    },
    contextWindow: 32768,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    label: "DeepSeek R1 Distill Qwen 32B",
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    capabilities: {
      ...textCapabilities,
      reasoning: true
    },
    contextWindow: 32768,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/qwen/qwq-32b",
    label: "QwQ 32B",
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/qwen/qwq-32b",
    capabilities: {
      ...textCapabilities,
      reasoning: true
    },
    contextWindow: 32768,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B FP8 Fast",
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    capabilities: {
      ...textCapabilities
    },
    contextWindow: 32768,
    maxOutput: 4096,
    recommended: false,
    deprecated: false,
    enabled: true
  },
  {
    id: "@cf/meta/llama-3.2-3b-instruct",
    label: "Llama 3.2 3B Instruct",
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/meta/llama-3.2-3b-instruct",
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
    id: "@cf/meta/llama-3.2-11b-vision-instruct",
    label: "Llama 3.2 11B Vision",
    providerType: "workers-ai",
    provider: "workers-ai",
    modelName: "@cf/meta/llama-3.2-11b-vision-instruct",
    capabilities: {
      text: false,
      vision: true,
      streaming: false,
      tools: false,
      reasoning: false,
      embeddings: false
    },
    contextWindow: 8192,
    maxOutput: 1024,
    recommended: false,
    deprecated: false,
    enabled: false
  },
  {
    id: "qwen-plus",
    label: "Qwen Plus",
    providerType: "openai-compatible",
    provider: "dashscope",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    modelName: "qwen-plus",
    capabilities: {
      text: true,
      vision: false,
      streaming: true,
      tools: true,
      reasoning: false,
      embeddings: false
    },
    contextWindow: 131072,
    maxOutput: 8192,
    recommended: false,
    deprecated: false,
    enabled: false
  },
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    providerType: "workers-ai",
    provider: "cloudflare-proxied",
    modelName: "anthropic/claude-opus-4.7",
    capabilities: {
      text: true,
      vision: true,
      streaming: true,
      tools: true,
      reasoning: true,
      embeddings: false
    },
    contextWindow: 1000000,
    maxOutput: 8192,
    recommended: false,
    deprecated: false,
    enabled: true
  }
];
