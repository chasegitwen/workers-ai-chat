import { createHash, createHmac, createPrivateKey, createPublicKey, sign } from "node:crypto";

const GATEWAY_ORIGIN = "https://act.hnsnowground.cfd";
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const CLIENT_PLATFORM = "cloudflare-workers";
const SCOPES = ["operator.read"];

export class SeattleGatewayError extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function gatewayUrl(env) {
  const raw = String(env.OPENCLAW_SEATTLE_GATEWAY_WS_URL || GATEWAY_ORIGIN + "/");
  let url;
  try { url = new URL(raw); } catch { throw new SeattleGatewayError("websocket_url_invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "act.hnsnowground.cfd"
    || url.username || url.password || url.search || url.hash) {
    throw new SeattleGatewayError("websocket_url_invalid");
  }
  return url.toString();
}

function gatewayDevice(env) {
  const secret = String(env.OPENCLAW_SEATTLE_API_KEY || "").trim();
  const salt = String(env.SESSION_SECRET || "").trim();
  if (!secret || !salt) throw new SeattleGatewayError("gateway_credentials_missing");
  const seed = createHmac("sha256", salt)
    .update("web-ai-assistant:seattle-catalog-device:v1:")
    .update(secret)
    .digest();
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKeyRaw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  return {
    id: createHash("sha256").update(publicKeyRaw).digest("hex"),
    publicKey: publicKeyRaw.toString("base64url"),
    privateKey,
    secret
  };
}

function connectFrame(challenge, device) {
  const nonce = String(challenge?.nonce || "");
  const signedAt = challenge?.ts;
  if (!nonce || !Number.isSafeInteger(signedAt) || signedAt < 0) {
    throw new SeattleGatewayError("gateway_challenge_invalid");
  }
  const payload = [
    "v3", device.id, CLIENT_ID, CLIENT_MODE, "operator", SCOPES.join(","),
    String(signedAt), device.secret, nonce, CLIENT_PLATFORM, ""
  ].join("|");
  return {
    type: "req", id: "connect", method: "connect",
    params: {
      minProtocol: 4, maxProtocol: 4,
      client: { id: CLIENT_ID, version: "1.0.0", platform: CLIENT_PLATFORM, mode: CLIENT_MODE },
      role: "operator", scopes: SCOPES,
      caps: ["agent-kind", "model-selection-policy"],
      commands: [], permissions: {},
      auth: { token: device.secret },
      locale: "en-US", userAgent: "web-ai-assistant/1.0",
      device: {
        id: device.id, publicKey: device.publicKey,
        signature: sign(null, Buffer.from(payload), device.privateKey).toString("base64url"),
        signedAt, nonce
      }
    }
  };
}

function classifyConnectError(frame) {
  const code = String(frame?.error?.details?.code || frame?.error?.code || "");
  if (code.includes("PAIRING")) return "gateway_pairing_required";
  if (code.includes("AUTH") || code.includes("DEVICE")) return "gateway_auth_failed";
  if (code.includes("PROTOCOL")) return "gateway_protocol_mismatch";
  return "gateway_connect_failed";
}

export async function readSeattleGatewayCatalog(env, { refreshModels = false } = {}) {
  const device = gatewayDevice(env);
  const headers = {
    Upgrade: "websocket",
    "CF-Access-Client-Id": String(env.ACT_CF_ACCESS_CLIENT_ID || ""),
    "CF-Access-Client-Secret": String(env.ACT_CF_ACCESS_CLIENT_SECRET || "")
  };
  if (!headers["CF-Access-Client-Id"] || !headers["CF-Access-Client-Secret"]) {
    throw new SeattleGatewayError("access_credentials_missing");
  }
  const url = gatewayUrl(env);
  let response;
  try {
    response = await fetch(url, {
      headers, redirect: "manual", signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new SeattleGatewayError("websocket_unreachable");
  }
  if (!response.webSocket) {
    if (response.status === 302 || response.status === 401 || response.status === 403) {
      throw new SeattleGatewayError("access_denied", response.status);
    }
    throw new SeattleGatewayError("websocket_proxy_missing", response.status);
  }
  const socket = response.webSocket;
  socket.accept();
  return new Promise((resolve, reject) => {
    let settled = false;
    let stage = "challenge";
    let agents = null;
    let firstAgentId = "";
    const pendingModelRequests = new Map();
    const modelsByAgent = {};
    const timer = setTimeout(() => fail("gateway_timeout"), 30000);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000, "catalog complete"); } catch {}
      resolve(value);
    }
    function fail(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000, "catalog failed"); } catch {}
      reject(new SeattleGatewayError(code));
    }
    socket.addEventListener("message", event => {
      if (settled || typeof event.data !== "string") return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { fail("gateway_protocol_invalid"); return; }
      if (stage === "challenge" && frame.type === "event" && frame.event === "connect.challenge") {
        try { socket.send(JSON.stringify(connectFrame(frame.payload, device))); }
        catch { fail("gateway_challenge_invalid"); return; }
        stage = "connect";
        return;
      }
      if (stage === "connect" && frame.type === "res" && frame.id === "connect") {
        if (!frame.ok || frame.payload?.type !== "hello-ok") {
          fail(classifyConnectError(frame)); return;
        }
        const scopes = frame.payload?.auth?.scopes || [];
        if (!Array.isArray(scopes) || scopes.length !== 1 || scopes[0] !== "operator.read") {
          fail("gateway_scope_not_read_only"); return;
        }
        socket.send(JSON.stringify({ type: "req", id: "agents", method: "agents.list", params: {} }));
        stage = "agents";
        return;
      }
      if (stage === "agents" && frame.type === "res" && frame.id === "agents") {
        if (!frame.ok) { fail("agents_list_failed"); return; }
        agents = frame.payload;
        const agentRows = Array.isArray(agents) ? agents : (Array.isArray(agents?.agents) ? agents.agents : []);
        const agentIds = [...new Set(agentRows
          .map(row => String(row?.id || row?.agentId || "").trim())
          .filter(Boolean))];
        if (!agentIds.length) { fail("agents_list_empty"); return; }
        firstAgentId = agentIds[0];
        stage = "models";
        agentIds.forEach((agentId, index) => {
          const requestId = "models-" + index;
          pendingModelRequests.set(requestId, agentId);
          socket.send(JSON.stringify({ type: "req", id: requestId, method: "models.list",
            params: { agentId, view: "configured", ...(refreshModels ? { refresh: true } : {}) } }));
        });
        return;
      }
      if (stage === "models" && frame.type === "res" && pendingModelRequests.has(frame.id)) {
        if (!frame.ok) { fail("models_list_failed"); return; }
        const agentId = pendingModelRequests.get(frame.id);
        pendingModelRequests.delete(frame.id);
        modelsByAgent[agentId] = frame.payload;
        if (!pendingModelRequests.size) {
          finish({ agents, models: modelsByAgent[firstAgentId], modelsByAgent });
        }
      }
    });
    socket.addEventListener("close", () => fail("gateway_closed"));
    socket.addEventListener("error", () => fail("gateway_socket_error"));
  });
}
