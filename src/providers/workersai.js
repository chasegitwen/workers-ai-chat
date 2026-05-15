export async function callWorkersAI({
  env,
  model,
  messages,
  stream = true,
  max_tokens,
  temperature
}) {
  const input = {
    messages,
    stream
  };

  if (typeof max_tokens === "number") {
    input.max_tokens = max_tokens;
  }

  if (typeof temperature === "number") {
    input.temperature = temperature;
  }

  return env.AI.run(model, input);
}

export async function callWorkersAIVision({
  env,
  model,
  prompt,
  image,
  max_tokens
}) {
  const input = {
    prompt,
    image
  };

  if (typeof max_tokens === "number") {
    input.max_tokens = max_tokens;
  }

  return env.AI.run(model, input);
}
