const MAX_RESULTS = 5;

export const webSearchTool = {
  name: "web_search",
  description: "Search the web with Brave Search and return concise result metadata.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query."
      }
    },
    required: ["query"]
  },
  async handler(args = {}, env = {}) {
    const query = String(args.query || "").trim();

    if (!query) {
      throw new Error("web_search requires a non-empty query");
    }

    if (!env.BRAVE_SEARCH_API_KEY) {
      throw new Error("Missing BRAVE_SEARCH_API_KEY");
    }

    const response = await fetch(
      "https://api.search.brave.com/res/v1/web/search?q=" +
        encodeURIComponent(query) +
        "&count=" + MAX_RESULTS,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY
        }
      }
    );

    if (!response.ok) {
      throw new Error("web_search failed: HTTP " + response.status);
    }

    const data = await response.json();
    const results = (data.web?.results || []).slice(0, MAX_RESULTS).map(item => {
      const snippet = item.description || item.snippet || "";

      return {
        title: item.title || "",
        url: item.url || "",
        snippet,
        description: snippet
      };
    });

    return {
      query,
      results
    };
  }
};
