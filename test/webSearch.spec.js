import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultFreshness,
  isFreshnessQuery,
  webSearchTool
} from "../src/tools/webSearch.js";

const env = {
  BRAVE_SEARCH_API_KEY: "test-key"
};

function mockBraveResults(results) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    web: {
      results
    }
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webSearch freshness", () => {
  it("does not add freshness for ordinary queries", async () => {
    const fetchMock = mockBraveResults([]);

    const result = await webSearchTool.handler({
      query: "Cloudflare Workers AI 是什么"
    }, env);
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(isFreshnessQuery("Cloudflare Workers AI 是什么")).toBe(false);
    expect(result.freshness).toBe("");
    expect(url.searchParams.get("freshness")).toBe(null);
  });

  it("uses pd for today or breaking queries", async () => {
    const fetchMock = mockBraveResults([]);

    const result = await webSearchTool.handler({
      query: "今天 AI 新闻"
    }, env);
    const url = new URL(fetchMock.mock.calls[0][0]);
    const init = fetchMock.mock.calls[0][1];

    expect(getDefaultFreshness("今天 AI 新闻")).toBe("pd");
    expect(result.freshness).toBe("pd");
    expect(url.searchParams.get("freshness")).toBe("pd");
    expect(init.headers["Cache-Control"]).toBe("no-cache");
  });

  it("uses pw for recent news queries and prioritizes dated results", async () => {
    const fetchMock = mockBraveResults([
      {
        title: "Undated overview",
        url: "https://example.com/overview",
        description: "Older evergreen result"
      },
      {
        title: "Recent report",
        url: "https://example.com/news",
        description: "Fresh result",
        age: "2 days ago",
        page_age: "2026-05-15T00:00:00Z",
        profile: {
          name: "Example News"
        }
      }
    ]);

    const result = await webSearchTool.handler({
      query: "latest Cloudflare Workers AI news"
    }, env);
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(result.freshness).toBe("pw");
    expect(url.searchParams.get("freshness")).toBe("pw");
    expect(result.results[0]).toMatchObject({
      title: "Recent report",
      age: "2 days ago",
      page_age: "2026-05-15T00:00:00Z",
      source: "Example News"
    });
  });
});
