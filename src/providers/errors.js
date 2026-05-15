export class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = options.provider || "";
    this.model = options.model || "";
  }
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
