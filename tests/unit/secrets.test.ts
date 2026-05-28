import { describe, it, expect, beforeEach, vi } from "vitest";

// Force the web (localStorage) path - the test env has no desktop keychain.
vi.mock("@/lib/tauri", () => ({
  isDesktop: () => false,
  secretGet: async () => null,
  secretSet: async () => true,
  secretDelete: async () => {},
  nativeSecretsAvailable: async () => false,
}));

// Minimal localStorage shim on the node global.
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string): void => void store.set(k, v),
  removeItem: (k: string): void => void store.delete(k),
};
Object.defineProperty(globalThis, "window", {
  value: { localStorage },
  writable: true,
  configurable: true,
});

import { migrateBareWorkerKey, getSecret, setWorkerAddr, SECRET_WORKER_KEY } from "@/lib/secrets";

// anvil account 0 (well-known test keypair)
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("migrateBareWorkerKey (recover a legacy single-name key into the per-network slot)", () => {
  beforeEach(() => store.clear());

  it("copies the legacy bare key to the per-network slot when its address matches the network's worker", async () => {
    store.set("lightnode.funderKey", KEY); // legacy, non-per-network key
    setWorkerAddr("mainnet", ADDR); // the recorded per-network worker address
    expect(await getSecret(SECRET_WORKER_KEY, "mainnet")).toBe(""); // not yet per-network
    await migrateBareWorkerKey("mainnet");
    expect(await getSecret(SECRET_WORKER_KEY, "mainnet")).toBe(KEY);
  });

  it("never migrates to a network whose recorded address differs (address-matched, so no cross-network bleed)", async () => {
    store.set("lightnode.funderKey", KEY);
    setWorkerAddr("testnet", "0x000000000000000000000000000000000000dEaD");
    await migrateBareWorkerKey("testnet");
    expect(await getSecret(SECRET_WORKER_KEY, "testnet")).toBe("");
  });

  it("is a no-op when a per-network key already exists", async () => {
    store.set("lightnode.funderKey.mainnet", KEY);
    store.set("lightnode.funderKey", "0xdeadbeef"); // a different bare value must not overwrite it
    setWorkerAddr("mainnet", ADDR);
    await migrateBareWorkerKey("mainnet");
    expect(await getSecret(SECRET_WORKER_KEY, "mainnet")).toBe(KEY);
  });
});
