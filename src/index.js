import { handleChat } from "./api/chat.js";
import { handleFiles } from "./api/files.js";
import { handleFetchUrl } from "./api/fetchUrl.js";
import { handleHistory } from "./api/history.js";
import { handleSearchAndFetch } from "./api/searchAndFetch.js";
import { handleSearchWeb } from "./api/searchWeb.js";
import { htmlPage } from "./frontend/page.js";
import { corsHeaders, jsonResponse } from "./utils/response.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return new Response("Use POST", { status: 405 });
    }

    console.log("POST pathname:", url.pathname);

    if (url.pathname === "/fetch-url") {
      return handleFetchUrl(request);
    }

    if (url.pathname === "/search-web") {
      return handleSearchWeb(request, env);
    }

    if (url.pathname === "/search-and-fetch") {
      return handleSearchAndFetch(request, env);
    }

    return handleChat(request, env);
  }
};
