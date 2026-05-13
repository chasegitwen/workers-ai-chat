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

    if (request.method === "GET") {
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

    const { messages, model, image } = await request.json();

    if (image) {
      console.log("收到图片");
    
      const base64 = image.split(",")[1];
    
      const imageBytes = [...Uint8Array.from(atob(base64), c => c.charCodeAt(0))];
    
      const result = await env.AI.run(
        "@cf/meta/llama-3.2-11b-vision-instruct",
        {
          prompt: "agree"
        }
      );
    
      return new Response(
        "data: " + JSON.stringify({
          response: result.response || JSON.stringify(result)
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
      console.log("图片识别失败", err);
  
      return new Response(
        "data: " + JSON.stringify({
          response:
            "图片识别失败：\n\n" +
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

function htmlPage() {

return `<!doctype html>
<html lang="zh-CN">

<head>

<meta charset="utf-8">

<meta name="viewport" content="width=device-width,initial-scale=1">

<title>Workers AI Assistant</title>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

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

  #imagePreviewBox{
    margin-top:10px;
    max-width:240px;
  }

  #imagePreview{
    width:100%;
    border-radius:12px;
    border:1px solid #ccc;
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

      </div>

      <div class="inputBar">
        <input
          id="input"
          placeholder="输入问题，按 Enter 发送..."
        />

        <input id="imageInput" type="file" accept="image/*" hidden />

        <button id="imageBtn" type="button">
          图片
        </button>
        
        <div id="imagePreviewBox" style="display:none;">
          <img id="imagePreview" />
        </div>
        
        <button id="sendBtn">
          发送
        </button>

      </div>

    </section>

  </div>

</div>

<script>

const chat = document.getElementById("chat");

const input = document.getElementById("input");

const sendBtn = document.getElementById("sendBtn");

const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const imagePreviewBox = document.getElementById("imagePreviewBox");
const imagePreview = document.getElementById("imagePreview");

let selectedImage = null;
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
  
  };

  reader.readAsDataURL(file);

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

function addUserMessage(text){

  const div = document.createElement("div");

  div.className = "msg user";

  div.textContent = text;

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

  if(!message){
    return;
  }

  addUserMessage(message);

  conversation.push({
    role:"user",
    content:message
  });

  input.value = "";

  sendBtn.disabled = true;

  const aiDiv = addAIMessage();

  aiDiv.innerHTML =
    "<span class='loading'>思考中...</span>";

  try{

    const res = await fetch("/", {

      method:"POST",

      headers:{
        "Content-Type":"application/json"
      },

      body:JSON.stringify({
        messages:conversation,
        model:modelSelect.value,
        image:selectedImage
      })
    });

    if(!res.ok){
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.reply || "HTTP " + res.status);
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

  }catch(err){

    aiDiv.innerHTML =
      "请求失败：" + err.message;
  }

  sendBtn.disabled = false;

  input.focus();
}

</script>

</body>
</html>`;
}
