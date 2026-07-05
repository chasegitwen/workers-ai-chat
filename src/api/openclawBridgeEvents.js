import { corsHeaders, jsonResponse } from "../utils/response.js";

const HEARTBEAT_MS = 15000;
const HISTORY_LIMIT = 100;

const bridgeEventClients = new Map();

function taskKey(taskId) {
  return String(taskId || "").trim();
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text || "");
  } catch (err) {
    return fallback;
  }
}

function bridgeEventStatus(eventType, payload) {
  const status = String(payload?.status || payload?.state || "").trim();
  if (status) {
    return status;
  }
  if (eventType === "bridge.final") {
    return "completed";
  }
  if (eventType === "bridge.error") {
    return "failed";
  }
  if (eventType === "bridge.tool_call") {
    return "tool_calling";
  }
  return "running";
}

function bridgeFinalAnswer(payload) {
  const content = payload?.content && typeof payload.content === "object" ? payload.content : {};
  const value = content.final_answer
    ?? content.finalAnswer
    ?? payload?.final_answer
    ?? payload?.result
    ?? payload?.text
    ?? content.result
    ?? content.text
    ?? "";
  return typeof value === "string" ? value : "";
}

export function serializeBridgeEvent(rowOrPayload) {
  const payload = rowOrPayload?.payload_json
    ? safeJsonParse(rowOrPayload.payload_json, {})
    : (rowOrPayload || {});
  const eventType = String(rowOrPayload?.event_type || payload?.event_type || "").trim();
  const data = {
    event_id: String(rowOrPayload?.event_id || payload?.event_id || ""),
    task_id: String(rowOrPayload?.task_id || payload?.task_id || ""),
    conversation_id: String(rowOrPayload?.conversation_id || payload?.conversation_id || ""),
    assistant_message_id: String(rowOrPayload?.assistant_message_id || payload?.assistant_message_id || ""),
    event_type: eventType,
    sequence: rowOrPayload?.sequence ?? payload?.sequence ?? null,
    created_at: String(rowOrPayload?.created_at || payload?.created_at || ""),
    received_at: String(rowOrPayload?.received_at || payload?.received_at || new Date().toISOString()),
    content: payload?.content && typeof payload.content === "object" ? payload.content : {},
    status: bridgeEventStatus(eventType, payload)
  };

  if (eventType === "bridge.final") {
    data.final_answer = bridgeFinalAnswer(payload);
    data.result_finality = String(payload?.result_finality || payload?.resultFinality || "final");
  }

  if (eventType === "bridge.error") {
    data.error = String(payload?.error || data.content.error || data.content.message || data.content.text || "OpenClaw Bridge error");
  }

  return data;
}

export function encodeBridgeSseEvent(event, data) {
  return "event: " + event + "\n" +
    "data: " + JSON.stringify(data) + "\n\n";
}

function subscribeBridgeEvent(taskId, controller) {
  const key = taskKey(taskId);
  if (!bridgeEventClients.has(key)) {
    bridgeEventClients.set(key, new Set());
  }
  bridgeEventClients.get(key).add(controller);
  return () => {
    const clients = bridgeEventClients.get(key);
    if (!clients) {
      return;
    }
    clients.delete(controller);
    if (!clients.size) {
      bridgeEventClients.delete(key);
    }
  };
}

export function broadcastOpenClawBridgeEvent(payload) {
  const data = serializeBridgeEvent(payload);
  const key = taskKey(data.task_id);
  const clients = bridgeEventClients.get(key);
  if (!clients?.size || !data.event_id) {
    return 0;
  }
  const chunk = new TextEncoder().encode(encodeBridgeSseEvent("bridge_event", data));
  let delivered = 0;
  for (const controller of [...clients]) {
    try {
      controller.enqueue(chunk);
      delivered += 1;
    } catch (err) {
      clients.delete(controller);
    }
  }
  if (!clients.size) {
    bridgeEventClients.delete(key);
  }
  return delivered;
}

async function readTaskForEventStream(env, taskId) {
  if (!env.DB) {
    return null;
  }
  return env.DB.prepare(
    `SELECT id, conversation_id, bridge_task_id, remote_task_id
      FROM openclaw_tasks
      WHERE id = ?
        OR bridge_task_id = ?
        OR remote_task_id = ?
      LIMIT 1`
  ).bind(taskId, taskId, taskId).first();
}

async function readBridgeEventHistory(env, task) {
  const ids = [
    task.id,
    task.bridge_task_id,
    task.remote_task_id
  ].map(value => String(value || "").trim()).filter(Boolean);
  if (!ids.length) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT *
      FROM bridge_events
      WHERE applied = 1
        AND task_id IN (${placeholders})
      ORDER BY
        CASE WHEN sequence IS NULL THEN 1 ELSE 0 END,
        sequence ASC,
        received_at ASC
      LIMIT ?`
  ).bind(...ids, HISTORY_LIMIT).all();
  return result?.results || [];
}

export async function handleOpenClawBridgeEventStream(request, env, url) {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!env.DB) {
    return jsonResponse({ ok: false, error: "D1 binding DB is not configured" }, 500);
  }

  const requestedTaskId = taskKey(url.searchParams.get("task_id") || url.searchParams.get("taskId"));
  if (!requestedTaskId) {
    return jsonResponse({ ok: false, error: "task_id is required" }, 400);
  }

  const task = await readTaskForEventStream(env, requestedTaskId);
  if (!task) {
    return jsonResponse({ ok: false, error: "OpenClaw task not found" }, 404);
  }

  const streamTaskIds = [...new Set([
    task.id,
    task.bridge_task_id,
    task.remote_task_id
  ].map(value => taskKey(value)).filter(Boolean))];
  const encoder = new TextEncoder();
  let unsubscribeAll = null;
  let heartbeatTimer = null;

  const stream = new ReadableStream({
    async start(controller) {
      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (unsubscribeAll) {
          unsubscribeAll();
          unsubscribeAll = null;
        }
      };

      try {
        const history = await readBridgeEventHistory(env, task);
        for (const row of history) {
          controller.enqueue(encoder.encode(encodeBridgeSseEvent("bridge_event", serializeBridgeEvent(row))));
        }
        const unsubscribeFns = streamTaskIds.map(id => subscribeBridgeEvent(id, controller));
        unsubscribeAll = () => {
          unsubscribeFns.forEach(fn => fn());
        };
        controller.enqueue(encoder.encode(": connected\n\n"));
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
          } catch (err) {
            cleanup();
          }
        }, HEARTBEAT_MS);
      } catch (err) {
        cleanup();
        controller.error(err);
      }
    },
    cancel() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (unsubscribeAll) {
        unsubscribeAll();
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
