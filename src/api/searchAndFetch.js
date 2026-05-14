import { jsonResponse } from "../utils/response.js";
import { extractReadableTextFromHtml } from "../utils/text.js";

export async function handleSearchAndFetch(request, env) {
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
