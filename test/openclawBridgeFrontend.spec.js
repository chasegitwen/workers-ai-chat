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

  it("keeps per-message model display behind a persisted setting and hides old messages without metadata", () => {
    const page = htmlPage();

    expect(page).toContain("id=\"showPerMessageModelInfoCheck\"");
    expect(page).toContain("showPerMessageModelInfo:Boolean(base.showPerMessageModelInfo)");
    expect(page).toContain("showPerMessageModelInfoCheck.checked = Boolean(modelSettingsState?.showPerMessageModelInfo);");
    expect(page).toContain("modelSettingsState.showPerMessageModelInfo = showPerMessageModelInfoCheck.checked;");
    expect(page).toContain(".messageModelInfo");
    expect(page).toContain("function normalizeMessageModelMetadata(metadata)");
    expect(page).toContain("if(!metadata || typeof metadata !== \"object\")");
    expect(page).toContain("function renderMessageModelInfo(element, metadata)");
    expect(page).toContain("if(!displayModelInfoEnabled())");
    expect(page).toContain("if(!text)");
    expect(page).toContain("renderMessageModelInfo(div, message.metadata);");
    expect(page).toContain("state.modelMetadata = doneEventModelMetadata(data);");
    expect(page).toContain("renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics, state.modelMetadata);");
    expect(page).toContain("metadata:streamResult.modelMetadata || null");
  });

  it("adds an archive sidebar UI without changing conversation APIs", () => {
    const page = htmlPage();

    expect(page).toMatch(/<div id="archivePanel" class="archivePanel">[\s\S]*?<button id="archiveToggleBtn"[\s\S]*?<span>Archive<\/span>[\s\S]*?<div id="archiveBody" class="archiveBody"><\/div>[\s\S]*?<div class="modelArea">/);
    expect(page).toContain("include_archived:\"1\"");
    expect(page).toContain("id=\"autoArchiveDaysSelect\"");
    expect(page).toContain("autoArchiveDays:normalizeAutoArchiveDays(base.autoArchiveDays)");
    expect(page).toContain("modelSettingsState.autoArchiveDays = normalizeAutoArchiveDays(autoArchiveDaysSelect.value);");
    expect(page).toContain("autoArchiveDaysSelect.value = normalizeAutoArchiveDays(modelSettingsState?.autoArchiveDays);");
    expect(page).toContain("function isConversationArchived(item)");
    expect(page).toContain("return Boolean(item.archived || item.is_archived || item.status === \"archived\");");
    expect(page).toContain("function visibleConversations(conversations)");
    expect(page).toContain("const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));");
    expect(page).toContain("function groupedArchiveConversations(conversations)");
    expect(page).toContain("function conversationArchivedAt(item)");
    expect(page).toContain("\"Today\"");
    expect(page).toContain("\"Yesterday\"");
    expect(page).toContain("\"Last 7 Days\"");
    expect(page).toContain("\"This Month\"");
    expect(page).toContain("\"Older...\"");
    expect(page).toContain("appendConversationMenuItem(menu, \"Restore\", () => restoreArchivedConversation(item.id));");
    expect(page).toContain("appendConversationMenuItem(menu, item.pinned ? \"Unpin\" : \"Pin\", () => togglePinnedConversation(item));");
    expect(page).toContain("appendConversationMenuItem(menu, \"Archive\", () => archiveConversation(item.id));");
    expect(page).toContain("appendConversationMenuItem(menu, \"Delete\", () => deleteConversation(item.id, item.title || \"New Chat\"));");
    expect(page).toContain("JSON.stringify({ action })");
    expect(page).toContain("await loadConversations({ clearMissingCurrent:false });");
    expect(page).toContain("pinMark.textContent = \"PIN\";");
    expect(page).toContain("row.addEventListener(\"contextmenu\"");
    expect(page).toContain("restoreConversationAfterNewMessage(currentConversationId);");
    expect(page).not.toContain("wa_archived_conversation_ids");
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
    expect(page).toContain("placeholder=\"Search Conversations\"");
    expect(page).toContain("id=\"projectList\"");
    expect(page).toContain("class=\"sidebarSectionHeader\">Conversations</div>");
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
    expect(page).toContain("await loadOpenClawRuntimeRegistry();");
    expect(page).toContain("openClawRuntimeRegistry = [];");
    expect(page).toContain("if(isCommonWorkspace()){");
    expect(page).toContain("const runtime = openClawRuntimeRegistry.find(item => item.id === runtimeId);");
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

  it("exposes conversation attachment controls and request fields", () => {
    const page = htmlPage();

    expect(page).not.toContain("fileModeSelector");
    expect(page).not.toContain("<span>阅读原文</span>");
    expect(page).not.toContain("<span>智能检索</span>");
    expect(page).toContain("conversationAttachmentList");
    expect(page).toContain("pendingConversationAttachments");
    expect(page).toContain("conversationAttachmentDraftId");
    expect(page).toContain("/api/conversation-attachments/upload");
    expect(page).toContain("conversationAttachmentIds:conversationAttachmentIdsToSend.length ? conversationAttachmentIdsToSend : undefined");
    expect(page).toContain("draftId:conversationAttachmentIdsToSend.length ? conversationAttachmentDraftId : undefined");
    expect(page).toContain("原文附件与知识库文件暂不能在同一条消息中同时使用。");
    expect(page).toContain("currentRuntimeSupportsNativeAttachment");
    expect(page).toContain("fileIds:retrievalFileIdsToSend.length ? retrievalFileIdsToSend : undefined");
    expect(page).toContain("clearSelectedFile();");
    expect(page).toContain("原文附件发送失败");
    expect(page).toContain("await attachFilesByUseMode(fileInput.files)");
    expect(page).toContain("inputShell?.addEventListener(\"drop\"");
    expect(page).toContain("handleConversationFilePaste(event)");
    expect(page).toContain("await handleImagePaste(event)");
    expect(page).toContain("!String(file.type || \"\").startsWith(\"image/\")");
  });

  it("keeps Cloudflare document attachment out of model settings and exposes file purpose controls", () => {
    const page = htmlPage();

    expect(page).not.toContain("newModelCloudflareDocumentAttachment");
    expect(page).not.toContain("editModelCloudflareDocumentAttachment");
    expect(page).not.toContain("Conversation Attachment: Cloudflare Document");
    expect(page).toContain("name=\"fileUseMode\"");
    expect(page).toContain("原文读取");
    expect(page).toContain("存入文件库");
    expect(page).toContain("function modelProvidersForRequest(enableCloudflareDocumentAttachment)");
    expect(page).toContain("cloudflareDocumentAttachment:true");
    expect(page).toContain("providers:providersForRequest");
  });

  it("stages uploaded files until the user chooses source reading or library storage", () => {
    const page = htmlPage();

    expect(page).toContain("请 选择原文读取或存入文件库".replace(" ", ""));
    expect(page).toContain("async function ensureConversationAttachmentsUploaded(attachments)");
    expect(page).toContain("async function storePendingAttachmentsInLibrary(attachments)");
    expect(page).toContain("conversationAttachmentsToSend = await ensureConversationAttachmentsUploaded(conversationAttachmentsToSend)");
    expect(page).toContain("await storePendingAttachmentsInLibrary(conversationAttachmentsToSend)");
  });
});
