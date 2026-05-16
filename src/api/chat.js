import { corsHeaders } from "../utils/response.js";
import { getRelevantFileChunksByIds } from "./files.js";
import {
  ensureConversation,
  saveMessage,
  titleFromMessage
} from "./history.js";
import {
  buildConversationContext,
  maybeUpdateConversationSummary
} from "./summary.js";
import { DEFAULT_TEXT_MODEL } from "../providers/models.js";
import { callModel } from "../providers/router.js";
import { runTool } from "../tools/registry.js";

const defaultSystemMessage = {
  role: "system",
  content: "\u4f60\u662f\u4e00\u4e2a\u7f51\u9875 AI \u52a9\u624b\uff0c\u8bf7\u7b80\u6d01\u3001\u51c6\u786e\u3001\u53cb\u597d\u5730\u56de\u7b54\u3002\u53ef\u4ee5\u4f7f\u7528 Markdown\u3002"
};

const MAX_AUTO_URL_LENGTH = 2048;

function getUserMessage(messages) {
  const userMessage = [...(messages || [])]
    .reverse()
    .find(message => message.role === "user");

  return (userMessage?.content || "").trim();
}

function cleanCandidateUrl(value) {
  return String(value || "").replace(/[)\].,;!?，。；！？）】]+$/u, "");
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".");

  if (parts.length !== 4 || !parts.every(part => /^\d+$/.test(part))) {
    return false;
  }

  const numbers = parts.map(part => Number(part));

  if (numbers.some(value => value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = numbers;

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedHostname(hostname) {
  const host = String(hostname || "").toLowerCase();

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    isPrivateIPv4(host)
  );
}

function getAutoFetchToolCall(userContent) {
  const match = String(userContent || "").match(/https?:\/\/[^\s<>"']+/i);

  if (!match) {
    return null;
  }

  const candidate = cleanCandidateUrl(match[0]);

  if (!candidate || candidate.length > MAX_AUTO_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (isBlockedHostname(url.hostname)) {
      return null;
    }

    return {
      name: "fetch_url",
      args: {
        url: url.href
      }
    };
  } catch (err) {
    return null;
  }
}

function readStreamText(value) {
  if (value === "[DONE]") {
    return "";
  }

  try {
    const data = JSON.parse(value);

    return (
      data.response ||
      data.result?.response ||
      data.output_text ||
      data.text ||
      data.choices?.[0]?.delta?.content ||
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      ""
    );
  } catch (err) {
    return "";
  }
}

function buildFileSources(fileChunks) {
  const seen = new Set();

  return (fileChunks || [])
    .map(chunk => ({
      file_id: chunk.fileId,
      filename: chunk.filename,
      chunk_index: chunk.chunkIndex,
      score: Number(chunk.score || 0),
      preview: String(chunk.content || "").slice(0, 400)
    }))
    .filter(source => {
      if (!source.file_id || source.chunk_index === undefined || source.chunk_index === null) {
        return false;
      }

      const key = source.file_id + ":" + source.chunk_index;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.filename !== b.filename) {
        return String(a.filename || "").localeCompare(String(b.filename || ""));
      }

      return Number(a.chunk_index || 0) - Number(b.chunk_index || 0);
    })
    .slice(0, 8);
}

function formatToolContext(toolCall) {
  if (!toolCall) {
    return "";
  }

  const result = toolCall.result || {};

  if (toolCall.name === "web_search") {
    const results = Array.isArray(result.results) ? result.results : [];

    return [
      "Tool result: web_search",
      "Query: " + (result.query || toolCall.args?.query || ""),
      "",
      results.length
        ? results.map((item, index) => [
          "[" + (index + 1) + "] " + (item.title || "Untitled"),
          "URL: " + (item.url || ""),
          "Snippet: " + (item.snippet || item.description || "")
        ].join("\n")).join("\n\n")
        : "No search results returned."
    ].join("\n");
  }

  if (toolCall.name === "fetch_url") {
    return [
      "Tool result: fetch_url",
      "Title: " + (result.title || "Untitled Page"),
      "URL: " + (result.url || toolCall.args?.url || ""),
      result.truncated ? "Note: content was truncated for prompt size." : "",
      "",
      result.text || result.content || ""
    ].filter(Boolean).join("\n");
  }

  return [
    "Tool result: " + toolCall.name,
    JSON.stringify(result, null, 2)
  ].join("\n");
}

function buildToolSources(toolCall) {
  if (!toolCall || toolCall.error) {
    return [];
  }

  const result = toolCall.result || {};

  if (toolCall.name === "web_search") {
    return (Array.isArray(result.results) ? result.results : [])
      .map(item => ({
        type: "web_search",
        title: item.title || "Untitled",
        url: item.url || "",
        snippet: item.snippet || item.description || ""
      }))
      .filter(source => source.url)
      .slice(0, 8);
  }

  if (toolCall.name === "fetch_url") {
    const preview = String(result.text || result.content || "").slice(0, 500);

    return result.url
      ? [{
        type: "fetch_url",
        title: result.title || "Untitled Page",
        url: result.url,
        snippet: preview,
        preview
      }]
      : [];
  }

  return [];
}

async function runRequestedTool(toolCall, env) {
  if (!toolCall || !toolCall.name) {
    return null;
  }

  try {
    return await runTool(toolCall.name, toolCall.args || {}, env);
  } catch (err) {
    return {
      name: toolCall.name,
      args: toolCall.args || {},
      error: err.message || String(err),
      result: {
        error: err.message || String(err)
      }
    };
  }
}

function streamWithHistorySave(result, env, conversationId, sources = [], toolSources = []) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reply = "";

  return result.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const lines = event
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart());

        for (const line of lines) {
          reply += readStreamText(line);
        }
      }
    },
    async flush(controller) {
      if (buffer.trim()) {
        const lines = buffer
          .split("\n")
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart());

        for (const line of lines) {
          reply += readStreamText(line);
        }
      }

      if (env.DB && reply) {
        await saveMessage(env.DB, conversationId, "assistant", reply);
        await maybeUpdateConversationSummary(env, conversationId);
      }

      if (sources.length) {
        controller.enqueue(encoder.encode(
          "event: sources\n" +
          "data: " + JSON.stringify({ sources }) + "\n\n"
        ));
      }

      if (toolSources.length) {
        controller.enqueue(encoder.encode(
          "event: tool_sources\n" +
          "data: " + JSON.stringify({ sources: toolSources }) + "\n\n"
        ));
      }

      controller.enqueue(encoder.encode(
        "data: " + JSON.stringify({ conversationId }) + "\n\n"
      ));
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    }
  }));
}

async function prepareConversation(env, conversationId, userContent) {
  if (!env.DB) {
    return {
      id: conversationId || crypto.randomUUID()
    };
  }

  return ensureConversation(
    env.DB,
    conversationId,
    titleFromMessage(userContent)
  );
}

export async function handleChat(request, env) {
  const {
    messages = [],
    model,
    image,
    file,
    fileIds = [],
    conversationId,
    toolCall
  } = await request.json();

  const userContent = getUserMessage(messages) ||
    (image ? "\u8bf7\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\u3002" : "\u8bf7\u7ee7\u7eed\u3002");

  const conversation = await prepareConversation(env, conversationId, userContent);

  if (image) {
    try {
      console.log("received image");

      if (env.DB) {
        await saveMessage(env.DB, conversation.id, "user", userContent);
      }

      const base64 = image.split(",")[1];

      if (!base64) {
        throw new Error("Image DataURL format is invalid");
      }

      const imageBytes = Array.from(
        Uint8Array.from(
          atob(base64),
          c => c.charCodeAt(0)
        )
      );

      const result = await callModel({
        env,
        model: "@cf/meta/llama-3.2-11b-vision-instruct",
        prompt: "\u8bf7\u7528\u4e2d\u6587\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\uff0c\u8bf4\u660e\u56fe\u7247\u4e2d\u7684\u4e3b\u8981\u5bf9\u8c61\u3001\u573a\u666f\u548c\u53ef\u80fd\u7528\u9014\u3002",
        image: imageBytes,
        max_tokens: 256
      });
      const reply = result.response.response || JSON.stringify(result.response);

      if (env.DB) {
        await saveMessage(env.DB, conversation.id, "assistant", reply);
        await maybeUpdateConversationSummary(env, conversation.id);
      }

      return new Response(
        "data: " + JSON.stringify({
          response: reply
        }) + "\n\n" +
        "data: " + JSON.stringify({
          conversationId: conversation.id
        }) + "\n\n" +
        "data: [DONE]\n\n",
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "X-Conversation-Id": conversation.id,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    } catch (err) {
      console.log("image recognition failed", err);

      return new Response(
        "data: " + JSON.stringify({
          response:
            "\u56fe\u7247\u8bc6\u522b\u5931\u8d25\uff1a\n\n" +
            "name: " + (err.name || "") + "\n" +
            "message: " + (err.message || String(err))
        }) + "\n\n",
        {
          status: 200,
          headers: {
            ...corsHeaders(),
            "X-Conversation-Id": conversation.id,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    }
  }

  const savedUserMessage = env.DB
    ? await saveMessage(env.DB, conversation.id, "user", userContent)
    : null;

  const historyMessages = env.DB
    ? await buildConversationContext(env, conversation.id, {
      limit: 14,
      excludeMessageId: savedUserMessage?.id
    })
    : messages.filter(message => message.role !== "system");

  const modelMessages = [
    defaultSystemMessage
  ];

  const ragFiles = [];
  let ragSources = [];
  const requestedToolCall = toolCall?.name
    ? toolCall
    : getAutoFetchToolCall(userContent);
  const executedToolCall = await runRequestedTool(requestedToolCall, env);
  const toolSources = buildToolSources(executedToolCall);

  if (file && file.text) {
    ragFiles.push(file);
  }

  if (Array.isArray(fileIds) && fileIds.length) {
    const fileChunks = await getRelevantFileChunksByIds(env, fileIds, userContent, {
      perFileLimit: 5,
      totalLimit: 14
    });

    console.log("[file-rag]", "selected files:", fileIds.length, "retrieved chunks:", fileChunks.length);
    ragSources = buildFileSources(fileChunks);

    if (fileChunks.length) {
      ragFiles.push({
        name: "\u5df2\u9009\u62e9\u7684\u6587\u4ef6 chunks",
        type: "file-chunks",
        chunks: fileChunks
      });
    }
  }

  if (ragFiles.length) {
    const filePrompt =
      "\u7528\u6237\u9009\u62e9\u4e86\u6587\u4ef6\u4e0a\u4e0b\u6587\u3002\u4e0b\u9762\u662f\u4ece\u6587\u4ef6\u4e2d\u63d0\u53d6\u51fa\u7684\u76f8\u5173\u7247\u6bb5\uff0c\u8bf7\u4f18\u5148\u4f9d\u636e\u8fd9\u4e9b\u7247\u6bb5\u56de\u7b54\u7528\u6237\u95ee\u9898\uff1b\u5982\u679c\u7247\u6bb5\u4fe1\u606f\u4e0d\u8db3\uff0c\u8bf7\u660e\u786e\u8bf4\u660e\u3002\n\n" +
      ragFiles.map((item, index) => {
        if (Array.isArray(item.chunks)) {
          return item.chunks.map(chunk => {
            return [
              "[File: " + chunk.filename + "]",
              "Chunk " + chunk.chunkIndex + (chunk.fallback ? " (fallback)" : "") + ":",
              chunk.content
            ].join("\n");
          }).join("\n\n");
        }

        return [
          "\u3010\u6587\u4ef6 " + (index + 1) + "\u3011",
          "\u6587\u4ef6\u540d\uff1a" + item.name,
          "\u6587\u4ef6\u7c7b\u578b\uff1a" + (item.type || "unknown"),
          "\u8d44\u6599\u5185\u5bb9\uff1a",
          (item.text || "").slice(0, 12000)
        ].join("\n");
      }).join("\n\n");

    modelMessages.push({
      role: "user",
      content: filePrompt
    });
  }

  if (executedToolCall) {
    const toolContext = executedToolCall.error
      ? [
        "A requested tool call failed.",
        "Tool: " + executedToolCall.name,
        "Error: " + executedToolCall.error,
        "Please explain the failure clearly and continue with any available context."
      ].join("\n")
      : [
        "The user requested a single tool call before answering.",
        "Use the following tool result as context. Do not claim to have browsed beyond this result.",
        "",
        formatToolContext(executedToolCall)
      ].join("\n");

    modelMessages.push({
      role: "user",
      content: toolContext
    });
  }

  modelMessages.push(...historyMessages);
  modelMessages.push({
    role: "user",
    content: userContent
  });

  try {
    const result = await callModel({
      env,
      model: model || DEFAULT_TEXT_MODEL,
      messages: modelMessages,
      stream: true
    });
    const aiResponse = result.response;

    return new Response(streamWithHistorySave(aiResponse, env, conversation.id, ragSources, toolSources), {
      headers: {
        ...corsHeaders(),
        "X-Conversation-Id": conversation.id,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });
  } catch (err) {
    console.log("AI request failed", err);

    return new Response(
      "data: " + JSON.stringify({
        response:
          "AI \u8bf7\u6c42\u5931\u8d25\uff1a\n\n" +
          "name: " + err.name + "\n" +
          "message: " + err.message + "\n" +
          "stack: " + err.stack
      }) + "\n\n",
      {
        headers: {
          ...corsHeaders(),
          "X-Conversation-Id": conversation.id,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      }
    );
  }
}
