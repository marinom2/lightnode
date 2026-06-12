import { describe, it, expect } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { gcm } from "@noble/ciphers/aes.js";
import { modelIdFor, wrapSessionKey, encryptPayload, decryptPayload, decodePublicKey, verifiedWorkerKey, assertSafeChallenge } from "./inference";
import type { PublicClient } from "viem";

const WORKER = "0x00000000000000000000000000000000000000ab";
const toHexKey = (b: Uint8Array): `0x${string}` => `0x${Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
// A PublicClient whose getWorkerEncryptionKey read returns `onchain`.
const clientReturning = (onchain: `0x${string}`): PublicClient =>
  ({ readContract: async () => onchain }) as unknown as PublicClient;

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

describe("verifiedWorkerKey (E2E trust anchor)", () => {
  const priv = p256.utils.randomSecretKey();
  const realKey = p256.getPublicKey(priv, false); // the worker's true 65-byte key
  const attackerKey = p256.getPublicKey(p256.utils.randomSecretKey(), false);

  it("returns the key when the gateway's key matches the chain", async () => {
    const got = await verifiedWorkerKey(clientReturning(toHexKey(realKey)), WORKER, toHexKey(realKey));
    expect(Array.from(got)).toEqual(Array.from(realKey));
  });
  it("REJECTS a gateway key that does not match the on-chain key (the MITM)", async () => {
    await expect(verifiedWorkerKey(clientReturning(toHexKey(realKey)), WORKER, toHexKey(attackerKey))).rejects.toThrow(/does not match the chain/);
  });
  it("fails closed when the worker has no key registered on-chain", async () => {
    await expect(verifiedWorkerKey(clientReturning("0x"), WORKER, toHexKey(realKey))).rejects.toThrow(/no encryption key registered/);
  });
});

describe("assertSafeChallenge (no blind SIWE signing)", () => {
  const ADDR = "0x73C0B223874686FA13Ba1864562d9fEaAc3DEB5e";
  const good = `lightnode.app wants you to sign in with your Ethereum account:\n${ADDR}\n\nNonce: abc`;
  it("accepts a challenge for this gateway and this account", () => {
    expect(() => assertSafeChallenge(good, ADDR)).not.toThrow();
  });
  it("accepts the REAL gateway domain (chat-api.<net>.lightchain.ai), not just the proxy host", () => {
    // Regression: the live gateway signs as chat-api.mainnet.lightchain.ai even
    // via the lightnode.app proxy. Rejecting it would break chat entirely.
    const real = `chat-api.mainnet.lightchain.ai wants you to sign in with your Ethereum account:\n${ADDR}\n\nURI: http://chat-api.mainnet.lightchain.ai\nChain ID: 1\nNonce: a5`;
    expect(() => assertSafeChallenge(real, ADDR)).not.toThrow();
  });
  it("rejects a challenge naming a different (non-lightchain) site", () => {
    expect(() => assertSafeChallenge(good.replace("lightnode.app", "evil.example"), ADDR)).toThrow(/different site/);
  });
  it("rejects a challenge for a different account", () => {
    expect(() => assertSafeChallenge(good, "0x000000000000000000000000000000000000dEaD")).toThrow(/different account/);
  });
  it("rejects an empty or oversized challenge", () => {
    expect(() => assertSafeChallenge("", ADDR)).toThrow();
    expect(() => assertSafeChallenge("x".repeat(5000), ADDR)).toThrow();
  });
});
