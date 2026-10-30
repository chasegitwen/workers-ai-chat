// /api/hermes/* routes. Session auth is required for every route (checked here as well as
// in index.js). Hermes routes 404 entirely unless HERMES_CATALOG_VISIBLE is on; submit and
// reconcile additionally require HERMES_EXECUTION_ENABLED.

import { requireAuth } from "../lib/auth.js";
import { jsonResponse } from "../utils/response.js";
import { getHermesCatalog } from "./catalog.js";
import { createHermesClient } from "./client.js";
import {
  HERMES_INSTANCES,
  describeHermesUpstream,
  hermesCatalogVisible,
  hermesExecutionEnabled,
  hermesInstance
} from "./config.js";
import { HermesError, publicError, safeCode, safeMessage } from "./errors.js";
import { HERMES_APPROVAL_POLICY } from "./permissions.js";
import {
  assertConversationAccess,
  cancelHermesRun,
  hermesCapabilities,
  listHermesRuns,
  publicHermesRun,
  readRunById,
  reconcileHermesRun,
  recordHermesEventSeq,
  requireOwnedHermesRun,
  respondToHermesApproval,
  resolveUnknownHermesRun,
  sanitizeHermesApprovalPrompt,
  submitHermesRun,
  syncHermesRun
} from "./runs.js";
import { createSseParser, formatSseFrame } from "./sse.js";
import { isHermesTerminal, mapHermesUpstreamStatus } from "./status.js";

const RUN_ROUTE = /^\/api\/hermes\/runs\/(hrun_[a-f0-9]{32})(?:\/(events|cancel|approval|reconcile|resolve-unknown))?$/;
const MAX_DELTA_CHARS = 8000;

function errorResponse(err) {
  const status = err instanceof HermesError ? err.httpStatus : 500;
  const body = { ok: false, error: publicError(err) };
  if (err?.activeRunId) body.activeRunId = err.activeRunId;
  if (!(err instanceof HermesError)) console.warn("[hermes] internal_error", { name: err?.name || "Error" });
  return jsonResponse(body, status);
}

function projectIdFrom(url, body) {
  return String(body?.project_id || url.searchParams.get("project_id") || "").trim().slice(0, 160);
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch (err) {
    throw new HermesError("hermes_invalid_json", "Request body must be a JSON object", { httpStatus: 400 });
  }
}

async function runResponse(env, row, extra = {}) {
  const capabilities = isHermesTerminal(row?.status) ? null : await hermesCapabilities(env, row.instance_id);
  return jsonResponse({ ok: true, run: publicHermesRun(row, { capabilities }), ...extra });
}

async function handleCatalog(env, url, options) {
  const instanceId = String(url.searchParams.get("instance_id") || "oracle-hermes");
  if (!hermesInstance(instanceId)) throw new HermesError("hermes_unknown_instance", "Unknown Hermes instance", { httpStatus: 400 });
  const upstream = describeHermesUpstream(env, instanceId);
  const base = {
    ok: true,
    visible: true,
    executionEnabled: hermesExecutionEnabled(env),
    approvalPolicy: HERMES_APPROVAL_POLICY,
    instances: Object.values(HERMES_INSTANCES).map(instance => ({
      id: instance.id,
      label: instance.label,
      configured: describeHermesUpstream(env, instance.id).configured,
      agents: instance.agents.map(agent => ({ id: agent.id, name: agent.label }))
    }))
  };
  if (!upstream.configured) {
    return jsonResponse({ ...base, catalog: null, stale: false, catalogError: { code: upstream.reason, message: "Hermes instance is not configured" } });
  }
  try {
    const result = await getHermesCatalog(env, instanceId, { refresh: url.searchParams.get("refresh") === "1", fetchImpl: options.fetchImpl });
    return jsonResponse({
      ...base,
      catalog: result.catalog,
      stale: result.stale,
      catalogError: result.error ? publicError(result.error) : null
    });
  } catch (err) {
    return jsonResponse({ ...base, catalog: null, stale: false, catalogError: publicError(err) });
  }
}

function sanitizeEvent(frame) {
  const data = frame.data || {};
  const event = String(frame.event || "");
  const out = { event, seq: frame.seq };
  switch (event) {
    case "message.delta":
      out.delta = String(data.delta ?? "").slice(0, MAX_DELTA_CHARS);
      return out;
    case "tool.started":
      out.tool = safeCode(String(data.tool || "").toLowerCase().replace(/[^a-z0-9_]/g, "_")) || "tool";
      out.preview = safeMessage(data.preview || "").slice(0, 200);
      return out;
    case "tool.completed":
      out.tool = safeCode(String(data.tool || "").toLowerCase().replace(/[^a-z0-9_]/g, "_")) || "tool";
      out.error = data.error === true;
      out.duration = Number.isFinite(data.duration) ? data.duration : null;
      return out;
    case "approval.request":
      out.approval = sanitizeHermesApprovalPrompt(data, {
        executionGeneration: data.execution_generation,
        respondable: true
      });
      return out;
    case "run.queued":
    case "run.steered":
    case "approval.settled":
    case "approval.responded":
      return out;
    case "replay.truncated":
      out.oldestRetainedSeq = Number.isInteger(data.oldest_retained_seq) ? data.oldest_retained_seq : null;
      return out;
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
    case "run.interrupted":
      // The terminal event only signals; the outcome is taken from GET /v1/runs/{id}.
      out.terminal = true;
      out.upstreamStatus = mapHermesUpstreamStatus(event.slice(4)) || null;
      return out;
    default:
      return null;
  }
}

async function handleEvents(request, env, row, url, options) {
  const encoder = new TextEncoder();
  // Upstream SSE replay is not relied on (unverified behind Tunnel/Access): no Last-Event-ID or
  // last_seq is forwarded. After a disconnect the client re-reads state via GET instead.
  // last_event_seq is kept for diagnostics only.
  const lastSeq = Number.isInteger(row.last_event_seq) ? row.last_event_seq : -1;
  const sseHeaders = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no"
  };

  if (isHermesTerminal(row.status) || !row.upstream_run_id) {
    const frame = formatSseFrame({ event: "hermes.snapshot", run: publicHermesRun(row) });
    return new Response(frame, { headers: sseHeaders });
  }

  let upstream;
  try {
    const client = createHermesClient(env, row.instance_id, { fetchImpl: options.fetchImpl });
    upstream = await client.openEvents(row.upstream_run_id, { signal: request.signal });
  } catch (err) {
    // No state change: the client falls back to polling GET /api/hermes/runs/{id}.
    const frame = formatSseFrame({ event: "hermes.stream_unavailable", error: publicError(err) });
    return new Response(frame, { headers: sseHeaders });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const write = text => writer.write(encoder.encode(text));

  const pump = (async () => {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    let maxSeq = lastSeq;
    let sawTerminal = false;
    const handleFrames = async frames => {
      for (const frame of frames) {
        if (frame.type === "comment") {
          if (frame.comment === "keepalive") await write(": keepalive\n\n");
          continue;
        }
        if (frame.type !== "event") continue;
        if (Number.isInteger(frame.seq) && frame.seq > maxSeq) maxSeq = frame.seq;
        const safe = sanitizeEvent(frame);
        if (!safe) continue;
        await write(formatSseFrame(safe, Number.isInteger(frame.seq) ? frame.seq : null));
        if (safe.terminal) sawTerminal = true;
      }
    };
    try {
      await write(": open\n\n");
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await handleFrames(parser.push(decoder.decode(value, { stream: true })));
        if (sawTerminal) break;
      }
      if (!sawTerminal) await handleFrames(parser.flush());
    } catch (err) {
      // Disconnects are not outcomes.
    }
    try {
      await recordHermesEventSeq(env, row.id, maxSeq);
      let snapshot = null;
      if (sawTerminal) {
        const synced = await syncHermesRun(env, await readRunById(env.DB, row.id), { fetchImpl: options.fetchImpl });
        snapshot = synced.run;
      }
      await write(formatSseFrame(snapshot
        ? { event: "hermes.snapshot", run: publicHermesRun(snapshot) }
        : { event: "hermes.stream_closed", terminal: false, lastEventSeq: maxSeq }));
    } catch (err) {
      // Client went away; nothing else to do.
    }
    reader.cancel().catch(() => { /* already closed or errored */ });
    try { await writer.close(); } catch (err) { /* already closed */ }
  })();
  options.ctx?.waitUntil?.(pump);
  return new Response(readable, { headers: sseHeaders });
}

export async function handleHermes(request, env, url, ctx, options = {}) {
  if (!url.pathname.startsWith("/api/hermes")) return null;
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  if (!hermesCatalogVisible(env)) {
    return jsonResponse({ ok: false, error: { code: "hermes_disabled", message: "Hermes is not enabled" } }, 404);
  }
  if (!env.DB) return jsonResponse({ ok: false, error: { code: "hermes_no_database", message: "D1 binding is missing" } }, 503);
  const owner = auth.session.username;
  const routeOptions = { fetchImpl: options.fetchImpl, ctx };

  try {
    if (url.pathname === "/api/hermes/catalog" && request.method === "GET") {
      return await handleCatalog(env, url, routeOptions);
    }

    if (url.pathname === "/api/hermes/runs" && request.method === "POST") {
      if (!hermesExecutionEnabled(env)) {
        throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
      }
      const body = await readJsonBody(request);
      const result = await submitHermesRun(env, { owner, body, fetchImpl: options.fetchImpl });
      const response = await runResponse(env, result.run, { replayed: result.replayed });
      return result.replayed ? response : new Response(response.body, { status: 202, headers: response.headers });
    }

    if (url.pathname === "/api/hermes/runs" && request.method === "GET") {
      const projectId = projectIdFrom(url);
      const conversationId = String(url.searchParams.get("conversation_id") || "").trim().slice(0, 160);
      if (!projectId || !conversationId) {
        throw new HermesError("hermes_scope_required", "project_id and conversation_id are required", { httpStatus: 400 });
      }
      await assertConversationAccess(env, { owner, projectId, conversationId });
      const rows = await listHermesRuns(env, { owner, projectId, conversationId });
      const capabilityByInstance = new Map();
      for (const row of rows) {
        if (!isHermesTerminal(row.status) && !capabilityByInstance.has(row.instance_id)) {
          capabilityByInstance.set(row.instance_id, await hermesCapabilities(env, row.instance_id));
        }
      }
      return jsonResponse({
        ok: true,
        runs: rows.map(row => publicHermesRun(row, {
          capabilities: capabilityByInstance.get(row.instance_id) || null
        }))
      });
    }

    const match = url.pathname.match(RUN_ROUTE);
    if (!match) {
      return jsonResponse({ ok: false, error: { code: "hermes_not_found", message: "Not found" } }, 404);
    }
    const [, runId, action = ""] = match;
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const projectId = projectIdFrom(url, body);
    if (!projectId) throw new HermesError("hermes_scope_required", "project_id is required", { httpStatus: 400 });
    const row = await requireOwnedHermesRun(env, { runId, owner, projectId });

    if (!action && request.method === "GET") {
      const { run, syncError } = await syncHermesRun(env, row, routeOptions);
      return await runResponse(env, run, { syncError });
    }
    if (action === "events" && request.method === "GET") {
      return await handleEvents(request, env, row, url, routeOptions);
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: { code: "hermes_method_not_allowed", message: "Method not allowed" } }, 405);
    }
    if (action === "cancel") {
      const { run, cancelError } = await cancelHermesRun(env, row, routeOptions);
      return await runResponse(env, run, { cancelError });
    }
    if (action === "approval") {
      if (!hermesExecutionEnabled(env)) {
        throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
      }
      const { run, approvalResponse } = await respondToHermesApproval(env, row, body, routeOptions);
      return await runResponse(env, run, { approvalResponse });
    }
    if (action === "reconcile") {
      if (!hermesExecutionEnabled(env)) {
        throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
      }
      const { run } = await reconcileHermesRun(env, row, routeOptions);
      return await runResponse(env, run);
    }
    if (action === "resolve-unknown") {
      const { run, syncError } = await resolveUnknownHermesRun(env, row, routeOptions);
      return await runResponse(env, run, { syncError });
    }
    return jsonResponse({ ok: false, error: { code: "hermes_not_found", message: "Not found" } }, 404);
  } catch (err) {
    return errorResponse(err);
  }
}
