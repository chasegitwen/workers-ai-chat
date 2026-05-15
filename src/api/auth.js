import { jsonResponse } from "../utils/response.js";
import {
  authConfigError,
  buildLogoutCookie,
  buildSessionCookie,
  createSession,
  getSession
} from "../lib/auth.js";

function withCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    headers
  });
}

export async function handleAuth(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const session = await getSession(request, env);

    return jsonResponse({
      ok: true,
      authenticated: Boolean(session),
      user: session ? {
        username: session.username
      } : null
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const configError = authConfigError(env);

    if (configError) {
      return jsonResponse({
        ok: false,
        error: configError
      }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (
      username !== String(env.ADMIN_USERNAME || "").trim() ||
      password !== String(env.ADMIN_PASSWORD || "")
    ) {
      return jsonResponse({
        ok: false,
        error: "invalid credentials"
      }, 401);
    }

    const token = await createSession(username, env);
    const response = jsonResponse({
      ok: true,
      user: {
        username
      }
    });

    return withCookie(response, buildSessionCookie(token, request));
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const response = jsonResponse({
      ok: true
    });

    return withCookie(response, buildLogoutCookie(request));
  }

  return null;
}
