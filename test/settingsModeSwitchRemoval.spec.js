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
  it("keeps the modern settings layout without the classic/modern switch", () => {
    const page = htmlPage();
    const settingsMarkup = page.slice(page.indexOf('<div id="settingsModal"'), page.indexOf('id="settingsSyncStatus"'));
    expect(settingsMarkup).toContain("模型设置中心");
    expect(settingsMarkup).toMatch(/<label class="settingsField">\s*默认模型\s*<select id="defaultModelSelect"><\/select>/);
    expect(settingsMarkup).toMatch(/<input id="rememberLastModelCheck" type="checkbox" \/>\s*记住上次选择/);
    for(const removed of ["data-settings-mode", "模型设置模式", "经典模式", "新模式", "新对话默认", "data-default-kind", "defaultInstanceSelect"]){
      expect(page).not.toContain(removed);
    }
  });

  it("keeps every settings control", () => {
    const page = htmlPage();
    for(const id of [
      "defaultModelSelect", "fallbackModelSelect", "fallbackModelNote", "autoArchiveDaysSelect", "rememberLastModelCheck",
      "fallbackEnabledCheck", "showPerMessageModelInfoCheck", "attachmentMaxFileMbInput", "modelHealthBtn", "providersList",
      "openClawInstancesSettings", "openClawInstancesList", "addOpenClawInstanceBtn", "applySettingsBtn", "saveSettingsBtn",
      "closeSettingsBtn"
    ]){
      expect(page).toContain('id="' + id + '"');
    }
  });

  it("initializes from legacy classic settings and lists only plain models", () => {
    const h = settingsHarness({ selectionMode: "classic", defaultModel: "claude", fallbackModels: ["sol"], rememberLastModel: true });
    expect(h.dom.defaultModelSelect.values).toEqual(["sol", "claude"]);
    expect(h.dom.defaultModelSelect.value).toBe("claude");
    expect(h.dom.fallbackModelSelect.values).toEqual(["", "sol", "claude"]);
    expect(h.dom.fallbackModelSelect.labels[0]).toBe("None（不使用 fallback）");
    expect(h.dom.rememberLastModelCheck.checked).toBe(true);
    expect(h.dom.modelProviderSelect.values).toEqual(["__workers__", "openai", "anthropic"]);
  });
});

describe("saving settings", () => {
  for(const closeAfter of [false, true]){
    it("leaves untouched values alone on " + (closeAfter ? "save" : "apply"), () => {
      const settings = {
        defaultModel: "openclaw-legacy/x",
        fallbackModels: ["openclaw-legacy/x", "sol", "claude"],
        rememberLastModel: true,
        lastModel: "claude",
        lastChatSelection: { kind: "model", modelId: "claude" },
        selectionMode: "classic",
        newModeTarget: "openclaw",
        openClawSelection: { instanceId: "openclaw-hillsboro", agentId: "glm", baseModelId: "" }
      };
      const h = settingsHarness(settings);
      h.dom.rememberLastModelCheck.checked = true;
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
      expect(saved.rememberLastModel).toBe(true);
      expect(saved.lastChatSelection).toEqual({ kind: "model", modelId: "claude" });
      expect(saved.lastModel).toBe("claude");
      expect(saved.selectionMode).toBe("classic");
      expect(saved.newModeTarget).toBe("openclaw");
      expect(saved.openClawSelection).toEqual({ instanceId: "openclaw-hillsboro", agentId: "glm", baseModelId: "" });
      expect(h.calls.closeSettings).toBe(closeAfter ? 1 : 0);
    });
  }

  it("forgets the remembered choice when 记住上次选择 is turned off", () => {
    const h = settingsHarness({ rememberLastModel: true, lastModel: "claude", lastChatSelection: { kind: "model", modelId: "claude" } });
    h.dom.rememberLastModelCheck.checked = false;
    h.api.saveSettingsFromUi(false);
    expect(h.settings().rememberLastModel).toBe(false);
    // null rather than a missing key so the server-side shallow merge drops it too.
    expect(h.settings().lastChatSelection).toBeNull();
    expect(h.settings().lastModel).toBe("");
    h.api.applyNewChatSelection();
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "sol" });
  });

  it("turning the option on keeps nothing stale and starts remembering from the next choice", () => {
    const h = settingsHarness({ rememberLastModel: false, defaultModel: "sol" });
    h.dom.rememberLastModelCheck.checked = true;
    h.api.saveSettingsFromUi(true);
    expect(h.settings().rememberLastModel).toBe(true);
    expect(h.settings().lastChatSelection ?? null).toBeNull();
    h.api.selectChatModel("claude");
    expect(h.settings().lastChatSelection).toMatchObject({ kind: "model", modelId: "claude" });
    expect(h.settings().defaultModel).toBe("sol");
  });

  it("does not change the current chat selection when settings are applied, saved or cancelled", () => {
    const h = settingsHarness({ defaultModel: "sol", rememberLastModel: true });
    h.api.selectChatInstance("openclaw-seattle");
    const chat = JSON.stringify(h.state().chatSelection);
    h.dom.defaultModelSelect.value = "claude";
    h.dom.rememberLastModelCheck.checked = false;
    h.api.saveSettingsFromUi(false);
    expect(JSON.stringify(h.state().chatSelection)).toBe(chat);
    h.api.saveSettingsFromUi(true);
    expect(JSON.stringify(h.state().chatSelection)).toBe(chat);
    h.set({ settingsSnapshot: { settings: JSON.parse(JSON.stringify(h.settings())), providers: h.state().modelProviders, categories: [] } });
    h.api.cancelSettings();
    expect(JSON.stringify(h.state().chatSelection)).toBe(chat);
    expect(h.settings().defaultModel).toBe("claude");
  });

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

  it("writes the default model only when the user changes it", () => {
    const h = settingsHarness({ defaultModel: "sol" });
    h.dom.defaultModelSelect.value = "claude";
    h.api.saveSettingsFromUi(false);
    expect(h.settings().defaultModel).toBe("claude");
    h.api.applyNewChatSelection();
    expect(h.state().chatSelection).toMatchObject({ kind: "model", modelId: "claude" });
  });
});
