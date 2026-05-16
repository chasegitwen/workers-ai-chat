import { runTool } from "../tools/registry.js";
import { jsonResponse } from "../utils/response.js";

export async function handleSearchAndFetch(request, env) {
  const { query } = await request.json();

  if (!query || !query.trim()) {
    return jsonResponse({ error: "Please provide a web search query" }, 400);
  }

  try {
    const searchCall = await runTool("web_search", { query }, env);

    return jsonResponse({
      ok: true,
      query: searchCall.result.query,
      results: searchCall.result.results || [],
      pages: []
    });
  } catch (err) {
    return jsonResponse({
      error: err.message
    }, 500);
  }
}
