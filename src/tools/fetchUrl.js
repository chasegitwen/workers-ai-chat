import { cleanText, extractReadableTextFromHtml } from "../utils/text.js";

const MAX_TOOL_TEXT_LENGTH = 12000;

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(titleMatch?.[1] || "Untitled Page");
}

export const fetchUrlTool = {
  name: "fetch_url",
  description: "Fetch a public HTTP(S) web page and return readable text for model context.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The http:// or https:// URL to fetch."
      }
    },
    required: ["url"]
  },
  async handler(args = {}) {
    const url = String(args.url || args.pageUrl || "").trim();

    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error("fetch_url requires a valid http:// or https:// url");
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 Cloudflare Workers AI Assistant",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7"
      }
    });

    if (!response.ok) {
      throw new Error("fetch_url failed: HTTP " + response.status);
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const title = contentType.includes("html") ? extractTitle(body) : "Untitled Page";
    const readableText = contentType.includes("html")
      ? extractReadableTextFromHtml(body)
      : cleanText(body);
    const text = readableText.slice(0, MAX_TOOL_TEXT_LENGTH);

    return {
      url,
      title,
      text,
      content: text,
      length: readableText.length,
      truncated: readableText.length > text.length
    };
  }
};
