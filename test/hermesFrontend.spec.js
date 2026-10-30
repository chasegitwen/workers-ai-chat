import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import { element, lastDeclaration, pageScript } from "./helpers/selectionHarness.js";

// Runs the real (last-declared) Hermes page functions in a sandbox with stubbed DOM/fetch.

const HERMES_FUNCTIONS = [
  "hermesErrorText", "hermesProviders", "hermesProvider", "hermesSelectionBlockReason", "hermesHasPendingAttachments",
  "newHermesClientRequestId", "sendHermesMessage", "submitHermesBody", "hermesRunQuery", "stopHermesTracking",
  "trackHermesRun", "applyHermesRunUpdate", "hermesTerminalText", "handleHermesTerminal", "hermesRunModelText",
  "renderHermesApproval", "renderHermesRunStatus", "setHermesSelectionActive", "syncModelModeUi", "isOpenClawAgentMode", "selectHermesProvider"
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
  const dom = {
    hermesKindBtn: element({ hidden: true }),
    hermesRouteControls: element({ hidden: true }),
    hermesRunStatus: element({ hidden: true }),
    hermesRunStatusText: element(),
    hermesApprovalPanel: element({ hidden: true }),
    hermesApprovalTool: element(),
    hermesApprovalCommand: element(),
    hermesApprovalTarget: element(),
    hermesApprovalRisk: element(),
    hermesRunActions: element({ innerHTML: "", appendChild(child) { this.children.push(child); } }),
    modelSelectField: element(),
    openClawRouteControls: element({ hidden: true }),
    selectionKindSwitch: element({ children: ["model", "agent", "hermes"].map(kind => element({ dataset: { selectionKind: kind } })) }),
    input: { value: "What limits hunting speed?" },
    sendBtn: element()
  };
  const stubs = {
    ...dom,
    document: { createElement: () => element({ addEventListener() {} }) },
    localStorage: { getItem: () => null, setItem() {} },
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
    HERMES_STATUS_LABELS: { queued: "排队中", running: "执行中", completed: "已完成" },
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
    hermesSubmitPending: null, hermesActionPending: false, chatSelection: { kind: "agent" }, activeModelMode: "modern", activeNewModeTarget: "openclaw",
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
  return { api, dom, fetches, status, polls };
}

describe("Hermes frontend", () => {
  it("ships the Hermes target hidden by default with TDZ-safe state", () => {
    const html = htmlPage();
    expect(html).toContain('id="hermesKindBtn" data-selection-kind="hermes" hidden');
    expect(html).toContain('id="hermesRouteControls" class="openClawRouteControls" hidden');
    const script = pageScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("var hermesSelectionActive = false;");
    expect(script).not.toMatch(/(?:let|const) hermesSelectionActive\b/);
    expect(script.split("function sendHermesMessage(").length).toBe(2);
    // Runtime type comes from the explicit selection, not from any domain inference.
    expect(lastDeclaration(script, "sendHermesMessage")).not.toContain("hnsnowground");
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
