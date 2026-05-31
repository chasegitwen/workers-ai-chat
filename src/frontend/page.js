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
  background:linear-gradient(135deg,var(--bg),#ffffff);
  color:var(--text);
}

body.dark{
  background:linear-gradient(135deg,#020617,#0f172a);
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
  border-bottom:1px solid var(--border);
  box-shadow:0 2px 12px rgba(0,0,0,.06);
}

.brand{
  font-size:20px;
  font-weight:700;
}

.brand span{
  color:var(--primary);
}

.themeBtn{
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:999px;
  padding:6px 12px;
  cursor:pointer;
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
  gap:14px;
  padding:12px 14px 14px;
  overflow:hidden;
}

.sidebar{
  height:100%;
  min-height:0;
  overflow:hidden;
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:22px;
  padding:22px;
  box-shadow:0 8px 28px rgba(0,0,0,.08);

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

.modelArea{
  flex:0 0 auto;
  padding-top:12px;
  border-top:1px solid var(--border);
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
  font-size:13px;
}

.newChatBtn{
  width:100%;
  border:none;
  background:var(--primary);
  color:white;
  border-radius:14px;
  padding:10px 12px;
  font-size:14px;
  cursor:pointer;
  margin-bottom:12px;
  flex:0 0 auto;
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

.historyRow{
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

.historyItem{
  min-width:0;
  flex:1;
  width:100%;
  border:none;
  background:transparent;
  color:var(--text);
  border-radius:0;
  padding:7px 0;
  font-size:13px;
  text-align:left;
  cursor:pointer;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.historyItem.active{
  background:transparent;
  color:var(--primary);
  font-weight:600;
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

.deleteConversationBtn{
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

.historyRow:hover .deleteConversationBtn{
  display:flex;
}

.deleteConversationBtn:hover{
  color:white;
  background:#dc2626;
}

.libraryPanel{
  flex:0 0 auto;
  min-height:0;
  max-height:none;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);
  padding:12px 0;
  margin:0 0 14px;
}

.libraryPanel.collapsed{
  max-height:48px;
  padding:8px 0;
}

.libraryHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-bottom:0;
  padding:2px 0;
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
  font-size:14px;
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
  margin-top:8px;
  overflow:hidden;
}

.libraryPanel.expanded .libraryBody{
  display:flex;
}

.libraryHeader strong{
  font-size:14px;
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
  gap:8px;
  flex:0 1 auto;
  min-height:120px;
  max-height:420px;
  overflow-y:auto;
}

.fileLibraryItem{
  border:1px solid var(--border);
  border-radius:12px;
  padding:9px;
  background:transparent;
}

.fileLibraryItem.selected{
  border-color:var(--primary);
  background:rgba(37,99,235,.08);
}

.fileLibraryName{
  color:var(--text);
  font-size:13px;
  font-weight:600;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.fileLibraryMeta{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.fileLibraryActions{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-top:8px;
}

.fileLibraryActions button{
  flex:1;
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:10px;
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
  border:1px solid var(--border);
  border-radius:22px;
  overflow:hidden;
  box-shadow:0 8px 28px rgba(0,0,0,.08);
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
  width:min(240px,32vw);
  min-width:150px;
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

.browserToolBtn:disabled{
  opacity:.6;
  cursor:not-allowed;
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
  flex:0 0 auto;
  color:var(--text);
  font-variant-numeric:tabular-nums;
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

  .sidebar{
    display:none;
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
      <label class="settingsCheck">
        <input id="rememberLastModelCheck" type="checkbox" />
        记住上次选择
      </label>
      <label class="settingsCheck">
        <input id="fallbackEnabledCheck" type="checkbox" />
        自动 fallback
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
      <button id="logoutBtn" class="themeBtn" type="button">Logout</button>
      <button class="themeBtn" onclick="toggleTheme()">深色 / 浅色</button>
    </div>
  </div>

  <div class="main">

    <aside class="sidebar">

      <button id="newChatBtn" class="newChatBtn" type="button">
        New Chat
      </button>

      <div class="sidebarMain">

        <div id="conversationList" class="historyList"></div>

        <div id="libraryPanel" class="libraryPanel collapsed">
          <div id="libraryToggle" class="libraryHeader" role="button" tabindex="0" aria-expanded="false">
            <div class="libraryTitle">
              <span aria-hidden="true">&#x1F4C1;</span>
              <strong>&#x6587;&#x4EF6;&#x5E93;&#xFF08;<span id="fileLibraryCount">0</span>&#xFF09;</strong>
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
    accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    hidden
  />

  <div id="contextStatus"></div>

  <div id="pastedImageNotice"></div>

  <div id="pastedImagePreviewList"></div>

  <div class="inputShell">

    <div class="inputActions">
      <div class="inputMenuWrap">
        <button id="attachmentMenuBtn" class="menuButton" type="button" aria-haspopup="menu" aria-expanded="false" title="&#x6DFB;&#x52A0;&#x9644;&#x4EF6;">+</button>
        <div id="attachmentMenu" class="inputMenu" role="menu">
          <button id="fileBtn" type="button" role="menuitem">&#x4E0A;&#x4F20;&#x6587;&#x4EF6;</button>
          <button id="imageBtn" type="button" role="menuitem">&#x4E0A;&#x4F20;&#x56FE;&#x7247;</button>
        </div>
      </div>
    </div>

    <textarea
      id="input"
      placeholder="&#x8F93;&#x5165;&#x95EE;&#x9898;&#x3001;&#x641C;&#x7D22;&#x5173;&#x952E;&#x8BCD;&#x6216;&#x7F51;&#x9875; URL..."
      rows="1"
    ></textarea>

    <div class="inputPrimaryActions">
      <input id="browserToolUrlInput" class="browserToolInput" type="url" placeholder="https://example.com" />
      <button id="browserToolBtn" class="browserToolBtn" type="button">Browser</button>

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

    <div id="fileStatus"></div>

    <button id="clearFileBtn" type="button">&#x6E05;&#x9664;</button>

    <div id="uploadStatus"></div>

  </div>

</div>

    </section>

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
const newChatBtn = document.getElementById("newChatBtn");
const conversationList = document.getElementById("conversationList");
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
const attachmentMenuBtn = document.getElementById("attachmentMenuBtn");
const attachmentMenu = document.getElementById("attachmentMenu");

const contextStatus = document.getElementById("contextStatus");

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
const WELCOME_HIDDEN_KEY = "welcome_hidden";
syncWelcomeVisibility();

const fetchUrlBtn = document.getElementById("fetchUrlBtn");
const browserToolUrlInput = document.getElementById("browserToolUrlInput");
const browserToolBtn = document.getElementById("browserToolBtn");

let selectedWebPage = null;
let selectedWebPageChunks = [];
let lastWebRelevantChunkCount = 0;

const sendBtn = document.getElementById("sendBtn");
const INPUT_MAX_HEIGHT = 180;

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
const clearFileBtn = document.getElementById("clearFileBtn");

let selectedFile = null;
let selectedFileId = null;
let selectedFileText = "";
let selectedFileChunks = [];
let lastRelevantChunkCount = 0;
let filesLibrary = [];
let selectedFileIds = [];
let fileLibraryQuery = "";
let fileLibrarySort = "latest";
let isFileLibraryExpanded = false;
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
        "Content-Type":"application/json"
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
        option.textContent = (model.label || model.id) + (model.recommended ? " · 推荐" : "");
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
    customModels:Array.isArray(base.customModels) ? base.customModels : [],
    customProviders:Array.isArray(base.customProviders) ? base.customProviders : [],
    providers:Array.isArray(base.providers) && base.providers.length ? base.providers : fallbackProviders
  };
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
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ settings })
    });
    if(!res.ok) throw new Error(await res.text());
    settingsSyncStatus.textContent = "已同步";
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
      empty.textContent = "不使用";
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
    const item = document.createElement("div");
    item.className = "fileLibraryItem" + (selected ? " selected" : "");

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
    selectBtn.addEventListener("click", () => toggleLibraryFile(file.id));

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.textContent = expandedFileId === file.id ? "\u6536\u8d77" : "\u8be6\u60c5";
    detailBtn.addEventListener("click", () => toggleFileDetails(file.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "deleteFileAction";
    deleteBtn.textContent = "\u5220\u9664";
    deleteBtn.addEventListener("click", () => deleteLibraryFile(file.id, file.filename || "file"));

    actions.appendChild(selectBtn);
    actions.appendChild(detailBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(actions);

    if(expandedFileId === file.id){
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

function clearSelectedFile(){

  const fileIdToClear = selectedFileId;
  selectedFile = null;
  selectedFileId = null;
  selectedFileIds = selectedFileIds.filter(id => id !== fileIdToClear);
  selectedFileText = "";
  selectedFileChunks = [];
  lastRelevantChunkCount = 0;
  fileInput.value = "";
  fileStatus.textContent = "";
  renderFilesLibrary();
  setContextStatus(getCurrentContextStatus());
  clearFileBtn.style.display = "none";
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
        "Content-Type":"application/json"
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
    alert("搜索失败：" + err.message);

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

  if(value.startsWith("data:image/") || /^https?:\/\//i.test(value)){
    return value;
  }

  return "data:image/png;base64," + value;
}

function renderBrowserToolResult(data, requestedUrl){
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
    ? [(data.title || "Untitled"), (data.url || requestedUrl)].filter(Boolean).join(" - ")
    : (data?.error || "Browser request failed");
  box.appendChild(meta);

  const text = String(data?.text || data?.extractedText || data?.details || "").trim();
  if(text){
    const preview = document.createElement("div");
    preview.className = "sourceCitationPreview active";
    preview.style.marginTop = "10px";
    preview.textContent = text.slice(0, 2500);
    box.appendChild(preview);
  }

  const screenshot = normalizeBrowserScreenshot(data);
  if(screenshot){
    const img = document.createElement("img");
    img.className = "userImage";
    img.src = screenshot;
    img.alt = "Browser screenshot";
    img.style.marginTop = "10px";
    box.appendChild(img);
  }

  chat.appendChild(box);
  scrollBottom();
}

async function runBrowserTool(){
  const url = browserToolUrlInput.value.trim() || input.value.trim();

  if(!url){
    alert("Please enter a URL for Browser.");
    return;
  }

  browserToolBtn.disabled = true;
  browserToolBtn.textContent = "Browsing...";
  setContextStatus("Browser tool is running...");

  try{
    const res = await fetch("/api/browser", {
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        url,
        mode:"full"
      })
    });
    const data = await res.json();
    renderBrowserToolResult(data, url);

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
    }, url);
    setContextStatus("Browser tool failed");
  }finally{
    browserToolBtn.disabled = false;
    browserToolBtn.textContent = "Browser";
  }
}

clearFileBtn.addEventListener("click", clearSelectedFile);

searchBtn.addEventListener("click", () => {
  closeInputMenus();
  searchWeb();
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
        "Content-Type":"application/json"
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
        "【来源 " + (index + 1) + "】",
        "标题：" + page.title,
        "URL：" + page.url,
        "摘要：" + (page.description || ""),
        "正文片段：",
        page.text
      ].join(String.fromCharCode(10));
    }).join(String.fromCharCode(10, 10));

    setContextStatus(
      "\u8054\u7f51\u5b8c\u6210\uff1a\u627e\u5230 " + (data.results || []).length +
      " \u6761\u7ed3\u679c\uff0c\u6210\u529f\u6293\u53d6 " + webSearchSources.length + " \u4e2a\u7f51\u9875"
    );

    if(!webSearchContext){
      alert("搜索到了结果，但网页正文抓取失败。可以先用搜索结果手动抓取。");
      return;
    }

    await sendMessage();

  }catch(err){

    setContextStatus("\u8054\u7f51\u56de\u7b54\u5931\u8d25");
    alert("联网回答失败：" + err.message);

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
    alert("请先输入网页 URL");
    return;
  }

  if(!/^https?:\\/\\//i.test(pageUrl)){
    alert("网址必须以 http:// 或 https:// 开头");
    return;
  }

  fetchUrlBtn.disabled = true;
  fetchUrlBtn.textContent = "\u6293\u53d6\u4e2d...";
  setContextStatus("\u6b63\u5728\u6293\u53d6\u7f51\u9875...");

  try{

    const res = await fetch("/fetch-url", {
      method:"POST",
      headers:{
        "Content-Type":"application/json"
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
    alert("网页抓取失败：" + err.message);

  }

  fetchUrlBtn.disabled = false;
  fetchUrlBtn.textContent = "\u6293\u53d6\u7f51\u9875";
}

async function extractPdfText(file){
  if (!window.pdfjsLib) {
    throw new Error("pdf.js 没有加载成功，请检查 CDN 是否可访问");
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

    fullText += String.fromCharCode(10, 10) + "--- 第 " + pageNum + " 页 ---" + String.fromCharCode(10) + pageText;
  }

  return fullText.trim();
}

async function extractDocxText(file){
  
  if (!window.mammoth) {
    throw new Error("mammoth.js 没有加载成功，请检查 CDN 是否可访问");
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
    .split(/[\\s,.;:!?，。；：！？、()（）\\[\\]{}'"“”‘’]+/)
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
    .map(item => "【片段 " + (item.index + 1) + "】" + String.fromCharCode(10) + item.chunk);

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

  const file = fileInput.files[0];

  if (!file) return;

  const name = file.name.toLowerCase();

  const isTextFile =
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown");

  const isPdfFile = name.endsWith(".pdf");

  const isDocxFile = name.endsWith(".docx");

  if (!isTextFile && !isPdfFile && !isDocxFile) {
    alert("当前支持 TXT / Markdown / PDF / DOCX 文件");
    fileInput.value = "";
    return;
  }

  const previousFile = selectedFile;
  const previousFileId = selectedFileId;
  const previousFileText = selectedFileText;
  const previousFileChunks = selectedFileChunks;
  const previousRelevantChunkCount = lastRelevantChunkCount;

  try{

    selectedFile = file;
    selectedFileId = null;
    selectedFileText = "";
    setContextStatus("\u6b63\u5728\u8bfb\u53d6\uff1a" + file.name);

    if(isPdfFile){

      selectedFileText = await extractPdfText(file);

    }else if(isDocxFile){
      selectedFileText = await extractDocxText(file);
    }else{

      selectedFileText = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result || "");
        reader.onerror = () => reject(new Error("文件读取失败"));

        reader.readAsText(file, "utf-8");
      });
    }

    if(!selectedFileText.trim()){
      throw new Error("没有提取到文本内容");
    }
    selectedFileChunks = splitTextIntoChunks(selectedFileText);
    const savedFile = await uploadFileToLibrary(file, selectedFileText);
    selectedFileId = savedFile.id;
    filesLibrary = [
      {
        ...savedFile,
        conversation_id: currentConversationId || null,
        chunk_count: Number(savedFile.chunk_count || 0)
      },
      ...filesLibrary.filter(item => item.id !== savedFile.id)
    ];
    selectedFileIds = [
      savedFile.id,
      ...selectedFileIds.filter(id => id !== savedFile.id)
    ];
    renderFilesLibrary();
    clearFileBtn.style.display = "inline-block";
    setContextStatus(
      "\u6587\u4ef6\u5df2\u4fdd\u5b58\u5230\u6587\u4ef6\u5e93\uff0c\u5e76\u5df2\u9009\u62e9"
    );

  }catch(err){

    alert("文件读取失败：" + err.message);

    selectedFile = previousFile;
    selectedFileId = previousFileId;
    selectedFileText = previousFileText;
    selectedFileChunks = previousFileChunks;
    lastRelevantChunkCount = previousRelevantChunkCount;
    fileInput.value = "";
    clearFileBtn.style.display = previousFile ? "inline-block" : "none";
    renderFilesLibrary();
    setContextStatus(getCurrentContextStatus());
  }
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
const rememberLastModelCheck = document.getElementById("rememberLastModelCheck");
const fallbackEnabledCheck = document.getElementById("fallbackEnabledCheck");
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

const conversation = [
  {
    role:"system",
    content:"你是一个网页 AI 助手，请简洁、准确、友好地回答。可以使用 Markdown。"
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
  closeSettingsBtn.textContent = "×";
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
    "<button id='editDialogCloseBtn' class='settingsIconBtn' type='button' aria-label='Close'>×</button>",
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

  if(nextDefault && hasModel(nextDefault)){
    modelSelect.value = nextDefault;
  }

  if(modelSettingsState.rememberLastModel && nextDefault){
    modelSettingsState.lastModel = nextDefault;
  }else{
    modelSettingsState.lastModel = "";
  }

  persistSettings(closeAfter ? "已保存" : "已应用", Boolean(closeAfter));
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
    settingsSyncStatus.textContent = "provider 已存在";
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
  saveCurrentSettings("已添加模型");
}

function removeProvider(providerId){
  modelProviders = modelProviders.filter(provider => provider.id !== providerId);
  saveCurrentSettings("已删除 provider");
}

function removeProviderModel(providerId, modelId){
  const provider = getProvider(providerId);
  if(!provider) return;
  provider.models = (provider.models || []).filter(model => model.id !== modelId);
  saveCurrentSettings("已删除模型");
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

  if(nextDefault && hasModel(nextDefault)){
    modelSelect.value = nextDefault;
  }
  modelSettingsState.lastModel = modelSettingsState.rememberLastModel && nextDefault ? nextDefault : "";
  persistSettings(closeAfter ? "已保存" : "已应用", Boolean(closeAfter));
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
    settingsSyncStatus.textContent = "provider id 和名称不能为空";
    return;
  }
  if(modelProviders.some(provider => provider.id === id && provider.id !== editingProviderId)){
    settingsSyncStatus.textContent = "provider id 已存在";
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
    settingsSyncStatus.textContent = "同一 provider 下 model id 不能重复";
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
  refreshDraftSettings(editingModelRef ? "已更新模型" : "已添加模型");
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
  refreshDraftSettings("已删除模型");
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
    const res = await fetch("/api/settings", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ settings })
    });
    if(!res.ok){
      throw new Error(await res.text());
    }
    settingsSyncStatus.textContent = "已同步";
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
  if(nextDefault && hasModel(nextDefault)){
    modelSelect.value = nextDefault;
  }
  modelSettingsState.lastModel = modelSettingsState.rememberLastModel && nextDefault ? nextDefault : "";
  persistSettings(closeAfter ? "已保存" : "已应用", Boolean(closeAfter));
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
    settingsSyncStatus.textContent = "provider id 和名称不能为空";
    return;
  }
  if(modelProviders.some(provider => provider.id === id && provider.id !== editingProviderId)){
    settingsSyncStatus.textContent = "provider id 已存在";
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
    settingsSyncStatus.textContent = "同一 provider 下 model id 不能重复";
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
  refreshDraftSettings(wasEditing ? "已更新模型" : "已添加模型");
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
  refreshDraftSettings("已删除模型");
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
    settingsSyncStatus.textContent = "provider id 和名称不能为空";
    return;
  }

  if(modelProviders.some(provider => provider.id === id)){
    settingsSyncStatus.textContent = "provider id 已存在";
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
    settingsSyncStatus.textContent = "同一 provider 下 model id 不能重复";
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
    settingsSyncStatus.textContent = "provider id 已存在";
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
    settingsSyncStatus.textContent = "同一 provider 下 model id 不能重复";
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
  persistSettings("已删除模型", false);
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
  { type:"workers-hosted", label:"Workers 托管", hint:"直接托管在 Cloudflare Workers AI 的模型" },
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
  normalized.models = (provider.models || [])
    .map(model => normalizeManagedModel(model, normalized, categoryType))
    .filter(Boolean);
  return normalized;
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
    categories,
    modelCategories:categories,
    providers
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
      empty.textContent = "不使用";
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
    settingsSyncStatus.textContent = "provider id 和名称不能为空";
    return;
  }
  if(providerType !== "claude-compatible" && providerType !== "openai-compatible"){
    settingsSyncStatus.textContent = "请选择 Claude 兼容或 OpenAI 兼容 provider";
    return;
  }
  if(modelProviders.some(provider => provider.id === providerId)){
    settingsSyncStatus.textContent = "provider id 已存在";
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
      settingsSyncStatus.textContent = "同一 provider 下 model id 不能重复";
      return;
    }
    found.provider.models = found.provider.models || [];
    found.provider.models.push(model);
  }
  clearModelForm();
  persistSettings("已添加模型", false);
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
    "<label class='settingsCheck'><input id='editProviderEnabled' type='checkbox' /> enabled</label>"
  ].join("");
  dialog.body.querySelector("#editProviderLabel").value = provider.providerName || provider.providerId;
  dialog.body.querySelector("#editProviderId").value = provider.providerId;
  dialog.body.querySelector("#editProviderType").value = found.category.type;
  dialog.body.querySelector("#editProviderBaseUrl").value = provider.baseUrl || "";
  dialog.body.querySelector("#editProviderApiKeyEnv").value = provider.apiKeyEnv || "";
  dialog.body.querySelector("#editProviderEnabled").checked = provider.enabled !== false;
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
  if(!providerName || !providerId){
    settingsSyncStatus.textContent = "provider id 和 name 不能为空";
    return;
  }
  if(modelProviders.some(provider => provider.id === providerId && provider.id !== originalId)){
    settingsSyncStatus.textContent = "provider id 已存在";
    return;
  }
  found.category.providers = (found.category.providers || []).filter(provider => provider.providerId !== originalId);
  const nextProvider = {
    ...found.provider,
    providerName,
    providerId,
    baseUrl,
    apiKeyEnv,
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
    settingsSyncStatus.textContent = "同一分组下 model id 不能重复";
    return;
  }
  model.displayName = displayName;
  model.modelId = modelId;
  model.upstreamModelName = upstreamModelName;
  model.enabled = enabled;
  model.notes = notes;
  updateModelReferences(originalModelId, modelId);
  closeEditDialog();
  persistSettings("已更新模型", false);
}

function removeProvider(providerId, skipDialogClose){
  const found = getManagedProvider(providerId);
  if(!found){
    return;
  }
  if(!confirm("确定删除 provider " + (found.provider.providerName || found.provider.providerId) + " 吗？其下模型会同时删除。")){
    return;
  }
  found.category.providers = (found.category.providers || []).filter(provider => provider.providerId !== providerId);
  pruneInvalidModelReferences();
  if(skipDialogClose){
    closeEditDialog();
  }
  persistSettings("已删除 provider", false);
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
  persistSettings("已删除模型", false);
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

function healthIcon(result){
  if(result.ok){
    return "✅";
  }
  const status = String(result.status || "");
  return status === "429" ? "⚠️" : "❌";
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
    status.textContent = result.ok
      ? healthIcon(result) + " " + formatHealthLatency(result.latencyMs)
      : healthIcon(result) + " " + (result.status || "error");
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
      throw new Error(data.error || "模型健康检查失败");
    }
    modelHealthCache = data.results || [];
    renderModelHealthResults(modelHealthCache);
  }catch(err){
    modelHealthCache = [];
    withModelHealthScrollPreserved(() => {
      modelHealthResults.innerHTML = "";
      const item = document.createElement("div");
      item.className = "modelHealthItem";
      item.textContent = err.message || "模型健康检查失败";
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
  button.textContent = "⋯";
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
    "<label class='settingsCheck'><input id='newProviderEnabled' type='checkbox' checked /> enabled</label>"
  ].join("");
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
  if(!providerName || !providerId){
    settingsSyncStatus.textContent = "provider id 和名称不能为空";
    return;
  }
  if(modelProviders.some(provider => provider.id === providerId)){
    settingsSyncStatus.textContent = "provider id 已存在";
    return;
  }
  getCategory(categoryType).providers.push({
    providerName,
    providerId,
    baseUrl,
    apiKeyEnv,
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
      settingsSyncStatus.textContent = "同一 provider 下 model id 不能重复";
      return;
    }
    found.provider.models = found.provider.models || [];
    found.provider.models.push(model);
  }
  closeEditDialog();
  persistSettings("已添加模型", false);
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
  conversationList.querySelectorAll(".historyItem").forEach(item => {
    item.classList.toggle("active", item.dataset.id === currentConversationId);
  });
  conversationList.querySelectorAll(".historyRow").forEach(row => {
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
    alert("当前会话还没有摘要。");
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
  currentConversationId = null;
  resetLocalConversation();
  resetChatView();
  resetTransientContext();
  setSummaryStatus(false);
  setActiveConversation();
}

async function loadConversations(){
  try{
    const res = await fetch("/api/conversations");
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "加载会话失败");
    }

    conversationsCache = data.conversations || [];
    conversationList.innerHTML = "";

    conversationsCache.forEach(item => {
      const row = document.createElement("div");
      row.className = "historyRow";
      row.dataset.id = item.id;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "historyItem";
      btn.dataset.id = item.id;
      btn.textContent = item.title || "New Chat";
      btn.title = item.last_message_preview
        ? btn.textContent + "\\n" + item.last_message_preview
        : btn.textContent;
      btn.addEventListener("click", () => loadConversationMessages(item.id));

      const time = document.createElement("span");
      time.className = "historyTime";
      time.textContent = formatHistoryTime(item.updated_at || item.created_at);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "deleteConversationBtn";
      deleteBtn.textContent = "×";
      deleteBtn.title = "删除会话";
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteConversation(item.id, item.title || "New Chat");
      });

      row.appendChild(btn);
      row.appendChild(time);
      row.appendChild(deleteBtn);
      conversationList.appendChild(row);
    });

    setActiveConversation();
    return conversationsCache;
  }catch(err){
    console.log("load conversations failed", err);
    return conversationsCache;
  }
}

async function createNewConversation(){
  enterBlankChat();
}

async function deleteConversation(conversationId, title){
  if(!confirm("确定删除会话“" + title + "”吗？")){
    return;
  }

  try{
    const deletingCurrent = conversationId === currentConversationId;
    const res = await fetch("/api/conversations/" + encodeURIComponent(conversationId), {
      method:"DELETE"
    });
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "删除会话失败");
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
    alert("删除会话失败：" + err.message);
  }
}

function renderHistoryMessage(message){
  const div = document.createElement("div");
  div.className = message.role === "user" ? "msg user" : "msg ai";

  if(message.role === "assistant"){
    renderAssistantMarkdown(div, message.content || "");
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
          content:message.content || ""
        });
      }
    });

    setActiveConversation();
    setContextStatus(getCurrentContextStatus());
    await loadSummaryStatus();
    scrollBottom();
  }catch(err){
    alert("加载会话失败：" + err.message);
  }
}

input.addEventListener("keydown", e => {

  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }

});
input.addEventListener("input", autoResizeInput);
input.addEventListener("paste", handleImagePaste);

sendBtn.addEventListener("click", sendMessage);
newChatBtn.addEventListener("click", createNewConversation);
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
  closeModelActionMenus();
});
document.addEventListener("keydown", event => {
  if(event.key === "Escape"){
    closeInputMenus();
  }
});
document.addEventListener("paste", event => {
  if(event.target === input){
    return;
  }

  if(document.activeElement === input || event.target?.closest?.(".inputBar")){
    handleImagePaste(event);
  }
});
loginForm.addEventListener("submit", login);
logoutBtn.addEventListener("click", logout);
window.addEventListener("load", refreshRenderedMath);
setFileLibraryExpanded(false);
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
  button.textContent = "已复制";
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
    img.alt = "上传的图片";
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
    fileDiv.textContent = "?? " + fileInfo.name + " · " + fileInfo.chars + " 字符 · " + fileInfo.chunks + " 段";
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

function renderAssistantMessage(element, text, sources, toolSources, toolError, toolDebug, diagnostics){
  renderAssistantMarkdown(element, text || "");
  renderToolError(element, toolError);
  renderToolDebug(element, toolDebug);
  renderModelDiagnostics(element, diagnostics);
  renderSources(element, sources);
  renderToolSources(element, toolSources);
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

function readStreamChunk(value){

  if(value === "[DONE]"){
    return { done:true, text:"" };
  }

  try{
    const data = JSON.parse(value);
    return {
      done:false,
      text:
        data.response ||
        data.result?.response ||
        data.output_text ||
        data.text ||
        data.choices?.[0]?.delta?.content ||
        data.choices?.[0]?.message?.content ||
        data.choices?.[0]?.text ||
        ""
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

function handleStreamEvent(eventText, state, element){
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
    try{
      handleToolStatus(JSON.parse(event.data || "{}"));
    }catch(err){
      console.log("parse tool status failed", err);
    }

    return false;
  }

  if(event.type === "tool_error"){
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
      renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
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
    state.reply += chunk.text;
    renderAssistantMessage(element, state.reply, state.sources, state.toolSources, state.toolError, state.toolDebug, state.diagnostics);
  }

  return false;
}

async function streamAIResponse(response, element){

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
    }
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
      if(handleStreamEvent(event, state, element)){
        return state;
      }
    }
  }

  if(buffer.trim()){
    handleStreamEvent(buffer, state, element);
  }

  return state;
}

async function sendMessage(){

  const message = input.value.trim();
  const imageToSend = selectedImage;
  const attachmentsToSend = pastedImageAttachments.slice();
  const legacyImageToSend = imageToSend || attachmentsToSend[0]?.dataUrl || null;
  const extraAttachmentsToSend = imageToSend ? attachmentsToSend : attachmentsToSend.slice(1);

  const fileToSend = selectedFile;
  const fileTextToSend = selectedFileText;
  const webPageToSend = selectedWebPage;

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
      "网页标题：" + webPageToSend.title + String.fromCharCode(10) +
      "网页 URL：" + webPageToSend.url + String.fromCharCode(10, 10) +
      relevantWebChunks.join(String.fromCharCode(10, 10));
  }

  if(webSearchContext){

    networkTextForAI =
      "下面是联网搜索得到的多个网页内容，请优先依据这些来源回答问题，并尽量综合多个来源的信息。" +
      String.fromCharCode(10, 10) +
      webSearchContext;
  }

  if(
    !message &&
    !imageToSend &&
    attachmentsToSend.length === 0 &&
    !fileTextToSend &&
    selectedFileIds.length === 0 &&
    !webTextForAI &&
    !networkTextForAI
  ){
    return;
  }

  const userMessageForRequest =
    message ||
    (fileToSend ? "\u8bf7\u603b\u7ed3\u8fd9\u4e2a\u6587\u4ef6\u3002" :
    (selectedFileIds.length ? "\u8bf7\u57fa\u4e8e\u5df2\u9009\u62e9\u7684\u6587\u4ef6\u56de\u7b54\u3002" :
    (webPageToSend ? "\u8bf7\u603b\u7ed3\u8fd9\u4e2a\u7f51\u9875\u3002" : (extraAttachmentsToSend.length ? "\u8bf7\u63cf\u8ff0\u8fd9\u4e9b\u56fe\u7247\u3002" : "\u8bf7\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\u3002"))));

  const displayMessage = message || ((imageToSend || attachmentsToSend.length) ? "" : userMessageForRequest);
  addUserMessage(displayMessage, imageToSend, fileInfoForUI, extraAttachmentsToSend);

  conversation.push({
    role:"user",
    content:userMessageForRequest
  });

  input.value = "";
  resetInputHeight();

  sendBtn.disabled = true;

  const aiDiv = addAIMessage();
  const toolCallForRequest = pendingToolCall || (webPageToSend ? {
    name:"fetch_url",
    args:{
      url:webPageToSend.url
    }
  } : null);

  aiDiv.innerHTML =
    "<span class='loading'>思考中...</span>";

  if(imageToSend || attachmentsToSend.length){
    setContextStatus("\u56fe\u7247\u4e0a\u4f20\u4e2d...");
  }

  if(fileToSend){
    aiDiv.innerHTML =
      "<span class='loading'>正在基于 " + lastRelevantChunkCount + " 个相关片段回答...</span>";
  }

  try{
    const fallbackModel = modelSettingsState?.fallbackModels?.[0] || "";
    const selectedModelConfig = getModelConfigForRequest(modelSelect.value);
    const fallbackModelConfig = getModelConfigForRequest(fallbackModel);
    console.log("[phase10.3] frontend image count", (legacyImageToSend ? 1 : 0) + extraAttachmentsToSend.length);

    const res = await fetch("/", {

      method:"POST",

      headers:{
        "Content-Type":"application/json"
      },

      body:JSON.stringify({
        conversationId:currentConversationId,
        messages:[
          {
            role:"user",
            content:userMessageForRequest
          }
        ],
        model:modelSelect.value,
        provider:getSelectedProviderForRequest(modelSelect.value),
        providers:modelProviders,
        autoFallbackEnabled:Boolean(modelSettingsState?.fallbackEnabled),
        fallbackModel,
        customModelConfig:selectedModelConfig,
        fallbackCustomModelConfig:fallbackModelConfig,
        toolCall:toolCallForRequest,
        debugTools:localStorage.getItem("wa_tool_debug") === "1",
        image:legacyImageToSend,
        attachments:extraAttachmentsToSend.length ? extraAttachmentsToSend : undefined,
        fileIds:selectedFileIds,
        file:fileToSend ? {
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

    aiDiv.innerHTML = "";

    const streamResult = await streamAIResponse(res, aiDiv);
    const reply = streamResult.reply || "";

    if(!reply){
      renderAssistantMarkdown(aiDiv, "没有返回内容");
    }

    conversation.push({
      role:"assistant",
      content:reply || "",
      sources:streamResult.sources || [],
      toolSources:streamResult.toolSources || []
    });
    webSearchContext = "";
    webSearchSources = [];
    await loadConversations();
    await loadSummaryStatus();

    if(imageToSend){
      clearSelectedImage();
    }

    if(attachmentsToSend.length){
      clearPastedImageAttachments();
    }

    const currentContextStatus = getCurrentContextStatus();

    if(currentContextStatus){
      setContextStatus(currentContextStatus);
    }else if(!networkTextForAI){
      setContextStatus("");
    }

  }catch(err){

    aiDiv.innerHTML =
      "请求失败：" + err.message;

    if(imageToSend){
      setContextStatus("\u56fe\u7247\u53d1\u9001\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5");
    }

    if(attachmentsToSend.length){
      setContextStatus("\u56fe\u7247\u53d1\u9001\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5");
    }

    if(fileToSend){
      setContextStatus("\u6587\u4ef6\u95ee\u7b54\u5931\u8d25\uff0c\u53ef\u91cd\u8bd5\uff1a" + fileToSend.name);
    }
  }

  sendBtn.disabled = false;

  input.focus();
}

</script>

</body>
</html>`;
}
