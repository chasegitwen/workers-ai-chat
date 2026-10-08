import { filterEmptySystemMessages } from "./messages.js";
import { ProviderError } from "./errors.js";

function extractClaudeText(result) {
  if (Array.isArray(result?.content)) {
    return result.content
      .filter(item => item?.type === "text")
      .map(item => typeof item.text === "string" ? item.text : "")
      .join("");
  }

  return (typeof result?.response === "string" && result.response)
    || (typeof result?.text === "string" && result.text) || "";
}

function textToSseStream(text, metadata) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: " + JSON.stringify({ response: text || "", metadata }) + "\n\n"
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
  const filteredMessages = filterEmptySystemMessages(messages);
  const input = {
    messages: isClaudeProxied
      ? filteredMessages.filter(message => message.role !== "system")
      : filteredMessages,
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

  const startedAt = Date.now();
  const response = await env.AI.run(model, input, {
    gateway: {
      id: "default"
    }
  });

  if (!isClaudeProxied) {
    return response;
  }

  const text = extractClaudeText(response);
  // Keep only diagnostic fields; never retain content or refusal explanations.
  const safeIdentifier = value => typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9_@/.:\-]/g, "").slice(0, 160)
    : "";
  const tokenCount = value => Number.isFinite(value) && value >= 0 ? value : null;
  const metadata = {
    id: safeIdentifier(response?.id),
    model: safeIdentifier(response?.model || model),
    stop_reason: safeIdentifier(response?.stop_reason),
    stop_details: response?.stop_details ? {
      type: safeIdentifier(response.stop_details.type),
      category: safeIdentifier(response.stop_details.category)
    } : null,
    usage: {
      input_tokens: tokenCount(response?.usage?.input_tokens),
      output_tokens: tokenCount(response?.usage?.output_tokens)
    },
    content_block_types: Array.isArray(response?.content)
      ? response.content.map(item => safeIdentifier(item?.type)) : [],
    text_length: text.length,
    latency_ms: Date.now() - startedAt
  };
  let code = "";
  let message = "";
  if (response?.stop_reason === "refusal") {
    code = "provider_refusal";
    message = "Claude拒绝了本次请求，可能是内容分类器误判。请改写问题或新建话题后重试。";
  } else if (!text.trim()) {
    code = response?.stop_reason === "max_tokens" ? "output_limit" : "empty_response";
    message = code === "output_limit"
      ? "Claude已达到本次输出长度限制，未能生成正文。请缩短问题或稍后重试。"
      : "模型返回了异常的空响应，请稍后重试。";
  }
  if (code) {
    console.warn("[claude-response]", { code, ...metadata });
    throw new ProviderError(message, {
      provider: "cloudflare-proxied",
      model,
      code,
      raw: metadata
    });
  }
  return textToSseStream(text, metadata);
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
