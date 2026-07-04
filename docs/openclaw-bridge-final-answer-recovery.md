# OpenClaw Bridge Final Answer Recovery Milestone

This top section is the canonical project milestone record. A historical draft may remain below for context.

## Milestone Status

Current `main` is pushed to `origin/main`.

Important commits:

- `489186d` - `Fix Bridge final_answer compatibility`
- `d1bcc6a` - `Fix Bridge suspect incomplete classification`

Important deployments:

- `760cdcf6-a058-4c99-b9ca-69fb30b1e834` for `489186d`
- `bc34e1cd-1e10-4cff-95f7-51abc09bd5da` for `d1bcc6a`

Worker URL:

- `https://web-ai-assistant.chasewen.workers.dev`

## Background Problem

OpenClaw Bridge `/result` previously could expose the first assistant message rather than the final complete assistant answer. web-ai-assistant could then persist an intermediate assistant lead-in as the final conversation message.

The most important reproduced pattern was a short GLM-style lead-in: the assistant first reports that scheduled tasks look healthy, then says it will check each recent execution record and find the most recent run. That message is progress text, not a final answer.

## OpenClaw Bridge Completed

Hillsboro Bridge Server milestone:

- Version: `14.0-final-recovery`
- Files: `lib.mjs`, `server.mjs`, `test-recovery.mjs`
- Added `classifyAssistantMessage()`
- Added `findRecoveredAssistantMessage()`
- On final `handleEvent`, Bridge uses `chat.history` to select the last valid assistant message
- `/result` returns `final_answer`, `result`, `text`, `messages`, `events`, and `metadata`
- OpenClaw Bridge tests: `46/46 passed`

## web-ai-assistant Completed

Completed web-ai-assistant behavior:

- Bridge client consumes result fields in this order: `final_answer -> result -> text`
- `result` outranks `text/content/message` when `final_answer` is absent
- Bridge completed tasks can still enter the recovery/update path when `assistant_message_id` already exists
- Existing placeholder or `suspect_incomplete` assistant content can be updated instead of treated as an unconditional duplicate
- `suspect_incomplete` classification now covers mid-sentence lead-ins such as "current status ... let me check ... find out ..."
- Completion markers protect final answers, including phrases equivalent to "here is", "summary", "checked, done", "results as follows", and "completion status as follows"

## Root Cause

The core web-ai-assistant failure was:

1. D1 had an existing `assistant_message_id`.
2. The existing assistant content was a short intermediate lead-in.
3. `classifyOpenClawBridgeResultFinality()` misclassified it as `final`.
4. `src/api/chat.js` treated it as a duplicate and returned early.
5. The handler did not continue to call Bridge `/result`.
6. The final Bridge answer could not overwrite the old short assistant message.

## Tests

web-ai-assistant tests:

- `npx vitest run test\openclawBridgeClient.spec.js --pool threads --reporter verbose`
- Latest result: `26/26 passed`

Integration scenarios covered:

- Long-running task validation passed
- Multiple Activity events
- Multiple Assistant messages
- Tool calls and observations
- Model fallback: selected `openai/gpt-5.5`, actual `zai/glm-5` after rate limit / failover
- Final answer should overwrite or supersede intermediate lead-in text

## Follow-Up Notes

Ownership boundary:

- OpenClaw Bridge Server issues belong on the OpenClaw side.
- web-ai-assistant Bridge client and chat consumption issues belong in this repository.

Operational notes:

- For Seattle or Vultr Bridge deployments, sync the Hillsboro `14.0-final-recovery` behavior.
- Keep `final_answer` as the preferred client field.
- Keep `result` and `text` as compatibility fields.
- Do not treat `assistant_message_id` as an unconditional duplicate for Bridge tasks.
- Next phase can consider a Conversation / History API for direct full-history recovery.

---

# Historical Draft

## Background

OpenClaw Bridge task execution can produce a multi-stage conversation:

1. Assistant lead-in or placeholder
2. Activity / tool execution
3. Assistant progress update
4. More Activity / tool execution
5. Final complete assistant answer

During integration, the Bridge `/result` flow previously exposed or selected the first assistant message instead of the last complete assistant answer. As a result, web-ai-assistant saved intermediate lead-in text as the final assistant message, for example:

> 当前有 4 个定时任务，全部状态正常。让我查一下各自最近的执行记录，找出"最近一次"运行的是哪个。

This made completed Bridge tasks appear successful while the conversation still displayed an incomplete assistant reply.

## OpenClaw Bridge Work Completed

Hillsboro Bridge Server version: `14.0-final-recovery`.

Files involved on the OpenClaw Bridge side:

- `lib.mjs`
- `server.mjs`
- `test-recovery.mjs`

Implemented Bridge-side recovery behavior:

- Added `classifyAssistantMessage()`.
- Added `findRecoveredAssistantMessage()`.
- When `handleEvent` receives a final event, Bridge uses `chat.history` to select the last valid assistant message.
- `GET /v1/openclaw/tasks/:id/result` returns:
  - `final_answer`
  - `result`
  - `text`
  - `messages`
  - `events`
  - `metadata`
- `result` and `text` are kept compatible with `final_answer`.
- Recovery ignores failure placeholders, activity/tool messages, and incomplete lead-ins.

OpenClaw Bridge validation: `46/46 tests passed`.

## web-ai-assistant Work Completed

web-ai-assistant now treats Bridge result consumption as a recovery path rather than a simple duplicate check.

Completed changes:

- Bridge result extraction prefers `final_answer -> result -> text`.
- `result` now outranks `text/content/message` when `final_answer` is absent.
- Bridge completed tasks can re-fetch `/result` even if `assistant_message_id` already exists, when the existing saved assistant is recoverable.
- Existing placeholder or `suspect_incomplete` assistant messages can be updated instead of blocking recovery as duplicates.
- `suspect_incomplete` classification now catches GLM-style mid-sentence lead-ins such as:
  - `当前有...让我查一下...`
  - `查一下各自`
  - `找出`
- Completion markers protect short but final answers from being misclassified, including:
  - `以下是`
  - `总结`
  - `查完了`
  - `结果如下`
  - `完成情况如下`
  - `Here is`
  - `Summary`

Relevant commits and deployments:

- `cc5f47d` - `Fix OpenClaw Bridge final result recovery`
- `e0147e9` - `Fix OpenClaw Bridge premature finalization`
  - Deployment ID: `d61f75b2-51d3-44f3-ae8f-f6b00557e1a0`
- `489186d` - `Fix Bridge final_answer compatibility`
  - Deployment ID: `760cdcf6-a058-4c99-b9ca-69fb30b1e834`
- `d1bcc6a` - `Fix Bridge suspect incomplete classification`
  - Deployment ID: `bc34e1cd-1e10-4cff-95f7-51abc09bd5da`

web-ai-assistant validation:

- `npx vitest run test\openclawBridgeClient.spec.js --pool threads --reporter verbose`
- Latest result: `26/26 tests passed`.

## Key Root Cause

The main failure mode was not only that Bridge had once exposed the wrong assistant message. web-ai-assistant also made recovery impossible in one specific path:

1. D1 already had an `assistant_message_id`.
2. The saved assistant content was a short intermediate lead-in.
3. `classifyOpenClawBridgeResultFinality()` misclassified that lead-in as `final`.
4. `src/api/chat.js` treated the existing assistant as a normal duplicate.
5. The handler returned before calling Bridge `/result`.
6. Therefore the final Bridge answer could not overwrite the old 49-character assistant message.

The concrete reproduced saved message was:

> 当前有 4 个定时任务，全部状态正常。让我查一下各自最近的执行记录，找出"最近一次"运行的是哪个。

The corresponding `bridge_result_hash` matched that lead-in exactly, confirming that D1 had stored the intermediate assistant text as the result hash rather than the final complete answer.

## Important Test Scenarios

The recovery path should continue to cover:

- Multiple Activity events.
- Multiple Assistant messages.
- Tool calls and observations.
- Error placeholder followed by successful assistant output.
- First assistant lead-in followed by final complete assistant answer.
- Completed Bridge task with placeholder only.
- Completed Bridge task with suspect lead-in only.
- Existing real final answer, where duplicate skip should remain unchanged.
- Model fallback: selected `openai/gpt-5.5`, actual `zai/glm-5` due to rate limit.
- Final answer overwrites or supersedes intermediate lead-in text.

## Follow-Up Notes

Ownership boundary:

- OpenClaw Bridge Server issues belong on the OpenClaw side.
- web-ai-assistant Bridge client and chat consumption issues belong in this repository.

Operational notes:

- For Seattle or Vultr Bridge deployments, sync the Hillsboro `14.0-final-recovery` behavior.
- Keep `final_answer` as the preferred client field, with `result` and `text` only for compatibility.
- Do not treat an existing `assistant_message_id` as an unconditional duplicate for Bridge tasks.
- Do not classify short progress-style assistant messages as final unless they include clear completion markers.

Potential next stage:

- Add a Conversation / History API so web-ai-assistant can inspect full Bridge history directly when `/result` recovery is incomplete.
