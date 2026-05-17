const MAX_RESULTS = 5;

export function isFreshnessQuery(text) {
  return /今天|今日|刚刚|最新|最近|近期|新闻|快讯|突发|实时|现在|today|latest|recent|news|breaking|current|now/i.test(text || "");
}

export function getDefaultFreshness(text) {
  const q = text || "";

  if (/今天|今日|刚刚|突发|快讯|实时|today|breaking|now/i.test(q)) {
    return "pd";
  }

  if (/最新|最近|近期|新闻|recent|latest|news|current/i.test(q)) {
    return "pw";
  }

  return "";
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function getResultSource(item = {}) {
  return firstValue(
    item.source,
    item.profile?.name,
    item.meta_url?.hostname,
    item.meta_url?.netloc
  );
}

function normalizeSearchResult(item = {}) {
  const snippet = item.description || item.snippet || "";

  return {
    title: item.title || "",
    url: item.url || "",
    snippet,
    description: snippet,
    age: firstValue(item.age),
    page_age: firstValue(item.page_age, item.pageAge),
    published: firstValue(item.published, item.date, item.published_date, item.publishedDate),
    source: getResultSource(item)
  };
}

function hasFreshnessMetadata(item = {}) {
  return Boolean(item.age || item.page_age || item.published);
}

function prioritizeDatedResults(results, freshness) {
  if (!freshness) {
    return results;
  }

  return results
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aHasDate = hasFreshnessMetadata(a.item);
      const bHasDate = hasFreshnessMetadata(b.item);

      if (aHasDate !== bHasDate) {
        return aHasDate ? -1 : 1;
      }

      return a.index - b.index;
    })
    .map(entry => entry.item);
}

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

    const freshness = isFreshnessQuery(query) ? getDefaultFreshness(query) : "";
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(MAX_RESULTS));

    if (args.country) {
      url.searchParams.set("country", String(args.country));
    }

    if (args.search_lang) {
      url.searchParams.set("search_lang", String(args.search_lang));
    }

    if (freshness) {
      url.searchParams.set("freshness", freshness);
    }

    console.log("[webSearch] Brave Search request", {
      query,
      freshness: freshness || "none"
    });

    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
        "Cache-Control": "no-cache"
      }
    });

    console.log("[webSearch] Brave Search response", {
      ok: response.ok,
      status: response.status,
      freshness: freshness || "none",
    });

    if (!response.ok) {
      throw new Error("web_search failed: HTTP " + response.status);
    }

    const data = await response.json();
    const results = prioritizeDatedResults(
      (data.web?.results || []).slice(0, MAX_RESULTS).map(normalizeSearchResult),
      freshness
    );

    return {
      query,
      freshness,
      results
    };
  }
};
