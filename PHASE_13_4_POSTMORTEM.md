# Phase 13.4 Postmortem

OpenClaw Provider Runtime Setting

Date: 2026-07-02

## Commit timeline

- `53231fb` - Add OpenClaw provider runtime mode setting.
- `f77fa2e` - Fix OpenClaw execution mode option layout.
- `ec3fe93` - Normalize completed OpenClaw bridge progress.
- `0492d2a` - Fix OpenClaw Bridge agent routing.
- `abe95fa` - Fix OpenClaw GLM agent alias routing.
- `fbaba6b` - Fix OpenClaw Bridge snake case payload.
- `7d20c90` - Fix OpenClaw execution mode persistence.
- `78a6e38` - Fix OpenClaw execution mode merge precedence.
- `651b920` - Merge Phase 13.4.4 merge precedence fix to `main`.
- `stable-phase13.4-openclaw-provider-runtime-mode` - Stable tag after initial provider runtime mode and progress fixes.
- `stable-phase13.4.4-openclaw-mode-merge-precedence` - Stable tag after merge precedence fix.

---

# 1. Original Goal

Phase 13.4 moved the OpenClaw Bridge switch away from the global environment variable:

`OPENCLAW_BRIDGE_MODE`

and into a Provider Runtime Setting:

- `Legacy SSE`
- `Native Bridge`

The intended behavior was per-provider control. For example, Hillsboro could run with Native Bridge while Seattle remained on Legacy SSE. This was necessary because OpenClaw deployments can have different runtime readiness, API behavior, and bridge availability.

The provider config gained:

`openclawExecutionMode?: "legacy" | "bridge"`

The setting was intended to apply only to OpenClaw providers. Other providers such as OpenAI, Workers AI, Anthropic, OpenRouter, and Google were not supposed to change.

---

# 2. Initial Design

The initial precedence was:

Provider Setting

down to

ENV fallback

down to

Legacy SSE

The architecture was chosen for compatibility. Existing deployments already depended on `OPENCLAW_BRIDGE_MODE`, so removing it immediately would have been risky. The provider setting became the long-term source of truth, while the ENV variable remained as a compatibility fallback for old provider configs without `openclawExecutionMode`.

The desired rule was:

- If provider is not OpenClaw, never use OpenClaw Bridge.
- If OpenClaw provider has `openclawExecutionMode`, use it.
- If OpenClaw provider is missing the setting, fall back to `OPENCLAW_BRIDGE_MODE`.
- If neither exists, default to Legacy SSE.

---

# 3. Problems Encountered

## Problem 1

OpenClaw Bridge progress remained 0%.

### Symptoms

Native Bridge tasks could finish successfully and show a terminal status such as `completed`, but the UI still displayed progress as `0%`.

### Root cause

The Bridge task status normalization kept the remote progress value literally. A terminal success state with `progress: 0` was displayed as 0 even though the task was complete.

### Fix

Bridge status normalization was updated so terminal success states normalize to 100:

- `completed`
- `done`
- `success`

Failed states preserve existing progress when present, otherwise use 0. Running and queued states continue using remote or existing progress.

### Commit

`ec3fe93` - Normalize completed OpenClaw bridge progress.

### Verification

Bridge client tests confirmed:

- completed task displays `100`
- failed task does not become `100`
- running and queued tasks keep appropriate progress

---

## Problem 2

All OpenClaw models answered as Codex.

### Symptoms

Selecting non-main OpenClaw models such as GLM 5.1, Kimi for Coding, or GLM 5.2 still produced replies like:

`我是 Codex，基于 GPT-5 的编码代理。`

OpenClaw-side audits showed that explicit `agent_id` routing worked correctly. The issue was therefore on the web-ai-assistant side.

### Investigation

The Native Bridge request path was inspected for selected provider/model resolution, model id preservation, Bridge payload construction, and session key construction.

The selected model ids were expected to map as:

- `openclaw/main` to `main`
- `openclaw/glm51` to `glm51`
- `openclaw/kimi-for-coding` to `kimi-for-coding`
- `openclaw/glm5-2` to `glm5-2`

### Root cause

Native Bridge submitted empty routing fields:

- `agentId`
- `sessionId`
- `sessionKey`

The Bridge therefore defaulted to main, which was configured as a Codex/GPT-5 style agent.

### Fix

The Native Bridge path now derives a canonical OpenClaw agent id from selected model data and passes scoped routing fields:

- `agentId`
- `sessionKey`
- `sessionId`

Session keys are scoped by agent:

- `agent:main:<conversationId>`
- `agent:glm51:<conversationId>`
- `agent:kimi-for-coding:<conversationId>`
- `agent:glm5-2:<conversationId>`

Legacy SSE was left unchanged.

### Commit

`0492d2a` - Fix OpenClaw Bridge agent routing.

### Verification

Tests covered:

- main routes as `main`
- GLM 5.1 routes as `glm51`
- Kimi routes as `kimi-for-coding`
- GLM 5.2 routes as `glm5-2`
- session key and session id include the same agent id
- non-OpenClaw providers cannot enter Bridge

---

## Problem 3

Bridge payload field naming.

### Symptoms

Even after canonical agent routing was added, Bridge still appeared to ignore the selected agent in some cases and default to main.

### Root cause

The Bridge client submitted camelCase fields:

- `agentId`
- `sessionKey`
- `sessionId`

The Bridge runtime expected snake_case fields:

- `agent_id`
- `session_key`
- `session_id`

### Fix

Bridge task submission now includes both naming styles during the migration window:

- `agentId`
- `agent_id`
- `sessionKey`
- `session_key`
- `sessionId`
- `session_id`

This preserved backward compatibility while satisfying the Bridge API.

### Commit

`fbaba6b` - Fix OpenClaw Bridge snake case payload.

### Verification

Bridge client tests asserted that request bodies include both camelCase and snake_case fields, with values matching the canonical agent id and scoped session key.

---

## Problem 4

Seattle unexpectedly entered Native Bridge.

### Symptoms

Seattle was expected to run Legacy SSE, but production task records showed Seattle entering Native Bridge.

### Expected

OpenClaw Seattle:

- `openclawExecutionMode: "legacy"`
- Legacy SSE runtime

OpenClaw Hillsboro:

- `openclawExecutionMode: "bridge"`
- Native Bridge runtime

### Actual

Seattle provider config did not contain `openclawExecutionMode`. The UI displayed Legacy SSE visually, but the persisted D1 config remained undefined.

At runtime:

- provider setting was undefined
- `OPENCLAW_BRIDGE_MODE` fallback was active
- Bridge mode became enabled

### Root cause

Seattle provider was missing:

`openclawExecutionMode: "legacy"`

The UI displayed Legacy SSE as a default radio selection, but that visual default was not evidence that the provider config had persisted the value.

The runtime saw:

`provider.openclawExecutionMode === undefined`

and therefore used the ENV fallback. Since the environment fallback enabled Bridge, Seattle entered Native Bridge.

### Fix

Two fixes were applied.

Production D1 hotfix:

- update `openclaw-seattle` to include `openclawExecutionMode: "legacy"`
- confirm `openclaw-hillsboro` remained `openclawExecutionMode: "bridge"`

Persistence fix:

- save OpenClaw providers with explicit `legacy` or `bridge`
- normalize missing OpenClaw provider settings to `legacy` on settings load/save
- preserve `legacy` and `bridge` through settings round trips

### Commit

`7d20c90` - Fix OpenClaw execution mode persistence.

### Verification

Remote D1 confirmed:

- `openclaw-seattle.openclawExecutionMode = "legacy"`
- `openclaw-hillsboro.openclawExecutionMode = "bridge"`

Tests confirmed:

- missing OpenClaw mode normalizes to `legacy`
- `legacy` round trips
- `bridge` round trips
- non-OpenClaw providers do not receive the OpenClaw setting

---

## Problem 5

UI default was misleading.

The provider edit modal displayed `Legacy SSE` when `openclawExecutionMode` was missing. This matched the intended visual default but was misleading operationally because missing persisted config still triggered the compatibility fallback path.

The confusion was:

- UI showed Legacy SSE
- D1 persisted config had no `openclawExecutionMode`
- runtime treated missing as undefined
- undefined allowed `OPENCLAW_BRIDGE_MODE` to influence routing

This made it look like Seattle was configured for Legacy SSE when it was actually still relying on fallback behavior.

The lesson was that UI defaults cannot be treated as persisted configuration. Provider config must store the selected runtime mode explicitly.

---

## Problem 6

Hillsboro unexpectedly fell back to Legacy SSE.

### Symptoms

After the persistence fix:

- Seattle Legacy SSE worked correctly
- Hillsboro was set to Native Bridge in UI and D1
- Hillsboro task records showed `bridge_mode_enabled = 0`
- Bridge routing fields were null

### Root cause

The runtime catalog merge had a precedence bug.

D1 persisted provider:

- `openclaw-hillsboro`
- `openclawExecutionMode: "bridge"`

Transient request/custom provider:

- same provider id
- missing `openclawExecutionMode`

The normalization logic filled missing OpenClaw mode as `legacy`. Then `mergeProviders()` allowed the transient provider to overwrite the persisted provider, turning Hillsboro from `bridge` into `legacy` during runtime catalog construction.

### Fix

`mergeProviders()` was changed so persisted provider runtime settings win unless the incoming provider explicitly specifies a valid execution mode.

The corrected merge rule:

- incoming `"legacy"` overrides existing
- incoming `"bridge"` overrides existing
- incoming missing or undefined preserves existing

`customModelConfig` may pass through `openclawExecutionMode` only when explicitly present. Missing custom config does not default to `legacy` before merge.

### Commit

`78a6e38` - Fix OpenClaw execution mode merge precedence.

### Verification

Tests confirmed:

- saved Hillsboro `bridge` plus request provider missing mode remains `bridge`
- saved Hillsboro `bridge` plus custom model config missing mode remains `bridge`
- saved Seattle `legacy` remains `legacy`
- explicit incoming `legacy` overrides saved `bridge`
- explicit incoming `bridge` overrides saved `legacy`
- Bridge client tests continued to pass

Production deployment:

- Worker Version ID `4cc3071d-61b9-4e75-a73a-45913369a9d0`

---

# 4. Root Cause Analysis

The largest architectural lesson was that three different kinds of state were being mixed:

- persisted configuration
- transient request data
- runtime normalization

Persisted configuration represents user intent. It is durable and should have high precedence.

Transient request data represents the current UI selection payload. It may be partial, stale, or intentionally minimal.

Runtime normalization is useful for safety, but it can be dangerous if it converts absence into a concrete value too early. In this phase, missing transient OpenClaw mode was normalized into `legacy`, then treated as an intentional override of persisted `bridge`.

The correct architecture is to normalize persisted settings into explicit values, but preserve absence in transient request data until merge precedence is resolved.

Another lesson was that compatibility fallbacks are useful but dangerous. `OPENCLAW_BRIDGE_MODE` helped old configs keep working, but it also made missing provider settings operationally significant.

---

# 5. Final Architecture

Text diagram:

Provider Settings in D1

down to

Runtime Catalog

down to

Request Merge

down to

Bridge Decision

down to

Native Bridge or Legacy SSE

Expanded flow:

Provider Settings in D1

- durable source of provider runtime intent
- OpenClaw providers should have explicit `openclawExecutionMode`
- `legacy` and `bridge` are both persisted values

Runtime Catalog

- loads saved providers
- normalizes missing persisted OpenClaw setting to `legacy`
- keeps provider model mappings and base URLs

Request Merge

- merges request providers and custom model config
- transient missing mode does not override persisted mode
- explicit transient mode can override when intentionally provided

Bridge Decision

- calls `shouldUseOpenClawBridge(provider, env)`
- non-OpenClaw providers always return false
- OpenClaw provider setting wins
- ENV is only compatibility fallback when no provider setting exists

Runtime

- `bridge` enters OpenClaw Native Bridge
- `legacy` enters Legacy SSE

Final precedence:

Persisted Provider Setting

greater than

Explicit transient Provider Setting

greater than

Environment fallback for old config

greater than

Legacy SSE default

---

# 6. Lessons Learned

- Never normalize transient provider state into persisted defaults before merge precedence is resolved.
- Do not use UI defaults as evidence of persisted configuration.
- Always verify D1 persisted values when debugging provider behavior.
- Bridge APIs should support both camelCase and snake_case during migration.
- Persisted settings should always have higher priority than request defaults.
- Missing config and explicit `legacy` are not the same during runtime merge.
- Runtime task records are essential for verifying whether Bridge was entered.
- Debugging provider routing requires checking provider id, model id, upstream model name, base URL, agent id, session key, and runtime mode together.
- Compatibility ENV fallbacks should be treated as migration tools, not long-term primary switches.
- Per-provider runtime settings need tests across load, save, request merge, and runtime decision paths.

---

# 7. Impact on Future Work

Phase 14 should treat provider runtime settings as durable configuration with explicit precedence rules.

For OpenClaw Bridge, future work should continue separating:

- provider configuration
- model selection
- Bridge runtime payload
- task status normalization
- deployment-specific routing

For Vultr migration, this phase matters because multiple OpenClaw deployments may coexist. A multi-deployment system cannot rely on one global bridge mode or one global bridge URL. Provider-specific execution mode and provider-specific routing need to remain first-class concepts.

For Provider Runtime Setting work, this phase established that UI state, local settings, D1 settings, and runtime catalog state all need round-trip tests.

For Multi-Bridge architecture, this phase shows that routing must be explicit:

- provider id selects deployment
- model id selects agent
- provider runtime setting selects Bridge or Legacy
- Bridge payload includes canonical agent and scoped session

---

# 8. Final Stable State

Expected production state:

Hetzner or Hillsboro OpenClaw:

- Native Bridge
- `openclawExecutionMode: "bridge"`
- Bridge task records should show `bridge_mode_enabled = 1`
- Bridge task records should include `bridge_agent_id`
- Bridge task records should include `bridge_session_key`

Seattle OpenClaw:

- Legacy SSE
- `openclawExecutionMode: "legacy"`
- task records should show `bridge_mode_enabled = 0`
- Bridge task id and Bridge routing fields should remain null

Bridge routing:

- selected OpenClaw model maps to canonical agent id
- session key and session id include the canonical agent id
- Bridge payload includes both camelCase and snake_case routing fields

Provider Runtime Setting:

- persisted provider setting is the source of truth
- global ENV is only compatibility fallback
- non-OpenClaw providers cannot enter OpenClaw Bridge

Important commit hashes:

- `53231fb` - Provider runtime mode setting introduced
- `ec3fe93` - Bridge progress normalization
- `0492d2a` - Bridge agent routing
- `fbaba6b` - Bridge snake_case payload
- `7d20c90` - Execution mode persistence
- `78a6e38` - Execution mode merge precedence
- `651b920` - Final merge to main for Phase 13.4.4

Important deployment milestones:

- Version ID `173ec681-00d3-4e2d-85cf-98785c5cf638` - deployed execution mode persistence fix.
- Version ID `4cc3071d-61b9-4e75-a73a-45913369a9d0` - deployed merge precedence fix.

Stable tags:

- `stable-phase13.4-openclaw-provider-runtime-mode`
- `stable-phase13.4.4-openclaw-mode-merge-precedence`

Final state summary:

OpenClaw Bridge mode is now controlled by provider runtime setting. Hillsboro can run Native Bridge while Seattle remains Legacy SSE. `OPENCLAW_BRIDGE_MODE` remains only as a compatibility fallback for old configs, not as the primary long-term switch.
