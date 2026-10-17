const HILLSBORO_AGENT_ALIASES = Object.freeze({
  glm51: "glm",
  "glm5-2": "glm",
  "kimi-for-coding": "kimi"
});

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

function candidateValues(modelLike) {
  if (!modelLike || typeof modelLike !== "object") return [modelLike];
  return [
    modelLike.modelName,
    modelLike.upstreamModelName,
    modelLike.model,
    modelLike.agentId,
    modelLike.agent_id,
    modelLike.id,
    modelLike.modelId
  ];
}

function normalizeCandidate(value) {
  let candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.toLowerCase().startsWith("openclaw/")) {
    candidate = candidate.slice("openclaw/".length);
  }
  candidate = candidate.toLowerCase();
  if (!AGENT_ID_PATTERN.test(candidate)) return "";
  return HILLSBORO_AGENT_ALIASES[candidate] || candidate;
}

export function normalizeHillsboroAgentId(modelLike) {
  for (const value of candidateValues(modelLike)) {
    const normalized = normalizeCandidate(value);
    if (normalized) return normalized;
  }
  return "";
}

export function hillsboroAgentRoute(modelLike) {
  const agentId = normalizeHillsboroAgentId(modelLike);
  return agentId ? "openclaw/" + agentId : "";
}
