import { callWorkersAI } from "../../providers/workersai.js";
import { DEFAULT_TEXT_MODEL } from "../../providers/models.js";

export async function callWorkersAIProvider({
  env,
  messages,
  model,
  stream = true,
  options = {}
}) {
  const modelName = model && model !== "workers-ai"
    ? model
    : (env.WORKERS_AI_MODEL || DEFAULT_TEXT_MODEL);

  const response = await callWorkersAI({
    env,
    model: modelName,
    messages,
    stream,
    max_tokens: options.max_tokens,
    temperature: options.temperature
  });

  return {
    provider: "workers-ai",
    model: modelName,
    response
  };
}
