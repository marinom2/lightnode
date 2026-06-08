import { describe, it, expect } from "vitest";
import {
  Bridge,
  BRIDGE_ROUTE,
  DAO,
  DAO_ADDRESSES,
  ProposalState,
  OnchainModelRegistry,
  ModelStatus,
} from "../../sdk/src/index";

// Shared minimal-public-client shape used by all three modules. `readContract`
// dispatches on functionName so each test can return a canned decoded value.
type ReadArgs = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};
type ReadHandler = (a: ReadArgs) => unknown;

function publicClientFrom(handler: ReadHandler): { readContract: (a: ReadArgs) => Promise<unknown> } {
  return { readContract: async (a: ReadArgs) => handler(a) };
}

const ACCOUNT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const SPENDER = "0x2222222222222222222222222222222222222222" as `0x${string}`;

describe("Bridge read-only paths", () => {
  it("quoteFee returns the Hyperlane gas quote read from the source router", async () => {
    const calls: ReadArgs[] = [];
    const pub = publicClientFrom((a) => {
      calls.push(a);
      // quoteGasPayment(uint32 destination) view returns (uint256)
      return 12_345n;
    });
    const bridge = new Bridge(pub);
    const fee = await bridge.quoteFee("ethereum", "lightchain-mainnet");
    expect(fee).toBe(12_345n);
    // Routed to the Ethereum (source) router, asking for the LightChain domain.
    expect(calls[0].address).toBe(BRIDGE_ROUTE.ethereum.router);
    expect(calls[0].functionName).toBe("quoteGasPayment");
    expect(calls[0].args).toEqual([BRIDGE_ROUTE["lightchain-mainnet"].hyperlaneDomain]);
  });

  it("quoteFee rejects when source and destination are the same", async () => {
    const bridge = new Bridge(publicClientFrom(() => 0n));
    await expect(bridge.quoteFee("ethereum", "ethereum")).rejects.toThrow(/must differ/i);
  });

  it("balance reads the underlying ERC-20 balanceOf on the Ethereum side", async () => {
    const calls: ReadArgs[] = [];
    const pub = publicClientFrom((a) => {
      calls.push(a);
      return 1_000_000_000_000_000_000n; // 1 LCAI in wei
    });
    const bridge = new Bridge(pub);
    const bal = await bridge.balance("ethereum", ACCOUNT);
    expect(bal).toBe(1_000_000_000_000_000_000n);
    expect(calls[0].address).toBe(BRIDGE_ROUTE.ethereum.underlying);
    expect(calls[0].functionName).toBe("balanceOf");
    expect(calls[0].args).toEqual([ACCOUNT]);
  });

  it("balance throws on the native (HypNative) side that has no underlying ERC-20", async () => {
    const bridge = new Bridge(publicClientFrom(() => 0n));
    // lightchain-mainnet.underlying is null -> must query getBalance on the RPC directly.
    await expect(bridge.balance("lightchain-mainnet", ACCOUNT)).rejects.toThrow(/native LCAI/i);
  });

  it("allowance reads the ERC-20 allowance for owner + router on the Ethereum side", async () => {
    const calls: ReadArgs[] = [];
    const pub = publicClientFrom((a) => {
      calls.push(a);
      return 42n;
    });
    const bridge = new Bridge(pub);
    const allowance = await bridge.allowance(ACCOUNT);
    expect(allowance).toBe(42n);
    expect(calls[0].address).toBe(BRIDGE_ROUTE.ethereum.underlying);
    expect(calls[0].functionName).toBe("allowance");
    // allowance(owner, spender) where spender is the bridge router.
    expect(calls[0].args).toEqual([ACCOUNT, BRIDGE_ROUTE.ethereum.router]);
  });
});

describe("DAO read-only paths", () => {
  it("state maps the raw uint8 enum to its ProposalState value", async () => {
    // 4 == Succeeded in the OZ Governor v5 enum.
    const pub = publicClientFrom(() => 4);
    const dao = new DAO(pub);
    const state = await dao.state(1n);
    expect(state).toBe(ProposalState.Succeeded);
  });

  it("proposal decodes the summary and maps the enum to its string label", async () => {
    const pub = publicClientFrom((a) => {
      switch (a.functionName) {
        case "state":
          return 5; // Queued
        case "proposalVotes":
          return [10n, 20n, 3n]; // againstVotes, forVotes, abstainVotes
        case "proposalSnapshot":
          return 1000n;
        case "proposalDeadline":
          return 2000n;
        case "proposalEta":
          return 1_700_000_000n;
        case "proposalProposer":
          return ACCOUNT;
        default:
          throw new Error(`unexpected read ${a.functionName}`);
      }
    });
    const dao = new DAO(pub);
    const summary = await dao.proposal(7n);
    expect(summary.id).toBe(7n);
    expect(summary.state).toBe(ProposalState.Queued);
    expect(summary.stateLabel).toBe("queued");
    expect(summary.proposer).toBe(ACCOUNT);
    expect(summary.snapshot).toBe(1000n);
    expect(summary.deadline).toBe(2000n);
    expect(summary.eta).toBe(1_700_000_000n);
    expect(summary.votes).toEqual({ againstWei: 10n, forWei: 20n, abstainWei: 3n });
    // Reads route to the configured Ethereum governor.
    expect(dao.addresses.governor).toBe(DAO_ADDRESSES.ethereum.governor);
  });

  it("proposal falls back to a label of unknown for an out-of-range state", async () => {
    const pub = publicClientFrom((a) => {
      if (a.functionName === "state") return 99; // not in the 0-7 enum
      if (a.functionName === "proposalVotes") return [0n, 0n, 0n];
      if (a.functionName === "proposalProposer") return null;
      return 0n; // snapshot / deadline / eta
    });
    const dao = new DAO(pub);
    const summary = await dao.proposal(1n);
    expect(summary.stateLabel).toBe("unknown");
    expect(summary.proposer).toBeNull();
  });

  it("config aggregates voting parameters and derives the period in seconds", async () => {
    const pub = publicClientFrom((a) => {
      switch (a.functionName) {
        case "votingDelay":
          return 7_200n;
        case "votingPeriod":
          return 100_800n;
        case "proposalThreshold":
          return 140_000n;
        default:
          throw new Error(`unexpected read ${a.functionName}`);
      }
    });
    const dao = new DAO(pub);
    const cfg = await dao.config();
    expect(cfg.votingDelayBlocks).toBe(7_200n);
    expect(cfg.votingPeriodBlocks).toBe(100_800n);
    expect(cfg.proposalThresholdWei).toBe(140_000n);
    // Number(period) * 12 (12s/block on Ethereum).
    expect(cfg.votingPeriodSecs).toBe(100_800 * 12);
  });

  it("getBallotsBalance reads from the chain's Ballots (IVotes) contract", async () => {
    const calls: ReadArgs[] = [];
    const pub = publicClientFrom((a) => {
      calls.push(a);
      return 500n;
    });
    const dao = new DAO(pub);
    const bal = await dao.getBallotsBalance(ACCOUNT);
    expect(bal).toBe(500n);
    expect(calls[0].address).toBe(DAO_ADDRESSES.ethereum.ballots);
    expect(calls[0].functionName).toBe("balanceOf");
    expect(calls[0].args).toEqual([ACCOUNT]);
  });
});

describe("OnchainModelRegistry read-only paths", () => {
  const REGISTRY = "0x3333333333333333333333333333333333333333" as `0x${string}`;

  function reader(handler: ReadHandler): OnchainModelRegistry {
    return new OnchainModelRegistry({ publicClient: publicClientFrom(handler), registry: REGISTRY });
  }

  it("getBaseModel returns the decoded base-model struct", async () => {
    const canned = {
      modelId: "llama-3",
      baseModelCID: "bafybase",
      metadataHash: "0xmeta",
      policyVersion: "v1",
      benchmarkCID: "bafybench",
      createdAt: 1_650_000_000n,
      isActive: true,
    };
    const calls: ReadArgs[] = [];
    const r = reader((a) => {
      calls.push(a);
      return canned;
    });
    const model = await r.getBaseModel("llama-3");
    expect(model).toEqual(canned);
    expect(calls[0].address).toBe(REGISTRY);
    expect(calls[0].functionName).toBe("getBaseModel");
    expect(calls[0].args).toEqual(["llama-3"]);
  });

  it("getVariant decodes the struct and maps the raw status to its ModelStatus enum", async () => {
    const raw = {
      variantId: "v-1",
      variantCID: "bafyvariant",
      metadataHash: "0xmeta",
      parentModelId: "llama-3",
      trainer: ACCOUNT,
      trainerStake: 1_000n,
      status: 2, // Approved
      avgScore: 87n,
      reportCID: "bafyreport",
      submittedAt: 100n,
      validatedAt: 200n,
      finalizedAt: 300n,
      validatorCount: 5n,
      challengeWindowOpen: false,
      challengeDeadline: 400n,
    };
    const r = reader((a) => {
      if (a.functionName === "getVariant") return raw;
      throw new Error(`unexpected read ${a.functionName}`);
    });
    const variant = await r.getVariant("v-1");
    expect(variant.status).toBe(ModelStatus.Approved);
    expect(variant.parentModelId).toBe("llama-3");
    expect(variant.trainer).toBe(ACCOUNT);
    expect(variant.avgScore).toBe(87n);
    expect(variant.challengeWindowOpen).toBe(false);
  });

  it("getAccessPolicy classifies a stake-gated policy as paywalled", async () => {
    const r = reader((a) => {
      if (a.functionName !== "getAccessPolicy") throw new Error(`unexpected read ${a.functionName}`);
      return {
        requireTicket: false,
        minStakeRequired: 500n,
        ticketManager: SPENDER,
        ticketTTL: 0n,
      };
    });
    const policy = await r.getAccessPolicy("v-1");
    expect(policy.tier).toBe("paywalled");
    expect(policy.requireTicket).toBe(false);
    expect(policy.minStakeRequiredWei).toBe(500n);
    expect(policy.ticketManager).toBe(SPENDER);
    expect(policy.ticketTtlSecs).toBe(0n);
  });

  it("getAccessPolicy classifies a ticket policy as ticket-gated and a zero-stake one as free", async () => {
    const ticketReader = reader(() => ({
      requireTicket: true,
      minStakeRequired: 0n,
      ticketManager: SPENDER,
      ticketTTL: 3600n,
    }));
    expect((await ticketReader.getAccessPolicy("v-1")).tier).toBe("ticket-gated");

    const freeReader = reader(() => ({
      requireTicket: false,
      minStakeRequired: 0n,
      ticketManager: "0x0000000000000000000000000000000000000000",
      ticketTTL: 0n,
    }));
    expect((await freeReader.getAccessPolicy("v-2")).tier).toBe("free");
  });

  it("getBenchmark throws when no BenchmarkRegistry address was supplied", () => {
    const r = reader(() => {
      throw new Error("should not reach the chain");
    });
    // requireBenchmarks() throws synchronously, before any readContract call.
    expect(() => r.getBenchmark("b-1")).toThrow(/no BenchmarkRegistry address/i);
  });
});
