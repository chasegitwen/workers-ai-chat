import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";

function pageScript(){
  return htmlPage().match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
}

function lastDeclaration(script, name){
  const matches = [...script.matchAll(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}", "g"))];
  return matches.at(-1)?.[0] || "";
}

function fakeSelect(){
  return {
    options: [],
    value: "",
    set innerHTML(_value){ this.options = []; },
    appendChild(option){ this.options.push(option); }
  };
}

// Runs the effective refreshSettingsControls/saveSettingsFromUi from the page script against stubs.
function settingsHarness({ activeModelMode, settings, models }){
  const script = pageScript();
  const source = [
    "let settingsModelSelectBaseline = null;",
    lastDeclaration(script, "hasClassicModel"),
    lastDeclaration(script, "hasModernModel"),
    lastDeclaration(script, "refreshSettingsControls"),
    lastDeclaration(script, "saveSettingsFromUi"),
    "return { refreshSettingsControls, saveSettingsFromUi };"
  ].join("\n");
  const isOpenClaw = model => String(model?.id || model?.provider || "").startsWith("openclaw-");
  const scope = {
    settingsModal: { querySelector: () => ({ scrollTop: 0 }) },
    defaultModelSelect: fakeSelect(),
    fallbackModelSelect: fakeSelect(),
    modelProviderSelect: fakeSelect(),
    rememberLastModelCheck: {},
    fallbackEnabledCheck: {},
    showPerMessageModelInfoCheck: {},
    autoArchiveDaysSelect: { value: "never" },
    normalizeAutoArchiveDays: value => value,
    readConversationAttachmentLimitInputs: () => settings.conversationAttachmentLimits,
    modelSelect: { value: "" },
    activeNewModeTarget: "model",
    currentOpenClawSelection: () => settings.openClawSelection,
    persistSettings: () => {},
    document: { createElement: () => ({ dataset: {} }) },
    categoryLabel: value => value,
    modelCategoryFromLegacy: model => model.providerType,
    setConversationAttachmentLimitInputs: () => {},
    WORKERS_MODEL_PROVIDER_SELECT: "__workers__",
    modelProviders: [
      { id: "claude", providerType: "claude-compatible" },
      { id: "openclaw-legacy", providerType: "openai-compatible" }
    ],
    isOpenClawModelTarget: isOpenClaw,
    renderProvidersList: () => {},
    renderOpenClawInstancesList: () => {},
    syncOpenClawTaskVisibility: () => {},
    activeModelMode,
    modelSettingsState: settings,
    classicModelOptions: models,
    modernModelOptions: models.filter(model => !isOpenClaw(model))
  };
  const names = Object.keys(scope);
  const fns = new Function(...names, source)(...names.map(name => scope[name]));
  fns.refreshSettingsControls();
  return { scope, save: fns.saveSettingsFromUi };
}

const models = [
  { id: "claude-a", providerType: "claude-compatible" },
  { id: "gpt-b", providerType: "openai-compatible" },
  { id: "openclaw-legacy/x", providerType: "openai-compatible" }
];

describe("model settings center mode switch removal", () => {
  it("no longer renders the classic/modern switch in the settings center", () => {
    const page = htmlPage();
    const settingsMarkup = page.slice(page.indexOf('<div id="settingsModal"'), page.indexOf('id="settingsSyncStatus"'));
    expect(settingsMarkup).toContain("模型设置中心");
    expect(page).not.toContain("data-settings-mode");
    expect(page).not.toContain("模型设置模式");
    expect(settingsMarkup).not.toContain("经典模式");
    expect(settingsMarkup).not.toContain("新模式");
    expect(page).not.toContain('.settingsModal:not([data-mode="modern"])');
    expect(page).not.toContain("settingsModal.dataset.mode");
    // The chat-page model picker switch is out of scope for this phase and must stay.
    expect(page).toContain('data-model-mode="classic"');
    expect(page).toContain('data-model-mode="modern"');
  });

  it("keeps every modern settings control", () => {
    const page = htmlPage();
    for(const id of [
      "defaultModelSelect", "fallbackModelSelect", "autoArchiveDaysSelect", "rememberLastModelCheck",
      "fallbackEnabledCheck", "showPerMessageModelInfoCheck", "modelHealthBtn", "providersList",
      "openClawInstancesSettings", "openClawInstancesList", "addOpenClawInstanceBtn",
      "applySettingsBtn", "saveSettingsBtn", "closeSettingsBtn"
    ]){
      expect(page).toContain('id="' + id + '"');
    }
  });

  it("initializes the modern settings view even when stored settings are classic", () => {
    const { scope } = settingsHarness({
      activeModelMode: "classic",
      settings: { selectionMode: "classic", defaultModel: "gpt-b", fallbackModels: ["claude-a"] },
      models
    });
    expect(scope.defaultModelSelect.options.map(option => option.value)).toEqual(["claude-a", "gpt-b"]);
    expect(scope.defaultModelSelect.value).toBe("gpt-b");
    expect(scope.fallbackModelSelect.value).toBe("claude-a");
    expect(scope.modelProviderSelect.options.map(option => option.value)).toEqual(["__workers__", "claude"]);
    expect(scope.activeModelMode).toBe("classic");
  });

  it("does not list classic-only models in the settings selects", () => {
    const { scope } = settingsHarness({
      activeModelMode: "classic",
      settings: { defaultModel: "openclaw-legacy/x", fallbackModels: ["openclaw-legacy/x"] },
      models
    });
    expect(scope.defaultModelSelect.options.map(option => option.value)).toEqual(["claude-a", "gpt-b"]);
    expect(scope.fallbackModelSelect.options.map(option => option.value)).toEqual(["", "claude-a", "gpt-b"]);
  });

  for(const closeAfter of [false, true]){
    it("keeps stored default and all fallbacks when saving untouched selects (" + (closeAfter ? "save" : "apply") + ")", () => {
      const settings = {
        defaultModel: "openclaw-legacy/x",
        fallbackModels: ["openclaw-legacy/x", "gpt-b", "claude-a"],
        rememberLastModel: true
      };
      const { scope, save } = settingsHarness({ activeModelMode: "modern", settings, models });
      expect(scope.defaultModelSelect.value).toBe("claude-a");
      save(closeAfter);
      expect(settings.defaultModel).toBe("openclaw-legacy/x");
      expect(settings.fallbackModels).toEqual(["openclaw-legacy/x", "gpt-b", "claude-a"]);
      expect(settings.lastModel).toBe("openclaw-legacy/x");
    });
  }

  it("keeps extra fallbacks when the visible ones are untouched", () => {
    const settings = { defaultModel: "claude-a", fallbackModels: ["gpt-b", "claude-a"] };
    const { save } = settingsHarness({ activeModelMode: "modern", settings, models });
    save(false);
    expect(settings.defaultModel).toBe("claude-a");
    expect(settings.fallbackModels).toEqual(["gpt-b", "claude-a"]);
  });

  it("writes the default and first fallback only when the user changes them", () => {
    const settings = { defaultModel: "openclaw-legacy/x", fallbackModels: ["openclaw-legacy/x", "claude-a"] };
    const { scope, save } = settingsHarness({ activeModelMode: "modern", settings, models });
    scope.defaultModelSelect.value = "gpt-b";
    scope.fallbackModelSelect.value = "claude-a";
    save(true);
    expect(settings.defaultModel).toBe("gpt-b");
    expect(settings.fallbackModels).toEqual(["claude-a"]);
    expect(scope.modelSelect.value).toBe("gpt-b");
  });

  it("replaces only the first fallback and drops duplicates when the user picks another model", () => {
    const settings = { defaultModel: "claude-a", fallbackModels: ["gpt-b", "claude-a", "openclaw-legacy/x"] };
    const { scope, save } = settingsHarness({ activeModelMode: "modern", settings, models });
    expect(scope.fallbackModelSelect.value).toBe("gpt-b");
    scope.fallbackModelSelect.value = "claude-a";
    save(false);
    expect(settings.fallbackModels).toEqual(["claude-a", "openclaw-legacy/x"]);
  });

  for(const closeAfter of [false, true]){
    it("clears every fallback when the user explicitly selects None (" + (closeAfter ? "save" : "apply") + ")", () => {
      const settings = {
        defaultModel: "claude-a",
        fallbackEnabled: true,
        fallbackModels: ["gpt-b", "claude-a", "openclaw-legacy/x"]
      };
      const { scope, save } = settingsHarness({ activeModelMode: "modern", settings, models });
      scope.fallbackEnabledCheck.checked = true;
      expect(scope.fallbackModelSelect.value).toBe("gpt-b");
      scope.fallbackModelSelect.value = "";
      save(closeAfter);
      expect(settings.fallbackModels).toEqual([]);
      expect(settings.defaultModel).toBe("claude-a");
      // None does not touch the automatic fallback checkbox.
      expect(settings.fallbackEnabled).toBe(true);
    });
  }
});
