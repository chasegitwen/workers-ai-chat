import { jsonResponse } from "../utils/response.js";

const MODEL_SETTINGS_KEY = "model_settings";

function ensureSettingsDb(env) {
  if (!env.DB) {
    return jsonResponse({
      ok: false,
      error: "D1 binding DB is not configured"
    }, 500);
  }

  return null;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function handleSettings(request, env, url) {
  if (url.pathname !== "/api/settings") {
    return null;
  }

  const dbError = ensureSettingsDb(env);

  if (dbError) {
    return dbError;
  }

  if (request.method === "GET") {
    try {
      const row = await env.DB.prepare(
        "SELECT value, updated_at FROM settings WHERE key = ?"
      ).bind(MODEL_SETTINGS_KEY).first();

      if (!row) {
        return jsonResponse({
          ok: true,
          settings: null,
          providers: null
        });
      }

      try {
        const settings = JSON.parse(row.value || "null");

        return jsonResponse({
          ok: true,
          settings: isObject(settings) ? settings : null,
          providers: isObject(settings) ? (settings.providers || null) : null,
          updated_at: row.updated_at
        });
      } catch (err) {
        return jsonResponse({
          ok: true,
          settings: null,
          providers: null,
          warning: "Stored settings JSON could not be parsed"
        });
      }
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to read settings. Make sure the settings table migration has been applied.",
        detail: err.message || String(err)
      }, 500);
    }
  }

  if (request.method === "POST") {
    let body;

    try {
      body = await request.json();
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Request body must be JSON"
      }, 400);
    }

    if (!isObject(body) || !isObject(body.settings)) {
      return jsonResponse({
        ok: false,
        error: "settings must be an object"
      }, 400);
    }

    try {
      await env.DB.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).bind(
        MODEL_SETTINGS_KEY,
        JSON.stringify(body.settings),
        Date.now()
      ).run();

      return jsonResponse({
        ok: true
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: "Failed to save settings. Make sure the settings table migration has been applied.",
        detail: err.message || String(err)
      }, 500);
    }
  }

  return jsonResponse({
    ok: false,
    error: "Method not allowed"
  }, 405);
}
