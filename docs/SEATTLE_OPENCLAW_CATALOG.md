# Seattle OpenClaw Agent and base model catalog

The Worker reads the Seattle Gateway catalog over its operator WebSocket RPC. It
requests only `agents.list` and `models.list` with `{ "view": "configured" }`.
`GET /v1/models` is the Legacy HTTP agent-target list and is not used as a base
model catalog.

## Required Seattle proxy route

The Worker is configured for a WebSocket Upgrade at
`https://act.hnsnowground.cfd/gateway-ws/catalog`. The URL can be changed to
another path on the same host with the non-secret
`OPENCLAW_SEATTLE_GATEWAY_WS_URL` binding. The
reverse proxy or Cloudflare Tunnel must route that path to the **main Gateway
WebSocket listener**, preserve `Upgrade: websocket` and `Connection: Upgrade`,
and keep the existing `Seattle act` Cloudflare Access Service Auth policy on
the route. The Worker supplies the existing `ACT_CF_ACCESS_CLIENT_ID` and
`ACT_CF_ACCESS_CLIENT_SECRET` headers on this Seattle-only upstream request.
The Gateway RPC fetch has its own host-scoped Access header injection; the
Legacy HTTP helper is limited to `/v1/*` and is not used for this path.
Gateway authentication uses the existing server-side
`OPENCLAW_SEATTLE_API_KEY` in the signed `connect` frame. None of these values
are returned by `/api/openclaw/catalog/seattle`.

The remote WebSocket client requests `operator.read` and rejects a connection
unless the negotiated scope is exactly `operator.read`. It signs the Gateway's
`connect.challenge` with a stable Ed25519 device identity derived from the
Worker's existing `SESSION_SECRET` and Seattle API key. The first remote
connection may need Gateway device pairing approval. Review the exact pending
request on the Seattle host with `openclaw devices list`, then approve its
request ID with `openclaw devices approve <requestId>`. Do not broaden its
scope beyond `operator.read`.

On 2026-10-16 a non-deployed Worker version tested the existing proxy with
the production Worker secrets. WebSocket Upgrade returned HTTP 404 at `/`,
HTTP 301 at `/v1`, and HTTP 404 at `/v1/`. No `connect.challenge` arrived.
The dedicated `/gateway-ws/catalog` path also returned HTTP 404 through a
non-deployed Worker preview. Without Access credentials, that same path returned
HTTP 302 to `chasewen.cloudflareaccess.com`; the preview Worker sent both
Access service-token headers and reached the upstream 404. Thus the new path
is Access-protected and the Worker injects credentials there, even though the
older Legacy HTTP header helper is restricted to `/v1/*`.
The preview catalog endpoint returns HTTP 401 without an application session.
Before the route was installed, an authenticated caller received only
`websocket_proxy_missing` plus upstream HTTP 404. The local repository has no
Nginx or Tunnel configuration, and the available Cloudflare account's only
listed Tunnel is down with a single `http_status:404` fallback.

The Seattle host inspection subsequently located the Gateway at
`127.0.0.1:18789` and the HTTPS reverse proxy at
`/etc/nginx/conf.d/act.conf`. That file originally proxied only `/v1/` to the
Gateway. The reviewed route installer `ops/seattle/install_catalog_ws.py` was
run as root on Seattle. It inserted an exact Upgrade-only location, passed
`nginx -t`, and reloaded Nginx. The backup is
`/etc/nginx/conf.d/act.conf.before-catalog-ws-20261016T063528Z` outside the
`.conf` include pattern. A new non-deployed Worker preview reached the Gateway
handshake and received `gateway_pairing_required`. The exact pending device
request was reviewed as role `operator` with only `operator.read`, then
approved. The next preview request completed the signed handshake and both
catalog RPCs. Unauthenticated access to the path still redirects to
Cloudflare Access.

The real Seattle Gateway response contained Agent IDs `main`, `glm51`,
`glm52`, and `kimi-for-coding`. Its configured base model IDs were
`zai/glm-5.2`, `kimi/kimi-for-coding`, `openai/gpt-6-astra`,
`openai/gpt-5.6-sol`, `zai/glm-5-turbo`, and `zai/glm-5.1`.
An authenticated preview `POST` returned `fresh`; a subsequent `GET` retained
the same `syncedAt` from D1, and a further `POST` advanced `syncedAt` through
a forced refresh. The response sent `Cache-Control: no-store`, and an
unauthenticated catalog request returned HTTP 401. The Gateway reports both
`openai/*` entries as available, but the operator confirmed they are unusable.
`OPENCLAW_SEATTLE_DISABLED_MODEL_PROVIDERS=openai` marks them unavailable in
the catalog and rejects their use as Seattle base model overrides, including
when serving an existing D1 cache entry. Other provider models are unchanged.
An updated non-deployed preview returned both OpenAI entries with
`available: false` while the other four remained `true`. A separate
non-deployed preview pointed the WSS URL at a missing same-host path: a forced
refresh received upstream HTTP 404 and returned HTTP 200 `stale` with the
previous four Agents and six base model IDs. The stale response preserved
OpenAI `available: false` and `Cache-Control: no-store`.
The preview results above were obtained before deployment. On 2026-10-16,
the tested code was deployed as production Worker version
`c0db7a2e-7bca-4c7a-8f3e-125106d189eb`. Post-deploy checks returned HTTP
401 for an unauthenticated catalog request and HTTP 200 `fresh` for both
authenticated GET and forced POST. The POST advanced `syncedAt`, returned
the four Agent IDs and six base model IDs above, marked both `openai/*`
entries unavailable, and sent `Cache-Control: no-store`.

## Application behavior

- Model settings now keep two independent selections under one persisted
  settings object. `classic` continues to use the saved Provider/model route;
  `openclaw-agent` resolves an allowlisted instance, Agent, and optional base
  model override for each send. Switching modes does not rewrite either saved
  selection or historical message metadata.
- The current-model summary is derived from the active mode and selectors. For
  `Agent default model`, the displayed base model is the selected Agent's
  current `defaultModel` from the Gateway catalog. It is not hard-coded.
- In Agent mode the browser identifies only the configured instance and chosen
  catalog IDs. The Worker pins `openclaw-seattle` to
  `https://act.hnsnowground.cfd/v1` and `OPENCLAW_SEATTLE_API_KEY`; values in a
  browser-supplied provider object cannot replace either binding. Unknown
  OpenClaw instances are rejected before any upstream request, preventing the
  instance controls from becoming an arbitrary URL proxy.
- Removing an OpenClaw instance from application settings removes only its
  local connection record. It does not call the Gateway or alter any remote
  Agent or model configuration.
- Authenticated `GET /api/openclaw/catalog/seattle` reads the five-minute D1
  cache or refetches it when expired. Authenticated `POST` forces a Gateway
  `models.list` refresh and updates the D1 cache.
- The response contains only Agent IDs/names/default model IDs and configured
  base model IDs/names/availability. Raw Gateway metadata and credentials stay
  server-side. A failed refresh retains the last good catalog with `stale`
  status and a safe HTTP status diagnostic where available.
- Legacy SSE sends `model: "openclaw/<agentId>"`; an optional base model
  selection becomes the `x-openclaw-model` header. The selection is per turn,
  so a conversation can use a different Agent or base model on the next turn.
- Existing OpenClaw model entries remain valid when live catalog sync is
  unavailable. Ordinary providers, conversation history, and Codex
  Effort/Speed controls use their existing paths.

References: [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol),
[OpenClaw model selection](https://docs.openclaw.ai/gateway/openai-http-api),
[Cloudflare Workers WebSocket clients](https://developers.cloudflare.com/workers/examples/websockets/).
