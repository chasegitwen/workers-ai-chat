// Read-only Hermes Skills / Toolsets discovery. Upstream objects are always rebuilt from
// explicit allowlists so filesystem paths, environment names and credentials cannot reach
// the browser even if a future Hermes release adds them to these endpoints.

import { createHermesClient } from "./client.js";
import { HermesError, publicError, safeMessage } from "./errors.js";

const MAX_ITEMS = 1000;
const MAX_TOOLS = 1000;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,159}$/;

function cleanText(value, max = 1000) {
  return safeMessage(String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " "), [], max)
    .replace(/\[redacted\] (?:token|jwt)\]/g, "[redacted]");
}

function listData(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.data) ? payload.data : [];
}

function safeName(value) {
  const text = cleanText(value, 160);
  return SAFE_NAME.test(text) ? text : "";
}

function stringList(value, limit = 100) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.map(item => safeName(item)).filter(Boolean))].slice(0, limit);
}

export function normalizeHermesSkills(payload) {
  const result = [];
  const seen = new Set();
  for (const row of listData(payload)) {
    if (result.length >= MAX_ITEMS) break;
    const name = safeName(row?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const skill = {
      name,
      description: cleanText(row?.description),
      category: cleanText(row?.category, 120) || "uncategorized"
    };
    // Forward-compatible, display-only metadata. No paths, env names or arbitrary objects.
    const version = cleanText(row?.version, 80);
    const author = cleanText(row?.author, 120);
    const tags = stringList(row?.tags, 50);
    if (version) skill.version = version;
    if (author) skill.author = author;
    if (tags) skill.tags = tags;
    result.push(skill);
  }
  return result;
}

export function normalizeHermesToolsets(payload) {
  const result = [];
  const seen = new Set();
  for (const row of listData(payload)) {
    if (result.length >= MAX_ITEMS) break;
    const name = safeName(row?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      label: cleanText(row?.label, 160) || name,
      description: cleanText(row?.description),
      // Preserve unknown as null. Never infer an enabled/configured state.
      enabled: typeof row?.enabled === "boolean" ? row.enabled : null,
      configured: typeof row?.configured === "boolean" ? row.configured : null,
      tools: stringList(row?.tools, MAX_TOOLS) || []
    });
  }
  return result;
}

function advertisedEndpoint(capabilities, name, expectedPath) {
  const endpoint = capabilities?.endpoints?.[name];
  return endpoint?.method === "GET" && endpoint?.path === expectedPath;
}

function section(status, items = [], error = null) {
  return { status, items, error };
}

export async function getHermesCapabilitiesPanel(env, instanceId, { fetchImpl } = {}) {
  const client = createHermesClient(env, instanceId, { fetchImpl });
  let capabilities;
  try {
    capabilities = (await client.getCapabilities()).body;
  } catch (err) {
    const error = publicError(err);
    return {
      skills: section("error", [], error),
      toolsets: section("error", [], error),
      syncedAt: Date.now()
    };
  }

  if (capabilities?.object !== "hermes.api_server.capabilities" || capabilities?.platform !== "hermes-agent") {
    const error = publicError(new HermesError("hermes_capabilities_unrecognized",
      "Upstream is not a recognized Hermes API server", { httpStatus: 502 }));
    return { skills: section("error", [], error), toolsets: section("error", [], error), syncedAt: Date.now() };
  }

  async function load(name, path, getter, normalize) {
    if (!advertisedEndpoint(capabilities, name, path)) return section("unavailable");
    try {
      return section("available", normalize((await getter()).body));
    } catch (err) {
      return section("error", [], publicError(err));
    }
  }

  const [skills, toolsets] = await Promise.all([
    load("skills", "/v1/skills", client.getSkills, normalizeHermesSkills),
    load("toolsets", "/v1/toolsets", client.getToolsets, normalizeHermesToolsets)
  ]);
  return { skills, toolsets, syncedAt: Date.now() };
}
