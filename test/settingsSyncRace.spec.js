import { describe, expect, it } from "vitest";
import { createHarness } from "./helpers/selectionHarness.js";

const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// A fake /api/settings: applies the same shallow merge as the Worker when a request is processed,
// and lets each test decide when (or whether) every request completes.
function fakeSettingsServer(initial){
  const server = { settings: clone(initial), version: 1, requests: [], inFlight: 0, maxInFlight: 0 };
  server.fetch = (url, init) => {
    expect(url).toBe("/api/settings");
    const body = JSON.parse(init.body).settings;
    server.inFlight += 1;
    server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
    let resolveResponse;
    let rejectResponse;
    const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const request = {
      body,
      process(){
        server.version += 1;
        server.settings = { ...server.settings, ...clone(body), version: server.version, updatedAt: server.version };
        request.reply = clone(server.settings);
      },
      deliver(){
        server.inFlight -= 1;
        resolveResponse({ ok: true, json: async () => ({ ok: true, settings: request.reply }), text: async () => "" });
      },
      respond(){
        request.process();
        request.deliver();
      },
      fail(){
        server.inFlight -= 1;
        rejectResponse(new Error("network down"));
      }
    };
    server.requests.push(request);
    return response;
  };
  return server;
}

function setup(settings){
  const base = { defaultModel: "sol", fallbackModels: ["claude"], rememberLastModel: true, ...settings };
  const server = fakeSettingsServer(base);
  const h = createHarness({ settings: base, settingsFetch: server.fetch });
  h.api.applyNewChatSelection();
  return { h, server };
}

describe("serialized settings sync", () => {
  it("keeps the last of rapid A -> B -> C choices with one request in flight at a time", async () => {
    const { h, server } = setup();
    h.api.selectChatModel("claude");
    h.api.selectChatInstance("openclaw-seattle");
    h.api.selectChatAgent("ops");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body.lastChatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    server.requests[0].respond();
    await flush();
    // The stale reply for A must not replace the newer local choice.
    expect(h.settings().lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-seattle", agentId: "ops" });
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body.lastChatSelection).toMatchObject({ kind: "agent", agentId: "ops" });
    server.requests[1].respond();
    await flush();
    expect(server.requests).toHaveLength(2);
    expect(server.maxInFlight).toBe(1);
    expect(server.settings.lastChatSelection).toMatchObject({ kind: "agent", agentId: "ops" });
    expect(h.settings().lastChatSelection).toMatchObject({ kind: "agent", agentId: "ops" });
    expect(h.settings().version).toBe(server.version);
  });

  it("does not let a slow reply that the server processed early overwrite a newer choice", async () => {
    const { h, server } = setup();
    h.api.selectChatModel("claude");
    server.requests[0].process();
    h.api.selectChatInstance("openclaw-hillsboro");
    server.requests[0].deliver();
    await flush();
    expect(h.settings().lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro" });
    server.requests[1].respond();
    await flush();
    expect(server.settings.lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro" });
  });

  it("sends the cleared memory last when 记住上次选择 is turned off during a pending write", async () => {
    const { h, server } = setup();
    h.api.selectChatModel("claude");
    h.api.refreshSettingsControls();
    h.dom.rememberLastModelCheck.checked = false;
    h.api.saveSettingsFromUi(true);
    expect(h.settings().lastChatSelection).toBeNull();
    server.requests[0].respond();
    await flush();
    expect(h.settings().lastChatSelection).toBeNull();
    expect(server.requests[1].body).toMatchObject({ rememberLastModel: false, lastChatSelection: null, lastModel: "" });
    server.requests[1].respond();
    await flush();
    expect(server.settings.lastChatSelection).toBeNull();
    expect(server.settings.rememberLastModel).toBe(false);
    expect(h.settings().lastChatSelection).toBeNull();
    // A later chat choice no longer writes memory.
    h.api.selectChatModel("sol");
    await flush();
    expect(server.requests).toHaveLength(2);
  });

  it("merges a settings-center save and chat choices into ordered writes", async () => {
    const { h, server } = setup();
    h.api.selectChatModel("claude");
    h.api.refreshSettingsControls();
    h.dom.defaultModelSelect.value = "claude";
    h.api.saveSettingsFromUi(false);
    h.api.selectChatInstance("openclaw-seattle");
    const chat = clone(h.state().chatSelection);
    expect(server.requests).toHaveLength(1);
    server.requests[0].respond();
    await flush();
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body).toMatchObject({
      defaultModel: "claude", fallbackModels: ["claude"], lastChatSelection: { kind: "agent", instanceId: "openclaw-seattle" }
    });
    server.requests[1].respond();
    await flush();
    expect(server.settings).toMatchObject({ defaultModel: "claude", fallbackModels: ["claude"] });
    expect(server.settings.lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-seattle" });
    expect(h.state().chatSelection).toEqual(chat);
    expect(server.maxInFlight).toBe(1);
  });

  it("never resends an older choice after a failed write", async () => {
    const { h, server } = setup();
    h.api.selectChatModel("claude");
    server.requests[0].fail();
    await flush();
    expect(h.dom.settingsSyncStatus.textContent).toBe("已本地保存，云端同步失败");
    expect(h.settings().lastChatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    h.api.selectChatInstance("openclaw-seattle");
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body.lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-seattle" });
    server.requests[1].respond();
    await flush();
    expect(server.requests).toHaveLength(2);
    expect(server.settings.lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-seattle" });
  });

  it("sends the newest state when a write fails while newer changes are queued", async () => {
    const { h, server } = setup();
    h.api.selectChatModel("claude");
    h.api.selectChatInstance("openclaw-hillsboro");
    server.requests[0].fail();
    await flush();
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body.lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro" });
    server.requests[1].respond();
    await flush();
    expect(server.settings.lastChatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro" });
  });

  it("applies the server reply after a plain save and leaves the chat selection alone", async () => {
    const { h, server } = setup({ rememberLastModel: false });
    h.set({ currentConversationId: "c1" });
    h.api.restoreConversationSelection("c1", false);
    h.api.selectChatInstance("openclaw-seattle");
    expect(server.requests).toHaveLength(0);
    const chat = clone(h.state().chatSelection);
    const record = clone(h.records().c1);
    h.api.refreshSettingsControls();
    h.dom.defaultModelSelect.value = "claude";
    h.api.saveSettingsFromUi(true);
    server.requests[0].respond();
    await flush();
    expect(h.settings()).toMatchObject({ defaultModel: "claude", fallbackModels: ["claude"], version: server.version });
    expect(h.state().chatSelection).toEqual(chat);
    expect(h.records().c1).toEqual(record);
    expect(h.dom.settingsSyncStatus.textContent).toBe("Synced");
  });
});
