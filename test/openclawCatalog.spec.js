import { describe, expect, it, vi } from "vitest";
import { handleOpenClawCatalog, normalizeOpenClawCatalog, validateOpenClawCatalogSelection } from "../src/api/openclawCatalog.js";
import { buildModelProviderCatalog, handleChat } from "../src/api/chat.js";
import { htmlPage } from "../src/frontend/page.js";

function fakeDb(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    async batch(statements) { return statements.map(() => ({ success: true })); },
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (String(sql).includes("FROM openclaw_runtimes") && !String(sql).includes("JOIN")) {
                return {
                  id: values[0], display_name: "Seattle OpenClaw", slug: "seattle-openclaw",
                  provider_id: "openclaw-seattle", base_url: "https://act.hnsnowground.cfd/v1",
                  capabilities_json: "{}", agents_json: "[]", bridge_mode: "legacy",
                  status: "verified", is_enabled: 1
                };
              }
              if (!String(sql).includes("settings")) return null;
              const value = rows.get(values[0]);
              return value === undefined ? null : { value };
            },
            async all() { return { results: [] }; },
            async run() { rows.set(values[0], values[1]); }
          };
        }
      };
    }
  };
}

function gatewayResponse(payload) {
  return { type: "res", ok: true, payload };
}

function gatewaySocket(calls, scopes = ["operator.read"], catalog = {}) {
  const listeners = {};
  const emit = (type, frame) => queueMicrotask(() => listeners[type]?.({ data: JSON.stringify(frame) }));
  const agents = catalog.agents || [{ id: "research", name: "Research" }];
  const modelsByAgent = catalog.modelsByAgent || {
    research: [{ id: "openai/gpt-6-astra", name: "Astra" }]
  };
  return {
    accept() {
      emit("message", { type: "event", event: "connect.challenge", payload: { nonce: "nonce", ts: Date.now() } });
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    send(text) {
      const frame = JSON.parse(text);
      calls.push(frame);
      if (frame.method === "connect") emit("message", { ...gatewayResponse({ type: "hello-ok", auth: { scopes } }), id: "connect" });
      if (frame.method === "agents.list") emit("message", { ...gatewayResponse({ agents }), id: "agents" });
      if (frame.method === "models.list") emit("message", {
        ...gatewayResponse({ models: modelsByAgent[frame.params?.agentId] || [] }), id: frame.id
      });
    },
    close() {}
  };
}

describe("Seattle OpenClaw catalog", () => {
  it("keeps only public agent and model fields", () => {
    const catalog = normalizeOpenClawCatalog(
      { agents: [{ id: "research", name: "Research", model: "openai/gpt-6-astra", secret: "hidden" }, { id: "internal", kind: "system" }] },
      { models: [{ id: "gpt-6-astra", provider: "openai", name: "Astra", available: true, apiKey: "hidden" }] },
      123
    );
    expect(catalog.agents).toEqual([{ id: "research", name: "Research", defaultModel: "openai/gpt-6-astra" }]);
    expect(catalog.models).toEqual([{ id: "openai/gpt-6-astra", name: "Astra", available: true }]);
    expect(catalog.modelsByAgent.research).toEqual(catalog.models);
    expect(JSON.stringify(catalog)).not.toContain("hidden");
  });

  it("calls only the two fixed read methods and serves the D1 cache", async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      requests.push({ url, headers: init.headers });
      return { webSocket: gatewaySocket(calls) };
    });
    const env = {
      DB: fakeDb(),
      SESSION_SECRET: "session-secret",
      OPENCLAW_SEATTLE_API_KEY: "private-token",
      ACT_CF_ACCESS_CLIENT_ID: "private-client",
      ACT_CF_ACCESS_CLIENT_SECRET: "private-secret",
      OPENCLAW_SEATTLE_GATEWAY_WS_URL: "https://act.hnsnowground.cfd/gateway-ws/catalog"
    };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      const first = await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url);
      const body = await first.json();
      expect(body.status).toBe("fresh");
      expect(body.catalog.models[0].id).toBe("openai/gpt-6-astra");
      expect(JSON.stringify(body)).not.toContain("private-");
      expect(first.headers.get("Cache-Control")).toBe("no-store");
      expect(calls.map(call => call.method)).toEqual(["connect", "agents.list", "models.list"]);
      expect(calls[2].params).toEqual({ agentId: "research", view: "configured", refresh: true });
      expect(requests[0].headers["CF-Access-Client-Id"]).toBe("private-client");
      expect(requests[0].headers["CF-Access-Client-Secret"]).toBe("private-secret");
      expect(requests[0].url).toBe("https://act.hnsnowground.cfd/gateway-ws/catalog");
      expect(requests[0].headers.Authorization).toBeUndefined();
      await handleOpenClawCatalog(new Request(url), env, url);
      expect(requests).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetches and maps the configured catalog separately for every Seattle Agent", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async () => ({ webSocket: gatewaySocket(calls, ["operator.read"], {
      agents: [
        { id: "main", name: "Main", model: "zai/glm-5.2" },
        { id: "kimi", name: "Kimi", model: "kimi/kimi-for-coding" }
      ],
      modelsByAgent: {
        main: [
          { id: "glm-5.2", provider: "zai", name: "GLM-5.2" },
          { id: "glm-5.3", provider: "zai", name: "GLM-5.3" }
        ],
        kimi: [{ id: "kimi-for-coding", provider: "kimi", name: "Kimi for Coding" }]
      }
    }) }));
    const env = {
      DB: fakeDb(), SESSION_SECRET: "session-secret", OPENCLAW_SEATTLE_API_KEY: "secret",
      ACT_CF_ACCESS_CLIENT_ID: "client", ACT_CF_ACCESS_CLIENT_SECRET: "client-secret"
    };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      const response = await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url);
      const body = await response.json();
      expect(calls.filter(call => call.method === "models.list").map(call => call.params)).toEqual([
        { agentId: "main", view: "configured", refresh: true },
        { agentId: "kimi", view: "configured", refresh: true }
      ]);
      expect(body.catalog.modelsByAgent.main.map(model => model.id)).toEqual(["zai/glm-5.2", "zai/glm-5.3"]);
      expect(body.catalog.modelsByAgent.kimi.map(model => model.id)).toEqual(["kimi/kimi-for-coding"]);
      expect(await validateOpenClawCatalogSelection(env, "kimi", "kimi/kimi-for-coding")).toBe(true);
      expect(await validateOpenClawCatalogSelection(env, "kimi", "zai/glm-5.2")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("shows stale data when a refresh fails", async () => {
    const originalFetch = globalThis.fetch;
    let fail = false;
    globalThis.fetch = vi.fn(async () => {
      if (fail) return { status: 404 };
      return { webSocket: gatewaySocket([]) };
    });
    const env = { DB: fakeDb(), SESSION_SECRET: "session-secret", OPENCLAW_SEATTLE_API_KEY: "secret", ACT_CF_ACCESS_CLIENT_ID: "client", ACT_CF_ACCESS_CLIENT_SECRET: "client-secret" };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url);
      fail = true;
      const body = await (await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url)).json();
      expect(body.status).toBe("stale");
      expect(body.catalog.agents[0].id).toBe("research");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refreshes a legacy unscoped Seattle cache instead of reusing its global model list", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async () => ({ webSocket: gatewaySocket(calls) }));
    const env = {
      DB: fakeDb({
        openclaw_catalog_seattle_v1: JSON.stringify({
          providerId: "openclaw-seattle", syncedAt: Date.now(),
          agents: [{ id: "research", defaultModel: "openai/gpt-6-astra" }],
          models: [{ id: "zai/glm-5.2", available: true }]
        })
      }),
      SESSION_SECRET: "session-secret", OPENCLAW_SEATTLE_API_KEY: "secret",
      ACT_CF_ACCESS_CLIENT_ID: "client", ACT_CF_ACCESS_CLIENT_SECRET: "client-secret"
    };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      const body = await (await handleOpenClawCatalog(new Request(url), env, url)).json();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(body.catalog.modelsByAgent.research.map(model => model.id)).toEqual(["openai/gpt-6-astra"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("marks disabled Seattle providers unavailable even in a cached catalog", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ webSocket: gatewaySocket([]) }));
    const env = { DB: fakeDb(), SESSION_SECRET: "session-secret", OPENCLAW_SEATTLE_API_KEY: "secret",
      ACT_CF_ACCESS_CLIENT_ID: "client", ACT_CF_ACCESS_CLIENT_SECRET: "client-secret",
      OPENCLAW_SEATTLE_DISABLED_MODEL_PROVIDERS: "openai" };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url);
      const body = await (await handleOpenClawCatalog(new Request(url), env, url)).json();
      expect(body.catalog.models[0]).toMatchObject({ id: "openai/gpt-6-astra", available: false });
      expect(body.catalog.modelsByAgent.research[0]).toMatchObject({ id: "openai/gpt-6-astra", available: false });
      expect(await validateOpenClawCatalogSelection(env, "research", "openai/gpt-6-astra")).toBe(false);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a Gateway identity with broader scopes", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async () => ({ webSocket: gatewaySocket(calls, ["operator.read", "operator.write"]) }));
    const env = { SESSION_SECRET: "session-secret", OPENCLAW_SEATTLE_API_KEY: "private-token",
      ACT_CF_ACCESS_CLIENT_ID: "private-client", ACT_CF_ACCESS_CLIENT_SECRET: "private-secret" };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      const response = await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url);
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.status).toBe("gateway_scope_not_read_only");
      expect(calls.map(call => call.method)).toEqual(["connect"]);
      expect(JSON.stringify(body)).not.toContain("private-");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses a Gateway URL on another host before sending Access credentials", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    const env = { SESSION_SECRET: "session-secret", OPENCLAW_SEATTLE_API_KEY: "private-token",
      ACT_CF_ACCESS_CLIENT_ID: "private-client", ACT_CF_ACCESS_CLIENT_SECRET: "private-secret",
      OPENCLAW_SEATTLE_GATEWAY_WS_URL: "https://other.example/gateway-ws/catalog" };
    const url = new URL("https://app.example/api/openclaw/catalog/seattle");
    try {
      const response = await handleOpenClawCatalog(new Request(url, { method: "POST" }), env, url);
      expect((await response.json()).status).toBe("websocket_url_invalid");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renders separate provider, agent, and base model controls", () => {
    const page = htmlPage();
    expect(page).toContain('data-model-mode="classic"');
    expect(page).toContain('data-model-mode="modern"');
    expect(page).toContain('data-new-mode-target="model"');
    expect(page).toContain('data-new-mode-target="openclaw"');
    expect(page).toContain('id="effectiveModelResult"');
    expect(page).toContain('id="openClawInstancesList"');
    expect(page).toContain('id="addOpenClawInstanceBtn"');
    expect(page).toContain('id="openClawInstancesSettings" class="openClawInstancesSettings modelCategory"');
    expect(page).toContain('<strong>OpenClaw 实例</strong>');
    expect(page.indexOf('id="openClawInstancesSettings"')).toBeGreaterThan(page.indexOf('id="providersList"'));
    expect(page).toContain('{ label:"编辑实例", onClick:() => openOpenClawInstanceDialog(instance) }');
    expect(page).toContain('id="openClawProviderSelect"');
    expect(page).toContain('id="openClawAgentSelect"');
    expect(page).toContain('id="openClawBaseModelSelect"');
    expect(page).toContain('id="openClawCatalogRefresh"');
    expect(page).toContain("function classicCategoryProviders(category)");
    expect(page).toContain("const visibleProviders = classicCategoryProviders(category);");
    expect(page).toContain("function openOpenClawInstanceDialog(instance = null)");
    expect(page).toContain('idInput.value = "openclaw-" + targetSelect.value');
    expect(page).toContain('targetSelect.value === "seattle" ? "Seattle OpenClaw" : "Hillsboro OpenClaw"');
    expect(page).toContain("instance_id:isOpenClawRequest ? requestSelection.instanceId");
    const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
    const declaration = script.match(/function openClawModelsForAgent\([\s\S]*?\n\}/)?.[0] || "";
    const modelsForAgent = new Function(declaration + "; return openClawModelsForAgent;")();
    const scopedCatalog = {
      models: [{ id: "zai/glm-5.2" }, { id: "kimi/kimi-for-coding" }],
      modelsByAgent: {
        main: [{ id: "zai/glm-5.2" }],
        kimi: [{ id: "kimi/kimi-for-coding" }]
      }
    };
    expect(modelsForAgent(scopedCatalog, "main").map(model => model.id)).toEqual(["zai/glm-5.2"]);
    expect(modelsForAgent(scopedCatalog, "kimi").map(model => model.id)).toEqual(["kimi/kimi-for-coding"]);
    expect(modelsForAgent(scopedCatalog, "main").map(model => model.id)).toEqual(["zai/glm-5.2"]);
    expect(modelsForAgent({ providerId:"openclaw-seattle", models:scopedCatalog.models }, "kimi")).toEqual([]);
    expect(modelsForAgent({ providerId:"openclaw-hillsboro", models:scopedCatalog.models }, "kimi")
      .map(model => model.id)).toEqual(["zai/glm-5.2", "kimi/kimi-for-coding"]);
    expect(page).toContain('openClawBaseModelSelect.value = "";');
    expect(() => new Function(page.match(/<script>([\s\S]*)<\/script>/)?.[1] || "")).not.toThrow();
  });

  it("pins Agent-mode OpenClaw connections to the server allowlist", async () => {
    const trustedProvider = {
      id: "openclaw-seattle", label: "Seattle OpenClaw", providerType: "openai-compatible",
      apiBase: "https://act.hnsnowground.cfd/v1", apiKeyEnv: "OPENCLAW_SEATTLE_API_KEY",
      models: [{ id: "seattle-carrier", modelName: "openclaw/main", enabled: true }]
    };
    const db = fakeDb({ model_settings: JSON.stringify({ providers: [trustedProvider] }) });
    const catalog = await buildModelProviderCatalog({}, [{
      ...trustedProvider,
      apiBase: "https://attacker.example/v1",
      apiKeyEnv: "ATTACKER_KEY"
    }], null, null, { strictOpenClawInstances: true });
    const seattle = catalog.find(provider => provider.id === "openclaw-seattle");
    expect(seattle).toBeUndefined();

    const trustedCatalog = await buildModelProviderCatalog({ DB: db }, [{
      ...trustedProvider,
      apiBase: "https://attacker.example/v1",
      apiKeyEnv: "ATTACKER_KEY"
    }], null, null, { strictOpenClawInstances: true });
    const pinned = trustedCatalog.find(provider => provider.id === "openclaw-seattle");
    expect(pinned.apiBase).toBe("https://act.hnsnowground.cfd/v1");
    expect(pinned.apiKeyEnv).toBe("OPENCLAW_SEATTLE_API_KEY");
    expect(pinned.models[0].apiBase).toBe("https://act.hnsnowground.cfd/v1");
  });

  it("rejects new-mode requests after the local instance is deleted while preserving classic provider data", async () => {
    const trustedProvider = {
      id: "openclaw-seattle", label: "Seattle OpenClaw", providerType: "openai-compatible",
      apiBase: "https://act.hnsnowground.cfd/v1", apiKeyEnv: "OPENCLAW_SEATTLE_API_KEY",
      openclawExecutionMode: "legacy",
      models: [{ id: "seattle-carrier", modelName: "openclaw/main", providerType: "openai-compatible", enabled: true }]
    };
    const env = {
      DB: fakeDb({
        model_settings: JSON.stringify({ providers: [trustedProvider], openClawInstances: [] })
      }),
      OPENCLAW_SEATTLE_API_KEY: "server-only"
    };
    const response = await handleChat(new Request("https://app.example/", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        selection_mode: "openclaw-agent",
        instance_id: "openclaw-seattle",
        provider: "openclaw-seattle",
        model: "seattle-carrier",
        agent_id: "main",
        providers: [trustedProvider]
      })
    }), env, { waitUntil() {} });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_openclaw_instance" });
    const saved = JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
      .bind("model_settings").first()).value);
    expect(saved.providers[0].models[0].id).toBe("seattle-carrier");
  });
});

describe("Legacy SSE per-turn OpenClaw routing", () => {
  it("changes agent and base model on consecutive turns of one conversation", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      calls.push({ body: JSON.parse(init.body), headers: init.headers });
      return new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    });
    const provider = {
      id: "openclaw-seattle", label: "OpenClaw Seattle", providerType: "openai-compatible",
      apiBase: "https://seattle.example/v1", apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
      openclawExecutionMode: "legacy",
      models: [{ id: "seattle-entry", modelName: "openclaw/main", providerType: "openai-compatible", enabled: true }]
    };
    try {
      for (const [agent, base] of [["research", "openai/gpt-6-astra"], ["main", "zai/glm-5.1"]]) {
        const response = await handleChat(new Request("https://app.example/", {
          method: "POST",
          body: JSON.stringify({
            conversationId: "same-conversation", messages: [{ role: "user", content: "Hello" }],
            provider: "openclaw-seattle", model: "seattle-entry", runtime_id: "seattle-openclaw",
            agent_id: agent, base_model_id: base, providers: [provider]
          })
        }), { SEATTLE_OPENCLAW_API_KEY: "secret" }, { waitUntil() {} });
        const responseText = await response.text();
        expect(response.status, responseText).toBe(200);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls.map(call => call.body.model)).toEqual(["openclaw/research", "openclaw/main"]);
    expect(calls.map(call => call.headers["x-openclaw-model"])).toEqual(["openai/gpt-6-astra", "zai/glm-5.1"]);
  });

  it("uses the selected Agent each turn and omits the model header for Agent default", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      calls.push({ body: JSON.parse(init.body), headers: init.headers });
      return new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    });
    const provider = {
      id: "openclaw-seattle", label: "Seattle OpenClaw", providerType: "openai-compatible",
      apiBase: "https://act.hnsnowground.cfd/v1", apiKeyEnv: "OPENCLAW_SEATTLE_API_KEY",
      openclawExecutionMode: "legacy",
      models: [{ id: "seattle-carrier", modelName: "openclaw/main", providerType: "openai-compatible", enabled: true }]
    };
    const catalog = {
      providerId: "openclaw-seattle", syncedAt: Date.now(),
      agents: [{ id: "main", defaultModel: "zai/glm-5.2" }, { id: "glm51", defaultModel: "zai/glm-5.1" }],
      models: [{ id: "zai/glm-5.2", available: true }, { id: "zai/glm-5.1", available: true }],
      modelsByAgent: {
        main: [{ id: "zai/glm-5.2", available: true }],
        glm51: [{ id: "zai/glm-5.1", available: true }]
      }
    };
    const env = {
      DB: fakeDb({
        model_settings: JSON.stringify({
          providers: [provider],
          openClawInstances: [{ id: "openclaw-seattle", targetId: "seattle", connectionId: "openclaw-seattle" }]
        }),
        openclaw_catalog_seattle_v1: JSON.stringify(catalog)
      }),
      OPENCLAW_SEATTLE_API_KEY: "server-only",
      GLM_API_KEY: "classic-server-only"
    };
    try {
      for (const [agent, base] of [["main", ""], ["glm51", "zai/glm-5.1"]]) {
        const response = await handleChat(new Request("https://app.example/", {
          method: "POST",
          body: JSON.stringify({
            conversationId: "same-agent-mode-conversation", messages: [{ role: "user", content: "Hello" }],
            selection_mode: "openclaw-agent", provider: "openclaw-seattle", model: "seattle-carrier",
            instance_id: "openclaw-seattle",
            runtime_id: "seattle-openclaw", agent_id: agent,
            base_model_id: base || undefined, providers: [provider]
          })
        }), env, { waitUntil() {} });
        const responseText = await response.text();
        expect(response.status, responseText).toBe(200);
      }
      const classicProvider = {
        id: "classic-glm", label: "Classic GLM", providerType: "openai-compatible",
        apiBase: "https://classic.example/v1", apiKeyEnv: "GLM_API_KEY",
        models: [{ id: "classic-glm-5.2", modelName: "glm-5.2", enabled: true }]
      };
      const classicResponse = await handleChat(new Request("https://app.example/", {
        method: "POST",
        body: JSON.stringify({
          conversationId: "same-agent-mode-conversation", messages: [{ role: "user", content: "Back to classic" }],
          selection_mode: "classic", provider: "classic-glm", model: "classic-glm-5.2",
          providers: [classicProvider]
        })
      }), env, { waitUntil() {} });
      const classicText = await classicResponse.text();
      expect(classicResponse.status, classicText).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls.map(call => call.body.model)).toEqual(["openclaw/main", "openclaw/glm51", "glm-5.2"]);
    expect(calls[0].headers["x-openclaw-model"]).toBeUndefined();
    expect(calls[1].headers["x-openclaw-model"]).toBe("zai/glm-5.1");
    expect(calls[2].headers["x-openclaw-model"]).toBeUndefined();
  });
});
