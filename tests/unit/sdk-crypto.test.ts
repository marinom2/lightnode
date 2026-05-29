import { describe, it, expect } from "vitest";
import {
  generateSessionKey,
  generateEcdhKeyPair,
  exportPublicKey,
  importPublicKey,
  encrypt,
  decrypt,
  encryptSessionKey,
  decryptSessionKey,
  utf8ToBytes,
  bytesToUtf8,
  hexToBytes,
  bytesToHex,
  base64ToBytes,
  bytesToBase64,
} from "../../sdk/src/crypto";

describe("sdk crypto: text + binary helpers", () => {
  it("utf8 round-trips", () => {
    const s = "hello, LightChain - 你好";
    expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
  });

  it("hex round-trips with 0x prefix in/out", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(bytesToHex(bytes)).toBe("0x000102feff");
    expect(Array.from(hexToBytes("0x000102feff"))).toEqual(Array.from(bytes));
    // Without prefix.
    expect(Array.from(hexToBytes("000102feff"))).toEqual(Array.from(bytes));
  });

  it("base64 round-trips", () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("sdk crypto: AES-256-GCM", () => {
  it("encrypt -> decrypt round-trips identity", async () => {
    const key = generateSessionKey();
    const plaintext = utf8ToBytes("prompt: write a haiku");
    const ct = await encrypt(key, plaintext);
    // Format: nonce(12) || ct || tag(16). So ciphertext is plaintext.length + 28 bytes.
    expect(ct.length).toBe(plaintext.length + 12 + 16);
    expect(Array.from(await decrypt(key, ct))).toEqual(Array.from(plaintext));
  });

  it("a wrong key fails to decrypt", async () => {
    const k1 = generateSessionKey();
    const k2 = generateSessionKey();
    const ct = await encrypt(k1, utf8ToBytes("secret"));
    await expect(decrypt(k2, ct)).rejects.toBeDefined();
  });

  it("rejects non-32-byte keys", async () => {
    const tooShort = new Uint8Array(31);
    await expect(encrypt(tooShort, new Uint8Array([1, 2, 3]))).rejects.toThrow(/AES key/);
  });

  it("nonces differ across calls (so two ciphertexts of the same plaintext don't match)", async () => {
    const key = generateSessionKey();
    const pt = utf8ToBytes("same plaintext");
    const a = await encrypt(key, pt);
    const b = await encrypt(key, pt);
    expect(Array.from(a.slice(0, 12))).not.toEqual(Array.from(b.slice(0, 12)));
  });
});

describe("sdk crypto: ECDH P-256 session-key wrapping", () => {
  it("session-key wrap -> unwrap round-trips identity", async () => {
    const recipient = await generateEcdhKeyPair();
    const sessionKey = generateSessionKey();
    const wrapped = await encryptSessionKey(sessionKey, recipient.publicKey);
    // Format: ephemeralPub(65) || nonce(12) || ct(32) || tag(16) = 125 bytes.
    expect(wrapped.length).toBe(65 + 12 + 32 + 16);
    const unwrapped = await decryptSessionKey(wrapped, recipient.privateKey);
    expect(Array.from(unwrapped)).toEqual(Array.from(sessionKey));
  });

  it("a different recipient cannot unwrap", async () => {
    const intended = await generateEcdhKeyPair();
    const wrong = await generateEcdhKeyPair();
    const wrapped = await encryptSessionKey(generateSessionKey(), intended.publicKey);
    await expect(decryptSessionKey(wrapped, wrong.privateKey)).rejects.toBeDefined();
  });

  it("public key export -> import round-trips (raw P-256, 65 bytes)", async () => {
    const kp = await generateEcdhKeyPair();
    const raw = await exportPublicKey(kp.publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04); // uncompressed point prefix
    const reimported = await importPublicKey(raw);
    const raw2 = await exportPublicKey(reimported);
    expect(Array.from(raw2)).toEqual(Array.from(raw));
  });
});
