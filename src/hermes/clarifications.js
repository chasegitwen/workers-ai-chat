// Canonical Hermes clarification prompts. These are questions, never approval decisions.

import { redactSecrets } from "./errors.js";

export const HERMES_CLARIFY_MAX_ANSWER_CHARS = 32000;

function displayText(value, max = 4000) {
  return redactSecrets(String(value ?? ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function clarifyRequestId(prompt) {
  const value = String(prompt?.prompt_id || prompt?.request_id || prompt?.requestId || "").trim();
  return value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : "";
}

function clarifyGeneration(prompt, fallbackGeneration = null) {
  const value = prompt?.execution_generation ?? prompt?.executionGeneration ?? fallbackGeneration;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function canRespondToHermesClarify({ capabilities, run, prompt } = {}) {
  return Boolean(
    capabilities?.features?.run_clarify_response
    && capabilities?.features?.clarify_events
    && run?.status === "waiting_for_clarification"
    && clarifyRequestId(prompt)
    && clarifyGeneration(prompt, run?.execution_generation) !== null
  );
}

export function sanitizeHermesClarifyPrompt(prompt, options = {}) {
  if (!prompt || typeof prompt !== "object") return null;
  const source = prompt.payload && typeof prompt.payload === "object"
    ? { ...prompt, ...prompt.payload }
    : prompt;
  const requestId = clarifyRequestId(source);
  const executionGeneration = clarifyGeneration(source, options.executionGeneration);
  const args = source.args && typeof source.args === "object" ? source.args : {};
  const question = displayText(source.question || source.text || source.prompt || args.question || args.text || "", 8000);
  if (!requestId || executionGeneration === null || !question) return null;
  return {
    kind: "clarify",
    status: options.responding ? "responding" : "pending",
    requestId,
    executionGeneration,
    question,
    respondable: Boolean(options.respondable),
    responding: Boolean(options.responding)
  };
}
