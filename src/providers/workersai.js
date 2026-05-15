function extractClaudeText(result) {
  if (Array.isArray(result?.content)) {
    return result.content
      .filter(item => item?.type === "text")
      .map(item => item.text || "")
      .join("");
  }

  return result?.response || result?.text || "";
}

function textToSseStream(text) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: " + JSON.stringify({ response: text || "" }) + "\n\n"
      ));
      controller.close();
    }
  });
}

export async function callWorkersAI({
  env,
  model,
  messages,
  stream = true,
  max_tokens,
  temperature
}) {
  const isClaudeProxied = String(model || "").startsWith("anthropic/claude");
  const input = {
    messages: isClaudeProxied
      ? (messages || []).filter(message => message.role !== "system")
      : messages,
    stream: isClaudeProxied ? false : stream
  };

  if (isClaudeProxied) {
    input.max_tokens = typeof max_tokens === "number" ? max_tokens : 4096;
  } else if (typeof max_tokens === "number") {
    input.max_tokens = max_tokens;
  }

  if (typeof temperature === "number") {
    input.temperature = temperature;
  }

  if (String(model || "").startsWith("@cf/")) {
    return env.AI.run(model, input);
  }

  const response = await env.AI.run(model, input, {
    gateway: {
      id: "default"
    }
  });

  return isClaudeProxied ? textToSseStream(extractClaudeText(response)) : response;
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
