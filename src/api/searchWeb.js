import { jsonResponse } from "../utils/response.js";

export async function handleSearchWeb(request, env) {
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
