import { describe, it, expect } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { gcm } from "@noble/ciphers/aes.js";
import { modelIdFor, wrapSessionKey, encryptPayload, decryptPayload, decodePublicKey } from "./inference";

describe("modelIdFor", () => {
  it("matches the LIVE gateway id for llama3-8b (protocol anchor)", () => {
    expect(modelIdFor("llama3-8b")).toBe("0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848");
  });
});

describe("session crypto", () => {
  it("round-trips a payload under the session key", () => {
    const key = new Uint8Array(32).fill(7);
    const sealed = encryptPayload(key, "hello LightChain");
    expect(decryptPayload(key, sealed)).toBe("hello LightChain");
  });
  it("wraps the session key so the recipient can unwrap it (ECDH x + AES-GCM)", () => {
    const recipientPriv = p256.utils.randomSecretKey();
    const recipientPub = p256.getPublicKey(recipientPriv, false);
    const sessionKey = new Uint8Array(32).fill(9);
    const wrapped = wrapSessionKey(sessionKey, recipientPub);
    // recipient side: ephemeralPub(65) || nonce(12) || ct+tag
    const ephPub = wrapped.slice(0, 65);
    const nonce = wrapped.slice(65, 77);
    const shared = p256.getSharedSecret(recipientPriv, ephPub, false).slice(1, 33);
    const unwrapped = gcm(shared, nonce).decrypt(wrapped.slice(77));
    expect(Array.from(unwrapped)).toEqual(Array.from(sessionKey));
  });
  it("REGRESSION: decodes the gateway's three key formats (bare hex, 0x hex, base64)", () => {
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false); // 65 bytes
    const hex = Array.from(pub).map((b) => b.toString(16).padStart(2, "0")).join("");
    const b64 = btoa(String.fromCharCode(...pub));
    // Bare hex is what the live gateway sends for the worker key: it is ALSO
    // valid base64 alphabet, which is exactly how the original bug happened.
    expect(Array.from(decodePublicKey(hex))).toEqual(Array.from(pub));
    expect(Array.from(decodePublicKey(`0x${hex}`))).toEqual(Array.from(pub));
    expect(Array.from(decodePublicKey(b64))).toEqual(Array.from(pub));
  });
  it("rejects malformed recipient keys and short frames", () => {
    expect(() => decodePublicKey("AAAA")).toThrow();
    expect(() => decodePublicKey("zz".repeat(65))).toThrow();
    expect(() => decryptPayload(new Uint8Array(32), new Uint8Array(5))).toThrow();
  });
});
