import { corsHeaders } from "../utils/response.js";

const allowedModels = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/meta/llama-3.1-8b-instruct-fast"
];

export async function handleChat(request, env) {
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
    } catch (err) {
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
