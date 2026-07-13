export function htmlPage() {

  return `<!doctype html>
<html lang="zh-CN">

<head>

<meta charset="utf-8">

<meta name="viewport" content="width=device-width,initial-scale=1">

<title>Workers AI Assistant</title>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js"></script>


<style>

  .menuButton{
    border:none;
    background:#4b5563;
    color:white;
    min-width:38px;
    min-height:38px;
    padding:0 11px;
    border-radius:999px;
    font-size:18px;
    line-height:1;
    cursor:pointer;
    flex:0 0 auto;
  }

  .inputMenuWrap{
    position:relative;
    display:flex;
    align-items:center;
    flex:0 0 auto;
  }

  .inputMenu{
    position:absolute;
    bottom:calc(100% + 8px);
    left:0;
    min-width:128px;
    display:none;
    flex-direction:column;
    gap:4px;
    padding:6px;
    border:1px solid var(--border);
    border-radius:12px;
    background:var(--panel);
    box-shadow:0 12px 32px rgba(15,23,42,.16);
    z-index:10;
  }

  .inputMenu.open{
    display:flex;
  }

  .inputMenu button{
    border:none;
    background:transparent;
    color:var(--text);
    border-radius:8px;
    padding:8px 10px;
    font-size:13px;
    text-align:left;
    cursor:pointer;
    white-space:nowrap;
  }

  .inputMenu button:hover{
    background:rgba(37,99,235,.08);
    color:var(--primary);
  }
  
  #fileStatus{
    display:none;
  }

  #conversationAttachmentList{
    display:none;
    flex-wrap:wrap;
    gap:6px;
    width:100%;
  }

  .fileUseMode{
    display:none;
    align-items:center;
    gap:6px;
    width:100%;
    font-size:12px;
    color:var(--muted);
    flex-wrap:wrap;
  }

  .fileUseMode.visible{
    display:flex;
  }

  .fileUseModeOption{
    display:inline-flex;
    align-items:center;
    gap:4px;
    border:1px solid var(--border);
    border-radius:8px;
    padding:4px 7px;
    background:#f9fafb;
    color:var(--text);
    cursor:pointer;
  }

  .fileUseModeOption input{
    margin:0;
  }

  .fileUseModeHint{
    flex-basis:100%;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }

  .conversationAttachmentChip{
    display:flex;
    align-items:center;
    gap:6px;
    max-width:260px;
    border:1px solid var(--border);
    border-radius:8px;
    padding:5px 7px;
    background:#f9fafb;
    color:var(--text);
    font-size:12px;
  }

  .conversationAttachmentName{
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }

  .conversationAttachmentRemove{
    border:none;
    background:transparent;
    color:var(--muted);
    cursor:pointer;
    font-size:14px;
    line-height:1;
  }

  #clearFileBtn{
    display:none;
    border:none;
    background:#6b7280;
    color:white;
    padding:0 12px;
    border-radius:14px;
    font-size:14px;
    cursor:pointer;
  }

  .fileInfo{
    margin-top:8px;
    font-size:12px;
    color:var(--muted);
  }

  #imagePreviewBox{
    position:relative;
    display:none;
    width:72px;
    height:72px;
    border-radius:16px;
    overflow:hidden;
    border:1px solid var(--border);
    background:#f3f4f6;
    flex-shrink:0;
  }

  body.dark #imagePreviewBox{
    background:#1f2937;
  }

  #imagePreview{
    width:100%;
    height:100%;
    object-fit:cover;
    display:block;
  }

  #removeImageBtn{
    position:absolute;
    top:4px;
    right:4px;
    width:22px;
    height:22px;
    border:none;
    border-radius:999px;
    background:rgba(0,0,0,.72);
    color:white;
    cursor:pointer;
    font-size:14px;
    line-height:22px;
    padding:0;
  }

  #pastedImageNotice{
    display:none;
    color:var(--muted);
    font-size:12px;
    line-height:1.4;
  }

  #pastedImagePreviewList{
    display:none;
    gap:8px;
    flex-wrap:wrap;
    align-items:center;
  }

  .pastedImagePreview{
    position:relative;
    width:72px;
    height:72px;
    border-radius:12px;
    overflow:hidden;
    border:1px solid var(--border);
    background:#f3f4f6;
    flex:0 0 auto;
  }

  body.dark .pastedImagePreview{
    background:#1f2937;
  }

  .pastedImagePreview img{
    width:100%;
    height:100%;
    object-fit:cover;
    display:block;
  }

  .removePastedImageBtn{
    position:absolute;
    top:4px;
    right:4px;
    width:22px;
    height:22px;
    border:none;
    border-radius:999px;
    background:rgba(0,0,0,.72);
    color:white;
    cursor:pointer;
    font-size:14px;
    line-height:22px;
    padding:0;
  }

  #uploadStatus{
    display:none;
  }

:root{
  --bg:#eef2ff;
  --panel:#ffffff;
  --panel-soft:#f8fafc;
  --text:#111827;
  --muted:#6b7280;
  --primary:#2563eb;
  --primary-dark:#1d4ed8;
  --border:#e5e7eb;
  --ai:#ffffff;
  --user:#2563eb;
}

body.dark{
  --bg:#0f172a;
  --panel:#111827;
  --panel-soft:#0b1220;
  --text:#e5e7eb;
  --muted:#9ca3af;
  --primary:#60a5fa;
  --primary-dark:#3b82f6;
  --border:#374151;
  --ai:#1f2937;
  --user:#2563eb;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  height:100vh;
  max-height:100vh;
  overflow:hidden;
  font-family:Arial, "Microsoft YaHei", sans-serif;
  background:var(--bg);
  color:var(--text);
}

body.dark{
  background:#020617;
}

.loginScreen{
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px;
}

.loginCard{
  width:min(380px,100%);
  border:1px solid var(--border);
  border-radius:22px;
  background:var(--panel);
  box-shadow:0 8px 28px rgba(0,0,0,.08);
  padding:24px;
}

.loginCard h1{
  margin:0 0 8px;
  font-size:22px;
}

.loginCard p{
  margin:0 0 18px;
  color:var(--muted);
  font-size:13px;
}

.loginCard label{
  display:block;
  margin-top:12px;
  color:var(--muted);
  font-size:12px;
}

.loginCard input{
  width:100%;
  margin-top:6px;
  border:1px solid var(--border);
  border-radius:12px;
  background:transparent;
  color:var(--text);
  padding:11px 12px;
  font-size:14px;
  outline:none;
}

.loginCard button{
  width:100%;
  margin-top:16px;
  border:none;
  border-radius:14px;
  background:var(--primary);
  color:white;
  padding:11px 12px;
  cursor:pointer;
  font-size:14px;
}

.loginError{
  min-height:18px;
  margin-top:10px;
  color:#dc2626;
  font-size:12px;
}

body:not(.authenticated) .app{
  display:none;
}

body.authenticated .loginScreen{
  display:none;
}

.app{
  height:100vh;
  max-height:100vh;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

.topbar{
  height:52px;
  flex:0 0 52px;
  padding:0 18px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  background:var(--panel);
  border-bottom:1px solid rgba(148,163,184,.18);
}

.brand{
  font-size:20px;
  font-weight:700;
}

.brand span{
  color:var(--primary);
}

.themeBtn{
  border:1px solid transparent;
  background:transparent;
  color:var(--text);
  border-radius:999px;
  padding:7px 12px;
  cursor:pointer;
  font-size:13px;
}

.themeBtn:hover,
.themeBtn.active{
  background:rgba(37,99,235,.08);
  color:var(--primary);
}

.topbarActions{
  display:flex;
  align-items:center;
  gap:8px;
}

.main{
  flex:1;
  min-height:0;
  display:grid;
  grid-template-columns:280px minmax(0,1fr);
  gap:12px;
  padding:12px;
  overflow:hidden;
}

.main.contextPanelOpen{
  grid-template-columns:280px minmax(0,1fr) 280px;
}

.sidebar{
  height:100%;
  min-height:0;
  overflow:hidden;
  background:var(--panel);
  border-radius:14px;
  padding:12px;
  display:flex;
  flex-direction:column;
}

.sidebar h2{
  margin-top:0;
  margin-bottom:12px;
  font-size:20px;
  flex:0 0 auto;
}

.sidebar p{
  color:var(--muted);
  line-height:1.7;
  font-size:14px;
}

.sidebarIntro,
.sidebarBadges{
  display:none;
}

.sidebarMain{
  flex:1 1 auto;
  min-height:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

.sidebarSection{
  flex:0 0 auto;
  min-height:0;
}

.sidebarSection.chatsSection{
  flex:1 1 auto;
  display:flex;
  flex-direction:column;
  min-height:120px;
}

.sidebarSectionHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  color:var(--text);
  font-size:15px;
  line-height:1.35;
  font-weight:600;
  margin:12px 0 6px;
  text-transform:uppercase;
  letter-spacing:0;
}

.chatSearchInput{
  width:100%;
  min-height:34px;
  border:1px solid var(--border);
  border-radius:12px;
  background:transparent;
  color:var(--text);
  padding:8px 10px;
  font-size:15px;
  outline:none;
}

.chatSearchInput:focus{
  border-color:var(--primary);
  box-shadow:0 0 0 2px rgba(37,99,235,.12);
}

.modelArea{
  flex:0 0 auto;
  position:relative;
  z-index:1;
  padding-top:10px;
  margin-top:10px;
  background:var(--panel);
}

.modelLabel{
  color:var(--muted);
  font-size:12px;
  margin-bottom:8px;
}

.modelSettingsBtn{
  width:100%;
  margin-top:8px;
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:12px;
  padding:8px 10px;
  cursor:pointer;
  font-size:15px;
}

.newChatBtn{
  width:100%;
  border:none;
  background:var(--primary);
  color:white;
  border-radius:10px;
  padding:10px 12px;
  font-size:15px;
  cursor:pointer;
  margin-bottom:12px;
  flex:0 0 auto;
}

.projectPanel{
  flex:0 0 auto;
  max-height:38%;
  min-height:0;
  overflow-y:auto;
  margin:6px 0 12px;
  padding:2px 0 0;
}

.projectHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-bottom:6px;
}

.projectLabel{
  color:var(--muted);
  font-size:12px;
  margin-bottom:6px;
}

.projectSectionLabel{
  color:var(--text);
  font-size:15px;
  line-height:1.35;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:0;
}

.projectHeaderBtn,
.projectMenuBtn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  cursor:pointer;
}

.projectHeaderBtn{
  width:24px;
  height:24px;
  border-radius:8px;
  font-size:16px;
  line-height:1;
}

.projectHeaderBtn:hover,
.projectMenuBtn:hover{
  border-color:var(--primary);
  color:var(--primary);
}

.projectList{
  display:flex;
  flex-direction:column;
  gap:2px;
}

.projectRow{
  display:flex;
  align-items:center;
  gap:8px;
  min-height:38px;
  border-radius:10px;
  padding:4px 4px 4px 6px;
  border-left:0;
}

.projectRow.active{
  background:rgba(37,99,235,.1);
}

.projectRow:hover{
  background:rgba(37,99,235,.06);
}

.projectChevronBtn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:22px;
  height:26px;
  flex:0 0 auto;
  border:none;
  background:transparent;
  color:var(--muted);
  border-radius:7px;
  cursor:pointer;
  font-size:13px;
  line-height:1;
}

.projectChevronBtn:hover{
  color:var(--primary);
  background:rgba(37,99,235,.08);
}

.projectNameBtn{
  min-width:0;
  flex:1;
  border:none;
  background:transparent;
  color:var(--text);
  padding:6px 0;
  font-size:15px;
  font-weight:400;
  text-align:left;
  cursor:pointer;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.projectRow.active .projectNameBtn{
  color:var(--text);
  font-weight:400;
}

.projectMenuBtn{
  width:24px;
  height:24px;
  border-radius:8px;
  font-size:16px;
  line-height:1;
  opacity:.72;
}

.projectConversationList{
  flex:0 0 auto;
  min-height:0;
  max-height:220px;
  margin:2px 0 8px 28px;
  padding-left:6px;
}

.projectEmpty{
  color:var(--muted);
  font-size:12px;
  padding:5px 8px;
}

.projectStatus{
  min-height:0;
  margin:0 0 8px;
  color:var(--muted);
  font-size:11px;
  line-height:1.35;
}

.projectStatusMessage{
  display:block;
  margin-top:4px;
  color:var(--muted);
}

.projectSettingsPopover{
  position:fixed;
  z-index:120;
  left:248px;
  top:88px;
  width:min(520px, calc(100vw - 280px));
  max-height:calc(100vh - 112px);
  display:none;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--panel);
  box-shadow:0 24px 70px rgba(15,23,42,.24);
  overflow:hidden;
}

.projectSettingsPopover.open{
  display:flex;
  flex-direction:column;
}

.projectSettingsPopoverHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:12px 14px;
  border-bottom:1px solid var(--border);
}

.projectSettingsPopoverTitle{
  font-weight:700;
  color:var(--text);
}

.projectSettingsPopoverClose{
  width:28px;
  height:28px;
  border:1px solid var(--border);
  border-radius:8px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
}

.projectSettingsPopoverBody{
  padding:12px 14px 14px;
  overflow:auto;
}

.projectSettings{
  margin:4px 0 8px;
  border:1px solid var(--border);
  border-radius:8px;
  background:rgba(37,99,235,.025);
}

.projectSettings > summary{
  cursor:pointer;
  padding:7px 8px;
  color:var(--text);
  font-size:12px;
  font-weight:600;
  list-style:none;
}

.projectSettings > summary::-webkit-details-marker{
  display:none;
}

.projectSettings > summary::after{
  content:">";
  float:right;
  color:var(--muted);
}

.projectSettings[open] > summary::after{
  content:"v";
}

.projectSettingsBody{
  padding:0 8px 8px;
}

.projectSettingsPlaceholder{
  display:block;
  color:var(--muted);
  font-size:11px;
  padding:4px 0;
}

.projectRuntimeSummary{
  display:block;
  color:var(--muted);
  font-size:11px;
  line-height:1.35;
  padding:0 8px 7px;
}

.projectRuntimeDetails{
  margin-top:6px;
  border-top:1px solid var(--border);
}

.projectRuntimeDetails > summary{
  cursor:pointer;
  color:var(--text);
  font-size:12px;
  padding:7px 0;
}

.projectActionMenu{
  position:fixed;
  z-index:80;
  min-width:150px;
  display:none;
  padding:6px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--panel);
  box-shadow:0 14px 32px rgba(15,23,42,.2);
}

.projectActionMenu.open{
  display:block;
}

.projectActionMenu button{
  width:100%;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
  padding:8px 10px;
  font-size:13px;
  text-align:left;
}

.projectActionMenu button:hover{
  background:rgba(37,99,235,.08);
  color:var(--primary);
}

.projectMeta{
  margin-top:8px;
  padding:8px;
  border:1px solid var(--border);
  border-radius:8px;
  background:rgba(37,99,235,.04);
}

.projectMeta strong,
.projectRuntimeName{
  display:block;
  color:var(--text);
  font-size:12px;
  line-height:1.3;
}

.projectMeta span,
.projectRuntimeMeta,
.projectRuntimeWarning{
  display:block;
  margin-top:3px;
  color:var(--muted);
  font-size:11px;
  line-height:1.35;
}

.projectRuntimeList{
  display:flex;
  flex-direction:column;
  gap:7px;
  margin-top:8px;
}

.projectRuntimeItem{
  border:1px solid var(--border);
  border-radius:8px;
  padding:8px;
  background:rgba(255,255,255,.45);
}

body.dark .projectRuntimeItem{
  background:rgba(15,23,42,.36);
}

.projectRuntimeItem.default{
  border-color:var(--primary);
}

.projectRuntimeBadges,
.projectRuntimeActions{
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  margin-top:6px;
}

.projectBadge{
  border:1px solid var(--border);
  border-radius:999px;
  padding:2px 6px;
  color:var(--muted);
  font-size:10px;
  line-height:1.35;
}

.projectBadge.ok{
  border-color:rgba(22,163,74,.35);
  color:#15803d;
}

.projectBadge.warn{
  border-color:rgba(217,119,6,.4);
  color:#b45309;
}

.projectBadge.danger{
  border-color:rgba(220,38,38,.35);
  color:#dc2626;
}

.projectRuntimeWarning{
  color:#b45309;
}

.projectRuntimeBtn,
.projectRuntimeAgent{
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:8px;
  min-height:26px;
  padding:3px 7px;
  font-size:11px;
}

.projectRuntimeBtn{
  cursor:pointer;
}

.projectRuntimeBtn:disabled,
.projectRuntimeAgent:disabled{
  opacity:.55;
  cursor:not-allowed;
}

.projectRuntimeAgent{
  max-width:100%;
}

.historyList{
  display:flex;
  flex-direction:column;
  gap:2px;
  flex:1 1 auto;
  min-height:120px;
  overflow-y:auto;
  margin-bottom:10px;
}

.conversationLoadMoreBtn{
  width:100%;
  min-height:32px;
  flex:0 0 auto;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  font-size:12px;
}

.conversationLoadMoreBtn:hover{
  background:rgba(148,163,184,.12);
  color:var(--text);
}

.conversationLoadMoreBtn:disabled{
  opacity:.6;
  cursor:wait;
}

.historyRow{
  position:relative;
  display:flex;
  align-items:center;
  gap:8px;
  min-height:32px;
  padding:0 4px 0 8px;
  border-radius:8px;
}

.historyRow:hover{
  background:rgba(37,99,235,.06);
}

.historyRow.active{
  background:rgba(37,99,235,.1);
}

.historyRow.pinned .historyItem{
  font-weight:600;
}

.historyItem{
  min-width:0;
  flex:1;
  width:100%;
  border:none;
  background:transparent;
  color:var(--text);
  border-radius:0;
  padding:7px 0;
  font-size:12px;
  font-weight:400;
  text-align:left;
  cursor:pointer;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.historyPinMark{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:22px;
  margin-right:6px;
  border-radius:999px;
  background:rgba(148,163,184,.16);
  color:var(--muted);
  font-size:9px;
  font-weight:700;
  line-height:1.4;
  vertical-align:1px;
}

.historyItem.active{
  background:transparent;
  color:var(--primary);
  font-weight:600;
}

.historyRow.pinned .historyItem{
  font-weight:600;
}

.historyPinMark{
  display:inline-flex;
  align-items:center;
  margin-right:4px;
  color:var(--primary);
  font-size:10px;
  font-weight:700;
}

.historyTime{
  flex:0 0 auto;
  max-width:58px;
  color:var(--muted);
  font-size:11px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.conversationMenuBtn{
  display:none;
  align-items:center;
  justify-content:center;
  width:26px;
  height:26px;
  flex:0 0 auto;
  border:none;
  background:transparent;
  color:var(--muted);
  border-radius:8px;
  cursor:pointer;
  font-size:16px;
  line-height:1;
}

.historyRow:hover .historyTime{
  display:none;
}

.historyRow:hover .conversationMenuBtn,
.conversationMenuBtn[aria-expanded="true"]{
  display:flex;
}

.conversationMenuBtn:hover,
.conversationMenuBtn[aria-expanded="true"]{
  color:var(--text);
  background:rgba(148,163,184,.16);
}

.conversationMenu{
  position:absolute;
  right:4px;
  top:30px;
  z-index:30;
  min-width:112px;
  display:none;
  flex-direction:column;
  gap:2px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--panel);
  padding:5px;
  box-shadow:0 12px 30px rgba(15,23,42,.16);
}

.conversationMenu.open{
  display:flex;
}

.conversationMenu button{
  width:100%;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
  padding:7px 9px;
  font-size:12px;
  text-align:left;
  white-space:nowrap;
}

.conversationMenu button:hover{
  background:rgba(148,163,184,.14);
}

.archivePanel{
  flex:0 0 auto;
  margin:8px 0 10px;
}

.archiveToggle,
.archiveGroupToggle{
  appearance:none;
  -webkit-appearance:none;
  width:100%;
  min-height:30px;
  display:flex;
  align-items:center;
  gap:6px;
  border:0;
  outline:none;
  border-radius:8px;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  padding:6px 4px;
  font-size:12px;
  text-align:left;
}

.archiveToggle:hover,
.archiveGroupToggle:hover{
  background:rgba(148,163,184,.12);
  color:var(--text);
}

.archiveToggle:focus-visible{
  background:rgba(148,163,184,.12);
  box-shadow:0 0 0 2px rgba(148,163,184,.22);
}

.archivePanel.open .archiveToggle{
  background:rgba(148,163,184,.1);
}

.archiveBody{
  display:none;
  flex-direction:column;
  gap:2px;
  padding-top:2px;
}

.archivePanel.open .archiveBody{
  display:flex;
}

.archiveGroupList{
  display:none;
  flex-direction:column;
  gap:2px;
  margin-left:10px;
}

.archiveGroup.open .archiveGroupList{
  display:flex;
}

.archiveEmpty{
  color:var(--muted);
  font-size:12px;
  padding:5px 4px;
}

.libraryPanel{
  flex:1 1 auto;
  min-height:0;
  max-height:none;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  padding:0;
  margin:0;
}

.libraryPanel.collapsed{
  flex:0 0 auto;
}

.libraryHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-bottom:0;
  padding:0;
}

#libraryToggle{
  cursor:pointer;
}

.libraryTitle{
  min-width:0;
  display:flex;
  align-items:center;
  gap:6px;
  color:var(--text);
}

.libraryTitle strong{
  font-size:13px;
}

.libraryChevron{
  color:var(--muted);
  transition:transform .16s ease;
}

.libraryPanel.expanded .libraryChevron{
  transform:rotate(90deg);
}

.libraryBody{
  display:none;
  min-height:0;
  flex:1 1 auto;
  flex-direction:column;
  margin-top:10px;
  overflow:hidden;
}

.libraryPanel.expanded .libraryBody{
  display:flex;
}

.libraryHeader strong{
  font-size:13px;
}

.libraryHeader button{
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:999px;
  padding:5px 9px;
  font-size:12px;
  cursor:pointer;
}

.libraryCount{
  color:var(--muted);
  font-size:12px;
  margin-bottom:8px;
}

.librarySearch{
  display:flex;
  gap:6px;
  margin-bottom:8px;
}

.librarySearch input,
.librarySort{
  min-width:0;
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:10px;
  padding:7px 9px;
  font-size:12px;
}

.librarySearch input{
  flex:1;
}

.librarySearch button,
.clearSelectedFilesBtn{
  flex:0 0 auto;
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:10px;
  padding:7px 9px;
  font-size:12px;
  cursor:pointer;
}

.librarySort{
  width:100%;
  margin-bottom:8px;
}

.librarySelectedRow{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}

.clearSelectedFilesBtn{
  display:none;
  padding:5px 8px;
}

.filesList{
  display:flex;
  flex-direction:column;
  gap:2px;
  flex:0 1 auto;
  min-height:120px;
  max-height:420px;
  overflow-y:auto;
}

.fileLibraryItem{
  border:1px solid transparent;
  border-radius:8px;
  padding:7px 8px;
  background:transparent;
  cursor:pointer;
  transition:background .14s ease, border-color .14s ease;
}

.fileLibraryItem:hover,
.fileLibraryItem.actionsOpen,
.fileLibraryItem.detailOpen{
  background:var(--panel-soft);
}

.fileLibraryItem.selected{
  border-color:transparent;
  background:rgba(37,99,235,.08);
}

.fileLibraryName{
  color:var(--text);
  font-size:13px;
  font-weight:400;
  line-height:1.45;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.fileLibraryMeta{
  display:none;
  margin-top:3px;
  color:var(--muted);
  font-size:11px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.fileLibraryActions{
  display:none;
  flex-wrap:wrap;
  gap:6px;
  margin-top:8px;
}

.fileLibraryItem.actionsOpen .fileLibraryMeta,
.fileLibraryItem.actionsOpen .fileLibraryActions,
.fileLibraryItem.detailOpen .fileLibraryMeta,
.fileLibraryItem.detailOpen .fileLibraryActions{
  display:flex;
}

.fileLibraryItem.actionsOpen .fileLibraryMeta,
.fileLibraryItem.detailOpen .fileLibraryMeta{
  display:block;
}

@media(hover:hover) and (pointer:fine){
  .fileLibraryItem:hover .fileLibraryMeta{
    display:block;
  }

  .fileLibraryItem:hover .fileLibraryActions{
    display:flex;
  }
}

.fileLibraryActions button{
  flex:1;
  border:1px solid rgba(148,163,184,.22);
  background:transparent;
  color:var(--text);
  border-radius:8px;
  padding:6px 8px;
  font-size:12px;
  cursor:pointer;
}

.fileLibraryActions .selectedAction{
  background:var(--primary);
  border-color:var(--primary);
  color:white;
}

.fileDetailPanel{
  margin-top:8px;
  border-top:1px solid var(--border);
  padding-top:8px;
  color:var(--muted);
  font-size:11px;
  line-height:1.5;
}

.fileDetailTitle{
  color:var(--text);
  font-weight:600;
  margin-bottom:4px;
}

.filePreview,
.chunkPreview{
  margin-top:6px;
  max-height:72px;
  overflow:auto;
  white-space:pre-wrap;
  word-break:break-word;
}

.chunkPreview{
  border-top:1px dashed var(--border);
  padding-top:6px;
}

.fileLibraryActions .deleteFileAction:hover{
  background:#dc2626;
  border-color:#dc2626;
  color:white;
}

.contextPanel{
  display:none;
  height:100%;
  min-height:0;
  overflow:hidden;
  background:var(--panel);
  border:1px solid rgba(148,163,184,.18);
  border-radius:14px;
  padding:12px;
  flex-direction:column;
}

.main.contextPanelOpen .contextPanel{
  display:flex;
}

.contextPanelHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding-bottom:10px;
  margin-bottom:8px;
}

.contextPanelTitle{
  min-width:0;
}

.contextPanelTitle strong{
  display:block;
  color:var(--text);
  font-size:14px;
  line-height:1.35;
}

.contextPanelTitle span{
  display:block;
  margin-top:2px;
  color:var(--muted);
  font-size:11px;
  line-height:1.35;
}

.contextPanelClose{
  width:30px;
  height:30px;
  border:0;
  border-radius:9px;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  font-size:18px;
  line-height:1;
}

.contextPanelClose:hover{
  background:rgba(37,99,235,.08);
  color:var(--primary);
}

.contextPanelBody{
  flex:1 1 auto;
  min-height:0;
  overflow:auto;
  display:flex;
  flex-direction:column;
  gap:12px;
}

.contextSection{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:10px 0 12px;
  border-top:1px solid rgba(148,163,184,.18);
}

.contextSection:first-child{
  border-top:0;
  padding-top:0;
}

.contextSectionHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  color:var(--text);
  font-size:12px;
  font-weight:600;
  line-height:1.35;
  text-transform:uppercase;
  letter-spacing:0;
}

.contextHint{
  color:var(--muted);
  font-size:12px;
  line-height:1.45;
}

.contextUploadActions{
  display:flex;
  flex-direction:column;
  gap:8px;
}

.contextUploadBtn{
  width:100%;
  min-height:36px;
  border:1px solid rgba(148,163,184,.28);
  border-radius:10px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
  font-size:13px;
  text-align:left;
  padding:8px 10px;
}

.contextUploadBtn:hover{
  border-color:rgba(37,99,235,.35);
  background:rgba(37,99,235,.08);
  color:var(--primary);
}

.badge{
  display:inline-block;
  background:rgba(37,99,235,.1);
  color:var(--primary);
  padding:6px 10px;
  border-radius:999px;
  font-size:13px;
  margin:6px 4px 0 0;
}

.chatCard{
  display:flex;
  flex-direction:column;
  height:100%;
  max-height:100%;
  min-height:0;
  background:var(--panel);
  border:1px solid rgba(148,163,184,.18);
  border-radius:14px;
  overflow:hidden;
  box-shadow:0 10px 30px rgba(15,23,42,.08);
}

.chatHeader{
  flex:0 0 auto;
  padding:16px 20px;
  border-bottom:1px solid var(--border);
  font-weight:600;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}

.summaryStatus{
  display:none;
  align-items:center;
  gap:8px;
  min-width:0;
  color:var(--muted);
  font-size:12px;
  font-weight:400;
}

.summaryStatus.active{
  display:flex;
}

.summaryStatus button{
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:999px;
  padding:4px 8px;
  font-size:12px;
  cursor:pointer;
}

#chat{
  flex:1;
  min-height:0;
  overflow-y:auto;
  padding:22px;
  display:flex;
  flex-direction:column;
  gap:14px;
}

.msg{
  max-width:82%;
  min-width:0;
  padding:14px 16px;
  border-radius:16px;
  line-height:1.7;
  word-break:break-word;
  box-shadow:0 2px 8px rgba(0,0,0,.06);
}

.user{
  align-self:flex-end;
  background:var(--user);
  color:white;
  border-bottom-right-radius:4px;
}

.userImage{
  max-width:180px;
  max-height:180px;
  border-radius:14px;
  display:block;
  margin-top:8px;
  object-fit:cover;
}

.userImageOnly{
  padding:8px;
  background:var(--user);
}

.ai{
  align-self:flex-start;
  background:var(--ai);
  color:var(--text);
  border:1px solid var(--border);
  border-bottom-left-radius:4px;
  position:relative;
}

.assistantMessageBody{
  width:100%;
  max-width:100%;
  min-width:0;
}

.messageModelInfo{
  margin-top:6px;
  color:var(--muted);
  font-size:12px;
  line-height:1.4;
  opacity:.82;
}

.messageCopyBtn,
.codeCopyBtn{
  border:1px solid var(--border);
  background:rgba(148,163,184,.1);
  color:var(--muted);
  border-radius:999px;
  padding:3px 8px;
  font-size:12px;
  cursor:pointer;
  line-height:1.4;
}

.messageCopyBtn{
  float:right;
  margin:0 0 8px 10px;
}

.messageCopyBtn:hover,
.codeCopyBtn:hover{
  color:var(--text);
  background:rgba(148,163,184,.16);
}

.welcomeMsg{
  display:flex;
  align-items:flex-start;
  gap:12px;
}

.welcomeText{
  flex:1 1 auto;
  min-width:0;
}

.welcomeActions{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:8px;
}

.welcomeNeverShow{
  display:flex;
  align-items:center;
  gap:5px;
  color:var(--muted);
  font-size:12px;
  white-space:nowrap;
}

.welcomeCloseBtn{
  width:24px;
  height:24px;
  border:1px solid var(--border);
  border-radius:999px;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  line-height:1;
}

.ai pre{
  background:#111827;
  color:#f9fafb;
  padding:12px;
  border-radius:10px;
  overflow:auto;
}

.ai code{
  font-family:Consolas,Monaco,monospace;
}

.assistantMessageBody h1,
.assistantMessageBody h2,
.assistantMessageBody h3,
.assistantMessageBody h4{
  margin:10px 0 6px;
  line-height:1.35;
}

.assistantMessageBody p,
.assistantMessageBody ul,
.assistantMessageBody ol,
.assistantMessageBody blockquote,
.assistantMessageBody pre,
.assistantMessageBody table{
  margin-top:0;
  margin-bottom:10px;
}

.assistantMessageBody ul,
.assistantMessageBody ol{
  padding-left:22px;
}

.assistantMessageBody blockquote{
  border-left:3px solid var(--border);
  padding:4px 0 4px 10px;
  color:var(--muted);
}

.assistantMessageBody a{
  color:var(--primary);
}

.assistantMessageBody hr{
  border:0;
  border-top:1px solid var(--border);
  margin:14px 0;
}

.assistantMessageBody :not(pre) > code{
  padding:2px 5px;
  border-radius:6px;
  background:rgba(148,163,184,.16);
}

.codeBlock{
  margin:0 0 10px;
  border-radius:10px;
  overflow:hidden;
  background:#111827;
}

.codeBlockToolbar{
  display:flex;
  justify-content:flex-end;
  padding:6px 8px;
  border-bottom:1px solid rgba(255,255,255,.08);
}

.codeBlock pre{
  margin:0;
  border-radius:0;
}

.tableWrap{
  width:100%;
  max-width:100%;
  overflow-x:auto;
  margin-bottom:10px;
}

.assistantMessageBody table{
  width:max-content;
  min-width:100%;
  border-collapse:collapse;
  font-size:13px;
}

.assistantMessageBody th,
.assistantMessageBody td{
  border:1px solid var(--border);
  padding:6px 8px;
  text-align:left;
  vertical-align:top;
}

.assistantMessageBody th{
  background:rgba(148,163,184,.12);
  font-weight:600;
}

.mathInline,
.mathBlock{
  font-family:Cambria Math,Georgia,serif;
}

.mathInline{
  display:inline-block;
}

.mathBlock{
  display:block;
  overflow-x:auto;
  margin:10px 0;
  text-align:center;
}

.mathFallback{
  background:rgba(148,163,184,.12);
  border:1px solid var(--border);
  border-radius:6px;
  padding:0 5px;
}

.mathBlock.mathFallback{
  text-align:left;
  padding:10px 12px;
  border-radius:10px;
  white-space:pre-wrap;
}

.sourceCitations{
  margin-top:10px;
  padding-top:8px;
  border-top:1px solid var(--border);
  color:var(--muted);
  font-size:12px;
}

.sourceCitationsTitle{
  margin-bottom:6px;
}

.sourceCitationItem{
  margin-top:4px;
}

.sourceCitationBtn{
  width:100%;
  min-width:0;
  border:none;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  padding:3px 0;
  text-align:left;
  display:block;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  font-size:12px;
  text-decoration:none;
}

.sourceCitationBtn:hover{
  color:var(--primary);
}

.sourceCitationPreview{
  display:none;
  margin-top:4px;
  padding:8px;
  border:1px solid var(--border);
  border-radius:10px;
  white-space:pre-wrap;
  word-break:break-word;
  max-height:110px;
  overflow:auto;
  background:rgba(148,163,184,.08);
}

.sourceCitationPreview.active{
  display:block;
}

.toolErrorNotice{
  margin-top:10px;
  padding:8px 10px;
  border:1px solid rgba(220,38,38,.25);
  border-radius:10px;
  background:rgba(220,38,38,.06);
  color:#b91c1c;
  font-size:12px;
  line-height:1.45;
}

body.dark .toolErrorNotice{
  color:#fca5a5;
  background:rgba(220,38,38,.12);
}

.toolDebugInfo{
  margin-top:8px;
  padding:7px 9px;
  border:1px dashed var(--border);
  border-radius:10px;
  color:var(--muted);
  background:rgba(148,163,184,.07);
  font-size:11px;
  line-height:1.45;
  white-space:pre-wrap;
}

.modelDiagnosticInfo{
  margin-top:8px;
  padding:7px 9px;
  border:1px solid var(--border);
  border-radius:10px;
  color:var(--muted);
  background:rgba(20,184,166,.07);
  font-size:11px;
  line-height:1.45;
  white-space:pre-wrap;
}

.inputBar{
  flex:0 0 auto;
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:16px;
  border-top:1px solid var(--border);
  background:var(--panel);
}

#contextStatus{
  min-height:16px;
  color:var(--muted);
  font-size:12px;
  line-height:16px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.openClawTaskBanner{
  display:none;
  border:1px solid var(--border);
  border-radius:10px;
  padding:8px;
  color:var(--text);
  background:rgba(59,130,246,.08);
  font-size:12px;
}

.openClawTaskBanner.open{
  display:block;
}

.openClawTaskBanner strong{
  display:block;
  margin-bottom:3px;
  font-size:13px;
}

.openClawTaskMeta{
  color:var(--muted);
  line-height:1.45;
}

.openClawTaskActions{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-top:7px;
}

.openClawTaskActions button{
  border:1px solid var(--border);
  border-radius:8px;
  background:var(--panel);
  color:var(--text);
  cursor:pointer;
  padding:5px 8px;
  font-size:12px;
}

.openClawTaskHistory{
  border:1px solid var(--border);
  border-radius:10px;
  padding:8px;
  color:var(--text);
  background:var(--panel);
  font-size:12px;
}

.openClawTaskHistory[hidden]{
  display:none;
}

.openClawTaskHistoryHeader,
.openClawTaskHistoryTabs{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}

.openClawTaskHistoryHeader strong{
  font-size:13px;
}

.openClawTaskHistoryTabs{
  flex-wrap:wrap;
  justify-content:flex-start;
  margin-top:8px;
}

.openClawTaskHistory button{
  border:1px solid var(--border);
  border-radius:8px;
  background:var(--panel);
  color:var(--text);
  cursor:pointer;
  padding:5px 8px;
  font-size:12px;
}

.openClawTaskHistory button.active{
  background:rgba(59,130,246,.14);
  border-color:rgba(59,130,246,.5);
}

.openClawTaskHistoryList{
  display:flex;
  flex-direction:column;
  gap:7px;
  margin-top:8px;
  max-height:260px;
  overflow:auto;
}

.openClawTaskHistoryItem{
  border:1px solid var(--border);
  border-radius:8px;
  padding:7px;
  background:rgba(148,163,184,.06);
}

.openClawTaskHistoryTop{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-variant-numeric:tabular-nums;
}

.openClawTaskHistoryMeta,
.openClawTaskHistoryPreview,
.openClawTaskHistoryError{
  color:var(--muted);
  line-height:1.45;
  margin-top:4px;
}

.openClawTaskHistoryPreview{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.openClawTaskHistoryError summary{
  cursor:pointer;
  color:var(--text);
}

.openClawTaskHistoryToggle{
  align-self:flex-start;
}

.inputShell{
  width:100%;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:10px;
  border:1px solid var(--border);
  border-radius:24px;
  background:var(--panel);
  box-shadow:0 6px 22px rgba(0,0,0,.06);
}

.inputActions{
  display:flex;
  align-items:center;
  gap:8px;
  flex:0 0 auto;
}

.inputPrimaryActions{
  display:flex;
  align-items:center;
  gap:6px;
  flex:0 1 auto;
  flex-wrap:nowrap;
  justify-content:flex-end;
}

.toolBtn{
  min-height:38px;
  border:none;
  color:white;
  padding:0 12px;
  border-radius:999px;
  font-size:14px;
  cursor:pointer;
  white-space:nowrap;
  flex:0 0 auto;
  background:#475569;
}

.toolMenuWrap .inputMenu{
  left:auto;
  right:0;
}

.toolBtn:disabled{
  opacity:.6;
  cursor:not-allowed;
}

.browserToolInput{
  flex:1 1 260px;
  min-width:0;
  height:38px;
  border:1px solid var(--border);
  border-radius:999px;
  padding:0 12px;
  background:transparent;
  color:var(--text);
  font:inherit;
  font-size:13px;
  outline:none;
}

.browserToolInput:focus{
  border-color:var(--primary);
}

.browserToolPanel{
  display:none;
  width:100%;
  flex:1 0 100%;
  align-items:center;
  gap:8px;
  padding:2px 0 0 44px;
}

.browserToolPanel.open{
  display:flex;
}

.browserToolToggleBtn,
.browserToolBtn{
  min-height:38px;
  border:none;
  color:white;
  padding:0 12px;
  border-radius:999px;
  font-size:14px;
  cursor:pointer;
  white-space:nowrap;
  flex:0 0 auto;
  background:#0f766e;
}

.browserToolToggleBtn{
  background:#334155;
}

.browserToolBtn:disabled{
  opacity:.6;
  cursor:not-allowed;
}

.browserToolStats{
  margin-top:8px;
  color:var(--muted);
  font-size:12px;
  line-height:1.4;
}

.browserScreenshotThumb{
  width:min(320px,100%);
  height:auto;
  max-height:260px;
  border:1px solid var(--border);
  border-radius:14px;
  box-shadow:0 8px 22px rgba(15,23,42,.16);
  display:block;
  object-fit:contain;
  margin-top:10px;
  cursor:zoom-in;
  background:var(--panel);
}

.browserLightbox{
  position:fixed;
  inset:0;
  z-index:80;
  display:none;
  align-items:center;
  justify-content:center;
  padding:24px;
  background:rgba(15,23,42,.78);
}

.browserLightbox.open{
  display:flex;
}

.browserLightboxImage{
  max-width:min(96vw,1180px);
  max-height:90vh;
  border-radius:14px;
  box-shadow:0 18px 48px rgba(0,0,0,.35);
  background:white;
}

.browserLightboxClose{
  position:absolute;
  top:18px;
  right:18px;
  width:38px;
  height:38px;
  border:none;
  border-radius:999px;
  background:rgba(255,255,255,.92);
  color:#111827;
  font-size:24px;
  line-height:38px;
  cursor:pointer;
}

.inputMenu button:disabled{
  opacity:.55;
  cursor:not-allowed;
}

#modelSelect{
  padding:12px;
  border:1px solid var(--border);
  border-radius:14px;
  font-size:14px;
  outline:none;
  background:transparent;
  color:var(--text);
}

.settingsModal{
  position:fixed;
  inset:0;
  z-index:50;
  display:none;
  align-items:center;
  justify-content:center;
  padding:18px;
  background:rgba(15,23,42,.36);
}

.settingsModal.open{
  display:flex;
}

.settingsPanel{
  width:min(760px,100%);
  max-height:88vh;
  overflow:auto;
  background:var(--panel);
  color:var(--text);
  border:1px solid var(--border);
  border-radius:18px;
  padding:18px;
  box-shadow:0 20px 60px rgba(15,23,42,.25);
}

.settingsHeader,
.settingsFooter{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}

.settingsFooterActions{
  display:none;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  justify-content:flex-end;
}

.settingsHeaderActions{
  display:flex;
  align-items:center;
  gap:8px;
}

.settingsHint{
  grid-column:1 / -1;
  margin:0;
  color:var(--muted);
  font-size:12px;
  line-height:1.5;
}

.settingsHeader h3{
  margin:0;
  font-size:18px;
}

.settingsGrid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  margin-top:14px;
}

.settingsField{
  display:flex;
  flex-direction:column;
  gap:6px;
  color:var(--muted);
  font-size:13px;
}

.settingsField.full{
  grid-column:1 / -1;
}

.settingsField input,
.settingsField select{
  width:100%;
  border:1px solid var(--border);
  border-radius:12px;
  padding:9px 10px;
  background:transparent;
  color:var(--text);
}

.settingsCheck{
  display:flex;
  align-items:center;
  gap:8px;
  min-height:38px;
}

.openclawExecutionModeField{
  align-items:stretch;
  gap:10px;
}

.openclawExecutionModeTitle{
  color:var(--muted);
  font-size:13px;
}

.openclawExecutionModeOption{
  display:grid;
  grid-template-columns:auto minmax(0,1fr);
  column-gap:8px;
  row-gap:2px;
  align-items:start;
  color:var(--text);
  cursor:pointer;
}

.openclawExecutionModeOption input{
  width:auto;
  margin:2px 0 0;
}

.openclawExecutionModeLabel{
  font-size:13px;
  line-height:1.35;
}

.openclawExecutionModeHelp{
  grid-column:2;
  color:var(--muted);
  font-size:12px;
  line-height:1.45;
}

.settingsGrid > label:has(#providerLabelInput),
.settingsGrid > label:has(#providerIdInput),
.settingsGrid > label:has(#providerTypeSelect),
.settingsGrid > label:has(#providerBaseUrlInput),
.settingsGrid > label:has(#providerApiKeyEnvInput),
.settingsGrid > label:has(#modelProviderSelect),
.settingsGrid > label:has(#modelLabelInput),
.settingsGrid > label:has(#modelIdInput),
.settingsGrid > label:has(#modelNameInput),
#addProviderBtn,
#cancelProviderEditBtn,
#addProviderModelBtn,
#cancelModelEditBtn{
  display:none !important;
}

.providerList{
  display:flex;
  flex-direction:column;
  gap:8px;
  margin-top:8px;
}

.modelHealthPanel{
  grid-column:1 / -1;
  border:1px solid var(--border);
  border-radius:12px;
  padding:10px;
  margin-top:4px;
}

.modelHealthHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}

.modelHealthActions{
  display:flex;
  align-items:center;
  gap:8px;
  flex:0 0 auto;
}

.modelHealthTitle{
  display:flex;
  flex-direction:column;
  gap:2px;
}

.modelHealthTitle strong{
  font-size:14px;
}

.modelHealthList{
  display:flex;
  flex-direction:column;
  gap:6px;
  margin-top:8px;
}

.modelHealthList.collapsed{
  display:none;
}

.modelHealthItem{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  color:var(--muted);
  font-size:12px;
}

.modelHealthName{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.modelHealthStatus{
  display:flex;
  flex-wrap:wrap;
  justify-content:flex-end;
  gap:4px 8px;
  flex:0 0 auto;
  color:var(--text);
  font-variant-numeric:tabular-nums;
  text-align:right;
}

.modelCategory{
  border:1px solid var(--border);
  border-radius:12px;
  overflow:visible;
}

.modelCategoryHeader{
  width:100%;
  border:0;
  background:rgba(148,163,184,.08);
  color:var(--text);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:10px 12px;
  font:inherit;
  text-align:left;
}

.modelCategoryTop{
  display:flex;
  align-items:center;
  gap:8px;
  background:rgba(148,163,184,.08);
}

.modelCategoryTop .modelCategoryHeader{
  flex:1;
  background:transparent;
}

.categoryAddBtn{
  flex:0 0 auto;
  width:30px;
  height:30px;
  margin-right:8px;
  border:1px solid transparent;
  border-radius:999px;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  font-size:20px;
  line-height:1;
  transition:background .15s ease,border-color .15s ease,color .15s ease;
}

.modelCategoryTop:hover .categoryAddBtn,
.categoryAddBtn:focus{
  color:var(--text);
  background:rgba(148,163,184,.12);
  border-color:var(--border);
}

.modelCategoryTitle{
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
}

.modelCategoryMeta{
  color:var(--muted);
  font-size:12px;
}

.modelCategoryBody{
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:8px;
}

.modelCategory.collapsed .modelCategoryBody{
  display:none;
}

.providerRow{
  border:1px solid var(--border);
  border-radius:12px;
  padding:9px;
}

.providerRowHeader,
.modelRow{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}

.providerMain,
.modelMain{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:3px;
}

.providerMeta,
.modelMeta{
  color:var(--muted);
  font-size:12px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.providerActions,
.modelActions{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:6px;
  margin-left:auto;
  position:relative;
}

.actionMenuButton{
  width:30px;
  height:30px;
  border:1px solid transparent;
  border-radius:999px;
  background:transparent;
  color:var(--muted);
  cursor:pointer;
  line-height:1;
  font-size:18px;
  opacity:.55;
  transition:background .15s ease,border-color .15s ease,color .15s ease,opacity .15s ease;
}

.providerRowHeader:hover .actionMenuButton,
.modelRow:hover .actionMenuButton,
.actionMenuButton:focus,
.actionMenuButton[aria-expanded="true"]{
  opacity:1;
  color:var(--text);
  background:rgba(148,163,184,.12);
  border-color:var(--border);
}

.actionMenu{
  position:absolute;
  top:calc(100% + 6px);
  right:0;
  z-index:20;
  min-width:132px;
  display:none;
  flex-direction:column;
  gap:2px;
  padding:5px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--panel);
  box-shadow:0 12px 30px rgba(15,23,42,.16);
}

.actionMenu.open{
  display:flex;
}

.actionMenu button{
  width:100%;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
  padding:8px 10px;
  font-size:13px;
  text-align:left;
  white-space:nowrap;
}

.actionMenu button:hover{
  background:rgba(37,99,235,.08);
  color:var(--primary);
}

.modelRow{
  margin-top:6px;
  color:var(--muted);
  font-size:12px;
}

.settingsBtn{
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:999px;
  padding:7px 11px;
  cursor:pointer;
}

.settingsPrimaryBtn{
  border:none;
  background:var(--primary);
  color:white;
  border-radius:999px;
  padding:8px 14px;
  cursor:pointer;
}

.settingsIconBtn{
  width:34px;
  height:34px;
  border:1px solid var(--border);
  border-radius:999px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
  font-size:18px;
  line-height:1;
}

.editDialogOverlay{
  position:fixed;
  inset:0;
  z-index:70;
  display:none;
  align-items:center;
  justify-content:center;
  padding:18px;
  background:rgba(15,23,42,.38);
}

.editDialogOverlay.open{
  display:flex;
}

.editDialogPanel{
  width:min(520px,100%);
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:18px;
  padding:18px;
  box-shadow:0 20px 60px rgba(15,23,42,.25);
}

.editDialogGrid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  margin-top:14px;
}

.editDialogFooter{
  display:flex;
  justify-content:space-between;
  gap:10px;
  margin-top:16px;
}

.editDialogFooter > div{
  display:flex;
  gap:8px;
}

#input{
  flex:1 1 260px;
  min-width:160px;
  min-height:44px;
  max-height:180px;
  padding:12px 6px;
  border:none;
  font-size:16px;
  line-height:20px;
  outline:none;
  background:transparent;
  color:var(--text);
  resize:none;
  overflow-y:hidden;
  font-family:inherit;
}

#sendBtn{
  border:none;
  background:var(--primary);
  color:white;
  min-height:40px;
  padding:0 20px;
  border-radius:999px;
  font-size:16px;
  cursor:pointer;
  flex:0 0 auto;
}

#sendBtn:hover{
  background:var(--primary-dark);
}

#sendBtn:disabled{
  opacity:.6;
  cursor:not-allowed;
}

.loading{
  color:var(--muted);
  font-style:italic;
}

@media(max-width:800px){

  .main{
    grid-template-columns:1fr;
    min-height:0;
  }

  .main.contextPanelOpen{
    grid-template-columns:1fr;
  }

  .sidebar{
    display:none;
  }

  .contextPanel{
    position:fixed;
    z-index:90;
    top:64px;
    right:12px;
    bottom:12px;
    width:min(280px, calc(100vw - 24px));
    box-shadow:0 24px 70px rgba(15,23,42,.26);
  }

  .msg{
    max-width:95%;
  }

  .topbar{
    padding:0 12px;
  }

  .inputBar{
    padding:12px;
  }

  .inputShell{
    align-items:stretch;
  }

  .inputActions,
  .inputPrimaryActions{
    flex-wrap:wrap;
  }

  .browserToolPanel{
    padding-left:0;
  }

  #input{
    order:-1;
    flex-basis:100%;
  }
}

</style>
</head>

<body>

<div id="loginScreen" class="loginScreen">
  <form id="loginForm" class="loginCard">
    <h1>Workers AI Chat</h1>
    <p>&#x8BF7;&#x767B;&#x5F55;&#x540E;&#x7EE7;&#x7EED;&#x4F7F;&#x7528;</p>
    <label for="loginUsername">&#x7528;&#x6237;&#x540D;</label>
    <input id="loginUsername" autocomplete="username" />
    <label for="loginPassword">&#x5BC6;&#x7801;</label>
    <input id="loginPassword" type="password" autocomplete="current-password" />
    <button id="loginBtn" type="submit">&#x767B;&#x5F55;</button>
    <div id="loginError" class="loginError"></div>
  </form>
</div>

<div id="settingsModal" class="settingsModal" aria-hidden="true">
  <div class="settingsPanel" role="dialog" aria-modal="true">
    <div class="settingsHeader">
      <h3>模型设置中心</h3>
      <button id="closeSettingsBtn" class="settingsBtn" type="button">关闭</button>
    </div>
    <div class="settingsGrid">
      <label class="settingsField">
        默认模型
        <select id="defaultModelSelect"></select>
      </label>
      <label class="settingsField">
        fallback 模型
        <select id="fallbackModelSelect"></select>
      </label>
      <label class="settingsField">
        自动归档
        <select id="autoArchiveDaysSelect">
          <option value="never">Never</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
      </label>
      <label class="settingsCheck">
        <input id="rememberLastModelCheck" type="checkbox" />
        记住上次选择
      </label>
      <label class="settingsCheck">
        <input id="fallbackEnabledCheck" type="checkbox" />
        自动 fallback
      </label>
      <label class="settingsCheck">
        <input id="showPerMessageModelInfoCheck" type="checkbox" />
        显示每轮使用的模型
      </label>
      <label class="settingsField">
        原文读取单文件 MB
        <input id="attachmentMaxFileMbInput" type="number" min="1" max="20" step="1" />
      </label>
      <label class="settingsField">
        原文读取总量 MB
        <input id="attachmentMaxTotalMbInput" type="number" min="1" max="40" step="1" />
      </label>
      <label class="settingsField">
        转换文本字符上限
        <input id="attachmentMaxMarkdownCharsInput" type="number" min="1000" max="300000" step="1000" />
      </label>
      <label class="settingsField">
        转换 tokens 上限
        <input id="attachmentMaxTokensInput" type="number" min="1000" max="120000" step="1000" />
      </label>
      <label class="settingsField">
        最终消息字符上限
        <input id="attachmentMaxFinalCharsInput" type="number" min="1000" max="360000" step="1000" />
      </label>
      <label class="settingsField">
        新 provider 名称
        <input id="providerLabelInput" placeholder="My Provider" />
      </label>
      <label class="settingsField">
        provider id
        <input id="providerIdInput" placeholder="my-provider" />
      </label>
      <label class="settingsField">
        provider 类型
        <select id="providerTypeSelect">
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="claude-compatible">Claude 兼容</option>
        </select>
      </label>
      <label class="settingsField">
        baseUrl
        <input id="providerBaseUrlInput" placeholder="https://api.example.com/v1" />
      </label>
      <label class="settingsField">
        apiKeyEnv
        <input id="providerApiKeyEnvInput" placeholder="MY_PROVIDER_API_KEY" />
      </label>
      <div class="settingsField full">
        <button id="addProviderBtn" class="settingsBtn" type="button">新增 provider</button>
        <button id="cancelProviderEditBtn" class="settingsBtn" type="button" style="display:none;">取消 provider 编辑</button>
      </div>
      <label class="settingsField">
        选择 provider
        <select id="modelProviderSelect"></select>
      </label>
      <label class="settingsField">
        模型显示名
        <input id="modelLabelInput" placeholder="My Model" />
      </label>
      <label class="settingsField">
        模型 ID / Workers AI ID
        <input id="modelIdInput" placeholder="@cf/... 或 provider-model" />
      </label>
      <label class="settingsField">
        上游 model name
        <input id="modelNameInput" placeholder="可留空，默认等于模型 ID" />
      </label>
      <div class="settingsField full">
        <button id="addProviderModelBtn" class="settingsBtn" type="button">添加模型到 provider</button>
        <button id="cancelModelEditBtn" class="settingsBtn" type="button" style="display:none;">取消模型编辑</button>
        <div class="modelHealthPanel">
          <div class="modelHealthHeader">
            <div class="modelHealthTitle">
              <strong>模型健康检查</strong>
              <span class="modelCategoryMeta">轻量请求当前已配置模型</span>
            </div>
            <div class="modelHealthActions">
              <button id="modelHealthBtn" class="settingsBtn" type="button">检查</button>
              <button id="modelHealthToggleBtn" class="settingsBtn" type="button" hidden>收起</button>
            </div>
          </div>
          <div id="modelHealthResults" class="modelHealthList"></div>
        </div>
        <div id="providersList" class="providerList"></div>
      </div>
    </div>
    <div class="settingsFooter">
      <span id="settingsSyncStatus" class="modelLabel"></span>
      <div class="settingsFooterActions">
        <button id="cancelSettingsBtn" class="settingsBtn" type="button">取消</button>
        <button id="applySettingsBtn" class="settingsBtn" type="button">应用</button>
        <button id="saveSettingsBtn" class="settingsPrimaryBtn" type="button">保存</button>
      </div>
    </div>
  </div>
</div>

<div class="app">

  <div class="topbar">
    <div class="brand">Workers <span>AI</span> Assistant</div>
    <div class="topbarActions">
      <button id="contextPanelToggle" class="themeBtn" type="button" aria-expanded="false">Context</button>
      <button id="logoutBtn" class="themeBtn" type="button">Logout</button>
      <button class="themeBtn" onclick="toggleTheme()">深色 / 浅色</button>
    </div>
  </div>

  <div class="main">

    <aside class="sidebar">

      <button id="newChatBtn" class="newChatBtn" type="button">
        + Chat
      </button>

      <div class="sidebarMain">

        <div class="sidebarSection searchSection">
          <input id="chatSearchInput" class="chatSearchInput" type="search" placeholder="Search Conversations" aria-label="Search Conversations" />
        </div>

        <div class="projectPanel sidebarSection">
          <div class="projectHeader">
            <span class="projectSectionLabel">Projects</span>
            <button id="createProjectBtn" class="projectHeaderBtn" type="button" title="New Project" aria-label="New Project">+</button>
          </div>
          <div id="projectList" class="projectList"></div>
        </div>

        <div id="projectStatus" class="projectStatus"></div>

        <div class="sidebarSection chatsSection">
          <div class="sidebarSectionHeader">Conversations</div>
          <div id="conversationList" class="historyList"></div>
          <button id="conversationLoadMoreBtn" class="conversationLoadMoreBtn" type="button" hidden>Load more</button>
        </div>

      </div>

      <p class="sidebarIntro">
        这是部署在 Cloudflare Workers 上的 AI 网页助手。
        不依赖 VPS，不需要本地 GPU，直接调用 Workers AI。
      </p>

      <div class="sidebarBadges">
        <div class="badge">多轮对话</div>
        <div class="badge">Markdown</div>
        <div class="badge">模型切换</div>
        <div class="badge">打字机效果</div>
        <div class="badge">深浅色切换</div>
      </div>

      <div id="archivePanel" class="archivePanel">
        <button id="archiveToggleBtn" class="archiveToggle" type="button" aria-expanded="false">
          <span>Archive</span>
          <span id="archiveChevron" aria-hidden="true">&#x203A;</span>
        </button>
        <div id="archiveBody" class="archiveBody"></div>
      </div>

      <div class="modelArea">
        <div class="modelLabel">当前模型</div>
    
      <select
        id="modelSelect"
        style="
          width:100%;
          padding:12px;
          border:1px solid var(--border);
          border-radius:14px;
          background:transparent;
          color:var(--text);
          font-size:14px;
        "
      >
      </select>
      <button id="modelSettingsBtn" class="modelSettingsBtn" type="button">模型设置</button>

      </div>

    </aside>

    <div id="projectSettingsPopover" class="projectSettingsPopover" hidden>
      <div class="projectSettingsPopoverHeader">
        <div class="projectSettingsPopoverTitle">Project Settings</div>
        <button id="projectSettingsCloseBtn" class="projectSettingsPopoverClose" type="button" aria-label="Close Project Settings">X</button>
      </div>
      <div id="projectSettingsPopoverBody" class="projectSettingsPopoverBody"></div>
    </div>

    <section class="chatCard">

      <div class="chatHeader">
        <div id="summaryStatus" class="summaryStatus">
          <span>&#x5DF2;&#x542F;&#x7528;&#x957F;&#x4E0A;&#x4E0B;&#x6587;&#x6458;&#x8981;</span>
          <button id="viewSummaryBtn" type="button">&#x67E5;&#x770B;&#x6458;&#x8981;</button>
        </div>
      </div>

      <div id="chat">

        <div id="welcomeCard" class="msg ai welcomeMsg">
          <div class="welcomeText">
            你好，我是基于 Cloudflare Workers AI 的网页助手。
            你可以问我问题，也可以让我写代码、总结、翻译或分析内容。
          </div>
          <div class="welcomeActions">
            <label class="welcomeNeverShow">
              <input id="welcomeNeverShowInput" type="checkbox" />
              <span>不再显示</span>
            </label>
            <button class="welcomeCloseBtn" type="button" aria-label="关闭欢迎提示">&times;</button>
          </div>
        </div>
        <div id="searchResults"></div>

      </div>

      <div class="inputBar">

  <input id="imageInput" type="file" accept="image/*" hidden />

  <input
    id="fileInput"
    type="file"
    accept="image/*,audio/*,.txt,.md,.markdown,.csv,.json,.zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/*,application/pdf,application/json,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
    multiple
    hidden
  />

  <div id="contextStatus"></div>

  <div id="openClawTaskBanner" class="openClawTaskBanner" aria-live="polite"></div>

  <button id="openClawTaskHistoryToggle" class="openClawTaskHistoryToggle" type="button">OpenClaw Tasks</button>

  <div id="openClawTaskHistoryPanel" class="openClawTaskHistory" hidden>
    <div class="openClawTaskHistoryHeader">
      <strong>Task History</strong>
      <button id="openClawTaskHistoryRefresh" type="button">刷新</button>
    </div>
    <div class="openClawTaskHistoryTabs">
      <button type="button" data-openclaw-task-view="recent" class="active">Recent</button>
      <button type="button" data-openclaw-task-view="failed">Failed All</button>
      <button type="button" data-openclaw-task-view="slow">Slow All</button>
      <button type="button" data-openclaw-task-view="conversation">This Chat</button>
    </div>
    <div id="openClawTaskHistoryList" class="openClawTaskHistoryList"></div>
  </div>

  <div id="pastedImageNotice"></div>

  <div id="pastedImagePreviewList"></div>

  <div class="inputShell">

    <div class="inputActions">
      <div class="inputMenuWrap">
        <button id="attachmentMenuBtn" class="menuButton" type="button" aria-haspopup="menu" aria-expanded="false" title="&#x6DFB;&#x52A0;&#x9644;&#x4EF6;">+</button>
        <div id="attachmentMenu" class="inputMenu" role="menu">
          <button id="fileBtn" type="button" role="menuitem">Attach</button>
          <button id="imageBtn" type="button" role="menuitem">&#x4E0A;&#x4F20;&#x56FE;&#x7247;</button>
        </div>
      </div>
    </div>

    <textarea
      id="input"
      placeholder="&#x8F93;&#x5165;&#x95EE;&#x9898;&#x3001;&#x641C;&#x7D22;&#x5173;&#x952E;&#x8BCD;&#x6216;&#x7F51;&#x9875; URL..."
      rows="1"
    ></textarea>

    <div id="browserToolPanel" class="browserToolPanel" aria-hidden="true">
      <input id="browserToolUrlInput" class="browserToolInput" type="url" placeholder="https://example.com" />
      <button id="browserToolBtn" class="browserToolBtn" type="button">Run</button>
    </div>

    <div class="inputPrimaryActions">
      <button id="browserToolToggleBtn" class="browserToolToggleBtn" type="button" aria-expanded="false">Browser</button>

      <div class="inputMenuWrap toolMenuWrap">
        <button id="toolMenuBtn" class="toolBtn" type="button" aria-haspopup="menu" aria-expanded="false" title="&#x8054;&#x7F51;&#x002F;&#x5DE5;&#x5177;">&#x8054;&#x7F51;</button>
        <div id="toolMenu" class="inputMenu toolMenu" role="menu">
          <button id="searchBtn" type="button" role="menuitem">&#x641C;&#x7D22;</button>
          <button id="webAnswerBtn" type="button" role="menuitem">&#x8054;&#x7F51;&#x67E5;&#x8BE2;</button>
          <button id="fetchUrlBtn" type="button" role="menuitem">&#x6293;&#x53D6;&#x7F51;&#x9875;</button>
        </div>
      </div>

      <button id="sendBtn" type="button">
        &#x53D1;&#x9001;
      </button>
    </div>

    <div id="imagePreviewBox">
      <img id="imagePreview" />
      <button id="removeImageBtn" type="button" title="&#x79FB;&#x9664;&#x56FE;&#x7247;">&times;</button>
    </div>

  </div>

</div>

    </section>

    <aside id="contextPanel" class="contextPanel" aria-label="Context Panel">
      <div class="contextPanelHeader">
        <div class="contextPanelTitle">
          <strong>Context</strong>
          <span>Attachments and knowledge</span>
        </div>
        <button id="contextPanelClose" class="contextPanelClose" type="button" aria-label="Collapse Context Panel">&times;</button>
      </div>

      <div class="contextPanelBody">
        <section class="contextSection">
          <div class="contextSectionHeader">Current Conversation Attachment</div>
          <div id="conversationAttachmentList"></div>
          <div id="fileStatus"></div>
          <div id="fileUseMode" class="fileUseMode" aria-label="文件用途">
            <span>文件用途</span>
            <label class="fileUseModeOption"><input name="fileUseMode" type="radio" value="source" checked /> 原文读取</label>
            <label class="fileUseModeOption"><input name="fileUseMode" type="radio" value="library" /> 存入文件库</label>
            <span id="fileUseModeHint" class="fileUseModeHint">原文读取：本次发送使用，不存入文件库</span>
          </div>
          <button id="clearFileBtn" class="contextUploadBtn" type="button">&#x6E05;&#x9664;&#x5F53;&#x524D;&#x6587;&#x4EF6;</button>
          <div id="uploadStatus"></div>
          <div class="contextHint">Files attached here use the existing conversation attachment flow.</div>
        </section>

        <section class="contextSection">
          <div id="libraryPanel" class="libraryPanel collapsed">
            <div id="libraryToggle" class="libraryHeader" role="button" tabindex="0" aria-expanded="false">
              <div class="libraryTitle">
                <span aria-hidden="true">&#x1F4C1;</span>
                <strong>Knowledge Base&#xFF08;<span id="fileLibraryCount">0</span>&#xFF09;</strong>
              </div>
              <span class="libraryChevron" aria-hidden="true">&#x203A;</span>
            </div>
            <div id="filesLibraryBody" class="libraryBody">
              <div class="libraryHeader">
                <strong>&#x6587;&#x4EF6;</strong>
                <button id="refreshFilesBtn" type="button">&#x5237;&#x65B0;</button>
              </div>
              <div class="librarySearch">
                <input id="fileSearchInput" type="search" placeholder="&#x641C;&#x7D22;&#x6587;&#x4EF6;" />
                <button id="fileSearchBtn" type="button">&#x641C;&#x7D22;</button>
              </div>
              <select id="fileSortSelect" class="librarySort">
                <option value="latest">&#x6700;&#x65B0;&#x4F18;&#x5148;</option>
                <option value="name">&#x6587;&#x4EF6;&#x540D; A-Z</option>
                <option value="size">&#x6587;&#x4EF6;&#x5927;&#x5C0F;</option>
              </select>
              <div class="librarySelectedRow">
                <div id="selectedFilesCount" class="libraryCount">&#x5DF2;&#x9009;&#x62E9; 0 &#x4E2A;&#x6587;&#x4EF6;</div>
                <button id="clearSelectedFilesBtn" class="clearSelectedFilesBtn" type="button">&#x6E05;&#x7A7A;</button>
              </div>
              <div id="filesList" class="filesList"></div>
            </div>
          </div>
        </section>

        <section class="contextSection">
          <div class="contextSectionHeader">Upload</div>
          <div class="contextUploadActions">
            <button id="contextAttachBtn" class="contextUploadBtn" type="button">Attach to conversation</button>
            <button id="contextKnowledgeUploadBtn" class="contextUploadBtn" type="button">Upload to Knowledge Base</button>
          </div>
        </section>
      </div>
    </aside>

  </div>

</div>

<script>
window.__APP_PHASE__ = "phase10.3-image-paste";

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const chat = document.getElementById("chat");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const mainLayout = document.querySelector(".main");
const contextPanelToggle = document.getElementById("contextPanelToggle");
const contextPanel = document.getElementById("contextPanel");
const contextPanelClose = document.getElementById("contextPanelClose");
const contextAttachBtn = document.getElementById("contextAttachBtn");
const contextKnowledgeUploadBtn = document.getElementById("contextKnowledgeUploadBtn");
const newChatBtn = document.getElementById("newChatBtn");
const projectList = document.getElementById("projectList");
const createProjectBtn = document.getElementById("createProjectBtn");
const projectStatus = document.getElementById("projectStatus");
const projectSettingsPopover = document.getElementById("projectSettingsPopover");
const projectSettingsPopoverBody = document.getElementById("projectSettingsPopoverBody");
const projectSettingsCloseBtn = document.getElementById("projectSettingsCloseBtn");
const chatSearchInput = document.getElementById("chatSearchInput");
const conversationList = document.getElementById("conversationList");
const archivePanel = document.getElementById("archivePanel");
const archiveToggleBtn = document.getElementById("archiveToggleBtn");
const archiveChevron = document.getElementById("archiveChevron");
const archiveBody = document.getElementById("archiveBody");
const conversationLoadMoreBtn = document.getElementById("conversationLoadMoreBtn");
const libraryPanel = document.getElementById("libraryPanel");
const libraryToggle = document.getElementById("libraryToggle");
const fileLibraryCount = document.getElementById("fileLibraryCount");
const refreshFilesBtn = document.getElementById("refreshFilesBtn");
const fileSearchInput = document.getElementById("fileSearchInput");
const fileSearchBtn = document.getElementById("fileSearchBtn");
const fileSortSelect = document.getElementById("fileSortSelect");
const selectedFilesCount = document.getElementById("selectedFilesCount");
const clearSelectedFilesBtn = document.getElementById("clearSelectedFilesBtn");
const filesList = document.getElementById("filesList");
const summaryStatus = document.getElementById("summaryStatus");
const viewSummaryBtn = document.getElementById("viewSummaryBtn");

const input = document.getElementById("input");
const inputShell = document.querySelector(".inputShell");
const attachmentMenuBtn = document.getElementById("attachmentMenuBtn");
const attachmentMenu = document.getElementById("attachmentMenu");

const contextStatus = document.getElementById("contextStatus");
const openClawTaskBanner = document.getElementById("openClawTaskBanner");
const openClawTaskHistoryToggle = document.getElementById("openClawTaskHistoryToggle");
const openClawTaskHistoryPanel = document.getElementById("openClawTaskHistoryPanel");
const openClawTaskHistoryRefresh = document.getElementById("openClawTaskHistoryRefresh");
const openClawTaskHistoryList = document.getElementById("openClawTaskHistoryList");

const toolMenuBtn = document.getElementById("toolMenuBtn");
const toolMenu = document.getElementById("toolMenu");
const searchBtn = document.getElementById("searchBtn");

const webAnswerBtn = document.getElementById("webAnswerBtn");
let webSearchContext = "";
let webSearchSources = [];
let pendingToolCall = null;

let searchResults = document.getElementById("searchResults");
let currentConversationId = null;
let conversationsCache = [];
let commonConversationsCache = [];
let archiveSourceConversations = [];
let conversationPageState = {
  projectId:"",
  cursor:"",
  hasMore:false,
  loading:false,
  searchQuery:""
};
let projectsCache = [];
let projectOpenClawRuntimes = [];
let openClawRuntimeRegistry = [];
let projectActionMenu = null;
let projectActionMenuProjectId = "";
const DEFAULT_PROJECT_ID = "default";
const COMMON_WORKSPACE_KEY = "common";
const SELECTED_PROJECT_STORAGE_KEY = "selected_project_id";
const SELECTED_WORKSPACE_STORAGE_KEY = "selected_workspace";
const EXPANDED_PROJECTS_STORAGE_KEY = "expanded_project_ids";
function workspaceKeyForProjectId(projectId){
  const id = String(projectId || "").trim();
  return !id || id === DEFAULT_PROJECT_ID ? COMMON_WORKSPACE_KEY : "project:" + id;
}
function projectIdFromWorkspaceKey(workspaceKey){
  const key = String(workspaceKey || "").trim();
  return key.startsWith("project:") ? key.slice("project:".length) || DEFAULT_PROJECT_ID : DEFAULT_PROJECT_ID;
}
function parseExpandedProjectIds(value){
  try{
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(item => String(item || "").trim()).filter(Boolean) : [];
  }catch(err){
    return [];
  }
}
let activeWorkspaceKey = localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY) || workspaceKeyForProjectId(localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY));
let activeProjectId = projectIdFromWorkspaceKey(activeWorkspaceKey);
let expandedProjectIds = new Set(parseExpandedProjectIds(localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY)));
const WELCOME_HIDDEN_KEY = "welcome_hidden";
syncWelcomeVisibility();

const fetchUrlBtn = document.getElementById("fetchUrlBtn");
const browserToolPanel = document.getElementById("browserToolPanel");
const browserToolToggleBtn = document.getElementById("browserToolToggleBtn");
const browserToolUrlInput = document.getElementById("browserToolUrlInput");
const browserToolBtn = document.getElementById("browserToolBtn");

let selectedWebPage = null;
let selectedWebPageChunks = [];
let lastWebRelevantChunkCount = 0;

const sendBtn = document.getElementById("sendBtn");
const SEND_BUTTON_TEXT = sendBtn.textContent.trim() || "Send";
const INPUT_MAX_HEIGHT = 180;
let activeChatAbortController = null;
let openClawWaitTimers = [];
let openClawTasks = [];
let activeOpenClawTask = null;
let ignoredOpenClawTaskIds = new Set();
let allowOpenClawRepeatOnce = false;
let openClawTaskHistoryView = "recent";
let openClawReconnectTask = null;
let openClawReconnectPollingTimer = null;
let openClawReconnectPollingTaskId = "";
let openClawCompletedRemoteSyncAttempts = new Map();
let openClawAutoResumeAttempts = new Set();
let openClawBridgeEventSource = null;
let openClawBridgeEventTaskId = "";
const OPENCLAW_RECONNECT_POLL_MS = 4000;
const OPENCLAW_AUTO_RESUME_MESSAGE = "Connection interrupted; trying to resume the remote task...";

const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const imagePreviewBox = document.getElementById("imagePreviewBox");
const imagePreview = document.getElementById("imagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const uploadStatus = document.getElementById("uploadStatus");
const pastedImageNotice = document.getElementById("pastedImageNotice");
const pastedImagePreviewList = document.getElementById("pastedImagePreviewList");

let selectedImage = null;
let pastedImageAttachments = [];
const MAX_PASTED_IMAGES = 3;

const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");
const fileStatus = document.getElementById("fileStatus");
const fileUseMode = document.getElementById("fileUseMode");
const fileUseModeHint = document.getElementById("fileUseModeHint");
const conversationAttachmentList = document.getElementById("conversationAttachmentList");
const clearFileBtn = document.getElementById("clearFileBtn");

const FILE_USE_SOURCE = "source";
const FILE_USE_LIBRARY = "library";
let selectedFileUseMode = FILE_USE_SOURCE;
let selectedFile = null;
let selectedFileId = null;
let selectedFileText = "";
let selectedFileChunks = [];
let lastRelevantChunkCount = 0;
let pendingConversationAttachments = [];
let conversationAttachmentDraftId = crypto.randomUUID();
let filesLibrary = [];
let selectedFileIds = [];
let fileLibraryQuery = "";
let fileLibrarySort = "latest";
let isFileLibraryExpanded = false;
let isContextPanelOpen = false;
let activeLibraryActionFileId = null;
let activeInputMenu = null;
let expandedFileId = null;
let fileDetailsCache = {};
let fileChunksCache = {};
let sourcePreviewCache = {};

function showLogin(){
  document.body.classList.remove("authenticated");
}

function showApp(){
  document.body.classList.add("authenticated");
}

async function checkAuth(){
  try{
    const res = await fetch("/api/auth/me");
    const data = await res.json();

    if(res.ok && data.ok && data.authenticated){
      showApp();
      await loadModels();
      await loadProjects();
      await loadConversations();
      await loadFilesLibrary();
      input.focus();
      return;
    }
  }catch(err){
    console.log("auth check failed", err);
  }

  showLogin();
  loginUsername.focus();
}

async function login(event){
  event.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;

  try{
    const res = await fetch("/api/auth/login", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        username:loginUsername.value.trim(),
        password:loginPassword.value
      })
    });
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "\u767b\u5f55\u5931\u8d25");
    }

    loginPassword.value = "";
    showApp();
    await loadModels();
    await loadProjects();
    await loadConversations();
    await loadFilesLibrary();
    input.focus();
  }catch(err){
    loginError.textContent = err.message || "\u767b\u5f55\u5931\u8d25";
  }

  loginBtn.disabled = false;
}

async function logout(){
  try{
    await fetch("/api/auth/logout", {
      method:"POST"
    });
  }catch(err){
    console.log("logout failed", err);
  }

  showLogin();
  loginPassword.value = "";
  loginUsername.focus();
}

async function loadModels(){
  try{
    const currentValue = modelSelect.value;
    const res = await fetch("/api/models");
    const data = await res.json();

    if(!res.ok || !Array.isArray(data.models) || !data.models.length){
      throw new Error("models unavailable");
    }

    modelSelect.innerHTML = "";

    data.models
      .filter(model => !model.deprecated && model.enabled !== false && model.capabilities?.text)
      .forEach(model => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = (model.label || model.id) + (model.recommended ? " / 推荐" : "");
        option.dataset.provider = model.provider || "workers-ai";
        modelSelect.appendChild(option);
      });

    if([...modelSelect.options].some(option => option.value === currentValue)){
      modelSelect.value = currentValue;
    }
  }catch(err){
    console.log("load models failed, using fallback options", err);
  }
}

function safeJsonParse(value, fallback){
  try{
    return JSON.parse(value || "");
  }catch(err){
    return fallback;
  }
}

function providerLabelFromModel(model){
  if((model.provider || "") === "cloudflare-proxied") return "Cloudflare proxied Claude";
  if((model.provider || "") === "glm") return "GLM Coding";
  if((model.provider || "") === "kimi") return "Kimi";
  if(model.providerType === "openai-compatible") return "Custom OpenAI-compatible";
  return "Workers AI";
}

function providersFromModels(models){
  const map = new Map();
  (models || []).forEach(model => {
    if(model.deprecated || model.enabled === false || !model.capabilities?.text) return;
    const key = model.provider || model.providerType || "workers-ai";
    if(!map.has(key)){
      map.set(key, {
        id:key,
        label:providerLabelFromModel(model),
        providerType:model.providerType || "workers-ai",
        apiBase:model.apiBase || "",
        apiKeyEnv:model.apiKeyEnv || "",
        builtin:true,
        models:[]
      });
    }
    map.get(key).models.push({
      id:model.id,
      label:model.label || model.id,
      modelName:model.modelName || model.id,
      providerType:model.providerType || "workers-ai",
      apiBase:model.apiBase || "",
      apiKeyEnv:model.apiKeyEnv || "",
      capabilities:model.capabilities || { text:true, streaming:true },
      enabled:model.enabled !== false,
      recommended:Boolean(model.recommended)
    });
  });
  if(!map.has("openai-compatible")){
    map.set("openai-compatible", {
      id:"openai-compatible",
      label:"Custom OpenAI-compatible",
      providerType:"openai-compatible",
      apiBase:"",
      apiKeyEnv:"",
      builtin:true,
      models:[]
    });
  }
  return Array.from(map.values());
}

function readLegacyModelSettings(){
  return {
    defaultModel:localStorage.getItem("defaultModel") || "",
    rememberLastModel:localStorage.getItem("rememberLastModel") === "true",
    lastModel:localStorage.getItem("selectedModel") || "",
    fallbackEnabled:localStorage.getItem("autoFallbackEnabled") === "true",
    fallbackModels:localStorage.getItem("fallbackModel") ? [localStorage.getItem("fallbackModel")] : [],
    customModels:safeJsonParse(localStorage.getItem("customModels"), []),
    customProviders:[],
    providers:null
  };
}

function normalizeModelSettings(settings, fallbackProviders){
  const base = settings && typeof settings === "object" ? settings : readLegacyModelSettings();
  return {
    defaultModel:base.defaultModel || "",
    rememberLastModel:Boolean(base.rememberLastModel),
    lastModel:base.lastModel || base.selectedModel || "",
    fallbackEnabled:Boolean(base.fallbackEnabled ?? base.autoFallbackEnabled),
    fallbackModels:Array.isArray(base.fallbackModels) ? base.fallbackModels : (base.fallbackModel ? [base.fallbackModel] : []),
    showPerMessageModelInfo:Boolean(base.showPerMessageModelInfo),
    autoArchiveDays:normalizeAutoArchiveDays(base.autoArchiveDays),
    customModels:Array.isArray(base.customModels) ? base.customModels : [],
    customProviders:Array.isArray(base.customProviders) ? base.customProviders : [],
    conversationAttachmentLimits:normalizeConversationAttachmentLimits(base.conversationAttachmentLimits),
    providers:Array.isArray(base.providers) && base.providers.length ? base.providers : fallbackProviders
  };
}

function normalizeAutoArchiveDays(value){
  if(value === "never" || value === "Never" || value === 0 || value === "0"){
    return "never";
  }
  const days = Number(value || 90);
  return [30,60,90].includes(days) ? String(days) : "90";
}

function writeSettingsCache(settings){
  localStorage.setItem("model_settings", JSON.stringify(settings));
  localStorage.setItem("defaultModel", settings.defaultModel || "");
  localStorage.setItem("rememberLastModel", String(Boolean(settings.rememberLastModel)));
  localStorage.setItem("autoFallbackEnabled", String(Boolean(settings.fallbackEnabled)));
  localStorage.setItem("fallbackModel", settings.fallbackModels?.[0] || "");
  if(settings.rememberLastModel && settings.lastModel){
    localStorage.setItem("selectedModel", settings.lastModel);
  }else{
    localStorage.removeItem("selectedModel");
  }
}

async function syncSettingsToServer(settings){
  try{
    const res = await fetch("/api/settings", {
      method:"POST",
      headers:{ "Content-Type":"application/json; charset=utf-8" },
      body:JSON.stringify({ settings })
    });
    if(!res.ok) throw new Error(await res.text());
    settingsSyncStatus.textContent = "Synced";
  }catch(err){
    console.warn("settings sync failed", err);
    settingsSyncStatus.textContent = "设置已本地保存，云端同步失败";
  }
}

async function loadSettingsFromServer(fallbackProviders){
  try{
    const res = await fetch("/api/settings");
    const data = await res.json();
    if(res.ok && data.ok && data.settings){
      const settings = normalizeModelSettings(data.settings, fallbackProviders);
      writeSettingsCache(settings);
      return settings;
    }
  }catch(err){
    console.warn("load settings failed, using local cache", err);
  }
  return normalizeModelSettings(safeJsonParse(localStorage.getItem("model_settings"), null), fallbackProviders);
}

function flattenProviders(providers){
  return (providers || []).flatMap(provider => (provider.models || []).map(model => ({
    ...model,
    provider:provider.id,
    providerLabel:provider.label,
    providerType:model.providerType || provider.providerType,
    apiBase:model.apiBase || provider.apiBase || "",
    apiKeyEnv:model.apiKeyEnv || provider.apiKeyEnv || ""
  })));
}

function renderModelOptions(){
  modelSelect.innerHTML = "";
  modelOptions = flattenProviders(modelProviders).filter(model => model.enabled !== false);
  const groups = new Map();
  modelOptions.forEach(model => {
    const groupLabel = model.providerLabel || "Models";
    if(!groups.has(groupLabel)){
      const group = document.createElement("optgroup");
      group.label = groupLabel;
      groups.set(groupLabel, group);
      modelSelect.appendChild(group);
    }
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = (model.label || model.id) + (model.recommended ? " / 推荐" : "");
    option.dataset.provider = model.provider || "";
    option.dataset.providerType = model.providerType || "";
    groups.get(groupLabel).appendChild(option);
  });
}

function hasModel(modelId){
  return Boolean(modelOptions.find(model => model.id === modelId));
}

function selectInitialModel(){
  let nextModel = "";
  if(modelSettingsState?.rememberLastModel && hasModel(modelSettingsState.lastModel)){
    nextModel = modelSettingsState.lastModel;
  }else if(hasModel(modelSettingsState?.defaultModel)){
    nextModel = modelSettingsState.defaultModel;
  }else{
    nextModel = modelOptions[0]?.id || "";
  }
  modelSelect.value = nextModel;
}

function refreshSettingsControls(){
  const fillSelect = (select, includeEmpty) => {
    select.innerHTML = "";
    if(includeEmpty){
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "None";
      select.appendChild(empty);
    }
    modelOptions.forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = (model.providerLabel ? model.providerLabel + " / " : "") + (model.label || model.id);
      select.appendChild(option);
    });
  };
  fillSelect(defaultModelSelect, false);
  fillSelect(fallbackModelSelect, true);
  defaultModelSelect.value = hasModel(modelSettingsState?.defaultModel) ? modelSettingsState.defaultModel : (modelOptions[0]?.id || "");
  fallbackModelSelect.value = hasModel(modelSettingsState?.fallbackModels?.[0]) ? modelSettingsState.fallbackModels[0] : "";
  rememberLastModelCheck.checked = Boolean(modelSettingsState?.rememberLastModel);
  fallbackEnabledCheck.checked = Boolean(modelSettingsState?.fallbackEnabled);
  showPerMessageModelInfoCheck.checked = Boolean(modelSettingsState?.showPerMessageModelInfo);
  autoArchiveDaysSelect.value = normalizeAutoArchiveDays(modelSettingsState?.autoArchiveDays);
  setConversationAttachmentLimitInputs(modelSettingsState?.conversationAttachmentLimits);
  modelProviderSelect.innerHTML = "";
  modelProviders.forEach(provider => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    modelProviderSelect.appendChild(option);
  });
  renderProvidersList();
}

async function loadModels(){
  try{
    const res = await fetch("/api/models");
    const data = await res.json();
    if(!res.ok || !Array.isArray(data.models) || !data.models.length) throw new Error("models unavailable");
    const fallbackProviders = providersFromModels(data.models);
    modelSettingsState = await loadSettingsFromServer(fallbackProviders);
    modelProviders = modelSettingsState.providers;
    renderModelOptions();
    selectInitialModel();
    refreshSettingsControls();
    writeSettingsCache(modelSettingsState);
    syncSettingsToServer(modelSettingsState);
  }catch(err){
    console.log("load models failed", err);
  }
}

function setContextStatus(text){
  contextStatus.textContent = text || "";
}

function getCurrentContextStatus(){
  const contexts = [];

  if(selectedFile){
    contexts.push("\u6587\u4ef6\uff1a" + selectedFile.name);
  }

  if(pendingConversationAttachments.length){
    contexts.push("Attachments: " + pendingConversationAttachments.map(item => item.filename || "file").join(", "));
  }

  if(selectedWebPage){
    contexts.push("\u7f51\u9875\uff1a" + selectedWebPage.title);
  }

  return contexts.length
    ? "\u5f53\u524d\u4e0a\u4e0b\u6587\uff1a" + contexts.join(" / ")
    : "";
}

function formatFileSize(size){
  const value = Number(size || 0);

  if(value >= 1024 * 1024){
    return (value / 1024 / 1024).toFixed(1) + " MB";
  }

  if(value >= 1024){
    return (value / 1024).toFixed(1) + " KB";
  }

  return value + " B";
}

function formatDate(value){
  if(!value){
    return "";
  }

  const date = new Date(value);

  if(Number.isNaN(date.getTime())){
    return String(value);
  }

  return date.toLocaleString();
}

function formatHistoryTime(value){
  if(!value){
    return "";
  }

  const date = new Date(value);

  if(Number.isNaN(date.getTime())){
    return "";
  }

  return date.toLocaleDateString([], { month:"2-digit", day:"2-digit" });
}

function setFileLibraryExpanded(expanded){
  isFileLibraryExpanded = Boolean(expanded);
  libraryPanel.classList.toggle("expanded", isFileLibraryExpanded);
  libraryPanel.classList.toggle("collapsed", !isFileLibraryExpanded);
  libraryToggle.setAttribute("aria-expanded", String(isFileLibraryExpanded));
}

function toggleFileLibrary(){
  setFileLibraryExpanded(!isFileLibraryExpanded);
}

function setContextPanelOpen(open){
  isContextPanelOpen = Boolean(open);
  mainLayout.classList.toggle("contextPanelOpen", isContextPanelOpen);
  contextPanelToggle.classList.toggle("active", isContextPanelOpen);
  contextPanelToggle.setAttribute("aria-expanded", String(isContextPanelOpen));
  contextPanel.setAttribute("aria-hidden", String(!isContextPanelOpen));
}

function toggleContextPanel(){
  setContextPanelOpen(!isContextPanelOpen);
}

function closeInputMenus(){
  activeInputMenu = null;
  attachmentMenu.classList.remove("open");
  toolMenu.classList.remove("open");
  attachmentMenuBtn.setAttribute("aria-expanded", "false");
  toolMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleInputMenu(menuName){
  const nextMenu = activeInputMenu === menuName ? null : menuName;
  closeInputMenus();

  if(nextMenu === "attachment"){
    activeInputMenu = nextMenu;
    attachmentMenu.classList.add("open");
    attachmentMenuBtn.setAttribute("aria-expanded", "true");
  }

  if(nextMenu === "tool"){
    activeInputMenu = nextMenu;
    toolMenu.classList.add("open");
    toolMenuBtn.setAttribute("aria-expanded", "true");
  }
}

function updateSelectedFilesStatus(){
  selectedFilesCount.textContent = "\u5df2\u9009\u62e9 " + selectedFileIds.length + " \u4e2a\u6587\u4ef6";
  clearSelectedFilesBtn.style.display = selectedFileIds.length ? "inline-block" : "none";
  updateFileUseModeVisibility();
}

function setSelectedFilesStatus(){
  setContextStatus(selectedFileIds.length ? "\u5df2\u9009\u62e9 " + selectedFileIds.length + " \u4e2a\u6587\u4ef6" : getCurrentContextStatus());
}

function getSortedFilesLibrary(){
  return [...filesLibrary].sort((a, b) => {
    if(fileLibrarySort === "name"){
      return String(a.filename || "").localeCompare(String(b.filename || ""));
    }

    if(fileLibrarySort === "size"){
      return Number(b.size || 0) - Number(a.size || 0);
    }

    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function renderFileDetailPanel(fileId){
  const panel = document.createElement("div");
  panel.className = "fileDetailPanel";

  const detail = fileDetailsCache[fileId];
  const chunks = fileChunksCache[fileId];

  if(!detail || !chunks){
    panel.textContent = "\u6b63\u5728\u52a0\u8f7d\u8be6\u60c5...";
    return panel;
  }

  const title = document.createElement("div");
  title.className = "fileDetailTitle";
  title.textContent = detail.filename || "file";
  panel.appendChild(title);

  const meta = document.createElement("div");
  meta.textContent =
    "\u7c7b\u578b\uff1a" + (detail.content_type || "-") +
    " / \u5927\u5c0f\uff1a" + formatFileSize(detail.size) +
    " / chunk\uff1a" + Number(detail.chunk_count || 0);
  panel.appendChild(meta);

  const created = document.createElement("div");
  created.textContent = "\u4e0a\u4f20\u65f6\u95f4\uff1a" + formatDate(detail.created_at);
  panel.appendChild(created);

  const preview = document.createElement("div");
  preview.className = "filePreview";
  preview.textContent = detail.text_preview || "\u6682\u65e0\u6587\u672c\u9884\u89c8";
  panel.appendChild(preview);

  const chunkTitle = document.createElement("div");
  chunkTitle.className = "fileDetailTitle";
  chunkTitle.textContent = "\u7247\u6bb5\u9884\u89c8";
  panel.appendChild(chunkTitle);

  (chunks || []).slice(0, 5).forEach(chunk => {
    const chunkDiv = document.createElement("div");
    chunkDiv.className = "chunkPreview";
    chunkDiv.textContent =
      "Chunk " + chunk.chunk_index +
      " (" + Number(chunk.length || 0) + " chars)" +
      String.fromCharCode(10) +
      (chunk.content_preview || "");
    panel.appendChild(chunkDiv);
  });

  if(!chunks.length){
    const empty = document.createElement("div");
    empty.textContent = "\u6682\u65e0 chunk";
    panel.appendChild(empty);
  }

  return panel;
}

function renderFilesLibrary(){
  fileLibraryCount.textContent = String(filesLibrary.length);
  filesList.innerHTML = "";
  updateSelectedFilesStatus();

  if(!filesLibrary.length){
    const empty = document.createElement("div");
    empty.className = "libraryCount";
    empty.textContent = "\u6682\u65e0\u6587\u4ef6";
    filesList.appendChild(empty);
    return;
  }

  getSortedFilesLibrary().forEach(file => {
    const selected = selectedFileIds.includes(file.id);
    const actionsOpen = activeLibraryActionFileId === file.id;
    const detailOpen = expandedFileId === file.id;
    const item = document.createElement("div");
    item.className = "fileLibraryItem"
      + (selected ? " selected" : "")
      + (actionsOpen ? " actionsOpen" : "")
      + (detailOpen ? " detailOpen" : "");
    item.addEventListener("click", event => {
      if(event.target?.closest?.("button")){
        return;
      }
      if(!window.matchMedia || !window.matchMedia("(hover: none), (pointer: coarse)").matches){
        return;
      }
      activeLibraryActionFileId = activeLibraryActionFileId === file.id ? null : file.id;
      renderFilesLibrary();
    });

    const name = document.createElement("div");
    name.className = "fileLibraryName";
    name.textContent = file.filename || "file";
    name.title = name.textContent;

    const meta = document.createElement("div");
    meta.className = "fileLibraryMeta";
    meta.textContent =
      formatFileSize(file.size) +
      " / chunk " + Number(file.chunk_count || 0) +
      " / " + formatDate(file.created_at);

    const actions = document.createElement("div");
    actions.className = "fileLibraryActions";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = selected ? "selectedAction" : "";
    selectBtn.textContent = selected ? "\u53d6\u6d88" : "\u9009\u62e9";
    selectBtn.addEventListener("click", event => {
      event.stopPropagation();
      toggleLibraryFile(file.id);
    });

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.textContent = expandedFileId === file.id ? "\u6536\u8d77" : "\u8be6\u60c5";
    detailBtn.addEventListener("click", event => {
      event.stopPropagation();
      toggleFileDetails(file.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "deleteFileAction";
    deleteBtn.textContent = "\u5220\u9664";
    deleteBtn.addEventListener("click", event => {
      event.stopPropagation();
      deleteLibraryFile(file.id, file.filename || "file");
    });

    actions.appendChild(selectBtn);
    actions.appendChild(detailBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(actions);

    if(detailOpen){
      item.appendChild(renderFileDetailPanel(file.id));
    }

    filesList.appendChild(item);
  });
}

async function loadFilesLibrary(options = {}){
  try{
    const query = typeof options.query === "string" ? options.query : fileLibraryQuery;
    const url = query ? "/api/files?q=" + encodeURIComponent(query) : "/api/files";
    const res = await fetch(url);
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "\u6587\u4ef6\u5e93\u52a0\u8f7d\u5931\u8d25");
    }

    filesLibrary = data.files || [];

    if(options.pruneSelection || !query){
      const existingIds = new Set(filesLibrary.map(file => file.id));
      selectedFileIds = selectedFileIds.filter(id => existingIds.has(id));
      selectedFileId = selectedFileId && existingIds.has(selectedFileId) ? selectedFileId : null;
    }

    renderFilesLibrary();
    setSelectedFilesStatus();
  }catch(err){
    setContextStatus("\u6587\u4ef6\u5e93\u52a0\u8f7d\u5931\u8d25");
    console.log("load files failed", err);
  }
}

function searchFilesLibrary(){
  fileLibraryQuery = fileSearchInput.value.trim();
  loadFilesLibrary({ query:fileLibraryQuery, pruneSelection:false });
}

function clearSelectedLibraryFiles(){
  selectedFileIds = [];
  selectedFileId = null;
  renderFilesLibrary();
  setSelectedFilesStatus();
}

async function toggleFileDetails(fileId){
  if(expandedFileId === fileId){
    expandedFileId = null;
    renderFilesLibrary();
    return;
  }

  expandedFileId = fileId;
  renderFilesLibrary();

  if(fileDetailsCache[fileId] && fileChunksCache[fileId]){
    return;
  }

  try{
    const detailRes = await fetch("/api/files/" + encodeURIComponent(fileId));
    const detailData = await detailRes.json();

    if(!detailRes.ok || !detailData.ok){
      throw new Error(detailData.error || "\u6587\u4ef6\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25");
    }

    const chunksRes = await fetch("/api/files/" + encodeURIComponent(fileId) + "/chunks");
    const chunksData = await chunksRes.json();

    if(!chunksRes.ok || !chunksData.ok){
      throw new Error(chunksData.error || "chunk \u9884\u89c8\u52a0\u8f7d\u5931\u8d25");
    }

    fileDetailsCache[fileId] = detailData.file;
    fileChunksCache[fileId] = chunksData.chunks || [];
    renderFilesLibrary();
  }catch(err){
    setContextStatus("\u6587\u4ef6\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25");
    console.log("load file detail failed", err);
  }
}

function toggleLibraryFile(fileId){
  if(pendingConversationAttachments.length){
    pendingConversationAttachments = [];
    renderConversationAttachments();
  }
  setFileUseMode(FILE_USE_LIBRARY);
  if(selectedFileIds.includes(fileId)){
    selectedFileIds = selectedFileIds.filter(id => id !== fileId);

    if(selectedFileId === fileId){
      selectedFileId = null;
    }
  }else{
    selectedFileIds.push(fileId);
  }

  renderFilesLibrary();
  setSelectedFilesStatus();
  clearFileBtn.style.display = selectedFileIds.length ? "inline-block" : "none";
}

async function deleteLibraryFile(fileId, filename){
  if(!confirm("\u786e\u5b9a\u5220\u9664\u6587\u4ef6\u201c" + filename + "\u201d\u5417\uff1f")){
    return;
  }

  try{
    const res = await fetch("/api/files/" + encodeURIComponent(fileId), {
      method:"DELETE"
    });
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "\u5220\u9664\u5931\u8d25");
    }

    filesLibrary = filesLibrary.filter(file => file.id !== fileId);
    selectedFileIds = selectedFileIds.filter(id => id !== fileId);

    if(selectedFileId === fileId){
      selectedFileId = null;
    }

    if(expandedFileId === fileId){
      expandedFileId = null;
    }

    delete fileDetailsCache[fileId];
    delete fileChunksCache[fileId];

    renderFilesLibrary();
    setContextStatus("\u6587\u4ef6\u5df2\u5220\u9664");
  }catch(err){
    setContextStatus("\u5220\u9664\u5931\u8d25");
    console.log("delete file failed", err);
  }
}

function currentFileUseMode(){
  return selectedFileUseMode === FILE_USE_LIBRARY ? FILE_USE_LIBRARY : FILE_USE_SOURCE;
}

function updateFileUseModeVisibility(){
  const hasFiles = pendingConversationAttachments.length || selectedFileIds.length;
  if(fileUseMode){
    fileUseMode.classList.toggle("visible", Boolean(hasFiles));
  }
  if(fileUseModeHint){
    fileUseModeHint.textContent = currentFileUseMode() === FILE_USE_LIBRARY
      ? "存入文件库：生成索引，后续对话可检索"
      : "原文读取：本次发送使用，不存入文件库";
  }
}

function setFileUseMode(mode){
  selectedFileUseMode = mode === FILE_USE_LIBRARY ? FILE_USE_LIBRARY : FILE_USE_SOURCE;
  document.querySelectorAll("input[name='fileUseMode']").forEach(input => {
    input.checked = input.value === selectedFileUseMode;
  });
  updateFileUseModeVisibility();
}

function clearSelectedFile(){

  selectedFile = null;
  selectedFileId = null;
  selectedFileText = "";
  selectedFileChunks = [];
  lastRelevantChunkCount = 0;
  pendingConversationAttachments = [];
  selectedFileIds = [];
  conversationAttachmentDraftId = crypto.randomUUID();
  fileInput.value = "";
  fileStatus.textContent = "";
  renderConversationAttachments();
  renderFilesLibrary();
  updateFileUseModeVisibility();
  setContextStatus(getCurrentContextStatus());
  clearFileBtn.style.display = "none";
}

function renderConversationAttachments(){
  if(!conversationAttachmentList){
    return;
  }
  conversationAttachmentList.innerHTML = "";
  conversationAttachmentList.style.display = pendingConversationAttachments.length ? "flex" : "none";
  updateFileUseModeVisibility();

  pendingConversationAttachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "conversationAttachmentChip";

    const name = document.createElement("span");
    name.className = "conversationAttachmentName";
    name.textContent = attachment.filename || "file";
    name.title = name.textContent;

    const size = document.createElement("span");
    size.textContent = formatFileSize(attachment.size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "conversationAttachmentRemove";
    remove.title = "\u79fb\u9664\u9644\u4ef6";
    remove.textContent = "\u00d7";
    remove.addEventListener("click", () => {
      pendingConversationAttachments.splice(index, 1);
      renderConversationAttachments();
      clearFileBtn.style.display = pendingConversationAttachments.length ? "inline-block" : "none";
      setContextStatus(getCurrentContextStatus());
    });

    chip.appendChild(name);
    chip.appendChild(size);
    chip.appendChild(remove);
    conversationAttachmentList.appendChild(chip);
  });
}

function conversationAttachmentSupportedByUi(file){
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "");
  const isTextFile =
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    name.endsWith(".json") ||
    type.startsWith("text/");
  const isDocumentFile =
    name.endsWith(".pdf") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx") ||
    name.endsWith(".zip");
  const isNativeMedia = type.startsWith("image/") || type.startsWith("audio/");
  const isVideoFile = type.startsWith("video/") ||
    [".avi",".m4v",".mov",".mp4",".mpeg",".mpg",".webm"].some(ext => name.endsWith(ext));

  return !isVideoFile && (isTextFile || isDocumentFile || isNativeMedia);
}

async function uploadConversationAttachment(file){
  const formData = new FormData();
  formData.append("file", file);

  if(currentConversationId){
    formData.append("conversation_id", currentConversationId);
  }else{
    formData.append("draft_id", conversationAttachmentDraftId);
  }

  const res = await fetch("/api/conversation-attachments/upload", {
    method:"POST",
    body:formData
  });
  const data = await res.json();

  if(!res.ok || !data.ok){
    throw new Error(data.error || "Attachment upload failed");
  }

  return data.attachment;
}

async function attachConversationFiles(files){
  const acceptedFiles = Array.from(files || []).filter(Boolean);
  if(!acceptedFiles.length){
    return;
  }

  if(pendingConversationAttachments.length + acceptedFiles.length > 5){
    alert("最多只能添加 5 个原文附件。");
    return;
  }

  const unsupported = acceptedFiles.find(file => !conversationAttachmentSupportedByUi(file));
  if(unsupported){
    alert("当前支持 PDF / Word / Excel / PPT / TXT / Markdown / CSV / JSON / ZIP / 图片 / 音频文件");
    return;
  }

  pendingConversationAttachments.push(...acceptedFiles.map(file => ({
    filename:file.name || "file",
    content_type:file.type || "application/octet-stream",
    size:file.size || 0,
    file
  })));
  selectedFile = acceptedFiles[0] || null;
  selectedFileId = null;
  selectedFileText = "";
  selectedFileChunks = [];
  lastRelevantChunkCount = 0;
  renderConversationAttachments();
  clearFileBtn.style.display = pendingConversationAttachments.length ? "inline-block" : "none";
  setContextPanelOpen(true);
  setContextStatus("已添加 " + pendingConversationAttachments.length + " 个待处理文件，请选择原文读取或存入文件库");
  fileInput.value = "";
}

function clearSelectedImage(){

  selectedImage = null;
  imageInput.value = "";
  imagePreview.src = "";
  imagePreviewBox.style.display = "none";
  uploadStatus.textContent = "";
  setContextStatus(getCurrentContextStatus());
}

function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read image failed"));
    reader.readAsDataURL(file);
  });
}

function showPastedImageNotice(message){
  pastedImageNotice.textContent = message || "";
  pastedImageNotice.style.display = message ? "block" : "none";
}

function renderPastedImagePreviews(){
  pastedImagePreviewList.innerHTML = "";
  pastedImagePreviewList.style.display = pastedImageAttachments.length ? "flex" : "none";

  pastedImageAttachments.forEach((attachment, index) => {
    const item = document.createElement("div");
    item.className = "pastedImagePreview";

    const img = document.createElement("img");
    img.src = attachment.dataUrl;
    img.alt = "\u7c98\u8d34\u7684\u56fe\u7247 " + (index + 1);
    item.appendChild(img);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "removePastedImageBtn";
    button.title = "\u79fb\u9664\u56fe\u7247";
    button.textContent = "\u00d7";
    button.addEventListener("click", () => {
      pastedImageAttachments.splice(index, 1);
      renderPastedImagePreviews();
      if(pastedImageAttachments.length < MAX_PASTED_IMAGES){
        showPastedImageNotice("");
      }
      setContextStatus(getCurrentContextStatus());
      input.focus();
    });
    item.appendChild(button);

    pastedImagePreviewList.appendChild(item);
  });
}

function clearPastedImageAttachments(){
  pastedImageAttachments = [];
  renderPastedImagePreviews();
  showPastedImageNotice("");
}

function getClipboardImageFiles(event){
  const items = Array.from(event.clipboardData?.items || []);
  const filesFromItems = items
    .filter(item => item.kind === "file" && String(item.type || "").startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(Boolean);
  const filesFromClipboard = Array.from(event.clipboardData?.files || [])
    .filter(file => String(file.type || "").startsWith("image/"));
  return [...filesFromItems, ...filesFromClipboard]
    .filter((file, index, files) => {
      const key = [
        file.name || "",
        file.type || "",
        file.size || 0,
        file.lastModified || 0
      ].join(":");
      return files.findIndex(item => [
        item.name || "",
        item.type || "",
        item.size || 0,
        item.lastModified || 0
      ].join(":") === key) === index;
    });
}

function getClipboardConversationFiles(event){
  const items = Array.from(event.clipboardData?.items || []);
  const filesFromItems = items
    .filter(item => item.kind === "file" && !String(item.type || "").startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(Boolean);
  const filesFromClipboard = Array.from(event.clipboardData?.files || [])
    .filter(file => !String(file.type || "").startsWith("image/"));
  return [...filesFromItems, ...filesFromClipboard]
    .filter((file, index, files) => {
      const key = [
        file.name || "",
        file.type || "",
        file.size || 0,
        file.lastModified || 0
      ].join(":");
      return files.findIndex(item => [
        item.name || "",
        item.type || "",
        item.size || 0,
        item.lastModified || 0
      ].join(":") === key) === index;
    });
}

async function handleConversationFilePaste(event){
  const files = getClipboardConversationFiles(event);
  if(!files.length){
    return false;
  }
  event.preventDefault();
  await attachFilesByUseMode(files);
  return true;
}

async function handleImagePaste(event){
  const imageFiles = getClipboardImageFiles(event);

  if(!imageFiles.length){
    return false;
  }

  event.preventDefault();

  const currentImageCount = (selectedImage ? 1 : 0) + pastedImageAttachments.length;
  const availableSlots = MAX_PASTED_IMAGES - currentImageCount;

  if(availableSlots <= 0){
    showPastedImageNotice("\u6700\u591a\u53ea\u80fd\u7c98\u8d34 3 \u5f20\u56fe\u7247\uff0c\u8bf7\u5148\u79fb\u9664\u4e00\u5f20\u540e\u518d\u8bd5\u3002");
    return true;
  }

  const acceptedFiles = imageFiles.slice(0, availableSlots);
  const ignoredCount = imageFiles.length - acceptedFiles.length;

  try{
    const attachments = await Promise.all(acceptedFiles.map(async file => ({
      type:"image",
      mimeType:file.type || "image/png",
      dataUrl:await fileToDataUrl(file)
    })));
    const uniqueAttachments = attachments.filter((attachment, index, list) => {
      return list.findIndex(item => item.dataUrl === attachment.dataUrl) === index;
    });
    const nextAttachments = uniqueAttachments.slice();

    if(!selectedImage && nextAttachments.length){
      const firstAttachment = nextAttachments.shift();
      selectedImage = firstAttachment.dataUrl;
      imageInput.value = "";
      imagePreview.src = selectedImage;
      imagePreviewBox.style.display = "block";
    }

    pastedImageAttachments = pastedImageAttachments
      .concat(nextAttachments)
      .filter(attachment => attachment.dataUrl !== selectedImage)
      .filter((attachment, index, list) => list.findIndex(item => item.dataUrl === attachment.dataUrl) === index);
    renderPastedImagePreviews();
    setContextStatus("\u5df2\u7c98\u8d34 " + ((selectedImage ? 1 : 0) + pastedImageAttachments.length) + " \u5f20\u56fe\u7247\uff0c\u51c6\u5907\u53d1\u9001");
    showPastedImageNotice(ignoredCount > 0
      ? "\u6700\u591a\u53ea\u80fd\u7c98\u8d34 3 \u5f20\u56fe\u7247\uff0c\u5df2\u5ffd\u7565\u591a\u4f59\u56fe\u7247\u3002"
      : "");
  }catch(err){
    console.log("paste image failed", err);
    showPastedImageNotice("\u56fe\u7247\u7c98\u8d34\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002");
  }

  return true;
}
imageBtn.addEventListener("click", () => {
  closeInputMenus();
  imageInput.click();
});

imageInput.addEventListener("change", () => {

  const file = imageInput.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("请选择图片文件");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {

    selectedImage = reader.result;

    imagePreview.src = reader.result;
    imagePreviewBox.style.display = "block";
    setContextStatus("\u5df2\u9009\u62e9\u56fe\u7247\uff0c\u51c6\u5907\u53d1\u9001");

  };

  reader.readAsDataURL(file);

});

removeImageBtn.addEventListener("click", clearSelectedImage);

fileBtn.addEventListener("click", () => {
  closeInputMenus();
  fileInput.click();
});

document.querySelectorAll("input[name='fileUseMode']").forEach(input => {
  input.addEventListener("change", () => {
    setFileUseMode(input.value);
  });
});

async function searchWeb(){

  const query = input.value.trim();

  if(!query){
    alert("请输入搜索关键词");
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "\u641c\u7d22\u4e2d...";
  setContextStatus("\u6b63\u5728\u641c\u7d22\u7f51\u9875...");

  try{

    const res = await fetch("/search-web", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        query:query
      })
    });

    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "搜索失败");
    }

    renderSearchResults(data.results || [], data);

    setContextStatus(
      "\u641c\u7d22\u5b8c\u6210\uff1a" + query +
      "\uff08freshness: " + (data.freshness || "none") +
      "\uff0c" + (data.results || []).length + " \u6761\u7ed3\u679c\uff09"
    );

  }catch(err){

    setContextStatus("\u641c\u7d22\u5931\u8d25");
    alert("Search failed: " + err.message);

  }

  searchBtn.disabled = false;
  searchBtn.textContent = "\u641c\u7d22";
}

function formatSearchTimeMeta(item){
  return [
    item.source ? "source: " + item.source : "",
    item.age ? "age: " + item.age : "",
    item.page_age ? "page_age: " + item.page_age : "",
    item.published ? "published: " + item.published : ""
  ].filter(Boolean).join(" | ");
}

function renderSearchResults(results, meta){

  searchResults.innerHTML = "";

  if(!results.length){
    searchResults.innerHTML =
      "<div class='msg ai'>没有找到搜索结果。</div>";
    return;
  }

  const box = document.createElement("div");
  box.className = "msg ai";
  box.style.maxWidth = "92%";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.marginBottom = "10px";
  title.textContent = "搜索结果";
  box.appendChild(title);

  const debugMeta = document.createElement("div");
  debugMeta.style.fontSize = "12px";
  debugMeta.style.color = "var(--muted)";
  debugMeta.style.marginBottom = "10px";
  debugMeta.textContent = "query: " + (meta?.query || "") +
    " | freshness: " + (meta?.freshness || "none") +
    " | result count: " + results.length;
  box.appendChild(debugMeta);

  results.forEach((item, index) => {

    const card = document.createElement("div");
    card.style.border = "1px solid var(--border)";
    card.style.borderRadius = "12px";
    card.style.padding = "10px";
    card.style.marginTop = "10px";
    card.style.cursor = "pointer";

    const h = document.createElement("div");
    h.style.fontWeight = "700";
    h.textContent = (index + 1) + ". " + item.title;

    const desc = document.createElement("div");
    desc.style.fontSize = "13px";
    desc.style.color = "var(--muted)";
    desc.style.marginTop = "6px";
    desc.textContent = item.description || "";

    const timeMeta = document.createElement("div");
    timeMeta.style.fontSize = "12px";
    timeMeta.style.color = "var(--muted)";
    timeMeta.style.marginTop = "6px";
    timeMeta.textContent = formatSearchTimeMeta(item);

    const link = document.createElement("div");
    link.style.fontSize = "12px";
    link.style.color = "var(--primary)";
    link.style.marginTop = "6px";
    link.textContent = item.url;

    const btn = document.createElement("button");
    btn.textContent = "\u6293\u53d6\u6b64\u7f51\u9875";
    btn.type = "button";
    btn.style.marginTop = "8px";
    btn.style.border = "none";
    btn.style.background = "#059669";
    btn.style.color = "white";
    btn.style.padding = "8px 12px";
    btn.style.borderRadius = "10px";
    btn.style.cursor = "pointer";

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetchWebPage(item.url);
    });

    card.appendChild(h);
    card.appendChild(desc);
    if(timeMeta.textContent){
      card.appendChild(timeMeta);
    }
    card.appendChild(link);
    card.appendChild(btn);

    box.appendChild(card);
  });

  searchResults.appendChild(box);
  scrollBottom();
}

function normalizeBrowserScreenshot(data){
  const value = String(data?.screenshot || data?.screenshotBase64 || data?.screenshotUrl || "");

  if(!value){
    return "";
  }

  const lowerValue = value.toLowerCase();

  if(value.startsWith("data:image/") || lowerValue.startsWith("http://") || lowerValue.startsWith("https://")){
    return value;
  }

  return "data:image/png;base64," + value;
}

function getBrowserUrlLabel(value){
  try{
    return new URL(value).hostname;
  }catch(err){
    return "URL";
  }
}

function getBrowserDurationMs(data, fallbackMs){
  const candidates = [
    data?.durationMs,
    data?.elapsedMs,
    data?.timing,
    data?.metadata?.durationMs,
    data?.metadata?.elapsedMs,
    data?.metadata?.timing
  ];

  for(const candidate of candidates){
    if(typeof candidate === "number" && Number.isFinite(candidate)){
      return Math.round(candidate);
    }

    if(candidate && typeof candidate === "object"){
      const nested = candidate.durationMs ?? candidate.elapsedMs ?? candidate.totalMs;
      if(typeof nested === "number" && Number.isFinite(nested)){
        return Math.round(nested);
      }
    }
  }

  return Math.round(fallbackMs || 0);
}

function openBrowserLightbox(src, alt){
  const lightbox = document.createElement("div");
  lightbox.className = "browserLightbox open";

  const img = document.createElement("img");
  img.className = "browserLightboxImage";
  img.src = src;
  img.alt = alt || "Browser screenshot";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "browserLightboxClose";
  closeBtn.setAttribute("aria-label", "Close image preview");
  closeBtn.textContent = "\u00d7";

  function close(){
    document.removeEventListener("keydown", onKeydown);
    lightbox.remove();
  }

  function onKeydown(event){
    if(event.key === "Escape"){
      close();
    }
  }

  lightbox.addEventListener("click", event => {
    if(event.target === lightbox){
      close();
    }
  });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);

  lightbox.appendChild(img);
  lightbox.appendChild(closeBtn);
  document.body.appendChild(lightbox);
  closeBtn.focus();
}

function renderBrowserToolResult(data, requestedUrl, elapsedMs){
  const box = document.createElement("div");
  box.className = "msg ai";
  box.style.maxWidth = "92%";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.textContent = data?.ok ? "Browser Tool" : "Browser Tool Error";
  box.appendChild(title);

  const meta = document.createElement("div");
  meta.style.fontSize = "12px";
  meta.style.color = "var(--muted)";
  meta.style.marginTop = "6px";
  meta.textContent = data?.ok
    ? [(data.title || "Untitled"), getBrowserUrlLabel(data.url || requestedUrl)].filter(Boolean).join(" - ")
    : (data?.error || "Browser request failed");
  box.appendChild(meta);

  const text = String(data?.text || data?.extractedText || data?.details || "").trim();
  const screenshot = normalizeBrowserScreenshot(data);
  const stats = document.createElement("div");
  stats.className = "browserToolStats";
  stats.textContent = [
    getBrowserUrlLabel(data?.url || requestedUrl),
    "\u6587\u5b57\u957f\u5ea6 " + text.length,
    "\u622a\u56fe " + (screenshot ? "\u2713" : "\u2014"),
    "\u8017\u65f6 " + getBrowserDurationMs(data, elapsedMs) + " ms"
  ].join(" \u00b7 ");
  box.appendChild(stats);

  if(text){
    const preview = document.createElement("div");
    preview.className = "sourceCitationPreview active";
    preview.style.marginTop = "10px";
    preview.textContent = text.slice(0, 2500);
    box.appendChild(preview);
  }

  if(screenshot){
    const img = document.createElement("img");
    img.className = "browserScreenshotThumb";
    img.src = screenshot;
    img.alt = "Browser screenshot";
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.addEventListener("click", () => openBrowserLightbox(screenshot, img.alt));
    img.addEventListener("keydown", event => {
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        openBrowserLightbox(screenshot, img.alt);
      }
    });
    box.appendChild(img);
  }

  chat.appendChild(box);
  scrollBottom();
}

function setBrowserToolPanelOpen(open){
  browserToolPanel.classList.toggle("open", open);
  browserToolPanel.setAttribute("aria-hidden", open ? "false" : "true");
  browserToolToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");

  if(open){
    browserToolUrlInput.focus();
  }
}

async function runBrowserTool(){
  const url = browserToolUrlInput.value.trim() || input.value.trim();

  if(!url){
    setBrowserToolPanelOpen(true);
    browserToolUrlInput.focus();
    return;
  }

  browserToolBtn.disabled = true;
  browserToolBtn.textContent = "Running...";
  setContextStatus("Browser tool is running...");
  const startedAt = performance.now();

  try{
    const res = await fetch("/api/browser", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        url,
        mode:"full"
      })
    });
    const data = await res.json();
    const elapsedMs = performance.now() - startedAt;
    renderBrowserToolResult(data, url, elapsedMs);

    if(!res.ok || !data.ok){
      setContextStatus("Browser tool failed");
      return;
    }

    setContextStatus("Browser tool finished: " + (data.title || data.url || url));
  }catch(err){
    renderBrowserToolResult({
      ok:false,
      error:"Browser tool request failed",
      details:err.message
    }, url, performance.now() - startedAt);
    setContextStatus("Browser tool failed");
  }finally{
    browserToolBtn.disabled = false;
    browserToolBtn.textContent = "Run";
  }
}

clearFileBtn.addEventListener("click", clearSelectedFile);

searchBtn.addEventListener("click", () => {
  closeInputMenus();
  searchWeb();
});
browserToolToggleBtn.addEventListener("click", () => {
  closeInputMenus();
  setBrowserToolPanelOpen(!browserToolPanel.classList.contains("open"));
});
browserToolBtn.addEventListener("click", () => {
  closeInputMenus();
  runBrowserTool();
});
browserToolUrlInput.addEventListener("keydown", event => {
  if(event.key === "Enter"){
    event.preventDefault();
    runBrowserTool();
  }
});
webAnswerBtn.addEventListener("click", () => {
  closeInputMenus();
  webAnswer();
});
async function webAnswer(){

  const query = input.value.trim();

  if(!query){
    alert("Please enter a question first.");
    return;
  }

  pendingToolCall = {
    name:"web_search",
    args:{
      query
    }
  };

  webAnswerBtn.disabled = true;
  webAnswerBtn.textContent = "\u8054\u7f51\u4e2d...";
  setContextStatus("\u6b63\u5728\u8054\u7f51\u67e5\u8be2...");

  try{
    await sendMessage();
  }catch(err){
    pendingToolCall = null;
    setContextStatus("\u8054\u7f51\u56de\u7b54\u5931\u8d25");
    alert("Web answer failed: " + err.message);
  }

  pendingToolCall = null;
  webAnswerBtn.disabled = false;
  webAnswerBtn.textContent = "\u8054\u7f51\u67e5\u8be2";
  return;

  if(!query){
    alert("请先在聊天框或搜索框输入问题");
    return;
  }

  webAnswerBtn.disabled = true;
  webAnswerBtn.textContent = "\u8054\u7f51\u4e2d...";
  setContextStatus("\u6b63\u5728\u8054\u7f51\u641c\u7d22\u5e76\u6293\u53d6\u7f51\u9875...");

  try{

    const res = await fetch("/search-and-fetch", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        query:query
      })
    });

    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "联网搜索失败");
    }

    webSearchSources = data.pages || [];

    webSearchContext = webSearchSources.map((page, index) => {
      return [
        "Source " + (index + 1),
        "Title: " + page.title,
        "URL: " + page.url,
        "Summary: " + (page.description || ""),
        "Text:",
        page.text
      ].join(String.fromCharCode(10));
    }).join(String.fromCharCode(10, 10));

    setContextStatus(
      "\u8054\u7f51\u5b8c\u6210\uff1a\u627e\u5230 " + (data.results || []).length +
      " \u6761\u7ed3\u679c\uff0c\u6210\u529f\u6293\u53d6 " + webSearchSources.length + " \u4e2a\u7f51\u9875"
    );

    if(!webSearchContext){
      alert("Search returned results, but page text extraction failed.");
      return;
    }

    await sendMessage();

  }catch(err){

    setContextStatus("\u8054\u7f51\u56de\u7b54\u5931\u8d25");
    alert("Web answer failed: " + err.message);

  }

  webAnswerBtn.disabled = false;
  webAnswerBtn.textContent = "\u8054\u7f51\u67e5\u8be2";
}

fetchUrlBtn.addEventListener("click", () => {
  closeInputMenus();
  fetchWebPage();
});

async function fetchWebPage(pageUrlFromResult){
  const pageUrl = (typeof pageUrlFromResult === "string" ? pageUrlFromResult : input.value).trim();

  if(!pageUrl){
    alert("请输入网页 URL");
    return;
  }

  if(!/^https?:\\/\\//i.test(pageUrl)){
    alert("URL must start with http:// or https://");
    return;
  }

  fetchUrlBtn.disabled = true;
  fetchUrlBtn.textContent = "\u6293\u53d6\u4e2d...";
  setContextStatus("\u6b63\u5728\u6293\u53d6\u7f51\u9875...");

  try{

    const res = await fetch("/fetch-url", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        pageUrl
      })
    });

    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "网页抓取失败");
    }

    selectedWebPage = {
      url:data.url,
      title:data.title,
      text:data.text
    };

    selectedWebPageChunks = splitTextIntoChunks(data.text);

    setContextStatus(
      "\u5df2\u6293\u53d6\u7f51\u9875\uff1a" + data.title + "\uff08" + data.length + " \u5b57\u7b26\uff0c" + selectedWebPageChunks.length + " \u6bb5\uff09"
    );

  }catch(err){

    setContextStatus("\u7f51\u9875\u6293\u53d6\u5931\u8d25" + (getCurrentContextStatus() ? "\uff0c" + getCurrentContextStatus() : ""));
    alert("Page fetch failed: " + err.message);

  }

  fetchUrlBtn.disabled = false;
  fetchUrlBtn.textContent = "\u6293\u53d6\u7f51\u9875";
}

async function extractPdfText(file){
  if (!window.pdfjsLib) {
    throw new Error("pdf.js did not load; check CDN access");
  }

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer
  }).promise;

  let fullText = "";

  for(let pageNum = 1; pageNum <= pdf.numPages; pageNum++){

    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map(item => item.str)
      .join(" ");

    fullText += String.fromCharCode(10, 10) + "--- 第" + pageNum + " 页 ---" + String.fromCharCode(10) + pageText;
  }

  return fullText.trim();
}

async function extractDocxText(file){
  
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load; check CDN access");
  }

  const arrayBuffer = await file.arrayBuffer();

  const result = await mammoth.extractRawText({
    arrayBuffer: arrayBuffer
  });

  return (result.value || "").trim();
}

function splitTextIntoChunks(text, chunkSize = 1200, overlap = 200){

  const chunks = [];
  const cleanText = text.replace(/\s+/g, " ").trim();

  let start = 0;

  while(start < cleanText.length){

    const end = Math.min(start + chunkSize, cleanText.length);
    const chunk = cleanText.slice(start, end).trim();

    if(chunk){
      chunks.push(chunk);
    }

    start += chunkSize - overlap;
  }

  return chunks;
}

function pickRelevantChunks(question, chunks, maxChunks = 6){

  const queryWords = question
    .toLowerCase()
    .split(/[\\s,.;:!?()\\[\\]{}'"-]+/)
    .filter(word => word.length >= 2);

  if(queryWords.length === 0){
    return chunks.slice(0, maxChunks);
  }

  const scored = chunks.map((chunk, index) => {

    const lower = chunk.toLowerCase();

    let score = 0;

    for(const word of queryWords){
      if(lower.includes(word)){
        score += 1;
      }
    }

    return {
      index,
      chunk,
      score
    };
  });

  const picked = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map(item => "Chunk " + (item.index + 1) + String.fromCharCode(10) + item.chunk);

  return picked.length ? picked : chunks.slice(0, maxChunks);
}

async function uploadFileToLibrary(file, textContent){
  const formData = new FormData();
  formData.append("file", file);
  formData.append("text_content", textContent || "");

  if(currentConversationId){
    formData.append("conversation_id", currentConversationId);
  }

  const res = await fetch("/api/files/upload", {
    method:"POST",
    body:formData
  });
  const data = await res.json();

  if(!res.ok || !data.ok){
    throw new Error(data.error || "文件上传失败");
  }

  return data.file;
}

fileInput.addEventListener("change", async () => {
  await attachFilesByUseMode(fileInput.files);
});


const modelSelect = document.getElementById("modelSelect");
const modelSettingsBtn = document.getElementById("modelSettingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const cancelSettingsBtn = document.getElementById("cancelSettingsBtn");
const applySettingsBtn = document.getElementById("applySettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const defaultModelSelect = document.getElementById("defaultModelSelect");
const fallbackModelSelect = document.getElementById("fallbackModelSelect");
const autoArchiveDaysSelect = document.getElementById("autoArchiveDaysSelect");
const rememberLastModelCheck = document.getElementById("rememberLastModelCheck");
const fallbackEnabledCheck = document.getElementById("fallbackEnabledCheck");
const showPerMessageModelInfoCheck = document.getElementById("showPerMessageModelInfoCheck");
const attachmentMaxFileMbInput = document.getElementById("attachmentMaxFileMbInput");
const attachmentMaxTotalMbInput = document.getElementById("attachmentMaxTotalMbInput");
const attachmentMaxMarkdownCharsInput = document.getElementById("attachmentMaxMarkdownCharsInput");
const attachmentMaxTokensInput = document.getElementById("attachmentMaxTokensInput");
const attachmentMaxFinalCharsInput = document.getElementById("attachmentMaxFinalCharsInput");
const providerLabelInput = document.getElementById("providerLabelInput");
const providerIdInput = document.getElementById("providerIdInput");
const providerTypeSelect = document.getElementById("providerTypeSelect");
const providerBaseUrlInput = document.getElementById("providerBaseUrlInput");
const providerApiKeyEnvInput = document.getElementById("providerApiKeyEnvInput");
const addProviderBtn = document.getElementById("addProviderBtn");
const cancelProviderEditBtn = document.getElementById("cancelProviderEditBtn");
const modelProviderSelect = document.getElementById("modelProviderSelect");
const modelLabelInput = document.getElementById("modelLabelInput");
const modelIdInput = document.getElementById("modelIdInput");
const modelNameInput = document.getElementById("modelNameInput");
const addProviderModelBtn = document.getElementById("addProviderModelBtn");
const cancelModelEditBtn = document.getElementById("cancelModelEditBtn");
const modelHealthBtn = document.getElementById("modelHealthBtn");
const modelHealthToggleBtn = document.getElementById("modelHealthToggleBtn");
const modelHealthResults = document.getElementById("modelHealthResults");
const providersList = document.getElementById("providersList");
const settingsSyncStatus = document.getElementById("settingsSyncStatus");
let modelSettingsState = null;
let modelProviders = [];
let modelCategories = [];
let modelOptions = [];
let settingsSnapshot = null;
let editingProviderId = null;
let editingModelRef = null;
let editDialog = null;
let modelHealthCache = [];
let modelHealthCollapsed = false;

const DEFAULT_CONVERSATION_ATTACHMENT_LIMITS = {
  maxAttachments: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxMarkdownChars: 180000,
  maxCloudflareTokens: 80000,
  maxFinalUserMessageChars: 220000
};

const HARD_CONVERSATION_ATTACHMENT_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxMarkdownChars: 300000,
  maxCloudflareTokens: 120000,
  maxFinalUserMessageChars: 360000
};

function clampSettingsNumber(value, fallback, min, max){
  const number = Number(value);
  if(!Number.isFinite(number)){
    return fallback;
  }
  return Math.min(Math.max(Math.floor(number), min), max);
}

function normalizeConversationAttachmentLimits(limits){
  const source = limits && typeof limits === "object" ? limits : {};
  return {
    maxAttachments:5,
    maxFileBytes:clampSettingsNumber(source.maxFileBytes, DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxFileBytes, 1, HARD_CONVERSATION_ATTACHMENT_LIMITS.maxFileBytes),
    maxTotalBytes:clampSettingsNumber(source.maxTotalBytes, DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxTotalBytes, 1, HARD_CONVERSATION_ATTACHMENT_LIMITS.maxTotalBytes),
    maxMarkdownChars:clampSettingsNumber(source.maxMarkdownChars, DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxMarkdownChars, 1, HARD_CONVERSATION_ATTACHMENT_LIMITS.maxMarkdownChars),
    maxCloudflareTokens:clampSettingsNumber(source.maxCloudflareTokens, DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxCloudflareTokens, 1, HARD_CONVERSATION_ATTACHMENT_LIMITS.maxCloudflareTokens),
    maxFinalUserMessageChars:clampSettingsNumber(source.maxFinalUserMessageChars, DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxFinalUserMessageChars, 1, HARD_CONVERSATION_ATTACHMENT_LIMITS.maxFinalUserMessageChars)
  };
}

function setConversationAttachmentLimitInputs(limits){
  const normalized = normalizeConversationAttachmentLimits(limits);
  attachmentMaxFileMbInput.value = Math.round(normalized.maxFileBytes / 1024 / 1024);
  attachmentMaxTotalMbInput.value = Math.round(normalized.maxTotalBytes / 1024 / 1024);
  attachmentMaxMarkdownCharsInput.value = normalized.maxMarkdownChars;
  attachmentMaxTokensInput.value = normalized.maxCloudflareTokens;
  attachmentMaxFinalCharsInput.value = normalized.maxFinalUserMessageChars;
}

function readConversationAttachmentLimitInputs(){
  return normalizeConversationAttachmentLimits({
    maxFileBytes:Number(attachmentMaxFileMbInput.value || 10) * 1024 * 1024,
    maxTotalBytes:Number(attachmentMaxTotalMbInput.value || 24) * 1024 * 1024,
    maxMarkdownChars:Number(attachmentMaxMarkdownCharsInput.value || DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxMarkdownChars),
    maxCloudflareTokens:Number(attachmentMaxTokensInput.value || DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxCloudflareTokens),
    maxFinalUserMessageChars:Number(attachmentMaxFinalCharsInput.value || DEFAULT_CONVERSATION_ATTACHMENT_LIMITS.maxFinalUserMessageChars)
  });
}

const conversation = [
  {
    role:"system",
    content:"You are a web AI assistant. Answer concisely, accurately, and helpfully. Markdown is allowed."
  }
];

function getProvider(providerId){
  return modelProviders.find(provider => provider.id === providerId);
}

function setupSettingsHeaderActions(){
  const header = settingsModal.querySelector(".settingsHeader");
  const oldFooterActions = settingsModal.querySelector(".settingsFooterActions");
  let actions = settingsModal.querySelector(".settingsHeaderActions");

  if(!actions){
    actions = document.createElement("div");
    actions.className = "settingsHeaderActions";
    header.appendChild(actions);
  }

  actions.appendChild(applySettingsBtn);
  actions.appendChild(saveSettingsBtn);
  actions.appendChild(closeSettingsBtn);
  closeSettingsBtn.textContent = "X";
  closeSettingsBtn.className = "settingsIconBtn";
  closeSettingsBtn.setAttribute("aria-label", "Close");

  if(oldFooterActions){
    oldFooterActions.style.display = "none";
  }
}

function createEditDialog(){
  if(editDialog){
    return editDialog;
  }

  const overlay = document.createElement("div");
  overlay.id = "editSettingsDialog";
  overlay.className = "editDialogOverlay";
  overlay.innerHTML = [
    "<div class='editDialogPanel' role='dialog' aria-modal='true'>",
    "<div class='settingsHeader'>",
    "<h3 id='editDialogTitle'>编辑</h3>",
    "<button id='editDialogCloseBtn' class='settingsIconBtn' type='button' aria-label='Close'>X</button>",
    "</div>",
    "<div id='editDialogBody' class='editDialogGrid'></div>",
    "<div class='editDialogFooter'>",
    "<button id='editDialogDeleteBtn' class='settingsBtn' type='button'>删除</button>",
    "<div>",
    "<button id='editDialogCancelBtn' class='settingsBtn' type='button'>取消</button>",
    "<button id='editDialogSaveBtn' class='settingsPrimaryBtn' type='button'>保存</button>",
    "</div>",
    "</div>",
    "</div>"
  ].join("");
  document.body.appendChild(overlay);

  editDialog = {
    overlay,
    title:overlay.querySelector("#editDialogTitle"),
    body:overlay.querySelector("#editDialogBody"),
    closeBtn:overlay.querySelector("#editDialogCloseBtn"),
    deleteBtn:overlay.querySelector("#editDialogDeleteBtn"),
    cancelBtn:overlay.querySelector("#editDialogCancelBtn"),
    saveBtn:overlay.querySelector("#editDialogSaveBtn"),
    mode:"",
    providerId:"",
    modelId:""
  };

  editDialog.closeBtn.addEventListener("click", closeEditDialog);
  editDialog.cancelBtn.addEventListener("click", closeEditDialog);

  return editDialog;
}

function closeEditDialog(){
  if(editDialog){
    editDialog.overlay.classList.remove("open");
    editDialog.body.innerHTML = "";
    editDialog.saveBtn.onclick = null;
    editDialog.deleteBtn.onclick = null;
    editDialog.deleteBtn.style.display = "";
    editDialog.mode = "";
    editDialog.providerId = "";
    editDialog.modelId = "";
  }
}

function deepClone(value){
  return JSON.parse(JSON.stringify(value || null));
}

function providerEditable(provider){
  return provider.editable !== false;
}

function modelEditable(model){
  return model.editable !== false;
}

function currentSelectedSnapshot(){
  return {
    selectedModel:modelSelect.value || "",
    selectedProvider:getSelectedProviderForRequest(modelSelect.value)
  };
}

function clearProviderForm(){
  editingProviderId = null;
  providerLabelInput.value = "";
  providerIdInput.value = "";
  providerTypeSelect.value = "openai-compatible";
  providerBaseUrlInput.value = "";
  providerApiKeyEnvInput.value = "";
  addProviderBtn.textContent = "新增 provider";
  cancelProviderEditBtn.style.display = "none";
}

function clearModelForm(){
  editingModelRef = null;
  modelLabelInput.value = "";
  modelIdInput.value = "";
  modelNameInput.value = "";
  addProviderModelBtn.textContent = "添加模型到 provider";
  cancelModelEditBtn.style.display = "none";
}

function refreshDraftSettings(message){
  modelSettingsState.providers = modelProviders;
  renderModelOptions();
  if(modelSelect.value && !hasModel(modelSelect.value)){
    selectInitialModel();
  }
  refreshSettingsControls();
  if(message){
    settingsSyncStatus.textContent = message;
  }
}

function persistSettings(message, closeAfter){
  modelSettingsState.providers = modelProviders;
  writeSettingsCache(modelSettingsState);
  renderModelOptions();
  if(modelSelect.value && !hasModel(modelSelect.value)){
    selectInitialModel();
  }
  refreshSettingsControls();
  if(message){
    settingsSyncStatus.textContent = message;
  }
  syncSettingsToServer(modelSettingsState);
  if(closeAfter){
    closeSettings();
  }
}

function saveCurrentSettings(message){
  persistSettings(message, false);
}

function openSettings(){
  setupSettingsHeaderActions();
  clearProviderForm();
  clearModelForm();
  refreshSettingsControls();
  settingsSyncStatus.textContent = "";
  settingsModal.classList.add("open");
  settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettings(){
  settingsModal.classList.remove("open");
  settingsModal.setAttribute("aria-hidden", "true");
}

function cancelSettings(){
  if(settingsSnapshot){
    modelSettingsState = deepClone(settingsSnapshot.settings);
    modelProviders = deepClone(settingsSnapshot.providers);
    renderModelOptions();
    modelSelect.value = hasModel(settingsSnapshot.selected?.selectedModel)
      ? settingsSnapshot.selected.selectedModel
      : (modelOptions[0]?.id || "");
    refreshSettingsControls();
  }
  clearProviderForm();
  clearModelForm();
  closeSettings();
}

function saveSettingsFromUi(closeAfter){
  const nextDefault = defaultModelSelect.value || "";
  modelSettingsState.defaultModel = nextDefault;
  modelSettingsState.rememberLastModel = rememberLastModelCheck.checked;
  modelSettingsState.fallbackEnabled = fallbackEnabledCheck.checked;
  modelSettingsState.fallbackModels = fallbackModelSelect.value ? [fallbackModelSelect.value] : [];
  modelSettingsState.showPerMessageModelInfo = showPerMessageModelInfoCheck.checked;
  modelSettingsState.autoArchiveDays = normalizeAutoArchiveDays(autoArchiveDaysSelect.value);
  modelSettingsState.conversationAttachmentLimits = readConversationAttachmentLimitInputs();

  if(nextDefault && hasModel(nextDefault)){
    modelSelect.value = nextDefault;
  }

  if(modelSettingsState.rememberLastModel && nextDefault){
    modelSettingsState.lastModel = nextDefault;
  }else{
    modelSettingsState.lastModel = "";
  }

  persistSettings(closeAfter ? "Saved" : "Applied", Boolean(closeAfter));
}

function addProvider(){
  const label = providerLabelInput.value.trim();
  const providerType = providerTypeSelect.value;
  const apiBase = providerBaseUrlInput.value.trim();
  const apiKeyEnv = providerApiKeyEnvInput.value.trim();

  if(!label){
    settingsSyncStatus.textContent = "请填写 provider 名称";
    return;
  }

  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || ("provider-" + Date.now());

  if(getProvider(id)){
    settingsSyncStatus.textContent = "Provider already exists";
    return;
  }

  modelProviders.push({
    id,
    label,
    providerType,
    apiBase:providerType === "openai-compatible" ? apiBase : "",
    apiKeyEnv:providerType === "openai-compatible" ? apiKeyEnv : "",
    builtin:false,
    models:[]
  });
  providerLabelInput.value = "";
  providerBaseUrlInput.value = "";
  providerApiKeyEnvInput.value = "";
  saveCurrentSettings("已添加 provider");
}

function addProviderModel(){
  const provider = getProvider(modelProviderSelect.value);
  const id = modelIdInput.value.trim();
  const label = modelLabelInput.value.trim() || id;
  const modelName = modelNameInput.value.trim() || id;

  if(!provider || !id){
    settingsSyncStatus.textContent = "请选择 provider 并填写模型 ID";
    return;
  }

  provider.models = (provider.models || []).filter(model => model.id !== id);
  provider.models.push({
    id,
    label,
    modelName,
    providerType:provider.providerType,
    apiBase:provider.apiBase || "",
    apiKeyEnv:provider.apiKeyEnv || "",
    capabilities:{ text:true, streaming:true },
    enabled:true
  });
  modelLabelInput.value = "";
  modelIdInput.value = "";
  modelNameInput.value = "";
  saveCurrentSettings("Added model");
}

function removeProvider(providerId){
  modelProviders = modelProviders.filter(provider => provider.id !== providerId);
  saveCurrentSettings("已删除 provider");
}

function removeProviderModel(providerId, modelId){
  const provider = getProvider(providerId);
  if(!provider) return;
  provider.models = (provider.models || []).filter(model => model.id !== modelId);
  saveCurrentSettings("Deleted model");
}

function renderProvidersList(){
  providersList.innerHTML = "";
  modelProviders.forEach(provider => {
    const row = document.createElement("div");
    row.className = "providerRow";
    const header = document.createElement("div");
    header.className = "providerRowHeader";
    const title = document.createElement("strong");
    title.textContent = provider.label + " (" + provider.providerType + ")";
    header.appendChild(title);
    if(!provider.builtin){
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "settingsBtn";
      removeBtn.textContent = "删除 provider";
      removeBtn.addEventListener("click", () => removeProvider(provider.id));
      header.appendChild(removeBtn);
    }
    row.appendChild(header);
    (provider.models || []).forEach(model => {
      const modelRow = document.createElement("div");
      modelRow.className = "modelRow";
      const name = document.createElement("span");
      name.textContent = (model.label || model.id) + " / " + model.id;
      const removeModelBtn = document.createElement("button");
      removeModelBtn.type = "button";
      removeModelBtn.className = "settingsBtn";
      removeModelBtn.textContent = "删除";
      removeModelBtn.addEventListener("click", () => removeProviderModel(provider.id, model.id));
      modelRow.appendChild(name);
      modelRow.appendChild(removeModelBtn);
      row.appendChild(modelRow);
    });
    providersList.appendChild(row);
  });
}

function updateModelReferences(oldModelId, newModelId){
  if(!oldModelId || !newModelId || oldModelId === newModelId){
    return;
  }
  if(modelSettingsState.defaultModel === oldModelId){
    modelSettingsState.defaultModel = newModelId;
  }
  if(modelSettingsState.lastModel === oldModelId){
    modelSettingsState.lastModel = newModelId;
  }
  modelSettingsState.fallbackModels = (modelSettingsState.fallbackModels || []).map(modelId => (
    modelId === oldModelId ? newModelId : modelId
  ));
  if(modelSelect.value === oldModelId){
    modelSelect.value = newModelId;
  }
}

function pruneInvalidModelReferences(){
  renderModelOptions();
  if(!hasModel(modelSettingsState.defaultModel)){
    modelSettingsState.defaultModel = "";
  }
  if(!hasModel(modelSettingsState.lastModel)){
    modelSettingsState.lastModel = "";
  }
  modelSettingsState.fallbackModels = (modelSettingsState.fallbackModels || []).filter(hasModel);
  if(modelSelect.value && !hasModel(modelSelect.value)){
    modelSelect.value = modelSettingsState.defaultModel || modelOptions[0]?.id || "";
  }
}

function editProvider(providerId){
  const provider = getProvider(providerId);
  if(!provider || !providerEditable(provider)){
    settingsSyncStatus.textContent = "当前 provider 不可编辑";
    return;
  }
  editingProviderId = provider.id;
  providerLabelInput.value = provider.label || provider.id;
  providerIdInput.value = provider.id;
  providerTypeSelect.value = provider.providerType || "openai-compatible";
  providerBaseUrlInput.value = provider.apiBase || "";
  providerApiKeyEnvInput.value = provider.apiKeyEnv || "";
  addProviderBtn.textContent = "保存 provider 修改";
  cancelProviderEditBtn.style.display = "inline-block";
}

function editProviderModel(providerId, modelId){
  const provider = getProvider(providerId);
  const model = provider?.models?.find(item => item.id === modelId);
  if(!provider || !model || !modelEditable(model)){
    settingsSyncStatus.textContent = "当前模型不可编辑";
    return;
  }
  editingModelRef = { providerId, modelId };
  modelProviderSelect.value = providerId;
  modelLabelInput.value = model.label || model.id;
  modelIdInput.value = model.id;
  modelNameInput.value = model.modelName || model.id;
  addProviderModelBtn.textContent = "保存模型修改";
  cancelModelEditBtn.style.display = "inline-block";
}

function saveSettingsFromUi(closeAfter){
  const nextDefault = defaultModelSelect.value || "";
  modelSettingsState.defaultModel = nextDefault;
  modelSettingsState.rememberLastModel = rememberLastModelCheck.checked;
  modelSettingsState.fallbackEnabled = fallbackEnabledCheck.checked;
  modelSettingsState.fallbackModels = fallbackModelSelect.value ? [fallbackModelSelect.value] : [];
  modelSettingsState.showPerMessageModelInfo = showPerMessageModelInfoCheck.checked;
  modelSettingsState.autoArchiveDays = normalizeAutoArchiveDays(autoArchiveDaysSelect.value);
  modelSettingsState.conversationAttachmentLimits = readConversationAttachmentLimitInputs();

  if(nextDefault && hasModel(nextDefault)){
    modelSelect.value = nextDefault;
  }
  modelSettingsState.lastModel = modelSettingsState.rememberLastModel && nextDefault ? nextDefault : "";
  persistSettings(closeAfter ? "Saved" : "Applied", Boolean(closeAfter));
}

function addProvider(){
  const label = providerLabelInput.value.trim();
  const id = providerIdInput.value.trim() ||
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    ("provider-" + Date.now());
  const providerType = providerTypeSelect.value;
  const apiBase = providerBaseUrlInput.value.trim();
  const apiKeyEnv = providerApiKeyEnvInput.value.trim();

  if(!label || !id){
    settingsSyncStatus.textContent = "Provider id and name are required";
    return;
  }
  if(modelProviders.some(provider => provider.id === id && provider.id !== editingProviderId)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }

  if(editingProviderId){
    const provider = getProvider(editingProviderId);
    if(!provider || !providerEditable(provider)){
      settingsSyncStatus.textContent = "当前 provider 不可编辑";
      return;
    }
    provider.id = id;
    provider.label = label;
    provider.providerType = providerType;
    provider.apiBase = providerType === "openai-compatible" ? apiBase : "";
    provider.apiKeyEnv = providerType === "openai-compatible" ? apiKeyEnv : "";
    provider.models = (provider.models || []).map(model => ({
      ...model,
      providerType,
      apiBase:provider.apiBase,
      apiKeyEnv:provider.apiKeyEnv
    }));
    clearProviderForm();
    refreshDraftSettings("已更新 provider");
    return;
  }

  modelProviders.push({
    id,
    label,
    providerType,
    apiBase:providerType === "openai-compatible" ? apiBase : "",
    apiKeyEnv:providerType === "openai-compatible" ? apiKeyEnv : "",
    builtin:false,
    editable:true,
    models:[]
  });
  clearProviderForm();
  refreshDraftSettings("已添加 provider");
}

function addProviderModel(){
  const provider = getProvider(modelProviderSelect.value);
  const id = modelIdInput.value.trim();
  const label = modelLabelInput.value.trim() || id;
  const modelName = modelNameInput.value.trim() || id;

  if(!provider || !id || !label){
    settingsSyncStatus.textContent = "请选择 provider 并填写模型 id/name";
    return;
  }
  if((provider.models || []).some(model => model.id === id && !(editingModelRef && editingModelRef.providerId === provider.id && editingModelRef.modelId === model.id))){
    settingsSyncStatus.textContent = "同一 provider 中 model id 不能重复";
    return;
  }

  if(editingModelRef){
    const originalProvider = getProvider(editingModelRef.providerId);
    const originalModel = originalProvider?.models?.find(model => model.id === editingModelRef.modelId);
    if(!originalProvider || !originalModel || !modelEditable(originalModel)){
      settingsSyncStatus.textContent = "当前模型不可编辑";
      return;
    }
    originalProvider.models = (originalProvider.models || []).filter(model => model.id !== editingModelRef.modelId);
    updateModelReferences(editingModelRef.modelId, id);
  }

  provider.models = (provider.models || []).filter(model => model.id !== id);
  provider.models.push({
    id,
    label,
    modelName,
    providerType:provider.providerType,
    apiBase:provider.apiBase || "",
    apiKeyEnv:provider.apiKeyEnv || "",
    capabilities:{ text:true, streaming:true },
    enabled:true,
    editable:true
  });
  clearModelForm();
  refreshDraftSettings(editingModelRef ? "Updated model" : "Added model");
}

function removeProvider(providerId){
  const provider = getProvider(providerId);
  if(!provider || !providerEditable(provider)){
    settingsSyncStatus.textContent = "当前 provider 不可删除";
    return;
  }
  if(!confirm("确定删除 provider " + provider.label + " 吗？")){
    return;
  }
  if(editingProviderId === providerId){
    clearProviderForm();
  }
  if(editingModelRef?.providerId === providerId){
    clearModelForm();
  }
  modelProviders = modelProviders.filter(provider => provider.id !== providerId);
  pruneInvalidModelReferences();
  refreshDraftSettings("已删除 provider");
}

function removeProviderModel(providerId, modelId){
  const provider = getProvider(providerId);
  const targetModel = provider?.models?.find(model => model.id === modelId);
  if(!provider || !targetModel || !modelEditable(targetModel)){
    settingsSyncStatus.textContent = "当前模型不可删除";
    return;
  }
  if(!confirm("确定删除模型 " + (targetModel.label || targetModel.id) + " 吗？")){
    return;
  }
  if(editingModelRef?.providerId === providerId && editingModelRef?.modelId === modelId){
    clearModelForm();
  }
  provider.models = (provider.models || []).filter(model => model.id !== modelId);
  pruneInvalidModelReferences();
  refreshDraftSettings("Deleted model");
}

function renderProvidersList(){
  providersList.innerHTML = "";
  modelProviders.forEach(provider => {
    const row = document.createElement("div");
    row.className = "providerRow";
    const header = document.createElement("div");
    header.className = "providerRowHeader";
    const title = document.createElement("strong");
    title.textContent = provider.label + " (" + provider.id + " / " + provider.providerType + ")";
    header.appendChild(title);
    if(providerEditable(provider)){
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "settingsBtn";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", () => editProvider(provider.id));
      header.appendChild(editBtn);
    }
    if(!provider.builtin){
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "settingsBtn";
      removeBtn.textContent = "删除 provider";
      removeBtn.addEventListener("click", () => removeProvider(provider.id));
      header.appendChild(removeBtn);
    }
    row.appendChild(header);
    (provider.models || []).forEach(model => {
      const modelRow = document.createElement("div");
      modelRow.className = "modelRow";
      const name = document.createElement("span");
      name.textContent = (model.label || model.id) + " / " + model.id;
      if(modelEditable(model)){
        const editModelBtn = document.createElement("button");
        editModelBtn.type = "button";
        editModelBtn.className = "settingsBtn";
        editModelBtn.textContent = "编辑";
        editModelBtn.addEventListener("click", () => editProviderModel(provider.id, model.id));
        modelRow.appendChild(editModelBtn);
      }
      const removeModelBtn = document.createElement("button");
      removeModelBtn.type = "button";
      removeModelBtn.className = "settingsBtn";
      removeModelBtn.textContent = "删除";
      removeModelBtn.addEventListener("click", () => removeProviderModel(provider.id, model.id));
      modelRow.prepend(name);
      modelRow.appendChild(removeModelBtn);
      row.appendChild(modelRow);
    });
    providersList.appendChild(row);
  });
}

async function syncSettingsToServer(settings){
  try{
    const payload = {
      ...settings,
      clientUpdatedAt:settings?.updatedAt || settings?.version || 0
    };
    const res = await fetch("/api/settings", {
      method:"POST",
      headers:{ "Content-Type":"application/json; charset=utf-8" },
      body:JSON.stringify({ settings:payload })
    });
    if(!res.ok){
      throw new Error(await res.text());
    }
    const data = await res.json().catch(() => null);
    if(data?.settings){
      modelSettingsState = normalizeModelSettings(data.settings, modelProviders);
      modelCategories = modelSettingsState.categories;
      modelProviders = modelSettingsState.providers;
      writeSettingsCache(modelSettingsState);
      renderModelOptions();
    }else if(data?.version || data?.updatedAt){
      settings.updatedAt = data.updatedAt || data.version;
      settings.version = data.version || data.updatedAt;
      writeSettingsCache(settings);
    }
    settingsSyncStatus.textContent = "Synced";
    return true;
  }catch(err){
    console.warn("settings sync failed", err);
    settingsSyncStatus.textContent = "已本地保存，云端同步失败";
    return false;
  }
}

async function persistSettings(message, closeAfter){
  modelSettingsState.providers = modelProviders;
  writeSettingsCache(modelSettingsState);
  renderModelOptions();
  if(modelSelect.value && !hasModel(modelSelect.value)){
    selectInitialModel();
  }
  refreshSettingsControls();
  if(message){
    settingsSyncStatus.textContent = message;
  }
  const synced = await syncSettingsToServer(modelSettingsState);
  if(closeAfter && synced){
    closeSettings();
  }
}

function saveCurrentSettings(message){
  persistSettings(message, false);
}

function saveSettingsFromUi(closeAfter){
  const nextDefault = defaultModelSelect.value || "";
  modelSettingsState.defaultModel = nextDefault;
  modelSettingsState.rememberLastModel = rememberLastModelCheck.checked;
  modelSettingsState.fallbackEnabled = fallbackEnabledCheck.checked;
  modelSettingsState.fallbackModels = fallbackModelSelect.value ? [fallbackModelSelect.value] : [];
  modelSettingsState.showPerMessageModelInfo = showPerMessageModelInfoCheck.checked;
  modelSettingsState.autoArchiveDays = normalizeAutoArchiveDays(autoArchiveDaysSelect.value);
  modelSettingsState.conversationAttachmentLimits = readConversationAttachmentLimitInputs();
  if(nextDefault && hasModel(nextDefault)){
    modelSelect.value = nextDefault;
  }
  modelSettingsState.lastModel = modelSettingsState.rememberLastModel && nextDefault ? nextDefault : "";
  persistSettings(closeAfter ? "Saved" : "Applied", Boolean(closeAfter));
}

function addProvider(){
  const label = providerLabelInput.value.trim();
  const id = providerIdInput.value.trim() ||
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    ("provider-" + Date.now());
  const providerType = providerTypeSelect.value;
  const apiBase = providerBaseUrlInput.value.trim();
  const apiKeyEnv = providerApiKeyEnvInput.value.trim();
  if(!label || !id){
    settingsSyncStatus.textContent = "Provider id and name are required";
    return;
  }
  if(modelProviders.some(provider => provider.id === id && provider.id !== editingProviderId)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }
  if(editingProviderId){
    const provider = getProvider(editingProviderId);
    if(!provider || !providerEditable(provider)){
      settingsSyncStatus.textContent = "当前 provider 不可编辑";
      return;
    }
    provider.id = id;
    provider.label = label;
    provider.providerType = providerType;
    provider.apiBase = providerType === "openai-compatible" ? apiBase : "";
    provider.apiKeyEnv = providerType === "openai-compatible" ? apiKeyEnv : "";
    provider.models = (provider.models || []).map(model => ({
      ...model,
      providerType,
      apiBase:provider.apiBase,
      apiKeyEnv:provider.apiKeyEnv
    }));
    clearProviderForm();
    refreshDraftSettings("已更新 provider");
    return;
  }
  modelProviders.push({
    id,
    label,
    providerType,
    apiBase:providerType === "openai-compatible" ? apiBase : "",
    apiKeyEnv:providerType === "openai-compatible" ? apiKeyEnv : "",
    builtin:false,
    editable:true,
    models:[]
  });
  clearProviderForm();
  refreshDraftSettings("已添加 provider");
}

function addProviderModel(){
  const provider = getProvider(modelProviderSelect.value);
  const id = modelIdInput.value.trim();
  const label = modelLabelInput.value.trim() || id;
  const modelName = modelNameInput.value.trim() || id;
  const wasEditing = Boolean(editingModelRef);
  if(!provider || !id || !label){
    settingsSyncStatus.textContent = "请选择 provider 并填写模型 id/name";
    return;
  }
  if((provider.models || []).some(model => model.id === id && !(editingModelRef && editingModelRef.providerId === provider.id && editingModelRef.modelId === model.id))){
    settingsSyncStatus.textContent = "同一 provider 中 model id 不能重复";
    return;
  }
  if(editingModelRef){
    const originalProvider = getProvider(editingModelRef.providerId);
    const originalModel = originalProvider?.models?.find(model => model.id === editingModelRef.modelId);
    if(!originalProvider || !originalModel || !modelEditable(originalModel)){
      settingsSyncStatus.textContent = "当前模型不可编辑";
      return;
    }
    originalProvider.models = (originalProvider.models || []).filter(model => model.id !== editingModelRef.modelId);
    updateModelReferences(editingModelRef.modelId, id);
  }
  provider.models = (provider.models || []).filter(model => model.id !== id);
  provider.models.push({
    id,
    label,
    modelName,
    providerType:provider.providerType,
    apiBase:provider.apiBase || "",
    apiKeyEnv:provider.apiKeyEnv || "",
    capabilities:{ text:true, streaming:true },
    enabled:true,
    editable:true
  });
  clearModelForm();
  refreshDraftSettings(wasEditing ? "Updated model" : "Added model");
}

function removeProvider(providerId){
  const provider = getProvider(providerId);
  if(!provider || !providerEditable(provider)){
    settingsSyncStatus.textContent = "当前 provider 不可删除";
    return;
  }
  if(!confirm("确定删除 provider " + provider.label + " 吗？")){
    return;
  }
  if(editingProviderId === providerId){
    clearProviderForm();
  }
  if(editingModelRef?.providerId === providerId){
    clearModelForm();
  }
  modelProviders = modelProviders.filter(provider => provider.id !== providerId);
  pruneInvalidModelReferences();
  refreshDraftSettings("已删除 provider");
}

function removeProviderModel(providerId, modelId){
  const provider = getProvider(providerId);
  const targetModel = provider?.models?.find(model => model.id === modelId);
  if(!provider || !targetModel || !modelEditable(targetModel)){
    settingsSyncStatus.textContent = "当前模型不可删除";
    return;
  }
  if(!confirm("确定删除模型 " + (targetModel.label || targetModel.id) + " 吗？")){
    return;
  }
  if(editingModelRef?.providerId === providerId && editingModelRef?.modelId === modelId){
    clearModelForm();
  }
  provider.models = (provider.models || []).filter(model => model.id !== modelId);
  pruneInvalidModelReferences();
  refreshDraftSettings("Deleted model");
}

function renderProvidersList(){
  providersList.innerHTML = "";
  modelProviders.forEach(provider => {
    const row = document.createElement("div");
    row.className = "providerRow";
    const header = document.createElement("div");
    header.className = "providerRowHeader";
    const title = document.createElement("strong");
    title.textContent = provider.label + " (" + provider.id + " / " + provider.providerType + ")";
    header.appendChild(title);
    if(providerEditable(provider)){
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "settingsBtn";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", () => editProvider(provider.id));
      header.appendChild(editBtn);
    }
    if(!provider.builtin){
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "settingsBtn";
      removeBtn.textContent = "删除 provider";
      removeBtn.addEventListener("click", () => removeProvider(provider.id));
      header.appendChild(removeBtn);
    }
    row.appendChild(header);
    (provider.models || []).forEach(model => {
      const modelRow = document.createElement("div");
      modelRow.className = "modelRow";
      const name = document.createElement("span");
      name.textContent = (model.label || model.id) + " / " + model.id;
      modelRow.appendChild(name);
      if(modelEditable(model)){
        const editModelBtn = document.createElement("button");
        editModelBtn.type = "button";
        editModelBtn.className = "settingsBtn";
        editModelBtn.textContent = "编辑";
        editModelBtn.addEventListener("click", () => editProviderModel(provider.id, model.id));
        modelRow.appendChild(editModelBtn);
      }
      const removeModelBtn = document.createElement("button");
      removeModelBtn.type = "button";
      removeModelBtn.className = "settingsBtn";
      removeModelBtn.textContent = "删除";
      removeModelBtn.addEventListener("click", () => removeProviderModel(provider.id, model.id));
      modelRow.appendChild(removeModelBtn);
      row.appendChild(modelRow);
    });
    providersList.appendChild(row);
  });
}

function addProvider(){
  const label = providerLabelInput.value.trim();
  const id = providerIdInput.value.trim() ||
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    ("provider-" + Date.now());
  const providerType = providerTypeSelect.value;
  const apiBase = providerBaseUrlInput.value.trim();
  const apiKeyEnv = providerApiKeyEnvInput.value.trim();

  if(!label || !id){
    settingsSyncStatus.textContent = "Provider id and name are required";
    return;
  }

  if(modelProviders.some(provider => provider.id === id)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }

  modelProviders.push({
    id,
    label,
    providerType,
    apiBase:providerType === "openai-compatible" ? apiBase : "",
    apiKeyEnv:providerType === "openai-compatible" ? apiKeyEnv : "",
    builtin:false,
    editable:true,
    models:[]
  });
  clearProviderForm();
  persistSettings("已添加 provider", false);
}

function addProviderModel(){
  const provider = getProvider(modelProviderSelect.value);
  const id = modelIdInput.value.trim();
  const label = modelLabelInput.value.trim() || id;
  const modelName = modelNameInput.value.trim() || id;

  if(!provider || !id || !label){
    settingsSyncStatus.textContent = "请选择 provider 并填写模型 id/name";
    return;
  }

  if((provider.models || []).some(model => model.id === id)){
    settingsSyncStatus.textContent = "同一 provider 中 model id 不能重复";
    return;
  }

  provider.models = provider.models || [];
  provider.models.push({
    id,
    label,
    modelName,
    providerType:provider.providerType,
    apiBase:provider.apiBase || "",
    apiKeyEnv:provider.apiKeyEnv || "",
    capabilities:{ text:true, streaming:true },
    enabled:true,
    editable:true
  });
  clearModelForm();
  persistSettings("已添加模型", false);
}

function editProvider(providerId){
  const provider = getProvider(providerId);

  if(!provider || !providerEditable(provider)){
    settingsSyncStatus.textContent = "当前 provider 不可编辑";
    return;
  }

  const dialog = createEditDialog();
  dialog.mode = "provider";
  dialog.providerId = providerId;
  dialog.title.textContent = "编辑 provider";
  dialog.body.innerHTML = [
    "<label class='settingsField'>Name<input id='editProviderLabel' /></label>",
    "<label class='settingsField'>Provider ID<input id='editProviderId' /></label>",
    "<label class='settingsField'>Type<select id='editProviderType'><option value='openai-compatible'>OpenAI-compatible</option><option value='workers-ai'>Workers AI</option></select></label>",
    "<label class='settingsField'>baseUrl<input id='editProviderBaseUrl' /></label>",
    "<label class='settingsField'>apiKeyEnv<input id='editProviderApiKeyEnv' /></label>"
  ].join("");
  dialog.body.querySelector("#editProviderLabel").value = provider.label || provider.id;
  dialog.body.querySelector("#editProviderId").value = provider.id;
  dialog.body.querySelector("#editProviderType").value = provider.providerType || "openai-compatible";
  dialog.body.querySelector("#editProviderBaseUrl").value = provider.apiBase || "";
  dialog.body.querySelector("#editProviderApiKeyEnv").value = provider.apiKeyEnv || "";
  dialog.deleteBtn.style.display = provider.builtin ? "none" : "inline-block";
  dialog.saveBtn.onclick = () => saveProviderDialog(providerId);
  dialog.deleteBtn.onclick = () => {
    if(confirm("确定删除 provider " + (provider.label || provider.id) + " 吗？")){
      removeProvider(providerId);
      closeEditDialog();
    }
  };
  dialog.overlay.classList.add("open");
}

function saveProviderDialog(originalId){
  const dialog = createEditDialog();
  const provider = getProvider(originalId);
  const label = dialog.body.querySelector("#editProviderLabel").value.trim();
  const id = dialog.body.querySelector("#editProviderId").value.trim();
  const providerType = dialog.body.querySelector("#editProviderType").value;
  const apiBase = dialog.body.querySelector("#editProviderBaseUrl").value.trim();
  const apiKeyEnv = dialog.body.querySelector("#editProviderApiKeyEnv").value.trim();

  if(!provider || !label || !id){
    settingsSyncStatus.textContent = "provider id 和 name 不能为空";
    return;
  }

  if(modelProviders.some(item => item.id === id && item.id !== originalId)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }

  provider.id = id;
  provider.label = label;
  provider.providerType = providerType;
  provider.apiBase = providerType === "openai-compatible" ? apiBase : "";
  provider.apiKeyEnv = providerType === "openai-compatible" ? apiKeyEnv : "";
  provider.models = (provider.models || []).map(model => ({
    ...model,
    providerType,
    apiBase:provider.apiBase || "",
    apiKeyEnv:provider.apiKeyEnv || ""
  }));
  closeEditDialog();
  persistSettings("已更新 provider", false);
}

function editProviderModel(providerId, modelId){
  const provider = getProvider(providerId);
  const model = provider?.models?.find(item => item.id === modelId);

  if(!provider || !model || !modelEditable(model)){
    settingsSyncStatus.textContent = "当前模型不可编辑";
    return;
  }

  const dialog = createEditDialog();
  dialog.mode = "model";
  dialog.providerId = providerId;
  dialog.modelId = modelId;
  dialog.title.textContent = "编辑 model";
  dialog.body.innerHTML = [
    "<label class='settingsField'>Name<input id='editModelLabel' /></label>",
    "<label class='settingsField'>Model ID<input id='editModelId' /></label>",
    "<label class='settingsField'>Upstream model name<input id='editModelName' /></label>"
  ].join("");
  dialog.body.querySelector("#editModelLabel").value = model.label || model.id;
  dialog.body.querySelector("#editModelId").value = model.id;
  dialog.body.querySelector("#editModelName").value = model.modelName || model.id;
  dialog.deleteBtn.style.display = "inline-block";
  dialog.saveBtn.onclick = () => saveModelDialog(providerId, modelId);
  dialog.deleteBtn.onclick = () => {
    if(confirm("确定删除模型 " + (model.label || model.id) + " 吗？")){
      removeProviderModel(providerId, modelId);
      closeEditDialog();
    }
  };
  dialog.overlay.classList.add("open");
}

function saveModelDialog(providerId, originalModelId){
  const dialog = createEditDialog();
  const provider = getProvider(providerId);
  const label = dialog.body.querySelector("#editModelLabel").value.trim();
  const id = dialog.body.querySelector("#editModelId").value.trim();
  const modelName = dialog.body.querySelector("#editModelName").value.trim() || id;
  const model = provider?.models?.find(item => item.id === originalModelId);

  if(!provider || !model || !label || !id){
    settingsSyncStatus.textContent = "model id 和 name 不能为空";
    return;
  }

  if((provider.models || []).some(item => item.id === id && item.id !== originalModelId)){
    settingsSyncStatus.textContent = "同一 provider 中 model id 不能重复";
    return;
  }

  model.id = id;
  model.label = label;
  model.modelName = modelName;
  updateModelReferences(originalModelId, id);
  closeEditDialog();
  persistSettings("已更新模型", false);
}

function removeProvider(providerId){
  const provider = getProvider(providerId);

  if(!provider || !providerEditable(provider)){
    settingsSyncStatus.textContent = "当前 provider 不可删除";
    return;
  }

  modelProviders = modelProviders.filter(item => item.id !== providerId);
  pruneInvalidModelReferences();
  persistSettings("已删除 provider", false);
}

function removeProviderModel(providerId, modelId){
  const provider = getProvider(providerId);

  if(!provider){
    return;
  }

  provider.models = (provider.models || []).filter(model => model.id !== modelId);
  pruneInvalidModelReferences();
  persistSettings("Deleted model", false);
}

function renderProvidersList(){
  providersList.innerHTML = "";
  modelProviders.forEach(provider => {
    const row = document.createElement("div");
    row.className = "providerRow";
    const header = document.createElement("div");
    header.className = "providerRowHeader";
    const main = document.createElement("div");
    main.className = "providerMain";
    const title = document.createElement("strong");
    title.textContent = provider.label || provider.id;
    const meta = document.createElement("div");
    meta.className = "providerMeta";
    meta.textContent = provider.id + " / " + provider.providerType;
    main.appendChild(title);
    main.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "providerActions";
    if(providerEditable(provider)){
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "settingsBtn";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", () => editProvider(provider.id));
      actions.appendChild(editBtn);
    }
    header.appendChild(main);
    header.appendChild(actions);
    row.appendChild(header);

    (provider.models || []).forEach(model => {
      const modelRow = document.createElement("div");
      modelRow.className = "modelRow";
      const modelMain = document.createElement("div");
      modelMain.className = "modelMain";
      const modelName = document.createElement("span");
      modelName.textContent = model.label || model.id;
      const modelMeta = document.createElement("span");
      modelMeta.className = "modelMeta";
      modelMeta.textContent = model.id;
      modelMain.appendChild(modelName);
      modelMain.appendChild(modelMeta);
      const modelActions = document.createElement("div");
      modelActions.className = "modelActions";
      if(modelEditable(model)){
        const editModelBtn = document.createElement("button");
        editModelBtn.type = "button";
        editModelBtn.className = "settingsBtn";
        editModelBtn.textContent = "编辑";
        editModelBtn.addEventListener("click", () => editProviderModel(provider.id, model.id));
        modelActions.appendChild(editModelBtn);
      }
      modelRow.appendChild(modelMain);
      modelRow.appendChild(modelActions);
      row.appendChild(modelRow);
    });

    providersList.appendChild(row);
  });
}

const MODEL_CATEGORY_DEFS = [
  { type:"workers-hosted", label:"Workers hosted", hint:"Models hosted directly on Cloudflare Workers AI" },
  { type:"claude-compatible", label:"Claude 兼容", hint:"默认走 Cloudflare proxied Claude，可配置 provider" },
  { type:"openai-compatible", label:"OpenAI 兼容", hint:"OpenAI-compatible baseUrl + apiKeyEnv provider" }
];
const WORKERS_PROVIDER_ID = "workers-ai";
const WORKERS_MODEL_PROVIDER_SELECT = "__workers-hosted__";
const MODEL_CATEGORY_COLLAPSED_KEY = "modelCategoryCollapsed";
let collapsedModelCategories = safeJsonParse(localStorage.getItem(MODEL_CATEGORY_COLLAPSED_KEY), {});

function categoryLabel(type){
  return MODEL_CATEGORY_DEFS.find(category => category.type === type)?.label || type;
}

function categoryHint(type){
  return MODEL_CATEGORY_DEFS.find(category => category.type === type)?.hint || "";
}

function legacyProviderTypeToCategory(provider){
  const providerType = String(provider?.providerType || provider?.type || "").trim();
  const providerId = String(provider?.id || provider?.providerId || provider?.provider || "").trim();
  if(providerType === "claude-compatible" || providerId === "cloudflare-proxied"){
    return "claude-compatible";
  }
  if(providerType === "openai-compatible"){
    return "openai-compatible";
  }
  return "workers-hosted";
}

function modelCategoryFromLegacy(model){
  const providerType = String(model?.providerType || "").trim();
  const providerId = String(model?.provider || "").trim();
  const id = String(model?.id || model?.modelId || model?.modelName || "").trim();
  if(providerType === "claude-compatible" || providerId === "cloudflare-proxied" || id.startsWith("anthropic/claude")){
    return "claude-compatible";
  }
  if(providerType === "openai-compatible"){
    return "openai-compatible";
  }
  return "workers-hosted";
}

function normalizeManagedModel(model, providerDefaults = {}, categoryType = "workers-hosted"){
  if(!model || typeof model !== "object" || Array.isArray(model)){
    return null;
  }
  const modelId = String(model.modelId || model.id || model.model || model.modelName || "").trim();
  if(!modelId){
    return null;
  }
  const upstreamModelName = String(model.upstreamModelName || model.modelName || model.model || modelId).trim();
  return {
    displayName:String(model.displayName || model.label || modelId),
    modelId,
    enabled:model.enabled !== false,
    notes:String(model.notes || ""),
    upstreamModelName,
    id:modelId,
    label:String(model.label || model.displayName || modelId),
    modelName:upstreamModelName || modelId,
    providerType:categoryType,
    apiBase:String(model.apiBase || model.baseUrl || providerDefaults.apiBase || providerDefaults.baseUrl || ""),
    apiKeyEnv:String(model.apiKeyEnv || providerDefaults.apiKeyEnv || ""),
    capabilities:model.capabilities || { text:true, streaming:true },
    recommended:Boolean(model.recommended),
    builtin:Boolean(model.builtin),
    editable:model.editable !== false
  };
}

function normalizeManagedProvider(provider, categoryType){
  if(!provider || typeof provider !== "object" || Array.isArray(provider)){
    return null;
  }
  const providerId = String(provider.providerId || provider.id || provider.provider || "").trim();
  if(!providerId){
    return null;
  }
  const baseUrl = String(provider.baseUrl || provider.apiBase || "").trim();
  const normalized = {
    providerName:String(provider.providerName || provider.label || providerId),
    providerId,
    baseUrl,
    apiKeyEnv:String(provider.apiKeyEnv || ""),
    enabled:provider.enabled !== false,
    builtin:Boolean(provider.builtin),
    editable:provider.editable !== false,
    models:[]
  };
  normalized.openclawExecutionMode = isOpenClawProviderConfig(normalized)
    ? (provider.openclawExecutionMode === "bridge" ? "bridge" : "legacy")
    : undefined;
  normalized.models = (provider.models || [])
    .map(model => normalizeManagedModel(model, normalized, categoryType))
    .filter(Boolean);
  return normalized;
}

function isOpenClawProviderConfig(provider){
  const values = [
    provider?.type,
    provider?.provider,
    provider?.providerId,
    provider?.id,
    provider?.providerName,
    provider?.label,
    provider?.baseUrl,
    provider?.apiBase
  ].map(value => String(value || "").trim().toLowerCase()).filter(Boolean);
  return values.some(value => value === "openclaw" || value.startsWith("openclaw-") || value.includes("openclaw"));
}

function openClawExecutionModeMarkup(prefix){
  return [
    "<div id='" + prefix + "OpenClawExecutionModeField' class='settingsField full openclawExecutionModeField' hidden>",
    "<span class='openclawExecutionModeTitle'>OpenClaw execution mode</span>",
    "<label class='openclawExecutionModeOption'>",
    "<input name='" + prefix + "OpenClawExecutionMode' value='legacy' type='radio' checked />",
    "<span class='openclawExecutionModeLabel'>Legacy SSE</span>",
    "<span class='openclawExecutionModeHelp'>Compatible with all existing OpenClaw deployments.</span>",
    "</label>",
    "<label class='openclawExecutionModeOption'>",
    "<input name='" + prefix + "OpenClawExecutionMode' value='bridge' type='radio' />",
    "<span class='openclawExecutionModeLabel'>Native Bridge</span>",
    "<span class='openclawExecutionModeHelp'>Uses the native OpenClaw Bridge runtime.</span>",
    "</label>",
    "</div>"
  ].join("");
}

function updateOpenClawExecutionModeVisibility(container, prefix, provider){
  const field = container.querySelector("#" + prefix + "OpenClawExecutionModeField");
  if(!field){
    return;
  }
  field.hidden = !isOpenClawProviderConfig(provider);
}

function getOpenClawExecutionModeValue(container, prefix, provider){
  if(!isOpenClawProviderConfig(provider)){
    return undefined;
  }
  return container.querySelector("input[name='" + prefix + "OpenClawExecutionMode']:checked")?.value === "bridge"
    ? "bridge"
    : "legacy";
}

function emptyModelCategories(){
  return MODEL_CATEGORY_DEFS.map(category => (
    category.type === "workers-hosted"
      ? { type:category.type, models:[] }
      : { type:category.type, providers:[] }
  ));
}

function categoriesFromProviders(providers){
  const categories = emptyModelCategories();
  const workersCategory = categories.find(category => category.type === "workers-hosted");
  (providers || []).forEach(provider => {
    const categoryType = legacyProviderTypeToCategory(provider);
    if(categoryType === "workers-hosted"){
      (provider.models || []).forEach(model => {
        const normalized = normalizeManagedModel(model, provider, "workers-hosted");
        if(normalized && !workersCategory.models.some(item => item.modelId === normalized.modelId)){
          workersCategory.models.push(normalized);
        }
      });
      return;
    }
    const category = categories.find(item => item.type === categoryType);
    const normalizedProvider = normalizeManagedProvider({
      ...provider,
      providerId:provider.id,
      providerName:provider.label,
      baseUrl:provider.apiBase,
      enabled:provider.enabled !== false
    }, categoryType);
    if(normalizedProvider){
      category.providers.push(normalizedProvider);
    }
  });
  return categories;
}

function normalizeModelCategories(rawCategories, fallbackProviders){
  const categories = emptyModelCategories();
  const source = Array.isArray(rawCategories) && rawCategories.length
    ? rawCategories
    : categoriesFromProviders(fallbackProviders);

  source.forEach(rawCategory => {
    const type = String(rawCategory?.type || rawCategory?.category || "").trim();
    const target = categories.find(category => category.type === type);
    if(!target){
      return;
    }
    if(type === "workers-hosted"){
      target.models = (rawCategory.models || [])
        .map(model => normalizeManagedModel(model, {}, "workers-hosted"))
        .filter(Boolean);
      return;
    }
    target.providers = (rawCategory.providers || [])
      .map(provider => normalizeManagedProvider(provider, type))
      .filter(Boolean);
  });

  return categories;
}

function categoriesToProviders(categories){
  const providers = [];
  const workers = categories.find(category => category.type === "workers-hosted");
  providers.push({
    id:WORKERS_PROVIDER_ID,
    label:"Workers 托管",
    providerType:"workers-ai",
    apiBase:"",
    apiKeyEnv:"",
    builtin:true,
    editable:false,
    enabled:true,
    models:(workers?.models || []).map(model => ({
      id:model.modelId,
      label:model.displayName || model.modelId,
      displayName:model.displayName || model.modelId,
      modelId:model.modelId,
      modelName:model.upstreamModelName || model.modelId,
      upstreamModelName:model.upstreamModelName || model.modelId,
      providerType:"workers-ai",
      apiBase:"",
      apiKeyEnv:"",
      capabilities:model.capabilities || { text:true, streaming:true },
      enabled:model.enabled !== false,
      recommended:Boolean(model.recommended),
      notes:model.notes || "",
      editable:model.editable !== false
    }))
  });

  ["claude-compatible", "openai-compatible"].forEach(type => {
    const category = categories.find(item => item.type === type);
    (category?.providers || []).forEach(provider => {
      providers.push({
        id:provider.providerId,
        label:provider.providerName || provider.providerId,
        providerName:provider.providerName || provider.providerId,
        providerId:provider.providerId,
        providerType:type,
        apiBase:provider.baseUrl || "",
        baseUrl:provider.baseUrl || "",
        apiKeyEnv:provider.apiKeyEnv || "",
        openclawExecutionMode:isOpenClawProviderConfig(provider) ? (provider.openclawExecutionMode === "bridge" ? "bridge" : "legacy") : undefined,
        builtin:Boolean(provider.builtin),
        editable:provider.editable !== false,
        enabled:provider.enabled !== false,
        models:(provider.models || []).map(model => ({
          id:model.modelId,
          label:model.displayName || model.modelId,
          displayName:model.displayName || model.modelId,
          modelId:model.modelId,
          modelName:model.upstreamModelName || model.modelId,
          upstreamModelName:model.upstreamModelName || model.modelId,
          providerType:type,
          apiBase:provider.baseUrl || "",
          baseUrl:provider.baseUrl || "",
          apiKeyEnv:provider.apiKeyEnv || "",
          capabilities:model.capabilities || { text:true, streaming:true },
          enabled:model.enabled !== false,
          recommended:Boolean(model.recommended),
          editable:model.editable !== false
        }))
      });
    });
  });

  return providers;
}

function providersFromModels(models){
  const providers = new Map();
  (models || []).forEach(model => {
    if(model.deprecated || model.enabled === false || !model.capabilities?.text){
      return;
    }
    const categoryType = modelCategoryFromLegacy(model);
    const providerId = categoryType === "workers-hosted" ? WORKERS_PROVIDER_ID : (model.provider || categoryType);
    if(!providers.has(providerId)){
      providers.set(providerId, {
        id:providerId,
        label:providerLabelFromModel(model),
        providerType:categoryType === "workers-hosted" ? "workers-ai" : categoryType,
        apiBase:model.apiBase || "",
        apiKeyEnv:model.apiKeyEnv || "",
        builtin:true,
        editable:providerId !== WORKERS_PROVIDER_ID,
        enabled:true,
        models:[]
      });
    }
    providers.get(providerId).models.push({
      id:model.id,
      label:model.label || model.id,
      displayName:model.label || model.id,
      modelId:model.id,
      modelName:model.modelName || model.id,
      upstreamModelName:model.modelName || model.id,
      providerType:categoryType === "workers-hosted" ? "workers-ai" : categoryType,
      apiBase:model.apiBase || "",
      apiKeyEnv:model.apiKeyEnv || "",
      capabilities:model.capabilities || { text:true, streaming:true },
      enabled:model.enabled !== false,
      recommended:Boolean(model.recommended),
      editable:true
    });
  });
  return Array.from(providers.values());
}

function normalizeModelSettings(settings, fallbackProviders){
  const base = settings && typeof settings === "object" ? settings : readLegacyModelSettings();
  const fallback = Array.isArray(fallbackProviders) ? fallbackProviders : [];
  const categorySource = Array.isArray(base.categories) && base.categories.length
    ? base.categories
    : (Array.isArray(base.modelCategories) && base.modelCategories.length ? base.modelCategories : null);
  const categories = normalizeModelCategories(categorySource, Array.isArray(base.providers) && base.providers.length ? base.providers : fallback);
  const providers = categoriesToProviders(categories);
  return {
    defaultModel:base.defaultModel || "",
    rememberLastModel:Boolean(base.rememberLastModel),
    lastModel:base.lastModel || base.selectedModel || "",
    fallbackEnabled:Boolean(base.fallbackEnabled ?? base.autoFallbackEnabled),
    fallbackModels:Array.isArray(base.fallbackModels) ? base.fallbackModels : (base.fallbackModel ? [base.fallbackModel] : []),
    customModels:Array.isArray(base.customModels) ? base.customModels : [],
    customProviders:Array.isArray(base.customProviders) ? base.customProviders : [],
    showPerMessageModelInfo:Boolean(base.showPerMessageModelInfo),
    conversationAttachmentLimits:normalizeConversationAttachmentLimits(base.conversationAttachmentLimits),
    categories,
    modelCategories:categories,
    providers,
    updatedAt:Number(base.updatedAt || base.version || 0) || 0,
    version:Number(base.version || base.updatedAt || 0) || 0
  };
}

function syncCatalogFromCategories(){
  modelProviders = categoriesToProviders(modelCategories);
  modelSettingsState.categories = modelCategories;
  modelSettingsState.modelCategories = modelCategories;
  modelSettingsState.providers = modelProviders;
}

function flattenProviders(providers){
  return (providers || [])
    .filter(provider => provider.enabled !== false)
    .flatMap(provider => (provider.models || []).map(model => ({
    ...model,
    provider:provider.id,
    providerLabel:provider.label || provider.providerName || provider.id,
    providerType:model.providerType || provider.providerType,
    apiBase:model.apiBase || provider.apiBase || provider.baseUrl || "",
    baseUrl:model.baseUrl || provider.baseUrl || provider.apiBase || "",
    apiKeyEnv:model.apiKeyEnv || provider.apiKeyEnv || "",
    label:model.label || model.displayName || model.id,
    id:model.id || model.modelId,
    modelName:model.modelName || model.upstreamModelName || model.id || model.modelId
  }))).filter(model => model.enabled !== false);
}

function renderModelOptions(){
  modelSelect.innerHTML = "";
  modelOptions = flattenProviders(modelProviders);
  const groups = new Map();
  modelOptions.forEach(model => {
    const groupLabel = categoryLabel(modelCategoryFromLegacy(model));
    if(!groups.has(groupLabel)){
      const group = document.createElement("optgroup");
      group.label = groupLabel;
      groups.set(groupLabel, group);
      modelSelect.appendChild(group);
    }
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = (model.label || model.id) + (model.recommended ? " / 推荐" : "");
    option.dataset.provider = model.provider || "";
    option.dataset.providerType = model.providerType || "";
    groups.get(groupLabel).appendChild(option);
  });
}

function refreshSettingsControls(){
  const settingsPanel = settingsModal.querySelector(".settingsPanel");
  const settingsScrollTop = settingsPanel?.scrollTop || 0;
  const fillSelect = (select, includeEmpty) => {
    select.innerHTML = "";
    if(includeEmpty){
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "None";
      select.appendChild(empty);
    }
    modelOptions.forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = categoryLabel(modelCategoryFromLegacy(model)) + " / " + (model.label || model.id);
      select.appendChild(option);
    });
  };
  fillSelect(defaultModelSelect, false);
  fillSelect(fallbackModelSelect, true);
  defaultModelSelect.value = hasModel(modelSettingsState?.defaultModel) ? modelSettingsState.defaultModel : (modelOptions[0]?.id || "");
  fallbackModelSelect.value = hasModel(modelSettingsState?.fallbackModels?.[0]) ? modelSettingsState.fallbackModels[0] : "";
  rememberLastModelCheck.checked = Boolean(modelSettingsState?.rememberLastModel);
  fallbackEnabledCheck.checked = Boolean(modelSettingsState?.fallbackEnabled);
  showPerMessageModelInfoCheck.checked = Boolean(modelSettingsState?.showPerMessageModelInfo);
  setConversationAttachmentLimitInputs(modelSettingsState?.conversationAttachmentLimits);
  modelProviderSelect.innerHTML = "";
  const workersOption = document.createElement("option");
  workersOption.value = WORKERS_MODEL_PROVIDER_SELECT;
  workersOption.textContent = "Workers 托管";
  modelProviderSelect.appendChild(workersOption);
  modelProviders
    .filter(provider => provider.providerType === "claude-compatible" || provider.providerType === "openai-compatible")
    .forEach(provider => {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = categoryLabel(provider.providerType) + " / " + (provider.label || provider.id);
      modelProviderSelect.appendChild(option);
    });
  renderProvidersList();
  if(settingsPanel){
    settingsPanel.scrollTop = settingsScrollTop;
  }
}

async function loadModels(){
  try{
    const res = await fetch("/api/models");
    const data = await res.json();
    if(!res.ok || !Array.isArray(data.models) || !data.models.length) throw new Error("models unavailable");
    const fallbackProviders = providersFromModels(data.models);
    modelSettingsState = await loadSettingsFromServer(fallbackProviders);
    modelCategories = normalizeModelCategories(modelSettingsState.categories || modelSettingsState.modelCategories, modelSettingsState.providers || fallbackProviders);
    syncCatalogFromCategories();
    renderModelOptions();
    selectInitialModel();
    refreshSettingsControls();
    writeSettingsCache(modelSettingsState);
    syncSettingsToServer(modelSettingsState);
  }catch(err){
    console.log("load models failed", err);
  }
}

function openSettings(){
  setupSettingsHeaderActions();
  clearProviderForm();
  clearModelForm();
  modelCategories = normalizeModelCategories(modelSettingsState?.categories || modelSettingsState?.modelCategories, modelProviders);
  syncCatalogFromCategories();
  settingsSnapshot = {
    settings:deepClone(modelSettingsState),
    providers:deepClone(modelProviders),
    categories:deepClone(modelCategories),
    selected:currentSelectedSnapshot()
  };
  refreshSettingsControls();
  settingsSyncStatus.textContent = "";
  settingsModal.classList.add("open");
  settingsModal.setAttribute("aria-hidden", "false");
}

function cancelSettings(){
  if(settingsSnapshot){
    modelSettingsState = deepClone(settingsSnapshot.settings);
    modelCategories = deepClone(settingsSnapshot.categories || []);
    modelProviders = deepClone(settingsSnapshot.providers || categoriesToProviders(modelCategories));
    renderModelOptions();
    modelSelect.value = hasModel(settingsSnapshot.selected?.selectedModel)
      ? settingsSnapshot.selected.selectedModel
      : (modelOptions[0]?.id || "");
    refreshSettingsControls();
  }
  clearProviderForm();
  clearModelForm();
  closeSettings();
}

function persistSettings(message, closeAfter){
  syncCatalogFromCategories();
  writeSettingsCache(modelSettingsState);
  renderModelOptions();
  if(modelSelect.value && !hasModel(modelSelect.value)){
    selectInitialModel();
  }
  refreshSettingsControls();
  if(message){
    settingsSyncStatus.textContent = message;
  }
  syncSettingsToServer(modelSettingsState);
  if(closeAfter){
    closeSettings();
  }
}

function pruneInvalidModelReferences(){
  syncCatalogFromCategories();
  renderModelOptions();
  if(!hasModel(modelSettingsState.defaultModel)){
    modelSettingsState.defaultModel = "";
  }
  if(!hasModel(modelSettingsState.lastModel)){
    modelSettingsState.lastModel = "";
  }
  modelSettingsState.fallbackModels = (modelSettingsState.fallbackModels || []).filter(hasModel);
  if(modelSelect.value && !hasModel(modelSelect.value)){
    modelSelect.value = modelSettingsState.defaultModel || modelOptions[0]?.id || "";
  }
}

function getCategory(type){
  let category = modelCategories.find(item => item.type === type);
  if(!category){
    category = type === "workers-hosted" ? { type, models:[] } : { type, providers:[] };
    modelCategories.push(category);
  }
  return category;
}

function getManagedProvider(providerId){
  for(const category of modelCategories){
    const provider = (category.providers || []).find(item => item.providerId === providerId);
    if(provider){
      return { category, provider };
    }
  }
  return null;
}

function getProvider(providerId){
  return modelProviders.find(provider => provider.id === providerId);
}

function addProvider(){
  const providerName = providerLabelInput.value.trim();
  const providerId = providerIdInput.value.trim() ||
    providerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    ("provider-" + Date.now());
  const providerType = providerTypeSelect.value;
  const baseUrl = providerBaseUrlInput.value.trim();
  const apiKeyEnv = providerApiKeyEnvInput.value.trim();
  if(!providerName || !providerId){
    settingsSyncStatus.textContent = "Provider id and name are required";
    return;
  }
  if(providerType !== "claude-compatible" && providerType !== "openai-compatible"){
    settingsSyncStatus.textContent = "请选择 Claude 兼容或 OpenAI 兼容 provider";
    return;
  }
  if(modelProviders.some(provider => provider.id === providerId)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }
  getCategory(providerType).providers.push({
    providerName,
    providerId,
    baseUrl,
    apiKeyEnv,
    enabled:true,
    builtin:false,
    editable:true,
    models:[]
  });
  clearProviderForm();
  persistSettings("已添加 provider", false);
}

function addProviderModel(){
  const selectedProvider = modelProviderSelect.value;
  const modelId = modelIdInput.value.trim();
  const displayName = modelLabelInput.value.trim() || modelId;
  const upstreamModelName = modelNameInput.value.trim() || modelId;
  if(!modelId || !displayName){
    settingsSyncStatus.textContent = "请填写模型 id/name";
    return;
  }
  const model = {
    displayName,
    modelId,
    upstreamModelName,
    enabled:true,
    editable:true,
    capabilities:{ text:true, streaming:true }
  };
  if(selectedProvider === WORKERS_MODEL_PROVIDER_SELECT){
    const category = getCategory("workers-hosted");
    if((category.models || []).some(item => item.modelId === modelId)){
      settingsSyncStatus.textContent = "Workers 托管模型 ID 不能重复";
      return;
    }
    category.models = category.models || [];
    category.models.push({ ...model, notes:"" });
  }else{
    const found = getManagedProvider(selectedProvider);
    if(!found){
      settingsSyncStatus.textContent = "请选择 provider";
      return;
    }
    if((found.provider.models || []).some(item => item.modelId === modelId)){
      settingsSyncStatus.textContent = "同一 provider 中 model id 不能重复";
      return;
    }
    found.provider.models = found.provider.models || [];
    found.provider.models.push(model);
  }
  clearModelForm();
  persistSettings("Added model", false);
}

function editProvider(providerId){
  const found = getManagedProvider(providerId);
  const provider = found?.provider;
  if(!provider || !providerEditable({ editable:provider.editable })){
    settingsSyncStatus.textContent = "当前 provider 不可编辑";
    return;
  }
  const dialog = createEditDialog();
  dialog.title.textContent = "编辑 provider";
  dialog.body.innerHTML = [
    "<label class='settingsField'>providerName<input id='editProviderLabel' /></label>",
    "<label class='settingsField'>providerId<input id='editProviderId' /></label>",
    "<label class='settingsField'>type<select id='editProviderType'><option value='claude-compatible'>Claude 兼容</option><option value='openai-compatible'>OpenAI 兼容</option></select></label>",
    "<label class='settingsField'>baseUrl<input id='editProviderBaseUrl' /></label>",
    "<label class='settingsField'>apiKeyEnv<input id='editProviderApiKeyEnv' /></label>",
    openClawExecutionModeMarkup("editProvider"),
    "<label class='settingsCheck'><input id='editProviderEnabled' type='checkbox' /> enabled</label>"
  ].join("");
  dialog.body.querySelector("#editProviderLabel").value = provider.providerName || provider.providerId;
  dialog.body.querySelector("#editProviderId").value = provider.providerId;
  dialog.body.querySelector("#editProviderType").value = found.category.type;
  dialog.body.querySelector("#editProviderBaseUrl").value = provider.baseUrl || "";
  dialog.body.querySelector("#editProviderApiKeyEnv").value = provider.apiKeyEnv || "";
  dialog.body.querySelector("input[name='editProviderOpenClawExecutionMode'][value='" + (provider.openclawExecutionMode === "bridge" ? "bridge" : "legacy") + "']").checked = true;
  dialog.body.querySelector("#editProviderEnabled").checked = provider.enabled !== false;
  const refreshOpenClawModeVisibility = () => updateOpenClawExecutionModeVisibility(dialog.body, "editProvider", {
    providerId:dialog.body.querySelector("#editProviderId").value,
    providerName:dialog.body.querySelector("#editProviderLabel").value,
    baseUrl:dialog.body.querySelector("#editProviderBaseUrl").value
  });
  ["#editProviderLabel", "#editProviderId", "#editProviderBaseUrl"].forEach(selector => {
    dialog.body.querySelector(selector).addEventListener("input", refreshOpenClawModeVisibility);
  });
  refreshOpenClawModeVisibility();
  dialog.deleteBtn.style.display = "inline-block";
  dialog.saveBtn.onclick = () => saveProviderDialog(providerId);
  dialog.deleteBtn.onclick = () => removeProvider(providerId, true);
  dialog.overlay.classList.add("open");
}

function saveProviderDialog(originalId){
  const dialog = createEditDialog();
  const found = getManagedProvider(originalId);
  if(!found){
    return;
  }
  const providerName = dialog.body.querySelector("#editProviderLabel").value.trim();
  const providerId = dialog.body.querySelector("#editProviderId").value.trim();
  const providerType = dialog.body.querySelector("#editProviderType").value;
  const baseUrl = dialog.body.querySelector("#editProviderBaseUrl").value.trim();
  const apiKeyEnv = dialog.body.querySelector("#editProviderApiKeyEnv").value.trim();
  const enabled = dialog.body.querySelector("#editProviderEnabled").checked;
  const openclawExecutionMode = getOpenClawExecutionModeValue(dialog.body, "editProvider", {
    providerId,
    providerName,
    baseUrl
  });
  if(!providerName || !providerId){
    settingsSyncStatus.textContent = "provider id 和 name 不能为空";
    return;
  }
  if(modelProviders.some(provider => provider.id === providerId && provider.id !== originalId)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }
  found.category.providers = (found.category.providers || []).filter(provider => provider.providerId !== originalId);
  const nextProvider = {
    ...found.provider,
    providerName,
    providerId,
    baseUrl,
    apiKeyEnv,
    openclawExecutionMode,
    enabled
  };
  getCategory(providerType).providers.push(nextProvider);
  closeEditDialog();
  persistSettings("已更新 provider", false);
}

function editProviderModel(providerId, modelId){
  const found = providerId === WORKERS_PROVIDER_ID
    ? { category:getCategory("workers-hosted"), provider:null }
    : getManagedProvider(providerId);
  const model = providerId === WORKERS_PROVIDER_ID
    ? found.category.models?.find(item => item.modelId === modelId)
    : found?.provider?.models?.find(item => item.modelId === modelId);
  if(!model || !modelEditable(model)){
    settingsSyncStatus.textContent = "当前模型不可编辑";
    return;
  }
  const dialog = createEditDialog();
  dialog.title.textContent = "编辑模型";
  dialog.body.innerHTML = [
    "<label class='settingsField'>displayName<input id='editModelLabel' /></label>",
    "<label class='settingsField'>modelId<input id='editModelId' /></label>",
    "<label class='settingsField'>upstreamModelName<input id='editModelName' /></label>",
    providerId === WORKERS_PROVIDER_ID ? "<label class='settingsField full'>notes<input id='editModelNotes' /></label>" : "",
    "<label class='settingsCheck'><input id='editModelEnabled' type='checkbox' /> enabled</label>"
  ].join("");
  dialog.body.querySelector("#editModelLabel").value = model.displayName || model.label || model.modelId;
  dialog.body.querySelector("#editModelId").value = model.modelId || model.id;
  dialog.body.querySelector("#editModelName").value = model.upstreamModelName || model.modelName || model.modelId;
  const notesInput = dialog.body.querySelector("#editModelNotes");
  if(notesInput){
    notesInput.value = model.notes || "";
  }
  dialog.body.querySelector("#editModelEnabled").checked = model.enabled !== false;
  dialog.deleteBtn.style.display = "inline-block";
  dialog.saveBtn.onclick = () => saveModelDialog(providerId, modelId);
  dialog.deleteBtn.onclick = () => removeProviderModel(providerId, modelId, true);
  dialog.overlay.classList.add("open");
}

function saveModelDialog(providerId, originalModelId){
  const dialog = createEditDialog();
  const displayName = dialog.body.querySelector("#editModelLabel").value.trim();
  const modelId = dialog.body.querySelector("#editModelId").value.trim();
  const upstreamModelName = dialog.body.querySelector("#editModelName").value.trim() || modelId;
  const enabled = dialog.body.querySelector("#editModelEnabled").checked;
  const notes = dialog.body.querySelector("#editModelNotes")?.value.trim() || "";
  const modelList = providerId === WORKERS_PROVIDER_ID
    ? getCategory("workers-hosted").models
    : getManagedProvider(providerId)?.provider?.models;
  const model = modelList?.find(item => item.modelId === originalModelId);
  if(!model || !displayName || !modelId){
    settingsSyncStatus.textContent = "model id 和 name 不能为空";
    return;
  }
  if((modelList || []).some(item => item.modelId === modelId && item.modelId !== originalModelId)){
    settingsSyncStatus.textContent = "同一分组中 model id 不能重复";
    return;
  }
  model.displayName = displayName;
  model.modelId = modelId;
  model.upstreamModelName = upstreamModelName;
  model.enabled = enabled;
  model.notes = notes;
  updateModelReferences(originalModelId, modelId);
  closeEditDialog();
  persistSettings("Updated model", false);
}

function removeProvider(providerId, skipDialogClose){
  const found = getManagedProvider(providerId);
  if(!found){
    return;
  }
  if(!confirm("Delete provider " + (found.provider.providerName || found.provider.providerId) + "? Models under it will also be deleted.")){
    return;
  }
  found.category.providers = (found.category.providers || []).filter(provider => provider.providerId !== providerId);
  pruneInvalidModelReferences();
  if(skipDialogClose){
    closeEditDialog();
  }
  persistSettings("Deleted provider", false);
}

function removeProviderModel(providerId, modelId, skipDialogClose){
  const modelList = providerId === WORKERS_PROVIDER_ID
    ? getCategory("workers-hosted").models
    : getManagedProvider(providerId)?.provider?.models;
  const target = modelList?.find(model => model.modelId === modelId);
  if(!target){
    return;
  }
  if(!confirm("确定删除模型 " + (target.displayName || target.modelId) + " 吗？")){
    return;
  }
  if(providerId === WORKERS_PROVIDER_ID){
    getCategory("workers-hosted").models = (modelList || []).filter(model => model.modelId !== modelId);
  }else{
    const found = getManagedProvider(providerId);
    found.provider.models = (modelList || []).filter(model => model.modelId !== modelId);
  }
  pruneInvalidModelReferences();
  if(skipDialogClose){
    closeEditDialog();
  }
  persistSettings("Deleted model", false);
}

function toggleModelCategory(type){
  collapsedModelCategories[type] = !collapsedModelCategories[type];
  localStorage.setItem(MODEL_CATEGORY_COLLAPSED_KEY, JSON.stringify(collapsedModelCategories));
  renderProvidersList();
}

function formatHealthLatency(latencyMs){
  if(typeof latencyMs !== "number" || !Number.isFinite(latencyMs)){
    return "";
  }
  return (latencyMs / 1000).toFixed(1).replace(/\.0$/, "") + "s";
}

function formatHealthSuccessRate(successRate, sampleSize){
  if(typeof successRate !== "number" || !Number.isFinite(successRate) || !sampleSize){
    return "成功率 --";
  }
  return "成功率 " + Math.round(successRate * 100) + "%";
}

function formatHealthCheckedAt(checkedAt){
  if(!checkedAt){
    return "最后检查 --";
  }
  const date = new Date(checkedAt);
  if(Number.isNaN(date.getTime())){
    return "最后检查 --";
  }
  return "最后检查 " + date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function healthIcon(result){
  if(result.ok){
    return "OK";
  }
  const status = String(result.status || "");
  return status === "429" ? "WARN" : "ERR";
}

function updateModelHealthActions(){
  const hasResults = Array.isArray(modelHealthCache) && modelHealthCache.length > 0;
  modelHealthToggleBtn.hidden = !hasResults;
  modelHealthToggleBtn.textContent = modelHealthCollapsed ? "展开" : "收起";
  if(!modelHealthBtn.disabled){
    modelHealthBtn.textContent = hasResults ? "重新检查" : "检查";
  }
  modelHealthResults.classList.toggle("collapsed", modelHealthCollapsed && hasResults);
}

function withModelHealthScrollPreserved(callback){
  const settingsPanel = settingsModal.querySelector(".settingsPanel");
  const scrollTop = settingsPanel?.scrollTop || 0;
  const result = callback();
  if(settingsPanel){
    settingsPanel.scrollTop = scrollTop;
  }
  return result;
}

function renderModelHealthResults(results){
  withModelHealthScrollPreserved(() => {
  modelHealthResults.innerHTML = "";

  if(!Array.isArray(results) || !results.length){
    const empty = document.createElement("div");
    empty.className = "modelHealthItem";
    empty.textContent = "暂无模型结果";
    modelHealthResults.appendChild(empty);
    updateModelHealthActions();
    return;
  }

  results.forEach(result => {
    const item = document.createElement("div");
    item.className = "modelHealthItem";
    const name = document.createElement("span");
    name.className = "modelHealthName";
    name.textContent = result.label || result.model || "Model";
    name.title = [result.provider, result.model, result.error].filter(Boolean).join(" / ");
    const status = document.createElement("span");
    status.className = "modelHealthStatus";
    const stateText = result.ok ? "在线" : "离线";
    const latencyText = formatHealthLatency(result.latencyMs);
    const detailParts = [
      healthIcon(result) + " " + stateText,
      latencyText ? "Latency " + latencyText : "",
      formatHealthSuccessRate(result.successRate, result.sampleSize),
      formatHealthCheckedAt(result.checkedAt)
    ].filter(Boolean);
    if(!result.ok && result.status){
      detailParts.splice(1, 0, String(result.status));
    }
    detailParts.forEach(part => {
      const detail = document.createElement("span");
      detail.textContent = part;
      status.appendChild(detail);
    });
    item.appendChild(name);
    item.appendChild(status);
    modelHealthResults.appendChild(item);
  });

  updateModelHealthActions();
  });
}

function toggleModelHealthResults(){
  if(!modelHealthCache.length){
    return;
  }
  withModelHealthScrollPreserved(() => {
    modelHealthCollapsed = !modelHealthCollapsed;
    if(!modelHealthCollapsed){
      renderModelHealthResults(modelHealthCache);
      return;
    }
    updateModelHealthActions();
  });
}

async function runModelHealthCheck(){
  const previousText = modelHealthBtn.textContent;
  modelHealthBtn.disabled = true;
  modelHealthToggleBtn.disabled = true;
  modelHealthBtn.textContent = "检查中";
  modelHealthCollapsed = false;
  updateModelHealthActions();
  withModelHealthScrollPreserved(() => {
    modelHealthResults.innerHTML = "<div class='modelHealthItem'>正在检查...</div>";
  });

  try{
    const res = await fetch("/api/model-health");
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "Model health check failed");
    }
    modelHealthCache = data.results || [];
    renderModelHealthResults(modelHealthCache);
  }catch(err){
    modelHealthCache = [];
    withModelHealthScrollPreserved(() => {
      modelHealthResults.innerHTML = "";
      const item = document.createElement("div");
      item.className = "modelHealthItem";
      item.textContent = err.message || "Model health check failed";
      modelHealthResults.appendChild(item);
      updateModelHealthActions();
    });
  }finally{
    modelHealthBtn.disabled = false;
    modelHealthToggleBtn.disabled = false;
    modelHealthBtn.textContent = modelHealthCache.length ? "重新检查" : previousText;
    updateModelHealthActions();
  }
}

function closeModelActionMenus(exceptMenu){
  providersList.querySelectorAll(".actionMenu.open").forEach(menu => {
    if(menu !== exceptMenu){
      menu.classList.remove("open");
      menu.previousElementSibling?.setAttribute("aria-expanded", "false");
    }
  });
}

function createActionMenu(items){
  const actions = document.createElement("div");
  actions.className = "modelActions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "actionMenuButton";
  button.textContent = "...";
  button.setAttribute("aria-label", "更多操作");
  button.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "actionMenu";

  items.forEach(item => {
    const menuItem = document.createElement("button");
    menuItem.type = "button";
    menuItem.textContent = item.label;
    menuItem.addEventListener("click", event => {
      event.stopPropagation();
      closeModelActionMenus();
      item.onClick();
    });
    menu.appendChild(menuItem);
  });

  button.addEventListener("click", event => {
    event.stopPropagation();
    const shouldOpen = !menu.classList.contains("open");
    closeModelActionMenus(menu);
    menu.classList.toggle("open", shouldOpen);
    button.setAttribute("aria-expanded", String(shouldOpen));
  });

  actions.appendChild(button);
  actions.appendChild(menu);
  return actions;
}

function openAddProviderDialog(categoryType){
  if(categoryType !== "claude-compatible" && categoryType !== "openai-compatible"){
    return;
  }
  const dialog = createEditDialog();
  dialog.title.textContent = "新增 provider";
  dialog.body.innerHTML = [
    "<label class='settingsField'>providerName<input id='newProviderLabel' placeholder='My Provider' /></label>",
    "<label class='settingsField'>providerId<input id='newProviderId' placeholder='my-provider' /></label>",
    "<label class='settingsField full'>baseUrl<input id='newProviderBaseUrl' placeholder='https://api.example.com/v1' /></label>",
    "<label class='settingsField'>apiKeyEnv<input id='newProviderApiKeyEnv' placeholder='MY_PROVIDER_API_KEY' /></label>",
    openClawExecutionModeMarkup("newProvider"),
    "<label class='settingsCheck'><input id='newProviderEnabled' type='checkbox' checked /> enabled</label>"
  ].join("");
  const refreshOpenClawModeVisibility = () => updateOpenClawExecutionModeVisibility(dialog.body, "newProvider", {
    providerId:dialog.body.querySelector("#newProviderId").value,
    providerName:dialog.body.querySelector("#newProviderLabel").value,
    baseUrl:dialog.body.querySelector("#newProviderBaseUrl").value
  });
  ["#newProviderLabel", "#newProviderId", "#newProviderBaseUrl"].forEach(selector => {
    dialog.body.querySelector(selector).addEventListener("input", refreshOpenClawModeVisibility);
  });
  refreshOpenClawModeVisibility();
  dialog.deleteBtn.style.display = "none";
  dialog.saveBtn.onclick = () => saveNewProviderDialog(categoryType);
  dialog.overlay.classList.add("open");
  dialog.body.querySelector("#newProviderLabel")?.focus();
}

function saveNewProviderDialog(categoryType){
  const dialog = createEditDialog();
  const providerName = dialog.body.querySelector("#newProviderLabel").value.trim();
  const providerId = dialog.body.querySelector("#newProviderId").value.trim() ||
    providerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    ("provider-" + Date.now());
  const baseUrl = dialog.body.querySelector("#newProviderBaseUrl").value.trim();
  const apiKeyEnv = dialog.body.querySelector("#newProviderApiKeyEnv").value.trim();
  const enabled = dialog.body.querySelector("#newProviderEnabled").checked;
  const openclawExecutionMode = getOpenClawExecutionModeValue(dialog.body, "newProvider", {
    providerId,
    providerName,
    baseUrl
  });
  if(!providerName || !providerId){
    settingsSyncStatus.textContent = "Provider id and name are required";
    return;
  }
  if(modelProviders.some(provider => provider.id === providerId)){
    settingsSyncStatus.textContent = "Provider id already exists";
    return;
  }
  getCategory(categoryType).providers.push({
    providerName,
    providerId,
    baseUrl,
    apiKeyEnv,
    openclawExecutionMode,
    enabled,
    builtin:false,
    editable:true,
    models:[]
  });
  closeEditDialog();
  persistSettings("已添加 provider", false);
}

function openAddModelDialog(providerId){
  const isWorkers = providerId === WORKERS_PROVIDER_ID;
  const found = isWorkers ? null : getManagedProvider(providerId);
  if(!isWorkers && !found){
    settingsSyncStatus.textContent = "请选择 provider";
    return;
  }
  const dialog = createEditDialog();
  dialog.title.textContent = isWorkers ? "新增 Workers 托管模型" : "新增模型";
  dialog.body.innerHTML = [
    "<label class='settingsField'>displayName<input id='newModelLabel' placeholder='My Model' /></label>",
    "<label class='settingsField'>modelId<input id='newModelId' placeholder='@cf/... 或 provider-model' /></label>",
    "<label class='settingsField'>upstreamModelName<input id='newModelName' placeholder='可留空，默认等于 modelId' /></label>",
    isWorkers ? "<label class='settingsField full'>notes<input id='newModelNotes' placeholder='可选' /></label>" : "",
    "<label class='settingsCheck'><input id='newModelEnabled' type='checkbox' checked /> enabled</label>"
  ].join("");
  dialog.deleteBtn.style.display = "none";
  dialog.saveBtn.onclick = () => saveNewModelDialog(providerId);
  dialog.overlay.classList.add("open");
  dialog.body.querySelector("#newModelLabel")?.focus();
}

function saveNewModelDialog(providerId){
  const dialog = createEditDialog();
  const modelId = dialog.body.querySelector("#newModelId").value.trim();
  const displayName = dialog.body.querySelector("#newModelLabel").value.trim() || modelId;
  const upstreamModelName = dialog.body.querySelector("#newModelName").value.trim() || modelId;
  const enabled = dialog.body.querySelector("#newModelEnabled").checked;
  const notes = dialog.body.querySelector("#newModelNotes")?.value.trim() || "";
  if(!modelId || !displayName){
    settingsSyncStatus.textContent = "请填写模型 id/name";
    return;
  }
  const model = {
    displayName,
    modelId,
    upstreamModelName,
    enabled,
    notes,
    editable:true,
    capabilities:{ text:true, streaming:true }
  };
  if(providerId === WORKERS_PROVIDER_ID){
    const category = getCategory("workers-hosted");
    if((category.models || []).some(item => item.modelId === modelId)){
      settingsSyncStatus.textContent = "Workers 托管模型 ID 不能重复";
      return;
    }
    category.models = category.models || [];
    category.models.push(model);
  }else{
    const found = getManagedProvider(providerId);
    if(!found){
      settingsSyncStatus.textContent = "请选择 provider";
      return;
    }
    if((found.provider.models || []).some(item => item.modelId === modelId)){
      settingsSyncStatus.textContent = "同一 provider 中 model id 不能重复";
      return;
    }
    found.provider.models = found.provider.models || [];
    found.provider.models.push(model);
  }
  closeEditDialog();
  persistSettings("Added model", false);
}

function appendModelRow(container, providerId, model){
  const modelRow = document.createElement("div");
  modelRow.className = "modelRow";
  const modelMain = document.createElement("div");
  modelMain.className = "modelMain";
  const modelName = document.createElement("span");
  modelName.textContent = model.displayName || model.label || model.modelId || model.id;
  const modelMeta = document.createElement("span");
  modelMeta.className = "modelMeta";
  modelMeta.textContent = (model.modelId || model.id) + (model.enabled === false ? " / disabled" : "");
  modelMain.appendChild(modelName);
  modelMain.appendChild(modelMeta);
  const modelActions = document.createElement("div");
  modelActions.className = "modelActions";
  const editModelBtn = document.createElement("button");
  editModelBtn.type = "button";
  editModelBtn.className = "settingsBtn";
  editModelBtn.textContent = "编辑";
  editModelBtn.addEventListener("click", () => editProviderModel(providerId, model.modelId || model.id));
  const removeModelBtn = document.createElement("button");
  removeModelBtn.type = "button";
  removeModelBtn.className = "settingsBtn";
  removeModelBtn.textContent = "删除";
  removeModelBtn.addEventListener("click", () => removeProviderModel(providerId, model.modelId || model.id));
  modelActions.appendChild(editModelBtn);
  modelActions.appendChild(removeModelBtn);
  modelRow.appendChild(modelMain);
  modelRow.appendChild(modelActions);
  container.appendChild(modelRow);
}

function renderProvidersList(){
  providersList.innerHTML = "";
  MODEL_CATEGORY_DEFS.forEach(categoryDef => {
    const category = getCategory(categoryDef.type);
    const section = document.createElement("section");
    section.className = "modelCategory" + (collapsedModelCategories[categoryDef.type] ? " collapsed" : "");
    const header = document.createElement("button");
    header.type = "button";
    header.className = "modelCategoryHeader";
    const titleWrap = document.createElement("span");
    titleWrap.className = "modelCategoryTitle";
    const title = document.createElement("strong");
    title.textContent = categoryDef.label;
    const meta = document.createElement("span");
    meta.className = "modelCategoryMeta";
    const count = categoryDef.type === "workers-hosted"
      ? (category.models || []).length
      : (category.providers || []).reduce((sum, provider) => sum + (provider.models || []).length, 0);
    meta.textContent = categoryHint(categoryDef.type) + " / " + count + " models";
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    const chevron = document.createElement("span");
    chevron.textContent = collapsedModelCategories[categoryDef.type] ? "+" : "-";
    header.appendChild(titleWrap);
    header.appendChild(chevron);
    header.addEventListener("click", () => toggleModelCategory(categoryDef.type));
    section.appendChild(header);
    const body = document.createElement("div");
    body.className = "modelCategoryBody";

    if(categoryDef.type === "workers-hosted"){
      (category.models || []).forEach(model => appendModelRow(body, WORKERS_PROVIDER_ID, model));
      if(!(category.models || []).length){
        const empty = document.createElement("div");
        empty.className = "providerMeta";
        empty.textContent = "暂无模型";
        body.appendChild(empty);
      }
    }else{
      (category.providers || []).forEach(provider => {
        const row = document.createElement("div");
        row.className = "providerRow";
        const rowHeader = document.createElement("div");
        rowHeader.className = "providerRowHeader";
        const main = document.createElement("div");
        main.className = "providerMain";
        const providerTitle = document.createElement("strong");
        providerTitle.textContent = provider.providerName || provider.providerId;
        const providerMeta = document.createElement("div");
        providerMeta.className = "providerMeta";
        providerMeta.textContent = provider.providerId + " / " + (provider.baseUrl || "Cloudflare proxied Claude") + (provider.enabled === false ? " / disabled" : "");
        main.appendChild(providerTitle);
        main.appendChild(providerMeta);
        const actions = document.createElement("div");
        actions.className = "providerActions";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "settingsBtn";
        editBtn.textContent = "编辑";
        editBtn.addEventListener("click", () => editProvider(provider.providerId));
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "settingsBtn";
        removeBtn.textContent = "删除";
        removeBtn.addEventListener("click", () => removeProvider(provider.providerId));
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "settingsBtn";
        addBtn.textContent = "添加模型";
        addBtn.addEventListener("click", () => {
          modelProviderSelect.value = provider.providerId;
          modelLabelInput.focus();
        });
        actions.appendChild(editBtn);
        actions.appendChild(removeBtn);
        actions.appendChild(addBtn);
        rowHeader.appendChild(main);
        rowHeader.appendChild(actions);
        row.appendChild(rowHeader);
        (provider.models || []).forEach(model => appendModelRow(row, provider.providerId, model));
        body.appendChild(row);
      });
      if(!(category.providers || []).length){
        const empty = document.createElement("div");
        empty.className = "providerMeta";
        empty.textContent = "暂无 provider";
        body.appendChild(empty);
      }
    }

    section.appendChild(body);
    providersList.appendChild(section);
  });
}

function appendModelRow(container, providerId, model){
  const modelRow = document.createElement("div");
  modelRow.className = "modelRow";
  const modelMain = document.createElement("div");
  modelMain.className = "modelMain";
  const modelName = document.createElement("span");
  modelName.textContent = model.displayName || model.label || model.modelId || model.id;
  const modelMeta = document.createElement("span");
  modelMeta.className = "modelMeta";
  modelMeta.textContent = (model.modelId || model.id) + (model.enabled === false ? " / disabled" : "");
  modelMain.appendChild(modelName);
  modelMain.appendChild(modelMeta);
  modelRow.appendChild(modelMain);
  modelRow.appendChild(createActionMenu([
    { label:"编辑模型", onClick:() => editProviderModel(providerId, model.modelId || model.id) },
    { label:"删除模型", onClick:() => removeProviderModel(providerId, model.modelId || model.id) }
  ]));
  container.appendChild(modelRow);
}

function renderProvidersList(){
  providersList.innerHTML = "";
  MODEL_CATEGORY_DEFS.forEach(categoryDef => {
    const category = getCategory(categoryDef.type);
    const section = document.createElement("section");
    section.className = "modelCategory" + (collapsedModelCategories[categoryDef.type] ? " collapsed" : "");
    const header = document.createElement("button");
    header.type = "button";
    header.className = "modelCategoryHeader";
    const titleWrap = document.createElement("span");
    titleWrap.className = "modelCategoryTitle";
    const title = document.createElement("strong");
    title.textContent = categoryDef.label;
    const meta = document.createElement("span");
    meta.className = "modelCategoryMeta";
    const count = categoryDef.type === "workers-hosted"
      ? (category.models || []).length
      : (category.providers || []).reduce((sum, provider) => sum + (provider.models || []).length, 0);
    meta.textContent = categoryHint(categoryDef.type) + " / " + count + " models";
    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    const chevron = document.createElement("span");
    chevron.textContent = collapsedModelCategories[categoryDef.type] ? "+" : "-";
    header.appendChild(titleWrap);
    header.appendChild(chevron);
    header.addEventListener("click", () => toggleModelCategory(categoryDef.type));
    section.appendChild(header);
    const body = document.createElement("div");
    body.className = "modelCategoryBody";

    if(categoryDef.type === "workers-hosted"){
      (category.models || []).forEach(model => appendModelRow(body, WORKERS_PROVIDER_ID, model));
      if(!(category.models || []).length){
        const empty = document.createElement("div");
        empty.className = "providerMeta";
        empty.textContent = "暂无模型";
        body.appendChild(empty);
      }
    }else{
      (category.providers || []).forEach(provider => {
        const row = document.createElement("div");
        row.className = "providerRow";
        const rowHeader = document.createElement("div");
        rowHeader.className = "providerRowHeader";
        const main = document.createElement("div");
        main.className = "providerMain";
        const providerTitle = document.createElement("strong");
        providerTitle.textContent = provider.providerName || provider.providerId;
        const providerMeta = document.createElement("div");
        providerMeta.className = "providerMeta";
        providerMeta.textContent = provider.providerId + " / " + (provider.baseUrl || "Cloudflare proxied Claude") + (provider.enabled === false ? " / disabled" : "");
        main.appendChild(providerTitle);
        main.appendChild(providerMeta);
        const actions = createActionMenu([
          { label:"编辑 provider", onClick:() => editProvider(provider.providerId) },
          { label:"删除 provider", onClick:() => removeProvider(provider.providerId) },
          { label:"添加模型", onClick:() => {
            modelProviderSelect.value = provider.providerId;
            modelLabelInput.focus();
          } }
        ]);
        actions.classList.add("providerActions");
        rowHeader.appendChild(main);
        rowHeader.appendChild(actions);
        row.appendChild(rowHeader);
        (provider.models || []).forEach(model => appendModelRow(row, provider.providerId, model));
        body.appendChild(row);
      });
      if(!(category.providers || []).length){
        const empty = document.createElement("div");
        empty.className = "providerMeta";
        empty.textContent = "暂无 provider";
        body.appendChild(empty);
      }
    }

    section.appendChild(body);
    providersList.appendChild(section);
  });
}

function renderCategoryTop(section, categoryDef){
  const top = document.createElement("div");
  top.className = "modelCategoryTop";
  const header = document.createElement("button");
  header.type = "button";
  header.className = "modelCategoryHeader";
  const titleWrap = document.createElement("span");
  titleWrap.className = "modelCategoryTitle";
  const title = document.createElement("strong");
  title.textContent = categoryDef.label;
  const meta = document.createElement("span");
  meta.className = "modelCategoryMeta";
  const category = getCategory(categoryDef.type);
  const count = categoryDef.type === "workers-hosted"
    ? (category.models || []).length
    : (category.providers || []).reduce((sum, provider) => sum + (provider.models || []).length, 0);
  meta.textContent = categoryHint(categoryDef.type) + " / " + count + " models";
  titleWrap.appendChild(title);
  titleWrap.appendChild(meta);
  const chevron = document.createElement("span");
  chevron.textContent = collapsedModelCategories[categoryDef.type] ? "+" : "-";
  header.appendChild(titleWrap);
  header.appendChild(chevron);
  header.addEventListener("click", () => toggleModelCategory(categoryDef.type));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "categoryAddBtn";
  addBtn.textContent = "+";
  addBtn.title = categoryDef.type === "workers-hosted" ? "新增模型" : "新增 provider";
  addBtn.setAttribute("aria-label", addBtn.title);
  addBtn.addEventListener("click", event => {
    event.stopPropagation();
    if(categoryDef.type === "workers-hosted"){
      openAddModelDialog(WORKERS_PROVIDER_ID);
    }else{
      openAddProviderDialog(categoryDef.type);
    }
  });

  top.appendChild(header);
  top.appendChild(addBtn);
  section.appendChild(top);
}

function renderProvidersList(){
  providersList.innerHTML = "";
  MODEL_CATEGORY_DEFS.forEach(categoryDef => {
    const category = getCategory(categoryDef.type);
    const section = document.createElement("section");
    section.className = "modelCategory" + (collapsedModelCategories[categoryDef.type] ? " collapsed" : "");
    renderCategoryTop(section, categoryDef);
    const body = document.createElement("div");
    body.className = "modelCategoryBody";

    if(categoryDef.type === "workers-hosted"){
      (category.models || []).forEach(model => appendModelRow(body, WORKERS_PROVIDER_ID, model));
      if(!(category.models || []).length){
        const empty = document.createElement("div");
        empty.className = "providerMeta";
        empty.textContent = "暂无模型";
        body.appendChild(empty);
      }
    }else{
      (category.providers || []).forEach(provider => {
        const row = document.createElement("div");
        row.className = "providerRow";
        const rowHeader = document.createElement("div");
        rowHeader.className = "providerRowHeader";
        const main = document.createElement("div");
        main.className = "providerMain";
        const providerTitle = document.createElement("strong");
        providerTitle.textContent = provider.providerName || provider.providerId;
        const providerMeta = document.createElement("div");
        providerMeta.className = "providerMeta";
        providerMeta.textContent = provider.providerId + " / " + (provider.baseUrl || "Cloudflare proxied Claude") + (provider.enabled === false ? " / disabled" : "");
        main.appendChild(providerTitle);
        main.appendChild(providerMeta);
        const actions = createActionMenu([
          { label:"编辑 provider", onClick:() => editProvider(provider.providerId) },
          { label:"删除 provider", onClick:() => removeProvider(provider.providerId) },
          { label:"添加模型", onClick:() => openAddModelDialog(provider.providerId) }
        ]);
        actions.classList.add("providerActions");
        rowHeader.appendChild(main);
        rowHeader.appendChild(actions);
        row.appendChild(rowHeader);
        (provider.models || []).forEach(model => appendModelRow(row, provider.providerId, model));
        body.appendChild(row);
      });
      if(!(category.providers || []).length){
        const empty = document.createElement("div");
        empty.className = "providerMeta";
        empty.textContent = "暂无 provider";
        body.appendChild(empty);
      }
    }

    section.appendChild(body);
    providersList.appendChild(section);
  });
}

function getModelConfigForRequest(modelId){
  const model = modelOptions.find(item => item.id === modelId);
  if(!model || model.providerType !== "openai-compatible"){
    return null;
  }
  return {
    id:model.id,
    label:model.label,
    provider:model.provider || "openai-compatible",
    providerType:"openai-compatible",
    apiBase:model.apiBase,
    apiKeyEnv:model.apiKeyEnv,
    modelName:model.modelName || model.id
  };
}

function getSelectedProviderForRequest(modelId){
  const model = modelOptions.find(item => item.id === modelId);
  return model?.provider || "";
}

function modelProvidersForRequest(enableCloudflareDocumentAttachment){
  const providers = deepClone(modelProviders);
  if(!enableCloudflareDocumentAttachment){
    return providers;
  }
  const selectedProviderId = getSelectedProviderForRequest(modelSelect.value);
  const provider = providers.find(item => item.id === selectedProviderId);
  const model = provider?.models?.find(item => item.id === modelSelect.value || item.modelId === modelSelect.value);
  if(model){
    model.capabilities = {
      text:true,
      streaming:true,
      ...(model.capabilities || {}),
      cloudflareDocumentAttachment:true
    };
  }
  return providers;
}

function getOpenClawRuntimeIdForRequest(modelId){
  const model = modelOptions.find(item => item.id === modelId);
  if(!isOpenClawModelTarget(model)){
    return "";
  }
  const values = [
    model.provider,
    model.providerLabel,
    model.providerName,
    model.id,
    model.modelId,
    model.modelName,
    model.upstreamModelName,
    model.label,
    model.displayName,
    model.apiBase,
    model.baseUrl
  ].map(value => String(value || "").toLowerCase());
  if(values.some(value => value.includes("seattle"))){
    return "seattle-openclaw";
  }
  if(values.some(value => value.includes("hillsboro"))){
    return "hillsboro-openclaw";
  }
  return "";
}

function isOpenClawModelTarget(model){
  if(!model){
    return false;
  }
  return [
    model.provider,
    model.providerLabel,
    model.providerName,
    model.id,
    model.modelId,
    model.modelName,
    model.upstreamModelName,
    model.label,
    model.displayName,
    model.apiBase,
    model.baseUrl
  ].some(value => {
    const text = String(value || "").toLowerCase();
    return text.startsWith("openclaw-")
      || text.includes("openclaw")
      || text.includes("hnsnowground.cfd");
  });
}

function isSelectedOpenClawRequest(modelId){
  return isOpenClawModelTarget(modelOptions.find(item => item.id === modelId));
}

function selectedOpenClawRuntimeBinding(modelId = modelSelect.value){
  const runtimeId = getOpenClawRuntimeIdForRequest(modelId);
  if(!runtimeId){
    return null;
  }
  const projectBinding = projectOpenClawRuntimes.find(binding => binding.runtime_id === runtimeId);
  if(projectBinding){
    return projectBinding;
  }
  if(isCommonWorkspace()){
    const runtime = openClawRuntimeRegistry.find(item => item.id === runtimeId);
    return runtime ? { runtime_id: runtimeId, runtime } : null;
  }
  return null;
}

function currentRuntimeSupportsNativeAttachment(modelId = modelSelect.value){
  const binding = selectedOpenClawRuntimeBinding(modelId);
  return Boolean(binding?.runtime?.capabilities?.nativeAttachment);
}

function syncFileModeSelector(){
  return;
}

function clearOpenClawWaitTimers(){
  openClawWaitTimers.forEach(timer => clearTimeout(timer));
  openClawWaitTimers = [];
}

function startOpenClawWaitHints(aiDiv){
  clearOpenClawWaitTimers();
  const hints = [
    [15000, "OpenClaw is still processing. Please keep waiting..."],
    [45000, "This task is taking longer, possibly using tools or remote operations..."],
    [90000, "OpenClaw has not returned yet. You can keep waiting or stop this request."]
  ];

  openClawWaitTimers = hints.map(([delay, message]) => setTimeout(() => {
    if(!activeChatAbortController){
      return;
    }
    setContextStatus(message);
    if(aiDiv && !aiDiv.textContent.trim()){
      aiDiv.innerHTML = "<span class='loading'>" + message + "</span>";
    }
    if(delay >= 90000){
      sendBtn.disabled = false;
      sendBtn.textContent = "停止";
      sendBtn.title = "停止本次 OpenClaw 请求";
    }
  }, delay));
}

function stopActiveChatRequest(){
  if(activeChatAbortController){
    if(activeOpenClawTask?.id){
      markOpenClawTaskAborted(activeOpenClawTask.id);
    }
    activeChatAbortController.abort();
  }
}

function openClawFriendlyError(err){
  const message = err?.message || "";
  if(err?.name === "AbortError"){
    return "Stopped this OpenClaw request.";
  }
  if(/network|connection|fetch|abort|lost|timed out|timeout/i.test(message)){
    return "The OpenClaw long-running task connection was interrupted. The task may still be running remotely.";
  }
  return "Request failed: " + message;
}

function isOpenClawProviderError(error){
  return isOpenClawModelTarget({
    provider:error?.provider,
    id:error?.model,
    modelName:error?.modelName,
    label:error?.model,
    providerLabel:error?.provider
  });
}

function isOpenClawNetworkLost(error){
  const message = String(error?.message || error?.error || error?.detail || error || "");
  const code = String(error?.code || "").toLowerCase();
  return /Network connection lost/i.test(message)
    || (code === "error" && /network connection lost/i.test(message));
}

function isOpenClawTaskPending(task){
  return ["running", "pending", "disconnected", "expired", "cancel_requested"].includes(String(task?.status || ""));
}

function isOpenClawAutoResumeRunningTask(task){
  const status = String(task?.status || "").toLowerCase();
  const remoteStatus = String(openClawTaskRemoteStatus(task) || "").toLowerCase();
  const runningStatuses = ["queued", "started", "running", "active", "in_progress"];
  return runningStatuses.includes(status) || runningStatuses.includes(remoteStatus);
}

function isOpenClawAutoResumeCompletedTask(task){
  const status = String(task?.status || "").toLowerCase();
  const remoteStatus = String(openClawTaskRemoteStatus(task) || "").toLowerCase();
  return status === "completed"
    || ["completed", "complete", "done", "success", "succeeded"].includes(remoteStatus)
    || openClawTaskRemoteProgress(task) === 100;
}

function openClawTaskConversationId(task){
  return task?.conversation_id || task?.conversationId || "";
}

function openClawAutoResumeAttemptKey(conversationId, taskId){
  return String(conversationId || "none") + ":" + String(taskId || "none");
}

function openClawTaskStatusLabel(status){
  const labels = {
    running:"Local record: still waiting",
    pending:"Pending",
    completed:"Completed",
    failed:"请求失败",
    aborted:"Stopped local wait",
    cancelled:"Cancelled",
    cancel_requested:"Cancel requested",
    disconnected:"Disconnected",
    expired:"Local record expired"
  };
  return labels[status] || status || "未知";
}

function openClawTaskRemoteStatus(task){
  return task?.remote_status || task?.remoteStatus || "";
}

function isOpenClawBridgeTaskRecord(task){
  return Boolean(task?.bridgeModeEnabled || task?.bridge_mode_enabled || task?.bridgeTaskId || task?.bridge_task_id);
}

function openClawTaskRemoteProgress(task){
  const value = task?.remote_progress ?? task?.remoteProgress;
  const number = value === null || value === undefined || value === "" ? NaN : Number(value);
  const progress = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  if(!isOpenClawBridgeTaskRecord(task)){
    return progress;
  }

  const remoteStatus = String(openClawTaskRemoteStatus(task) || "").toLowerCase();
  const localStatus = String(task?.status || "").toLowerCase();
  if(["completed", "complete", "done", "success", "succeeded"].includes(remoteStatus) || localStatus === "completed"){
    return 100;
  }
  if(["failed", "failure", "error"].includes(remoteStatus) || localStatus === "failed"){
    return progress !== null ? progress : 0;
  }
  return progress;
}

function openClawTaskRemoteMessage(task){
  return task?.remote_message || task?.remoteMessage || "";
}

function isOpenClawRemoteTaskTerminal(task){
  const status = String(openClawTaskRemoteStatus(task) || "").toLowerCase();
  return ["completed", "complete", "done", "success", "succeeded", "failed", "failure", "error", "cancelled", "canceled"].includes(status)
    || openClawTaskRemoteProgress(task) === 100;
}

function shouldContinuePollingCompletedOpenClawTask(task){
  if(task?.status !== "completed" || !(task.remoteTaskId || task.remote_task_id)){
    return false;
  }
  if(isOpenClawRemoteTaskTerminal(task)){
    return false;
  }
  const attempts = openClawCompletedRemoteSyncAttempts.get(task.id) || 0;
  if(attempts >= 2){
    return false;
  }
  openClawCompletedRemoteSyncAttempts.set(task.id, attempts + 1);
  return true;
}

function openClawTaskHasRemoteState(task){
  return Boolean(openClawTaskRemoteStatus(task)
    || openClawTaskRemoteProgress(task) !== null
    || openClawTaskRemoteMessage(task));
}

function openClawTaskDisplayStatus(task){
  return openClawTaskHasRemoteState(task)
    ? openClawTaskRemoteStatus(task) || task.status || ""
    : openClawTaskStatusLabel(task.status);
}

function isOpenClawTaskTerminal(task){
  return ["completed", "failed", "aborted", "cancelled"].includes(String(task?.status || ""));
}

function shouldPollOpenClawTask(task){
  const status = String(task?.status || "");
  const remoteStatus = String(openClawTaskRemoteStatus(task) || "").toLowerCase();
  return ["running", "pending", "disconnected", "expired", "cancel_requested"].includes(status)
    || ["running", "pending", "queued", "in_progress", "processing", "cancel_requested", "cancelling", "canceling"].includes(remoteStatus);
}

function shouldShowOpenClawCancel(task){
  const status = String(task?.status || "");
  const remoteStatus = String(openClawTaskRemoteStatus(task) || "").toLowerCase();
  return Boolean(task?.id
    && shouldPollOpenClawTask(task)
    && !isOpenClawTaskTerminal(task)
    && status !== "cancel_requested"
    && remoteStatus !== "cancel_requested");
}

function formatOpenClawTaskTime(value){
  const time = Number(value || 0);
  if(!time){
    return "";
  }
  const seconds = Math.max(1, Math.round((Date.now() - time) / 1000));
  if(seconds < 60){
    return seconds + " 秒前";
  }
  const minutes = Math.round(seconds / 60);
  if(minutes < 60){
    return minutes + " minutes ago";
  }
  return new Date(time).toLocaleString();
}

function openClawReconnectDismissKey(conversationId = currentConversationId){
  return "openclaw_reconnect_dismissed:" + (conversationId || "none");
}

function readDismissedOpenClawReconnectTasks(conversationId = currentConversationId){
  return safeJsonParse(sessionStorage.getItem(openClawReconnectDismissKey(conversationId)), []);
}

function isOpenClawReconnectDismissed(task){
  if(!task?.id){
    return true;
  }
  return readDismissedOpenClawReconnectTasks(task.conversation_id || task.conversationId).includes(task.id);
}

function dismissOpenClawReconnectTask(task){
  if(!task?.id){
    return;
  }
  const conversationId = task.conversation_id || task.conversationId || currentConversationId;
  const dismissed = new Set(readDismissedOpenClawReconnectTasks(conversationId));
  dismissed.add(task.id);
  sessionStorage.setItem(openClawReconnectDismissKey(conversationId), JSON.stringify([...dismissed]));
  if(openClawReconnectTask?.id === task.id){
    openClawReconnectTask = null;
  }
  renderOpenClawTaskBanner();
}

function isOpenClawStreamingActive(){
  return Boolean(activeChatAbortController && activeOpenClawTask?.id);
}

function shouldShowOpenClawReconnectBanner(task){
  return Boolean(task?.id
    && isOpenClawTaskPending(task)
    && !isOpenClawStreamingActive()
    && !isOpenClawReconnectDismissed(task)
    && openClawReconnectTask?.id === task.id);
}

function renderOpenClawReconnectBanner(task){
  const progress = openClawTaskRemoteProgress(task);
  const remoteMessage = openClawTaskRemoteMessage(task);
  openClawTaskBanner.innerHTML = [
    "<strong>OpenClaw task still running</strong>",
    "<div class='openClawTaskMeta'>",
    escapeHtml(openClawTaskDisplayStatus(task)),
    progress !== null ? "<br />progress: " + progress + "%" : "",
    remoteMessage ? "<br />" + escapeHtml(remoteMessage) : "",
    task.model ? "<br />model: " + escapeHtml(task.upstreamModelName || task.model) : "",
    task.projectId || task.project_id ? "<br />project: " + escapeHtml(task.projectId || task.project_id) : "",
    task.runtimeId || task.runtime_id ? "<br />runtime: " + escapeHtml(task.runtimeId || task.runtime_id) : "",
    "</div>",
    "<div class='openClawTaskActions'>",
    "<button type='button' data-openclaw-task-action='reconnect'>Reconnect</button>",
    shouldShowOpenClawCancel(task) ? "<button type='button' data-openclaw-task-action='cancel'>Cancel</button>" : "",
    "<button type='button' data-openclaw-task-action='dismiss-reconnect'>Dismiss</button>",
    "</div>"
  ].join("");
  openClawTaskBanner.dataset.taskId = task.id;
  openClawTaskBanner.dataset.mode = "reconnect";
  openClawTaskBanner.classList.add("open");
}

function mergeOpenClawTask(task){
  if(!task?.id){
    return;
  }
  const index = openClawTasks.findIndex(item => item.id === task.id);
  if(index >= 0){
    openClawTasks[index] = {
      ...openClawTasks[index],
      ...task
    };
  }else{
    openClawTasks.unshift(task);
  }
  if(isOpenClawTaskPending(task)){
    activeOpenClawTask = task;
  }else if(activeOpenClawTask?.id === task.id){
    activeOpenClawTask = task;
  }
  renderOpenClawTaskBanner();
  if(openClawTaskHistoryPanel && !openClawTaskHistoryPanel.hidden){
    loadOpenClawTaskHistory(openClawTaskHistoryView);
  }
}

function currentPendingOpenClawTask(){
  return openClawTasks.find(task => isOpenClawTaskPending(task) && !ignoredOpenClawTaskIds.has(task.id)) || null;
}

function progressQuestionLooksLikeLocalTaskStatus(message){
  const text = String(message || "").trim();
  if(!text || text.length > 80){
    return false;
  }
  return /进展|怎么样|如何|完成了吗|结束了吗|还在运行|状态|进度|status|progress|done|finished|running/i.test(text);
}

function openClawTaskHasRemoteId(task){
  return Boolean(task?.remoteTaskId || task?.remote_task_id);
}

function openClawTaskBannerTitle(task){
  return openClawTaskHasRemoteId(task) ? "OpenClaw remote task" : "OpenClaw local task record";
}

function openClawTaskBannerDisclaimer(task){
  return openClawTaskHasRemoteId(task)
    ? "This is an OpenClaw remote task record. Worker can poll remote status but cannot restore remote stream."
    : "This is a Worker local record. It cannot confirm VPS-side progress or restore remote stream.";
}

function renderOpenClawTaskBanner(){
  const task = currentPendingOpenClawTask() || activeOpenClawTask;
  if(!task || ignoredOpenClawTaskIds.has(task.id)){
    openClawTaskBanner.classList.remove("open");
    openClawTaskBanner.innerHTML = "";
    openClawTaskBanner.dataset.mode = "";
    return;
  }

  if(isOpenClawTaskPending(task)
    && isOpenClawReconnectDismissed(task)
    && openClawReconnectPollingTaskId !== task.id
    && !isOpenClawStreamingActive()){
    openClawTaskBanner.classList.remove("open");
    openClawTaskBanner.innerHTML = "";
    openClawTaskBanner.dataset.mode = "";
    return;
  }

  if(shouldShowOpenClawReconnectBanner(task)){
    renderOpenClawReconnectBanner(task);
    return;
  }

  const status = openClawTaskDisplayStatus(task);
  const progress = openClawTaskRemoteProgress(task);
  const remoteMessage = openClawTaskRemoteMessage(task);
  const started = formatOpenClawTaskTime(task.startedAt);
  const modelLabel = [task.provider, task.upstreamModelName || task.model].filter(Boolean).join(" / ");
  openClawTaskBanner.innerHTML = [
    "<strong>" + escapeHtml(openClawTaskBannerTitle(task)) + "</strong>",
    "<div class='openClawTaskMeta'>",
    escapeHtml(status),
    progress !== null ? "<br />progress: " + progress + "%" : "",
    remoteMessage ? "<br />" + escapeHtml(remoteMessage) : "",
    task.projectId || task.project_id ? "<br />project: " + escapeHtml(task.projectId || task.project_id) : "",
    task.runtimeId || task.runtime_id ? "<br />runtime: " + escapeHtml(task.runtimeId || task.runtime_id) : "",
    modelLabel ? "<br />Model: " + escapeHtml(modelLabel) : "",
    started ? "<br />Started: " + escapeHtml(started) : "",
    "<br />" + escapeHtml(openClawTaskBannerDisclaimer(task)),
    "</div>",
    "<div class='openClawTaskActions'>",
    "<button type='button' data-openclaw-task-action='view'>View record</button>",
    shouldShowOpenClawCancel(task) ? "<button type='button' data-openclaw-task-action='cancel'>Cancel</button>" : "",
    isOpenClawTaskPending(task) ? "<button type='button' data-openclaw-task-action='wait'>Keep waiting</button>" : "",
    "<button type='button' data-openclaw-task-action='rerun'>Rerun</button>",
    "<button type='button' data-openclaw-task-action='ignore'>Ignore</button>",
    "</div>"
  ].join("");
  openClawTaskBanner.dataset.taskId = task.id;
  openClawTaskBanner.dataset.mode = "task";
  openClawTaskBanner.classList.add("open");
}

async function fetchOpenClawTasksForConversation(conversationId, options = {}){
  const id = String(conversationId || "").trim();
  if(!id){
    return [];
  }
  const params = new URLSearchParams({
    conversation_id:id,
    limit:String(options.limit || 20),
    offset:String(options.offset || 0),
    sort:options.sort || "created_desc"
  });
  if(options.status){
    params.set("status", options.status);
  }
  const res = await fetch("/api/openclaw/tasks?" + params.toString(), {
    credentials:"include"
  });
  const data = await res.json();
  if(!res.ok || !data.ok){
    throw new Error(data.error || "OpenClaw task history failed");
  }
  return Array.isArray(data.tasks) ? data.tasks : [];
}

function findOpenClawAutoResumeTask(tasks, conversationId){
  const items = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task?.id && openClawTaskConversationId(task) === conversationId);
  return items.find(isOpenClawAutoResumeRunningTask)
    || items.find(isOpenClawAutoResumeCompletedTask)
    || null;
}

async function tryAutoResumeOpenClawTask({ element, state } = {}){
  const conversationId = String(currentConversationId || "").trim();
  if(!conversationId){
    return { handled:false, reason:"missing_conversation" };
  }

  if(element){
    renderAssistantMarkdown(element, OPENCLAW_AUTO_RESUME_MESSAGE);
  }
  setContextStatus(OPENCLAW_AUTO_RESUME_MESSAGE);

  const tasks = await fetchOpenClawTasksForConversation(conversationId, {
    limit:20,
    sort:"created_desc"
  });
  openClawTasks = tasks;
  const task = findOpenClawAutoResumeTask(tasks, conversationId);
  if(!task?.id){
    renderOpenClawTaskBanner();
    return { handled:false, reason:"task_not_found" };
  }

  const attemptKey = openClawAutoResumeAttemptKey(conversationId, task.id);
  if(openClawAutoResumeAttempts.has(attemptKey)){
    mergeOpenClawTask(task);
    return { handled:false, reason:"already_attempted", task };
  }
  openClawAutoResumeAttempts.add(attemptKey);

  let latestTask = task;
  try{
    latestTask = await fetchOpenClawTaskStatus(task.id) || task;
  }catch(err){
    console.warn("OpenClaw auto resume reconnect failed", err);
    return { handled:false, reason:"reconnect_failed", task };
  }
  mergeOpenClawTask(latestTask);

  if(isOpenClawAutoResumeRunningTask(latestTask)){
    activeOpenClawTask = latestTask;
    openClawReconnectTask = latestTask;
    startOpenClawReconnectPolling(latestTask.id);
    if(state){
      state.reply = OPENCLAW_AUTO_RESUME_MESSAGE;
      state.openClawAutoResume = { handled:true, mode:"running", taskId:latestTask.id };
    }
    return { handled:true, mode:"running", task:latestTask };
  }

  if(isOpenClawAutoResumeCompletedTask(latestTask)){
    stopOpenClawReconnectPolling();
    if(state){
      state.reply = "";
      state.openClawAutoResume = { handled:true, mode:"completed", taskId:latestTask.id };
    }
    setContextStatus("OpenClaw task completed.");
    if(isOpenClawBridgeTaskRecord(latestTask) || (!latestTask.assistantMessageId && !latestTask.assistant_message_id)){
      try{
        latestTask = await finalizeOpenClawTaskResult(latestTask.id) || latestTask;
      }catch(err){
        console.warn("finalize completed OpenClaw Bridge task failed", err);
        setContextStatus("OpenClaw task completed, but result recovery is incomplete: " + (err.message || String(err)));
      }
    }
    await loadConversationMessages(conversationId);
    return { handled:true, mode:"completed", task:latestTask };
  }

  return { handled:false, reason:"not_resumable", task:latestTask };
}

async function loadOpenClawTasksForConversation(conversationId){
  stopOpenClawReconnectPolling();
  openClawReconnectTask = null;
  if(!conversationId){
    openClawTasks = [];
    activeOpenClawTask = null;
    renderOpenClawTaskBanner();
    return [];
  }
  try{
    openClawTasks = await fetchOpenClawTasksForConversation(conversationId);
    activeOpenClawTask = openClawTasks[0] || null;
    if(await checkOpenClawActiveTask(conversationId)){
      return openClawTasks;
    }
    renderOpenClawTaskBanner();
    return openClawTasks;
  }catch(err){
    console.warn("load OpenClaw tasks failed", err);
  }
  return openClawTasks;
}

async function checkOpenClawActiveTask(conversationId){
  const id = String(conversationId || "").trim();
  if(!id || isOpenClawStreamingActive()){
    return false;
  }
  try{
    const res = await fetch("/api/openclaw/tasks/active?conversation_id=" + encodeURIComponent(id), {
      credentials:"include"
    });
    const data = await res.json();
    if(!res.ok || !data.ok || !data.active || !data.task?.id){
      if(openClawReconnectTask && (openClawReconnectTask.conversation_id || openClawReconnectTask.conversationId) === id){
        openClawReconnectTask = null;
      }
      renderOpenClawTaskBanner();
      return false;
    }
    mergeOpenClawTask(data.task);
    if(!isOpenClawReconnectDismissed(data.task) && openClawReconnectPollingTaskId !== data.task.id){
      openClawReconnectTask = data.task;
      renderOpenClawTaskBanner();
      return true;
    }
  }catch(err){
    console.warn("check active OpenClaw task failed", err);
  }
  return false;
}

function stopOpenClawReconnectPolling(){
  if(openClawReconnectPollingTimer){
    clearInterval(openClawReconnectPollingTimer);
    openClawReconnectPollingTimer = null;
  }
  if(openClawReconnectPollingTaskId){
    openClawCompletedRemoteSyncAttempts.delete(openClawReconnectPollingTaskId);
  }
  openClawReconnectPollingTaskId = "";
}

function stopOpenClawBridgeEventStream(taskId = ""){
  if(taskId && openClawBridgeEventTaskId && taskId !== openClawBridgeEventTaskId){
    return;
  }
  if(openClawBridgeEventSource){
    openClawBridgeEventSource.close();
    openClawBridgeEventSource = null;
  }
  if(!taskId || taskId === openClawBridgeEventTaskId){
    openClawBridgeEventTaskId = "";
  }
}

function createOpenClawBridgeEventState(){
  return {
    seenEventIds:new Set(),
    lastSequence:-Infinity,
    final:false
  };
}

function applyOpenClawBridgeEventState(state, event){
  const target = state || createOpenClawBridgeEventState();
  const eventId = String(event?.event_id || "");
  if(eventId && target.seenEventIds.has(eventId)){
    return { accepted:false, reason:"duplicate", state:target };
  }
  if(eventId){
    target.seenEventIds.add(eventId);
  }
  const eventType = String(event?.event_type || "");
  const sequence = Number(event?.sequence);
  const hasSequence = Number.isFinite(sequence);
  if(hasSequence && sequence < target.lastSequence){
    return { accepted:false, reason:"old_sequence", state:target };
  }
  if(target.final && eventType !== "bridge.final" && eventType !== "bridge.error"){
    return { accepted:false, reason:"after_final", state:target };
  }
  if(hasSequence){
    target.lastSequence = Math.max(target.lastSequence, sequence);
  }
  if(eventType === "bridge.final" || eventType === "bridge.error"){
    target.final = true;
  }
  return { accepted:true, reason:"", state:target };
}

function bridgeEventMessage(event){
  const content = event?.content && typeof event.content === "object" ? event.content : {};
  if(event?.event_type === "bridge.tool_call"){
    return content.text || content.summary || content.tool_name || content.toolName || content.name || "Tool call";
  }
  if(event?.event_type === "bridge.tool_result"){
    return content.text || content.summary || content.result || content.tool_name || content.toolName || "Tool result";
  }
  if(event?.event_type === "bridge.error"){
    return event.error || content.error || content.message || content.text || "OpenClaw Bridge failed.";
  }
  return content.text || content.summary || event.final_answer || event.status || event.event_type || "";
}

function mergeOpenClawBridgeEventTask(event, localTaskId){
  const taskId = localTaskId || activeOpenClawTask?.id || "";
  if(!taskId){
    return;
  }
  const message = bridgeEventMessage(event);
  const patch = {
    id:taskId,
    bridge_task_id:event.task_id || activeOpenClawTask?.bridge_task_id || activeOpenClawTask?.bridgeTaskId || "",
    bridgeTaskId:event.task_id || activeOpenClawTask?.bridgeTaskId || activeOpenClawTask?.bridge_task_id || "",
    remote_status:event.event_type || event.status || "",
    remoteStatus:event.event_type || event.status || "",
    remote_message:message,
    remoteMessage:message,
    bridge_last_sequence:event.sequence ?? activeOpenClawTask?.bridge_last_sequence ?? activeOpenClawTask?.bridgeLastSequence ?? null,
    bridgeLastSequence:event.sequence ?? activeOpenClawTask?.bridgeLastSequence ?? activeOpenClawTask?.bridge_last_sequence ?? null
  };
  if(event.event_type === "bridge.final"){
    patch.status = "completed";
    patch.remote_status = "completed";
    patch.remoteStatus = "completed";
    patch.remote_progress = 100;
    patch.remoteProgress = 100;
  }else if(event.event_type === "bridge.error"){
    patch.status = "failed";
    patch.remote_status = "failed";
    patch.remoteStatus = "failed";
    patch.error = message;
  }else if(event.event_type === "bridge.tool_call"){
    patch.status = "tool_calling";
  }else{
    patch.status = "running";
  }
  mergeOpenClawTask({
    ...(activeOpenClawTask || {}),
    ...patch
  });
}

async function finishOpenClawBridgeEventTask(taskId, element, event){
  stopOpenClawBridgeEventStream(taskId);
  stopOpenClawReconnectPolling();
  setContextStatus(event.event_type === "bridge.error" ? "OpenClaw task failed." : "OpenClaw task completed.");
  if(event.event_type === "bridge.final"){
    if(event.final_answer){
      renderAssistantMarkdown(element, event.final_answer);
    }
    try{
      await finalizeOpenClawTaskResult(taskId);
    }catch(err){
      console.warn("finalize OpenClaw Bridge SSE task failed", err);
      setContextStatus("OpenClaw task completed, but result fetch failed: " + (err.message || String(err)));
      return;
    }
    if(currentConversationId){
      await loadConversationMessages(currentConversationId);
    }
  }else{
    renderAssistantMarkdown(element, bridgeEventMessage(event));
  }
}

function openClawTaskScopeParams(taskId, task){
  const sourceTask = task || openClawTasks.find(item => item.id === taskId || item.bridgeTaskId === taskId || item.bridge_task_id === taskId || item.remoteTaskId === taskId || item.remote_task_id === taskId) || activeOpenClawTask || {};
  const params = new URLSearchParams();
  params.set("task_id", taskId);
  const projectId = sourceTask.projectId || sourceTask.project_id || activeProjectId || "";
  const runtimeId = sourceTask.runtimeId || sourceTask.runtime_id || "";
  if(projectId){
    params.set("project_id", projectId);
  }
  if(runtimeId){
    params.set("runtime_id", runtimeId);
  }
  return params;
}

function startOpenClawBridgeEventStream(taskId, element, task){
  if(!taskId || typeof EventSource === "undefined"){
    return false;
  }
  stopOpenClawBridgeEventStream();
  const state = createOpenClawBridgeEventState();
  const params = openClawTaskScopeParams(taskId, task);
  const source = new EventSource("/api/openclaw/bridge/events/stream?" + params.toString(), {
    withCredentials:true
  });
  openClawBridgeEventSource = source;
  openClawBridgeEventTaskId = taskId;
  source.addEventListener("bridge_event", async event => {
    let data = null;
    try{
      data = JSON.parse(event.data || "{}");
    }catch(err){
      console.warn("parse OpenClaw Bridge SSE event failed", err);
      return;
    }
    const result = applyOpenClawBridgeEventState(state, data);
    if(!result.accepted){
      return;
    }
    mergeOpenClawBridgeEventTask(data, taskId);
    const message = bridgeEventMessage(data);
    if(data.event_type === "bridge.started"){
      renderAssistantMarkdown(element, "OpenClaw task started.");
    }else if(data.event_type === "bridge.activity"){
      renderAssistantMarkdown(element, message || "OpenClaw task is running.");
    }else if(data.event_type === "bridge.tool_call"){
      renderAssistantMarkdown(element, "Tool call: " + message);
    }else if(data.event_type === "bridge.tool_result"){
      renderAssistantMarkdown(element, "Tool result: " + message);
    }
    if(message && data.event_type !== "bridge.final"){
      setContextStatus(message);
    }
    if(data.event_type === "bridge.final" || data.event_type === "bridge.error"){
      await finishOpenClawBridgeEventTask(taskId, element, data);
    }
  });
  source.addEventListener("error", () => {
    if(openClawBridgeEventSource !== source){
      return;
    }
    stopOpenClawBridgeEventStream(taskId);
    startOpenClawReconnectPolling(taskId);
  });
  return true;
}

async function fetchOpenClawTaskStatus(taskId){
  const params = openClawTaskScopeParams(taskId);
  params.delete("task_id");
  const query = params.toString();
  const res = await fetch("/api/openclaw/tasks/" + encodeURIComponent(taskId) + "/status" + (query ? "?" + query : ""), {
    credentials:"include"
  });
  const data = await res.json();
  if(!res.ok || !data.ok){
    throw new Error(data.error || "OpenClaw task status failed");
  }
  return data.task || null;
}

async function finalizeOpenClawTaskResult(taskId){
  if(!taskId){
    return null;
  }
  const res = await fetch("/api/openclaw/tasks/" + encodeURIComponent(taskId) + "/result", {
    credentials:"include"
  });
  const data = await res.json();
  if(!res.ok || !data.ok){
    throw new Error(data.error || "OpenClaw task result failed");
  }
  if(data.task){
    mergeOpenClawTask(data.task);
  }
  return data.task || null;
}

async function fetchOpenClawTaskFromList(taskId){
  const params = new URLSearchParams({
    conversation_id:currentConversationId,
    limit:"20",
    offset:"0",
    sort:"created_desc"
  });
  const res = await fetch("/api/openclaw/tasks?" + params.toString(), {
    credentials:"include"
  });
  const data = await res.json();
  if(!res.ok || !data.ok){
    throw new Error(data.error || "OpenClaw task polling failed");
  }
  return (data.tasks || []).find(item => item.id === taskId) || null;
}

async function pollOpenClawReconnectTask(taskId){
  if(!currentConversationId || !taskId || openClawReconnectPollingTaskId !== taskId){
    return;
  }
  try{
    const task = await fetchOpenClawTaskStatus(taskId) || await fetchOpenClawTaskFromList(taskId);
    if(!task){
      return;
    }
    mergeOpenClawTask(task);
    if(openClawTaskHistoryPanel && !openClawTaskHistoryPanel.hidden){
      loadOpenClawTaskHistory(openClawTaskHistoryView);
    }
    if(task.status === "completed" && shouldContinuePollingCompletedOpenClawTask(task)){
      setContextStatus("OpenClaw task completed locally. Syncing remote status...");
      renderOpenClawTaskBanner();
      return;
    }
    if(task.status === "completed"){
      openClawCompletedRemoteSyncAttempts.delete(task.id);
      stopOpenClawReconnectPolling();
      stopOpenClawBridgeEventStream(task.id);
      setContextStatus("OpenClaw task completed.");
      if(isOpenClawBridgeTaskRecord(task) || (!task.assistantMessageId && !task.assistant_message_id)){
        try{
          await finalizeOpenClawTaskResult(task.id);
        }catch(err){
          console.warn("finalize OpenClaw task result failed", err);
          setContextStatus("OpenClaw task completed, but result fetch failed: " + (err.message || String(err)));
          renderOpenClawTaskBanner();
          return;
        }
      }
      await loadConversationMessages(currentConversationId);
      return;
    }
    if(task.status === "failed" || task.status === "aborted" || task.status === "cancelled"){
      openClawCompletedRemoteSyncAttempts.delete(task.id);
      stopOpenClawReconnectPolling();
      stopOpenClawBridgeEventStream(task.id);
      setContextStatus(task.status === "failed" ? "OpenClaw task failed." : "OpenClaw task cancelled.");
      renderOpenClawTaskBanner();
      return;
    }
    if(task.status === "expired" && !task.remoteTaskId && !task.remote_task_id){
      stopOpenClawReconnectPolling();
      stopOpenClawBridgeEventStream(task.id);
      setContextStatus("OpenClaw task record expired. Remote progress cannot be confirmed.");
      renderOpenClawTaskBanner();
      return;
    }
    if(!shouldPollOpenClawTask(task)){
      stopOpenClawReconnectPolling();
      renderOpenClawTaskBanner();
    }
  }catch(err){
    console.warn("poll OpenClaw reconnect task failed", err);
  }
}

function startOpenClawReconnectPolling(taskId){
  if(!taskId){
    return;
  }
  stopOpenClawReconnectPolling();
  openClawReconnectPollingTaskId = taskId;
  pollOpenClawReconnectTask(taskId);
  openClawReconnectPollingTimer = setInterval(() => {
    pollOpenClawReconnectTask(taskId);
  }, OPENCLAW_RECONNECT_POLL_MS);
}

async function cancelOpenClawTask(task){
  if(!task?.id){
    return;
  }
  try{
    const res = await fetch("/api/openclaw/tasks/" + encodeURIComponent(task.id) + "/cancel", {
      method:"POST",
      credentials:"include"
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "OpenClaw task cancel failed");
    }
    if(data.task){
      mergeOpenClawTask(data.task);
    }
    setContextStatus((data.task?.status === "cancel_requested" || data.task?.remote_status === "cancel_requested")
      ? "Cancel requested"
      : "OpenClaw task cancel request sent.");
    startOpenClawReconnectPolling(task.id);
  }catch(err){
    console.warn("cancel OpenClaw task failed", err);
    setContextStatus("OpenClaw task cancel failed: " + (err.message || String(err)));
  }
}

function shouldInterceptOpenClawProgressMessage(message){
  return Boolean(currentConversationId
    && progressQuestionLooksLikeLocalTaskStatus(message)
    && currentPendingOpenClawTask());
}

function showOpenClawProgressIntercept(){
  const task = currentPendingOpenClawTask();
  if(!task){
    return;
  }
  setContextStatus("This conversation has an OpenClaw long-running task record. Worker can show local status only.");
  renderOpenClawTaskBanner();
}

function showOpenClawTaskRecord(task){
  const lines = [
    openClawTaskBannerTitle(task),
    "",
    "task id: " + (task.id || ""),
    openClawTaskHasRemoteId(task) ? "remote_task_id: " + (task.remoteTaskId || task.remote_task_id || "") : "",
    "status: " + (task.status || ""),
    "project_id: " + (task.projectId || task.project_id || ""),
    "runtime_id: " + (task.runtimeId || task.runtime_id || ""),
    "provider: " + (task.provider || ""),
    "model: " + (task.model || ""),
    "upstreamModelName: " + (task.upstreamModelName || ""),
    "startedAt: " + (task.startedAt ? new Date(Number(task.startedAt)).toLocaleString() : ""),
    "updatedAt: " + (task.updatedAt ? new Date(Number(task.updatedAt)).toLocaleString() : ""),
    task.error ? "error: " + task.error : "",
    "",
    openClawTaskBannerDisclaimer(task)
  ].filter(line => line !== "").join(String.fromCharCode(10));
  alert(lines);
}

function formatTaskDuration(task){
  const duration = Number(task.duration_ms ?? task.durationMs ?? task.latencyMs ?? 0);
  if(!duration){
    return "鑰楁椂 --";
  }
  if(duration < 1000){
    return "鑰楁椂 " + duration + "ms";
  }
  return "鑰楁椂 " + (duration / 1000).toFixed(1).replace(/\.0$/, "") + "s";
}

function formatTaskAbsoluteTime(value){
  const time = Number(value || 0);
  return time ? new Date(time).toLocaleString() : "--";
}

function openClawTaskHistoryQuery(view){
  const params = new URLSearchParams();
  params.set("limit", "20");
  params.set("offset", "0");
  if(view === "failed"){
    params.set("status", "failed");
    params.set("sort", "created_desc");
  }else if(view === "slow"){
    params.set("sort", "duration_desc");
  }else{
    params.set("sort", "created_desc");
  }
  if(view === "conversation"){
    if(!currentConversationId){
      return null;
    }
    params.set("conversation_id", currentConversationId);
  }
  return params;
}

function taskConversationLabel(task){
  const id = task.conversation_id || task.conversationId || "";
  return id ? "conversation " + id.slice(0, 8) : "conversation --";
}

function renderOpenClawTaskHistory(tasks){
  openClawTaskHistoryList.innerHTML = "";
  if(!Array.isArray(tasks) || !tasks.length){
    const empty = document.createElement("div");
    empty.className = "openClawTaskHistoryItem";
    empty.textContent = openClawTaskHistoryView === "conversation" && !currentConversationId
      ? "No conversation yet"
      : "No OpenClaw task records.";
    openClawTaskHistoryList.appendChild(empty);
    return;
  }

  tasks.forEach(task => {
    const item = document.createElement("div");
    item.className = "openClawTaskHistoryItem";
    const status = task.status || "";
    const prompt = task.prompt_preview || task.promptPreview || "";
    const error = task.error_message || task.error || "";
    const model = task.agent_id || task.upstreamModelName || task.model || "";
    item.innerHTML = [
      "<div class='openClawTaskHistoryTop'>",
      "<strong>" + escapeHtml(openClawTaskStatusLabel(status)) + "</strong>",
      "<span>" + escapeHtml(formatTaskDuration(task)) + "</span>",
      "</div>",
      "<div class='openClawTaskHistoryPreview'>" + escapeHtml(prompt || "No summary") + "</div>",
      "<div class='openClawTaskHistoryMeta'>",
      escapeHtml(model || "model --"),
      " / ",
      escapeHtml(taskConversationLabel(task)),
      "<br />Started: " + escapeHtml(formatTaskAbsoluteTime(task.created_at || task.started_at || task.startedAt)),
      task.finished_at || task.completedAt ? "<br />Completed: " + escapeHtml(formatTaskAbsoluteTime(task.finished_at || task.completedAt)) : "",
      "</div>",
      error ? "<details class='openClawTaskHistoryError'><summary>错误摘要</summary><div>" + escapeHtml(error) + "</div></details>" : ""
    ].join("");
    openClawTaskHistoryList.appendChild(item);
  });
}

async function loadOpenClawTaskHistory(view = openClawTaskHistoryView){
  openClawTaskHistoryView = view;
  openClawTaskHistoryPanel.querySelectorAll("[data-openclaw-task-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.openclawTaskView === view);
  });
  const params = openClawTaskHistoryQuery(view);
  if(!params){
    renderOpenClawTaskHistory([]);
    return;
  }
  openClawTaskHistoryList.innerHTML = "<div class='openClawTaskHistoryItem'>正在加载...</div>";
  try{
    const res = await fetch("/api/openclaw/tasks?" + params.toString(), {
      credentials:"include"
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "OpenClaw task history failed");
    }
    renderOpenClawTaskHistory(data.tasks || []);
  }catch(err){
    const item = document.createElement("div");
    item.className = "openClawTaskHistoryItem";
    item.textContent = err.message || "OpenClaw task history failed";
    openClawTaskHistoryList.innerHTML = "";
    openClawTaskHistoryList.appendChild(item);
  }
}

async function markOpenClawTaskAborted(taskId){
  if(!taskId){
    return;
  }
  try{
    const res = await fetch("/api/openclaw/tasks/" + encodeURIComponent(taskId) + "/mark-aborted", {
      method:"POST",
      credentials:"include"
    });
    const data = await res.json().catch(() => null);
    if(res.ok && data?.ok){
      mergeOpenClawTask({
        id:taskId,
        status:"aborted",
        updatedAt:data.updatedAt || Date.now(),
        error:"User stopped waiting locally. Remote task may still be running."
      });
    }
  }catch(err){
    console.warn("mark OpenClaw task aborted failed", err);
  }
}

function resetLocalConversation(){
  conversation.length = 1;
}

function shouldShowWelcome(){
  return localStorage.getItem(WELCOME_HIDDEN_KEY) !== "1";
}

function renderWelcomeCard(){
  if(!shouldShowWelcome()){
    return "";
  }

  return [
    "<div id='welcomeCard' class='msg ai welcomeMsg'>",
    "<div class='welcomeText'>你好，我是基于 Cloudflare Workers AI 的网页助手。你可以问我问题，也可以让我写代码、总结、翻译或分析内容。</div>",
    "<div class='welcomeActions'>",
    "<label class='welcomeNeverShow'><input id='welcomeNeverShowInput' type='checkbox' /><span>不再显示</span></label>",
    "<button class='welcomeCloseBtn' type='button' aria-label='关闭欢迎提示'>&times;</button>",
    "</div>",
    "</div>"
  ].join("");
}

function dismissWelcomeCard(){
  const welcomeCard = document.getElementById("welcomeCard");
  const neverShowInput = document.getElementById("welcomeNeverShowInput");

  if(neverShowInput?.checked){
    localStorage.setItem(WELCOME_HIDDEN_KEY, "1");
  }

  welcomeCard?.remove();
}

function syncWelcomeVisibility(){
  if(!shouldShowWelcome()){
    document.getElementById("welcomeCard")?.remove();
  }
}

function resetChatView(){
  chat.innerHTML =
    renderWelcomeCard() +
    "<div id='searchResults'></div>";
  searchResults = document.getElementById("searchResults");
  scrollBottom();
}

function setActiveConversation(){
  document.querySelectorAll(".historyItem").forEach(item => {
    item.classList.toggle("active", item.dataset.id === currentConversationId);
  });
  document.querySelectorAll(".historyRow").forEach(row => {
    row.classList.toggle("active", row.dataset.id === currentConversationId);
  });
}

function setSummaryStatus(enabled){
  summaryStatus.classList.toggle("active", Boolean(enabled));
}

async function loadSummaryStatus(){
  if(!currentConversationId){
    setSummaryStatus(false);
    return null;
  }

  try{
    const res = await fetch("/api/conversations/" + encodeURIComponent(currentConversationId) + "/summary");
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "加载摘要失败");
    }

    setSummaryStatus(Boolean((data.summary || "").trim()));
    return data;
  }catch(err){
    console.log("load summary failed", err);
    setSummaryStatus(false);
    return null;
  }
}

async function viewCurrentSummary(){
  const data = await loadSummaryStatus();
  const summary = (data?.summary || "").trim();

  if(!summary){
    alert("Current conversation has no summary.");
    return;
  }

  alert(summary);
}

function clearWebContext(){
  selectedWebPage = null;
  selectedWebPageChunks = [];
  lastWebRelevantChunkCount = 0;
  webSearchContext = "";
  webSearchSources = [];
}

function resetTransientContext(){
  clearSelectedFile();
  selectedFileIds = [];
  selectedFileId = null;
  renderFilesLibrary();
  clearSelectedImage();
  clearPastedImageAttachments();
  clearWebContext();
  setContextStatus("");
}

function enterBlankChat(){
  stopOpenClawReconnectPolling();
  currentConversationId = null;
  openClawTasks = [];
  activeOpenClawTask = null;
  openClawReconnectTask = null;
  renderOpenClawTaskBanner();
  resetLocalConversation();
  resetChatView();
  resetTransientContext();
  setSummaryStatus(false);
  setActiveConversation();
}

function activeProject(){
  return projectsCache.find(project => project.id === activeProjectId) || projectsCache.find(project => project.id === DEFAULT_PROJECT_ID) || projectsCache[0] || null;
}

function realProjects(){
  return projectsCache.filter(project => project.id !== DEFAULT_PROJECT_ID && !project.is_default);
}

function isCommonWorkspace(){
  return activeProjectId === DEFAULT_PROJECT_ID || activeWorkspaceKey === COMMON_WORKSPACE_KEY;
}

function setProjectStatus(message){
  if(projectStatus){
    projectStatus.innerHTML = message || "";
  }
}

function projectName(project){
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return "Chats";
  }
  return project.name || project.id || "Project";
}

function persistActiveWorkspace(workspaceKey){
  activeWorkspaceKey = workspaceKey || COMMON_WORKSPACE_KEY;
  activeProjectId = projectIdFromWorkspaceKey(activeWorkspaceKey);
  localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, activeWorkspaceKey);
  localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, activeProjectId);
}

function persistActiveProject(projectId){
  persistActiveWorkspace(workspaceKeyForProjectId(projectId));
}

function persistExpandedProjects(){
  localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...expandedProjectIds]));
}

function isProjectExpanded(projectId){
  return expandedProjectIds.has(projectId);
}

function setProjectExpanded(projectId, expanded){
  const id = String(projectId || "").trim();
  if(!id || id === DEFAULT_PROJECT_ID){
    return;
  }
  if(expanded){
    expandedProjectIds.add(id);
  }else{
    expandedProjectIds.delete(id);
  }
  persistExpandedProjects();
}

async function toggleProjectExpanded(projectId){
  setProjectExpanded(projectId, !isProjectExpanded(projectId));
  renderProjectSelector();
  renderProjectRuntimeStatus();
  if(projectId === activeProjectId && isProjectExpanded(projectId)){
    await loadConversations();
  }
}

function renderProjectSelector(){
  projectList.innerHTML = "";
  const projects = realProjects();
  if(!projects.length){
    const empty = document.createElement("div");
    empty.className = "projectEmpty";
    empty.textContent = "No projects";
    projectList.appendChild(empty);
  }
  projects.forEach(project => {
    const isActiveProject = !isCommonWorkspace() && project.id === activeProjectId;
    const isExpandedProject = isActiveProject && isProjectExpanded(project.id);
    const row = document.createElement("div");
    row.className = "projectRow" + (isActiveProject ? " active" : "") + (isExpandedProject ? " expanded" : " collapsed");
    row.dataset.projectId = project.id;
    row.addEventListener("click", () => switchProject(project.id));

    const chevronBtn = document.createElement("button");
    chevronBtn.type = "button";
    chevronBtn.className = "projectChevronBtn";
    chevronBtn.textContent = isExpandedProject ? String.fromCharCode(9662) : String.fromCharCode(9656);
    chevronBtn.title = isExpandedProject ? "Collapse project" : "Expand project";
    chevronBtn.setAttribute("aria-expanded", isExpandedProject ? "true" : "false");
    chevronBtn.addEventListener("click", event => {
      event.stopPropagation();
      if(project.id !== activeProjectId || isCommonWorkspace()){
        setProjectExpanded(project.id, true);
        switchProject(project.id);
      }else{
        toggleProjectExpanded(project.id);
      }
    });

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "projectNameBtn";
    nameBtn.textContent = projectName(project);
    nameBtn.title = projectName(project);
    nameBtn.addEventListener("click", event => {
      event.stopPropagation();
      switchProject(project.id);
    });

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "projectMenuBtn";
    menuBtn.textContent = "...";
    menuBtn.title = "Project actions";
    menuBtn.setAttribute("aria-label", "Project actions for " + projectName(project));
    menuBtn.addEventListener("click", event => {
      event.stopPropagation();
      openProjectMenu(project.id, menuBtn);
    });

    row.appendChild(chevronBtn);
    row.appendChild(nameBtn);
    row.appendChild(menuBtn);
    projectList.appendChild(row);

    if(isExpandedProject){
      const mount = document.createElement("div");
      mount.id = "projectConversationMount";
      mount.className = "historyList projectConversationList";
      projectList.appendChild(mount);
    }
  });
  conversationList.hidden = false;
}

function runtimeCapabilityLabel(binding){
  const runtime = binding?.runtime || {};
  const capabilities = runtime.capabilities || {};
  const flags = [];
  if(capabilities.bridge_callback){
    flags.push("Bridge");
  }
  if(capabilities.sse_events){
    flags.push("SSE");
  }
  if(capabilities.remote_console){
    flags.push("Console");
  }
  if(capabilities.nativeAttachment){
    flags.push("Native files");
  }
  if(capabilities.legacy_only){
    flags.push("Legacy only");
  }
  return flags.length ? flags.join(" / ") : "No verified Bridge capabilities";
}

function runtimeAgents(binding){
  const runtimeAgentsList = Array.isArray(binding?.runtime?.agents) ? binding.runtime.agents : [];
  const allowed = Array.isArray(binding?.allowed_agents) ? binding.allowed_agents : [];
  if(allowed.length){
    const allowedIds = new Set(allowed);
    const merged = allowed.map(agentId => {
      const match = runtimeAgentsList.find(agent => (agent.agent_id || agent.id) === agentId);
      return match || { agent_id:agentId, display_name:agentId };
    });
    runtimeAgentsList.forEach(agent => {
      const agentId = agent.agent_id || agent.id;
      if(agentId && !allowedIds.has(agentId)){
        merged.push(agent);
      }
    });
    return merged;
  }
  return runtimeAgentsList;
}

function runtimeCanBeBridgeDefault(binding){
  const runtime = binding?.runtime || {};
  return Boolean(binding?.is_enabled)
    && Boolean(runtime.is_enabled)
    && runtime.status === "verified"
    && runtime.bridge_mode === "bridge"
    && runtime.capabilities?.bridge_callback === true;
}

function runtimeWarnings(binding){
  const runtime = binding?.runtime || {};
  const capabilities = runtime.capabilities || {};
  const warnings = [];
  if(!binding?.is_enabled || !runtime.is_enabled){
    warnings.push("Runtime is disabled for this project or globally.");
  }
  if(runtime.status !== "verified"){
    warnings.push("Runtime is not verified.");
  }
  if(runtime.bridge_mode !== "bridge" || !capabilities.bridge_callback){
    warnings.push("Bridge callback mode is unsupported.");
  }
  if(!capabilities.sse_events){
    warnings.push("SSE events are unsupported.");
  }
  return warnings;
}

function renderProjectMeta(project){
  const status = project?.is_archived ? "archived" : (project?.is_default ? "default" : "active");
  const slug = project?.slug || project?.id || DEFAULT_PROJECT_ID;
  return [
    "<div class='projectMeta'>",
    "<strong>" + escapeHtml(projectName(project)) + "</strong>",
    "<span>slug: " + escapeHtml(slug) + "</span>",
    "<span>status: " + escapeHtml(status) + "</span>",
    "</div>"
  ].join("");
}

function renderRuntimeBadges(binding){
  const runtime = binding?.runtime || {};
  const badges = [];
  badges.push("<span class='projectBadge " + (binding?.is_default ? "ok" : "") + "'>" + (binding?.is_default ? "Default" : "Bound") + "</span>");
  badges.push("<span class='projectBadge " + (binding?.is_enabled && runtime.is_enabled ? "ok" : "danger") + "'>" + (binding?.is_enabled && runtime.is_enabled ? "Enabled" : "Disabled") + "</span>");
  badges.push("<span class='projectBadge " + (runtime.status === "verified" ? "ok" : "warn") + "'>" + escapeHtml(runtime.status || "unverified") + "</span>");
  badges.push("<span class='projectBadge " + (runtimeCanBeBridgeDefault(binding) ? "ok" : "warn") + "'>" + escapeHtml(runtimeCapabilityLabel(binding)) + "</span>");
  return "<div class='projectRuntimeBadges'>" + badges.join("") + "</div>";
}

function renderRuntimeAgentControl(binding){
  const agents = runtimeAgents(binding);
  if(!agents.length){
    return "<span class='projectRuntimeMeta'>default agent: " + escapeHtml(binding?.default_agent_id || "not configured") + "</span>";
  }
  const selected = binding?.default_agent_id || agents[0]?.agent_id || agents[0]?.id || "";
  return [
    "<select class='projectRuntimeAgent' data-runtime-agent='" + escapeHtml(binding.runtime_id) + "' aria-label='Default agent for " + escapeHtml(binding.runtime?.display_name || binding.runtime_id) + "'>",
    agents.map(agent => {
      const agentId = agent.agent_id || agent.id || "";
      const label = agent.display_name || agent.name || agentId;
      return "<option value='" + escapeHtml(agentId) + "'" + (agentId === selected ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
    }).join(""),
    "</select>"
  ].join("");
}

function renderRuntimeActions(binding){
  const canDefault = runtimeCanBeBridgeDefault(binding);
  const defaultTitle = canDefault
    ? "Set as project default runtime"
    : "Disabled, unverified, or Bridge-unsupported runtimes cannot become the Bridge default";
  return [
    "<div class='projectRuntimeActions'>",
    "<button class='projectRuntimeBtn' type='button' data-runtime-default='" + escapeHtml(binding.runtime_id) + "' " + (binding.is_default || !canDefault ? "disabled" : "") + " title='" + escapeHtml(defaultTitle) + "'>Set Default</button>",
    "<button class='projectRuntimeBtn' type='button' data-runtime-toggle='" + escapeHtml(binding.runtime_id) + "'>" + (binding.is_enabled ? "Disable" : "Enable") + "</button>",
    renderRuntimeAgentControl(binding),
    "</div>"
  ].join("");
}

function renderRuntimeBinding(binding){
  const runtime = binding.runtime || {};
  const warnings = runtimeWarnings(binding);
  return [
    "<div class='projectRuntimeItem" + (binding.is_default ? " default" : "") + "' data-runtime-id='" + escapeHtml(binding.runtime_id) + "'>",
    "<strong class='projectRuntimeName'>" + escapeHtml(runtime.display_name || binding.runtime_id) + "</strong>",
    "<span class='projectRuntimeMeta'>runtime_id: " + escapeHtml(binding.runtime_id) + "</span>",
    "<span class='projectRuntimeMeta'>provider_id: " + escapeHtml(runtime.provider_id || "not configured") + "</span>",
    "<span class='projectRuntimeMeta'>mode: " + escapeHtml(runtime.bridge_mode || "unknown") + " / agent: " + escapeHtml(binding.default_agent_id || "not configured") + "</span>",
    renderRuntimeBadges(binding),
    warnings.map(warning => "<span class='projectRuntimeWarning'>" + escapeHtml(warning) + "</span>").join(""),
    renderRuntimeActions(binding),
    "</div>"
  ].join("");
}

function renderRuntimeSummary(binding){
  if(!binding){
    return "No OpenClaw runtime bound.";
  }
  const runtime = binding.runtime || {};
  const mode = runtime.bridge_mode === "bridge" ? "Bridge" : (runtime.bridge_mode || "mode unknown");
  return escapeHtml(runtime.display_name || binding.runtime_id) + "<br>" + escapeHtml(mode + " / " + (binding.default_agent_id || "agent not configured"));
}

function renderRuntimeSettingsSection(){
  const defaultBinding = projectOpenClawRuntimes.find(binding => binding.is_default) || projectOpenClawRuntimes[0] || null;
  const details = projectOpenClawRuntimes.length
    ? projectOpenClawRuntimes.map(renderRuntimeBinding).join("")
    : "<div class='projectRuntimeItem'><span class='projectRuntimeWarning'>No OpenClaw runtime bound.</span></div>";
  return [
    "<span class='projectRuntimeSummary'>" + renderRuntimeSummary(defaultBinding) + "</span>",
    "<details class='projectRuntimeDetails'>",
    "<summary>Runtime</summary>",
    "<div class='projectRuntimeList'>" + details + "</div>",
    "</details>"
  ].join("");
}

function closeProjectSettingsPopover(){
  projectSettingsPopover.classList.remove("open");
  projectSettingsPopover.hidden = true;
}

function openProjectSettingsPopover(){
  if(isCommonWorkspace()){
    return;
  }
  renderProjectSettingsPopover();
  projectSettingsPopover.hidden = false;
  projectSettingsPopover.classList.add("open");
}

function renderProjectSettingsPopover(){
  if(isCommonWorkspace()){
    projectSettingsPopoverBody.innerHTML = "";
    closeProjectSettingsPopover();
    return;
  }
  const project = activeProject();
  projectSettingsPopoverBody.innerHTML = [
    renderProjectMeta(project),
    renderRuntimeSettingsSection(),
    "<span class='projectSettingsPlaceholder'>Variables</span>",
    "<span class='projectSettingsPlaceholder'>Memory</span>",
    "<span class='projectSettingsPlaceholder'>Knowledge Base</span>",
    "<span class='projectSettingsPlaceholder'>Automation</span>"
  ].join("");
}

async function openProjectSettingsForProject(projectId){
  const project = projectById(projectId);
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return;
  }
  if(activeProjectId !== project.id || isCommonWorkspace()){
    await switchProject(project.id);
  }else{
    renderProjectSelector();
    await loadProjectOpenClawRuntimes();
  }
  openProjectSettingsPopover();
}

function renderProjectRuntimeStatus(){
  if(isCommonWorkspace()){
    setProjectStatus("");
    renderProjectSettingsPopover();
    return;
  }
  setProjectStatus("");
  renderProjectSettingsPopover();
}

async function loadProjectOpenClawRuntimes(){
  if(isCommonWorkspace()){
    projectOpenClawRuntimes = [];
    await loadOpenClawRuntimeRegistry();
    syncFileModeSelector();
    renderProjectRuntimeStatus();
    return;
  }
  try{
    const res = await fetch("/api/projects/" + encodeURIComponent(activeProjectId || DEFAULT_PROJECT_ID) + "/openclaw-runtimes");
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "load project runtimes failed");
    }
    projectOpenClawRuntimes = Array.isArray(data.runtimes) ? data.runtimes : [];
    syncFileModeSelector();
    renderProjectRuntimeStatus();
  }catch(err){
    console.warn("load project OpenClaw runtimes failed", err);
    projectOpenClawRuntimes = [];
    syncFileModeSelector();
    setProjectStatus("OpenClaw runtimes unavailable.");
    renderProjectSettingsPopover();
  }
}

async function loadOpenClawRuntimeRegistry(){
  try{
    const res = await fetch("/api/openclaw/runtimes");
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "load runtime registry failed");
    }
    openClawRuntimeRegistry = Array.isArray(data.runtimes) ? data.runtimes : [];
  }catch(err){
    console.warn("load OpenClaw runtime registry failed", err);
    openClawRuntimeRegistry = [];
  }
}

async function updateProjectRuntimeBinding(runtimeId, patch){
  if(isCommonWorkspace()){
    throw new Error("Project settings are not available for general chats");
  }
  const res = await fetch(
    "/api/projects/" + encodeURIComponent(activeProjectId || DEFAULT_PROJECT_ID) + "/openclaw-runtimes/" + encodeURIComponent(runtimeId),
    {
      method:"PATCH",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify(patch || {})
    }
  );
  const data = await res.json();
  if(!res.ok || !data.ok){
    throw new Error(data.message || data.error || "update runtime binding failed");
  }
  projectOpenClawRuntimes = projectOpenClawRuntimes.map(binding => binding.runtime_id === runtimeId ? data.binding : binding);
  renderProjectRuntimeStatus();
  return data.binding;
}

async function setDefaultProjectRuntime(runtimeId){
  const binding = projectOpenClawRuntimes.find(item => item.runtime_id === runtimeId);
  if(!binding){
    return;
  }
  if(!runtimeCanBeBridgeDefault(binding)){
    setProjectStatus("Cannot set disabled, unverified, or Bridge-unsupported runtime as default.");
    renderProjectSettingsPopover();
    return;
  }
  try{
    await updateProjectRuntimeBinding(runtimeId, {
      is_default:true,
      is_enabled:true
    });
    await loadProjectOpenClawRuntimes();
  }catch(err){
    setProjectStatus("Set default failed: " + (err.message || String(err)));
    renderProjectSettingsPopover();
  }
}

async function toggleProjectRuntimeBinding(runtimeId){
  const binding = projectOpenClawRuntimes.find(item => item.runtime_id === runtimeId);
  if(!binding){
    return;
  }
  try{
    await updateProjectRuntimeBinding(runtimeId, {
      is_enabled:!binding.is_enabled,
      is_default:binding.is_default && !binding.is_enabled
    });
    await loadProjectOpenClawRuntimes();
  }catch(err){
    setProjectStatus("Runtime update failed: " + (err.message || String(err)));
    renderProjectSettingsPopover();
  }
}

async function changeDefaultRuntimeAgent(runtimeId, agentId){
  try{
    await updateProjectRuntimeBinding(runtimeId, {
      default_agent_id:agentId
    });
    await loadProjectOpenClawRuntimes();
  }catch(err){
    setProjectStatus("Agent update failed: " + (err.message || String(err)));
    renderProjectSettingsPopover();
  }
}

async function loadProjects(){
  try{
    const res = await fetch("/api/projects");
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "load projects failed");
    }
    projectsCache = Array.isArray(data.projects) ? data.projects : [];
    if(activeProjectId === DEFAULT_PROJECT_ID){
      persistActiveWorkspace(COMMON_WORKSPACE_KEY);
    }else{
      const active = projectsCache.find(project => project.id === activeProjectId && project.id !== DEFAULT_PROJECT_ID && !project.is_default && !project.is_archived);
      if(!active){
        persistActiveWorkspace(COMMON_WORKSPACE_KEY);
      }
    }
    renderProjectSelector();
    await loadProjectOpenClawRuntimes();
    return projectsCache;
  }catch(err){
    console.warn("load projects failed", err);
    if(!projectsCache.length){
      projectsCache = [{
        id:DEFAULT_PROJECT_ID,
        name:"Chats",
        is_default:true,
        is_archived:false
      }];
      persistActiveWorkspace(COMMON_WORKSPACE_KEY);
      renderProjectSelector();
    }
    setProjectStatus(isCommonWorkspace() ? "" : "Project list unavailable; using general chats.");
    return projectsCache;
  }
}

async function switchProject(projectId){
  const nextWorkspaceKey = workspaceKeyForProjectId(projectId || DEFAULT_PROJECT_ID);
  if(nextWorkspaceKey === activeWorkspaceKey){
    return;
  }
  persistActiveWorkspace(nextWorkspaceKey);
  if(activeProjectId !== DEFAULT_PROJECT_ID){
    setProjectExpanded(activeProjectId, true);
  }
  renderProjectSelector();
  enterBlankChat();
  await loadProjectOpenClawRuntimes();
  await loadConversations();
}

async function switchCommonChats(){
  await switchProject(DEFAULT_PROJECT_ID);
}

function openProjectNameDialog(options){
  const dialog = createEditDialog();
  const title = options?.title || "Project";
  const initialName = options?.initialName || "";
  dialog.title.textContent = title;
  dialog.body.innerHTML = [
    "<label class='settingsField full'>",
    "<span>Project name</span>",
    "<input id='projectNameDialogInput' type='text' />",
    "</label>"
  ].join("");
  dialog.deleteBtn.style.display = "none";
  const inputEl = dialog.body.querySelector("#projectNameDialogInput");
  inputEl.value = initialName;
  dialog.saveBtn.onclick = () => {
    const nextName = inputEl.value.trim();
    if(!nextName){
      inputEl.focus();
      return;
    }
    Promise.resolve(options?.onSave?.(nextName)).then(closeEditDialog);
  };
  dialog.overlay.classList.add("open");
  inputEl.focus();
  inputEl.select();
}

async function createProjectWithName(name){
  if(!name || !name.trim()){
    return;
  }
  try{
    const res = await fetch("/api/projects", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        name:name.trim()
      })
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "create project failed");
    }
    await loadProjects();
    persistActiveProject(data.project?.id || activeProjectId);
    setProjectExpanded(activeProjectId, true);
    renderProjectSelector();
    enterBlankChat();
    await loadProjectOpenClawRuntimes();
    await loadConversations();
    setProjectStatus("Project created.");
  }catch(err){
    setProjectStatus("Create failed: " + (err.message || String(err)));
  }
}

function createProject(){
  openProjectNameDialog({
    title:"New project",
    initialName:"",
    onSave:createProjectWithName
  });
}

function projectById(projectId){
  return projectsCache.find(project => project.id === projectId) || null;
}

function closeProjectActionMenu(){
  if(projectActionMenu){
    projectActionMenu.classList.remove("open");
  }
  projectActionMenuProjectId = "";
}

function getProjectActionMenu(){
  if(projectActionMenu){
    return projectActionMenu;
  }
  projectActionMenu = document.createElement("div");
  projectActionMenu.className = "projectActionMenu";
  projectActionMenu.setAttribute("role", "menu");
  document.body.appendChild(projectActionMenu);
  return projectActionMenu;
}

function appendProjectMenuItem(menu, label, handler){
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.textContent = label;
  button.addEventListener("click", event => {
    event.stopPropagation();
    closeProjectActionMenu();
    Promise.resolve(handler()).catch(err => {
      setProjectStatus(err.message || String(err));
    });
  });
  menu.appendChild(button);
}

function openProjectMenu(projectId, anchorEl){
  const project = projectById(projectId);
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return;
  }
  const menu = getProjectActionMenu();
  if(projectActionMenuProjectId === project.id && menu.classList.contains("open")){
    closeProjectActionMenu();
    return;
  }
  projectActionMenuProjectId = project.id;
  menu.innerHTML = "";
  appendProjectMenuItem(menu, "Rename", () => openRenameProjectDialog(project.id));
  appendProjectMenuItem(menu, "New Chat", () => createConversationForProject(project.id));
  appendProjectMenuItem(menu, "Settings", () => openProjectSettingsForProject(project.id));
  appendProjectMenuItem(menu, "Delete", () => deleteProject(project.id));
  const rect = anchorEl?.getBoundingClientRect?.();
  if(rect){
    menu.style.top = Math.round(rect.bottom + 6) + "px";
    menu.style.left = Math.round(Math.max(8, rect.right - 132)) + "px";
  }
  menu.classList.add("open");
}

function openRenameProjectDialog(projectId){
  const project = projectById(projectId) || activeProject();
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return;
  }
  openProjectNameDialog({
    title:"Rename project",
    initialName:projectName(project),
    onSave:name => renameProject(project.id, name)
  });
}

async function renameProject(projectId, name){
  const project = projectById(projectId) || activeProject();
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return;
  }
  if(!name || !name.trim()){
    return;
  }
  try{
    const res = await fetch("/api/projects/" + encodeURIComponent(project.id), {
      method:"PATCH",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        name:name.trim()
      })
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "rename project failed");
    }
    await loadProjects();
    setProjectStatus("Project renamed.");
  }catch(err){
    setProjectStatus("Rename failed: " + (err.message || String(err)));
  }
}

async function archiveProject(projectId){
  const project = projectById(projectId) || activeProject();
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return;
  }
  if(!confirm("Archive project " + projectName(project) + "?")){
    return;
  }
  try{
    const res = await fetch("/api/projects/" + encodeURIComponent(project.id) + "/archive", {
      method:"POST"
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "archive project failed");
    }
    persistActiveWorkspace(COMMON_WORKSPACE_KEY);
    enterBlankChat();
    await loadProjects();
    await loadProjectOpenClawRuntimes();
    await loadConversations();
    setProjectStatus("Project archived.");
  }catch(err){
    setProjectStatus("Archive failed: " + (err.message || String(err)));
  }
}

async function deleteProject(projectId){
  const project = projectById(projectId) || activeProject();
  if(!project || project.id === DEFAULT_PROJECT_ID || project.is_default){
    return;
  }
  if(!confirm("Delete project " + projectName(project) + "? Project chats may be hidden with the project.")){
    return;
  }
  try{
    const res = await fetch("/api/projects/" + encodeURIComponent(project.id), {
      method:"DELETE"
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "delete project failed");
    }
    if(activeProjectId === project.id){
      persistActiveWorkspace(COMMON_WORKSPACE_KEY);
      enterBlankChat();
    }
    await loadProjects();
    await loadProjectOpenClawRuntimes();
    await loadConversations();
    setProjectStatus("");
  }catch(err){
    setProjectStatus("Delete failed: " + (err.message || String(err)));
  }
}

async function loadConversations(options = {}){
  const clearMissingCurrent = options.clearMissingCurrent !== false;
  try{
    const commonPage = await fetchConversationsForProject(DEFAULT_PROJECT_ID);
    const commonConversations = visibleConversations(commonPage.conversations);
    commonConversationsCache = commonConversations;
    renderConversationRows(conversationList, commonConversations);
    conversationList.hidden = false;
    setConversationPageState({
      projectId:DEFAULT_PROJECT_ID,
      cursor:commonPage.nextCursor,
      hasMore:commonPage.hasMore,
      searchQuery:""
    });

    if(isCommonWorkspace()){
      archiveSourceConversations = await fetchArchiveSourceConversations();
      conversationsCache = commonConversations;
    }else{
      const projectId = activeProjectId || DEFAULT_PROJECT_ID;
      const projectPage = await fetchConversationsForProject(projectId);
      const projectConversations = visibleConversations(projectPage.conversations);
      archiveSourceConversations = await fetchArchiveSourceConversations();
      conversationsCache = projectConversations;
      const projectMount = document.getElementById("projectConversationMount");
      if(projectMount){
        renderConversationRows(projectMount, projectConversations);
      }
    }

    renderArchivePanel();
    setActiveConversation();
    if(clearMissingCurrent && currentConversationId && !conversationsCache.some(item => item.id === currentConversationId)){
      enterBlankChat();
    }
    return conversationsCache;
  }catch(err){
    console.log("load conversations failed", err);
    return conversationsCache;
  }
}

function normalizeConversationPage(data){
  return {
    conversations:data.conversations || [],
    hasMore:Boolean(data.hasMore || data.has_more),
    nextCursor:data.nextCursor || data.next_cursor || ""
  };
}

async function fetchConversationsForProject(projectId, options = {}){
  const params = new URLSearchParams({
    project_id:projectId || DEFAULT_PROJECT_ID
  });
  if(options.includeArchived){
    params.set("include_archived", "1");
  }
  if(options.archivedOnly){
    params.set("archived_only", "1");
  }
  if(options.cursor){
    params.set("cursor", options.cursor);
  }
  if(options.limit){
    params.set("limit", String(options.limit));
  }
  if(options.q){
    params.set("q", options.q);
  }
  const res = await fetch("/api/conversations?" + params.toString());
  const data = await res.json();
  if(!res.ok || !data.ok){
    throw new Error(data.error || "load conversations failed");
  }
  return normalizeConversationPage(data);
}

function mergeConversationLists(lists){
  const merged = new Map();
  (lists || []).forEach(list => {
    (list || []).forEach(item => {
      if(item?.id){
        merged.set(item.id, item);
      }
    });
  });
  return Array.from(merged.values());
}

async function fetchArchiveSourceConversations(){
  const projectIds = [
    DEFAULT_PROJECT_ID,
    ...realProjects().map(project => project.id).filter(Boolean)
  ];
  const projectLists = await Promise.all(projectIds.map(projectId =>
    fetchConversationsForProject(projectId, { archivedOnly:true, limit:1000 }).then(page => page.conversations).catch(err => {
      console.warn("load archived project conversations failed", projectId, err);
      return [];
    })
  ));
  return mergeConversationLists(projectLists);
}

const archiveExpandedGroups = new Set();

function isConversationArchived(item){
  if(!item?.id){
    return false;
  }
  return Boolean(item.archived || item.is_archived || item.status === "archived");
}

function conversationUpdatedAt(item){
  return new Date(item?.updated_at || item?.created_at || 0).getTime() || 0;
}

function conversationArchivedAt(item){
  return new Date(item?.archived_at || item?.updated_at || item?.created_at || 0).getTime() || 0;
}

function visibleConversations(conversations){
  return (conversations || [])
    .filter(item => !isConversationArchived(item))
    .sort((a, b) => {
      const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if(pinnedDiff){
        return pinnedDiff;
      }
      return conversationUpdatedAt(b) - conversationUpdatedAt(a);
    });
}

function archivedConversations(conversations){
  return (conversations || [])
    .filter(isConversationArchived)
    .sort((a, b) => conversationArchivedAt(b) - conversationArchivedAt(a));
}

function sameLocalDate(a, b){
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function archiveGroupLabel(item){
  const updated = new Date(conversationArchivedAt(item));
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  if(sameLocalDate(updated, now)){
    return "Today";
  }
  if(sameLocalDate(updated, yesterday)){
    return "Yesterday";
  }
  if(updated >= sevenDaysAgo){
    return "Last 7 Days";
  }
  if(updated.getFullYear() === now.getFullYear() && updated.getMonth() === now.getMonth()){
    return "This Month";
  }
  if(updated.getFullYear() === now.getFullYear()){
    return updated.toLocaleString("en-US", { month:"long", year:"numeric" });
  }
  return "Older...";
}

function archiveGroupOrder(label){
  const fixed = ["Today", "Yesterday", "Last 7 Days", "This Month"];
  const fixedIndex = fixed.indexOf(label);
  if(fixedIndex >= 0){
    return fixedIndex;
  }
  if(label === "Older..."){
    return 999;
  }
  return 10;
}

function groupedArchiveConversations(conversations){
  const groups = new Map();
  archivedConversations(conversations).forEach(item => {
    const label = archiveGroupLabel(item);
    if(!groups.has(label)){
      groups.set(label, []);
    }
    groups.get(label).push(item);
  });
  return Array.from(groups.entries()).sort((a, b) => {
    const orderDiff = archiveGroupOrder(a[0]) - archiveGroupOrder(b[0]);
    if(orderDiff){
      return orderDiff;
    }
    return conversationArchivedAt(b[1][0]) - conversationArchivedAt(a[1][0]);
  });
}

function setArchiveOpen(open){
  archivePanel.classList.toggle("open", open);
  archiveToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  archiveChevron.textContent = open ? String.fromCharCode(9662) : String.fromCharCode(8250);
}

function renderArchivePanel(){
  archiveBody.innerHTML = "";
  const groups = groupedArchiveConversations(archiveSourceConversations);

  if(!groups.length){
    const empty = document.createElement("div");
    empty.className = "archiveEmpty";
    empty.textContent = "No archived conversations";
    archiveBody.appendChild(empty);
    return;
  }

  groups.forEach(([label, items]) => {
    const group = document.createElement("div");
    group.className = "archiveGroup";
    group.dataset.archiveGroup = label;
    const expanded = archiveExpandedGroups.has(label);
    group.classList.toggle("open", expanded);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "archiveGroupToggle";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.textContent = (expanded ? String.fromCharCode(9662) : String.fromCharCode(9656)) + " " + label;
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      if(archiveExpandedGroups.has(label)){
        archiveExpandedGroups.delete(label);
      }else{
        archiveExpandedGroups.add(label);
      }
      renderArchivePanel();
    });

    const list = document.createElement("div");
    list.className = "archiveGroupList";
    renderConversationRows(list, items, { archive:true });

    group.appendChild(toggle);
    group.appendChild(list);
    archiveBody.appendChild(group);
  });
}

function renderCurrentConversationLists(){
  const visible = visibleConversations(archiveSourceConversations);
  if(isCommonWorkspace()){
    conversationsCache = visible;
    renderConversationRows(conversationList, visible);
  }else{
    conversationsCache = visible;
    const projectMount = document.getElementById("projectConversationMount");
    if(projectMount){
      renderConversationRows(projectMount, visible);
    }
  }
  setActiveConversation();
}

function setConversationPageState(patch = {}){
  conversationPageState = {
    ...conversationPageState,
    ...patch
  };
  renderConversationLoadMore();
}

function activeConversationProjectId(){
  return DEFAULT_PROJECT_ID;
}

function activeConversationListElement(){
  return conversationList;
}

function renderConversationLoadMore(){
  const searching = Boolean(normalizedChatSearchQuery());
  conversationLoadMoreBtn.hidden = searching || !conversationPageState.hasMore;
  conversationLoadMoreBtn.disabled = Boolean(conversationPageState.loading);
  conversationLoadMoreBtn.textContent = conversationPageState.loading ? "Loading..." : "Load more";
}

async function loadMoreConversations(){
  if(conversationPageState.loading || !conversationPageState.hasMore || normalizedChatSearchQuery()){
    return;
  }
  const projectId = conversationPageState.projectId || activeConversationProjectId();
  setConversationPageState({ loading:true });
  try{
    const page = await fetchConversationsForProject(projectId, {
      cursor:conversationPageState.cursor,
      limit:50
    });
    const existingIds = new Set(commonConversationsCache.map(item => item.id));
    const nextItems = visibleConversations(page.conversations)
      .filter(item => item?.id && !existingIds.has(item.id));
    commonConversationsCache = visibleConversations([...commonConversationsCache, ...nextItems]);
    renderConversationRows(conversationList, commonConversationsCache);
    setConversationPageState({
      projectId,
      cursor:page.nextCursor,
      hasMore:page.hasMore,
      loading:false
    });
    setProjectStatus("");
  }catch(err){
    setConversationPageState({ loading:false });
    setProjectStatus("Load more failed: " + (err.message || String(err)));
  }
}

function mergeConversationState(conversation){
  if(!conversation?.id){
    return;
  }
  archiveSourceConversations = archiveSourceConversations.map(item => (
    item.id === conversation.id ? { ...item, ...conversation } : item
  ));
}

async function updateConversationState(conversationId, action){
  try{
    const res = await fetch("/api/conversations/" + encodeURIComponent(conversationId), {
      method:"PATCH",
      headers:{ "Content-Type":"application/json; charset=utf-8" },
      body:JSON.stringify({ action })
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || !data.ok){
      throw new Error(data.error || "update conversation failed");
    }
    mergeConversationState(data.conversation);
    await loadConversations({ clearMissingCurrent:false });
    setProjectStatus("Conversation updated.");
    return data.conversation;
  }catch(err){
    const message = err?.message || String(err);
    setProjectStatus("Conversation update failed: " + message);
    throw err;
  }
}

function archiveConversation(conversationId){
  updateConversationState(conversationId, "archive").catch(err => {
    alert("Archive failed: " + err.message);
  });
}

function restoreArchivedConversation(conversationId){
  updateConversationState(conversationId, "restore").catch(err => {
    alert("Restore failed: " + err.message);
  });
}

function togglePinnedConversation(item){
  updateConversationState(item.id, item.pinned ? "unpin" : "pin").catch(err => {
    alert("Pin failed: " + err.message);
  });
}

function restoreConversationAfterNewMessage(conversationId){
  if(!conversationId){
    return;
  }
  archiveSourceConversations = archiveSourceConversations.map(item => (
    item.id === conversationId ? { ...item, archived:false, is_archived:false, archived_at:null, status:item.status === "archived" ? "" : item.status } : item
  ));
}

function closeConversationMenus(){
  document.querySelectorAll(".conversationMenu.open").forEach(menu => {
    menu.classList.remove("open");
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function appendConversationMenuItem(menu, label, handler){
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = label;
  item.addEventListener("click", event => {
    event.stopPropagation();
    closeConversationMenus();
    handler();
  });
  menu.appendChild(item);
}

function renderConversationRows(targetList, conversations, options = {}){
  targetList.innerHTML = "";
  const inArchive = options.archive === true;
  conversations.forEach(item => {
    const row = document.createElement("div");
    row.className = "historyRow";
    row.dataset.id = item.id;
    row.dataset.title = item.title || "New Chat";
    row.classList.toggle("pinned", Boolean(item.pinned));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "historyItem";
    btn.dataset.id = item.id;
    if(item.pinned && !inArchive){
      const pinMark = document.createElement("span");
      pinMark.className = "historyPinMark";
      pinMark.textContent = "PIN";
      btn.appendChild(pinMark);
    }
    const titleText = document.createElement("span");
    titleText.textContent = item.title || "New Chat";
    btn.appendChild(titleText);
    btn.title = item.last_message_preview
      ? (item.title || "New Chat") + "\\n" + item.last_message_preview
      : (item.title || "New Chat");
    btn.addEventListener("click", () => loadConversationMessages(item.id));

    const time = document.createElement("span");
    time.className = "historyTime";
    time.textContent = formatHistoryTime(item.updated_at || item.created_at);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "conversationMenuBtn";
    menuBtn.textContent = "...";
    menuBtn.title = "Conversation actions";
    menuBtn.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.className = "conversationMenu";

    if(inArchive){
      appendConversationMenuItem(menu, "Restore", () => restoreArchivedConversation(item.id));
    }else{
      appendConversationMenuItem(menu, item.pinned ? "Unpin" : "Pin", () => togglePinnedConversation(item));
      appendConversationMenuItem(menu, "Archive", () => archiveConversation(item.id));
    }
    appendConversationMenuItem(menu, "Delete", () => deleteConversation(item.id, item.title || "New Chat"));

    menuBtn.addEventListener("click", event => {
      event.stopPropagation();
      const open = !menu.classList.contains("open");
      closeConversationMenus();
      menu.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      closeConversationMenus();
      menu.classList.add("open");
      menuBtn.setAttribute("aria-expanded", "true");
    });

    row.appendChild(btn);
    row.appendChild(time);
    row.appendChild(menuBtn);
    row.appendChild(menu);
    targetList.appendChild(row);
  });
  renderConversationLoadMore();
}

function normalizedChatSearchQuery(){
  return (chatSearchInput?.value || "").trim().toLowerCase();
}

let conversationSearchRequestId = 0;

async function applyChatSearchFilter(){
  const query = normalizedChatSearchQuery();
  const requestId = ++conversationSearchRequestId;
  if(!query){
    renderConversationRows(conversationList, commonConversationsCache);
    renderConversationLoadMore();
    setProjectStatus("");
    return;
  }

  renderConversationLoadMore();
  try{
    const page = await fetchConversationsForProject(activeConversationProjectId(), {
      q:query,
      limit:1000
    });
    if(requestId !== conversationSearchRequestId){
      return;
    }
    renderConversationRows(activeConversationListElement(), visibleConversations(page.conversations));
    setProjectStatus("");
  }catch(err){
    if(requestId === conversationSearchRequestId){
      setProjectStatus("Search failed: " + (err.message || String(err)));
    }
  }
}

async function createConversationForProject(projectId){
  const targetProjectId = projectId || activeProjectId || DEFAULT_PROJECT_ID;
  try{
    if(targetProjectId !== DEFAULT_PROJECT_ID && targetProjectId !== activeProjectId){
      persistActiveProject(targetProjectId);
      setProjectExpanded(targetProjectId, true);
      renderProjectSelector();
      await loadProjectOpenClawRuntimes();
    }
    const res = await fetch("/api/conversations", {
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        title:"New Chat",
        project_id:targetProjectId
      })
    });
    const data = await res.json();
    if(!res.ok || !data.ok){
      throw new Error(data.error || "create conversation failed");
    }
    await loadConversations();
    if(data.conversation?.id){
      await loadConversationMessages(data.conversation.id);
    }else{
      enterBlankChat();
    }
  }catch(err){
    console.warn("create conversation failed", err);
    enterBlankChat();
  }
}

async function createNewConversation(){
  if(!isCommonWorkspace()){
    persistActiveWorkspace(COMMON_WORKSPACE_KEY);
    renderProjectSelector();
    enterBlankChat();
    await loadProjectOpenClawRuntimes();
    await loadConversations();
  }
  await createConversationForProject(DEFAULT_PROJECT_ID);
}

async function deleteConversation(conversationId, title){
  if(!confirm("Delete chat " + title + "?")){
    return;
  }

  try{
    const deletingCurrent = conversationId === currentConversationId;
    const res = await fetch("/api/conversations/" + encodeURIComponent(conversationId), {
      method:"DELETE"
    });
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "delete conversation failed");
    }

    const conversations = await loadConversations();

    if(deletingCurrent){
      const nextConversation = conversations.find(item => item.id !== conversationId);

      if(nextConversation){
        await loadConversationMessages(nextConversation.id);
      }else{
        enterBlankChat();
      }
    }
  }catch(err){
    alert("Delete chat failed: " + err.message);
  }
}

function renderHistoryMessage(message){
  const div = document.createElement("div");
  div.className = message.role === "user" ? "msg user" : "msg ai";

  if(message.role === "assistant"){
    renderAssistantMarkdown(div, message.content || "");
    renderMessageModelInfo(div, message.metadata);
  }else{
    div.textContent = message.content || "";
  }

  chat.appendChild(div);
}

async function loadConversationMessages(conversationId){
  try{
    const res = await fetch("/api/conversations/" + encodeURIComponent(conversationId) + "/messages");
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "加载消息失败");
    }

    currentConversationId = conversationId;
    resetLocalConversation();
    resetTransientContext();
    chat.innerHTML = "<div id='searchResults'></div>";
    searchResults = document.getElementById("searchResults");

    (data.messages || []).forEach(message => {
      renderHistoryMessage(message);

      if(message.role === "user" || message.role === "assistant"){
        conversation.push({
          role:message.role,
          content:message.content || "",
          metadata:message.metadata || null
        });
      }
    });

    setActiveConversation();
    setContextStatus(getCurrentContextStatus());
    await loadOpenClawTasksForConversation(currentConversationId);
    await loadSummaryStatus();
    scrollBottom();
  }catch(err){
    alert("Load conversation failed: " + err.message);
  }
}

input.addEventListener("keydown", e => {

  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }

});
input.addEventListener("input", autoResizeInput);
input.addEventListener("paste", async event => {
  if(await handleConversationFilePaste(event)){
    return;
  }
  await handleImagePaste(event);
});

inputShell?.addEventListener("dragover", event => {
  if(Array.from(event.dataTransfer?.items || []).some(item => item.kind === "file")){
    event.preventDefault();
  }
});

inputShell?.addEventListener("drop", async event => {
  const files = Array.from(event.dataTransfer?.files || []);
  if(!files.length){
    return;
  }
  event.preventDefault();
  await attachFilesByUseMode(files);
});

sendBtn.addEventListener("click", () => {
  if(activeChatAbortController){
    stopActiveChatRequest();
    return;
  }
  sendMessage();
});
openClawTaskBanner.addEventListener("click", async event => {
  const action = event.target?.dataset?.openclawTaskAction;
  if(!action){
    return;
  }
  const task = openClawTasks.find(item => item.id === openClawTaskBanner.dataset.taskId) || currentPendingOpenClawTask();
  if(!task){
    return;
  }
  if(action === "reconnect"){
    openClawReconnectTask = null;
    const latestTask = await fetchOpenClawTaskStatus(task.id).catch(() => task) || task;
    mergeOpenClawTask(latestTask);
    activeOpenClawTask = latestTask;
    renderOpenClawTaskBanner();
    if(shouldPollOpenClawTask(latestTask)){
      startOpenClawReconnectPolling(latestTask.id);
    }else{
      stopOpenClawReconnectPolling();
    }
    setContextStatus("Reconnected to local OpenClaw task tracking. Remote stream cannot be restored.");
    return;
  }
  if(action === "cancel"){
    await cancelOpenClawTask(task);
    return;
  }
  if(action === "dismiss-reconnect"){
    dismissOpenClawReconnectTask(task);
    return;
  }
  if(action === "view"){
    showOpenClawTaskRecord(task);
    return;
  }
  if(action === "wait"){
    setContextStatus("Continuing to wait for the current OpenClaw local task record; remote stream cannot be restored if disconnected.");
    return;
  }
  if(action === "rerun"){
    allowOpenClawRepeatOnce = true;
    ignoredOpenClawTaskIds.add(task.id);
    renderOpenClawTaskBanner();
    sendMessage();
    return;
  }
  if(action === "ignore"){
    ignoredOpenClawTaskIds.add(task.id);
    renderOpenClawTaskBanner();
  }
});
openClawTaskHistoryToggle.addEventListener("click", () => {
  const shouldOpen = openClawTaskHistoryPanel.hidden;
  openClawTaskHistoryPanel.hidden = !shouldOpen;
  openClawTaskHistoryToggle.classList.toggle("active", shouldOpen);
  if(shouldOpen){
    loadOpenClawTaskHistory(openClawTaskHistoryView);
  }
});
openClawTaskHistoryRefresh.addEventListener("click", () => {
  loadOpenClawTaskHistory(openClawTaskHistoryView);
});
openClawTaskHistoryPanel.addEventListener("click", event => {
  const view = event.target?.dataset?.openclawTaskView;
  if(!view){
    return;
  }
  loadOpenClawTaskHistory(view);
});
newChatBtn.addEventListener("click", createNewConversation);
createProjectBtn.addEventListener("click", createProject);
chatSearchInput.addEventListener("input", applyChatSearchFilter);
archiveToggleBtn.addEventListener("click", event => {
  event.stopPropagation();
  setArchiveOpen(!archivePanel.classList.contains("open"));
});
conversationLoadMoreBtn.addEventListener("click", loadMoreConversations);
projectSettingsCloseBtn.addEventListener("click", closeProjectSettingsPopover);
projectSettingsPopover.addEventListener("click", event => {
  event.stopPropagation();
  const defaultRuntimeId = event.target?.dataset?.runtimeDefault;
  if(defaultRuntimeId){
    setDefaultProjectRuntime(defaultRuntimeId);
    return;
  }
  const toggleRuntimeId = event.target?.dataset?.runtimeToggle;
  if(toggleRuntimeId){
    toggleProjectRuntimeBinding(toggleRuntimeId);
  }
});
projectSettingsPopover.addEventListener("change", event => {
  const runtimeId = event.target?.dataset?.runtimeAgent;
  if(runtimeId){
    changeDefaultRuntimeAgent(runtimeId, event.target.value);
  }
});
viewSummaryBtn.addEventListener("click", viewCurrentSummary);
chat.addEventListener("click", event => {
  if(event.target.closest(".welcomeCloseBtn")){
    dismissWelcomeCard();
    return;
  }
  handleCopyClick(event);
});
modelSelect.addEventListener("change", () => {
  if(modelSettingsState?.rememberLastModel && modelSelect.value){
    modelSettingsState.lastModel = modelSelect.value;
    writeSettingsCache(modelSettingsState);
    syncSettingsToServer(modelSettingsState);
  }
  syncFileModeSelector();
});
modelSettingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
cancelSettingsBtn.addEventListener("click", cancelSettings);
applySettingsBtn.addEventListener("click", () => saveSettingsFromUi(false));
saveSettingsBtn.addEventListener("click", () => saveSettingsFromUi(true));
addProviderBtn.addEventListener("click", addProvider);
cancelProviderEditBtn.addEventListener("click", clearProviderForm);
addProviderModelBtn.addEventListener("click", addProviderModel);
cancelModelEditBtn.addEventListener("click", clearModelForm);
modelHealthBtn.addEventListener("click", runModelHealthCheck);
modelHealthToggleBtn.addEventListener("click", toggleModelHealthResults);
settingsModal.addEventListener("click", event => {
  if(event.target === settingsModal){
    event.stopPropagation();
  }
});
contextPanelToggle.addEventListener("click", toggleContextPanel);
contextPanelClose.addEventListener("click", () => setContextPanelOpen(false));
contextAttachBtn.addEventListener("click", () => {
  closeInputMenus();
  setContextPanelOpen(true);
  setFileUseMode(FILE_USE_SOURCE);
  fileInput.click();
});
contextKnowledgeUploadBtn.addEventListener("click", () => {
  closeInputMenus();
  setContextPanelOpen(true);
  setFileUseMode(FILE_USE_LIBRARY);
  fileInput.click();
});
libraryToggle.addEventListener("click", toggleFileLibrary);
libraryToggle.addEventListener("keydown", e => {
  if(e.key === "Enter" || e.key === " "){
    e.preventDefault();
    toggleFileLibrary();
  }
});
refreshFilesBtn.addEventListener("click", loadFilesLibrary);
fileSearchBtn.addEventListener("click", searchFilesLibrary);
fileSearchInput.addEventListener("keydown", e => {
  if(e.key === "Enter"){
    searchFilesLibrary();
  }
});
fileSortSelect.addEventListener("change", () => {
  fileLibrarySort = fileSortSelect.value;
  renderFilesLibrary();
});
clearSelectedFilesBtn.addEventListener("click", clearSelectedLibraryFiles);
attachmentMenuBtn.addEventListener("click", event => {
  event.stopPropagation();
  toggleInputMenu("attachment");
});
toolMenuBtn.addEventListener("click", event => {
  event.stopPropagation();
  toggleInputMenu("tool");
});
attachmentMenu.addEventListener("click", event => event.stopPropagation());
toolMenu.addEventListener("click", event => event.stopPropagation());
document.addEventListener("click", () => {
  closeInputMenus();
  closeConversationMenus();
  closeModelActionMenus();
  closeProjectActionMenu();
  closeProjectSettingsPopover();
});
document.addEventListener("keydown", event => {
  if(event.key === "Escape"){
    closeInputMenus();
    closeConversationMenus();
    closeProjectActionMenu();
    closeProjectSettingsPopover();
    setContextPanelOpen(false);
  }
});
document.addEventListener("paste", event => {
  if(event.target === input){
    return;
  }

  if(document.activeElement === input || event.target?.closest?.(".inputBar")){
    handleConversationFilePaste(event).then(handled => {
      if(!handled){
        handleImagePaste(event);
      }
    });
  }
});
loginForm.addEventListener("submit", login);
logoutBtn.addEventListener("click", logout);
window.addEventListener("load", refreshRenderedMath);
setFileLibraryExpanded(false);
setContextPanelOpen(false);
setupSettingsHeaderActions();
checkAuth();

function toggleTheme(){
  document.body.classList.toggle("dark");
}

function scrollBottom(){
  chat.scrollTop = chat.scrollHeight;
}

function autoResizeInput(){
  input.style.height = "auto";
  const nextHeight = Math.min(input.scrollHeight, INPUT_MAX_HEIGHT);
  input.style.height = nextHeight + "px";
  input.style.overflowY = input.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
}

function resetInputHeight(){
  input.style.height = "";
  input.style.overflowY = "hidden";
}

async function copyText(text){
  const value = String(text || "");
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showCopiedFeedback(button){
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

async function handleCopyClick(event){
  const codeButton = event.target.closest("[data-copy-code]");
  if(codeButton){
    event.stopPropagation();
    const code = codeButton.dataset.code || codeButton.closest(".codeBlock")?.querySelector("code")?.textContent || "";
    try{
      await copyText(code);
      showCopiedFeedback(codeButton);
    }catch(err){
      console.warn("copy code failed", err);
    }
    return;
  }

  const messageButton = event.target.closest("[data-copy-message]");
  if(messageButton){
    event.stopPropagation();
    const message = messageButton.closest(".msg.ai");
    try{
      await copyText(message?.dataset.markdownSource || "");
      showCopiedFeedback(messageButton);
    }catch(err){
      console.warn("copy message failed", err);
    }
  }
}

function addUserMessage(text, imageDataUrl, fileInfo, attachments){

  const div = document.createElement("div");
  const imageAttachments = Array.isArray(attachments) ? attachments : [];

  div.className = (imageDataUrl || imageAttachments.length) && !text && !fileInfo
    ? "msg user userImageOnly"
    : "msg user";

  if(text){
    const textDiv = document.createElement("div");
    textDiv.textContent = text;
    div.appendChild(textDiv);
  }

  if(imageDataUrl){
    const img = document.createElement("img");
    img.className = "userImage";
    img.src = imageDataUrl;
    img.alt = "Uploaded image";
    div.appendChild(img);
  }

  imageAttachments.forEach((attachment, index) => {
    if(!attachment?.dataUrl){
      return;
    }
    const img = document.createElement("img");
    img.className = "userImage";
    img.src = attachment.dataUrl;
    img.alt = "\u7c98\u8d34\u7684\u56fe\u7247 " + (index + 1);
    div.appendChild(img);
  });

  if(fileInfo){
    const fileDiv = document.createElement("div");
    fileDiv.className = "fileInfo";
    if(Array.isArray(fileInfo.attachments) && fileInfo.attachments.length){
      fileDiv.textContent = "Attachments: " + fileInfo.attachments.map(item => item.filename || "file").join(", ");
    }else{
      fileDiv.textContent = "File " + fileInfo.name + " - " + fileInfo.chars + " chars - " + fileInfo.chunks + " chunks";
    }
    div.appendChild(fileDiv);
  }

  chat.appendChild(div);

  scrollBottom();
}

function addAIMessage(){

  const div = document.createElement("div");

  div.className = "msg ai";

  chat.appendChild(div);

  scrollBottom();

  return div;
}

async function getSourcePreview(source){
  const key = source.file_id + ":" + source.chunk_index;

  if(sourcePreviewCache[key]){
    return sourcePreviewCache[key];
  }

  if(source.preview){
    sourcePreviewCache[key] = String(source.preview).slice(0, 500);
    return sourcePreviewCache[key];
  }

  const res = await fetch("/api/files/" + encodeURIComponent(source.file_id) + "/chunks");
  const data = await res.json();

  if(!res.ok || !data.ok){
    throw new Error(data.error || "source preview failed");
  }

  const chunk = (data.chunks || []).find(item => Number(item.chunk_index) === Number(source.chunk_index));
  sourcePreviewCache[key] = String(chunk?.content_preview || "").slice(0, 500);
  return sourcePreviewCache[key];
}

function renderSources(element, sources){
  if(!Array.isArray(sources) || !sources.length){
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "sourceCitations";

  const title = document.createElement("div");
  title.className = "sourceCitationsTitle";
  title.textContent = "\u6765\u6e90\uff1a";
  wrapper.appendChild(title);

  sources.forEach(source => {
    const item = document.createElement("div");
    item.className = "sourceCitationItem";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sourceCitationBtn";
    btn.textContent = "- " + (source.filename || "file") + " \u00b7 chunk " + source.chunk_index;
    btn.title = btn.textContent;

    const preview = document.createElement("div");
    preview.className = "sourceCitationPreview";

    btn.addEventListener("click", async () => {
      preview.classList.toggle("active");

      if(!preview.classList.contains("active") || preview.dataset.loaded){
        return;
      }

      preview.textContent = "\u6b63\u5728\u52a0\u8f7d...";

      try{
        preview.textContent = await getSourcePreview(source) || "\u6682\u65e0\u9884\u89c8";
      }catch(err){
        preview.textContent = "\u6765\u6e90\u9884\u89c8\u52a0\u8f7d\u5931\u8d25";
        console.log("load source preview failed", err);
      }

      preview.dataset.loaded = "1";
      scrollBottom();
    });

    item.appendChild(btn);
    item.appendChild(preview);
    wrapper.appendChild(item);
  });

  element.appendChild(wrapper);
}

function renderToolSources(element, sources){
  if(!Array.isArray(sources) || !sources.length){
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "sourceCitations toolSourceCitations";

  const title = document.createElement("div");
  title.className = "sourceCitationsTitle";
  title.textContent = sources.some(source => source.type === "fetch_url")
    ? "\u7f51\u9875\u6765\u6e90\uff1a"
    : "\u8054\u7f51\u6765\u6e90\uff1a";
  wrapper.appendChild(title);

  sources.forEach(source => {
    const item = document.createElement("div");
    item.className = "sourceCitationItem";

    const link = document.createElement("a");
    link.className = "sourceCitationBtn";
    link.href = source.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = (source.title || source.url || "Untitled") + (source.url ? " - " + source.url : "");
    link.title = link.textContent;

    const preview = document.createElement("div");
    preview.className = "sourceCitationPreview active";
    preview.textContent = [
      formatSearchTimeMeta(source),
      String(source.snippet || source.preview || "").slice(0, 500)
    ].filter(Boolean).join(String.fromCharCode(10));

    item.appendChild(link);
    if(preview.textContent){
      item.appendChild(preview);
    }
    wrapper.appendChild(item);
  });

  element.appendChild(wrapper);
}

function renderToolError(element, toolError){
  if(!toolError || !toolError.message){
    return;
  }

  const notice = document.createElement("div");
  notice.className = "toolErrorNotice";
  notice.textContent = toolError.message;
  element.appendChild(notice);
}

function renderToolDebug(element, toolDebug){
  if(!toolDebug || !toolDebug.name){
    return;
  }

  const info = document.createElement("div");
  info.className = "toolDebugInfo";
  const result = toolDebug.result || {};
  const resultLines = Array.isArray(result.results)
    ? result.results.map((item, index) => {
      return [
        "result " + (index + 1) + ": " + (item.title || ""),
        item.source ? "  source: " + item.source : "",
        item.age ? "  age: " + item.age : "",
        item.page_age ? "  page_age: " + item.page_age : "",
        item.published ? "  published: " + item.published : ""
      ].filter(Boolean).join(String.fromCharCode(10));
    })
    : [];
  info.textContent = [
    "tool: " + toolDebug.name,
    "trigger: " + (toolDebug.trigger || ""),
    result.query ? "query: " + result.query : "",
    "freshness: " + (result.freshness || "none"),
    result.result_count !== undefined ? "result count: " + result.result_count : "",
    "duration: " + Number(toolDebug.duration_ms || 0) + "ms",
    "status: " + (toolDebug.status || ""),
    toolDebug.code ? "code: " + toolDebug.code : "",
    ...resultLines
  ].filter(Boolean).join(String.fromCharCode(10));
  element.appendChild(info);
}

function renderModelDiagnostics(element, diagnostics){
  const lines = [];

  (diagnostics?.fallbacks || []).forEach(item => {
    lines.push(
      "fallback: " + (item.from || "") + " -> " + (item.to || ""),
      "reason: " + (item.reason || ""),
      item.message ? "message: " + item.message : ""
    );
  });

  if(diagnostics?.done){
    const done = diagnostics.done;
    lines.push(
      "model: " + [done.provider, done.model].filter(Boolean).join(" / "),
      "latency: " + Number(done.latencyMs || 0) + "ms",
      "fallback count: " + Number(done.fallbackCount || 0)
    );
  }

  if(diagnostics?.providerError){
    const error = diagnostics.providerError;
    lines.push(
      "provider error: " + [error.provider, error.model].filter(Boolean).join(" / "),
      "status: " + (error.status || ""),
      "code: " + (error.code || ""),
      "message: " + (error.message || "")
    );
  }

  const text = lines.filter(Boolean).join(String.fromCharCode(10));
  if(!text){
    return;
  }

  const info = document.createElement("div");
  info.className = "modelDiagnosticInfo";
  info.textContent = text;
  element.appendChild(info);
}

function escapeHtml(value){
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeMathLatex(value){
  return encodeURIComponent(String(value || ""));
}

function decodeMathLatex(value){
  try{
    return decodeURIComponent(String(value || ""));
  }catch(err){
    return String(value || "");
  }
}

async function libraryTextForUpload(file){
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if(type.startsWith("text/") || [".txt",".md",".markdown",".csv",".json"].some(ext => name.endsWith(ext))){
    return file.text();
  }
  if(name.endsWith(".pdf") || type === "application/pdf"){
    return extractPdfText(file).catch(() => "");
  }
  if(name.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
    return extractDocxText(file).catch(() => "");
  }
  return "";
}

async function attachFilesByUseMode(files){
  await attachConversationFiles(files);
}

async function ensureConversationAttachmentsUploaded(attachments){
  const uploaded = [];
  for(const attachment of attachments){
    if(attachment.id){
      uploaded.push(attachment);
      continue;
    }
    if(!attachment.file){
      throw new Error("Attachment file is missing");
    }
    uploaded.push(await uploadConversationAttachment(attachment.file));
  }
  pendingConversationAttachments = uploaded;
  renderConversationAttachments();
  return uploaded;
}

async function storePendingAttachmentsInLibrary(attachments){
  const files = attachments.map(attachment => attachment.file).filter(Boolean);
  if(files.length !== attachments.length){
    throw new Error("Pending file is missing");
  }
  const uploadedIds = [];
  for(const file of files){
    const textContent = await libraryTextForUpload(file);
    const uploaded = await uploadFileToLibrary(file, textContent);
    if(uploaded?.id){
      uploadedIds.push(uploaded.id);
    }
  }
  pendingConversationAttachments = [];
  selectedFile = null;
  selectedFileText = "";
  selectedFileChunks = [];
  lastRelevantChunkCount = 0;
  selectedFileIds = [...new Set([...selectedFileIds, ...uploadedIds])];
  selectedFileId = selectedFileIds[0] || null;
  await loadFilesLibrary({ pruneSelection:false });
  renderConversationAttachments();
  clearFileBtn.style.display = selectedFileIds.length ? "inline-block" : "none";
  return uploadedIds;
}


function protectMarkdownCode(markdown){
  const protectedParts = [];
  const backtick = String.fromCharCode(96);
  const fence = backtick + backtick + backtick;
  const fencePattern = new RegExp(fence + "[^]*?" + fence, "g");
  const inlineCodePattern = new RegExp(backtick + "[^" + backtick + "]*" + backtick, "g");
  const token = value => {
    const key = "%%MD_PROTECTED_" + protectedParts.length + "%%";
    protectedParts.push(value);
    return key;
  };
  const text = String(markdown || "")
    .replace(fencePattern, token)
    .replace(inlineCodePattern, token);
  return { text, protectedParts };
}

function restoreMarkdownCode(markdown, protectedParts){
  return String(markdown || "").replace(new RegExp("%%MD_PROTECTED_([0-9]+)%%", "g"), (_, index) => protectedParts[Number(index)] || "");
}

function renderMathMarkup(markdown){
  const protectedMarkdown = protectMarkdownCode(markdown);
  const backslash = String.fromCharCode(92);
  const dollar = String.fromCharCode(36);
  const literalDollar = backslash + dollar;
  const newline = String.fromCharCode(10);
  const blockMathPattern = new RegExp(literalDollar + literalDollar + "([^]*?)" + literalDollar + literalDollar, "g");
  const inlineMathPattern = new RegExp("(^|[^" + backslash + backslash + dollar + "])" + literalDollar + "([^" + newline + dollar + "]+?)" + literalDollar, "g");
  const withMath = protectedMarkdown.text
    .replace(blockMathPattern, (_, expression) => (
      "<div class='mathBlock mathFallback' data-math-display='1' data-latex='" + encodeMathLatex(expression.trim()) + "'>$$" + escapeHtml(expression.trim()) + "$$</div>"
    ))
    .replace(inlineMathPattern, (_, prefix, expression) => (
      prefix + "<span class='mathInline mathFallback' data-math-display='0' data-latex='" + encodeMathLatex(expression.trim()) + "'>$" + escapeHtml(expression.trim()) + "$</span>"
    ));
  return restoreMarkdownCode(withMath, protectedMarkdown.protectedParts);
}

function parseAssistantMarkdown(markdown){
  if(window.marked?.setOptions){
    marked.setOptions({
      gfm:true,
      breaks:false
    });
  }
  return marked.parse(renderMathMarkup(markdown || ""));
}

function enhanceCodeBlocks(container){
  container.querySelectorAll("pre").forEach(pre => {
    if(pre.closest(".codeBlock")){
      return;
    }
    const code = pre.querySelector("code");
    const wrapper = document.createElement("div");
    wrapper.className = "codeBlock";
    const toolbar = document.createElement("div");
    toolbar.className = "codeBlockToolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "codeCopyBtn";
    button.textContent = "复制";
    button.dataset.copyCode = "1";
    toolbar.appendChild(button);
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(pre);
    if(code){
      button.dataset.code = code.textContent || "";
    }
  });
}

function enhanceTables(container){
  container.querySelectorAll("table").forEach(table => {
    if(table.parentElement?.classList.contains("tableWrap")){
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "tableWrap";
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

function renderKatexMath(container){
  container.querySelectorAll("[data-latex]").forEach(element => {
    const latex = decodeMathLatex(element.dataset.latex || "");
    const displayMode = element.dataset.mathDisplay === "1";

    if(!window.katex){
      element.textContent = displayMode ? "$$" + latex + "$$" : "$" + latex + "$";
      element.classList.add("mathFallback");
      return;
    }

    try{
      window.katex.render(latex, element, {
        throwOnError:false,
        displayMode
      });
      element.classList.remove("mathFallback");
    }catch(err){
      element.textContent = displayMode ? "$$" + latex + "$$" : "$" + latex + "$";
      element.classList.add("mathFallback");
    }
  });
}

function refreshRenderedMath(){
  document.querySelectorAll(".assistantMessageBody").forEach(renderKatexMath);
}

function renderAssistantMarkdown(element, markdown){
  element.dataset.markdownSource = markdown || "";
  element.innerHTML = "";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "messageCopyBtn";
  copyBtn.dataset.copyMessage = "1";
  copyBtn.textContent = "复制";
  const body = document.createElement("div");
  body.className = "assistantMessageBody";
  body.innerHTML = parseAssistantMarkdown(markdown || "");
  element.appendChild(copyBtn);
  element.appendChild(body);
  enhanceCodeBlocks(body);
  enhanceTables(body);
  renderKatexMath(body);
}

function displayModelInfoEnabled(){
  return Boolean(modelSettingsState?.showPerMessageModelInfo);
}

function titleCaseExecutionMode(value){
  const text = String(value || "").trim();
  if(!text){
    return "";
  }
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeMessageModelMetadata(metadata){
  if(!metadata || typeof metadata !== "object"){
    return null;
  }
  const clean = {};
  ["provider","provider_label","model","model_label","runtime","runtime_id","agent","execution_mode"].forEach(key => {
    const value = String(metadata[key] || "").trim();
    if(value){
      clean[key] = value;
    }
  });
  return Object.keys(clean).length ? clean : null;
}

function doneEventModelMetadata(data){
  const provider = String(data?.provider || "").trim();
  const model = String(data?.model || data?.modelName || "").trim();
  const metadata = normalizeMessageModelMetadata(data?.metadata);
  if(metadata){
    return metadata;
  }
  if(!provider && !model){
    return null;
  }
  return normalizeMessageModelMetadata({
    provider,
    provider_label:provider,
    model,
    model_label:model
  });
}

function messageModelInfoText(metadata){
  const clean = normalizeMessageModelMetadata(metadata);
  if(!clean){
    return "";
  }
  const parts = [];
  const model = clean.model_label || clean.model;
  const runtime = clean.runtime || clean.provider_label || clean.provider;
  const mode = titleCaseExecutionMode(clean.execution_mode);
  if(model){
    parts.push(model);
  }
  if(runtime && runtime !== model){
    parts.push(runtime);
  }
  if(mode){
    parts.push(mode);
  }
  return parts.join(" · ");
}

function renderMessageModelInfo(element, metadata){
  if(!displayModelInfoEnabled()){
    return;
  }
  const text = messageModelInfoText(metadata);
  if(!text){
    return;
  }
  const info = document.createElement("div");
  info.className = "messageModelInfo";
  info.textContent = text;
  element.appendChild(info);
}

function renderAssistantMessage(element, text, sources, toolSources, toolError, toolDebug, diagnostics, metadata){
  renderAssistantMarkdown(element, text || "");
  renderToolError(element, toolError);
  renderToolDebug(element, toolDebug);
  renderModelDiagnostics(element, diagnostics);
  renderSources(element, sources);
  renderToolSources(element, toolSources);
  renderMessageModelInfo(element, metadata);
  scrollBottom();
}

function handleToolStatus(status){
  if(!status || !status.message){
    return;
  }

  setContextStatus(status.message);

  if(status.status === "done"){
    setTimeout(() => {
      if(contextStatus.textContent === status.message){
        setContextStatus(getCurrentContextStatus());
      }
    }, 1200);
  }
}

function handleToolError(error){
  if(!error || !error.message){
    return;
  }

  setContextStatus(error.message);
}

async function typeWriter(element, text){

  let current = "";

  for(let i = 0; i < text.length; i++){

    current += text[i];

    renderAssistantMarkdown(element, current);

    scrollBottom();

    await new Promise(r => setTimeout(r, 8));
  }
}

function streamTextCandidate(value){
  if(typeof value === "string"){
    return value;
  }
  if(Array.isArray(value)){
    return value.map(streamTextCandidate).filter(Boolean).join("");
  }
  if(value && typeof value === "object"){
    if(typeof value.text === "string"){
      return value.text;
    }
    if(typeof value.content === "string"){
      return value.content;
    }
    if(typeof value.output_text === "string"){
      return value.output_text;
    }
    if(typeof value.delta === "string"){
      return value.delta;
    }
  }
  return "";
}

function looksLikeOpenClawTaskMetadata(data){
  if(!data || typeof data !== "object" || Array.isArray(data)){
    return false;
  }
  return Boolean(
    data.task_id ||
    data.taskId ||
    data.remote_task_id ||
    data.remoteTaskId ||
    data.task?.id ||
    data.task?.task_id ||
    data.status ||
    data.progress !== undefined ||
    data.remote_status ||
    data.remote_progress
  );
}

function extractStreamTextFromData(data){
  if(!data || typeof data !== "object"){
    return "";
  }

  const choices = Array.isArray(data.choices)
    ? data.choices
    : Array.isArray(data.data?.choices)
      ? data.data.choices
      : [];
  for(const choice of choices){
    const text = streamTextCandidate(choice?.delta?.content)
      || streamTextCandidate(choice?.message?.content)
      || streamTextCandidate(choice?.text)
      || streamTextCandidate(choice?.delta)
      || streamTextCandidate(choice?.content);
    if(text){
      return text;
    }
  }

  const direct = streamTextCandidate(data.response)
    || streamTextCandidate(data.output_text)
    || streamTextCandidate(data.text)
    || streamTextCandidate(data.content)
    || streamTextCandidate(data.delta);
  if(direct){
    return direct;
  }

  const nested = data.result || data.data || data.message || data.event;
  const nestedText = nested && typeof nested === "object" ? extractStreamTextFromData(nested) : "";
  if(nestedText){
    return nestedText;
  }

  if(typeof data.message === "string" && !looksLikeOpenClawTaskMetadata(data)){
    return data.message;
  }

  return "";
}

function readStreamChunk(value){

  if(value === "[DONE]"){
    return { done:true, text:"" };
  }

  try{
    const data = JSON.parse(value);
    return {
      done:false,
      text:extractStreamTextFromData(data)
    };
  }catch(err){
    return { done:false, text:"" };
  }
}

function parseSseEvent(event){
  const parsed = {
    type:"message",
    data:""
  };
  const dataLines = [];

  event.split("\\n").forEach(line => {
    if(line.startsWith("event:")){
      parsed.type = line.slice(6).trim() || "message";
    }else if(line.startsWith("data:")){
      dataLines.push(line.slice(5).trimStart());
    }
  });

  parsed.data = dataLines.join("\\n");
  return parsed;
}

async function handleStreamEvent(eventText, state, element){
  const event = parseSseEvent(eventText);

  if(event.type === "sources"){
    try{
      const data = JSON.parse(event.data || "{}");
      state.sources = Array.isArray(data.sources) ? data.sources : [];
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
    }catch(err){
      console.log("parse sources failed", err);
    }

    return false;
  }

  if(event.type === "tool_sources"){
    if(state.isOpenClawRequest){
      return false;
    }
    try{
      const data = JSON.parse(event.data || "{}");
      state.toolSources = Array.isArray(data.sources) ? data.sources : [];
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
    }catch(err){
      console.log("parse tool sources failed", err);
    }

    return false;
  }

  if(event.type === "tool_status"){
    if(state.isOpenClawRequest){
      return false;
    }
    try{
      handleToolStatus(JSON.parse(event.data || "{}"));
    }catch(err){
      console.log("parse tool status failed", err);
    }

    return false;
  }

  if(event.type === "tool_error"){
    if(state.isOpenClawRequest){
      return false;
    }
    try{
      state.toolError = JSON.parse(event.data || "{}");
      handleToolError(state.toolError);
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
    }catch(err){
      console.log("parse tool error failed", err);
    }

    return false;
  }

  if(event.type === "tool_debug"){
    if(state.isOpenClawRequest){
      return false;
    }
    try{
      state.toolDebug = JSON.parse(event.data || "{}");
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
    }catch(err){
      console.log("parse tool debug failed", err);
    }

    return false;
  }

  if(event.type === "status"){
    try{
      const data = JSON.parse(event.data || "{}");
      if(data.message){
        setContextStatus(data.message);
      }
    }catch(err){
      console.log("parse status failed", err);
    }

    return false;
  }

  if(event.type === "openclaw_task"){
    try{
      const data = JSON.parse(event.data || "{}");
      if(data?.id){
        state.openClawTask = data;
        mergeOpenClawTask(data);
      }
    }catch(err){
      console.log("parse OpenClaw task failed", err);
    }

    return false;
  }

  if(event.type === "fallback"){
    try{
      const data = JSON.parse(event.data || "{}");
      state.diagnostics.fallbacks.push(data);
      if(data.message){
        setContextStatus("Fallback: " + data.message);
      }
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
    }catch(err){
      console.log("parse fallback failed", err);
    }

    return false;
  }

  if(event.type === "provider_error"){
    try{
      state.diagnostics.providerError = JSON.parse(event.data || "{}");
      if(state.isOpenClawRequest
        && isOpenClawNetworkLost(state.diagnostics.providerError)
        && (isOpenClawProviderError(state.diagnostics.providerError) || !state.diagnostics.providerError.provider)){
        try{
          const resumeResult = await tryAutoResumeOpenClawTask({ element, state });
          if(resumeResult.handled){
            return true;
          }
        }catch(resumeErr){
          console.warn("OpenClaw auto resume failed", resumeErr);
        }
      }
      if(isOpenClawProviderError(state.diagnostics.providerError)
        || (state.isOpenClawRequest && isOpenClawNetworkLost(state.diagnostics.providerError))){
        state.reply = openClawFriendlyError(new Error(state.diagnostics.providerError.message || "Network connection lost"));
        state.openClawFriendlyError = true;
        setContextStatus(state.reply);
      }
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
    }catch(err){
      console.log("parse provider error failed", err);
    }

    return false;
  }

  if(event.type === "done"){
    try{
      const data = JSON.parse(event.data || "{}");
      state.diagnostics.done = data;
      state.modelMetadata = doneEventModelMetadata(data);
      const chunk = readStreamChunk(event.data);
      if(chunk.text && !state.openClawFriendlyError){
        state.reply += chunk.text;
      }
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics, state.modelMetadata);
    }catch(err){
      console.log("parse done failed", err);
    }

    return true;
  }

  if(event.data === "[DONE]"){
    return false;
  }

  const chunk = readStreamChunk(event.data);

  if(chunk.done){
    return false;
  }

  if(chunk.text){
    if(!state.openClawFriendlyError){
      state.reply += chunk.text;
    }
    renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
  }

  return false;
}

async function streamAIResponse(response, element, isOpenClawRequest = false){

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = {
    reply:"",
    sources:[],
    toolSources:[],
    toolError:null,
    toolDebug:null,
    diagnostics:{
      fallbacks:[],
      done:null,
      providerError:null
    },
    openClawFriendlyError:false,
    isOpenClawRequest:Boolean(isOpenClawRequest),
    openClawTask:null,
    openClawAutoResume:null,
    modelMetadata:null
  };

  while(true){

    const { value, done } = await reader.read();

    if(done){
      break;
    }

    buffer += decoder.decode(value, { stream:true });
    const events = buffer.split("\\n\\n");
    buffer = events.pop() || "";

    for(const event of events){
      if(await handleStreamEvent(event, state, element)){
        return state;
      }
    }
  }

  if(buffer.trim()){
    await handleStreamEvent(buffer, state, element);
  }

  return state;
}

async function sendMessage(){
  if(activeChatAbortController){
    return;
  }

  const message = input.value.trim();
  if(!allowOpenClawRepeatOnce && shouldInterceptOpenClawProgressMessage(message)){
    showOpenClawProgressIntercept();
    return;
  }
  const openClawRepeatAllowed = allowOpenClawRepeatOnce;
  allowOpenClawRepeatOnce = false;
  const imageToSend = selectedImage;
  const attachmentsToSend = pastedImageAttachments.slice();
  const legacyImageToSend = imageToSend || attachmentsToSend[0]?.dataUrl || null;
  const extraAttachmentsToSend = imageToSend ? attachmentsToSend : attachmentsToSend.slice(1);

  const fileToSend = selectedFile;
  const fileTextToSend = selectedFileText;
  let conversationAttachmentsToSend = pendingConversationAttachments.slice();
  const webPageToSend = selectedWebPage;

  if(conversationAttachmentsToSend.length && currentFileUseMode() === FILE_USE_SOURCE && selectedFileIds.length){
    const messageText = "原文附件与知识库文件暂不能在同一条消息中同时使用。";
    setContextStatus(messageText);
    alert(messageText);
    return;
  }

  if(conversationAttachmentsToSend.length){
    try{
      if(currentFileUseMode() === FILE_USE_LIBRARY){
        setContextStatus("正在存入文件库...");
        await storePendingAttachmentsInLibrary(conversationAttachmentsToSend);
        conversationAttachmentsToSend = [];
      }else{
        setContextStatus("原文附件上传中...");
        conversationAttachmentsToSend = await ensureConversationAttachmentsUploaded(conversationAttachmentsToSend);
      }
    }catch(err){
      const messageText = currentFileUseMode() === FILE_USE_LIBRARY
        ? "存入文件库失败: " + err.message
        : "原文附件上传失败: " + err.message;
      setContextStatus(messageText);
      alert(messageText);
      return;
    }
  }

  let fileTextForAI = fileTextToSend;
  let fileInfoForUI = null;
  let webTextForAI = "";
  let networkTextForAI = "";


  if(fileTextToSend && selectedFileChunks.length > 0){
    const relevantChunks = pickRelevantChunks(message || "请总结这个文件", selectedFileChunks);
    lastRelevantChunkCount = relevantChunks.length;
    fileTextForAI = relevantChunks.join(String.fromCharCode(10, 10));

    if(fileToSend){
      fileInfoForUI = {
        name: fileToSend.name,
        chars: selectedFileText.length,
        chunks: selectedFileChunks.length,
        usedChunks: lastRelevantChunkCount
      };
    }
  }

  if(webPageToSend && selectedWebPageChunks.length > 0){

    const relevantWebChunks = pickRelevantChunks(
      message || "请总结这个网页",
      selectedWebPageChunks
    );
  
    lastWebRelevantChunkCount = relevantWebChunks.length;
  
    webTextForAI =
      "Web page title: " + webPageToSend.title + String.fromCharCode(10) +
      "Web page URL: " + webPageToSend.url + String.fromCharCode(10, 10) +
      relevantWebChunks.join(String.fromCharCode(10, 10));
  }

  if(webSearchContext){

    networkTextForAI =
      "The following are web search page contents. Answer using these sources when relevant. " +
      String.fromCharCode(10, 10) +
      webSearchContext;
  }

  if(
    !message &&
    !imageToSend &&
    attachmentsToSend.length === 0 &&
    !fileTextToSend &&
    conversationAttachmentsToSend.length === 0 &&
    selectedFileIds.length === 0 &&
    !webTextForAI &&
    !networkTextForAI
  ){
    return;
  }

  const userMessageForRequest =
    message ||
    (conversationAttachmentsToSend.length ? "\u8bf7\u9605\u8bfb\u539f\u6587\u9644\u4ef6\u5e76\u56de\u7b54\u3002" :
    (selectedFileIds.length ? "\u8bf7\u57fa\u4e8e\u5df2\u9009\u62e9\u7684\u6587\u4ef6\u56de\u7b54\u3002" :
    (fileToSend ? "\u8bf7\u603b\u7ed3\u8fd9\u4e2a\u6587\u4ef6\u3002" :
    (webPageToSend ? "\u8bf7\u603b\u7ed3\u8fd9\u4e2a\u7f51\u9875\u3002" : (extraAttachmentsToSend.length ? "\u8bf7\u63cf\u8ff0\u8fd9\u4e9b\u56fe\u7247\u3002" : "\u8bf7\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\u3002")))));

  if(conversationAttachmentsToSend.length){
    fileInfoForUI = {
      attachments: conversationAttachmentsToSend
    };
  }

  const displayMessage = message || ((imageToSend || attachmentsToSend.length) ? "" : userMessageForRequest);
  addUserMessage(displayMessage, imageToSend, fileInfoForUI, extraAttachmentsToSend);

  conversation.push({
    role:"user",
    content:userMessageForRequest
  });

  input.value = "";
  resetInputHeight();

  const isOpenClawRequest = isSelectedOpenClawRequest(modelSelect.value);
  if(openClawRepeatAllowed){
    setContextStatus("Confirmed: started a new OpenClaw request.");
  }
  if(isOpenClawRequest){
    stopOpenClawReconnectPolling();
    openClawReconnectTask = null;
    activeChatAbortController = new AbortController();
  }

  sendBtn.disabled = true;
  sendBtn.textContent = SEND_BUTTON_TEXT;
  sendBtn.title = "";

  const aiDiv = addAIMessage();
  const toolCallForRequest = pendingToolCall || (webPageToSend ? {
    name:"fetch_url",
    args:{
      url:webPageToSend.url
    }
  } : null);

  aiDiv.innerHTML =
    "<span class='loading'>思考中...</span>";

  if(isOpenClawRequest){
    startOpenClawWaitHints(aiDiv);
  }

  if(imageToSend || attachmentsToSend.length){
    setContextStatus("\u56fe\u7247\u4e0a\u4f20\u4e2d...");
  }

  const retrievalFileIdsToSend = selectedFileIds;
  const conversationAttachmentIdsToSend = conversationAttachmentsToSend.map(item => item.id).filter(Boolean);
  const providersForRequest = modelProvidersForRequest(Boolean(conversationAttachmentIdsToSend.length));

  if(fileToSend && fileTextToSend){
    aiDiv.innerHTML =
      "<span class='loading'>正在基于 " + lastRelevantChunkCount + " 个相关片段回答...</span>";
  }else if(conversationAttachmentIdsToSend.length){
    aiDiv.innerHTML =
      "<span class='loading'>正在读取原文附件...</span>";
  }

  let openClawAsyncHandled = false;

  try{
    const fallbackModel = modelSettingsState?.fallbackModels?.[0] || "";
    let selectedModelConfig = getModelConfigForRequest(modelSelect.value);
    if(conversationAttachmentIdsToSend.length && selectedModelConfig){
      selectedModelConfig = {
        ...selectedModelConfig,
        capabilities:{
          text:true,
          streaming:true,
          ...(selectedModelConfig.capabilities || {}),
          cloudflareDocumentAttachment:true
        }
      };
    }
    const fallbackModelConfig = getModelConfigForRequest(fallbackModel);
    const selectedOpenClawRuntimeId = getOpenClawRuntimeIdForRequest(modelSelect.value);
    console.log("[phase10.3] frontend image count", (legacyImageToSend ? 1 : 0) + extraAttachmentsToSend.length);

    const res = await fetch("/", {

      method:"POST",

      headers:{
        "Content-Type":"application/json; charset=utf-8"
      },

      signal:activeChatAbortController?.signal,

      body:JSON.stringify({
        project_id:activeProjectId || DEFAULT_PROJECT_ID,
        conversationId:currentConversationId,
        messages:[
          {
            role:"user",
            content:userMessageForRequest
          }
        ],
        model:modelSelect.value,
        provider:getSelectedProviderForRequest(modelSelect.value),
        runtime_id:selectedOpenClawRuntimeId || undefined,
        providers:providersForRequest,
        autoFallbackEnabled:Boolean(modelSettingsState?.fallbackEnabled),
        fallbackModel,
        customModelConfig:selectedModelConfig,
        fallbackCustomModelConfig:fallbackModelConfig,
        toolCall:toolCallForRequest,
        debugTools:localStorage.getItem("wa_tool_debug") === "1",
        image:legacyImageToSend,
        attachments:extraAttachmentsToSend.length ? extraAttachmentsToSend : undefined,
        fileIds:retrievalFileIdsToSend.length ? retrievalFileIdsToSend : undefined,
        conversationAttachmentIds:conversationAttachmentIdsToSend.length ? conversationAttachmentIdsToSend : undefined,
        draftId:conversationAttachmentIdsToSend.length ? conversationAttachmentDraftId : undefined,
        file:fileToSend && fileTextToSend ? {
          id:selectedFileId || undefined,
          name:fileToSend.name,
          type:fileToSend.type,
          text:fileTextForAI
        } : (webTextForAI ? {
          name:webPageToSend.title,
          type:"webpage",
          text:webTextForAI
        } : (networkTextForAI ? {
          name:"联网搜索结果",
          type:"web-search",
          text:networkTextForAI
        } : null))
      })
    });

    if(!res.ok){
      const errorText = await res.text().catch(() => "");
      throw new Error(errorText || "HTTP " + res.status);
    }

    const responseConversationId = res.headers.get("X-Conversation-Id");

    if(responseConversationId){
      currentConversationId = responseConversationId;
      setActiveConversation();
    }

    const responseContentType = res.headers.get("Content-Type") || "";
    if(isOpenClawRequest && responseContentType.includes("application/json")){
      const data = await res.json();
      if(data.async){
        if(!data.ok){
          throw new Error(data.error || "OpenClaw async task submit failed");
        }
        openClawAsyncHandled = true;
        if(data.conversationId){
          currentConversationId = data.conversationId;
          setActiveConversation();
        }
        if(data.task){
          mergeOpenClawTask(data.task);
          activeOpenClawTask = data.task;
        }
        if(data.completed){
          setContextStatus("OpenClaw task completed.");
          await loadConversationMessages(currentConversationId);
        }else{
          renderAssistantMarkdown(aiDiv, "OpenClaw task submitted and running in the background.");
          setContextStatus("OpenClaw task submitted. Waiting for remote result...");
          if(data.taskId){
            openClawReconnectTask = data.task || activeOpenClawTask;
            startOpenClawBridgeEventStream(data.taskId, aiDiv, data.task || activeOpenClawTask);
            startOpenClawReconnectPolling(data.taskId);
          }
        }
      }
    }

    if(!openClawAsyncHandled){
      aiDiv.innerHTML = "";

      const streamResult = await streamAIResponse(res, aiDiv, isOpenClawRequest);
      const reply = streamResult.reply || "";

      if(!reply && !streamResult.openClawAutoResume?.handled){
        renderAssistantMarkdown(aiDiv, "没有返回内容");
      }

      if(!streamResult.openClawAutoResume?.handled){
        conversation.push({
          role:"assistant",
          content:reply || "",
          metadata:streamResult.modelMetadata || null,
          sources:streamResult.sources || [],
          toolSources:streamResult.toolSources || []
        });
      }
    }
    webSearchContext = "";
    webSearchSources = [];
    restoreConversationAfterNewMessage(currentConversationId);
    await loadConversations({
      clearMissingCurrent:false
    });
    await loadSummaryStatus();

    if(imageToSend){
      clearSelectedImage();
    }

    if(attachmentsToSend.length){
      clearPastedImageAttachments();
    }

    if(conversationAttachmentsToSend.length){
      clearSelectedFile();
    }

    const currentContextStatus = getCurrentContextStatus();

    if(openClawAsyncHandled){
      // Keep async task status visible while polling continues.
    }else if(currentContextStatus){
      setContextStatus(currentContextStatus);
    }else if(!networkTextForAI){
      setContextStatus("");
    }

  }catch(err){
    let openClawAutoResumeHandled = false;
    if(isOpenClawRequest && err?.name !== "AbortError" && isOpenClawNetworkLost(err)){
      try{
        const resumeResult = await tryAutoResumeOpenClawTask({ element:aiDiv });
        openClawAutoResumeHandled = Boolean(resumeResult.handled);
      }catch(resumeErr){
        console.warn("OpenClaw auto resume failed", resumeErr);
      }
    }

    if(!openClawAutoResumeHandled && isOpenClawRequest && activeOpenClawTask?.id && err?.name !== "AbortError"){
      mergeOpenClawTask({
        ...activeOpenClawTask,
        status:"disconnected",
        updatedAt:Date.now(),
        error:err?.message || "Connection interrupted"
      });
    }

    if(!openClawAutoResumeHandled){
      aiDiv.innerHTML =
        isOpenClawRequest ? openClawFriendlyError(err) : "Request failed: " + err.message;
    }

    if(isOpenClawRequest && !openClawAutoResumeHandled){
      setContextStatus(openClawFriendlyError(err));
    }

    if(imageToSend && !openClawAutoResumeHandled){
      setContextStatus("\u56fe\u7247\u53d1\u9001\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5");
    }

    if(attachmentsToSend.length && !openClawAutoResumeHandled){
      setContextStatus("\u56fe\u7247\u53d1\u9001\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5");
    }

    if(fileToSend && !openClawAutoResumeHandled){
      setContextStatus("\u6587\u4ef6\u95ee\u7b54\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5\uff1a" + fileToSend.name);
    }

    if(conversationAttachmentsToSend.length && !openClawAutoResumeHandled){
      setContextStatus("\u539f\u6587\u9644\u4ef6\u53d1\u9001\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5");
    }
  }

  clearOpenClawWaitTimers();
  activeChatAbortController = null;
  sendBtn.disabled = false;
  sendBtn.textContent = SEND_BUTTON_TEXT;
  sendBtn.title = "";

  input.focus();
}

</script>

</body>
</html>`;
}

