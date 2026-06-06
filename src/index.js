import { handleAuth } from "./api/auth.js";
import { handleChat } from "./api/chat.js";
import { handleFiles } from "./api/files.js";
import { handleFetchUrl } from "./api/fetchUrl.js";
import { handleHistory } from "./api/history.js";
import { handleModelHealth } from "./api/modelHealth.js";
import { handleSearchAndFetch } from "./api/searchAndFetch.js";
import { handleSearchWeb } from "./api/searchWeb.js";
import { handleSettings } from "./api/settings.js";
import { htmlPage } from "./frontend/page.js";
import { requireAuth } from "./lib/auth.js";
import { getEnabledModels } from "./providers/config.js";
import { corsHeaders, jsonResponse } from "./utils/response.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (url.pathname.startsWith("/api/openclaw/tasks")) {
      if (request.method !== "GET" && request.method !== "POST") {
        return jsonResponse({
          ok: false,
          error: "Method not allowed"
        }, 405);
      }

      if (url.pathname !== "/api/openclaw/tasks/ping") {
        const auth = await requireAuth(request, env);

        if (!auth.ok) {
          return auth.response;
        }
      }

      return handleChat(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/auth")) {
      const authResponse = await handleAuth(request, env, url);

      if (authResponse) {
        return authResponse;
      }
    }

    if (url.pathname.startsWith("/api/")) {
      const auth = await requireAuth(request, env);

      if (!auth.ok) {
        return auth.response;
      }
    }

    if (request.method === "GET" && url.pathname === "/api/models") {
      return jsonResponse({
        models: getEnabledModels()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/debug/ai") {
      try {
        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fast",
          {
            messages: [
              {
                role: "user",
                content: "hello"
              }
            ]
          }
        );

        return Response.json(result);
      } catch (err) {
        return Response.json({
          ok: false,
          name: err.name || "",
          message: err.message || String(err),
          stack: err.stack || ""
        }, {
          status: 500
        });
      }
    }

    if (url.pathname.startsWith("/api/conversations")) {
      const historyResponse = await handleHistory(request, env, url);

      if (historyResponse) {
        return historyResponse;
      }
    }

    if (url.pathname.startsWith("/api/files")) {
      const filesResponse = await handleFiles(request, env, url);

      if (filesResponse) {
        return filesResponse;
      }
    }

    if (url.pathname === "/api/settings") {
      const settingsResponse = await handleSettings(request, env, url);

      if (settingsResponse) {
        return settingsResponse;
      }
    }

    if (url.pathname === "/api/model-health") {
      return handleModelHealth(request, env);
    }

    if (url.pathname === "/api/browser/inspect") {
      return handleChat(request, env, ctx);
    }

    if (request.method === "GET") {
      if (url.pathname === "/debug-path") {
        return jsonResponse({
          ok: true,
          pathname: url.pathname,
          hasSearchWeb: true,
          time: new Date().toISOString()
        });
      }

      if (url.searchParams.get("agree") === "1") {
        try {
          const result = await env.AI.run(
            "@cf/meta/llama-3.2-11b-vision-instruct",
            {
              prompt: "agree"
            }
          );

          return new Response(
            "Llama Vision license agree request succeeded.\n\n" +
            JSON.stringify(result, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        } catch (err) {
          return new Response(
            "Llama Vision license agree request failed.\n\n" +
            "name: " + (err.name || "") + "\n" +
            "message: " + (err.message || String(err)) + "\n" +
            "stack: " + (err.stack || ""),
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        }
      }

      return new Response(htmlPage(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Use POST", { status: 405 });
    }

    const auth = await requireAuth(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    console.log("POST pathname:", url.pathname);

    if (url.pathname === "/fetch-url") {
      return handleFetchUrl(request, env);
    }

    if (url.pathname === "/search-web") {
      return handleSearchWeb(request, env);
    }

    if (url.pathname === "/search-and-fetch") {
      return handleSearchAndFetch(request, env);
    }

    return handleChat(request, env, ctx);
  }
};
