import { jsonResponse } from "../utils/response.js";
import { ensureHillsboroRuntimeBindingForProject } from "./openclawRuntimes.js";

export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_PROJECT_NAME = "Default Project";

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanProjectName(value) {
  return cleanText(value, 120);
}

function cleanProjectSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || null;
}

function serializeProject(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug || "",
    description: row.description || "",
    is_default: Number(row.is_default || 0) === 1,
    is_archived: Number(row.is_archived || 0) === 1,
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || null
  };
}

export async function ensureDefaultProject(db) {
  const timestamp = isoNow();
  await db.prepare(
    `INSERT INTO projects (
      id,
      name,
      slug,
      description,
      is_default,
      is_archived,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      is_default = 1,
      is_archived = 0,
      archived_at = NULL,
      updated_at = excluded.updated_at`
  ).bind(
    DEFAULT_PROJECT_ID,
    DEFAULT_PROJECT_NAME,
    "default",
    "Compatibility workspace for conversations created before Project Workspace.",
    timestamp,
    timestamp
  ).run();

  return readProject(db, DEFAULT_PROJECT_ID);
}

export async function readProject(db, projectId) {
  const id = cleanText(projectId, 160) || DEFAULT_PROJECT_ID;
  const row = await db.prepare(
    `SELECT id, name, slug, description, is_default, is_archived, created_at, updated_at, archived_at
     FROM projects
     WHERE id = ?
     LIMIT 1`
  ).bind(id).first();
  return serializeProject(row);
}

export async function resolveProjectId(db, projectId) {
  const id = cleanText(projectId, 160);
  if (id) {
    const project = await readProject(db, id);
    if (project && !project.is_archived) {
      return project.id;
    }
  }
  await ensureDefaultProject(db);
  return DEFAULT_PROJECT_ID;
}

export async function handleProjects(request, env, url) {
  if (!url.pathname.startsWith("/api/projects")) {
    return null;
  }
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured"
    }, 500);
  }

  if (request.method === "GET" && url.pathname === "/api/projects") {
    await ensureDefaultProject(env.DB);
    const includeArchived = ["1", "true"].includes(String(url.searchParams.get("include_archived") || url.searchParams.get("includeArchived") || "").toLowerCase());
    const result = includeArchived
      ? await env.DB.prepare(
        `SELECT id, name, slug, description, is_default, is_archived, created_at, updated_at, archived_at
         FROM projects
         ORDER BY is_default DESC, updated_at DESC`
      ).all()
      : await env.DB.prepare(
        `SELECT id, name, slug, description, is_default, is_archived, created_at, updated_at, archived_at
         FROM projects
         WHERE is_archived = 0
         ORDER BY is_default DESC, updated_at DESC`
      ).all();

    return jsonResponse({
      ok: true,
      projects: (result.results || []).map(serializeProject)
    });
  }

  if (request.method === "POST" && url.pathname === "/api/projects") {
    const data = await request.json().catch(() => ({}));
    const name = cleanProjectName(data.name);
    if (!name) {
      return jsonResponse({
        ok: false,
        error: "name is required"
      }, 400);
    }

    const timestamp = isoNow();
    const id = cleanText(data.id, 160) || crypto.randomUUID();
    const slug = cleanProjectSlug(data.slug || name);
    const description = cleanText(data.description, 4000);

    try {
      await env.DB.prepare(
        `INSERT INTO projects (
          id,
          name,
          slug,
          description,
          is_default,
          is_archived,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
      ).bind(id, name, slug, description, timestamp, timestamp).run();
      await ensureHillsboroRuntimeBindingForProject(env.DB, id);
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "failed to create project",
        detail: err?.message || String(err)
      }, 409);
    }

    return jsonResponse({
      ok: true,
      project: await readProject(env.DB, id)
    }, 201);
  }

  const archiveMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/archive$/);
  if (request.method === "POST" && archiveMatch) {
    const projectId = decodeURIComponent(archiveMatch[1]);
    const project = await readProject(env.DB, projectId);
    if (!project) {
      return jsonResponse({
        ok: false,
        error: "project not found"
      }, 404);
    }
    if (project.is_default) {
      return jsonResponse({
        ok: false,
        error: "default project cannot be archived"
      }, 400);
    }

    const timestamp = isoNow();
    await env.DB.prepare(
      `UPDATE projects
       SET is_archived = 1,
         archived_at = ?,
         updated_at = ?
       WHERE id = ?`
    ).bind(timestamp, timestamp, projectId).run();

    return jsonResponse({
      ok: true,
      project: await readProject(env.DB, projectId)
    });
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && request.method === "DELETE") {
    const projectId = decodeURIComponent(projectMatch[1]);
    const project = await readProject(env.DB, projectId);
    if (!project) {
      return jsonResponse({
        ok: false,
        error: "project not found"
      }, 404);
    }
    if (project.is_default) {
      return jsonResponse({
        ok: false,
        error: "default project cannot be deleted"
      }, 400);
    }

    const timestamp = isoNow();
    await env.DB.prepare(
      `UPDATE projects
       SET is_archived = 1,
         archived_at = ?,
         updated_at = ?
       WHERE id = ?`
    ).bind(timestamp, timestamp, projectId).run();

    return jsonResponse({
      ok: true,
      delete_mode: "soft_delete",
      project: await readProject(env.DB, projectId)
    });
  }

  if (projectMatch && request.method === "GET") {
    const project = await readProject(env.DB, decodeURIComponent(projectMatch[1]));
    if (!project) {
      return jsonResponse({
        ok: false,
        error: "project not found"
      }, 404);
    }
    return jsonResponse({
      ok: true,
      project
    });
  }

  if (projectMatch && request.method === "PATCH") {
    const projectId = decodeURIComponent(projectMatch[1]);
    const project = await readProject(env.DB, projectId);
    if (!project) {
      return jsonResponse({
        ok: false,
        error: "project not found"
      }, 404);
    }

    const data = await request.json().catch(() => ({}));
    const name = data.name === undefined ? project.name : cleanProjectName(data.name);
    if (!name) {
      return jsonResponse({
        ok: false,
        error: "name is required"
      }, 400);
    }

    const slug = data.slug === undefined ? (project.slug || null) : cleanProjectSlug(data.slug);
    const description = data.description === undefined ? project.description : cleanText(data.description, 4000);
    const timestamp = isoNow();

    try {
      await env.DB.prepare(
        `UPDATE projects
         SET name = ?,
           slug = ?,
           description = ?,
           updated_at = ?
         WHERE id = ?`
      ).bind(name, slug, description, timestamp, projectId).run();
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "failed to update project",
        detail: err?.message || String(err)
      }, 409);
    }

    return jsonResponse({
      ok: true,
      project: await readProject(env.DB, projectId)
    });
  }

  return jsonResponse({
    ok: false,
    error: "Method not allowed"
  }, 405);
}
