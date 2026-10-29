// Hermes Agent runtime configuration.
//
// Hermes is a separate runtime type: it never goes through the provider catalog, the
// OpenAI-compatible adapter or the OpenClaw Bridge. Upstreams are a fixed allowlist in
// code; an env var may only select one of the listed origins, never introduce a new one.

export const HERMES_RUNTIME_TYPE = "hermes";
export const ORACLE_HERMES_INSTANCE_ID = "oracle-hermes";
export const HERMES_AGENT_ID = "hermes-agent";

export const HERMES_INSTANCES = Object.freeze({
  [ORACLE_HERMES_INSTANCE_ID]: Object.freeze({
    id: ORACLE_HERMES_INSTANCE_ID,
    label: "Oracle Hermes",
    // Public origin of the Oracle Hermes API (Cloudflare Tunnel + Access in front of
    // 127.0.0.1:8642). Placeholder until the Tunnel hostname is confirmed; adding or
    // changing an origin is a reviewed code change, not a configuration change.
    allowedOrigins: Object.freeze(["https://oracle-hermes.hnsnowground.cfd"]),
    baseUrlEnv: "HERMES_ORACLE_BASE_URL",
    apiKeyEnv: "HERMES_ORACLE_API_KEY",
    accessClientIdEnv: "HERMES_ORACLE_ACCESS_CLIENT_ID",
    accessClientSecretEnv: "HERMES_ORACLE_ACCESS_CLIENT_SECRET",
    agents: Object.freeze([Object.freeze({ id: HERMES_AGENT_ID, label: "Hermes Agent" })])
  })
});

export const HERMES_TIMEOUTS_MS = Object.freeze({
  capabilities: 10000,
  catalog: 15000,
  submit: 20000,
  status: 10000,
  stop: 10000,
  resolveUnknown: 10000
});

// Initial global limit; enforced by the single-slot unique index in migration 0022.
export const HERMES_GLOBAL_CONCURRENCY = 1;
// A run left in reserving/submitting longer than this (Worker died mid-request) is
// reclassified as submission_unknown on next read. It is never resubmitted automatically.
export const HERMES_STALE_SUBMIT_MS = 2 * 60 * 1000;
export const HERMES_CATALOG_MAX_AGE_MS = 5 * 60 * 1000;
export const HERMES_MAX_INPUT_CHARS = 32000;

function flagEnabled(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "on" || text === "yes";
}

// Stage 1 flag: the Hermes target, instance and catalog are visible in the UI/API.
export function hermesCatalogVisible(env) {
  return flagEnabled(env?.HERMES_CATALOG_VISIBLE);
}

// Stage 2 flag: runs may be submitted. Requires the catalog flag as well.
export function hermesExecutionEnabled(env) {
  return hermesCatalogVisible(env) && flagEnabled(env?.HERMES_EXECUTION_ENABLED);
}

export function hermesInstance(instanceId) {
  return Object.prototype.hasOwnProperty.call(HERMES_INSTANCES, instanceId)
    ? HERMES_INSTANCES[instanceId]
    : null;
}

function normalizeOrigin(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch (err) {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
  if (url.pathname && url.pathname !== "/") return "";
  return url.origin;
}

// Resolves the upstream for an instance. Returns { ok, baseUrl, headers } or { ok:false, code }.
// Credential values are only ever placed into request headers; they are never returned
// to callers that build responses or logs (see describeHermesUpstream).
export function resolveHermesUpstream(env, instanceId) {
  const instance = hermesInstance(instanceId);
  if (!instance) return { ok: false, code: "hermes_unknown_instance" };
  // A set-but-invalid value fails closed instead of falling back to the default origin.
  const rawConfigured = String(env?.[instance.baseUrlEnv] || "").trim();
  const baseUrl = rawConfigured
    ? normalizeOrigin(rawConfigured)
    : (instance.allowedOrigins.length === 1 ? instance.allowedOrigins[0] : "");
  if (!baseUrl || !instance.allowedOrigins.includes(baseUrl)) {
    return { ok: false, code: "hermes_upstream_not_allowed" };
  }
  const apiKey = String(env?.[instance.apiKeyEnv] || "").trim();
  if (!apiKey) return { ok: false, code: "hermes_not_configured" };
  const headers = { Authorization: "Bearer " + apiKey };
  const accessId = String(env?.[instance.accessClientIdEnv] || "").trim();
  const accessSecret = String(env?.[instance.accessClientSecretEnv] || "").trim();
  if (accessId && accessSecret) {
    headers["CF-Access-Client-Id"] = accessId;
    headers["CF-Access-Client-Secret"] = accessSecret;
  }
  return { ok: true, instance, baseUrl, headers };
}

// Safe, credential-free description for diagnostics responses.
export function describeHermesUpstream(env, instanceId) {
  const instance = hermesInstance(instanceId);
  if (!instance) return null;
  const resolved = resolveHermesUpstream(env, instanceId);
  return {
    instanceId: instance.id,
    configured: resolved.ok,
    reason: resolved.ok ? "" : resolved.code,
    hasApiKey: Boolean(String(env?.[instance.apiKeyEnv] || "").trim()),
    hasAccessCredentials: Boolean(String(env?.[instance.accessClientIdEnv] || "").trim()
      && String(env?.[instance.accessClientSecretEnv] || "").trim())
  };
}
