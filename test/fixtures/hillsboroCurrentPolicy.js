export const HILLSBORO_CURRENT_MODELS_BY_AGENT = Object.freeze({
  main: Object.freeze([
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-luna",
    "openai/gpt-6-astra",
    "zai/glm-5",
    "kimi/kimi-for-coding"
  ]),
  glm: Object.freeze([
    "zai/glm-5-turbo",
    "zai/glm-5.2",
    "zai/glm-5.3",
    "zai/glm-5.3-flash"
  ]),
  kimi: Object.freeze([
    "kimi/kimi-for-coding"
  ])
});

export const HILLSBORO_CURRENT_MODEL_UNION = Object.freeze([...new Set([
  ...HILLSBORO_CURRENT_MODELS_BY_AGENT.main,
  ...HILLSBORO_CURRENT_MODELS_BY_AGENT.glm,
  ...HILLSBORO_CURRENT_MODELS_BY_AGENT.kimi
])]);

const LABELS = Object.freeze({
  "openai/gpt-5.6-terra": "GPT-5.6 Terra",
  "openai/gpt-5.6-sol": "GPT-5.6 Sol",
  "openai/gpt-5.6-luna": "GPT-5.6 Luna",
  "openai/gpt-6-astra": "GPT-6 Astra",
  "zai/glm-5": "GLM-5",
  "zai/glm-5-turbo": "GLM-5 Turbo",
  "zai/glm-5.2": "GLM-5.2",
  "zai/glm-5.3": "GLM-5.3",
  "zai/glm-5.3-flash": "GLM-5.3 Flash",
  "kimi/kimi-for-coding": "Kimi for Coding"
});

function model(id) {
  return {
    id,
    name: LABELS[id] || id,
    provider: id.split("/")[0],
    available: true,
    manualSelectionAllowed: true
  };
}

export function hillsboroCurrentPolicyCatalog() {
  return {
    agents: [
      { id: "main", name: "main", defaultModel: "openai/gpt-5.6-terra" },
      { id: "glm", name: "GLM", defaultModel: "zai/glm-5.2" },
      { id: "kimi", name: "Kimi", defaultModel: "kimi/kimi-for-coding" }
    ],
    models: HILLSBORO_CURRENT_MODEL_UNION.map(model),
    modelsByAgent: Object.fromEntries(Object.entries(HILLSBORO_CURRENT_MODELS_BY_AGENT)
      .map(([agentId, ids]) => [agentId, ids.map(model)])),
    defaultAgentId: "main",
    modelView: "configured"
  };
}
