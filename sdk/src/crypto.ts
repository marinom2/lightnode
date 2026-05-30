/**
 * Wire-compatible ECDH P-256 + AES-256-GCM helpers for the LightChain AI
 * inference protocol.
 *
 * The format here MUST match the workers' Go implementation byte for byte,
 * which is what the `lcai-chat-v2` reference client also targets:
 *   - ECDH P-256 key exchange.
 *   - Raw shared secret used DIRECTLY as the AES-256 key (no HKDF).
 *   - AES-GCM ciphertext layout: nonce(12) || ciphertext || tag(16).
 *   - Encrypted session key layout: ephemeralPub(65) || nonce(12) || ciphertext || tag(16).
 *
 * Uses the Web Crypto API. Tries `globalThis.crypto` first (real browsers +
 * Node 19+ where it is global), then falls back to `node:crypto`'s
 * `webcrypto` export (Node 18 and StackBlitz's WebContainer, which exposes
 * the node: module but not the global). No hard dependency on Node, and no
 * polyfill in the browser bundle.
 */

const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const P256_UNCOMPRESSED_KEY_BYTES = 65;
const SESSION_KEY_BYTES = 32;

// Resolved once on first use, then reused. Two-step initialization (the
// promise during the in-flight first call, then the resolved object after)
// prevents racing callers from each doing the dynamic import.
interface CryptoProvider {
  subtle: SubtleCrypto;
  getRandomValues: (b: Uint8Array) => Uint8Array;
}
let resolvedCrypto: CryptoProvider | null = null;
let resolvingCrypto: Promise<CryptoProvider> | null = null;

async function getCrypto(): Promise<CryptoProvider> {
  if (resolvedCrypto) return resolvedCrypto;
  if (resolvingCrypto) return resolvingCrypto;
  resolvingCrypto = (async (): Promise<CryptoProvider> => {
    const g = (globalThis as { crypto?: Crypto }).crypto;
    if (g?.subtle && typeof g.getRandomValues === "function") {
      const provider: CryptoProvider = { subtle: g.subtle, getRandomValues: g.getRandomValues.bind(g) };
      resolvedCrypto = provider;
      return provider;
    }
    // Node 18 + StackBlitz WebContainer: globalThis.crypto is missing, but
    // `node:crypto` exposes the same Web Crypto API via `webcrypto`.
    try {
      const mod = (await import("node:crypto")) as { webcrypto?: Crypto };
      const wc = mod.webcrypto;
      if (wc?.subtle && typeof wc.getRandomValues === "function") {
        const provider: CryptoProvider = { subtle: wc.subtle, getRandomValues: wc.getRandomValues.bind(wc) };
        resolvedCrypto = provider;
        return provider;
      }
    } catch {
      // node:crypto not importable - we're in a browser bundle without a
      // global crypto. The fall-through error below explains the fix.
    }
    throw new Error(
      "Web Crypto unavailable: globalThis.crypto is missing and node:crypto could not be loaded. " +
        "The SDK requires Node 18+ or a modern browser.",
    );
  })();
  try {
    return await resolvingCrypto;
  } finally {
    resolvingCrypto = null;
  }
}

async function subtle(): Promise<SubtleCrypto> {
  return (await getCrypto()).subtle;
}

async function randomBytes(n: number): Promise<Uint8Array> {
  const buf = new Uint8Array(n);
  (await getCrypto()).getRandomValues(buf);
  return buf;
}

/** A fresh 32-byte symmetric session key (random, never derived). */
export function generateSessionKey(): Promise<Uint8Array> {
  return randomBytes(SESSION_KEY_BYTES);
}

/** Fresh ECDH P-256 keypair (extractable; we need to export the public key on the wire). */
export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle()).generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

/** Export an ECDH public key to its raw uncompressed P-256 encoding (65 bytes). */
export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await (await subtle()).exportKey("raw", key));
}

/** Import a raw uncompressed P-256 public key (65 bytes) into a CryptoKey. */
export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return (await subtle()).importKey("raw", raw as BufferSource, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

/**
 * Derive a 32-byte shared secret from a local ECDH private key and a remote
 * public key. Returns the raw x-coordinate; deliberately no HKDF, matching the
 * protocol's `priv.ECDH(remotePub)` output exactly.
 */
export async function deriveSharedSecret(privateKey: CryptoKey, remotePublicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await (await subtle()).deriveBits({ name: "ECDH", public: remotePublicKey }, privateKey, 256));
}

/** Encrypt with AES-256-GCM. Output: nonce(12) || ciphertext || tag(16). */
export async function encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) throw new Error(`AES key must be ${AES_KEY_BYTES} bytes`);
  const s = await subtle();
  const aesKey = await s.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  const nonce = await randomBytes(GCM_NONCE_BYTES);
  const ctPlusTag = new Uint8Array(await s.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext as BufferSource));
  const out = new Uint8Array(GCM_NONCE_BYTES + ctPlusTag.byteLength);
  out.set(nonce, 0);
  out.set(ctPlusTag, GCM_NONCE_BYTES);
  return out;
}

/** Decrypt AES-256-GCM. Input: nonce(12) || ciphertext || tag(16). */
export async function decrypt(key: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) throw new Error(`AES key must be ${AES_KEY_BYTES} bytes`);
  if (ciphertext.length < GCM_NONCE_BYTES + 16) throw new Error("ciphertext too short");
  const s = await subtle();
  const aesKey = await s.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
  const nonce = ciphertext.slice(0, GCM_NONCE_BYTES);
  const body = ciphertext.slice(GCM_NONCE_BYTES);
  return new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, body as BufferSource));
}

/**
 * Wrap (encrypt) a 32-byte session key for delivery to a remote party (e.g. the
 * worker), using a fresh ephemeral ECDH keypair.
 *
 * Output: ephemeralPub(65) || nonce(12) || AES-GCM(sharedSecret, sessionKey)
 */
export async function encryptSessionKey(sessionKey: Uint8Array, remotePublicKey: CryptoKey): Promise<Uint8Array> {
  if (sessionKey.length !== SESSION_KEY_BYTES) throw new Error(`session key must be ${SESSION_KEY_BYTES} bytes`);
  const ephemeral = await generateEcdhKeyPair();
  const shared = await deriveSharedSecret(ephemeral.privateKey, remotePublicKey);
  const ct = await encrypt(shared, sessionKey);
  const pub = await exportPublicKey(ephemeral.publicKey);
  const out = new Uint8Array(pub.length + ct.length);
  out.set(pub, 0);
  out.set(ct, pub.length);
  return out;
}

/** Unwrap a session key encrypted by `encryptSessionKey` using the local ECDH private key. */
export async function decryptSessionKey(encWorkerKey: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
  if (encWorkerKey.length < P256_UNCOMPRESSED_KEY_BYTES + GCM_NONCE_BYTES + 16) {
    throw new Error("encrypted session key too short");
  }
  const ephemeralPub = await importPublicKey(encWorkerKey.slice(0, P256_UNCOMPRESSED_KEY_BYTES));
  const ct = encWorkerKey.slice(P256_UNCOMPRESSED_KEY_BYTES);
  const shared = await deriveSharedSecret(privateKey, ephemeralPub);
  const sk = await decrypt(shared, ct);
  if (sk.length !== SESSION_KEY_BYTES) throw new Error(`session key must be ${SESSION_KEY_BYTES} bytes`);
  return sk;
}

// -- text helpers (cross-runtime, no Node Buffer dependency) -----------------

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

const HEX = "0123456789abcdef";

export function bytesToHex(b: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const v of b) out += HEX[v >> 4] + HEX[v & 0xf];
  return out as `0x${string}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error("hex must be even length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// btoa/atob are globals in Node 18+ and all browsers. Narrow the lookup so
// strict TS doesn't trip on a missing-on-globalThis interface.
const g = globalThis as { btoa: (s: string) => string; atob: (s: string) => string };

export function bytesToBase64(b: Uint8Array): string {
  // btoa accepts a binary string; build it from bytes (avoids Node Buffer requirement).
  let s = "";
  for (const v of b) s += String.fromCharCode(v);
  return g.btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = g.atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
