export const MODEL_SETTINGS_KEY = "model_settings";

export const DEFAULT_CONVERSATION_ATTACHMENT_LIMITS = {
  maxAttachments: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxMarkdownChars: 180000,
  maxCloudflareTokens: 80000,
  maxFinalUserMessageChars: 220000
};

const HARD_CONVERSATION_ATTACHMENT_LIMITS = {
  maxAttachments: 10,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxMarkdownChars: 300000,
  maxCloudflareTokens: 120000,
  maxFinalUserMessageChars: 360000
};

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(number), min), max);
}

export function normalizeConversationAttachmentLimits(input = {}) {
  const source = isObject(input) ? input : {};
  const defaults = DEFAULT_CONVERSATION_ATTACHMENT_LIMITS;
  const hard = HARD_CONVERSATION_ATTACHMENT_LIMITS;
  return {
    maxAttachments: clampNumber(source.maxAttachments, defaults.maxAttachments, 1, hard.maxAttachments),
    maxFileBytes: clampNumber(source.maxFileBytes, defaults.maxFileBytes, 1, hard.maxFileBytes),
    maxTotalBytes: clampNumber(source.maxTotalBytes, defaults.maxTotalBytes, 1, hard.maxTotalBytes),
    maxMarkdownChars: clampNumber(source.maxMarkdownChars, defaults.maxMarkdownChars, 1, hard.maxMarkdownChars),
    maxCloudflareTokens: clampNumber(source.maxCloudflareTokens, defaults.maxCloudflareTokens, 1, hard.maxCloudflareTokens),
    maxFinalUserMessageChars: clampNumber(
      source.maxFinalUserMessageChars,
      defaults.maxFinalUserMessageChars,
      1,
      hard.maxFinalUserMessageChars
    )
  };
}

export async function readConversationAttachmentLimits(env, overrides = {}) {
  let stored = {};
  if (env?.DB) {
    try {
      const row = await env.DB.prepare(
        "SELECT value FROM settings WHERE key = ?"
      ).bind(MODEL_SETTINGS_KEY).first();
      const settings = row?.value ? JSON.parse(row.value) : null;
      if (isObject(settings?.conversationAttachmentLimits)) {
        stored = settings.conversationAttachmentLimits;
      }
    } catch (err) {
      stored = {};
    }
  }
  return normalizeConversationAttachmentLimits({
    ...stored,
    ...(isObject(overrides) ? overrides : {})
  });
}
