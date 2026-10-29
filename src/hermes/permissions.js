// Permission policy for Hermes high-privilege tool calls.
//
// Hermes can pause a run with an approval prompt (status waiting_for_approval, SSE
// approval.request, POST /v1/runs/{id}/approval). Stage 1 is observe-only: prompts are shown
// (sanitized) but cannot be answered from the web UI; the user can only cancel the run.
// A later stage can enable responses here, per owner/project/choice, without touching the
// run state machine.

import { safeMessage } from "./errors.js";

export const HERMES_APPROVAL_POLICY = "observe_only";

export function canRespondToHermesApproval(/* { env, owner, run, prompt, choice } */) {
  return false;
}

const ALLOWED_CHOICES = new Set(["once", "session", "always", "deny"]);

export function sanitizeHermesApprovalPrompt(prompt) {
  if (!prompt || typeof prompt !== "object") return null;
  return {
    kind: "approval",
    description: safeMessage(prompt.description || "Hermes requests approval for a tool action"),
    choices: (Array.isArray(prompt.choices) ? prompt.choices : []).filter(choice => ALLOWED_CHOICES.has(choice)),
    respondable: false,
    policy: HERMES_APPROVAL_POLICY
  };
}
