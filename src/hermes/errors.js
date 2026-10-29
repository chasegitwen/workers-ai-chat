// Error normalization for Hermes upstream responses.
//
// Only whitelisted fields leave this module: a local code, the upstream HTTP status and
// error.code, and a redacted, truncated message taken from the JSON error envelope. Raw
// upstream bodies (HTML from Access, proxies, etc.) are never forwarded.

const MAX_MESSAGE_CHARS = 300;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export class HermesError extends Error {
  constructor(code, message, { httpStatus = 502, upstreamStatus = 0, upstreamCode = "", ambiguous = false } = {}) {
    super(message || code);
    this.name = "HermesError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
    // True when the outcome of a mutating request cannot be known (timeout, network,
    // gateway errors). Callers must not treat ambiguous submit failures as "not created".
    this.ambiguous = ambiguous;
  }

  toJSON() {
    return publicError(this);
  }
}

export function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    const value = String(secret || "");
    if (value.length >= 4) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/HermesRoom\s+[A-Za-z0-9._~+/=-]+/gi, "HermesRoom [redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/("?(?:api[_-]?key|token|secret|password|authorization|cf-access-client-secret)"?\s*[:=]\s*)("[^"]*"|[^\s,;}]+)/gi, "$1[redacted]");
}

export function safeMessage(text, secrets = []) {
  return redactSecrets(text, secrets).replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
}

export function safeCode(value) {
  const code = String(value || "").trim();
  return CODE_PATTERN.test(code) ? code : "";
}

export function publicError(err) {
  if (err instanceof HermesError) {
    return {
      code: err.code,
      message: err.message,
      upstreamStatus: err.upstreamStatus || undefined,
      upstreamCode: err.upstreamCode || undefined
    };
  }
  return { code: "hermes_internal_error", message: "Hermes adapter error" };
}

function upstreamEnvelope(body) {
  const error = body && typeof body === "object" ? body.error : null;
  if (error && typeof error === "object") {
    return { code: safeCode(error.code), type: safeCode(error.type), message: String(error.message || "") };
  }
  if (typeof error === "string") return { code: "", type: "", message: error };
  return { code: "", type: "", message: "" };
}

const DEFINITE_REJECT_503_CODES = new Set(["gateway_draining", "runtime_draining", "storage_unavailable", "chain_moved"]);

// Maps a non-2xx upstream response to a HermesError. `mutating` marks requests whose
// failure can leave the upstream state unknown (submit).
export function errorFromUpstream(status, body, { mutating = false, secrets = [] } = {}) {
  const envelope = upstreamEnvelope(body);
  const message = safeMessage(envelope.message || ("Hermes upstream HTTP " + status), secrets);
  const base = { upstreamStatus: status, upstreamCode: envelope.code };

  if (status >= 300 && status < 400) {
    return new HermesError("hermes_upstream_auth", "Hermes upstream redirected (Access login?)", { ...base, httpStatus: 502 });
  }
  if (status === 401 || status === 403) {
    return new HermesError("hermes_upstream_auth", "Hermes upstream rejected credentials", { ...base, httpStatus: 502 });
  }
  if (status === 404) {
    return new HermesError(envelope.code === "run_not_found" ? "hermes_run_not_found" : "hermes_upstream_not_found", message, { ...base, httpStatus: 404 });
  }
  if (status === 409) {
    const map = {
      idempotency_key_conflict: "hermes_idempotency_conflict",
      run_not_active: "hermes_run_not_active",
      unknown_execution: "hermes_unknown_execution",
      stale_generation: "hermes_stale_generation",
      admission_conflict: "hermes_idempotency_conflict",
      queue_full: "hermes_upstream_busy"
    };
    return new HermesError(map[envelope.code] || "hermes_conflict", message, { ...base, httpStatus: 409 });
  }
  if (status === 429) {
    return new HermesError("hermes_upstream_busy", message, { ...base, httpStatus: 429 });
  }
  if (status === 400 || status === 413 || status === 422) {
    return new HermesError("hermes_bad_request", message, { ...base, httpStatus: 400 });
  }
  if (status === 503 && DEFINITE_REJECT_503_CODES.has(envelope.code)) {
    return new HermesError("hermes_unavailable", message, { ...base, httpStatus: 503 });
  }
  return new HermesError("hermes_upstream_error", message, { ...base, httpStatus: 502, ambiguous: mutating });
}
