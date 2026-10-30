// Permission policy for Hermes high-privilege tool calls.
//
// The web surface deliberately exposes only a single-use grant and denial. Hermes also
// understands session/permanent grants, but forwarding either from a browser would widen the
// user's decision beyond the operation shown in the approval card.

import { redactSecrets, safeCode, safeMessage } from "./errors.js";

export const HERMES_APPROVAL_POLICY = "once_or_deny";
export const HERMES_APPROVAL_CHOICES = Object.freeze(["once", "deny"]);

function displayText(value, max = 2000, preserveLines = false) {
  let text = redactSecrets(String(value ?? ""));
  if (preserveLines) {
    text = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  } else {
    text = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  }
  return text.trim().slice(0, max);
}

function approvalRequestId(prompt) {
  const value = String(prompt?.prompt_id || prompt?.request_id || prompt?.requestId || "").trim();
  return value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : "";
}

function approvalGeneration(prompt, fallbackGeneration = null) {
  const value = prompt?.execution_generation ?? prompt?.executionGeneration ?? fallbackGeneration;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function canRespondToHermesApproval({ capabilities, run, prompt, choice } = {}) {
  const advertisedChoices = Array.isArray(prompt?.choices) ? prompt.choices : [];
  const choiceAllowed = choice
    ? advertisedChoices.includes(choice)
    : HERMES_APPROVAL_CHOICES.every(item => advertisedChoices.includes(item));
  return Boolean(
    capabilities?.features?.run_approval_response
    && capabilities?.features?.approval_events
    && run?.status === "waiting_for_approval"
    && approvalRequestId(prompt)
    && approvalGeneration(prompt, run?.execution_generation) !== null
    && (!choice || HERMES_APPROVAL_CHOICES.includes(choice))
    && choiceAllowed
  );
}

export function sanitizeHermesApprovalPrompt(prompt, options = {}) {
  if (!prompt || typeof prompt !== "object") return null;
  const source = prompt.payload && typeof prompt.payload === "object"
    ? { ...prompt, ...prompt.payload }
    : prompt;
  const requestId = approvalRequestId(source);
  const executionGeneration = approvalGeneration(source, options.executionGeneration);
  const args = source.args && typeof source.args === "object" ? source.args : {};
  const choices = HERMES_APPROVAL_CHOICES.filter(choice => {
    const advertised = Array.isArray(source.choices) ? source.choices : [];
    return advertised.length === 0 || advertised.includes(choice);
  });
  const command = displayText(source.command || args.command || source.preview || "", 2000, true);
  const tool = safeCode(String(source.tool || source.tool_name || source.name || "").toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")) || "tool";
  const target = displayText(source.target || source.host || source.hostname || source.url
    || args.target || args.host || args.hostname || args.url || "", 500);
  const description = safeMessage(source.description || "Hermes requests approval for a tool action");
  const risk = safeMessage(source.risk || source.risk_description || source.risk_reason || description);
  const respondable = Boolean(options.respondable && requestId && executionGeneration !== null
    && choices.includes("once") && choices.includes("deny"));
  return {
    kind: "approval",
    requestId,
    executionGeneration,
    tool,
    command,
    target,
    description,
    risk,
    choices,
    respondable,
    responding: Boolean(options.responding),
    policy: HERMES_APPROVAL_POLICY
  };
}
