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

  #imageBtn{
    border:none;
    background:#666;
    color:white;
    min-height:38px;
    padding:0 14px;
    border-radius:999px;
    font-size:14px;
    cursor:pointer;
    flex:0 0 auto;
  }

  #fileBtn{
    border:none;
    background:#4b5563;
    color:white;
    min-height:38px;
    padding:0 14px;
    border-radius:999px;
    font-size:14px;
    cursor:pointer;
    flex:0 0 auto;
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
  gap:8px;
  flex:1 1 auto;
  min-height:120px;
  overflow-y:auto;
  margin-bottom:14px;
}

.historyRow{
  display:flex;
  align-items:center;
  gap:6px;
}

.historyItem{
  min-width:0;
  flex:1;
  width:100%;
  border:1px solid var(--border);
  background:transparent;
  color:var(--text);
  border-radius:12px;
  padding:9px 10px;
  font-size:13px;
  text-align:left;
  cursor:pointer;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.historyItem.active{
  border-color:var(--primary);
  background:rgba(37,99,235,.1);
  color:var(--primary);
}

.deleteConversationBtn{
  width:30px;
  height:30px;
  flex:0 0 auto;
  border:1px solid var(--border);
  background:transparent;
  color:var(--muted);
  border-radius:10px;
  cursor:pointer;
}

.deleteConversationBtn:hover{
  color:white;
  background:#dc2626;
  border-color:#dc2626;
}

.libraryPanel{
  flex:0 0 auto;
  min-height:0;
  max-height:260px;
  overflow:hidden;
  border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);
  padding:12px 0;
  margin:0 0 14px;
}

.libraryHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  margin-bottom:8px;
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

.filesList{
  display:flex;
  flex-direction:column;
  gap:8px;
  min-height:0;
  max-height:180px;
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
  gap:8px;
  flex:0 1 auto;
  flex-wrap:wrap;
  justify-content:flex-end;
}

.toolBtn{
  min-height:38px;
  border:none;
  color:white;
  padding:0 14px;
  border-radius:999px;
  font-size:14px;
  cursor:pointer;
  white-space:nowrap;
  flex:0 0 auto;
}

.toolBtn:disabled{
  opacity:.6;
  cursor:not-allowed;
}

#searchBtn{
  background:#7c3aed;
}

#webAnswerBtn{
  background:#dc2626;
}

#fetchUrlBtn{
  background:#059669;
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

<div class="app">

  <div class="topbar">
    <div class="brand">Workers <span>AI</span> Assistant</div>
    <button class="themeBtn" onclick="toggleTheme()">深色 / 浅色</button>
  </div>

  <div class="main">

    <aside class="sidebar">

      <h2>网页 AI 助手</h2>

      <button id="newChatBtn" class="newChatBtn" type="button">
        New Chat
      </button>

      <div class="sidebarMain">

        <div id="conversationList" class="historyList"></div>

        <div class="libraryPanel">
          <div class="libraryHeader">
            <strong>&#x6587;&#x4EF6;&#x5E93;</strong>
            <button id="refreshFilesBtn" type="button">&#x5237;&#x65B0;</button>
          </div>
          <div id="selectedFilesCount" class="libraryCount">&#x5DF2;&#x9009;&#x62E9; 0 &#x4E2A;&#x6587;&#x4EF6;</div>
          <div id="filesList" class="filesList"></div>
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
      <button id="fileBtn" type="button">
        &#x6587;&#x4EF6;
      </button>

      <button id="imageBtn" type="button">
        &#x56FE;&#x7247;
      </button>
    </div>

    <input
      id="input"
      placeholder="&#x8F93;&#x5165;&#x95EE;&#x9898;&#x3001;&#x641C;&#x7D22;&#x5173;&#x952E;&#x8BCD;&#x6216;&#x7F51;&#x9875; URL..."
    />

    <div class="inputPrimaryActions">
      <button id="searchBtn" class="toolBtn" type="button">
        &#x641C;&#x7D22;
      </button>

      <button id="webAnswerBtn" class="toolBtn" type="button">
        &#x8054;&#x7F51;&#x56DE;&#x7B54;
      </button>

      <button id="fetchUrlBtn" class="toolBtn" type="button">
        &#x6293;&#x53D6;&#x7F51;&#x9875;
      </button>

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
const newChatBtn = document.getElementById("newChatBtn");
const conversationList = document.getElementById("conversationList");
const refreshFilesBtn = document.getElementById("refreshFilesBtn");
const selectedFilesCount = document.getElementById("selectedFilesCount");
const filesList = document.getElementById("filesList");
const summaryStatus = document.getElementById("summaryStatus");
const viewSummaryBtn = document.getElementById("viewSummaryBtn");

const input = document.getElementById("input");

const contextStatus = document.getElementById("contextStatus");

const searchBtn = document.getElementById("searchBtn");

const webAnswerBtn = document.getElementById("webAnswerBtn");
let webSearchContext = "";
let webSearchSources = [];

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

function updateSelectedFilesStatus(){
  selectedFilesCount.textContent = "\u5df2\u9009\u62e9 " + selectedFileIds.length + " \u4e2a\u6587\u4ef6";
}

function setSelectedFilesStatus(){
  setContextStatus(selectedFileIds.length ? "\u5df2\u9009\u62e9 " + selectedFileIds.length + " \u4e2a\u6587\u4ef6" : getCurrentContextStatus());
}

function renderFilesLibrary(){
  filesList.innerHTML = "";
  updateSelectedFilesStatus();

  if(!filesLibrary.length){
    const empty = document.createElement("div");
    empty.className = "libraryCount";
    empty.textContent = "\u6682\u65e0\u6587\u4ef6";
    filesList.appendChild(empty);
    return;
  }

  filesLibrary.forEach(file => {
    const selected = selectedFileIds.includes(file.id);
    const item = document.createElement("div");
    item.className = "fileLibraryItem" + (selected ? " selected" : "");

    const name = document.createElement("div");
    name.className = "fileLibraryName";
    name.textContent = file.filename || "file";
    name.title = name.textContent;

    const meta = document.createElement("div");
    meta.className = "fileLibraryMeta";
    meta.textContent = formatFileSize(file.size) + " · " + formatDate(file.created_at);

    const actions = document.createElement("div");
    actions.className = "fileLibraryActions";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = selected ? "selectedAction" : "";
    selectBtn.textContent = selected ? "\u53d6\u6d88" : "\u9009\u62e9";
    selectBtn.addEventListener("click", () => toggleLibraryFile(file.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "deleteFileAction";
    deleteBtn.textContent = "\u5220\u9664";
    deleteBtn.addEventListener("click", () => deleteLibraryFile(file.id, file.filename || "file"));

    actions.appendChild(selectBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(actions);
    filesList.appendChild(item);
  });
}

async function loadFilesLibrary(){
  try{
    const res = await fetch("/api/files");
    const data = await res.json();

    if(!res.ok || !data.ok){
      throw new Error(data.error || "\u6587\u4ef6\u5e93\u52a0\u8f7d\u5931\u8d25");
    }

    filesLibrary = data.files || [];
    const existingIds = new Set(filesLibrary.map(file => file.id));
    selectedFileIds = selectedFileIds.filter(id => existingIds.has(id));
    selectedFileId = selectedFileId && existingIds.has(selectedFileId) ? selectedFileId : null;
    renderFilesLibrary();
    setSelectedFilesStatus();
  }catch(err){
    setContextStatus("\u6587\u4ef6\u5e93\u52a0\u8f7d\u5931\u8d25");
    console.log("load files failed", err);
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

searchBtn.addEventListener("click", searchWeb);
webAnswerBtn.addEventListener("click", webAnswer);
async function webAnswer(){

  const query = input.value.trim();

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
  webAnswerBtn.textContent = "\u8054\u7f51\u56de\u7b54";
}

fetchUrlBtn.addEventListener("click", fetchWebPage);

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
        conversation_id: currentConversationId || null
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

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "historyItem";
      btn.dataset.id = item.id;
      btn.textContent = item.title || "New Chat";
      btn.title = item.last_message_preview
        ? btn.textContent + "\\n" + item.last_message_preview
        : btn.textContent;
      btn.addEventListener("click", () => loadConversationMessages(item.id));

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
refreshFilesBtn.addEventListener("click", loadFilesLibrary);
loadConversations();
loadFilesLibrary();

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

async function streamAIResponse(response, element){

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  while(true){

    const { value, done } = await reader.read();

    if(done){
      break;
    }

    buffer += decoder.decode(value, { stream:true });
    const events = buffer.split("\\n\\n");
    buffer = events.pop() || "";

    for(const event of events){

      const lines = event
        .split("\\n")
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart());

      for(const line of lines){

        const chunk = readStreamChunk(line);

        if(chunk.done){
          return reply;
        }

        if(chunk.text){
          reply += chunk.text;
          element.innerHTML = marked.parse(reply);
          scrollBottom();
        }
      }
    }
  }

  if(buffer.trim()){

    const lines = buffer
      .split("\\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart());

    for(const line of lines){

      const chunk = readStreamChunk(line);

      if(!chunk.done && chunk.text){
        reply += chunk.text;
      }
    }

    element.innerHTML = marked.parse(reply);
    scrollBottom();
  }

  return reply;
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

    const reply = await streamAIResponse(res, aiDiv);

    if(!reply){
      aiDiv.innerHTML = marked.parse("没有返回内容");
    }

    conversation.push({
      role:"assistant",
      content:reply || ""
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
