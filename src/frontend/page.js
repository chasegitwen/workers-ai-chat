export function htmlPage() {

  return `<!doctype html>
<html lang="zh-CN">

<head>

<meta charset="utf-8">

<meta name="viewport" content="width=device-width,initial-scale=1">

<title>Workers AI Assistant</title>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
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
  height:64px;
  flex:0 0 64px;
  padding:0 24px;
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
  padding:8px 14px;
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
  gap:20px;
  padding:20px;
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
  max-height:260px;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);
  padding:12px 0;
  margin:0 0 14px;
}

.libraryPanel.collapsed{
  max-height:none;
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
  flex-direction:column;
  margin-top:8px;
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
  flex:1 1 auto;
  min-height:0;
  max-height:none;
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

#input{
  flex:1 1 260px;
  min-width:160px;
  padding:12px 6px;
  border:none;
  font-size:16px;
  outline:none;
  background:transparent;
  color:var(--text);
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
    padding:0 16px;
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

      <h2>网页 AI 助手</h2>

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
    
        <option value="@cf/meta/llama-3.1-8b-instruct-fast">
          Llama 3.1 8B Fast
        </option>
    
        <option value="@cf/zai-org/glm-4.7-flash">
          GLM 4.7 Flash
        </option>
    
        <option value="@cf/google/gemma-4-26b-a4b-it">
          Gemma 4 26B
        </option>
    
        <option value="@cf/moonshotai/kimi-k2.6">
          Kimi K2.6
        </option>
    
      </select>

      </div>

    </aside>

    <section class="chatCard">

      <div class="chatHeader">
        <span>AI Chat</span>
        <div id="summaryStatus" class="summaryStatus">
          <span>&#x5DF2;&#x542F;&#x7528;&#x957F;&#x4E0A;&#x4E0B;&#x6587;&#x6458;&#x8981;</span>
          <button id="viewSummaryBtn" type="button">&#x67E5;&#x770B;&#x6458;&#x8981;</button>
        </div>
      </div>

      <div id="chat">

        <div class="msg ai">
          你好，我是基于 Cloudflare Workers AI 的网页助手。
          你可以问我问题，也可以让我写代码、总结、翻译或分析内容。
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

    <input
      id="input"
      placeholder="&#x8F93;&#x5165;&#x95EE;&#x9898;&#x3001;&#x641C;&#x7D22;&#x5173;&#x952E;&#x8BCD;&#x6216;&#x7F51;&#x9875; URL..."
    />

    <div class="inputPrimaryActions">
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

const fetchUrlBtn = document.getElementById("fetchUrlBtn");

let selectedWebPage = null;
let selectedWebPageChunks = [];
let lastWebRelevantChunkCount = 0;

const sendBtn = document.getElementById("sendBtn");

const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const imagePreviewBox = document.getElementById("imagePreviewBox");
const imagePreview = document.getElementById("imagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const uploadStatus = document.getElementById("uploadStatus");

let selectedImage = null;

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

    renderSearchResults(data.results || []);

    setContextStatus(
      "\u641c\u7d22\u5b8c\u6210\uff1a" + query + "\uff08" + (data.results || []).length + " \u6761\u7ed3\u679c\uff09"
    );

  }catch(err){

    setContextStatus("\u641c\u7d22\u5931\u8d25");
    alert("搜索失败：" + err.message);

  }

  searchBtn.disabled = false;
  searchBtn.textContent = "\u641c\u7d22";
}

function renderSearchResults(results){

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
    card.appendChild(link);
    card.appendChild(btn);

    box.appendChild(card);
  });

  searchResults.appendChild(box);
  scrollBottom();
}

clearFileBtn.addEventListener("click", clearSelectedFile);

searchBtn.addEventListener("click", () => {
  closeInputMenus();
  searchWeb();
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

const conversation = [
  {
    role:"system",
    content:"你是一个网页 AI 助手，请简洁、准确、友好地回答。可以使用 Markdown。"
  }
];

function resetLocalConversation(){
  conversation.length = 1;
}

function resetChatView(){
  chat.innerHTML =
    "<div class='msg ai'>你好，我是基于 Cloudflare Workers AI 的网页助手。你可以问我问题，也可以让我写代码、总结、翻译或分析内容。</div>" +
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
    div.innerHTML = marked.parse(message.content || "");
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

  if(e.key === "Enter"){
    sendMessage();
  }

});

sendBtn.addEventListener("click", sendMessage);
newChatBtn.addEventListener("click", createNewConversation);
viewSummaryBtn.addEventListener("click", viewCurrentSummary);
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
document.addEventListener("click", closeInputMenus);
document.addEventListener("keydown", event => {
  if(event.key === "Escape"){
    closeInputMenus();
  }
});
loginForm.addEventListener("submit", login);
logoutBtn.addEventListener("click", logout);
setFileLibraryExpanded(false);
checkAuth();

function toggleTheme(){
  document.body.classList.toggle("dark");
}

function scrollBottom(){
  chat.scrollTop = chat.scrollHeight;
}

function addUserMessage(text, imageDataUrl, fileInfo){

  const div = document.createElement("div");

  div.className = imageDataUrl && !text && !fileInfo
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

function renderAssistantMessage(element, text, sources){
  element.innerHTML = marked.parse(text || "");
  renderSources(element, sources);
  scrollBottom();
}

async function typeWriter(element, text){

  let current = "";

  for(let i = 0; i < text.length; i++){

    current += text[i];

    element.innerHTML = marked.parse(current);

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
      renderAssistantMessage(element, state.reply, state.sources);
    }catch(err){
      console.log("parse sources failed", err);
    }

    return false;
  }

  if(event.type === "done"){
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
    renderAssistantMessage(element, state.reply, state.sources);
  }

  return false;
}

async function streamAIResponse(response, element){

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = {
    reply:"",
    sources:[]
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
    (webPageToSend ? "\u8bf7\u603b\u7ed3\u8fd9\u4e2a\u7f51\u9875\u3002" : "\u8bf7\u63cf\u8ff0\u8fd9\u5f20\u56fe\u7247\u3002")));

  const displayMessage = message || (imageToSend ? "" : userMessageForRequest);
  addUserMessage(displayMessage, imageToSend, fileInfoForUI);

  conversation.push({
    role:"user",
    content:userMessageForRequest
  });

  input.value = "";

  sendBtn.disabled = true;

  const aiDiv = addAIMessage();

  aiDiv.innerHTML =
    "<span class='loading'>思考中...</span>";

  if(imageToSend){
    setContextStatus("\u56fe\u7247\u4e0a\u4f20\u4e2d...");
  }

  if(fileToSend){
    aiDiv.innerHTML =
      "<span class='loading'>正在基于 " + lastRelevantChunkCount + " 个相关片段回答...</span>";
  }

  try{

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
        toolCall:pendingToolCall,
        image:imageToSend,
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
      aiDiv.innerHTML = marked.parse("没有返回内容");
    }

    conversation.push({
      role:"assistant",
      content:reply || "",
      sources:streamResult.sources || []
    });
    webSearchContext = "";
    webSearchSources = [];
    await loadConversations();
    await loadSummaryStatus();

    if(imageToSend){
      clearSelectedImage();
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
