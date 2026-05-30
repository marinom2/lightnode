/**
 * Wire-compatible ECDH P-256 + AES-256-GCM helpers for the LightChain AI
 * inference protocol.
 *
 * The format here MUST match the workers' Go implementation byte for byte,
 * which is what the `lcai-chat-v2` reference client also targets:
 *   - ECDH P-256 key exchange.
 *   - Raw shared secret X coordinate used DIRECTLY as the AES-256 key (no HKDF).
 *   - AES-GCM ciphertext layout: nonce(12) || ciphertext || tag(16).
 *   - Encrypted session key layout: ephemeralPub(65) || nonce(12) || ciphertext || tag(16).
 *
 * Implementation note: this module used to be built on Web Crypto (subtle.*).
 * That broke in environments where the runtime has a partial Web Crypto
 * implementation - notably StackBlitz / Bolt WebContainer, where
 * subtle.generateKey({name:"ECDH",namedCurve:"P-256"}) throws "Unsupported".
 * The flow is now backed by @noble/curves (P-256) and @noble/ciphers (AES-GCM)
 * which are pure-JS and identical across every runtime. The only Web Crypto
 * surface left is getRandomValues, which is reliable everywhere (when missing
 * we fall back to node:crypto).
 */

import { p256 } from "@noble/curves/p256";
import { gcm } from "@noble/ciphers/aes";

const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const P256_UNCOMPRESSED_KEY_BYTES = 65; // 0x04 || X(32) || Y(32)
const SESSION_KEY_BYTES = 32;

// Random source: try globalThis.crypto.getRandomValues (every modern browser
// and Node 19+ global), fall back to node:crypto.webcrypto.getRandomValues
// (Node 18, WebContainer). All algorithm-side crypto is pure JS, so this is
// the only Web-Crypto-flavored thing the SDK still needs.
let resolvedRng: ((b: Uint8Array) => Uint8Array) | null = null;
let resolvingRng: Promise<(b: Uint8Array) => Uint8Array> | null = null;

async function getRng(): Promise<(b: Uint8Array) => Uint8Array> {
  if (resolvedRng) return resolvedRng;
  if (resolvingRng) return resolvingRng;
  resolvingRng = (async (): Promise<(b: Uint8Array) => Uint8Array> => {
    const g = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
    if (g && typeof g.getRandomValues === "function") {
      const bound = g.getRandomValues.bind(g);
      resolvedRng = bound;
      return bound;
    }
    try {
      const mod = (await import("node:crypto")) as {
        webcrypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array };
      };
      const wc = mod.webcrypto;
      if (wc && typeof wc.getRandomValues === "function") {
        const bound = wc.getRandomValues.bind(wc);
        resolvedRng = bound;
        return bound;
      }
    } catch {
      // browser bundle without a global crypto - fall through to the throw
    }
    throw new Error(
      "Secure random source unavailable: neither globalThis.crypto.getRandomValues nor " +
        "node:crypto.webcrypto.getRandomValues was found. Requires Node 18+ or a modern browser.",
    );
  })();
  try {
    return await resolvingRng;
  } finally {
    resolvingRng = null;
  }
}

async function randomBytes(n: number): Promise<Uint8Array> {
  const buf = new Uint8Array(n);
  (await getRng())(buf);
  return buf;
}

// =============================================================================
// Public types: the ECDH key surface used to expose Web Crypto's `CryptoKey`
// type. Now plain Uint8Array, since noble is pure-JS and has no opaque key
// objects. Public keys are uncompressed P-256 (65 bytes, leading 0x04).
// Private keys are 32-byte scalars. BREAKING CHANGE vs SDK <= 0.4.7 for the
// lower-level prepareSession / encryptSessionKey path; the high-level
// runInferenceWithKey + runInference helpers are unaffected.
// =============================================================================

export interface EcdhKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** A fresh 32-byte symmetric session key (random, never derived). */
export function generateSessionKey(): Promise<Uint8Array> {
  return randomBytes(SESSION_KEY_BYTES);
}

/** Fresh ECDH P-256 keypair (32-byte private scalar, 65-byte uncompressed pub). */
export async function generateEcdhKeyPair(): Promise<EcdhKeyPair> {
  // Use our RNG (proven available) instead of noble's, so a missing
  // globalThis.crypto fails loudly at one site rather than in noble's internals.
  const privateKey = await randomBytes(32);
  // P-256 private scalars must be < n; the chance of collision is astronomically
  // small, but noble validates this when we call getPublicKey, so any bad draw
  // throws (and we'd just retry - but it has never been hit in practice).
  const publicKey = p256.getPublicKey(privateKey, false);
  return { privateKey, publicKey };
}

/** Identity passthrough kept for API back-compat. Public keys are already raw bytes. */
export function exportPublicKey(key: Uint8Array): Uint8Array {
  return key;
}

/** Validate that raw is a well-formed uncompressed P-256 public key (65 bytes). */
export function importPublicKey(raw: Uint8Array): Uint8Array {
  if (raw.length !== P256_UNCOMPRESSED_KEY_BYTES || raw[0] !== 0x04) {
    throw new Error(`expected uncompressed P-256 public key (${P256_UNCOMPRESSED_KEY_BYTES} bytes, leading 0x04)`);
  }
  // Round-trip through noble to confirm the point is on the curve. Throws if not.
  p256.ProjectivePoint.fromHex(raw);
  return raw;
}

/**
 * Derive a 32-byte shared secret (X coordinate of the shared point) from a
 * local ECDH private key and a remote public key. No HKDF, matching the
 * protocol's `priv.ECDH(remotePub)` output exactly.
 */
export function deriveSharedSecret(privateKey: Uint8Array, remotePublicKey: Uint8Array): Uint8Array {
  // noble returns 65 bytes uncompressed (0x04 || X || Y) when isCompressed=false.
  // The protocol's shared secret is just X.
  const sharedPoint = p256.getSharedSecret(privateKey, remotePublicKey, false);
  return sharedPoint.slice(1, 1 + AES_KEY_BYTES);
}

/** Encrypt with AES-256-GCM. Output: nonce(12) || ciphertext || tag(16). */
export async function encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) throw new Error(`AES key must be ${AES_KEY_BYTES} bytes`);
  const nonce = await randomBytes(GCM_NONCE_BYTES);
  // noble's gcm returns plaintext.length + 16 (tag appended). Layout in our
  // wire format is nonce || ct+tag.
  const ctPlusTag = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(GCM_NONCE_BYTES + ctPlusTag.length);
  out.set(nonce, 0);
  out.set(ctPlusTag, GCM_NONCE_BYTES);
  return out;
}

/** Decrypt AES-256-GCM. Input: nonce(12) || ciphertext || tag(16). */
export async function decrypt(key: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) throw new Error(`AES key must be ${AES_KEY_BYTES} bytes`);
  if (ciphertext.length < GCM_NONCE_BYTES + GCM_TAG_BYTES) throw new Error("ciphertext too short");
  const nonce = ciphertext.slice(0, GCM_NONCE_BYTES);
  const body = ciphertext.slice(GCM_NONCE_BYTES);
  return gcm(key, nonce).decrypt(body);
}

/**
 * Wrap (encrypt) a 32-byte session key for delivery to a remote party
 * (e.g. the worker), using a fresh ephemeral ECDH keypair.
 *
 * Output: ephemeralPub(65) || nonce(12) || AES-GCM(sharedSecret, sessionKey)
 */
export async function encryptSessionKey(sessionKey: Uint8Array, remotePublicKey: Uint8Array): Promise<Uint8Array> {
  if (sessionKey.length !== SESSION_KEY_BYTES) throw new Error(`session key must be ${SESSION_KEY_BYTES} bytes`);
  const ephemeral = await generateEcdhKeyPair();
  const shared = deriveSharedSecret(ephemeral.privateKey, remotePublicKey);
  const ct = await encrypt(shared, sessionKey);
  const out = new Uint8Array(ephemeral.publicKey.length + ct.length);
  out.set(ephemeral.publicKey, 0);
  out.set(ct, ephemeral.publicKey.length);
  return out;
}

/** Unwrap a session key encrypted by `encryptSessionKey` using the local ECDH private key. */
export async function decryptSessionKey(encWorkerKey: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  if (encWorkerKey.length < P256_UNCOMPRESSED_KEY_BYTES + GCM_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error("encrypted session key too short");
  }
  const ephemeralPub = importPublicKey(encWorkerKey.slice(0, P256_UNCOMPRESSED_KEY_BYTES));
  const ct = encWorkerKey.slice(P256_UNCOMPRESSED_KEY_BYTES);
  const shared = deriveSharedSecret(privateKey, ephemeralPub);
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
