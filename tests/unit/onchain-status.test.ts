import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchOnchainRegistered } from "@/lib/onchain-status";

const REG = "0x27987c0173113d0f969d0abbf00a8c583fd7f7f44c05af3739f808d2a0afba6f";
const DEREG = "0xde576c51e7828c269f7a259c68554d25364b596a7bd816f01d9b8cdb52e88d43";
const ADDR = "0x6781821D4b4842f36a874428f533a3490C086e0f";

function log(topic0: string, blockNumber: number, logIndex: number) {
  return { blockNumber: "0x" + blockNumber.toString(16), logIndex: "0x" + logIndex.toString(16), topics: [topic0] };
}

function mockRpc(result: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) as unknown as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchOnchainRegistered", () => {
  it("returns true when the latest event is a registration", async () => {
    // out of order on purpose - the function must pick the latest by (block, logIndex)
    mockRpc([log(DEREG, 533681, 0), log(REG, 534696, 1), log(REG, 527686, 0)]);
    expect(await fetchOnchainRegistered("testnet", ADDR)).toBe(true);
  });

  it("returns false when the latest event is a deregistration", async () => {
    mockRpc([log(REG, 534696, 0), log(DEREG, 534999, 3)]);
    expect(await fetchOnchainRegistered("testnet", ADDR)).toBe(false);
  });

  it("breaks block ties by logIndex", async () => {
    mockRpc([log(REG, 600000, 2), log(DEREG, 600000, 5)]);
    expect(await fetchOnchainRegistered("testnet", ADDR)).toBe(false);
  });

  it("returns null (fall back to the index) when the worker has no events", async () => {
    mockRpc([]);
    expect(await fetchOnchainRegistered("testnet", ADDR)).toBeNull();
  });

  it("returns null on an RPC HTTP error", async () => {
    mockRpc(null, false);
    expect(await fetchOnchainRegistered("testnet", ADDR)).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchOnchainRegistered("testnet", ADDR)).toBeNull();
  });

  it("returns null without calling the RPC for an invalid address", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchOnchainRegistered("testnet", "not-an-address")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
