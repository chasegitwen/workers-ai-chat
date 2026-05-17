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
      query: "Cloudflare Workers AI overview"
    }, env);
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(isFreshnessQuery("Cloudflare Workers AI overview")).toBe(false);
    expect(result.freshness).toBe("");
    expect(url.searchParams.get("freshness")).toBe(null);
  });

  it.each([
    "今天 AI 新闻",
    "今日 AI 新闻",
    "breaking AI updates",
    "AI news now"
  ])("uses pd for immediate freshness query: %s", async query => {
    const fetchMock = mockBraveResults([]);

    const result = await webSearchTool.handler({
      query
    }, env);
    const url = new URL(fetchMock.mock.calls[0][0]);
    const init = fetchMock.mock.calls[0][1];

    expect(getDefaultFreshness(query)).toBe("pd");
    expect(result.freshness).toBe("pd");
    expect(url.searchParams.get("freshness")).toBe("pd");
    expect(init.headers["Cache-Control"]).toBe("no-cache");
  });

  it.each([
    "最新 Cloudflare Workers AI",
    "recent Cloudflare Workers AI updates",
    "latest Cloudflare Workers AI",
    "Cloudflare Workers AI news"
  ])("uses pw for recent freshness query: %s", async query => {
    const fetchMock = mockBraveResults([]);

    const result = await webSearchTool.handler({
      query
    }, env);
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(getDefaultFreshness(query)).toBe("pw");
    expect(result.freshness).toBe("pw");
    expect(url.searchParams.get("freshness")).toBe("pw");
  });

  it("preserves metadata and prioritizes dated results", async () => {
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
        published: "2026-05-15",
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
      published: "2026-05-15",
      source: "Example News"
    });
  });
});
