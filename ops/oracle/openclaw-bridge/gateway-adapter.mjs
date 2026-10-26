/**
 * Lifecycle wrapper around the public GatewayClient constructor.
 * The concrete class is injected so reconnect behavior can be tested offline.
 */
export class GatewayAdapter {
  constructor({ ClientClass, clientOptions, readyTimeoutMs = 15_000, handlers = {}, logger = console }) {
    if (typeof ClientClass !== "function") throw new TypeError("ClientClass is required");
    this.ClientClass = ClientClass;
    this.clientOptions = clientOptions;
    this.readyTimeoutMs = readyTimeoutMs;
    this.handlers = handlers;
    this.logger = logger;
    this.client = null;
    this.started = false;
    this.stopped = false;
    this.connected = false;
    this.lastConnectError = null;
    this.#resetReady();
  }

  #readyPromise;
  #resolveReady;

  #resetReady() {
    this.#readyPromise = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  #markReady(hello) {
    const wasConnected = this.connected;
    this.connected = true;
    this.lastConnectError = null;
    this.#resolveReady?.(hello);
    if (!wasConnected) this.handlers.onConnected?.(hello);
  }

  #markClosed(code, reason, info) {
    const wasConnected = this.connected;
    this.connected = false;
    // Keep the original readiness promise across pre-hello retry closes. After
    // a real connection drops, create exactly one promise for the reconnect.
    if (!this.stopped && wasConnected) this.#resetReady();
    if (wasConnected || !this.stopped) this.handlers.onDisconnected?.({ code, reason, info });
  }

  async start() {
    if (this.stopped) throw new Error("GatewayAdapter is stopped");
    if (!this.started) {
      this.started = true;
      this.client = new this.ClientClass({
        ...this.clientOptions,
        onEvent: (event) => this.handlers.onEvent?.(event),
        onGap: (info) => this.handlers.onGap?.(info),
        onHelloOk: (hello) => this.#markReady(hello),
        onConnectError: (error) => {
          this.lastConnectError = error instanceof Error ? error : new Error(String(error));
          this.handlers.onConnectError?.(this.lastConnectError);
        },
        onReconnectPaused: (info) => this.handlers.onReconnectPaused?.(info),
        onClose: (code, reason, info) => this.#markClosed(code, reason, info),
      });
      this.client.start();
    }
    await this.waitUntilReady();
    return this;
  }

  async waitUntilReady(timeoutMs = this.readyTimeoutMs) {
    if (this.connected) return;
    let timer;
    try {
      await Promise.race([
        this.#readyPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const suffix = this.lastConnectError ? `: ${this.lastConnectError.message}` : "";
            reject(new Error(`Gateway readiness timeout${suffix}`));
          }, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async request(method, params = {}, options = {}) {
    await this.start();
    if (!this.connected) await this.waitUntilReady();
    const { beforeDispatch, ...requestOptions } = options;
    if (beforeDispatch !== undefined) {
      if (typeof beforeDispatch !== "function") throw new TypeError("beforeDispatch must be a function");
      const result = beforeDispatch();
      if (result && typeof result.then === "function") {
        throw new TypeError("beforeDispatch must be synchronous");
      }
    }
    // No await may be added between the guard and this call: cancellation
    // relies on this same-turn boundary to prove that a prevented request can
    // never be dispatched after the task becomes canceled.
    return await this.client.request(method, params, requestOptions);
  }

  async stop() {
    this.stopped = true;
    this.connected = false;
    if (typeof this.client?.stopAndWait === "function") {
      await this.client.stopAndWait({ timeoutMs: 3_000 });
    } else {
      this.client?.stop?.();
    }
  }
}

/** Buffers chat events that arrive before chat.send's runId is committed. */
export class PendingRunEventBuffer {
  constructor(maxPerRun = 100) {
    this.maxPerRun = maxPerRun;
    this.byRunId = new Map();
  }

  push(runId, event) {
    if (!runId) return;
    const queue = this.byRunId.get(runId) ?? [];
    queue.push(event);
    if (queue.length > this.maxPerRun) queue.shift();
    this.byRunId.set(runId, queue);
  }

  take(runId) {
    const queue = this.byRunId.get(runId) ?? [];
    this.byRunId.delete(runId);
    return queue;
  }
}
