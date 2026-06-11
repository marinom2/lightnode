import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Bridge, DAO, OnchainModelRegistry, WorkerOperator, quoteBridgeFee } from "lightnode-sdk";

// Compile-level regression test for the SDK's Minimal* client interfaces.
//
// The README promises `new Bridge(viemPublicClient, viemWalletClient)` works
// with REAL viem clients, no casts. That only holds while the Minimal*
// interfaces declare their members in METHOD SHORTHAND form
// (`readContract(args: X): Y`), which TypeScript checks bivariantly. If they
// regress to function properties (`readContract: (args: X) => Y`), parameter
// checking becomes strictly contravariant and viem clients stop being
// assignable - and THIS FILE stops compiling under the root `tsc --noEmit`.
// That compile failure is the real assertion; the runtime expectations below
// are deliberately trivial. No network calls are made: clients are only
// constructed, never used.

// A dummy throwaway key (NOT a secret): deriving the account is pure local
// crypto, no RPC involved.
const account = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);

// Real viem clients with the real mainnet chain object. `http()` with no URL
// only records the chain's default RPC; nothing is fetched at construction.
const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const walletClient = createWalletClient({ account, chain: mainnet, transport: http() });

describe("real viem clients type-check into the SDK without casts", () => {
  it("Bridge accepts a viem PublicClient + WalletClient directly", () => {
    const bridge = new Bridge(publicClient, walletClient);
    expect(bridge).toBeDefined();
    expect(bridge.route.ethereum.chainId).toBe(1);
  });

  it("DAO accepts a viem PublicClient (and WalletClient for writes) directly", () => {
    const dao = new DAO(publicClient, "ethereum", walletClient);
    expect(dao).toBeDefined();
    expect(dao.addresses.chainId).toBe(1);
  });

  it("WorkerOperator accepts viem clients directly", () => {
    const operator = new WorkerOperator("mainnet", { publicClient, walletClient });
    expect(operator).toBeDefined();
    expect(operator.network.chainId).toBe(9200);
  });

  it("OnchainModelRegistry accepts a viem PublicClient directly", () => {
    const reader = new OnchainModelRegistry({
      publicClient,
      registry: "0x0000000000000000000000000000000000000001",
    });
    expect(reader.registry).toBe("0x0000000000000000000000000000000000000001");
  });

  it("standalone helpers accept a viem PublicClient at the type level", () => {
    // Compile-only: the inner function is never invoked (calling it would hit
    // an RPC). Its body exists so tsc checks the standalone helper signature
    // against a real viem client without casts.
    function compileOnlyQuote(): Promise<bigint> {
      return quoteBridgeFee(publicClient, "ethereum", "lightchain-mainnet");
    }
    expect(typeof compileOnlyQuote).toBe("function");
  });
});
