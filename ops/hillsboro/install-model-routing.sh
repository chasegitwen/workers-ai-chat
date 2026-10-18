#!/usr/bin/env bash
set -euo pipefail

bridge_dir=/root/.openclaw/workspace/openclaw_bridge
bundle_dir=${1:-/root/hillsboro-model-routing}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)

test -f "$bundle_dir/openclaw-bridge-server.mjs"
test -f "$bundle_dir/model-routing.mjs"
test -f "$bridge_dir/server.mjs"

cp -a "$bridge_dir/server.mjs" "$bridge_dir/server.mjs.before-model-routing-$timestamp"
if test -f "$bridge_dir/model-routing.mjs"; then
  cp -a "$bridge_dir/model-routing.mjs" "$bridge_dir/model-routing.mjs.before-model-routing-$timestamp"
fi

install -m 0600 "$bundle_dir/openclaw-bridge-server.mjs" "$bridge_dir/server.mjs"
install -m 0600 "$bundle_dir/model-routing.mjs" "$bridge_dir/model-routing.mjs"

node --check "$bridge_dir/server.mjs"
node --check "$bridge_dir/model-routing.mjs"
systemctl restart openclaw-bridge
systemctl is-active --quiet openclaw-bridge

set -a
# shellcheck disable=SC1091
. /etc/openclaw-bridge.env
set +a

health=$(curl -fsS http://127.0.0.1:18793/health)
catalog=$(curl -fsS -H "Authorization: Bearer $OPENCLAW_BRIDGE_TOKEN" \
  "http://127.0.0.1:18793/v1/openclaw/catalog?refresh=1")

node -e '
const [health, catalog] = process.argv.slice(1).map(JSON.parse);
if (!health.ok || health.version !== "14.4-agent-model-policy") throw new Error("bridge health verification failed");
if (catalog.modelView !== "configured" || !catalog.agents?.length || !catalog.models?.length
    || !catalog.agents.every(agent => Array.isArray(catalog.modelsByAgent?.[agent.id]))) {
  throw new Error("Gateway catalog verification failed");
}
console.log(JSON.stringify({
  installed: true,
  version: health.version,
  gatewayConnected: health.gateway_connected,
  agents: catalog.agents.map(({ id, defaultModel }) => ({ id, defaultModel })),
  models: catalog.models.map(({ id, provider, available }) => ({ id, provider, available })),
  modelsByAgent: Object.fromEntries(Object.entries(catalog.modelsByAgent)
    .map(([agentId, models]) => [agentId, models.map(({ id }) => id)])),
  backup: process.argv[3]
}, null, 2));
' "$health" "$catalog" "$bridge_dir/server.mjs.before-model-routing-$timestamp"
