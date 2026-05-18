export class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = options.provider || "";
    this.model = options.model || "";
    this.status = options.status || 0;
    this.code = options.code || "";
    this.raw = options.raw || "";
  }
}

function parseErrorPayload(raw) {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed?.error || parsed || {};
  } catch (err) {
    return {};
  }
}

export function readableProviderStatus(status) {
  if (status === 401) {
    return "Provider authentication failed. Check the API key environment variable.";
  }

  if (status === 403) {
    return "Provider refused the request. Check account permissions, quota, or model access.";
  }

  if (status === 404) {
    return "Provider endpoint or model was not found. Check base URL and model name.";
  }

  if (status === 429) {
    return "Provider rate limit or quota was reached. Please retry later or switch models.";
  }

  if (status >= 500) {
    return "Provider service is temporarily unavailable. Please retry later or use fallback.";
  }

  if (status) {
    return "Provider request failed with HTTP " + status + ".";
  }

  return "Provider request failed.";
}

export function createProviderHttpError({ provider, model, status, raw }) {
  const payload = parseErrorPayload(raw);
  const code = String(payload.code || payload.type || payload.error_code || status || "provider_error");
  const detail = String(payload.message || payload.error || "").trim();
  const message = readableProviderStatus(status) + (detail ? " " + detail : "");

  return new ProviderError(message, {
    provider,
    model,
    status,
    code,
    raw
  });
}

export function normalizeProviderError(err, fallback = {}) {
  const status = Number(err?.status || err?.statusCode || 0);
  const code = String(err?.code || err?.name || "provider_error");
  const message = err?.message
    ? String(err.message)
    : readableProviderStatus(status);

  return {
    provider: String(err?.provider || fallback.provider || ""),
    model: String(err?.model || fallback.model || ""),
    status,
    code,
    message,
    raw: err?.raw === undefined ? "" : err.raw
  };
}

export class ModelNotFoundError extends ProviderError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ModelNotFoundError";
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ProviderTimeoutError";
  }
}

export class UnsupportedProviderTypeError extends ProviderError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "UnsupportedProviderTypeError";
    this.providerType = options.providerType || "";
  }
}

export class ProviderNotImplementedError extends ProviderError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ProviderNotImplementedError";
    this.providerType = options.providerType || "";
  }
}
