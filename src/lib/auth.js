const SESSION_COOKIE = "wa_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function base64UrlEncode(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  let binary = "";

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function parseCookies(header) {
  const cookies = {};

  (header || "").split(";").forEach(part => {
    const index = part.indexOf("=");

    if (index === -1) {
      return;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      cookies[key] = value;
    }
  });

  return cookies;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(a || "");
  const right = new TextEncoder().encode(b || "");
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }

  return diff === 0;
}

function getSecret(env) {
  return String(env.SESSION_SECRET || "").trim();
}

export function authConfigError(env) {
  if (!String(env.ADMIN_USERNAME || "").trim()) {
    return "ADMIN_USERNAME is not configured";
  }

  if (!String(env.ADMIN_PASSWORD || "").trim()) {
    return "ADMIN_PASSWORD is not configured";
  }

  if (!getSecret(env)) {
    return "SESSION_SECRET is not configured";
  }

  return "";
}

export async function createSession(username, env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = base64UrlEncode(JSON.stringify({
    username,
    exp
  }));
  const signature = await sign(payload, getSecret(env));

  return payload + "." + signature;
}

export async function verifySession(token, env) {
  if (!token || !getSecret(env)) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = await sign(payload, getSecret(env));

  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    const data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));

    if (!data.username || !data.exp || data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      username: data.username
    };
  } catch (err) {
    return null;
  }
}

export async function getSession(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return verifySession(cookies[SESSION_COOKIE], env);
}

export async function requireAuth(request, env) {
  const session = await getSession(request, env);

  if (!session) {
    return {
      ok: false,
      response: new Response(JSON.stringify({
        ok: false,
        error: "unauthorized"
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      })
    };
  }

  return {
    ok: true,
    session
  };
}

export function buildSessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  return [
    SESSION_COOKIE + "=" + token,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + SESSION_MAX_AGE
  ].join("; ") + secure;
}

export function buildLogoutCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  return [
    SESSION_COOKIE + "=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ") + secure;
}
