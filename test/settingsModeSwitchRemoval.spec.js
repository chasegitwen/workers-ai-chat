import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import { createHarness, MODELS } from "./helpers/selectionHarness.js";

const models = [...MODELS, { id: "openclaw-legacy/x", provider: "openclaw-legacy", providerType: "openai-compatible" }];
const modern = MODELS;

function settingsHarness(settings, options = {}){
  const h = createHarness({ settings, ...options });
  h.set({ modelOptions: models, classicModelOptions: models, modernModelOptions: modern });
  h.api.applyNewChatSelection();
  h.api.refreshSettingsControls();
  return h;
}

describe("model settings center", () => {
  it("has no classic/modern switch and no 记住上次选择 option", () => {
    const page = htmlPage();
    const settingsMarkup = page.slice(page.indexOf('<div id="settingsModal"'), page.indexOf('id="settingsSyncStatus"'));
    expect(settingsMarkup).toContain("模型设置中心");
    expect(settingsMarkup).toContain("新对话默认");
    expect(settingsMarkup).toContain('data-default-kind="model">模型</button>');
    expect(settingsMarkup).toContain('data-default-kind="agent">Agent</button>');
    for(const removed of ["data-settings-mode", "模型设置模式", "经典模式", "新模式", 'id="rememberLastModelCheck"', "记住上次选择"]){
      expect(page).not.toContain(removed);
    }
  });

  it("keeps every other settings control", () => {
    const page = htmlPage();
    for(const id of [
      "defaultModelSelect", "defaultInstanceSelect", "defaultAgentSelect", "defaultBaseModelSelect",
      "fallbackModelSelect", "fallbackModelNote", "autoArchiveDaysSelect", "fallbackEnabledCheck",
      "showPerMessageModelInfoCheck", "modelHealthBtn", "providersList", "openClawInstancesSettings",
      "openClawInstancesList", "addOpenClawInstanceBtn", "applySettingsBtn", "saveSettingsBtn", "closeSettingsBtn"
    ]){
      expect(page).toContain('id="' + id + '"');
    }
  });

  it("initializes from legacy classic settings and lists only plain models", () => {
    const h = settingsHarness({ selectionMode: "classic", defaultModel: "claude", fallbackModels: ["sol"] });
    expect(h.dom.defaultModelSelect.values).toEqual(["sol", "claude"]);
    expect(h.dom.defaultModelSelect.value).toBe("claude");
    expect(h.dom.fallbackModelSelect.values).toEqual(["", "sol", "claude"]);
    expect(h.dom.fallbackModelSelect.labels[0]).toBe("None（不使用 fallback）");
    expect(h.dom.modelProviderSelect.values).toEqual(["__workers__", "openai", "anthropic"]);
    expect(h.dom.defaultModelField.hidden).toBe(false);
    expect(h.dom.defaultAgentFields.hidden).toBe(true);
  });

  it("derives an Agent default from legacy agent settings", () => {
    const h = settingsHarness({
      selectionMode: "modern", newModeTarget: "openclaw",
      openClawSelection: { instanceId: "openclaw-hillsboro", agentId: "glm", baseModelId: "" }
    });
    expect(h.dom.defaultAgentFields.hidden).toBe(false);
    expect(h.dom.defaultInstanceSelect.value).toBe("openclaw-hillsboro");
    expect(h.dom.defaultAgentSelect.value).toBe("glm");
    expect(h.dom.defaultBaseModelSelect.labels[0]).toBe("跟随 Agent 默认 · zai/glm-5.2");
    expect(h.dom.defaultBaseModelSelect.values).toEqual(["", "zai/glm-5.2"]);
  });
});

describe("saving the new-chat default", () => {
  for(const closeAfter of [false, true]){
    it("leaves untouched values alone on " + (closeAfter ? "save" : "apply"), () => {
      const settings = {
        defaultModel: "openclaw-legacy/x",
        fallbackModels: ["openclaw-legacy/x", "sol", "claude"],
        rememberLastModel: true,
        lastModel: "claude",
        selectionMode: "classic"
      };
      const h = settingsHarness(settings);
      expect(h.dom.defaultModelSelect.value).toBe("openclaw-legacy/x");
      expect(h.dom.defaultModelSelect.labels).toContain("不可用：openclaw-legacy/x");
      expect(h.dom.fallbackModelSelect.value).toBe("openclaw-legacy/x");
      expect(h.dom.fallbackModelSelect.labels).toContain("不可用：openclaw-legacy/x");
      expect(h.dom.fallbackModelNote.textContent).toContain("不可用，运行时不会使用");
      expect(h.dom.fallbackModelNote.textContent).toContain("已保存 3 个 fallback，运行时仅使用第一项。");
      h.api.saveSettingsFromUi(closeAfter);
      const saved = h.settings();
      expect(saved.defaultModel).toBe("openclaw-legacy/x");
      expect(saved.fallbackModels).toEqual(["openclaw-legacy/x", "sol", "claude"]);
      expect(saved).not.toHaveProperty("newChatDefault");
      expect(saved.selectionMode).toBe("classic");
      expect(saved.rememberLastModel).toBe(true);
      expect(saved.lastModel).toBe("claude");
      expect(h.calls.closeSettings).toBe(closeAfter ? 1 : 0);
    });
  }

  it("marks an unverified fallback as pending instead of unavailable", () => {
    const h = createHarness({ settings: { fallbackModels: ["sol"] }, modelsReady: false, models: [] });
    h.api.refreshSettingsControls();
    expect(h.dom.fallbackModelSelect.labels).toContain("待验证：sol");
    expect(h.dom.fallbackModelNote.textContent).toContain("暂未验证 fallback sol，保留原设置");
  });

  it("clears every fallback with None and replaces only the first entry otherwise", () => {
    const none = settingsHarness({ fallbackModels: ["openclaw-legacy/x", "sol", "claude"] });
    none.dom.fallbackModelSelect.value = "";
    none.api.saveSettingsFromUi(false);
    expect(none.settings().fallbackModels).toEqual([]);
    const replace = settingsHarness({ fallbackModels: ["openclaw-legacy/x", "sol", "claude"] });
    replace.dom.fallbackModelSelect.value = "claude";
    replace.api.saveSettingsFromUi(true);
    expect(replace.settings().fallbackModels).toEqual(["claude", "sol"]);
  });

  it("saves an Agent default with the instance default Agent and mirrors the legacy fields", () => {
    const h = settingsHarness({ defaultModel: "sol" }, { projectRuntimes: [{ runtime_id: "seattle-openclaw", default_agent_id: "ops" }] });
    const chatBefore = JSON.stringify(h.state().chatSelection);
    h.api.selectDefaultKind("agent");
    expect(h.state().settingsDefaultDraft).toMatchObject({ kind: "agent", instanceId: "openclaw-hillsboro", agentId: "main" });
    h.api.selectDefaultInstance("openclaw-seattle");
    expect(h.dom.defaultAgentSelect.value).toBe("ops");
    expect(h.dom.defaultBaseModelSelect.values).toEqual(["", "a/ops"]);
    h.api.selectDefaultBaseModel("a/ops");
    h.api.saveSettingsFromUi(true);
    const saved = h.settings();
    expect(saved.newChatDefault).toEqual({ kind: "agent", instanceId: "openclaw-seattle", agentId: "ops", baseModelId: "a/ops" });
    expect(saved.selectionMode).toBe("modern");
    expect(saved.newModeTarget).toBe("openclaw");
    expect(saved.openClawSelection).toEqual({ instanceId: "openclaw-seattle", agentId: "ops", baseModelId: "a/ops" });
    expect(saved.defaultModel).toBe("sol");
    expect(JSON.stringify(h.state().chatSelection)).toBe(chatBefore);
    h.api.applyNewChatSelection();
    expect(h.api.currentRequestSelection()).toMatchObject({ mode: "openclaw-agent", instanceId: "openclaw-seattle", agentId: "ops", baseModelId: "a/ops" });
  });

  it("resets the base model to follow the Agent when the default Agent changes", () => {
    const h = settingsHarness({ newChatDefault: { kind: "agent", instanceId: "openclaw-hillsboro", agentId: "main", baseModelId: "openai/gpt-5.6-sol" } });
    expect(h.dom.defaultBaseModelSelect.value).toBe("openai/gpt-5.6-sol");
    h.api.selectDefaultAgent("glm");
    expect(h.state().settingsDefaultDraft.baseModelId).toBe("");
    expect(h.dom.defaultBaseModelSelect.value).toBe("");
  });

  it("switches the default back to a model and writes the changed default model", () => {
    const h = settingsHarness({ newChatDefault: { kind: "agent", instanceId: "openclaw-hillsboro", agentId: "main", baseModelId: "" }, defaultModel: "sol" });
    h.api.selectDefaultKind("model");
    h.dom.defaultModelSelect.value = "claude";
    h.api.saveSettingsFromUi(false);
    expect(h.settings().newChatDefault).toEqual({ kind: "model", instanceId: "openclaw-hillsboro", agentId: "main", baseModelId: "" });
    expect(h.settings().newModeTarget).toBe("model");
    expect(h.settings().defaultModel).toBe("claude");
  });

  it("discards draft changes on cancel without touching the chat selection", () => {
    const h = settingsHarness({ defaultModel: "sol" });
    h.set({ settingsSnapshot: { settings: JSON.parse(JSON.stringify(h.settings())), providers: h.state().modelProviders, categories: [] } });
    h.api.selectChatModel("claude");
    h.api.selectDefaultKind("agent");
    h.api.cancelSettings();
    expect(h.settings()).not.toHaveProperty("newChatDefault");
    expect(h.state().settingsDefaultDraft.kind).toBe("model");
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    expect(h.calls.closeSettings).toBe(1);
  });
});
