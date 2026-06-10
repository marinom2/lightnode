/**
 * Encrypted vault = the mnemonic sealed under a password. WebCrypto AES-256-GCM
 * with a scrypt-derived key. Decisions follow the adversarial security review:
 *   - scryptAsync (non-blocking; sync scrypt would freeze the MV3 service worker).
 *   - N = 2^16 (r=8, p=1 -> ~64 MiB) - memory-hard but safe on constrained devices.
 *   - random 16-byte salt + random 12-byte GCM nonce per encryption (no reuse).
 *   - KDF params are recorded in the blob so they can be upgraded later.
 *   - GCM auth-tag failure IS the password check (decrypt throws on wrong key/tamper).
 * The vault is stored encrypted at rest; it is useless without the password.
 */
import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToBase64, base64ToBytes } from "./base64";

export interface ScryptParams {
  kind: "scrypt";
  N: number;
  r: number;
  p: number;
  saltB64: string;
}
export interface EncryptedVault {
  version: 1;
  kdf: ScryptParams;
  ivB64: string;
  cipherB64: string;
}

const DEFAULT_SCRYPT = { N: 2 ** 16, r: 8, p: 1 } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

// TS 5.7 types Uint8Array as Uint8Array<ArrayBufferLike>, but WebCrypto wants
// BufferSource (ArrayBuffer-backed). Every array we pass IS ArrayBuffer-backed at
// runtime (getRandomValues / new Uint8Array / scrypt output), so assert the type.
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveAesKey(password: string, params: ScryptParams): Promise<CryptoKey> {
  const raw = await scryptAsync(enc.encode(password.normalize("NFKC")), base64ToBytes(params.saltB64), {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: 32,
  });
  const key = await crypto.subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  raw.fill(0); // wipe derived bytes from the JS heap as soon as the CryptoKey is imported
  return key;
}

export async function encryptVault(plaintext: string, password: string): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit GCM nonce, fresh per encrypt
  const kdf: ScryptParams = { kind: "scrypt", ...DEFAULT_SCRYPT, saltB64: bytesToBase64(salt) };
  const key = await deriveAesKey(password, kdf);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(enc.encode(plaintext))));
  return { version: 1, kdf, ivB64: bytesToBase64(iv), cipherB64: bytesToBase64(cipher) };
}

export async function decryptVault(vault: EncryptedVault, password: string): Promise<string> {
  const key = await deriveAesKey(password, vault.kdf);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(base64ToBytes(vault.ivB64)) },
      key,
      buf(base64ToBytes(vault.cipherB64)),
    );
    return dec.decode(new Uint8Array(plain));
  } catch {
    // Wrong password or tampered ciphertext - never leak which, never leak internals.
    throw new Error("Invalid password");
  }
}
