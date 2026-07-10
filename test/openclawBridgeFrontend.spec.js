import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import {
  applyOpenClawBridgeEventState,
  createOpenClawBridgeEventState
} from "../src/frontend/openclawBridgeEventState.js";

const fromCodePoints = (...codes) => String.fromCodePoint(...codes);
const mojibakeEmptyReply = fromCodePoints(0x5a0c, 0x2103, 0x6e41, 0x6769, 0x65bf, 0x6d16, 0x9350, 0x546d, 0xe190);
const mojibakeSecond = fromCodePoints(0x7ec9);

describe("OpenClaw bridge frontend SSE state", () => {
  it("ignores duplicate event_id values", () => {
    const state = createOpenClawBridgeEventState();
    const event = {
      event_id: "evt_duplicate",
      event_type: "bridge.activity",
      sequence: 1
    };

    expect(applyOpenClawBridgeEventState(state, event).accepted).toBe(true);
    expect(applyOpenClawBridgeEventState(state, event)).toMatchObject({
      accepted: false,
      reason: "duplicate"
    });
  });

  it("does not let old sequence events overwrite newer frontend state", () => {
    const state = createOpenClawBridgeEventState();

    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_new",
      event_type: "bridge.activity",
      sequence: 10
    }).accepted).toBe(true);
    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_old",
      event_type: "bridge.activity",
      sequence: 9
    })).toMatchObject({
      accepted: false,
      reason: "old_sequence"
    });
  });

  it("keeps final state from being overwritten by later activity", () => {
    const state = createOpenClawBridgeEventState();

    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_final",
      event_type: "bridge.final",
      sequence: 20
    }).accepted).toBe(true);
    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_late_activity",
      event_type: "bridge.activity",
      sequence: 21
    })).toMatchObject({
      accepted: false,
      reason: "after_final"
    });
  });

  it("keeps polling fallback wired when EventSource cannot be used or fails", () => {
    const page = htmlPage();

    expect(page).toContain("typeof EventSource === \"undefined\"");
    expect(page).toContain("startOpenClawReconnectPolling(taskId)");
    expect(page).toContain("openClawTaskScopeParams");
    expect(page).toContain("/api/openclaw/bridge/events/stream?\" + params.toString()");
    expect(page).toContain("params.set(\"project_id\", projectId)");
    expect(page).toContain("params.set(\"runtime_id\", runtimeId)");
    expect(page).toContain("OpenClaw remote task");
    expect(page).toContain("OpenClaw local task record");
    expect(page).toContain("Started: ");
    expect(page).toContain(" \u79d2\u524d");
    expect(page).not.toContain(mojibakeSecond);
    expect(page).toContain("View record");
    expect(page).toContain("Keep waiting");
    expect(page).toContain("Rerun");
    expect(page).toContain("Ignore");
  });

  it("keeps Bridge empty replies and elapsed seconds in UTF-8 Chinese", () => {
    const page = htmlPage();

    expect(page).toContain("\u6ca1\u6709\u8fd4\u56de\u5185\u5bb9");
    expect(page).toContain(" \u79d2\u524d");
    expect(page).not.toContain(mojibakeEmptyReply);
    expect(page).not.toContain(mojibakeSecond);
  });

  it("sends an explicit Seattle runtime_id when the selected OpenClaw model is Seattle", () => {
    const page = htmlPage();

    expect(page).toMatch(/function getOpenClawRuntimeIdForRequest\(modelId\)\{[\s\S]*?if\(values\.some\(value => value\.includes\("seattle"\)\)\)\{\s*return "seattle-openclaw";\s*\}/);
    expect(page).toMatch(/const selectedOpenClawRuntimeId = getOpenClawRuntimeIdForRequest\(modelSelect\.value\);[\s\S]*?runtime_id:selectedOpenClawRuntimeId \|\| undefined/);
    expect(page).not.toMatch(/runtime_id:"hillsboro-openclaw"/);
  });

  it("exposes compact workspace sidebar and scopes conversation requests by project_id", () => {
    const page = htmlPage();

    expect(page).not.toContain("id=\"commonChatsBtn\"");
    expect(page).not.toContain("id=\"projectSelect\"");
    expect(page).toContain("id=\"chatSearchInput\"");
    expect(page).toContain("placeholder=\"Search Chats\"");
    expect(page).toContain("id=\"projectList\"");
    expect(page).toContain("class=\"sidebarSectionHeader\">Chats</div>");
    expect(page).toContain("id=\"conversationList\"");
    expect(page).toMatch(/<div id="projectStatus" class="projectStatus"><\/div>[\s\S]*?<div class="sidebarSection chatsSection">/);
    expect(page).toMatch(/<\/aside>\s*<div id="projectSettingsPopover" class="projectSettingsPopover" hidden>/);
    expect(page).toContain("id=\"modelSelect\"");
    expect(page).toContain("id=\"modelSettingsBtn\"");
    expect(page).toContain("\u6a21\u578b\u8bbe\u7f6e\u4e2d\u5fc3");
    expect(page).toContain("\u5f53\u524d\u6a21\u578b");
    expect(page).toContain("\u6a21\u578b\u8bbe\u7f6e");
    expect(page).toContain("\u9ed8\u8ba4\u6a21\u578b");
    expect(page).toContain("\u6a21\u578b\u5065\u5eb7\u68c0\u67e5");
    expect(page).toContain("Claude \u517c\u5bb9");
    expect(page).toContain("OpenAI \u517c\u5bb9");
    expect(page).toContain("Workers \u6258\u7ba1");
    expect(page).toContain("closeSettingsBtn.textContent = \"X\"");
    expect(page).toContain("editDialogCloseBtn");
    expect(page).toContain(">X</button>");
    expect(page).toContain("button.textContent = \"...\"");
    expect(page).toContain("menuBtn.textContent = \"...\"");
    expect(page).not.toContain("button.textContent = \"Menu\"");
    expect(page).toMatch(/<div class="sidebarBadges">[\s\S]*?<\/div>\s*<div class="modelArea">/);
    expect(page).toMatch(/<div class="modelArea">[\s\S]*?<select[\s\S]*?id="modelSelect"[\s\S]*?<button id="modelSettingsBtn"/);
    expect(page).toContain("class=\"projectHeader\"");
    expect(page).toContain("aria-label=\"New Project\"");
    expect(page).toContain("selected_workspace");
    expect(page).toContain("expanded_project_ids");
    expect(page).toContain("workspaceKeyForProjectId");
    expect(page).toContain("projectIdFromWorkspaceKey");
    expect(page).toContain("project.id !== DEFAULT_PROJECT_ID && !project.is_default");
    expect(page).toContain("projectChevronBtn");
    expect(page).toContain("aria-expanded");
    expect(page).toContain("toggleProjectExpanded");
    expect(page).toContain("isProjectExpanded(project.id)");
    expect(page).toContain("setProjectExpanded(activeProjectId, true)");
    expect(page).toContain("projectNameBtn");
    expect(page).toContain("projectMenuBtn");
    expect(page).toContain("openProjectMenu");
    expect(page).toContain("projectActionMenu");
    expect(page).toContain("appendProjectMenuItem(menu, \"Rename\"");
    expect(page).toContain("appendProjectMenuItem(menu, \"New Chat\"");
    expect(page).toContain("appendProjectMenuItem(menu, \"Settings\"");
    expect(page).toContain("appendProjectMenuItem(menu, \"Delete\"");
    expect(page).not.toContain("Project action: rename, archive, delete");
    expect(page).not.toContain("prompt(");
    expect(page).toContain("if(isCommonWorkspace()){");
    expect(page).toContain("projectOpenClawRuntimes = [];");
    expect(page).toContain("persistActiveWorkspace(COMMON_WORKSPACE_KEY)");
    expect(page).toContain("fetch(\"/api/projects\"");
    expect(page).toContain("\"/openclaw-runtimes\"");
    expect(page).toContain("Project Settings");
    expect(page).not.toContain("id='projectSettingsBtn'");
    expect(page).toContain("id=\"projectSettingsPopover\"");
    expect(page).toContain("id=\"projectSettingsPopoverBody\"");
    expect(page).toContain("openProjectSettingsPopover");
    expect(page).toContain("openProjectSettingsForProject");
    expect(page).toContain("closeProjectSettingsPopover");
    expect(page).toContain("await switchProject(project.id)");
    expect(page).toContain("projectSettingsPopover.addEventListener(\"click\"");
    expect(page).toContain("projectSettingsPopover.addEventListener(\"change\"");
    expect(page).toContain("projectRuntimeSummary");
    expect(page).toContain("projectRuntimeDetails");
    expect(page).toContain("Variables");
    expect(page).toContain("Memory");
    expect(page).toContain("Knowledge Base");
    expect(page).toContain("Automation");
    expect(page).not.toContain("projectSettingsMount");
    expect(page).not.toContain("projectStatus.addEventListener(\"change\"");
    expect(page).not.toContain("projectStatus.addEventListener(\"click\"");
    expect(page).toContain("font-weight:700;");
    expect(page).toContain("font-weight:600;");
    expect(page).toContain("font-weight:400;");
    expect(page).toContain("String.fromCharCode(9662)");
    expect(page).toContain("String.fromCharCode(9656)");
    expect(page).toContain("fetchConversationsForProject(DEFAULT_PROJECT_ID)");
    expect(page).toContain("renderConversationRows(conversationList, commonConversations)");
    expect(page).toContain("conversationList.hidden = false");
    expect(page).toContain("applyChatSearchFilter");
    expect(page).toContain("runtimeCapabilityLabel");
    expect(page).toContain("renderRuntimeBinding");
    expect(page).toContain("runtimeCanBeBridgeDefault");
    expect(page).toContain("data-runtime-default=");
    expect(page).toContain("data-runtime-agent=");
    expect(page).toContain("Cannot set disabled, unverified, or Bridge-unsupported runtime as default.");
    expect(page).toContain("updateProjectRuntimeBinding");
    expect(page).toMatch(/async function createNewConversation\(\)\{\s*if\(!isCommonWorkspace\(\)\)\{\s*persistActiveWorkspace\(COMMON_WORKSPACE_KEY\);[\s\S]*?await createConversationForProject\(DEFAULT_PROJECT_ID\);/);
    expect(page).toContain("createConversationForProject(project.id)");
    expect(page).toContain("project_id:targetProjectId");
    expect(page).toContain("body:JSON.stringify({");
    expect(page).toContain("function getOpenClawRuntimeIdForRequest(modelId)");
    expect(page).toContain("return \"seattle-openclaw\";");
    expect(page).toContain("return \"hillsboro-openclaw\";");
    expect(page).toContain("const selectedOpenClawRuntimeId = getOpenClawRuntimeIdForRequest(modelSelect.value);");
    expect(page).toContain("runtime_id:selectedOpenClawRuntimeId || undefined");
    expect(page).toContain("method:\"DELETE\"");
    expect(page).toContain("Delete chat ");
    expect(page).toContain("Delete project ");
    expect(page).toContain("fetch(\"/api/conversations?\" + params.toString())");
    expect(page).toContain("async function loadConversations(options = {})");
    expect(page).toContain("const clearMissingCurrent = options.clearMissingCurrent !== false;");
    expect(page).toContain("if(clearMissingCurrent && currentConversationId && !conversationsCache.some(item => item.id === currentConversationId))");
    expect(page).toMatch(/webSearchContext = "";\s*webSearchSources = \[\];\s*await loadConversations\(\{\s*clearMissingCurrent:false\s*\}\);/);
    expect(page).toContain("if(isExpandedProject){");
    expect(page).toContain("document.getElementById(\"projectConversationMount\")");
    expect(page).toContain("if(projectMount){");
    expect(page).toContain("newChatBtn.addEventListener(\"click\", createNewConversation)");
  });

  it("exposes native attachment file mode controls and request fields", () => {
    const page = htmlPage();

    expect(page).toContain("fileModeSelector");
    expect(page).toContain("native_attachment");
    expect(page).toContain("currentRuntimeSupportsNativeAttachment");
    expect(page).toContain("fileContextMode:fileContextModeToSend");
    expect(page).toContain("attachmentFileIds:fileContextModeToSend === \"native_attachment\" ? selectedFileIds : undefined");
    expect(page).toContain("file:fileToSend && fileContextModeToSend !== \"native_attachment\"");
  });
});
