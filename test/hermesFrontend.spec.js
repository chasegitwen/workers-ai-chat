import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import { element, lastDeclaration, pageScript } from "./helpers/selectionHarness.js";

// Runs the real (last-declared) Hermes page functions in a sandbox with stubbed DOM/fetch.

const HERMES_FUNCTIONS = [
  "hermesErrorText", "hermesCapabilitySectionText", "hermesProviders", "hermesProvider", "hermesSelectionBlockReason", "hermesHasPendingAttachments",
  "newHermesClientRequestId", "sendHermesMessage", "submitHermesBody", "hermesRunQuery", "stopHermesTracking",
  "trackHermesRun", "applyHermesRunUpdate", "hermesTerminalText", "handleHermesTerminal", "hermesRunModelText",
  "hermesTimelineEventKey", "mergeHermesTimeline", "hermesTimelineEntries", "hermesTimelineSummary", "hermesDurationText",
  "renderHermesTimeline", "renderHermesApproval", "renderHermesClarify", "renderHermesRunStatus", "setHermesPanelState", "observeHermesApproval", "setHermesSelectionActive", "syncModelModeUi", "isOpenClawAgentMode", "selectHermesProvider"
];

function catalog() {
  return {
    agents: [{ id: "hermes-agent", defaultModel: "gpt-5.6-luna", defaultProvider: "openai-codex" }],
    providers: [
      { id: "minimax", name: "MiniMax", selectable: true, models: [{ id: "MiniMax-M3" }] },
      { id: "anthropic", name: "Anthropic", selectable: false, models: [] }
    ],
    capabilities: { executionReady: true },
    syncedAt: 1
  };
}

function sandbox({ executionEnabled = true, attachments = false, extra = [] } = {}) {
  const script = pageScript();
  const fetches = [];
  const status = [];
  const polls = [];
  const functions = [...HERMES_FUNCTIONS, ...extra];
  const stored = new Map();
  const dom = {
    hermesKindBtn: element({ hidden: true }),
    hermesRouteControls: element({ hidden: true }),
    hermesRunMount: element({ hidden: true, appendChild(child) {
      this.children = this.children.filter(item => item !== child);
      this.children.push(child);
    } }),
    hermesRunStatus: element({ hidden: true }),
    hermesRunStatusText: element(),
    hermesRunCollapseBtn: element({ setAttribute(name, value) { this[name] = value; } }),
    hermesRunHideBtn: element(),
    hermesRunRestore: element({ hidden: true }),
    hermesApprovalPanel: element({ hidden: true }),
    hermesApprovalTool: element(),
    hermesApprovalCommand: element(),
    hermesApprovalTarget: element(),
    hermesApprovalRisk: element(),
    hermesClarifyPanel: element({ hidden: true }),
    hermesClarifyQuestion: element(),
    hermesClarifyAnswer: element({ value: "", focus() {} }),
    hermesClarifySubmit: element({ disabled: false }),
    hermesRunTimeline: element({ hidden: true, innerHTML: "", appendChild(child) { this.children.push(child); } }),
    hermesRunActions: element({ innerHTML: "", appendChild(child) { this.children.push(child); } }),
    modelSelectField: element(),
    openClawRouteControls: element({ hidden: true }),
    selectionKindSwitch: element({ children: ["model", "agent", "hermes"].map(kind => element({ dataset: { selectionKind: kind } })) }),
    input: { value: "What limits hunting speed?" },
    sendBtn: element()
  };
  Object.defineProperty(dom.hermesRunTimeline, "innerHTML", {
    get() { return this.html || ""; },
    set(value) { this.html = value; this.children = []; }
  });
  const chat = element({ appendChild(child) {
    this.children = this.children.filter(item => item !== child);
    this.children.push(child);
  } });
  Object.defineProperty(chat, "innerHTML", {
    get() { return this.html || ""; },
    set(value) { this.html = value; this.children = []; }
  });
  const stubs = {
    ...dom,
    chat,
    document: { createElement: tagName => element({ tagName, addEventListener() {}, appendChild(child) { this.children.push(child); } }) },
    localStorage: {
      getItem: key => stored.has(key) ? stored.get(key) : null,
      setItem: (key, value) => stored.set(key, String(value))
    },
    HERMES_PANEL_STORAGE_KEY: "wa_hermes_panel_state_v1",
    setContextStatus: text => status.push(text),
    syncOpenClawRouteControls() {},
    updateEffectiveModelResult() {},
    syncHermesRouteControls() {},
    refreshChatSelectionNotice() {},
    loadHermesCatalog() {},
    writeHermesSelection() {},
    pollHermesRun() { polls.push(1); },
    confirm: () => true,
    addUserMessage() {},
    addAIMessage: () => element(),
    renderAssistantMarkdown(view, text) { view.rendered = text; },
    resetInputHeight() {},
    setActiveConversation() {},
    loadConversations: async () => {},
    loadConversationMessages: async () => {},
    restoreHermesRunForConversation() {},
    startHermesEventStream() {},
    isSelectedOpenClawRequest: () => false,
    modelSelect: { value: "" },
    setInterval: () => 1,
    clearInterval() {},
    HERMES_STATUS_LABELS: { queued: "排队中", running: "执行中", waiting_for_clarification: "等待回答", stopping: "停止中", cancel_requested: "停止中（等待确认）", unknown: "状态未知", failed: "失败", cancelled: "已取消", completed: "已完成" },
    HERMES_ACTION_LABELS: {
      approve_once: "仅本次批准", deny: "拒绝", cancel: "取消任务", refresh: "刷新状态", dismiss: "停止查看"
    },
    HERMES_ACTION_CONFIRM: {},
    HERMES_ERROR_TEXT: { hermes_busy: "busy" },
    HERMES_POLL_MS: 4000,
    DEFAULT_PROJECT_ID: "default",
    fetch: async (url, init) => {
      fetches.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true, run: {
        id: "hrun_" + "1".repeat(32), conversationId: "conv-1", projectId: "proj-a", status: "queued", terminal: false,
        actions: ["refresh", "cancel"], modelMode: "agent_default"
      } }), { status: 202 });
    }
  };
  const state = {
    hermesSelectionActive: false,
    hermesCatalogState: { visible: true, executionEnabled, catalog: catalog(), instances: [], loading: false },
    hermesSelection: { instanceId: "oracle-hermes", agentId: "hermes-agent", providerId: "", modelId: "" },
    hermesActiveRun: null, hermesRunView: null, hermesStreamText: "", hermesEventSource: null, hermesPollTimer: null,
    hermesSubmitPending: null, hermesActionPending: false, hermesPanelState: "expanded", hermesPanelStateOverride: null, hermesLastApprovalRequestId: "", hermesLastClarifyRequestId: "", chatSelection: { kind: "agent" }, activeModelMode: "modern", activeNewModeTarget: "openclaw",
    activeProjectId: "proj-a", currentConversationId: null, conversation: [],
    selectedImage: null, pastedImageAttachments: attachments ? [{}] : [], selectedFile: null,
    pendingConversationAttachments: [], selectedFileIds: [], selectedWebPage: null
  };
  extra.forEach(name => { delete stubs[name]; });
  const names = Object.keys(state);
  const source = [
    "let " + names.join(", ") + ";",
    functions.map(name => lastDeclaration(script, name)).join("\n"),
    "function __set(v){ " + names.map(n => "if(n_has(v,'" + n + "')) " + n + " = v." + n + ";").join(" ") + " }",
    "function n_has(v,k){ return Object.prototype.hasOwnProperty.call(v,k); }",
    "function __get(){ return { " + names.join(", ") + " }; }",
    "return { " + functions.join(", ") + ", __set, __get };"
  ].join("\n");
  const api = new Function(...Object.keys(stubs), source)(...Object.values(stubs));
  api.__set(state);
  return { api, dom, fetches, status, polls, stored, chat };
}

describe("Hermes frontend", () => {
  it("ships the Hermes target hidden by default with TDZ-safe state", () => {
    const html = htmlPage();
    expect(html).toContain('id="hermesKindBtn" data-selection-kind="hermes" hidden');
    expect(html).toContain('id="hermesRouteControls" class="openClawRouteControls" hidden');
    expect(html).toContain('id="hermesCapabilitiesToggle"');
    expect(html).toContain('id="hermesCapabilitiesPanel" class="hermesCapabilitiesPanel" aria-label="Hermes 能力" hidden');
    expect(html).toContain('id="hermesEnvironmentInfo"');
    expect(html.indexOf('id="hermesCapabilitiesPanel"')).toBeGreaterThan(html.indexOf('id="hermesRouteControls"'));
    expect(html.indexOf('id="hermesCapabilitiesPanel"')).toBeLessThan(html.indexOf('id="chatSelectionNotice"'));
    expect(html).toContain('fetch("/api/hermes/capabilities-panel?" + params.toString())');
    expect(html).toContain('item.enabled === true ? "已启用" : (item.enabled === false ? "未启用" : "启用状态未知")');
    expect(html).toContain('" · 模型 " + (environment.model || "未确认")');
    expect(html).toContain('工作目录：8642 Runs API 未提供可确认或可选择的工作目录');
    expect(html).toContain('文件成果：8642 API 未提供可验证的成果列表或下载接口');
    expect(lastDeclaration(pageScript(), "loadHermesCapabilities")).toContain("hermesCapabilitiesState.data = null");
    expect(html.indexOf('id="hermesRunMount"')).toBeGreaterThan(html.indexOf('class="inputBar"'));
    expect(html.indexOf('id="hermesRunMount"')).toBeLessThan(html.indexOf('id="openClawTaskBanner"'));
    expect(html).toContain('id="hermesClarifyPanel" class="hermesClarifyPanel" hidden');
    expect(html).toContain('id="hermesClarifyAnswer" maxlength="32000"');
    expect(html).toContain('.hermesRunStatus[data-panel-state="expanded"]{max-height:min(40vh,360px);overflow:auto}');
    expect(html).toContain('.routeCatalogPicker{position:relative;min-width:0;font-size:max(16px,1rem)}');
    expect(html).toContain('.routeCatalogPicker .modelCatalogTrigger,.routeCatalogPicker .modelCatalogFilter,.routeCatalogPicker .modelCatalogOption,.routeCatalogPicker .modelCatalogEmpty{font-size:max(16px,1rem)}');
    const script = pageScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("var hermesSelectionActive = false;");
    expect(script).not.toMatch(/(?:let|const) hermesSelectionActive\b/);
    expect(lastDeclaration(script, "loadConversationMessages")).toContain("renderHermesRunStatus()");
    expect(script.split("function sendHermesMessage(").length).toBe(2);
    // Runtime type comes from the explicit selection, not from any domain inference.
    expect(lastDeclaration(script, "sendHermesMessage")).not.toContain("hnsnowground");
  });

  it("explains the known skills enumeration gap without changing other errors", () => {
    const { api } = sandbox();
    const known = { status: "error", items: [], error: {
      code: "hermes_upstream_error", upstreamStatus: 500,
      knownIssue: "hermes_skills_enumerate_v022",
      message: "Suspected Hermes upstream v0.22.x GET /v1/skills defect (HTTP 500)"
    } };
    expect(api.hermesCapabilitySectionText(known, "Skills")).toContain("疑似 Hermes 上游缺陷");
    expect(api.hermesCapabilitySectionText(known, "Skills")).toContain("不是 Worker/Access 鉴权失败");
    expect(api.hermesCapabilitySectionText(known, "Skills")).not.toContain("Toolsets 不受影响");
    expect(api.hermesCapabilitySectionText(known, "Toolsets")).toContain("加载失败");
    const other = { status: "error", items: [], error: {
      code: "hermes_upstream_error", upstreamStatus: 500, message: "skills storage unavailable"
    } };
    expect(api.hermesCapabilitySectionText(other, "Skills")).toContain("加载失败");
  });

  it("switches the selector to Hermes and hides model/OpenClaw controls", () => {
    const { api, dom } = sandbox();
    api.setHermesSelectionActive(true);
    expect(api.__get().hermesSelectionActive).toBe(true);
    expect(dom.hermesRouteControls.hidden).toBe(false);
    expect(dom.modelSelectField.hidden).toBe(true);
    expect(api.isOpenClawAgentMode()).toBe(false);
    const active = dom.selectionKindSwitch.children.filter(button => button.classList.contains("active"));
    expect(active.map(button => button.dataset.selectionKind)).toEqual(["hermes"]);
    api.setHermesSelectionActive(false);
    expect(dom.hermesRouteControls.hidden).toBe(true);
    expect(api.isOpenClawAgentMode()).toBe(true);
  });

  it("submits to /api/hermes/runs with the Agent default as no provider/model", async () => {
    const { api, fetches } = sandbox();
    api.setHermesSelectionActive(true);
    await api.sendHermesMessage();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("/api/hermes/runs");
    expect(fetches[0].body).toMatchObject({
      project_id: "proj-a", conversation_id: "", instance_id: "oracle-hermes", agent_id: "hermes-agent",
      provider: "", model: "", input: "What limits hunting speed?"
    });
    expect(fetches[0].body.client_request_id).toMatch(/^wa[A-Za-z0-9]{8,}$/);
    expect(api.__get().hermesActiveRun.id).toBe("hrun_" + "1".repeat(32));
    expect(api.__get().currentConversationId).toBe("conv-1");
  });

  it("sends an explicit provider/model and blocks unavailable or attachment requests", async () => {
    const explicit = sandbox();
    explicit.api.selectHermesProvider("minimax");
    await explicit.api.sendHermesMessage();
    expect(explicit.fetches[0].body).toMatchObject({ provider: "minimax", model: "MiniMax-M3" });

    const unavailable = sandbox();
    unavailable.api.__set({ hermesSelection: { instanceId: "oracle-hermes", agentId: "hermes-agent", providerId: "anthropic", modelId: "x" } });
    await unavailable.api.sendHermesMessage();
    expect(unavailable.fetches).toHaveLength(0);

    const withImage = sandbox({ attachments: true });
    await withImage.api.sendHermesMessage();
    expect(withImage.fetches).toHaveLength(0);
    expect(withImage.status.at(-1)).toContain("纯文本");

    const disabled = sandbox({ executionEnabled: false });
    await disabled.api.sendHermesMessage();
    expect(disabled.fetches).toHaveLength(0);
    expect(disabled.status.at(-1)).toBe("Hermes 执行功能未开启");
  });

  it("refuses a second submit while a run is active", async () => {
    const { api, fetches, status } = sandbox();
    api.__set({ hermesActiveRun: { id: "x", terminal: false } });
    await api.sendHermesMessage();
    expect(fetches).toHaveLength(0);
    expect(status.at(-1)).toContain("已有 Hermes 任务");
  });

  it("shows status, actual model and actions for the tracked run", () => {
    const { api, dom } = sandbox();
    api.__set({ hermesActiveRun: {
      id: "r", status: "completed", terminal: true, actualProvider: "minimax", actualModel: "MiniMax-M3", actions: []
    } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunStatus.hidden).toBe(false);
    expect(dom.hermesRunStatusText.textContent).toContain("已完成");
    expect(dom.hermesRunStatusText.textContent).toContain("minimax / MiniMax-M3");
    api.__set({ hermesActiveRun: { id: "r", status: "running", terminal: false, actions: ["refresh", "cancel"] } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunStatusText.textContent).toContain("Agent 默认模型");
    expect(dom.hermesRunActions.children.map(button => button.textContent)).toEqual(["刷新状态", "取消任务", "停止查看"]);
  });

  it("keeps a completed requested-model status mounted above the composer after the chat is wiped", () => {
    const { api, dom, chat } = sandbox();
    api.__set({ hermesActiveRun: {
      id: "r", status: "completed", terminal: true,
      requestedProvider: "zai", requestedModel: "glm-5.3", actions: [],
      timeline: [
        { event: "tool.started", seq: 1, tool: "terminal", preview: "pwd" },
        { event: "tool.completed", seq: 2, tool: "terminal", result: "C:/work", duration: 80, error: false }
      ]
    } });
    api.renderHermesRunStatus();
    chat.innerHTML = "<div id='searchResults'></div>";
    expect(chat.children).toEqual([]);
    expect(dom.hermesRunMount.hidden).toBe(false);
    expect(dom.hermesRunMount.children).toEqual([dom.hermesRunStatus, dom.hermesRunRestore]);
    expect(dom.hermesRunStatus.hidden).toBe(false);
    expect(dom.hermesRunStatusText.textContent).toContain("已完成");
    expect(dom.hermesRunStatusText.textContent).toContain("zai / glm-5.3（请求）");
    expect(dom.hermesRunTimeline.hidden).toBe(false);
    expect(dom.hermesRunTimeline.children[1].dataset.tone).toBe("success");
  });

  it("renders and deduplicates live tool/subagent details, and keeps them across snapshots", () => {
    const { api, dom } = sandbox({ extra: ["handleHermesStreamEvent"] });
    api.__set({ hermesActiveRun: { id: "r", status: "running", terminal: false, actions: [], timeline: [] } });
    const started = { event: "tool.started", seq: 10, tool: "terminal", preview: "git status" };
    api.handleHermesStreamEvent(started, null);
    api.handleHermesStreamEvent(started, null);
    api.handleHermesStreamEvent({ event: "tool.completed", seq: 11, tool: "terminal", result: "clean", duration: 120, error: false }, null);
    api.handleHermesStreamEvent({ event: "subagent.start", seq: 12, goal: "inspect tests", status: "running" }, null);
    api.handleHermesStreamEvent({ event: "subagent.complete", seq: 13, summary: "all good", duration: 300, status: "completed" }, null);
    expect(api.__get().hermesActiveRun.timeline).toHaveLength(4);
    expect(dom.hermesRunTimeline.hidden).toBe(false);
    expect(dom.hermesRunTimeline.children).toHaveLength(3);
    expect(dom.hermesRunTimeline.children[1].tagName).toBe("details");
    expect(dom.hermesRunTimeline.children[1].dataset.tone).toBe("success");
    expect(dom.hermesRunTimeline.children[2].dataset.tone).toBe("success");

    api.applyHermesRunUpdate({ id: "r", status: "running", terminal: false, actions: [], timeline: [started] });
    expect(api.__get().hermesActiveRun.timeline).toHaveLength(4);
    api.setHermesPanelState("collapsed");
    expect(dom.hermesRunStatusText.textContent).toContain("1 tools · last: 子代理");
  });

  it("keeps stopping, unknown, failed and cancelled visually distinct", () => {
    const { api, dom } = sandbox();
    api.__set({ hermesActiveRun: { id: "r", status: "cancel_requested", terminal: false, actions: [] } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunStatusText.textContent).toContain("停止中");
    expect(dom.hermesRunStatusText.textContent).not.toContain("已取消");
    expect(dom.hermesRunStatus.dataset.tone).toBe("warn");

    api.__set({ hermesActiveRun: { id: "r", status: "unknown", terminal: false, actions: [] } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunStatusText.textContent).toContain("状态未知");
    expect(dom.hermesRunStatus.dataset.tone).toBe("warn");

    api.__set({ hermesActiveRun: { id: "r", status: "failed", terminal: true, actions: [] } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunStatus.dataset.tone).toBe("error");

    api.__set({ hermesActiveRun: { id: "r", status: "cancelled", terminal: true, actions: [] } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunStatusText.textContent).toContain("已取消");
    expect(dom.hermesRunStatus.dataset.tone).toBe("");
  });

  it("renders the exact pending operation and only once/deny approval actions", () => {
    const { api, dom } = sandbox();
    api.__set({ hermesActiveRun: {
      id: "r", status: "waiting_for_approval", terminal: false,
      actions: ["approve_once", "deny", "refresh", "cancel"],
      approval: {
        requestId: "prompt-7", executionGeneration: 3, respondable: true,
        tool: "terminal", command: "ssh audit@hillsboro uptime", target: "hillsboro",
        risk: "Runs a remote command through the terminal tool"
      }
    } });
    api.renderHermesRunStatus();
    expect(dom.hermesApprovalPanel.hidden).toBe(false);
    expect(dom.hermesApprovalCommand.textContent).toBe("ssh audit@hillsboro uptime");
    expect(dom.hermesApprovalTarget.textContent).toBe("hillsboro");
    expect(dom.hermesApprovalRisk.textContent).toContain("remote command");
    expect(dom.hermesRunActions.children.map(button => button.textContent)).toEqual([
      "仅本次批准", "拒绝", "刷新状态", "取消任务", "停止查看"
    ]);
    expect(dom.hermesRunActions.children.map(button => button.textContent)).not.toContain("始终批准");
  });

  it("removes stale approval actions when the displayed approval is not respondable", () => {
    const { api, dom } = sandbox();
    api.__set({ hermesActiveRun: {
      id: "r", status: "waiting_for_approval", terminal: false,
      approval: { requestId: "old", executionGeneration: 1, respondable: false },
      actions: ["approve_once", "deny", "refresh", "cancel"]
    } });
    api.renderHermesRunStatus();
    expect(dom.hermesApprovalPanel.hidden).toBe(false);
    expect(dom.hermesRunActions.children.map(button => button.textContent)).toEqual([
      "刷新状态", "取消任务", "停止查看"
    ]);
  });

  it("renders Clarify as a separate answer card and never mixes in approval actions", () => {
    const { api, dom } = sandbox();
    api.__set({ hermesActiveRun: {
      id: "r", status: "waiting_for_clarification", terminal: false,
      clarify: {
        kind: "clarify", status: "pending", requestId: "clarify-7", executionGeneration: 4,
        question: "使用满载还是空载工况？", respondable: true, responding: false
      },
      approval: null,
      actions: ["answer_clarify", "refresh", "cancel"]
    } });
    api.renderHermesRunStatus();
    expect(dom.hermesClarifyPanel.hidden).toBe(false);
    expect(dom.hermesClarifyQuestion.textContent).toBe("使用满载还是空载工况？");
    expect(dom.hermesApprovalPanel.hidden).toBe(true);
    expect(dom.hermesClarifySubmit.disabled).toBe(false);
    expect(dom.hermesRunActions.children.map(button => button.textContent)).toEqual([
      "刷新状态", "取消任务", "停止查看"
    ]);
  });

  it("submits the exact Clarify identity and answer only through the Worker route", async () => {
    const { api, dom, fetches } = sandbox({ extra: ["submitHermesClarify"] });
    api.__set({ hermesActiveRun: {
      id: "hrun_" + "4".repeat(32), projectId: "proj-a", status: "waiting_for_clarification", terminal: false,
      clarify: { kind: "clarify", requestId: "clarify-exact", executionGeneration: 11, respondable: true },
      actions: ["answer_clarify"]
    } });
    dom.hermesClarifyAnswer.value = "采用满载工况";
    await api.submitHermesClarify();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("/api/hermes/runs/hrun_" + "4".repeat(32) + "/clarify");
    expect(fetches[0].body).toEqual({
      project_id: "proj-a", request_id: "clarify-exact", execution_generation: 11, answer: "采用满载工况"
    });
    expect(fetches[0].init.headers).toEqual({ "Content-Type":"application/json; charset=utf-8" });
    expect(api.__get().hermesActionPending).toBe(false);
  });

  it("persists expanded, collapsed and hidden run-card states with a visible restore affordance", () => {
    const { api, dom, stored } = sandbox();
    api.__set({ hermesActiveRun: { id: "r", status: "running", terminal: false, actions: ["refresh"] } });
    api.renderHermesRunStatus();
    expect(dom.hermesRunMount.children).toEqual([dom.hermesRunStatus, dom.hermesRunRestore]);
    api.setHermesPanelState("collapsed");
    expect(dom.hermesRunStatus.dataset.panelState).toBe("collapsed");
    expect(dom.hermesRunStatus.hidden).toBe(false);
    expect(dom.hermesRunCollapseBtn.textContent).toBe("展开");
    api.setHermesPanelState("hidden");
    expect(dom.hermesRunStatus.hidden).toBe(true);
    expect(dom.hermesRunRestore.hidden).toBe(false);
    expect(stored.get("wa_hermes_panel_state_v1")).toBe("hidden");
    api.setHermesPanelState("expanded");
    expect(dom.hermesRunStatus.hidden).toBe(false);
    expect(dom.hermesRunRestore.hidden).toBe(true);
  });

  it("temporarily expands the card for each new approval request without changing the saved preference", () => {
    const { api, dom, stored } = sandbox();
    api.__set({
      hermesActiveRun: { id: "r", status: "running", terminal: false, actions: ["refresh"] },
      hermesPollTimer: 1
    });
    api.setHermesPanelState("hidden");
    api.applyHermesRunUpdate({
      id: "r", status: "waiting_for_approval", terminal: false,
      approval: { requestId: "prompt-new", executionGeneration: 2, respondable: true },
      actions: ["approve_once", "deny"]
    });
    expect(dom.hermesRunStatus.hidden).toBe(false);
    expect(dom.hermesRunStatus.dataset.panelState).toBe("expanded");
    expect(stored.get("wa_hermes_panel_state_v1")).toBe("hidden");

    api.setHermesPanelState("collapsed");
    expect(dom.hermesRunStatus.dataset.panelState).toBe("collapsed");
    expect(stored.get("wa_hermes_panel_state_v1")).toBe("collapsed");
  });

  it("ships persisted desktop sidebar modes and a mobile drawer instead of hiding navigation", () => {
    const html = htmlPage();
    expect(html).toContain('const SIDEBAR_MODE_STORAGE_KEY = "wa_sidebar_mode_v1"');
    expect(html).toContain('.main[data-sidebar-mode="rail"]');
    expect(html).toContain('grid-template-columns:52px minmax(0,1fr)');
    expect(html).toContain('id="sidebarRailNew"');
    expect(html).toContain('id="sidebarRailSearch"');
    expect(html).toContain('id="sidebarRailSessions"');
    expect(html).toContain('.main.sidebarDrawerOpen .sidebar');
    expect(html).toContain('sidebarBackdrop?.addEventListener("click", () => setSidebarDrawerOpen(false))');
    const openSidebarSection = html.match(/function openSidebarSection\(focusSearch\)\{([\s\S]*?)\n\}/)?.[1] || "";
    expect(openSidebarSection).toContain('mainLayout.dataset.sidebarMode = "expanded"');
    expect(openSidebarSection).not.toContain('setSidebarMode("expanded")');
    expect(openSidebarSection).not.toContain("localStorage");
    expect(html).toContain('if(mainSidebar?.contains(event.relatedTarget)) return');
    expect(html).toContain('chatSearchInput.addEventListener("blur", closeSidebarPeekOnSearchBlur)');
    expect(html).not.toContain('@media(max-width:800px){\n\n  .main{\n    grid-template-columns:1fr;\n    min-height:0;\n  }\n\n  .main.contextPanelOpen{\n    grid-template-columns:1fr;\n  }\n\n  .sidebar{\n    display:none;');
  });

  it("forwards the displayed approval identity and only the explicit once choice", async () => {
    const { api, fetches } = sandbox({ extra: ["hermesRunAction"] });
    api.__set({ hermesActiveRun: {
      id: "hrun_" + "3".repeat(32), projectId: "proj-a", status: "waiting_for_approval", terminal: false,
      approval: { requestId: "prompt-exact", executionGeneration: 9, respondable: true },
      actions: ["approve_once", "deny"]
    } });
    await api.hermesRunAction("approve_once");
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toContain("/approval");
    expect(fetches[0].body).toEqual({
      project_id: "proj-a", request_id: "prompt-exact", execution_generation: 9, choice: "once"
    });
    expect(api.__get().hermesActionPending).toBe(false);
  });

  it("has no abandon/slot-release action in the page", () => {
    const script = pageScript();
    expect(script).not.toMatch(/abandon:/);
    expect(script).not.toContain("/abandon");
  });

  it("closes the stream and re-reads state via GET on stream_closed or error, without reopening", () => {
    const sources = [];
    class FakeEventSource {
      constructor(url) { this.url = url; this.closed = false; sources.push(this); }
      close() { this.closed = true; }
    }
    const { api, polls } = sandbox({ extra: ["startHermesEventStream", "closeHermesEventStream", "handleHermesStreamEvent"] });
    globalThis.EventSource = FakeEventSource;
    try {
      const run = { id: "hrun_" + "2".repeat(32), projectId: "proj-a", upstreamRunId: "run_x", status: "running", terminal: false };
      api.__set({ hermesActiveRun: run });
      api.startHermesEventStream(run);
      expect(sources).toHaveLength(1);
      expect(sources[0].url).toBe("/api/hermes/runs/" + run.id + "/events?project_id=proj-a");
      sources[0].onmessage({ data: JSON.stringify({ event: "hermes.stream_closed", terminal: false }) });
      expect(sources[0].closed).toBe(true);
      expect(polls).toHaveLength(1);
      expect(api.__get().hermesEventSource).toBeNull();

      api.startHermesEventStream(run);
      sources[1].onerror();
      expect(sources[1].closed).toBe(true);
      expect(polls).toHaveLength(2);
      expect(sources).toHaveLength(2);
    } finally {
      delete globalThis.EventSource;
    }
  });

  it("stops viewing a run locally without calling the server", async () => {
    const { api, fetches, dom } = sandbox({ extra: ["hermesRunAction"] });
    api.__set({ hermesActiveRun: { id: "r", status: "submission_unknown", terminal: false, actions: [] } });
    await api.hermesRunAction("dismiss");
    expect(fetches).toHaveLength(0);
    expect(api.__get().hermesActiveRun).toBeNull();
    expect(dom.hermesRunStatus.hidden).toBe(true);
    await api.hermesRunAction("abandon");
    expect(fetches).toHaveLength(0);
  });

  it("explains an upstream cancellation that the user did not request", () => {
    const { api } = sandbox();
    expect(api.hermesTerminalText({ status: "cancelled", statusDetail: "cancelled_upstream_without_request" })).toContain("并非由你发起");
    expect(api.hermesTerminalText({ status: "interrupted" })).toContain("未自动重试");
  });
});
