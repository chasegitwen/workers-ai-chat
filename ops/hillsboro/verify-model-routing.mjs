import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:18793";
const token = String(process.env.OPENCLAW_BRIDGE_TOKEN || "");
if (!token) throw new Error("OPENCLAW_BRIDGE_TOKEN is required");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error || "request_failed"}: ${data.message || "request failed"}`);
  return data;
}

async function waitResult(taskId) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const status = await call(`/v1/openclaw/tasks/${encodeURIComponent(taskId)}/status`);
    if (status.status === "completed") return call(`/v1/openclaw/tasks/${encodeURIComponent(taskId)}/result`);
    if (["failed", "canceled"].includes(status.status)) throw new Error(`task ${taskId}: ${status.error || status.status}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`task ${taskId}: timeout`);
}

async function createTurn({ conversationId, message, baseModelId = "" }) {
  const created = await call("/v1/openclaw/tasks", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: conversationId,
      agent_id: "glm51",
      selection_mode: "openclaw-agent",
      base_model_id: baseModelId,
      message,
      idempotency_key: randomUUID()
    })
  });
  return { created, result: await waitResult(created.task_id) };
}

async function importWithExport(prefix, exportName) {
  const dist = "/usr/lib/node_modules/openclaw/dist";
  for (const name of (await fs.readdir(dist)).filter(name => name.startsWith(prefix) && name.endsWith(".js"))) {
    const mod = await import(pathToFileURL(`${dist}/${name}`).href);
    if (typeof mod?.[exportName] !== "undefined") return mod;
  }
  throw new Error(`${exportName} unavailable`);
}

const catalog = await call("/v1/openclaw/catalog?refresh=1");
const conversationId = `bridge-model-routing-verify-${randomUUID()}`;
const sessionKeys = [];
try {
  const first = await createTurn({ conversationId, message: "Reply exactly BRIDGE_TURN_ONE_OK." });
  sessionKeys.push(first.created.session_key);
  const second = await createTurn({
    conversationId,
    baseModelId: "zai/glm-5.2",
    message: "State the exact code requested in the previous turn, then add BRIDGE_TURN_TWO_OK."
  });
  sessionKeys.push(second.created.session_key);
  console.log(JSON.stringify({
    catalog: {
      defaultAgentId: catalog.defaultAgentId,
      modelView: catalog.modelView,
      agents: catalog.agents,
      models: catalog.models
    },
    first: {
      requestedBaseModelId: first.result.requested_base_model_id,
      resolvedBaseModelId: first.result.resolved_base_model_id,
      actualModelId: first.result.actual_model_id,
      finalAnswer: first.result.final_answer
    },
    second: {
      requestedBaseModelId: second.result.requested_base_model_id,
      resolvedBaseModelId: second.result.resolved_base_model_id,
      actualModelId: second.result.actual_model_id,
      finalAnswer: second.result.final_answer,
      preservedContext: String(second.result.final_answer || "").includes("BRIDGE_TURN_ONE_OK")
    }
  }, null, 2));
} finally {
  try {
    const { GatewayChatClient } = await importWithExport("gateway-chat-", "GatewayChatClient");
    const client = await GatewayChatClient.connect({});
    client.start();
    await client.waitForReady();
    for (const key of sessionKeys.reverse()) {
      if (key) await client.client.request("sessions.delete", { key, agentId: "glm51" }, { timeoutMs: 10000 }).catch(() => {});
    }
    if (typeof client.client?.stopAndWait === "function") await client.client.stopAndWait({ timeoutMs: 3000 }).catch(() => {});
    else client.stop?.();
  } catch {}
}
