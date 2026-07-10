import { describe, expect, it } from "vitest";
import {
  callOpenAICompatible,
  maybeAttachCfAccessHeaders
} from "../src/providers/openaiCompatible.js";

const env = {
  ACT_CF_ACCESS_CLIENT_ID: "test-client-id",
  ACT_CF_ACCESS_CLIENT_SECRET: "test-client-secret",
  SEATTLE_OPENCLAW_API_KEY: "seattle-api-key"
};

function attach(url, sourceEnv = env) {
  const headers = {};
  maybeAttachCfAccessHeaders(sourceEnv, url, headers);
  return headers;
}

describe("OpenAI-compatible CF Access upstream headers", () => {
  it("attaches CF Access headers for act.hnsnowground.cfd /v1/models", () => {
    expect(attach("https://act.hnsnowground.cfd/v1/models")).toMatchObject({
      "CF-Access-Client-Id": "test-client-id",
      "CF-Access-Client-Secret": "test-client-secret"
    });
  });

  it("attaches CF Access headers for act.hnsnowground.cfd /v1/chat/completions", () => {
    expect(attach("https://act.hnsnowground.cfd/v1/chat/completions")).toMatchObject({
      "CF-Access-Client-Id": "test-client-id",
      "CF-Access-Client-Secret": "test-client-secret"
    });
  });

  it("does not attach CF Access headers to Hillsboro legacy /v1 requests", () => {
    expect(attach("https://hill.hnsnowground.cfd/v1/models")).toEqual({});
  });

  it("does not attach CF Access headers to Hillsboro bridge requests", () => {
    expect(attach("https://hill.hnsnowground.cfd/openclaw-bridge/v1/openclaw/tasks/ping")).toEqual({});
  });

  it("does not attach CF Access headers to ai.hnsnowground.cfd /v1 requests", () => {
    expect(attach("https://ai.hnsnowground.cfd/v1/models")).toEqual({});
  });

  it("keeps the original headers when the CF Access secrets are missing", () => {
    expect(attach("https://act.hnsnowground.cfd/v1/models", {
      ACT_CF_ACCESS_CLIENT_ID: "test-client-id"
    })).toEqual({});
    expect(attach("https://act.hnsnowground.cfd/v1/models", {
      ACT_CF_ACCESS_CLIENT_SECRET: "test-client-secret"
    })).toEqual({});
    expect(attach("https://act.hnsnowground.cfd/v1/models", {})).toEqual({});
  });

  it("sends CF Access headers only on the Seattle act.hnsnowground.cfd upstream request", async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), headers: init.headers };
      return new Response(
        [
          "data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }),
          "",
          "data: [DONE]",
          ""
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8"
          }
        }
      );
    };

    try {
      await callOpenAICompatible({
        env,
        config: {
          id: "openclaw-seattle-glm51",
          provider: "openclaw-seattle",
          apiBase: "https://act.hnsnowground.cfd/v1",
          apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
          modelName: "openclaw/glm51"
        },
        messages: [{ role: "user", content: "hello" }],
        stream: true
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(captured.url).toBe("https://act.hnsnowground.cfd/v1/chat/completions");
    expect(captured.headers["CF-Access-Client-Id"]).toBe("test-client-id");
    expect(captured.headers["CF-Access-Client-Secret"]).toBe("test-client-secret");
    expect(JSON.stringify(captured)).not.toContain("ACT_CF_ACCESS_CLIENT_SECRET");
  });

  it("does not follow OpenClaw CF Access redirects silently", async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), init };
      return new Response("<html><title>302 Found</title></html>", {
        status: 302,
        headers: {
          Location: "https://chasewen.cloudflareaccess.com/cdn-cgi/access/login/act.hnsnowground.cfd",
          "Content-Type": "text/html; charset=UTF-8"
        }
      });
    };

    try {
      await expect(callOpenAICompatible({
        env,
        config: {
          id: "openclaw-seattle-glm51",
          provider: "openclaw-seattle",
          apiBase: "https://act.hnsnowground.cfd/v1",
          apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
          modelName: "openclaw/glm51"
        },
        messages: [{ role: "user", content: "hello" }],
        stream: true
      })).rejects.toMatchObject({
        status: 302,
        code: "cloudflare_access_blocked"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(captured.url).toBe("https://act.hnsnowground.cfd/v1/chat/completions");
    expect(captured.init.redirect).toBe("manual");
  });

  it("reports when Cloudflare Access blocked a request that had service token headers attached", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("<html><title>302 Found</title></html>", {
      status: 302,
      headers: {
        Location: "https://chasewen.cloudflareaccess.com/cdn-cgi/access/login/act.hnsnowground.cfd",
        "Content-Type": "text/html; charset=UTF-8"
      }
    });

    try {
      await expect(callOpenAICompatible({
        env,
        config: {
          id: "openclaw-seattle-glm5.1",
          provider: "openclaw-seattle",
          apiBase: "https://act.hnsnowground.cfd/v1",
          apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
          modelName: "openclaw/glm5.1"
        },
        messages: [{ role: "user", content: "hello" }],
        stream: true
      })).rejects.toMatchObject({
        code: "cloudflare_access_blocked",
        message: expect.stringContaining("Service token headers were attached")
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects OpenClaw HTML responses instead of letting the frontend show an empty reply", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      "<html><title>Cloudflare Access Login</title></html>",
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=UTF-8"
        }
      }
    );

    try {
      await expect(callOpenAICompatible({
        env,
        config: {
          id: "openclaw-seattle-glm51",
          provider: "openclaw-seattle",
          apiBase: "https://act.hnsnowground.cfd/v1",
          apiKeyEnv: "SEATTLE_OPENCLAW_API_KEY",
          modelName: "openclaw/glm51"
        },
        messages: [{ role: "user", content: "hello" }],
        stream: true
      })).rejects.toMatchObject({
        code: "invalid_stream_content_type",
        status: 200
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
