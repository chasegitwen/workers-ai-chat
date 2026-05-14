/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.pathname === "/debug-path") {
        return jsonResponse({
          ok: true,
          pathname: url.pathname,
          hasSearchWeb: true,
          time: new Date().toISOString()
        });
      }

      if (url.searchParams.get("agree") === "1") {
        try {

          const result = await env.AI.run(
            "@cf/meta/llama-3.2-11b-vision-instruct",
            {
              prompt: "agree"
            }
          );

          return new Response(
            "Llama Vision license agree request succeeded.\n\n" +
            JSON.stringify(result, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );

        } catch (err) {

          return new Response(
            "Llama Vision license agree request failed.\n\n" +
            "name: " + (err.name || "") + "\n" +
            "message: " + (err.message || String(err)) + "\n" +
            "stack: " + (err.stack || ""),
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        }
      }

      return new Response(htmlPage(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return new Response("Use POST", { status: 405 });
    }

    if (request.method === "POST") {
      console.log("POST pathname:", url.pathname);
    }

    if (url.pathname === "/fetch-url" && request.method === "POST") {

      const { pageUrl } = await request.json();
    
      if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
        return jsonResponse({ error: "请输入有效的网址" }, 400);
      }
    
      try {
    
        const response = await fetch(pageUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          }
        });
    
        if (!response.ok) {
          return jsonResponse({
            error: "网页抓取失败：HTTP " + response.status
          }, 500);
        }
    
        const html = await response.text();
    
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    
        const title = cleanText(
          titleMatch?.[1] || "Untitled Page"
        );
    
        const text = extractReadableTextFromHtml(html);
    
        return jsonResponse({
          ok: true,
          url: pageUrl,
          title,
          text,
          length: text.length
        });
    
      } catch (err) {
    
        return jsonResponse({
          error: "网页抓取失败：" + err.message
        }, 500);
      }
    }

    if (url.pathname === "/search-web" && request.method === "POST") {
      const { query } = await request.json();
    
      if (!query || !query.trim()) {
        return jsonResponse({ error: "请输入搜索关键词" }, 400);
      }
    
      try {
        const res = await fetch(
          "https://api.search.brave.com/res/v1/web/search?q=" +
          encodeURIComponent(query),
          {
            headers: {
              "Accept": "application/json",
              "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY
            }
          }
        );
    
        if (!res.ok) {
          return jsonResponse({
            error: "搜索失败：HTTP " + res.status
          }, 500);
        }
    
        const data = await res.json();
    
        const results = (data.web?.results || []).slice(0, 5).map(item => ({
          title: item.title || "",
          url: item.url || "",
          description: item.description || ""
        }));
    
        return jsonResponse({
          ok: true,
          query,
          results
        });
    
      } catch (err) {
        return jsonResponse({
          error: "搜索失败：" + err.message
        }, 500);
      }
    }

    if (url.pathname === "/search-and-fetch" && request.method === "POST") {
      const { query } = await request.json();
    
      if (!query || !query.trim()) {
        return jsonResponse({ error: "请输入联网问题" }, 400);
      }
    
      if (!env.BRAVE_SEARCH_API_KEY) {
        return jsonResponse({ error: "缺少 BRAVE_SEARCH_API_KEY" }, 500);
      }
    
      try {
        const searchRes = await fetch(
          "https://api.search.brave.com/res/v1/web/search?q=" +
            encodeURIComponent(query.trim()) +
            "&count=5",
          {
            headers: {
              "Accept": "application/json",
              "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY
            }
          }
        );
    
        if (!searchRes.ok) {
          return jsonResponse({
            error: "搜索失败：HTTP " + searchRes.status
          }, 500);
        }
    
        const searchData = await searchRes.json();
    
        const searchResults = (searchData.web?.results || [])
          .slice(0, 3)
          .map(item => ({
            title: item.title || "",
            url: item.url || "",
            description: item.description || ""
          }));
    
        const pages = [];
    
        for (const item of searchResults) {
          try {
            const pageRes = await fetch(item.url, {
              headers: {
                "User-Agent": "Mozilla/5.0 Cloudflare Workers AI Assistant",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              }
            });
    
            if (!pageRes.ok) {
              continue;
            }
    
            const html = await pageRes.text();
            const text = extractReadableTextFromHtml(html);
    
            if (text && text.length > 100) {
              pages.push({
                title: item.title,
                url: item.url,
                description: item.description,
                text: text.slice(0, 8000)
              });
            }
    
          } catch (err) {
            // 单个网页抓取失败就跳过
          }
        }
    
        return jsonResponse({
          ok: true,
          query: query.trim(),
          results: searchResults,
          pages
        });
    
      } catch (err) {
        return jsonResponse({
          error: "联网搜索失败：" + err.message
        }, 500);
      }
    }

    const { messages, model, image, file } = await request.json();

    if (image) {

      try {

        console.log("收到图片");

        const base64 = image.split(",")[1];

        if (!base64) {
          throw new Error("图片 DataURL 格式不正确");
        }

        const imageBytes = Array.from(
          Uint8Array.from(
            atob(base64),
            c => c.charCodeAt(0)
          )
        );

        const result = await env.AI.run(
          "@cf/meta/llama-3.2-11b-vision-instruct",
          {
            prompt: "请用中文描述这张图片，说明图片中的主要对象、场景和可能用途。",
            image: imageBytes,
            max_tokens: 256
          }
        );

        return new Response(
          "data: " + JSON.stringify({
            response:
              result.response ||
              JSON.stringify(result)
          }) + "\n\n",
          {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            }
          }
        );

      } catch(err) {

        console.log("图片识别失败", err);

        return new Response(
          "data: " + JSON.stringify({
            response:
              "图片识别失败：\n\n" +
              "name: " + (err.name || "") + "\n" +
              "message: " + (err.message || String(err))
          }) + "\n\n",
          {
            status: 200,
            headers: {
              ...corsHeaders(),
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            }
          }
        );
      }
    }

    
    if (file && file.text) {

      const filePrompt =
        "用户上传了一个文件。下面是从文件中提取出的相关片段，请优先依据这些片段回答用户问题；如果片段信息不足，请明确说明。\\n\\n" +
        "文件名：" + file.name + "\\n" +
        "文件类型：" + (file.type || "unknown") + "\\n\\n" +
        "资料内容如下：\\n" +
        file.text.slice(0, 12000);
    
      messages.push({
        role: "user",
        content: filePrompt
      });
    }

    const allowedModels = [
      "@cf/zai-org/glm-4.7-flash",
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/moonshotai/kimi-k2.6",
      "@cf/meta/llama-3.1-8b-instruct-fast"
    ];

    const selectedModel = allowedModels.includes(model)
      ? model
      : "@cf/meta/llama-3.1-8b-instruct-fast";

    try {

      const result = await env.AI.run(
        selectedModel,
        {
          messages,
          stream: true
        }
      );

      return new Response(result, {
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache"
        }
      });

    } catch (err) {
      console.log("AI 请求失败", err);
  
      return new Response(
        "data: " + JSON.stringify({
          response:
            "AI 请求失败：\n\n" +
            "name: " + err.name + "\n" +
            "message: " + err.message + "\n" +
            "stack: " + err.stack
        }) + "\n\n",
        {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      );
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function cleanText(text = "") {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReadableTextFromHtml(html = "") {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  text = text.replace(/<\/(p|div|section|article|h1|h2|h3|li|br)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  text = cleanText(text);

  return text.slice(0, 60000);
}

function htmlPage() {

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
    padding:0 18px;
    border-radius:14px;
    font-size:16px;
    cursor:pointer;
    margin-right:8px;
  }

  #fileBtn{
    border:none;
    background:#4b5563;
    color:white;
    padding:0 18px;
    border-radius:14px;
    font-size:16px;
    cursor:pointer;
    margin-right:8px;
  }
  
  #fileStatus{
    font-size:12px;
    color:var(--muted);
    white-space:nowrap;
    align-self:center;
    max-width:260px;
    overflow:hidden;
    text-overflow:ellipsis;
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
    font-size:12px;
    color:var(--muted);
    margin-left:4px;
    white-space:nowrap;
    align-self:center;
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
  font-family:Arial, "Microsoft YaHei", sans-serif;
  background:linear-gradient(135deg,var(--bg),#ffffff);
  color:var(--text);
}

body.dark{
  background:linear-gradient(135deg,#020617,#0f172a);
}

.app{
  height:100vh;
  display:flex;
  flex-direction:column;
}

.topbar{
  height:64px;
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
  display:grid;
  grid-template-columns:280px minmax(0,1fr);
  gap:20px;
  padding:20px;
  overflow:hidden;
}

.sidebar{
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
  font-size:20px;
}

.sidebar p{
  color:var(--muted);
  line-height:1.7;
  font-size:14px;
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
  min-height:0;
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:22px;
  overflow:hidden;
  box-shadow:0 8px 28px rgba(0,0,0,.08);
}

.chatHeader{
  padding:16px 20px;
  border-bottom:1px solid var(--border);
  font-weight:600;
}

#chat{
  flex:1;
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
  display:flex;
  gap:10px;
  padding:16px;
  border-top:1px solid var(--border);
  background:var(--panel);
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
  flex:1;
  padding:14px;
  border:1px solid var(--border);
  border-radius:14px;
  font-size:16px;
  outline:none;
  background:transparent;
  color:var(--text);
}

#sendBtn{
  border:none;
  background:var(--primary);
  color:white;
  padding:0 24px;
  border-radius:14px;
  font-size:16px;
  cursor:pointer;
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

      <p>
        这是部署在 Cloudflare Workers 上的 AI 网页助手。
        不依赖 VPS，不需要本地 GPU，直接调用 Workers AI。
      </p>

      <div class="badge">多轮对话</div>
      <div class="badge">Markdown</div>
      <div class="badge">模型切换</div>
      <div class="badge">打字机效果</div>
      <div class="badge">深浅色切换</div>

      <p style="margin-top:auto;">
        当前模型由下方选择
      </p>
    
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

    </aside>

    <section class="chatCard">

      <div class="chatHeader">
        AI Chat
      </div>

      <div id="chat">

        <div class="msg ai">
          你好，我是基于 Cloudflare Workers AI 的网页助手。
          你可以问我问题，也可以让我写代码、总结、翻译或分析内容。
        </div>
        <div id="searchResults"></div>

      </div>

      <div class="inputBar">

  <input
    id="searchInput"
    placeholder="搜索关键词..."
    style="
      max-width:180px;
      padding:14px;
      border:1px solid var(--border);
      border-radius:14px;
      font-size:14px;
      outline:none;
      background:transparent;
      color:var(--text);
    "
  />

  <button
    id="searchBtn"
    type="button"
    style="
      border:none;
      background:#7c3aed;
      color:white;
      padding:0 16px;
      border-radius:14px;
      font-size:14px;
      cursor:pointer;
    "
  >
    搜索
  </button>

  <button
    id="webAnswerBtn"
    type="button"
    style="
      border:none;
      background:#dc2626;
      color:white;
      padding:0 16px;
      border-radius:14px;
      font-size:14px;
      cursor:pointer;
    "
  >
    联网回答
  </button>



  <input
    id="urlInput"
    placeholder="粘贴网页 URL..."
    style="
      max-width:180px;
      padding:14px;
      border:1px solid var(--border);
      border-radius:14px;
      font-size:14px;
      outline:none;
      background:transparent;
      color:var(--text);
    "
  />

  <button
    id="fetchUrlBtn"
    type="button"
    style="
      border:none;
      background:#059669;
      color:white;
      padding:0 16px;
      border-radius:14px;
      font-size:14px;
      cursor:pointer;
    "
  >
    抓取网页
  </button>

  <input
    id="input"
    placeholder="输入问题，按 Enter 发送..."
  />

  <input id="imageInput" type="file" accept="image/*" hidden />

  <input
    id="fileInput"
    type="file"
    accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    hidden
  />

  <button id="fileBtn" type="button">
    文件
  </button>

  <div id="fileStatus"></div>

  <button id="clearFileBtn" type="button">清除</button>

  <button id="imageBtn" type="button">
    图片
  </button>

  <div id="imagePreviewBox">
    <img id="imagePreview" />
    <button id="removeImageBtn" type="button" title="移除图片">×</button>
  </div>

  <div id="uploadStatus"></div>

  <button id="sendBtn">
    发送
  </button>

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

const input = document.getElementById("input");

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

const webAnswerBtn = document.getElementById("webAnswerBtn");
let webSearchContext = "";
let webSearchSources = [];

const searchResults = document.getElementById("searchResults");

const urlInput = document.getElementById("urlInput");
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
let selectedFileText = "";
let selectedFileChunks = [];
let lastRelevantChunkCount = 0;

function clearSelectedFile(){

  selectedFile = null;
  selectedFileText = "";
  selectedFileChunks = [];
  lastRelevantChunkCount = 0;
  fileInput.value = "";
  fileStatus.textContent = "";
  clearFileBtn.style.display = "none";
}

function clearSelectedImage(){

  selectedImage = null;
  imageInput.value = "";
  imagePreview.src = "";
  imagePreviewBox.style.display = "none";
  uploadStatus.textContent = "";
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
    uploadStatus.textContent = "已选择图片，准备发送";

  };

  reader.readAsDataURL(file);

});

removeImageBtn.addEventListener("click", clearSelectedImage);

fileBtn.addEventListener("click", () => {
  fileInput.click();
});

async function searchWeb(){

  const query = searchInput.value.trim();

  if(!query){
    alert("请输入搜索关键词");
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "搜索中...";
  fileStatus.textContent = "正在搜索网页...";

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

    fileStatus.textContent =
      "搜索完成：" + query + "（" + (data.results || []).length + " 条结果）";

  }catch(err){

    fileStatus.textContent = "搜索失败";
    alert("搜索失败：" + err.message);

  }

  searchBtn.disabled = false;
  searchBtn.textContent = "搜索";
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
    btn.textContent = "抓取此网页";
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
      urlInput.value = item.url;
      await fetchWebPage();
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

  const query = input.value.trim() || searchInput.value.trim();

  if(!query){
    alert("请先在聊天框或搜索框输入问题");
    return;
  }

  webAnswerBtn.disabled = true;
  webAnswerBtn.textContent = "联网中...";
  fileStatus.textContent = "正在联网搜索并抓取网页...";

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

    fileStatus.textContent =
      "联网完成：找到 " + (data.results || []).length +
      " 条结果，成功抓取 " + webSearchSources.length + " 个网页";

    if(!webSearchContext){
      alert("搜索到了结果，但网页正文抓取失败。可以先用搜索结果手动抓取。");
      return;
    }

    await sendMessage();

  }catch(err){

    fileStatus.textContent = "联网回答失败";
    alert("联网回答失败：" + err.message);

  }

  webAnswerBtn.disabled = false;
  webAnswerBtn.textContent = "联网回答";
}

fetchUrlBtn.addEventListener("click", fetchWebPage);

async function fetchWebPage(){
  const pageUrl = urlInput.value.trim();

  if(!pageUrl){
    alert("请先输入网页 URL");
    return;
  }

  if(!/^https?:\\/\\//i.test(pageUrl)){
    alert("网址必须以 http:// 或 https:// 开头");
    return;
  }

  fetchUrlBtn.disabled = true;
  fetchUrlBtn.textContent = "抓取中...";
  fileStatus.textContent = "正在抓取网页...";

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

    fileStatus.textContent =
      "已抓取网页：" + data.title + "（" + data.length + " 字符，" + selectedWebPageChunks.length + " 段）";

  }catch(err){

    selectedWebPage = null;
    selectedWebPageChunks = [];
    fileStatus.textContent = "网页抓取失败";
    alert("网页抓取失败：" + err.message);

  }

  fetchUrlBtn.disabled = false;
  fetchUrlBtn.textContent = "抓取网页";
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

  try{

    selectedFile = file;
    selectedFileText = "";
    fileStatus.textContent = "正在读取：" + file.name;

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
    clearFileBtn.style.display = "inline-block";
    fileStatus.textContent =
      "已读取：" + file.name + "（" + selectedFileText.length + " 字符，" + selectedFileChunks.length + " 段）";

  }catch(err){

    alert("文件读取失败：" + err.message);

    clearSelectedFile();
  }
});


const modelSelect = document.getElementById("modelSelect");

const conversation = [
  {
    role:"system",
    content:"你是一个网页 AI 助手，请简洁、准确、友好地回答。可以使用 Markdown。"
  }
];

input.addEventListener("keydown", e => {

  if(e.key === "Enter"){
    sendMessage();
  }

});

sendBtn.addEventListener("click", sendMessage);

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
    fileDiv.textContent = "📄 " + fileInfo.name + " · " + fileInfo.chars + " 字符 · " + fileInfo.chunks + " 段";
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
    !webTextForAI &&
    !networkTextForAI
  ){
    return;
  }

  addUserMessage(message, imageToSend, fileInfoForUI);

  conversation.push({
    role:"user",
    content:
      message ||
      (fileToSend ? "请总结这个文件。" :
      (webPageToSend ? "请总结这个网页。" : "请描述这张图片。"))
  });

  input.value = "";

  sendBtn.disabled = true;

  const aiDiv = addAIMessage();

  aiDiv.innerHTML =
    "<span class='loading'>思考中...</span>";

  if(imageToSend){
    uploadStatus.textContent = "图片上传中...";
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
        messages:conversation,
        model:modelSelect.value,
        image:imageToSend,
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

    if(imageToSend){
      clearSelectedImage();
    }

    if(fileToSend){
      fileStatus.textContent =
        "当前文件：" + fileToSend.name + "（" + selectedFileChunks.length + " 段，上次使用 " + lastRelevantChunkCount + " 段）";
    }

  }catch(err){

    aiDiv.innerHTML =
      "请求失败：" + err.message;

    if(imageToSend){
      uploadStatus.textContent = "图片发送失败，可重试";
    }

    if(fileToSend){
      fileStatus.textContent = "文件问答失败，可重试：" + fileToSend.name;
    }
  }

  sendBtn.disabled = false;

  input.focus();
}

</script>

</body>
</html>`;
}
