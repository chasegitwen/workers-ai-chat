import { jsonResponse } from "../utils/response.js";
import { cleanText, extractReadableTextFromHtml } from "../utils/text.js";

export async function handleFetchUrl(request) {
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
