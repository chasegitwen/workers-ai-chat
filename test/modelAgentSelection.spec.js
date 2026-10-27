import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import { createHarness, lastDeclaration, memoryStorage, pageScript } from "./helpers/selectionHarness.js";

const agentDefault = { newChatDefault: { kind: "agent", instanceId: "openclaw-hillsboro", agentId: "main", baseModelId: "" } };

describe("chat page: 当前使用 with 模型 / Agent", () => {
  it("renders only the 模型 / Agent entries and no mode concepts", () => {
    const page = htmlPage();
    const area = page.slice(page.indexOf('<div class="modelArea">'), page.indexOf('id="modelSettingsBtn"'));
    expect(area).toContain("当前使用");
    expect(area).toContain('data-selection-kind="model">模型</button>');
    expect(area).toContain('data-selection-kind="agent">Agent</button>');
    expect(area).toContain('id="openClawBaseModelChangeBtn" type="button">更改</button>');
    expect(area).toContain('<label id="openClawBaseModelField" hidden>');
    for(const removed of ["经典模式", "新模式", "模式切换", "data-model-mode", "data-new-mode-target"]){
      expect(page).not.toContain(removed);
    }
    expect(area).not.toContain("当前模型");
  });

  it("shows only the model picker for a plain model", () => {
    const h = createHarness({ settings: { defaultModel: "claude" } });
    h.api.applyNewChatSelection();
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    expect(h.dom.modelSelect.value).toBe("claude");
    expect(h.dom.modelSelectField.hidden).toBe(false);
    expect(h.dom.openClawRouteControls.hidden).toBe(true);
    expect(h.api.currentRequestSelection()).toMatchObject({ mode: "classic", modelId: "claude", agentId: "", baseModelId: "" });
  });

  it("shows instance, Agent and a collapsed base model that follows the Agent default", () => {
    const h = createHarness({ settings: agentDefault });
    h.api.applyNewChatSelection();
    expect(h.dom.modelSelectField.hidden).toBe(true);
    expect(h.dom.openClawRouteControls.hidden).toBe(false);
    expect(h.dom.openClawProviderSelect.value).toBe("openclaw-hillsboro");
    expect(h.dom.openClawAgentSelect.value).toBe("main");
    expect(h.dom.openClawBaseModelSummary.textContent).toBe("跟随 Agent 默认 · openai/gpt-5.6-terra");
    expect(h.dom.openClawBaseModelField.hidden).toBe(true);
    h.api.toggleOpenClawBasePicker();
    expect(h.dom.openClawBaseModelField.hidden).toBe(false);
    expect(h.dom.openClawBaseModelSelect.values).toEqual(["", "openai/gpt-5.6-terra", "openai/gpt-5.6-sol"]);
    expect(h.dom.effectiveModelResult.textContent).toContain("（Agent 默认）");
  });

  it("builds an Agent request without base_model_id while following the Agent default", () => {
    const h = createHarness({ settings: agentDefault });
    h.api.applyNewChatSelection();
    const selection = h.api.currentRequestSelection();
    expect(selection).toEqual({
      mode: "openclaw-agent", modelId: "hb-carrier", providerId: "openclaw-hillsboro",
      instanceId: "openclaw-hillsboro", agentId: "main", baseModelId: ""
    });
    const body = JSON.parse(JSON.stringify({ base_model_id: selection.baseModelId || undefined }));
    expect(body).not.toHaveProperty("base_model_id");
    expect(pageScript()).toContain("base_model_id:isOpenClawRequest ? requestSelection.baseModelId || undefined : undefined");
  });

  it("only offers base models from the current Agent and overrides just that Agent", () => {
    const h = createHarness({ settings: agentDefault });
    h.api.applyNewChatSelection();
    h.api.selectChatBaseModel("openai/gpt-5.6-sol");
    expect(h.api.currentRequestSelection().baseModelId).toBe("openai/gpt-5.6-sol");
    expect(h.dom.openClawBaseModelSummary.textContent).toBe("显式指定 · openai/gpt-5.6-sol");
    expect(h.dom.openClawBaseModelField.hidden).toBe(true);
    h.api.selectChatAgent("glm");
    expect(h.state().chatSelection).toMatchObject({ agentId: "glm", baseModelId: "" });
    expect(h.dom.openClawBaseModelSelect.values).toEqual(["", "zai/glm-5.2"]);
    expect(h.dom.openClawBaseModelSummary.textContent).toBe("跟随 Agent 默认 · zai/glm-5.2");
  });

  it("picks the instance default Agent and resets the base model when the instance changes", () => {
    const withBinding = createHarness({
      settings: agentDefault,
      projectRuntimes: [{ runtime_id: "seattle-openclaw", default_agent_id: "ops" }]
    });
    withBinding.api.applyNewChatSelection();
    withBinding.api.selectChatBaseModel("openai/gpt-5.6-sol");
    withBinding.api.selectChatInstance("openclaw-seattle");
    expect(withBinding.state().chatSelection).toEqual({
      kind: "agent", modelId: "", instanceId: "openclaw-seattle", agentId: "ops", baseModelId: ""
    });
    const plain = createHarness({ settings: agentDefault });
    plain.api.applyNewChatSelection();
    plain.api.selectChatInstance("openclaw-seattle");
    expect(plain.state().chatSelection.agentId).toBe("main");
  });

  it("waits for the catalog before choosing the default Agent of a new instance", () => {
    const h = createHarness({ settings: agentDefault, catalogs: { hillsboro: null, seattle: null } });
    h.api.applyNewChatSelection();
    h.api.selectChatInstance("openclaw-seattle");
    expect(h.calls.loadOpenClawCatalog).toContain("seattle");
    // Before the catalog arrives the configured carrier route is the only candidate.
    expect(h.state().chatSelection.agentId).toBe("main");
    h.set({ seattleOpenClawCatalog: { providerId: "openclaw-seattle", agents: [{ id: "ops" }], modelsByAgent: { ops: [] } } });
    h.api.syncOpenClawRouteControls();
    expect(h.state().chatSelection.agentId).toBe("ops");
  });

  it("restores the latest valid model and Agent when switching between the two entries", () => {
    const h = createHarness({ settings: { defaultModel: "sol" } });
    h.api.applyNewChatSelection();
    h.api.selectChatModel("claude");
    h.api.setChatSelectionKind("agent");
    expect(h.state().chatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro", agentId: "main" });
    h.api.selectChatAgent("glm");
    h.api.setChatSelectionKind("model");
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    h.api.setChatSelectionKind("agent");
    expect(h.state().chatSelection).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro", agentId: "glm", baseModelId: "" });
  });
});

describe("chat selection is isolated from the new-chat default", () => {
  it("never writes global settings when the chat selection changes", () => {
    const h = createHarness({ settings: { ...agentDefault, defaultModel: "sol", fallbackModels: ["claude"] } });
    const before = JSON.stringify(h.settings());
    h.set({ currentConversationId: "c1" });
    h.api.restoreConversationSelection("c1", false);
    h.api.selectChatInstance("openclaw-seattle");
    h.api.selectChatAgent("ops");
    h.api.setChatSelectionKind("model");
    h.api.selectChatModel("claude");
    expect(JSON.stringify(h.settings())).toBe(before);
    expect(h.calls.syncSettingsToServer).toBe(0);
    expect(h.calls.writeSettingsCache).toBe(0);
    expect(h.storage.keys()).toEqual(["wa_conversation_selection_v1"]);
    expect(h.records().c1).toMatchObject({ kind: "model", modelId: "claude" });
  });

  it("starts every new chat from the saved default, not from the last chat selection", () => {
    const h = createHarness({ settings: { defaultModel: "sol" } });
    h.api.applyNewChatSelection();
    h.api.setChatSelectionKind("agent");
    h.api.applyNewChatSelection();
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "sol" });
  });

  it("keeps each conversation's own selection when the global default changes", () => {
    const storage = memoryStorage();
    const h = createHarness({ storage, settings: { defaultModel: "sol" } });
    h.set({ currentConversationId: "c1" });
    h.api.restoreConversationSelection("c1", false);
    h.api.selectChatModel("claude");
    h.settings().defaultModel = "sol";
    h.settings().newChatDefault = agentDefault.newChatDefault;
    h.set({ chatSelectionConversationId: null });
    h.api.restoreConversationSelection("c1", true);
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    expect(h.state().chatSelectionConfirmed).toBe(true);
  });

  it("restores recorded selections after a page reload", () => {
    const storage = memoryStorage();
    const first = createHarness({ storage, settings: agentDefault });
    first.api.bindChatSelectionToConversation("c9", { kind: "agent", instanceId: "openclaw-seattle", agentId: "ops", baseModelId: "a/ops" });
    const reloaded = createHarness({ storage, settings: { defaultModel: "sol" } });
    reloaded.set({ currentConversationId: "c9" });
    reloaded.api.restoreConversationSelection("c9", true);
    expect(reloaded.api.currentRequestSelection()).toMatchObject({
      mode: "openclaw-agent", instanceId: "openclaw-seattle", agentId: "ops", baseModelId: "a/ops"
    });
    expect(reloaded.api.chatSelectionBlockReason()).toBe("");
  });

  it("binds the selection used for the first message to the new conversation id", () => {
    const script = pageScript();
    const send = lastDeclaration(script, "sendMessage");
    expect(send.indexOf("chatSelectionBlockReason()")).toBeGreaterThan(-1);
    expect(send.indexOf("chatSelectionBlockReason()")).toBeLessThan(send.indexOf("input.value.trim()"));
    expect(send).toContain("const sentChatSelection = normalizeChatSelection(chatSelection);");
    expect(send).toContain("bindChatSelectionToConversation(currentConversationId, sentChatSelection);");
    expect(lastDeclaration(script, "enterBlankChat")).toContain("applyNewChatSelection();");
    expect(lastDeclaration(script, "loadConversationMessages")).toContain("restoreConversationSelection(conversationId, (data.messages || []).length > 0);");
  });

  it("caps stored conversation selections and keeps only selection fields", () => {
    const h = createHarness();
    for(let index = 0; index < 505; index += 1){
      h.api.writeConversationSelection("c" + index, { kind: "model", modelId: "sol", content: "never stored" });
    }
    const records = h.records();
    expect(Object.keys(records)).toHaveLength(500);
    expect(Object.keys(records.c504).sort()).toEqual(["agentId", "baseModelId", "instanceId", "kind", "modelId", "updatedAt"]);
  });
});

describe("old conversations and unavailable selections", () => {
  it("asks to confirm a conversation without a local record and never sends the default silently", () => {
    const h = createHarness({ settings: { defaultModel: "sol" } });
    h.set({ currentConversationId: "old" });
    h.api.restoreConversationSelection("old", true);
    expect(h.state().chatSelectionConfirmed).toBe(false);
    expect(h.api.chatSelectionBlockReason()).toBe("此对话未记录原模型选择，请重新选择模型或 Agent");
    expect(h.dom.chatSelectionNotice.hidden).toBe(false);
    expect(h.dom.chatSelectionNoticeText.textContent).toContain("新对话默认");
    expect(h.dom.chatSelectionConfirmBtn.hidden).toBe(false);
    expect(h.records()).toEqual({});
    h.api.confirmChatSelection();
    expect(h.api.chatSelectionBlockReason()).toBe("");
    expect(h.records().old).toMatchObject({ kind: "model", modelId: "sol" });
  });

  it("treats a new empty conversation as a new chat", () => {
    const h = createHarness({ settings: { defaultModel: "claude" } });
    h.set({ currentConversationId: "fresh" });
    h.api.restoreConversationSelection("fresh", false);
    expect(h.state().chatSelectionConfirmed).toBe(true);
    expect(h.api.chatSelectionBlockReason()).toBe("");
  });

  it("keeps an unavailable recorded model visible and blocks sending until the user picks another", () => {
    const storage = memoryStorage({ wa_conversation_selection_v1: JSON.stringify({ c1: { kind: "model", modelId: "gone" } }) });
    const h = createHarness({ storage });
    h.set({ currentConversationId: "c1" });
    h.api.restoreConversationSelection("c1", true);
    expect(h.state().chatSelection.modelId).toBe("gone");
    expect(h.dom.modelSelect.value).toBe("gone");
    expect(h.dom.modelSelect.labels).toContain("不可用：gone");
    expect(h.api.chatSelectionBlockReason()).toBe("原模型或配置已不可用，请重新选择（模型 gone 已不可用）");
    expect(h.dom.chatSelectionConfirmBtn.hidden).toBe(true);
    expect(h.records().c1.modelId).toBe("gone");
    h.api.selectChatModel("sol");
    expect(h.api.chatSelectionBlockReason()).toBe("");
    expect(h.records().c1.modelId).toBe("sol");
  });

  it("does not treat a missing catalog as an unavailable Agent, and re-validates after the catalog loads", () => {
    const storage = memoryStorage({ wa_conversation_selection_v1: JSON.stringify({
      c1: { kind: "agent", instanceId: "openclaw-hillsboro", agentId: "retired", baseModelId: "" }
    }) });
    const h = createHarness({ storage, catalogs: { hillsboro: null, seattle: null } });
    h.set({ currentConversationId: "c1" });
    h.api.restoreConversationSelection("c1", true);
    expect(h.api.validateChatSelection(h.state().chatSelection, h.api.chatSelectionContext()).state).toBe("pending");
    expect(h.api.chatSelectionBlockReason()).toBe("");
    expect(h.dom.openClawAgentSelect.labels).toContain("待验证：retired");
    h.set({ hillsboroOpenClawCatalog: { providerId: "openclaw-hillsboro", agents: [{ id: "main" }], modelsByAgent: { main: [] } } });
    h.api.syncOpenClawRouteControls();
    expect(h.state().chatSelection.agentId).toBe("retired");
    expect(h.api.chatSelectionBlockReason()).toBe("原模型或配置已不可用，请重新选择（Agent retired 在 Hillsboro 中已不可用）");
    expect(h.dom.openClawAgentSelect.labels).toContain("不可用：retired");
    expect(h.records().c1.agentId).toBe("retired");
  });

  it("flags removed instances and base models outside the Agent catalog", () => {
    const h = createHarness();
    const context = h.api.chatSelectionContext();
    expect(h.api.validateChatSelection({ kind: "agent", instanceId: "openclaw-oracle", agentId: "main" }, context))
      .toEqual({ state: "invalid", message: "实例 openclaw-oracle 已不存在" });
    expect(h.api.validateChatSelection({ kind: "agent", instanceId: "openclaw-hillsboro", agentId: "glm", baseModelId: "openai/gpt-5.6-sol" }, context).state)
      .toBe("invalid");
    expect(h.api.validateChatSelection({ kind: "agent", instanceId: "openclaw-hillsboro", agentId: "main", baseModelId: "openai/off" }, context).state)
      .toBe("invalid");
    expect(h.api.validateChatSelection({ kind: "agent", instanceId: "openclaw-hillsboro", agentId: "glm51" }, context).state)
      .toBe("ok");
  });

  it("does not report a missing model before the model list loaded", () => {
    const h = createHarness({ modelsReady: false, models: [] });
    expect(h.api.validateChatSelection({ kind: "model", modelId: "sol" }, h.api.chatSelectionContext()).state).toBe("pending");
  });
});

describe("fallback validity", () => {
  it("sends the first fallback only while it is valid or not yet verifiable", () => {
    const h = createHarness();
    const ready = { modelsReady: true, hasModel: id => id === "sol" };
    expect(h.api.fallbackModelForRequest({ fallbackModels: ["sol", "claude"] }, ready)).toBe("sol");
    expect(h.api.fallbackModelForRequest({ fallbackModels: ["openclaw-legacy/x"] }, ready)).toBe("");
    expect(h.api.fallbackModelForRequest({ fallbackModels: ["openclaw-legacy/x"] }, { ...ready, modelsReady: false })).toBe("openclaw-legacy/x");
    expect(h.api.fallbackModelForRequest({ fallbackModels: [] }, ready)).toBe("");
    expect(lastDeclaration(pageScript(), "sendMessage"))
      .toContain("const fallbackModel = fallbackModelForRequest(modelSettingsState, chatSelectionContext());");
  });
});
