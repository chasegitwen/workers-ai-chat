import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const IDENTITY_FILE = "device-identity.json";
const AUTH_FILE = "device-auth.json";
const REQUIRED_SCOPES = Object.freeze(["operator.read", "operator.write"]);

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error("Bridge identity path is not a directory");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writePrivateJsonAtomic(file, value, { createOnly = false } = {}) {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let linked = false;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, { encoding: "utf8" });
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (createOnly) {
      fs.linkSync(temporary, file);
      linked = true;
    } else {
      fs.renameSync(temporary, file);
      linked = true;
    }
    fs.chmodSync(file, 0o600);
  } finally {
    if (!linked || createOnly) {
      try { fs.unlinkSync(temporary); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

function deriveDeviceId(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Bridge device public key is not Ed25519");
  const der = key.export({ type: "spki", format: "der" });
  const raw = der.subarray(-32);
  if (raw.length !== 32) throw new Error("Bridge device public key is invalid");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function validateIdentity(value) {
  if (!value || typeof value !== "object") throw new Error("Bridge device identity is invalid");
  const { deviceId, publicKeyPem, privateKeyPem } = value;
  if (typeof deviceId !== "string" || !/^[a-f0-9]{64}$/.test(deviceId)) {
    throw new Error("Bridge device identity has an invalid device ID");
  }
  if (typeof publicKeyPem !== "string" || typeof privateKeyPem !== "string") {
    throw new Error("Bridge device identity key material is invalid");
  }
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Bridge device private key is not Ed25519");
  }
  const canonicalPublic = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const canonicalPrivate = privateKey.export({ type: "pkcs8", format: "pem" });
  if (canonicalPublic !== publicKeyPem || deriveDeviceId(canonicalPublic) !== deviceId) {
    throw new Error("Bridge device identity key pair does not match its device ID");
  }
  return { deviceId, publicKeyPem: canonicalPublic, privateKeyPem: canonicalPrivate };
}

function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  return {
    deviceId: deriveDeviceId(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

function normalizeAuthStore(value) {
  if (value === undefined) return { version: 1, entries: [] };
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error("Bridge device auth store is invalid");
  }
  return value;
}

function scopesAreExact(scopes) {
  if (!Array.isArray(scopes)) return false;
  return [...new Set(scopes)].sort().join("\n") === [...REQUIRED_SCOPES].sort().join("\n");
}

export function createOracleIdentityStore(directory) {
  if (!path.isAbsolute(directory)) throw new Error("Bridge identity directory must be absolute");
  const identityFile = path.join(directory, IDENTITY_FILE);
  const authFile = path.join(directory, AUTH_FILE);
  let cachedIdentity;

  const loadIdentity = () => {
    ensurePrivateDirectory(directory);
    if (cachedIdentity) return cachedIdentity;
    if (fs.existsSync(identityFile)) {
      fs.chmodSync(identityFile, 0o600);
      cachedIdentity = validateIdentity(readJson(identityFile));
      return cachedIdentity;
    }
    const candidate = generateIdentity();
    try {
      writePrivateJsonAtomic(identityFile, candidate, { createOnly: true });
      cachedIdentity = candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      cachedIdentity = validateIdentity(readJson(identityFile));
    }
    return cachedIdentity;
  };

  const readAuth = () => {
    if (!fs.existsSync(authFile)) return normalizeAuthStore(undefined);
    fs.chmodSync(authFile, 0o600);
    return normalizeAuthStore(readJson(authFile));
  };

  const locateEntry = (store, deviceId, role) => (
    store.entries.find((entry) => entry.deviceId === deviceId && entry.role === role)
  );

  return {
    paths: Object.freeze({ directory, identityFile, authFile }),
    hostDeps: {
      loadOrCreateDeviceIdentity: loadIdentity,
      loadDeviceAuthToken: ({ deviceId, role }) => {
        const identity = loadIdentity();
        if (deviceId !== identity.deviceId || role !== "operator") return null;
        const entry = locateEntry(readAuth(), deviceId, role);
        if (!entry) return null;
        if (typeof entry.token !== "string" || !entry.token || !scopesAreExact(entry.scopes)) {
          throw new Error("Bridge device auth entry is invalid");
        }
        return { token: entry.token, scopes: [...entry.scopes] };
      },
      storeDeviceAuthToken: ({ deviceId, role, token, scopes, expectedToken }) => {
        const identity = loadIdentity();
        if (deviceId !== identity.deviceId || role !== "operator") {
          throw new Error("Refusing device auth for an unexpected Bridge identity or role");
        }
        if (typeof token !== "string" || !token || !scopesAreExact(scopes)) {
          throw new Error("Refusing a Bridge device token with unexpected scopes");
        }
        const store = readAuth();
        const existing = locateEntry(store, deviceId, role);
        const currentToken = existing?.token ?? null;
        if (expectedToken !== undefined && currentToken !== expectedToken) {
          throw new Error("Bridge device token changed concurrently");
        }
        const replacement = { deviceId, role, token, scopes: [...REQUIRED_SCOPES] };
        store.entries = store.entries.filter((entry) => (
          entry.deviceId !== deviceId || entry.role !== role
        ));
        store.entries.push(replacement);
        writePrivateJsonAtomic(authFile, store);
      },
      clearDeviceAuthToken: ({ deviceId, role, expectedToken }) => {
        const store = readAuth();
        const existing = locateEntry(store, deviceId, role);
        if (!existing) return;
        if (expectedToken !== undefined && existing.token !== expectedToken) return;
        store.entries = store.entries.filter((entry) => (
          entry.deviceId !== deviceId || entry.role !== role
        ));
        writePrivateJsonAtomic(authFile, store);
      },
    },
  };
}

export { REQUIRED_SCOPES as IDENTITY_STORE_REQUIRED_SCOPES };
