/**
 * DAO SDK: typed wrapper around the LCAI Governor (OpenZeppelin Governor v5)
 * on Ethereum mainnet. Addresses extracted from
 * `lightchain-protocol/LCAI-dao-frontend/config/index.ts`.
 *
 * Governance is currently Ethereum-side (chain 1). Voting on LCAI proposals
 * happens via the LCAI ERC-20 wrapped as IVotes (LCAIBallots). Execution
 * goes through LCAITimeLock with the timelock controller managing actual
 * calldata dispatch.
 *
 * Voting parameters (hard-coded in LCAIGovernor.sol constructor):
 *   - votingDelay      = 7,200 blocks   (~1 day at 12s)
 *   - votingPeriod     = 100,800 blocks (~14 days at 12s)
 *   - proposalThreshold = 140,000 LCAI  (votes required to create a proposal)
 *   - quorum            = 3% of total supply (3-15 by admin)
 *
 * This module covers the OZ Governor v5 surface: state machine, propose,
 * castVote, queue, execute. Plus convenience reads of the constants.
 */

import { parseAbi } from "viem";

export type DaoChain = "ethereum";

export interface DaoAddresses {
  chainId: number;
  /** OZ Governor contract. */
  governor: `0x${string}`;
  /** Timelock controller. queue/execute dispatch through this. */
  timelock: `0x${string}`;
  /** ERC-20 wrapped as IVotes; this is what users delegate / hold to vote. */
  ballots: `0x${string}`;
  /** LCAI ERC-20 (the underlying governance token). */
  token: `0x${string}`;
  /** Treasury contract holding DAO funds. */
  treasury: `0x${string}`;
  explorer: string;
}

/** Confirmed Ethereum mainnet addresses (chain 1). */
export const DAO_ADDRESSES: Record<DaoChain, DaoAddresses> = {
  ethereum: {
    chainId: 1,
    governor: "0x6dfa413B5900a1a7947BC75E68AbBA093cB2492d",
    timelock: "0xbE1c37F8C4DA77dD06F4A8AC5098Ec70273093d7",
    ballots: "0x75F3D01c4D960FE986A598B7954A3b786B29cE49",
    token: "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927",
    treasury: "0x07A716a551E5f4CA7D6C71Da9dF1cb1429Dba826",
    explorer: "https://etherscan.io",
  },
};

/**
 * The 8-state OZ Governor v5 enum. The string label is what most builders
 * will want to surface in a UI.
 */
export enum ProposalState {
  Pending = 0,
  Active = 1,
  Canceled = 2,
  Defeated = 3,
  Succeeded = 4,
  Queued = 5,
  Expired = 6,
  Executed = 7,
}

export const PROPOSAL_STATE_LABEL: Record<ProposalState, string> = {
  [ProposalState.Pending]: "pending",
  [ProposalState.Active]: "active",
  [ProposalState.Canceled]: "canceled",
  [ProposalState.Defeated]: "defeated",
  [ProposalState.Succeeded]: "succeeded",
  [ProposalState.Queued]: "queued",
  [ProposalState.Expired]: "expired",
  [ProposalState.Executed]: "executed",
};

/** Vote support values. Maps to OZ's GovernorCountingSimple. */
export enum VoteSupport {
  Against = 0,
  For = 1,
  Abstain = 2,
}

/** OZ Governor v5 ABI (subset). */
export const GOVERNOR_ABI = parseAbi([
  "function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) external returns (uint256 proposalId)",
  "function castVote(uint256 proposalId, uint8 support) external returns (uint256)",
  "function castVoteWithReason(uint256 proposalId, uint8 support, string reason) external returns (uint256)",
  "function queue(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external returns (uint256)",
  "function execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external payable returns (uint256)",
  "function state(uint256 proposalId) external view returns (uint8)",
  "function hashProposal(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) external pure returns (uint256)",
  "function votingDelay() external view returns (uint256)",
  "function votingPeriod() external view returns (uint256)",
  "function proposalThreshold() external view returns (uint256)",
  "function quorum(uint256 timepoint) external view returns (uint256)",
  "function proposalVotes(uint256 proposalId) external view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function proposalSnapshot(uint256 proposalId) external view returns (uint256)",
  "function proposalDeadline(uint256 proposalId) external view returns (uint256)",
  "function proposalProposer(uint256 proposalId) external view returns (address)",
  "function proposalEta(uint256 proposalId) external view returns (uint256)",
  "function getVotes(address account, uint256 timepoint) external view returns (uint256)",
  "function hasVoted(uint256 proposalId, address account) external view returns (bool)",
]);

/** Minimal IVotes ABI for delegate + balance reads (LCAIBallots). */
export const VOTES_ABI = parseAbi([
  "function balanceOf(address) external view returns (uint256)",
  "function getVotes(address) external view returns (uint256)",
  "function delegates(address) external view returns (address)",
  "function delegate(address delegatee) external returns (bool)",
]);

interface MinimalPublicClient {
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
}

interface MinimalWalletClient {
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
}

export interface ProposalSummary {
  id: bigint;
  state: ProposalState;
  stateLabel: string;
  proposer: `0x${string}` | null;
  snapshot: bigint; // block where the vote token weights are snapshotted
  deadline: bigint; // block voting ends
  eta: bigint; // unix seconds when timelock allows execution (0 until queued)
  votes: {
    againstWei: bigint;
    forWei: bigint;
    abstainWei: bigint;
  };
}

export interface DaoConfig {
  votingDelayBlocks: bigint;
  votingPeriodBlocks: bigint;
  proposalThresholdWei: bigint;
  /** Approx voting period in seconds, assuming 12s/block on Ethereum. */
  votingPeriodSecs: number;
}

/**
 * DAO client. Wraps reads (proposal state, config) + writes (propose, vote,
 * queue, execute) on the Ethereum LCAIGovernor.
 */
export class DAO {
  /** Addresses for the configured DAO chain. Currently only Ethereum mainnet. */
  readonly addresses: DaoAddresses;

  constructor(
    private readonly publicClient: MinimalPublicClient,
    chain: DaoChain = "ethereum",
    private readonly walletClient?: MinimalWalletClient,
  ) {
    this.addresses = DAO_ADDRESSES[chain];
  }

  // -------- Reads --------

  /** Current proposal state by id. */
  async state(proposalId: bigint): Promise<ProposalState> {
    const raw = (await this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "state",
      args: [proposalId],
    })) as number;
    return raw as ProposalState;
  }

  /** Full proposal summary by id. Aggregates state + votes + key blocks. */
  async proposal(proposalId: bigint): Promise<ProposalSummary> {
    const [stateRaw, votesRaw, snapshot, deadline, eta, proposerRaw] = (await Promise.all([
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "state", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalVotes", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalSnapshot", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalDeadline", args: [proposalId] }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalEta", args: [proposalId] }).catch(() => 0n),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalProposer", args: [proposalId] }).catch(() => null),
    ])) as [number, [bigint, bigint, bigint], bigint, bigint, bigint, `0x${string}` | null];
    const state = stateRaw as ProposalState;
    return {
      id: proposalId,
      state,
      stateLabel: PROPOSAL_STATE_LABEL[state] ?? "unknown",
      proposer: proposerRaw,
      snapshot,
      deadline,
      eta,
      votes: { againstWei: votesRaw[0], forWei: votesRaw[1], abstainWei: votesRaw[2] },
    };
  }

  /** Whether `voter` has cast a vote on `proposalId`. */
  hasVoted(proposalId: bigint, voter: `0x${string}`): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "hasVoted",
      args: [proposalId, voter],
    }) as Promise<boolean>;
  }

  /** Voting weight of `voter` at a specific block (use the proposal's `snapshot`). */
  getVotes(voter: `0x${string}`, timepoint: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "getVotes",
      args: [voter, timepoint],
    }) as Promise<bigint>;
  }

  /** Aggregated voting parameters of the LCAIGovernor. */
  async config(): Promise<DaoConfig> {
    const [delay, period, threshold] = (await Promise.all([
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "votingDelay" }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "votingPeriod" }),
      this.publicClient.readContract({ address: this.addresses.governor, abi: GOVERNOR_ABI, functionName: "proposalThreshold" }),
    ])) as [bigint, bigint, bigint];
    return {
      votingDelayBlocks: delay,
      votingPeriodBlocks: period,
      proposalThresholdWei: threshold,
      votingPeriodSecs: Number(period) * 12,
    };
  }

  /** Quorum required at a given timepoint (in wei of voting weight). */
  quorum(timepoint: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "quorum",
      args: [timepoint],
    }) as Promise<bigint>;
  }

  // -------- Writes --------

  /** Cast a For / Against / Abstain vote. Wallet must be the voter and have delegated their LCAI. */
  castVote(proposalId: bigint, support: VoteSupport, reason?: string): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return reason
      ? this.walletClient.writeContract({
          address: this.addresses.governor,
          abi: GOVERNOR_ABI,
          functionName: "castVoteWithReason",
          args: [proposalId, support, reason],
        })
      : this.walletClient.writeContract({
          address: this.addresses.governor,
          abi: GOVERNOR_ABI,
          functionName: "castVote",
          args: [proposalId, support],
        });
  }

  /** Submit a new proposal. Wallet must hold at least `proposalThreshold` delegated votes. */
  propose(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    description: string;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "propose",
      args: [args.targets, args.values, args.calldatas, args.description],
    });
  }

  /** Queue a Succeeded proposal into the timelock. */
  queue(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    descriptionHash: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "queue",
      args: [args.targets, args.values, args.calldatas, args.descriptionHash],
    });
  }

  /**
   * Execute a Queued proposal. The Governor enforces
   * `msg.value == sum(values)`; pass the sum as `value`.
   */
  execute(args: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    descriptionHash: `0x${string}`;
  }): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("DAO: no wallet client; pass one to the DAO constructor for writes");
    const totalValue = args.values.reduce((acc, v) => acc + v, 0n);
    return this.walletClient.writeContract({
      address: this.addresses.governor,
      abi: GOVERNOR_ABI,
      functionName: "execute",
      args: [args.targets, args.values, args.calldatas, args.descriptionHash],
      value: totalValue,
    });
  }
}
