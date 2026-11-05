// Read-only Hermes runtime readiness probe. Only documented, bounded fields are copied
// from upstream; raw config, environment, paths, platform payloads and credentials are never
// returned to the browser.

import { createHermesClient } from "./client.js";
import { publicError, safeMessage } from "./errors.js";

const CHECK_NAMES = Object.freeze([
  "state_db", "session_store", "config", "model", "disk", "gateway", "background_queues"
]);
const CHECK_STATUSES = new Set(["ok", "degraded", "unavailable", "retrying"]);
const CONNECTED_PLATFORM_STATES = new Set(["connected", "running", "ok"]);
const MAX_PLATFORM_ITEMS = 20;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function boundedInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, Number.MAX_SAFE_INTEGER) : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function safeToken(value, max = 80) {
  const text = safeMessage(String(value ?? ""), [], max);
  return /^[A-Za-z0-9][A-Za-z0-9._:@+ -]{0,79}$/.test(text) ? text : "unknown";
}

function normalizeCheck(name, value, secrets = []) {
  const source = object(value);
  if (!source) return null;
  const sourceStatus = String(source.status || "").toLowerCase();
  if (!CHECK_STATUSES.has(sourceStatus)) return null;
  const check = { status: sourceStatus === "retrying" ? "degraded" : sourceStatus };
  const detail = safeMessage(String(source.detail || (sourceStatus === "retrying" ? "retrying" : "")), secrets, 120)
    .replace(/(^|[\s('"`])(?:[A-Za-z]:[\\/]|\/)[^\s,;'"`)]+/g, "$1[redacted path]");
  if (detail) check.detail = detail;
  if (name === "disk") {
    const usedPercent = finiteNumber(source.used_percent);
    const freeBytes = boundedInteger(source.free_bytes);
    if (usedPercent !== null) check.usedPercent = Math.min(100, usedPercent);
    if (freeBytes !== null) check.freeBytes = freeBytes;
  } else if (name === "gateway") {
    check.state = safeToken(source.state);
    const connectedPlatforms = boundedInteger(source.connected_platforms);
    const platforms = boundedInteger(source.platforms);
    if (connectedPlatforms !== null) check.connectedPlatforms = connectedPlatforms;
    if (platforms !== null) check.platforms = platforms;
  } else if (name === "background_queues") {
    for (const [upstream, field] of [
      ["active_api_runs", "activeApiRuns"],
      ["process_completions", "processCompletions"],
      ["active_delegations", "activeDelegations"]
    ]) {
      const count = boundedInteger(source[upstream]);
      if (count !== null) check[field] = count;
    }
  }
  return check;
}

function normalizePlatforms(value) {
  const platforms = object(value);
  if (!platforms) return null;
  const byState = Object.create(null);
  const items = [];
  let connected = 0;
  for (const [rawName, rawValue] of Object.entries(platforms)) {
    const row = object(rawValue);
    const name = safeToken(rawName, 80);
    const state = safeToken(row?.state || row?.status || "unknown", 40).toLowerCase();
    byState[state] = (byState[state] || 0) + 1;
    if (CONNECTED_PLATFORM_STATES.has(state)) connected += 1;
    if (items.length < MAX_PLATFORM_ITEMS) items.push({ name, state });
  }
  return { total: Object.keys(platforms).length, connected, byState, items, truncated: Object.keys(platforms).length > MAX_PLATFORM_ITEMS };
}

function baseResult(meta = {}) {
  const probedAt = Number(meta.probedAt) || Date.now();
  return {
    instanceId: String(meta.instanceId || "oracle-hermes"),
    overallStatus: "unknown",
    connectivity: "unknown",
    backend: "unknown",
    checks: {},
    gateway: null,
    platforms: null,
    capabilities: null,
    dataSource: [],
    probedAt,
    lastSuccessfulProbeAt: null,
    notes: []
  };
}

export function normalizeHermesHealthProbe(simpleBody, detailedBody, capabilitiesBody, meta = {}) {
  const result = baseResult(meta);
  const simple = object(simpleBody);
  const detailed = object(detailedBody);
  const readiness = object(detailed?.readiness);
  const rawChecks = object(readiness?.checks);
  const simpleRecognized = simple?.status === "ok" && simple?.platform === "hermes-agent";
  const readinessStatus = String(readiness?.status || "").toLowerCase();

  if (simple) result.dataSource.push("GET /health");
  if (detailed) result.dataSource.push("GET /health/detailed");
  if (capabilitiesBody) result.dataSource.push("GET /v1/capabilities");
  result.connectivity = simpleRecognized ? "ok" : "unknown";

  if (!simpleRecognized) {
    result.notes.push("Simple health payload shape was not recognized.");
    return result;
  }
  if (!readiness || !rawChecks || !["ok", "degraded"].includes(readinessStatus)) {
    result.notes.push("Detailed readiness payload was missing or unrecognized.");
    return result;
  }

  let invalidCheck = false;
  for (const name of CHECK_NAMES) {
    if (!(name in rawChecks)) {
      invalidCheck = true;
      continue;
    }
    const check = normalizeCheck(name, rawChecks[name], Array.isArray(meta.secrets) ? meta.secrets : []);
    if (check) result.checks[name] = check;
    else invalidCheck = true;
  }
  const checkValues = Object.values(result.checks);
  if (!checkValues.length || invalidCheck) {
    // Confirmed upstream degraded still wins over partial parse failure (M1).
    if (readinessStatus === "degraded") {
      result.backend = "degraded";
      result.overallStatus = "degraded";
      result.lastSuccessfulProbeAt = result.probedAt;
    } else {
      result.backend = "unknown";
      result.overallStatus = "unknown";
    }
    result.notes.push("One or more readiness checks could not be parsed.");
    return result;
  }

  const hasUnhealthyCheck = checkValues.some(check => check.status !== "ok");
  result.backend = readinessStatus === "ok" && !hasUnhealthyCheck ? "ready" : "degraded";
  result.overallStatus = result.backend === "ready" ? "healthy" : "degraded";
  result.lastSuccessfulProbeAt = result.probedAt;
  result.gateway = {
    state: safeToken(detailed.gateway_state || result.checks.gateway?.state || "unknown"),
    busy: typeof detailed.gateway_busy === "boolean" ? detailed.gateway_busy : null,
    drainable: typeof detailed.gateway_drainable === "boolean" ? detailed.gateway_drainable : null,
    activeAgents: boundedInteger(detailed.active_agents)
  };
  result.platforms = normalizePlatforms(detailed.platforms);

  const capabilities = object(capabilitiesBody);
  if (capabilities?.object === "hermes.api_server.capabilities" && capabilities?.platform === "hermes-agent") {
    result.capabilities = { recognized: true, platform: "hermes-agent" };
  } else if (capabilitiesBody) {
    result.capabilities = { recognized: false, platform: null };
    result.notes.push("Capabilities payload shape was not recognized; readiness classification is unchanged.");
  }
  return result;
}

function unavailableResult(instanceId, probedAt, err, dataSource = []) {
  return {
    ...baseResult({ instanceId, probedAt }),
    overallStatus: "unavailable",
    connectivity: "unavailable",
    backend: "unavailable",
    dataSource,
    error: publicError(err),
    notes: ["Hermes runtime health could not be verified."]
  };
}

export async function getHermesRuntimeHealth(env, instanceId, { fetchImpl, now = Date.now() } = {}) {
  const probedAt = Number(now) || Date.now();
  const client = createHermesClient(env, instanceId, { fetchImpl });
  let simple;
  try {
    simple = (await client.getHealth()).body;
  } catch (err) {
    return unavailableResult(instanceId, probedAt, err);
  }

  let detailed;
  let capabilities = null;
  try {
    const responses = await Promise.allSettled([client.getHealthDetailed(), client.getCapabilities()]);
    if (responses[0].status === "rejected") {
      return unavailableResult(instanceId, probedAt, responses[0].reason, ["GET /health"]);
    }
    detailed = responses[0].value.body;
    if (responses[1].status === "fulfilled") capabilities = responses[1].value.body;
  } catch (err) {
    return unavailableResult(instanceId, probedAt, err, ["GET /health"]);
  }
  const result = normalizeHermesHealthProbe(simple, detailed, capabilities, { instanceId, probedAt, secrets: client.secrets });
  if (!capabilities) result.notes.push("Capabilities summary was unavailable; readiness classification is unchanged.");
  return result;
}

export { normalizeCheck, normalizePlatforms };
