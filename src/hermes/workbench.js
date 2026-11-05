// Authenticated Hermes Sessions/Projects workbench.
// D1 stores ownership and lightweight UI metadata only; messages remain in Hermes.

import { ensureConversation } from "../api/history.js";
import { createHermesClient, isHermesSessionId } from "./client.js";
import { ORACLE_HERMES_INSTANCE_ID, hermesExecutionEnabled, hermesInstance } from "./config.js";
import { HermesError, publicError, redactSecrets } from "./errors.js";

const PROJECT_ID_PATTERN = /^hproj_[a-f0-9]{32}$/;
const MAX_TITLE = 160;
const MAX_EXPORT_MESSAGES = 2000;

function text(value, max = MAX_TITLE) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
function instanceId(value) {
  const id = text(value || ORACLE_HERMES_INSTANCE_ID, 80);
  if (!hermesInstance(id)) throw new HermesError("hermes_unknown_instance", "Unknown Hermes instance", { httpStatus: 400 });
  return id;
}

function sessionId(value) {
  const id = String(value || "");
  if (!isHermesSessionId(id)) throw new HermesError("hermes_invalid_session_id", "Invalid Hermes session id", { httpStatus: 400 });
  return id;
}

function projectId(value) {
  const id = String(value || "");
  if (!PROJECT_ID_PATTERN.test(id)) throw new HermesError("hermes_invalid_project_id", "Invalid workbench project id", { httpStatus: 400 });
  return id;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (err) {
    throw new HermesError("hermes_invalid_path", "Invalid path parameter", { httpStatus: 400 });
  }
}

function upstreamSessions(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.sessions)) return body.sessions;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function upstreamSessionId(value) {
  const id = String(value?.id || value?.session_id || "");
  return isHermesSessionId(id) ? id : "";
}

function upstreamTitle(value) {
  return text(value?.title || value?.name || "Untitled session");
}

function upstreamTime(value, fallback = 0) {
  const raw = value?.updated_at ?? value?.last_activity_at ?? value?.created_at ?? fallback;
  if (typeof raw === "number") return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function publicProject(row) {
  return {
    id: row.id, title: row.title, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  };
}

function publicSession(upstream, meta, binding = null) {
  const id = upstreamSessionId(upstream) || meta?.hermes_session_id || binding?.hermes_session_id;
  return {
    id,
    title: meta?.title_override || upstreamTitle(upstream),
    projectId: meta?.project_id || null,
    archived: Number(meta?.archived || 0) === 1,
    archivedAt: meta?.archived_at ? Number(meta.archived_at) : null,
    forkedFromSessionId: meta?.forked_from_session_id || null,
    instanceId: meta?.instance_id || binding?.instance_id || ORACLE_HERMES_INSTANCE_ID,
    conversationId: binding?.conversation_id || null,
    conversationProjectId: binding?.project_id || null,
    createdAt: upstreamTime({ created_at: upstream?.created_at }, meta?.created_at || binding?.created_at),
    updatedAt: upstreamTime(upstream, meta?.updated_at || binding?.updated_at)
  };
}

async function ownership(db, owner) {
  const [metaResult, bindingResult] = await Promise.all([
    db.prepare(`SELECT hermes_session_id, owner_username, project_id, archived, archived_at, title_override,
      forked_from_session_id, instance_id, created_at, updated_at
      FROM hermes_session_meta WHERE owner_username = ?`).bind(owner).all(),
    db.prepare(`SELECT conversation_id, owner_username, project_id, instance_id, hermes_session_id, created_at, updated_at
      FROM hermes_conversation_bindings WHERE owner_username = ?`).bind(owner).all()
  ]);
  return {
    meta: new Map(rows(metaResult).map(row => [row.hermes_session_id, row])),
    bindings: new Map(rows(bindingResult).map(row => [row.hermes_session_id, row]))
  };
}

async function requireOwnedSession(db, owner, id) {
  const row = await db.prepare(
    `SELECT m.hermes_session_id, m.owner_username, m.project_id, m.archived, m.archived_at,
       m.title_override, m.forked_from_session_id, m.instance_id, m.created_at, m.updated_at,
       b.conversation_id, b.project_id AS conversation_project_id, b.instance_id AS binding_instance_id
     FROM (SELECT ? AS requested_id) r
     LEFT JOIN hermes_session_meta m ON m.hermes_session_id = r.requested_id AND m.owner_username = ?
     LEFT JOIN hermes_conversation_bindings b ON b.hermes_session_id = r.requested_id AND b.owner_username = ?
     WHERE m.hermes_session_id IS NOT NULL OR b.hermes_session_id IS NOT NULL`
  ).bind(id, owner, owner).first();
  if (!row) throw new HermesError("hermes_session_not_found", "Session not found", { httpStatus: 404 });
  return {
    id,
    projectId: row.project_id || null,
    archived: Number(row.archived || 0) === 1,
    title: row.title_override || "",
    instanceId: row.instance_id || row.binding_instance_id || ORACLE_HERMES_INSTANCE_ID,
    conversationId: row.conversation_id || null,
    conversationProjectId: row.conversation_project_id || null
  };
}

async function requireOwnedProject(db, owner, id) {
  const row = await db.prepare(
    "SELECT id, owner_username, title, created_at, updated_at FROM hermes_workbench_projects WHERE id = ? AND owner_username = ?"
  ).bind(id, owner).first();
  if (!row) throw new HermesError("hermes_project_not_found", "Workbench project not found", { httpStatus: 404 });
  return row;
}

async function upsertMeta(db, { id, owner, instance, title = null, project = null, forkedFrom = null }) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO hermes_session_meta
       (hermes_session_id, owner_username, project_id, archived, archived_at, title_override,
        forked_from_session_id, instance_id, created_at, updated_at)
     VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(hermes_session_id) DO UPDATE SET
       project_id = COALESCE(excluded.project_id, hermes_session_meta.project_id),
       title_override = COALESCE(excluded.title_override, hermes_session_meta.title_override),
       forked_from_session_id = COALESCE(excluded.forked_from_session_id, hermes_session_meta.forked_from_session_id),
       updated_at = excluded.updated_at
     WHERE hermes_session_meta.owner_username = excluded.owner_username`
  ).bind(id, owner, project, title, forkedFrom, instance, now, now).run();
  return requireOwnedSession(db, owner, id);
}

async function sessionCapabilities(client) {
  try {
    const body = (await client.getCapabilities()).body || {};
    const features = body.features && typeof body.features === "object" ? body.features : {};
    const endpoints = body.endpoints && typeof body.endpoints === "object" ? body.endpoints : {};
    const advertised = Object.keys(features).some(key => key.startsWith("session_"))
      || Object.keys(endpoints).some(key => key.startsWith("session_"));
    const has = name => !advertised || features[name] === true || Boolean(endpoints[name]);
    return { advertised, list: has("session_list"), get: has("session_get"), patch: has("session_patch"), messages: has("session_messages"), fork: has("session_fork"), create: has("session_create") };
  } catch (err) {
    return { advertised: false, list: true, get: true, patch: true, messages: true, fork: true, create: true };
  }
}

function requireCapability(capabilities, name) {
  if (!capabilities[name]) throw new HermesError("hermes_session_capability_missing", "Hermes does not advertise this sessions operation", { httpStatus: 503 });
}

const MESSAGE_CONTENT_LIMIT = Object.freeze({
  user: 8000,
  assistant: 8000,
  tool: 500,
  system: 0
});
const REDACTION_INPUT_LIMIT = 4000;

function rawMessageText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .filter(item => item && (item.type === "text" || typeof item.text === "string"))
      .map(item => item.text || "")
      .join("\n");
  }
  return "";
}

// Bound before redaction (timeline policy): never ship unbounded tool/system payloads to the browser.
function messageContent(value, secrets, role = "assistant") {
  if (role === "system") return { content: "", omitted: true, truncated: false };
  const limit = MESSAGE_CONTENT_LIMIT[role] ?? MESSAGE_CONTENT_LIMIT.assistant;
  const raw = rawMessageText(value);
  const bounded = raw.slice(0, Math.min(raw.length, REDACTION_INPUT_LIMIT));
  const redacted = redactSecrets(bounded, secrets);
  const truncated = raw.length > limit || raw.length > REDACTION_INPUT_LIMIT || redacted.length > limit;
  return { content: redacted.slice(0, limit), omitted: false, truncated };
}

function sanitizeMessages(body, secrets) {
  const source = Array.isArray(body)
    ? body
    : (Array.isArray(body?.messages) ? body.messages : (Array.isArray(body?.data) ? body.data : []));
  return source.slice(0, MAX_EXPORT_MESSAGES).map((item, index) => {
    const role = ["user", "assistant", "system", "tool"].includes(item?.role) ? item.role : "assistant";
    const content = messageContent(item?.content ?? item?.text, secrets, role);
    return {
      index,
      role,
      content: content.content,
      contentOmitted: content.omitted || undefined,
      truncated: content.truncated || undefined,
      createdAt: upstreamTime(item),
      toolName: role === "tool" ? (redactSecrets(text(item?.tool_name || item?.name, 120), secrets) || null) : null,
      toolCallId: role === "tool" ? (redactSecrets(text(item?.tool_call_id, 160), secrets) || null) : null,
      status: redactSecrets(text(item?.status, 80), secrets) || null
    };
  });
}

function markdownExport(session, messages) {
  const lines = ["# " + session.title, "", "Hermes session: `" + session.id + "`", ""];
  for (const message of messages) {
    const label = message.role === "tool" && message.toolName ? "Tool: " + message.toolName : message.role;
    lines.push("## " + label, "", message.content || "_(empty)_", "");
  }
  return lines.join("\n");
}

function upstreamError(err) {
  return publicError(err instanceof HermesError ? err : new HermesError("hermes_sessions_unavailable", "Hermes sessions API is unavailable", { httpStatus: 502 }));
}

export async function handleHermesWorkbench(request, env, url, { owner, fetchImpl } = {}) {
  const projectMatch = url.pathname.match(/^\/api\/hermes\/projects(?:\/([^/]+))?$/);
  const sessionMatch = url.pathname.match(/^\/api\/hermes\/sessions(?:\/([^/]+)(?:\/(messages|fork|archive|resume|export))?)?$/);
  if (!projectMatch && !sessionMatch) return null;

  if (projectMatch) {
    const id = projectMatch[1] ? projectId(decodePathSegment(projectMatch[1])) : "";
    if (!id && request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT id, owner_username, title, created_at, updated_at FROM hermes_workbench_projects WHERE owner_username = ? ORDER BY updated_at DESC"
      ).bind(owner).all();
      return Response.json({ ok: true, projects: rows(result).map(publicProject) });
    }
    const body = request.method === "GET" || request.method === "DELETE" ? {} : await request.json().catch(() => ({}));
    if (!id && request.method === "POST") {
      const title = text(body.title);
      if (!title) throw new HermesError("hermes_project_title_required", "Project title is required", { httpStatus: 400 });
      const now = Date.now();
      const nextId = "hproj_" + crypto.randomUUID().replace(/-/g, "");
      await env.DB.prepare(
        "INSERT INTO hermes_workbench_projects (id, owner_username, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(nextId, owner, title, now, now).run();
      return Response.json({ ok: true, project: publicProject(await requireOwnedProject(env.DB, owner, nextId)) }, { status: 201 });
    }
    if (id && request.method === "PATCH") {
      await requireOwnedProject(env.DB, owner, id);
      const title = text(body.title);
      if (!title) throw new HermesError("hermes_project_title_required", "Project title is required", { httpStatus: 400 });
      await env.DB.prepare("UPDATE hermes_workbench_projects SET title = ?, updated_at = ? WHERE id = ? AND owner_username = ?")
        .bind(title, Date.now(), id, owner).run();
      return Response.json({ ok: true, project: publicProject(await requireOwnedProject(env.DB, owner, id)) });
    }
    if (id && request.method === "DELETE") {
      await requireOwnedProject(env.DB, owner, id);
      const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM hermes_session_meta WHERE owner_username = ? AND project_id = ?")
        .bind(owner, id).first();
      if (Number(used?.n || 0) > 0) throw new HermesError("hermes_project_not_empty", "Remove sessions from this project first", { httpStatus: 409 });
      await env.DB.prepare("DELETE FROM hermes_workbench_projects WHERE id = ? AND owner_username = ?").bind(id, owner).run();
      return Response.json({ ok: true });
    }
    throw new HermesError("hermes_method_not_allowed", "Method not allowed", { httpStatus: 405 });
  }

  const id = sessionMatch[1] ? sessionId(decodePathSegment(sessionMatch[1])) : "";
  const action = sessionMatch[2] || "";

  if (!id && request.method === "GET") {
    const requestedInstance = instanceId(url.searchParams.get("instance_id") || ORACLE_HERMES_INSTANCE_ID);
    const client = createHermesClient(env, requestedInstance, { fetchImpl });
    const capabilities = await sessionCapabilities(client);
    requireCapability(capabilities, "list");
    const owned = await ownership(env.DB, owner);
    const allowed = new Set([...owned.meta.keys(), ...owned.bindings.keys()]);
    const projects = await env.DB.prepare(
      "SELECT id, owner_username, title, created_at, updated_at FROM hermes_workbench_projects WHERE owner_username = ? ORDER BY updated_at DESC"
    ).bind(owner).all();
    let result;
    try {
      result = await client.listSessions({ limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset"), includeChildren: true });
    } catch (err) {
      return Response.json({
        ok: true, sessions: [], projects: rows(projects).map(publicProject), upstreamError: upstreamError(err),
        capabilities, searchScope: "title_and_metadata_only"
      });
    }
    const visibleUpstream = upstreamSessions(result.body).filter(item => allowed.has(upstreamSessionId(item)));
    const found = new Set(visibleUpstream.map(upstreamSessionId));
    const missing = [...allowed].filter(ownedId => !found.has(ownedId)).slice(0, 200);
    if (missing.length && capabilities.get) {
      const recovered = await Promise.allSettled(missing.map(ownedId => client.getSession(ownedId)));
      for (const item of recovered) {
        if (item.status === "fulfilled" && allowed.has(upstreamSessionId(item.value.body))) visibleUpstream.push(item.value.body);
      }
    }
    const sessions = visibleUpstream
      .filter(item => allowed.has(upstreamSessionId(item)))
      .map(item => publicSession(item, owned.meta.get(upstreamSessionId(item)), owned.bindings.get(upstreamSessionId(item))))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const query = text(url.searchParams.get("q"), 200).toLocaleLowerCase();
    const archived = String(url.searchParams.get("archived") || "0") === "1";
    const filtered = sessions.filter(item => item.archived === archived && (!query || [item.title, item.id, item.projectId, item.forkedFromSessionId].some(value => String(value || "").toLocaleLowerCase().includes(query))));
    return Response.json({ ok: true, sessions: filtered, projects: rows(projects).map(publicProject), capabilities, searchScope: "title_and_metadata_only" });
  }

  if (!id && request.method === "POST") {
    if (!hermesExecutionEnabled(env)) {
      throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
    }
    const requestedInstance = instanceId(url.searchParams.get("instance_id") || ORACLE_HERMES_INSTANCE_ID);
    const client = createHermesClient(env, requestedInstance, { fetchImpl });
    const capabilities = await sessionCapabilities(client);
    requireCapability(capabilities, "create");
    const body = await request.json().catch(() => ({}));
    const title = text(body.title);
    if (!title) throw new HermesError("hermes_session_title_required", "Session title is required", { httpStatus: 400 });
    const result = await client.createSession({ title });
    const createdId = upstreamSessionId(result.body);
    if (!createdId) throw new HermesError("hermes_bad_response", "Hermes did not return a session id", { httpStatus: 502 });
    await upsertMeta(env.DB, { id: createdId, owner, instance: requestedInstance, title });
    return Response.json({ ok: true, session: publicSession(result.body, { hermes_session_id: createdId, title_override: title, instance_id: requestedInstance }) }, { status: 201 });
  }

  const owned = await requireOwnedSession(env.DB, owner, id);
  const ownedClient = createHermesClient(env, owned.instanceId, { fetchImpl });
  const ownedCapabilities = await sessionCapabilities(ownedClient);

  if (!action && request.method === "GET") {
    requireCapability(ownedCapabilities, "get");
    const result = await ownedClient.getSession(id);
    return Response.json({ ok: true, session: publicSession(result.body, {
      hermes_session_id: id, title_override: owned.title, project_id: owned.projectId, archived: owned.archived, instance_id: owned.instanceId
    }, { conversation_id: owned.conversationId, project_id: owned.conversationProjectId }) });
  }
  const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
  if (!action && request.method === "PATCH") {
    const title = text(body.title);
    const hasProject = Object.prototype.hasOwnProperty.call(body, "project_id");
    const assignedProject = body.project_id === null || body.project_id === "" ? null
      : (hasProject ? projectId(body.project_id) : owned.projectId);
    if (!title && !hasProject) throw new HermesError("hermes_session_update_required", "A title or project assignment is required", { httpStatus: 400 });
    if (assignedProject) await requireOwnedProject(env.DB, owner, assignedProject);
    if (title) {
      if (!hermesExecutionEnabled(env)) {
        throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
      }
      requireCapability(ownedCapabilities, "patch");
      await ownedClient.patchSession(id, { title });
    }
    await upsertMeta(env.DB, {
      id, owner, instance: owned.instanceId, title: title || null,
      project: hasProject ? assignedProject : owned.projectId
    });
    if (hasProject) {
      await env.DB.prepare(
        "UPDATE hermes_session_meta SET project_id = ?, updated_at = ? WHERE hermes_session_id = ? AND owner_username = ?"
      ).bind(assignedProject, Date.now(), id, owner).run();
    }
    return Response.json({ ok: true, session: { id, title: title || owned.title, projectId: assignedProject } });
  }
  if (action === "archive" && request.method === "POST") {
    const archived = body.archived !== false;
    const expectedArchived = typeof body.expected_archived === "boolean" ? body.expected_archived : owned.archived;
    const now = Date.now();
    const result = await env.DB.prepare(
      `INSERT INTO hermes_session_meta
        (hermes_session_id, owner_username, project_id, archived, archived_at, title_override, forked_from_session_id, instance_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(hermes_session_id) DO UPDATE SET archived = excluded.archived,
         archived_at = excluded.archived_at, updated_at = excluded.updated_at
       WHERE hermes_session_meta.owner_username = excluded.owner_username
         AND hermes_session_meta.archived != excluded.archived
         AND hermes_session_meta.archived = ?`
    ).bind(id, owner, owned.projectId, archived ? 1 : 0, archived ? now : null, owned.title || null, owned.instanceId, now, now, expectedArchived ? 1 : 0).run();
    const changed = Number(result?.meta?.changes || 0) === 1;
    if (!changed) {
      const current = await requireOwnedSession(env.DB, owner, id);
      if (current.archived !== archived) {
        throw new HermesError("hermes_archive_stale", "Archive state changed; refresh and try again", { httpStatus: 409 });
      }
    }
    return Response.json({ ok: true, archived, changed });
  }
  if (action === "messages" && request.method === "GET") {
    requireCapability(ownedCapabilities, "messages");
    const result = await ownedClient.getSessionMessages(id, { includeCompacted: true });
    return Response.json({ ok: true, sessionId: id, messages: sanitizeMessages(result.body, ownedClient.secrets) });
  }
  if (action === "fork" && request.method === "POST") {
    if (!hermesExecutionEnabled(env)) {
      throw new HermesError("hermes_execution_disabled", "Hermes execution is disabled", { httpStatus: 403 });
    }
    requireCapability(ownedCapabilities, "fork");
    const title = text(body.title) || (owned.title ? owned.title + " (fork)" : "Forked session");
    const result = await ownedClient.forkSession(id, { title });
    const forkId = upstreamSessionId(result.body);
    if (!forkId) throw new HermesError("hermes_bad_response", "Hermes did not return the forked session id", { httpStatus: 502 });
    await upsertMeta(env.DB, { id: forkId, owner, instance: owned.instanceId, title, project: owned.projectId, forkedFrom: id });
    return Response.json({ ok: true, session: publicSession(result.body, {
      hermes_session_id: forkId, title_override: title, project_id: owned.projectId, forked_from_session_id: id, instance_id: owned.instanceId
    }) }, { status: 201 });
  }
  if (action === "resume" && request.method === "POST") {
    const coreProjectId = text(body.project_id || owned.conversationProjectId || "default", 160);
    let conversationId = owned.conversationId;
    if (!conversationId) {
      const conversation = await ensureConversation(env.DB, "", owned.title || "Hermes session", coreProjectId);
      conversationId = conversation.id;
      const now = Date.now();
      try {
        await env.DB.prepare(
          `INSERT INTO hermes_conversation_bindings
           (conversation_id, owner_username, project_id, instance_id, hermes_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(conversationId, owner, conversation.project_id, owned.instanceId, id, now, now).run();
      } catch (err) {
        const raced = await env.DB.prepare(
          "SELECT conversation_id, owner_username, project_id FROM hermes_conversation_bindings WHERE hermes_session_id = ?"
        ).bind(id).first();
        if (!raced || raced.owner_username !== owner) throw new HermesError("hermes_session_conflict", "Session is already bound", { httpStatus: 409 });
        conversationId = raced.conversation_id;
      }
    }
    const bound = await env.DB.prepare(
      "SELECT conversation_id, project_id FROM hermes_conversation_bindings WHERE hermes_session_id = ? AND owner_username = ?"
    ).bind(id, owner).first();
    return Response.json({ ok: true, resume: {
      sessionId: id,
      conversationId: bound?.conversation_id || conversationId,
      projectId: bound?.project_id || owned.conversationProjectId || coreProjectId,
      instanceId: owned.instanceId
    } });
  }
  if (action === "export" && request.method === "GET") {
    requireCapability(ownedCapabilities, "messages");
    const format = url.searchParams.get("format") === "json" ? "json" : "md";
    const [sessionResult, messageResult] = await Promise.all([ownedClient.getSession(id), ownedClient.getSessionMessages(id, { includeCompacted: true })]);
    const session = publicSession(sessionResult.body, {
      hermes_session_id: id, title_override: owned.title, project_id: owned.projectId, archived: owned.archived, instance_id: owned.instanceId
    });
    session.title = redactSecrets(session.title, ownedClient.secrets);
    const messages = sanitizeMessages(messageResult.body, ownedClient.secrets);
    const safeName = (session.title || "hermes-session").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "hermes-session";
    if (format === "json") {
      return new Response(JSON.stringify({ session, messages }, null, 2), { headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${safeName}.json"`
      } });
    }
    return new Response(markdownExport(session, messages), { headers: {
      "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${safeName}.md"`
    } });
  }
  if (action === "" || action) throw new HermesError("hermes_method_not_allowed", "Method not allowed", { httpStatus: 405 });
}
