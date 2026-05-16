import { runTool } from "../tools/registry.js";
import { jsonResponse } from "../utils/response.js";

export async function handleSearchWeb(request, env) {
  const { query } = await request.json();

  if (!query || !query.trim()) {
    return jsonResponse({ error: "Please provide a search query" }, 400);
  }

  try {
    const toolCall = await runTool("web_search", { query }, env);

    return jsonResponse({
      ok: true,
      query: toolCall.result.query,
      results: toolCall.result.results
    });
  } catch (err) {
    return jsonResponse({
      error: err.message
    }, err.message === "Missing BRAVE_SEARCH_API_KEY" ? 500 : 500);
  }
}
