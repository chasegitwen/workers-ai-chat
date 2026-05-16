import { runTool } from "../tools/registry.js";
import { jsonResponse } from "../utils/response.js";

export async function handleFetchUrl(request, env) {
  const { pageUrl, url } = await request.json();
  const targetUrl = pageUrl || url;

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return jsonResponse({ error: "Please provide a valid http:// or https:// URL" }, 400);
  }

  try {
    const toolCall = await runTool("fetch_url", { url: targetUrl }, env);
    const result = toolCall.result;

    return jsonResponse({
      ok: true,
      url: result.url,
      title: result.title,
      text: result.text,
      content: result.content,
      length: result.length,
      truncated: result.truncated
    });
  } catch (err) {
    return jsonResponse({
      error: "Fetch URL failed: " + err.message
    }, 500);
  }
}
