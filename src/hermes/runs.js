// Hermes run service: D1 state machine over the Hermes v0.22.5 /v1/runs API.
//
// Invariants
// - (owner, project, conversation) is bound in hermes_conversation_bindings and every run
//   carries all three; reads filter on owner and project.
// - One run per (owner, client_request_id); the upstream Idempotency-Key is derived from the
//   local run id and persisted before the POST.
// - At most one run holds the global execution slot (unique partial index). There is no
//   queue: a second submit while the slot is held fails with hermes_busy.
// - Nothing is retried automatically. submission_unknown, unknown and interrupted each need
//   an explicit, separate user action (reconcile / resolve-unknown / resend).
// - The SSE stream is advisory; status changes come from GET /v1/runs/{id} only, and a
//   dropped stream never changes run state.
// - The assistant message has a deterministic id and is inserted with INSERT OR IGNORE in
//   the same batch that moves the run to completed, so it is written at most once.

import { ensureConversation } from "../api/history.js";
import { readProject } from "../api/projects.js";
import { createHermesClient, isHermesRunId } from "./client.js";
import {
  HERMES_APPROVAL_CLAIM_STALE_MS,
  HERMES_AGENT_ID,
  HERMES_MAX_INPUT_CHARS,
  HERMES_STALE_SUBMIT_MS,
  ORACLE_HERMES_INSTANCE_ID,
  hermesInstance,
  resolveHermesUpstream
} from "./config.js";
import { getHermesCatalog, validateHermesModelSelection } from "./catalog.js";
import { HermesError, publicError, safeCode, safeMessage } from "./errors.js";
import {
  HERMES_APPROVAL_CHOICES,
  HERMES_APPROVAL_POLICY,
  canRespondToHermesApproval,
  sanitizeHermesApprovalPrompt
} from "./permissions.js";
import {
  HERMES_ACTIVE_STATUSES,
  HERMES_TERMINAL_STATUSES,
  isHermesTerminal,
  mapHermesUpstreamStatus,
  sqlStatusList
} from "./status.js";

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ACTIVE_SQL = sqlStatusList(HERMES_ACTIVE_STATUSES);
const TERMINAL_SQL = sqlStatusList(HERMES_TERMINAL_STATUSES);
const RECONCILE_RETENTION_MARGIN_MS = 60 * 60 * 1000;

const RUN_COLUMNS = `id, owner_username, project_id, conversation_id, instance_id, agent_id, client_request_id,
  request_fingerprint, upstream_idempotency_key, upstream_request_json, upstream_run_id, upstream_session_id,
  admission_id, execution_generation, model_mode, requested_provider, requested_model, actual_provider,
  actual_model, route_source, status, upstream_status, status_detail, error_code, error_message, holds_slot,
  last_event_seq, user_message_id, assistant_message_id, usage_json, cancel_requested_at, submitted_at,
  completed_at, approval_request_id, approval_generation, approval_json, approval_response_pending,
  approval_response_started_at, created_at, updated_at`;

function log(event, detail) {
  console.log("[hermes] " + event, detail);
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function isUniqueViolation(err) {
  return /unique constraint failed|constraint failed: unique/i.test(String(err?.message || err || ""));
}

function userMessageId(runId) {
  return "hermes-user-" + runId;
}

function assistantMessageId(runId) {
  return "hermes-assistant-" + runId;
}

function safeModelId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/.test(text) ? text : "";
}

function whitelistUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const out = {};
  ["input_tokens", "output_tokens", "total_tokens", "cache_read_tokens", "cache_write_tokens"].forEach(key => {
    if (Number.isFinite(usage[key])) out[key] = Math.max(0, Math.floor(usage[key]));
  });
  return Object.keys(out).length ? out : null;
}

function whitelistRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") return null;
  const provider = safeModelId(runtime.provider);
  const model = safeModelId(runtime.model);
  const routeSource = safeCode(runtime.route_source);
  return provider || model || routeSource ? { provider, model, routeSource } : null;
}

function parseStoredApproval(row) {
  if (!row?.approval_json) return null;
  try {
    const approval = JSON.parse(row.approval_json);
    return approval && typeof approval === "object" ? approval : null;
  } catch (err) {
    return null;
  }
}

function approvalFromSnapshot(snapshot, fallbackGeneration = null) {
  const controls = Array.isArray(snapshot?.pending_controls) ? snapshot.pending_controls : [];
  const prompt = controls.find(control => {
    const kind = String(control?.kind || control?.type || control?.control_type || "").toLowerCase();
    return kind === "approval" || (!kind && Boolean(control?.prompt_id || control?.request_id));
  }) || (snapshot?.approval && typeof snapshot.approval === "object" ? snapshot.approval : null);
  return sanitizeHermesApprovalPrompt(prompt, {
    executionGeneration: Number.isInteger(snapshot?.execution_generation)
      ? snapshot.execution_generation
      : fallbackGeneration
  });
}

export function publicHermesRun(row, { capabilities = null } = {}) {
  if (!row) return null;
  let usage = null;
  try {
    usage = row.usage_json ? JSON.parse(row.usage_json) : null;
  } catch (err) {
    usage = null;
  }
  const terminal = isHermesTerminal(row.status);
  const storedApproval = row.status === "waiting_for_approval" ? parseStoredApproval(row) : null;
  const approvalRespondable = canRespondToHermesApproval({ capabilities, run: row, prompt: storedApproval });
  const approval = storedApproval ? sanitizeHermesApprovalPrompt(storedApproval, {
    executionGeneration: row.approval_generation,
    respondable: approvalRespondable && !row.approval_response_pending,
    responding: Boolean(row.approval_response_pending)
  }) : (row.status === "waiting_for_approval" ? {
    required: true,
    respondable: false,
    responding: Boolean(row.approval_response_pending),
    policy: HERMES_APPROVAL_POLICY
  } : null);
  return {
    id: row.id,
    runtimeType: "hermes",
    conversationId: row.conversation_id,
    projectId: row.project_id,
    instanceId: row.instance_id,
    agentId: row.agent_id,
    clientRequestId: row.client_request_id,
    upstreamRunId: row.upstream_run_id || null,
    status: row.status,
    upstreamStatus: row.upstream_status || null,
    statusDetail: row.status_detail || null,
    terminal,
    modelMode: row.model_mode,
    requestedProvider: row.requested_provider || null,
    requestedModel: row.requested_model || null,
    actualProvider: row.actual_provider || null,
    actualModel: row.actual_model || null,
    routeSource: row.route_source || null,
    error: row.error_code ? { code: row.error_code, message: row.error_message || "" } : null,
    lastEventSeq: Number.isInteger(row.last_event_seq) ? row.last_event_seq : -1,
    assistantMessageId: row.assistant_message_id || null,
    usage,
    approval,
    cancelRequested: Boolean(row.cancel_requested_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    actions: hermesRunActions(row, { capabilities })
  };
}

export function hermesRunActions(row, { capabilities = null, now = Date.now() } = {}) {
  const actions = [];
  if (!row || isHermesTerminal(row.status)) return actions;
  if (row.upstream_run_id) actions.push("refresh");
  if (row.upstream_run_id && ["queued", "running", "waiting_for_approval", "stopping", "cancel_requested"].includes(row.status)) {
    actions.push("cancel");
  }
  const approval = parseStoredApproval(row);
  if (!row.approval_response_pending
    && canRespondToHermesApproval({ capabilities, run: row, prompt: approval })) {
    actions.unshift("approve_once", "deny");
  }
  // No user action releases the slot while the remote outcome is unknown: submission_unknown
  // and unknown keep holds_slot=1 until an authoritative terminal status is observed or an
  // operator releases it after confirming on the Hermes side (manual D1 step, no public API).
  if (row.status === "submission_unknown" && reconcileAllowed(row, capabilities, now).ok) actions.push("reconcile");
  if (row.status === "unknown" && row.status_detail !== "upstream_not_found") {
    if (row.admission_id && Number.isInteger(row.execution_generation)
      && capabilities?.features?.run_unknown_resolution) actions.push("resolve_unknown");
  }
  return actions;
}

function reconcileAllowed(row, capabilities, now) {
  const idem = capabilities?.runsIdempotency;
  if (!idem?.supported || !idem.durable) return { ok: false, code: "hermes_idempotency_not_durable" };
  const retentionMs = (idem.retentionSeconds || 0) * 1000;
  if (!retentionMs || now - Number(row.created_at || 0) > retentionMs - RECONCILE_RETENTION_MARGIN_MS) {
    return { ok: false, code: "hermes_idempotency_window_expired" };
  }
  return { ok: true };
}

async function readRunById(db, id) {
  return db.prepare("SELECT " + RUN_COLUMNS + " FROM hermes_runs WHERE id = ?").bind(id).first();
}

async function readOwnedRun(db, { runId, owner, projectId }) {
  if (!runId || !owner || !projectId) return null;
  return db.prepare(
    "SELECT " + RUN_COLUMNS + " FROM hermes_runs WHERE id = ? AND owner_username = ? AND project_id = ?"
  ).bind(runId, owner, projectId).first();
}

export async function requireOwnedHermesRun(env, { runId, owner, projectId }) {
  const row = await readOwnedRun(env.DB, { runId, owner, projectId });
  if (!row) throw new HermesError("hermes_run_not_found", "Hermes run not found", { httpStatus: 404 });
  return row;
}

// Conditional update that never touches a terminal run. Returns the number of changed rows.
async function updateActiveRun(db, id, fields, { fromStatuses = HERMES_ACTIVE_STATUSES } = {}) {
  const keys = Object.keys(fields);
  const sql = "UPDATE hermes_runs SET " + keys.map(key => key + " = ?").join(", ")
    + ", updated_at = ? WHERE id = ? AND status IN (" + sqlStatusList(fromStatuses) + ")";
  const result = await db.prepare(sql).bind(...keys.map(key => fields[key]), Date.now(), id).run();
  return result?.meta?.changes || 0;
}

function terminalFields(status, extra = {}) {
  return { status, holds_slot: null, completed_at: Date.now(), ...extra };
}

async function hermesCapabilities(env, instanceId, options = {}) {
  try {
    const { catalog } = await getHermesCatalog(env, instanceId, options);
    return catalog?.capabilities || null;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Conversation binding

async function bindConversation(env, { owner, projectId, conversationId, instanceId, title }) {
  const db = env.DB;
  if (conversationId) {
    const existing = await db.prepare("SELECT id, project_id FROM conversations WHERE id = ?").bind(conversationId).first();
    if (!existing) throw new HermesError("hermes_conversation_not_found", "Conversation not found", { httpStatus: 404 });
    if ((existing.project_id || "default") !== projectId) {
      throw new HermesError("hermes_conversation_forbidden", "Conversation belongs to another project", { httpStatus: 403 });
    }
  }
  const conversation = conversationId
    ? { id: conversationId }
    : await ensureConversation(db, "", title, projectId);
  if (!conversationId && conversation.project_id !== projectId) {
    throw new HermesError("hermes_project_unavailable", "Project is not available", { httpStatus: 400 });
  }
  const timestamp = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO hermes_conversation_bindings
       (conversation_id, owner_username, project_id, instance_id, hermes_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(conversation.id, owner, projectId, instanceId, "webai-" + crypto.randomUUID(), timestamp, timestamp).run();
  const binding = await db.prepare(
    "SELECT conversation_id, owner_username, project_id, instance_id, hermes_session_id FROM hermes_conversation_bindings WHERE conversation_id = ?"
  ).bind(conversation.id).first();
  if (!binding || binding.owner_username !== owner || binding.project_id !== projectId) {
    throw new HermesError("hermes_conversation_forbidden", "Conversation is bound to another user or project", { httpStatus: 403 });
  }
  if (binding.instance_id !== instanceId) {
    throw new HermesError("hermes_conversation_forbidden", "Conversation is bound to another Hermes instance", { httpStatus: 403 });
  }
  return { conversationId: conversation.id, sessionId: binding.hermes_session_id };
}

export async function assertConversationAccess(env, { owner, projectId, conversationId }) {
  const binding = await env.DB.prepare(
    "SELECT owner_username, project_id FROM hermes_conversation_bindings WHERE conversation_id = ?"
  ).bind(conversationId).first();
  if (binding && (binding.owner_username !== owner || binding.project_id !== projectId)) {
    throw new HermesError("hermes_conversation_forbidden", "Conversation is bound to another user or project", { httpStatus: 403 });
  }
  return Boolean(binding);
}

// ---------------------------------------------------------------------------------------
// Submit

function parseSubmitRequest(body) {
  const instanceId = cleanText(body?.instance_id || ORACLE_HERMES_INSTANCE_ID, 80);
  const agentId = cleanText(body?.agent_id || HERMES_AGENT_ID, 80);
  const clientRequestId = cleanText(body?.client_request_id, 160);
  const projectId = cleanText(body?.project_id, 160);
  const conversationId = cleanText(body?.conversation_id, 160);
  const input = String(body?.input ?? "").trim();
  const provider = cleanText(body?.provider, 80);
  const model = cleanText(body?.model, 160);
  const instance = hermesInstance(instanceId);
  if (!instance) throw new HermesError("hermes_unknown_instance", "Unknown Hermes instance", { httpStatus: 400 });
  if (!instance.agents.some(agent => agent.id === agentId)) {
    throw new HermesError("hermes_unknown_agent", "Unknown Hermes agent", { httpStatus: 400 });
  }
  if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw new HermesError("hermes_invalid_request_id", "client_request_id is required (8-128 chars [A-Za-z0-9_-])", { httpStatus: 400 });
  }
  if (!projectId) throw new HermesError("hermes_project_required", "project_id is required", { httpStatus: 400 });
  if (!input) throw new HermesError("hermes_empty_input", "Message is empty", { httpStatus: 400 });
  if (input.length > HERMES_MAX_INPUT_CHARS) {
    throw new HermesError("hermes_input_too_long", "Message is too long for Hermes", { httpStatus: 413 });
  }
  if (body?.attachments?.length || body?.fileIds?.length || body?.conversationAttachmentIds?.length) {
    throw new HermesError("hermes_attachments_unsupported", "Hermes runs accept text only in this stage", { httpStatus: 400 });
  }
  return { instanceId, agentId, clientRequestId, projectId, conversationId, input, provider, model };
}

async function existingByRequestId(db, owner, clientRequestId) {
  return db.prepare(
    "SELECT " + RUN_COLUMNS + " FROM hermes_runs WHERE owner_username = ? AND client_request_id = ?"
  ).bind(owner, clientRequestId).first();
}

function replayOrConflict(existing, fingerprint) {
  if (existing.request_fingerprint !== fingerprint) {
    throw new HermesError("hermes_idempotency_conflict", "client_request_id was already used with a different request", { httpStatus: 409 });
  }
  return { replayed: true, run: existing };
}

export async function submitHermesRun(env, { owner, body, fetchImpl }) {
  const db = env.DB;
  const request = parseSubmitRequest(body);
  const upstream = resolveHermesUpstream(env, request.instanceId);
  if (!upstream.ok) throw new HermesError(upstream.code, "Hermes instance is not configured", { httpStatus: 503 });

  const fingerprint = await sha256Hex(JSON.stringify([
    request.projectId, request.conversationId, request.instanceId, request.agentId,
    request.input, request.provider, request.model
  ]));
  const prior = await existingByRequestId(db, owner, request.clientRequestId);
  if (prior) return replayOrConflict(prior, fingerprint);

  const project = await readProject(db, request.projectId);
  if (!project || project.is_archived) {
    throw new HermesError("hermes_project_unavailable", "Project is not available", { httpStatus: 400 });
  }

  const { catalog } = await getHermesCatalog(env, request.instanceId, { fetchImpl });
  if (!catalog?.capabilities?.executionReady) {
    throw new HermesError("hermes_capability_missing", "Hermes does not advertise the required run capabilities", { httpStatus: 503 });
  }
  const selection = validateHermesModelSelection(catalog, { provider: request.provider, model: request.model });
  if (!selection.ok) throw new HermesError(selection.code, selection.message, { httpStatus: 400 });

  const binding = await bindConversation(env, {
    owner,
    projectId: request.projectId,
    conversationId: request.conversationId,
    instanceId: request.instanceId,
    title: request.input
  });

  const runId = "hrun_" + crypto.randomUUID().replace(/-/g, "");
  const upstreamBody = { input: request.input, session_id: binding.sessionId };
  if (selection.mode === "explicit") {
    upstreamBody.provider = selection.provider;
    upstreamBody.model = selection.model;
  }
  const upstreamRequestJson = JSON.stringify(upstreamBody);
  const timestamp = Date.now();

  try {
    await db.prepare(
      `INSERT INTO hermes_runs (
         id, owner_username, project_id, conversation_id, instance_id, agent_id, client_request_id,
         request_fingerprint, upstream_idempotency_key, upstream_request_json, upstream_session_id,
         model_mode, requested_provider, requested_model, status, holds_slot, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserving', 1, ?, ?)`
    ).bind(
      runId, owner, request.projectId, binding.conversationId, request.instanceId, request.agentId,
      request.clientRequestId, fingerprint, "webai-" + runId, upstreamRequestJson, binding.sessionId,
      selection.mode, selection.provider || null, selection.model || null, timestamp, timestamp
    ).run();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await existingByRequestId(db, owner, request.clientRequestId);
    if (raced) return replayOrConflict(raced, fingerprint);
    const holder = await db.prepare("SELECT id, owner_username, project_id FROM hermes_runs WHERE holds_slot = 1").first();
    const sameScope = holder && holder.owner_username === owner && holder.project_id === request.projectId;
    throw Object.assign(
      new HermesError("hermes_busy", "Another Hermes run is active; wait for it to finish or cancel it", { httpStatus: 409 }),
      { activeRunId: sameScope ? holder.id : null }
    );
  }

  // The user message is written once (deterministic id) before the upstream call so that
  // a submission_unknown run still shows what was sent.
  await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, created_at, metadata) VALUES (?, ?, 'user', ?, ?, NULL)"
    ).bind(userMessageId(runId), binding.conversationId, request.input, timestamp),
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").bind(timestamp, binding.conversationId),
    db.prepare(
      "UPDATE hermes_runs SET status = 'submitting', user_message_id = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'reserving'"
    ).bind(userMessageId(runId), Date.now(), Date.now(), runId)
  ]);

  log("submit", { run_id: runId, instance_id: request.instanceId, model_mode: selection.mode, conversation_id: binding.conversationId });
  await postRun(env, await readRunById(db, runId), { fetchImpl, fromStatuses: ["submitting"] });
  return { replayed: false, run: await readRunById(db, runId) };
}

// Sends (or, for reconcile, re-sends) the persisted body with the persisted Idempotency-Key.
async function postRun(env, row, { fetchImpl, fromStatuses, reconcile = false }) {
  const db = env.DB;
  let response;
  try {
    const client = createHermesClient(env, row.instance_id, { fetchImpl });
    response = await client.createRun(row.upstream_request_json, row.upstream_idempotency_key);
  } catch (err) {
    const error = err instanceof HermesError ? err : new HermesError("hermes_internal_error", "Hermes submit failed", { ambiguous: true });
    // A refused reconcile says nothing about the original POST, which may have created the run:
    // the outcome stays unknown and the slot stays held.
    if (error.ambiguous || reconcile) {
      await updateActiveRun(db, row.id, {
        status: "submission_unknown",
        status_detail: error.code,
        error_code: error.code,
        error_message: error.message
      }, { fromStatuses });
      log("submit_unknown", { run_id: row.id, code: error.code, upstream_status: error.upstreamStatus });
    } else {
      await updateActiveRun(db, row.id, terminalFields("rejected", {
        status_detail: error.upstreamCode || error.code,
        error_code: error.code,
        error_message: error.message
      }), { fromStatuses });
      log("submit_rejected", { run_id: row.id, code: error.code, upstream_status: error.upstreamStatus });
    }
    return;
  }
  const upstreamRunId = String(response.body?.run_id || "");
  if (!isHermesRunId(upstreamRunId)) {
    await updateActiveRun(db, row.id, {
      status: "submission_unknown",
      status_detail: "hermes_bad_response",
      error_code: "hermes_bad_response",
      error_message: "Hermes accepted the request without a valid run id"
    }, { fromStatuses });
    return;
  }
  const upstreamStatus = safeCode(response.body?.status);
  const mapped = mapHermesUpstreamStatus(upstreamStatus);
  // A replayed key may already report a terminal status; the GET snapshot settles that, so
  // only non-terminal states are taken from the submit response.
  await updateActiveRun(db, row.id, {
    upstream_run_id: upstreamRunId,
    upstream_status: upstreamStatus || null,
    status: mapped && !isHermesTerminal(mapped) ? mapped : "queued",
    status_detail: response.body?.replayed === true ? "idempotent_replay" : null,
    error_code: null,
    error_message: null
  }, { fromStatuses });
  log("submit_accepted", { run_id: row.id, upstream_run_id: upstreamRunId, replayed: response.body?.replayed === true });
  if (mapped && isHermesTerminal(mapped)) {
    await syncHermesRun(env, await readRunById(db, row.id), { fetchImpl });
  }
}

// ---------------------------------------------------------------------------------------
// Status sync and finalization

async function finalizeCompleted(env, row, snapshot) {
  const db = env.DB;
  const runtime = whitelistRuntime(snapshot.runtime);
  const usage = whitelistUsage(snapshot.usage);
  const output = typeof snapshot.output === "string" ? snapshot.output : "";
  const timestamp = Date.now();
  const messageId = assistantMessageId(row.id);
  const metadata = JSON.stringify({
    provider: runtime?.provider || row.requested_provider || "",
    model: runtime?.model || row.requested_model || "",
    model_label: runtime?.model || "",
    runtime: "hermes",
    runtime_id: row.instance_id,
    agent: row.agent_id,
    execution_mode: "hermes-run",
    hermes_run_id: row.id
  });
  const statements = [];
  if (output) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO messages (id, conversation_id, role, content, created_at, metadata)
       SELECT ?, ?, 'assistant', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM hermes_runs WHERE id = ? AND status NOT IN (` + TERMINAL_SQL + `))`
    ).bind(messageId, row.conversation_id, output, timestamp, metadata, row.id));
    statements.push(db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").bind(timestamp, row.conversation_id));
  }
  statements.push(db.prepare(
     `UPDATE hermes_runs SET status = 'completed', upstream_status = ?, status_detail = ?, holds_slot = NULL,
       assistant_message_id = COALESCE(assistant_message_id, ?), actual_provider = ?, actual_model = ?, route_source = ?,
       usage_json = ?, error_code = NULL, error_message = NULL, approval_request_id = NULL,
       approval_generation = NULL, approval_json = NULL, approval_response_pending = 0,
       approval_response_started_at = NULL, completed_at = COALESCE(completed_at, ?), updated_at = ?
     WHERE id = ? AND status NOT IN (` + TERMINAL_SQL + `)`
  ).bind(
    safeCode(snapshot.status) || "completed",
    output ? null : "empty_output",
    output ? messageId : null,
    runtime?.provider || null,
    runtime?.model || null,
    runtime?.routeSource || null,
    usage ? JSON.stringify(usage) : null,
    timestamp,
    timestamp,
    row.id
  ));
  await db.batch(statements);
  log("completed", { run_id: row.id, has_output: Boolean(output), actual_model: runtime?.model || "" });
}

async function applySnapshot(env, row, snapshot) {
  const db = env.DB;
  const upstreamStatus = safeCode(snapshot?.status);
  const mapped = mapHermesUpstreamStatus(upstreamStatus);
  const admissionId = cleanText(snapshot?.admission_id, 160) || null;
  const generation = Number.isInteger(snapshot?.execution_generation) ? snapshot.execution_generation : null;
  const runtime = whitelistRuntime(snapshot?.runtime);
  const snapshotApproval = mapped === "waiting_for_approval"
    ? approvalFromSnapshot(snapshot, generation ?? row.execution_generation)
    : null;
  const sameClaim = Boolean(
    snapshotApproval?.requestId
    && row.approval_response_pending
    && row.approval_request_id === snapshotApproval.requestId
    && row.approval_generation === snapshotApproval.executionGeneration
    && Date.now() - Number(row.approval_response_started_at || 0) < HERMES_APPROVAL_CLAIM_STALE_MS
  );
  const common = {
    upstream_status: upstreamStatus || null,
    admission_id: admissionId || row.admission_id || null,
    execution_generation: generation ?? row.execution_generation ?? null,
    approval_request_id: snapshotApproval?.requestId || null,
    approval_generation: snapshotApproval?.executionGeneration ?? null,
    approval_json: snapshotApproval ? JSON.stringify(snapshotApproval) : null,
    approval_response_pending: sameClaim ? 1 : 0,
    approval_response_started_at: sameClaim ? row.approval_response_started_at : null
  };
  if (!mapped) {
    await updateActiveRun(db, row.id, { ...common, status_detail: "unrecognized_upstream_status" });
    return;
  }
  if (mapped === "completed") {
    await finalizeCompleted(env, row, snapshot);
    return;
  }
  if (mapped === "failed") {
    const message = safeMessage(snapshot?.error || "Hermes run failed");
    await updateActiveRun(db, row.id, terminalFields("failed", {
      ...common,
      status_detail: safeCode(snapshot?.turn_exit_reason) || (snapshot?.partial ? "partial" : null),
      error_code: "hermes_run_failed",
      error_message: message,
      actual_provider: runtime?.provider || null,
      actual_model: runtime?.model || null,
      usage_json: whitelistUsage(snapshot?.usage) ? JSON.stringify(whitelistUsage(snapshot.usage)) : null
    }));
    return;
  }
  if (mapped === "cancelled") {
    // Authority mode reports an interrupted outcome as cancelled; flag it when the user
    // never asked to cancel so the UI does not claim a user cancellation.
    await updateActiveRun(db, row.id, terminalFields("cancelled", {
      ...common,
      status_detail: row.cancel_requested_at ? "cancelled_by_user" : "cancelled_upstream_without_request"
    }));
    return;
  }
  if (mapped === "interrupted") {
    await updateActiveRun(db, row.id, terminalFields("interrupted", {
      ...common,
      status_detail: "upstream_interrupted",
      error_code: "hermes_run_interrupted",
      error_message: safeMessage(snapshot?.error || "Hermes interrupted the run; it was not retried")
    }));
    return;
  }
  if (mapped === "unknown") {
    await updateActiveRun(db, row.id, {
      ...common,
      status: "unknown",
      status_detail: "upstream_unknown",
      error_code: "hermes_run_unknown",
      error_message: "Hermes lost track of whether this run executed; resolve it explicitly"
    });
    return;
  }
  // Non-terminal. A pending local cancel stays visible until upstream confirms.
  const status = row.status === "cancel_requested" && mapped !== "stopping" ? "cancel_requested" : mapped;
  await updateActiveRun(db, row.id, { ...common, status, status_detail: null });
}

export async function syncHermesRun(env, row, { fetchImpl } = {}) {
  const db = env.DB;
  if (!row || isHermesTerminal(row.status)) return { run: row, syncError: null };
  if (["reserving", "submitting"].includes(row.status)) {
    if (Date.now() - Number(row.updated_at || 0) > HERMES_STALE_SUBMIT_MS) {
      await updateActiveRun(db, row.id, {
        status: "submission_unknown",
        status_detail: "worker_interrupted",
        error_code: "hermes_submission_unknown",
        error_message: "The submit request did not finish; Hermes may or may not have created the run"
      }, { fromStatuses: ["reserving", "submitting"] });
      log("stale_submit", { run_id: row.id });
    }
    return { run: await readRunById(db, row.id), syncError: null };
  }
  if (!row.upstream_run_id) return { run: row, syncError: null };
  try {
    const client = createHermesClient(env, row.instance_id, { fetchImpl });
    const response = await client.getRun(row.upstream_run_id);
    await applySnapshot(env, row, response.body);
  } catch (err) {
    if (err instanceof HermesError && err.code === "hermes_run_not_found") {
      await updateActiveRun(db, row.id, {
        status: "unknown",
        status_detail: "upstream_not_found",
        error_code: "hermes_run_not_found",
        error_message: "Hermes no longer knows this run (restart or retention); its outcome is unknown"
      });
      log("upstream_not_found", { run_id: row.id });
    } else {
      // Transient: status is left unchanged; the caller reports the sync error.
      log("sync_failed", { run_id: row.id, code: err?.code || "error" });
      return { run: await readRunById(db, row.id), syncError: publicError(err) };
    }
  }
  return { run: await readRunById(db, row.id), syncError: null };
}

// ---------------------------------------------------------------------------------------
// User actions

export async function cancelHermesRun(env, row, { fetchImpl } = {}) {
  const db = env.DB;
  if (isHermesTerminal(row.status)) return { run: row, cancelError: null };
  if (!row.upstream_run_id) {
    throw new HermesError("hermes_cancel_unavailable",
      row.status === "submission_unknown"
        ? "Submission outcome is unknown; there is no Hermes run id to stop"
        : "Submission is still in progress", { httpStatus: 409 });
  }
  await updateActiveRun(db, row.id, {
    status: "cancel_requested",
    cancel_requested_at: row.cancel_requested_at || Date.now()
  }, { fromStatuses: ["queued", "running", "waiting_for_approval", "stopping", "cancel_requested"] });
  let cancelError = null;
  try {
    const client = createHermesClient(env, row.instance_id, { fetchImpl });
    const response = await client.stopRun(row.upstream_run_id);
    const fresh = await readRunById(db, row.id);
    const mapped = mapHermesUpstreamStatus(response.body?.status);
    if (mapped && mapped !== "stopping") await applySnapshot(env, fresh, response.body);
    else await updateActiveRun(db, row.id, { status: "stopping", upstream_status: "stopping", status_detail: null });
  } catch (err) {
    cancelError = publicError(err);
    log("stop_failed", { run_id: row.id, code: err?.code || "error" });
    if (err?.code === "hermes_unknown_execution") {
      await updateActiveRun(db, row.id, { status: "unknown", status_detail: "upstream_unknown" });
    } else if (err?.ambiguous) {
      await updateActiveRun(db, row.id, { status_detail: "stop_unconfirmed" });
    } else {
      // e.g. run_not_active: let the authoritative GET decide.
      await syncHermesRun(env, await readRunById(db, row.id), { fetchImpl });
    }
  }
  return { run: await readRunById(db, row.id), cancelError };
}

export async function respondToHermesApproval(env, row, body, { fetchImpl } = {}) {
  const choice = String(body?.choice || "").trim().toLowerCase();
  if (!HERMES_APPROVAL_CHOICES.includes(choice)) {
    throw new HermesError("hermes_invalid_approval_choice",
      "Hermes approvals from the web allow only once or deny", { httpStatus: 400 });
  }
  const requestId = String(body?.request_id || body?.requestId || "").trim();
  const generation = body?.execution_generation ?? body?.executionGeneration;
  if (!requestId || requestId.length > 256 || !Number.isInteger(generation) || generation < 0) {
    throw new HermesError("hermes_invalid_approval_identity",
      "The current approval request_id and execution_generation are required", { httpStatus: 400 });
  }

  // Re-read Hermes immediately before the mutation. The browser's approval card may have been
  // open while Hermes timed out or advanced to another prompt, so cached D1 state is not enough.
  const synced = await syncHermesRun(env, row, { fetchImpl });
  if (synced.syncError) {
    throw new HermesError("hermes_approval_status_unavailable",
      "Could not verify the current Hermes approval; refresh and try again", { httpStatus: 503 });
  }
  row = synced.run;
  const capabilities = await hermesCapabilities(env, row.instance_id, { refresh: true, fetchImpl });
  const approval = parseStoredApproval(row);
  if (!canRespondToHermesApproval({ capabilities, run: row, prompt: approval, choice })) {
    throw new HermesError("hermes_approval_unavailable",
      "Hermes does not have a respondable approval for this run", { httpStatus: 409 });
  }
  if (approval.requestId !== requestId || approval.executionGeneration !== generation
    || row.approval_request_id !== requestId || row.approval_generation !== generation) {
    throw new HermesError("hermes_approval_stale",
      "The approval changed or expired; refresh before responding", { httpStatus: 409 });
  }

  const claimStartedAt = Date.now();
  const claim = await env.DB.prepare(
    `UPDATE hermes_runs
        SET approval_response_pending = 1, approval_response_started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'waiting_for_approval'
        AND approval_request_id = ? AND approval_generation = ?
        AND approval_response_pending = 0`
  ).bind(claimStartedAt, claimStartedAt, row.id, requestId, generation).run();
  if (!(claim?.meta?.changes > 0)) {
    throw new HermesError("hermes_approval_in_progress",
      "This approval is already being answered or has changed", { httpStatus: 409 });
  }

  try {
    const client = createHermesClient(env, row.instance_id, { fetchImpl });
    const response = await client.respondApproval(row.upstream_run_id, requestId, generation, choice);
    const timestamp = Date.now();
    await env.DB.prepare(
      `UPDATE hermes_runs
          SET status = 'running', upstream_status = 'running', status_detail = ?,
              approval_request_id = NULL, approval_generation = NULL, approval_json = NULL,
              approval_response_pending = 0, approval_response_started_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'waiting_for_approval'
          AND approval_request_id = ? AND approval_generation = ?`
    ).bind("approval_" + choice, timestamp, row.id, requestId, generation).run();
    log("approval_responded", { run_id: row.id, choice, execution_generation: generation });
    return {
      run: await readRunById(env.DB, row.id),
      approvalResponse: {
        choice,
        requestId,
        executionGeneration: generation,
        resolved: Number.isFinite(response.body?.resolved) ? response.body.resolved : null
      }
    };
  } catch (err) {
    // A timeout is outcome-ambiguous. Release only the local click claim; the next attempt
    // must re-read the authoritative pending control and Hermes' own CAS prevents a duplicate.
    await env.DB.prepare(
      `UPDATE hermes_runs
          SET approval_response_pending = 0, approval_response_started_at = NULL, updated_at = ?
        WHERE id = ? AND approval_request_id = ? AND approval_generation = ?`
    ).bind(Date.now(), row.id, requestId, generation).run();
    log("approval_failed", { run_id: row.id, code: err?.code || "error", execution_generation: generation });
    throw err;
  }
}

export async function reconcileHermesRun(env, row, { fetchImpl } = {}) {
  if (row.status !== "submission_unknown") {
    throw new HermesError("hermes_invalid_state", "Only submission_unknown runs can be reconciled", { httpStatus: 409 });
  }
  const capabilities = await hermesCapabilities(env, row.instance_id, { refresh: true, fetchImpl });
  const allowed = reconcileAllowed(row, capabilities, Date.now());
  if (!allowed.ok) {
    throw new HermesError(allowed.code, "Reconcile requires durable Hermes idempotency within its retention window", { httpStatus: 409 });
  }
  const changed = await updateActiveRun(env.DB, row.id, { status: "submitting", status_detail: "reconcile" },
    { fromStatuses: ["submission_unknown"] });
  if (!changed) throw new HermesError("hermes_invalid_state", "Run state changed; refresh and retry", { httpStatus: 409 });
  log("reconcile", { run_id: row.id });
  await postRun(env, await readRunById(env.DB, row.id), { fetchImpl, fromStatuses: ["submitting"], reconcile: true });
  return { run: await readRunById(env.DB, row.id) };
}

export async function resolveUnknownHermesRun(env, row, { fetchImpl } = {}) {
  if (row.status !== "unknown" || row.status_detail === "upstream_not_found") {
    throw new HermesError("hermes_invalid_state", "Run is not in a resolvable unknown state", { httpStatus: 409 });
  }
  if (!row.admission_id || !Number.isInteger(row.execution_generation)) {
    throw new HermesError("hermes_unknown_unresolvable", "Hermes did not report an admission to resolve", { httpStatus: 409 });
  }
  const client = createHermesClient(env, row.instance_id, { fetchImpl });
  await client.resolveUnknown(row.upstream_run_id, row.admission_id, row.execution_generation);
  log("resolve_unknown", { run_id: row.id });
  return syncHermesRun(env, await readRunById(env.DB, row.id), { fetchImpl });
}

export async function listHermesRuns(env, { owner, projectId, conversationId, limit = 20 }) {
  const result = await env.DB.prepare(
    "SELECT " + RUN_COLUMNS + ` FROM hermes_runs
     WHERE owner_username = ? AND project_id = ? AND conversation_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(owner, projectId, conversationId, Math.max(1, Math.min(50, limit))).all();
  return result.results || [];
}

export async function recordHermesEventSeq(env, runId, seq) {
  if (!Number.isInteger(seq) || seq < 0) return;
  await env.DB.prepare(
    "UPDATE hermes_runs SET last_event_seq = ? WHERE id = ? AND last_event_seq < ?"
  ).bind(seq, runId, seq).run();
}

export { readRunById, hermesCapabilities, sanitizeHermesApprovalPrompt };
