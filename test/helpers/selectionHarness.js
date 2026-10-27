import { htmlPage } from "../../src/frontend/page.js";

// Runs the effective (last-declared) chat-selection and settings functions from the page script
// against a small fake DOM, so tests can drive real state transitions and request construction.

export function pageScript(){
  return htmlPage().match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
}

export function lastDeclaration(script, name){
  const matches = [...script.matchAll(new RegExp("\\n(?:async )?function " + name + "\\([\\s\\S]*?\\n\\}", "g"))];
  const source = matches.at(-1)?.[0] || "";
  if(!source) throw new Error("declaration not found: " + name);
  return source;
}

function constValue(script, name){
  const match = script.match(new RegExp("const " + name + " = ([^;]+);"));
  if(!match) throw new Error("const not found: " + name);
  return match[1];
}

function classList(){
  const set = new Set();
  return {
    toggle(name, force){
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if(on) set.add(name); else set.delete(name);
      return on;
    },
    add: name => set.add(name),
    remove: name => set.delete(name),
    contains: name => set.has(name)
  };
}

export function element(extra = {}){
  return { hidden: false, disabled: false, textContent: "", dataset: {}, classList: classList(), children: [],
    querySelectorAll(){ return this.children; }, ...extra };
}

function switchElement(attribute, values){
  return element({ children: values.map(value => element({ dataset: { [attribute]: value } })) });
}

export class FakeOption {
  constructor(){
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.parent = null;
  }
  remove(){
    this.parent?.removeOption(this);
  }
}

// Mimics a single-select: the first option is selected by default; unknown values select nothing.
export class FakeSelect {
  constructor(){
    this.options = [];
    this.index = -1;
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
  }
  set innerHTML(_value){
    this.options = [];
    this.index = -1;
  }
  appendChild(option){
    option.parent = this;
    this.options.push(option);
    if(this.index < 0) this.index = 0;
  }
  removeOption(option){
    const selected = this.options[this.index];
    this.options = this.options.filter(item => item !== option);
    this.index = selected === option ? (this.options.length ? 0 : -1) : this.options.indexOf(selected);
  }
  get value(){
    return this.options[this.index]?.value ?? "";
  }
  set value(next){
    this.index = this.options.findIndex(option => option.value === next);
  }
  querySelectorAll(selector){
    return selector === "option[data-unavailable]" ? this.options.filter(option => option.dataset.unavailable) : [];
  }
  get values(){
    return this.options.map(option => option.value);
  }
  get labels(){
    return this.options.map(option => option.textContent);
  }
}

export function memoryStorage(seed = {}){
  const map = new Map(Object.entries(seed));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    keys: () => [...map.keys()]
  };
}

const FUNCTIONS = [
  "normalizeChatSelection", "newChatDefaultSelection", "sameNewChatDefault", "openClawAgentsForInstance",
  "canonicalOpenClawAgentId", "defaultOpenClawAgentId", "openClawSelectableModels", "followAgentDefaultLabel",
  "validateChatSelection", "chatSelectionContext", "chatSelectionBlockReason", "fallbackModelForRequest",
  "fallbackModelNoteText", "readConversationSelections", "readConversationSelection", "writeConversationSelection",
  "newChatSelection", "syncChatModelSelect", "syncChatSelectionUi", "applyChatSelection", "applyNewChatSelection",
  "restoreConversationSelection", "bindChatSelectionToConversation", "rememberRecentChatSelection",
  "commitChatSelection", "setChatSelectionKind", "selectChatModel", "selectChatInstance", "selectChatAgent",
  "selectChatBaseModel", "toggleOpenClawBasePicker", "confirmChatSelection", "refreshChatSelectionNotice",
  "syncModelModeUi", "fillSelectionSelect", "ensureOpenClawCatalogForInstance", "syncOpenClawRouteControls",
  "updateEffectiveModelResult", "fillOpenClawSelect", "openClawModelsForAgent", "normalizeHillsboroAgentId",
  "isOpenClawAgentMode", "currentOpenClawSelection", "currentRequestSelection", "openClawInstances",
  "openClawInstance", "openClawCarrierModel", "openClawCatalogForInstance", "openClawCatalogStateForInstance",
  "effectiveOpenClawBaseModel", "hasModernModel", "isOpenClawModelTarget", "renderSettingsDefaultControls",
  "selectDefaultKind", "selectDefaultInstance", "selectDefaultAgent", "selectDefaultBaseModel",
  "refreshSettingsControls", "saveSettingsFromUi", "persistSettings", "cancelSettings"
];

const STATE = [
  "chatSelection", "chatSelectionConfirmed", "chatSelectionConversationId", "chatSelectionAutoAgent",
  "openClawBasePickerOpen", "recentChatModelId", "recentChatAgentSelection", "settingsDefaultDraft",
  "settingsDefaultBaseline", "settingsModelSelectBaseline", "activeModelMode", "activeNewModeTarget",
  "modelCatalogReady", "currentConversationId", "modelSettingsState", "modelOptions", "classicModelOptions",
  "modernModelOptions", "modelProviders", "modelCategories", "settingsSnapshot", "seattleOpenClawCatalog",
  "hillsboroOpenClawCatalog", "oracleOpenClawCatalog", "seattleOpenClawCatalogState",
  "hillsboroOpenClawCatalogState", "oracleOpenClawCatalogState", "projectOpenClawRuntimes"
];

export const MODELS = [
  { id: "sol", label: "GPT-5.6 Sol", provider: "openai", providerLabel: "OpenAI", providerType: "openai-compatible" },
  { id: "claude", label: "Claude", provider: "anthropic", providerLabel: "Anthropic", providerType: "claude-compatible" }
];

export const INSTANCES = [
  { id: "openclaw-hillsboro", label: "Hillsboro", connectionId: "openclaw-hillsboro", catalogId: "hillsboro", runtimeId: "hillsboro-openclaw" },
  { id: "openclaw-seattle", label: "Seattle", connectionId: "openclaw-seattle", catalogId: "seattle", runtimeId: "seattle-openclaw" }
];

export const PROVIDERS = [
  { id: "openai", providerType: "openai-compatible", models: [MODELS[0]] },
  { id: "anthropic", providerType: "claude-compatible", models: [MODELS[1]] },
  { id: "openclaw-hillsboro", providerType: "openai-compatible", models: [{ id: "hb-carrier", modelName: "openclaw/main" }] },
  { id: "openclaw-seattle", providerType: "openai-compatible", models: [{ id: "sea-carrier", modelName: "openclaw/main" }] }
];

export const HILLSBORO_CATALOG = {
  providerId: "openclaw-hillsboro",
  agents: [{ id: "main", defaultModel: "openai/gpt-5.6-terra" }, { id: "glm", defaultModel: "zai/glm-5.2" }],
  modelsByAgent: {
    main: [{ id: "openai/gpt-5.6-terra" }, { id: "openai/gpt-5.6-sol" }, { id: "openai/off", available: false }],
    glm: [{ id: "zai/glm-5.2" }]
  }
};

export const SEATTLE_CATALOG = {
  providerId: "openclaw-seattle",
  agents: [{ id: "ops", defaultModel: "a/ops" }, { id: "main", defaultModel: "a/main" }],
  modelsByAgent: { ops: [{ id: "a/ops" }], main: [{ id: "a/main" }] }
};

export function createHarness({
  settings = {},
  models = MODELS,
  instances = INSTANCES,
  providers = PROVIDERS,
  catalogs = { hillsboro: HILLSBORO_CATALOG, seattle: SEATTLE_CATALOG },
  storage = memoryStorage(),
  modelsReady = true,
  projectRuntimes = []
} = {}){
  const script = pageScript();
  const calls = { syncSettingsToServer: 0, writeSettingsCache: 0, loadOpenClawCatalog: [], closeSettings: 0 };
  const dom = {
    modelSelect: new FakeSelect(),
    modelSelectField: element(),
    selectionKindSwitch: switchElement("selectionKind", ["model", "agent"]),
    openClawRouteControls: element({ hidden: true }),
    openClawProviderSelect: new FakeSelect(),
    openClawAgentSelect: new FakeSelect(),
    openClawBaseModelSelect: new FakeSelect(),
    openClawBaseModelField: element({ hidden: true }),
    openClawBaseModelSummary: element(),
    openClawBaseModelChangeBtn: element(),
    openClawCatalogRefresh: element(),
    openClawCatalogStatus: element(),
    effectiveModelResult: element(),
    chatSelectionNotice: element({ hidden: true }),
    chatSelectionNoticeText: element(),
    chatSelectionConfirmBtn: element({ hidden: true }),
    settingsModal: { querySelector: () => ({ scrollTop: 0 }) },
    defaultModelSelect: new FakeSelect(),
    fallbackModelSelect: new FakeSelect(),
    fallbackModelNote: element(),
    defaultSelectionKindSwitch: switchElement("defaultKind", ["model", "agent"]),
    defaultModelField: element(),
    defaultAgentFields: element({ hidden: true }),
    defaultInstanceSelect: new FakeSelect(),
    defaultAgentSelect: new FakeSelect(),
    defaultBaseModelSelect: new FakeSelect(),
    modelProviderSelect: new FakeSelect(),
    fallbackEnabledCheck: { checked: false },
    showPerMessageModelInfoCheck: { checked: false },
    autoArchiveDaysSelect: { value: "never" },
    settingsSyncStatus: element()
  };
  const stubs = {
    ...dom,
    document: { createElement: () => new FakeOption() },
    localStorage: storage,
    CONVERSATION_SELECTION_KEY: JSON.parse(constValue(script, "CONVERSATION_SELECTION_KEY")),
    CONVERSATION_SELECTION_LIMIT: Number(constValue(script, "CONVERSATION_SELECTION_LIMIT")),
    WORKERS_MODEL_PROVIDER_SELECT: "__workers__",
    normalizeOpenClawInstanceList: list => Array.isArray(list) ? list : [],
    getSelectedProviderForRequest: modelId => models.find(model => model.id === modelId)?.provider || "",
    syncOpenClawTaskVisibility: () => {},
    loadOpenClawCatalog: (force, catalogId) => { calls.loadOpenClawCatalog.push(catalogId); },
    categoryLabel: value => value,
    modelCategoryFromLegacy: model => model.providerType,
    setConversationAttachmentLimitInputs: () => {},
    readConversationAttachmentLimitInputs: () => settings.conversationAttachmentLimits,
    normalizeAutoArchiveDays: value => value,
    renderProvidersList: () => {},
    renderOpenClawInstancesList: () => {},
    syncCatalogFromCategories: () => {},
    writeSettingsCache: () => { calls.writeSettingsCache += 1; },
    syncSettingsToServer: () => { calls.syncSettingsToServer += 1; },
    closeSettings: () => { calls.closeSettings += 1; },
    clearProviderForm: () => {},
    clearModelForm: () => {},
    deepClone: value => JSON.parse(JSON.stringify(value)),
    categoriesToProviders: () => providers,
    // renderModelOptions only rebuilds the plain model list here; the real one ends by calling syncChatModelSelect.
    renderModelOptions: () => {}
  };
  const stubNames = Object.keys(stubs);
  const source = [
    "let " + STATE.join(", ") + ";",
    FUNCTIONS.map(name => lastDeclaration(script, name)).join("\n"),
    "function __get(){ return { " + STATE.join(", ") + " }; }",
    "function __set(values){ " + STATE.map(name => `if(Object.prototype.hasOwnProperty.call(values, "${name}")) ${name} = values.${name};`).join(" ") + " }",
    "renderModelOptions = function(){ modelSelect.innerHTML = ''; modelOptions.forEach(model => { const option = document.createElement('option'); option.value = model.id; modelSelect.appendChild(option); }); syncChatModelSelect(); };",
    "return { " + FUNCTIONS.join(", ") + ", __get, __set };"
  ].join("\n");
  const api = new Function(...stubNames, source)(...stubNames.map(name => stubs[name]));
  const modelSettingsState = {
    defaultModel: "sol",
    fallbackModels: [],
    openClawInstances: instances,
    ...settings
  };
  api.__set({
    chatSelection: { kind: "model", modelId: "", instanceId: "", agentId: "", baseModelId: "" },
    chatSelectionConfirmed: true,
    chatSelectionConversationId: null,
    chatSelectionAutoAgent: false,
    openClawBasePickerOpen: false,
    recentChatModelId: "",
    recentChatAgentSelection: null,
    activeModelMode: "modern",
    activeNewModeTarget: "model",
    modelCatalogReady: modelsReady,
    currentConversationId: null,
    modelSettingsState,
    modelOptions: models,
    classicModelOptions: models,
    modernModelOptions: models,
    modelProviders: providers,
    modelCategories: [],
    seattleOpenClawCatalog: catalogs.seattle || null,
    hillsboroOpenClawCatalog: catalogs.hillsboro || null,
    oracleOpenClawCatalog: catalogs.oracle || null,
    seattleOpenClawCatalogState: catalogs.seattle ? "ok" : "unavailable",
    hillsboroOpenClawCatalogState: catalogs.hillsboro ? "ok" : "unavailable",
    oracleOpenClawCatalogState: catalogs.oracle ? "ok" : "unavailable",
    projectOpenClawRuntimes: projectRuntimes
  });
  api.renderModelOptionsForTest = () => {
    dom.modelSelect.innerHTML = "";
    models.forEach(model => {
      const option = new FakeOption();
      option.value = model.id;
      dom.modelSelect.appendChild(option);
    });
  };
  api.renderModelOptionsForTest();
  return {
    api,
    dom,
    calls,
    storage,
    state: () => api.__get(),
    set: values => api.__set(values),
    settings: () => api.__get().modelSettingsState,
    records: () => JSON.parse(storage.getItem(stubs.CONVERSATION_SELECTION_KEY) || "{}")
  };
}
