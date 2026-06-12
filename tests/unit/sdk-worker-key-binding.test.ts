import { describe, it, expect } from "vitest";
import { assertSafeChallenge, verifyWorkerKeyOnChain } from "../../sdk/src/inference";
import { generateEcdhKeyPair } from "../../sdk/src/crypto";

const ADDR = "0x73C0B223874686FA13Ba1864562d9fEaAc3DEB5e";
const WORKER = "0x00000000000000000000000000000000000000ab";
const REGISTRY = "0x0000000000000000000000000000000000001002";
const toHexKey = (b: Uint8Array): `0x${string}` => `0x${Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
// Minimal public client whose getWorkerEncryptionKey read returns `onchain`.
const clientReturning = (onchain: `0x${string}`) =>
  ({ readContract: async () => onchain }) as unknown as Parameters<typeof verifyWorkerKeyOnChain>[0];

describe("assertSafeChallenge (no blind gateway SIWE)", () => {
  it("accepts the real gateway domain (chat-api.<net>.lightchain.ai) for this account", () => {
    const msg = `chat-api.mainnet.lightchain.ai wants you to sign in with your Ethereum account:\n${ADDR}\n\nChain ID: 1\nNonce: a5`;
    expect(() => assertSafeChallenge(msg, ADDR, "lightnode.app")).not.toThrow();
    expect(() => assertSafeChallenge(msg, ADDR, "chat-api.mainnet.lightchain.ai")).not.toThrow();
  });
  it("rejects a challenge for a different account", () => {
    const msg = `chat-api.mainnet.lightchain.ai wants you to sign in with your Ethereum account:\n${ADDR}\n\nNonce: a5`;
    expect(() => assertSafeChallenge(msg, "0x000000000000000000000000000000000000dEaD", "lightnode.app")).toThrow(/different account/);
  });
  it("rejects a challenge naming a non-lightchain, non-gateway site", () => {
    const msg = `evil.example wants you to sign in with your Ethereum account:\n${ADDR}\n\nNonce: a5`;
    expect(() => assertSafeChallenge(msg, ADDR, "lightnode.app")).toThrow(/different site/);
  });
  it("rejects empty / oversized challenges", () => {
    expect(() => assertSafeChallenge("", ADDR, "lightnode.app")).toThrow();
    expect(() => assertSafeChallenge("x".repeat(5000), ADDR, "lightnode.app")).toThrow();
  });
});

describe("verifyWorkerKeyOnChain (E2E trust anchor)", () => {
  it("passes when the gateway key matches the chain", async () => {
    const real = (await generateEcdhKeyPair()).publicKey; // 65-byte worker key
    await expect(verifyWorkerKeyOnChain(clientReturning(toHexKey(real)), REGISTRY, WORKER, toHexKey(real))).resolves.toBeUndefined();
  });
  it("REJECTS a gateway key that does not match the on-chain key (the MITM)", async () => {
    const real = (await generateEcdhKeyPair()).publicKey;
    const attacker = (await generateEcdhKeyPair()).publicKey;
    await expect(verifyWorkerKeyOnChain(clientReturning(toHexKey(real)), REGISTRY, WORKER, toHexKey(attacker))).rejects.toThrow(/does not match the on-chain/);
  });
  it("fails closed when the worker has no key registered", async () => {
    const real = (await generateEcdhKeyPair()).publicKey;
    await expect(verifyWorkerKeyOnChain(clientReturning("0x"), REGISTRY, WORKER, toHexKey(real))).rejects.toThrow(/no encryption key registered/);
  });
});
