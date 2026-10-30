// Hermes API client (v0.22.5 contract).
//
// Every request targets a fixed path template on the allowlisted origin from config.js.
// Path parameters are validated before use; there is no way to reach an arbitrary URL.
// Redirects are never followed so credentials cannot be replayed to another host.

import { HERMES_TIMEOUTS_MS, resolveHermesUpstream } from "./config.js";
import { HermesError, errorFromUpstream, safeMessage } from "./errors.js";

const RUN_ID_PATTERN = /^run_[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export function isHermesRunId(value) {
  return RUN_ID_PATTERN.test(String(value || ""));
}

export function isValidIdempotencyKey(value) {
  return IDEMPOTENCY_KEY_PATTERN.test(String(value || ""));
}

async function readJson(response) {
  const text = await response.text().catch(() => "");
  if (!text) return { body: null, parsed: false };
  try {
    return { body: JSON.parse(text), parsed: true };
  } catch (err) {
    return { body: null, parsed: false };
  }
}

export function createHermesClient(env, instanceId, { fetchImpl } = {}) {
  const upstream = resolveHermesUpstream(env, instanceId);
  if (!upstream.ok) {
    throw new HermesError(upstream.code, "Hermes instance is not available", { httpStatus: 503 });
  }
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const secrets = Object.values(upstream.headers).map(value => String(value).replace(/^Bearer\s+/, ""));

  async function request(method, path, { body, headers = {}, timeoutMs, mutating = false, stream = false, signal } = {}) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;
    const onAbort = () => controller.abort("client_abort");
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const timeoutError = () => new HermesError("hermes_timeout", "Hermes upstream timed out", { httpStatus: 504, ambiguous: mutating });
    let response;
    try {
      response = await doFetch(upstream.baseUrl + path, {
        method,
        redirect: "manual",
        headers: {
          Accept: stream ? "text/event-stream" : "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
          ...upstream.headers
        },
        body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
        signal: controller.signal
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      if (controller.signal.aborted && controller.signal.reason === "timeout") throw timeoutError();
      throw new HermesError("hermes_network_error",
        safeMessage("Hermes upstream unreachable: " + (err?.message || err), secrets),
        { httpStatus: 504, ambiguous: mutating });
    }
    if (stream) {
      // The timeout bounds time-to-headers only; the event body stays open after this.
      if (timer) clearTimeout(timer);
      if (!response.ok) {
        signal?.removeEventListener?.("abort", onAbort);
        const { body: errorBody } = await readJson(response);
        throw errorFromUpstream(response.status, errorBody, { secrets });
      }
      return response;
    }
    let json;
    let parsed;
    try {
      ({ body: json, parsed } = await readJson(response));
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
    if (controller.signal.aborted && controller.signal.reason === "timeout") throw timeoutError();
    if (response.status < 200 || response.status >= 300) {
      throw errorFromUpstream(response.status, json, { mutating, secrets });
    }
    if (!parsed || !json || typeof json !== "object") {
      throw new HermesError("hermes_bad_response", "Hermes upstream returned a non-JSON body",
        { httpStatus: 502, upstreamStatus: response.status, ambiguous: mutating });
    }
    return { status: response.status, headers: response.headers, body: json };
  }

  function runPath(runId, suffix = "") {
    if (!isHermesRunId(runId)) {
      throw new HermesError("hermes_invalid_run_id", "Invalid Hermes run id", { httpStatus: 400 });
    }
    return "/v1/runs/" + encodeURIComponent(runId) + suffix;
  }

  return {
    instanceId,
    secrets,
    getCapabilities: () => request("GET", "/v1/capabilities", { timeoutMs: HERMES_TIMEOUTS_MS.capabilities }),
    getModelOptions: ({ refresh = false } = {}) => request("GET",
      "/api/model/options?include_unconfigured=false" + (refresh ? "&refresh=true" : ""),
      { timeoutMs: HERMES_TIMEOUTS_MS.catalog }),
    createRun(bodyJson, idempotencyKey) {
      if (!isValidIdempotencyKey(idempotencyKey)) {
        throw new HermesError("hermes_invalid_idempotency_key", "Invalid idempotency key", { httpStatus: 500 });
      }
      return request("POST", "/v1/runs", {
        body: bodyJson,
        headers: { "Idempotency-Key": idempotencyKey },
        timeoutMs: HERMES_TIMEOUTS_MS.submit,
        mutating: true
      });
    },
    getRun: runId => request("GET", runPath(runId), { timeoutMs: HERMES_TIMEOUTS_MS.status }),
    stopRun: runId => request("POST", runPath(runId, "/stop"), { timeoutMs: HERMES_TIMEOUTS_MS.stop, mutating: true }),
    respondApproval: (runId, requestId, executionGeneration, choice) => request(
      "POST", runPath(runId, "/approval"), {
        body: { request_id: requestId, execution_generation: executionGeneration, choice },
        timeoutMs: HERMES_TIMEOUTS_MS.approval,
        mutating: true
      }
    ),
    resolveUnknown: (runId, admissionId, executionGeneration) => request("POST", runPath(runId, "/resolve-unknown"), {
      body: { admission_id: admissionId, execution_generation: executionGeneration },
      timeoutMs: HERMES_TIMEOUTS_MS.resolveUnknown,
      mutating: true
    }),
    // No Last-Event-ID is sent: upstream replay is not relied on; state comes from getRun.
    openEvents(runId, { signal } = {}) {
      return request("GET", runPath(runId, "/events"), { stream: true, signal, timeoutMs: HERMES_TIMEOUTS_MS.status });
    }
  };
}
