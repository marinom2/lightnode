import { describe, it, expect } from "vitest";
import { isValidMnemonic, mnemonicToSeed } from "./mnemonic";
import { derivePrivateKey } from "./hdwallet";
import { Keyring } from "./keyring";
import { encryptVault, decryptVault } from "./vault";
import { bytesToBase64, base64ToBytes } from "./base64";

// Canonical BIP-39/44 test vector (the well-known "abandon... about" mnemonic).
const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// m/44'/60'/0'/0/0 for that mnemonic is this address (matches MetaMask/Trezor vectors).
const TEST_ADDR_0 = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

describe("mnemonic", () => {
  it("accepts a valid mnemonic and rejects garbage", () => {
    expect(isValidMnemonic(TEST_MNEMONIC)).toBe(true);
    expect(isValidMnemonic("not a real mnemonic phrase at all")).toBe(false);
  });
  it("produces a deterministic 64-byte seed", () => {
    expect(mnemonicToSeed(TEST_MNEMONIC)).toHaveLength(64);
  });
});

describe("HD derivation (BIP-44 m/44'/60'/0'/0/x)", () => {
  it("derives the canonical account-0 address from the test mnemonic", () => {
    const kr = Keyring.fromMnemonic(TEST_MNEMONIC, 1);
    expect(kr.accounts[0]!.address).toBe(TEST_ADDR_0);
  });
  it("derives distinct accounts per index", () => {
    const seed = mnemonicToSeed(TEST_MNEMONIC);
    const pk0 = derivePrivateKey(seed, 0);
    const pk1 = derivePrivateKey(seed, 1);
    expect(bytesToBase64(pk0)).not.toBe(bytesToBase64(pk1));
  });
  it("addAccount appends the next derivation index", () => {
    const kr = Keyring.fromMnemonic(TEST_MNEMONIC, 1);
    const a1 = kr.addAccount();
    expect(a1.index).toBe(1);
    expect(kr.accounts).toHaveLength(2);
    expect(kr.accountFor(TEST_ADDR_0.toLowerCase())?.index).toBe(0);
  });
});

describe("vault (AES-256-GCM + scrypt)", () => {
  it("round-trips the mnemonic with the correct password", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "correct horse battery staple");
    expect(vault.cipherB64).not.toContain("abandon");
    expect(await decryptVault(vault, "correct horse battery staple")).toBe(TEST_MNEMONIC);
  });
  it("rejects the wrong password without leaking which", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "right-password");
    await expect(decryptVault(vault, "wrong-password")).rejects.toThrow("Invalid password");
  });
  it("uses a fresh salt + IV per encryption (no reuse)", async () => {
    const a = await encryptVault(TEST_MNEMONIC, "pw");
    const b = await encryptVault(TEST_MNEMONIC, "pw");
    expect(a.kdf.saltB64).not.toBe(b.kdf.saltB64);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.cipherB64).not.toBe(b.cipherB64);
  });
});

describe("base64 (chunked, no stack overflow on large inputs)", () => {
  for (const size of [0, 1, 32, 64, 100_000, 500_000]) {
    it(`round-trips ${size} random bytes`, () => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
      const back = base64ToBytes(bytesToBase64(bytes));
      expect(back).toEqual(bytes);
    });
  }
});
